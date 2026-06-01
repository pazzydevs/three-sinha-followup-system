import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          email: string | null
          role: string
        }
        Insert: {
          id: string
          username: string
          email?: string | null
          role?: string
        }
        Update: {
          username?: string
          email?: string | null
          role?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          id: string
          user_id: string
          job_no: string
          cx_name: string
          action_require: string
        }
        Insert: Record<string, never>
        Update: {
          action_require?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: Json
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_by?: string | null
        }
        Update: {
          value?: Json
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type RateLimitEntry = {
  count: number
  resetAt: number
}

type AdminContext =
  | {
      ok: true
      supabaseAdmin: ReturnType<typeof createClient<Database>>
      userId: string
    }
  | {
      ok: false
      response: NextResponse
    }

type UserContext =
  | {
      ok: true
      supabaseAdmin: ReturnType<typeof createClient<Database>>
      userId: string
      role: string
    }
  | {
      ok: false
      response: NextResponse
    }

const rateLimits = new Map<string, RateLimitEntry>()
const usernamePattern = /^[a-z0-9._-]{3,32}$/

export function secureJson(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export function securityError(message: string, status = 400) {
  return secureJson({ error: message }, status)
}

export async function readJsonBody<T>(req: NextRequest, maxBytes = 64_000): Promise<
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }
> {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return { ok: false, response: securityError('Content-Type must be application/json.', 415) }
  }

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > maxBytes) {
    return { ok: false, response: securityError('Request body is too large.', 413) }
  }

  try {
    return { ok: true, data: await req.json() as T }
  } catch {
    return { ok: false, response: securityError('Invalid JSON request body.', 400) }
  }
}

export function requireSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')

  if (!host) {
    return securityError('Missing host header.', 403)
  }

  if (!origin) {
    const referer = req.headers.get('referer')
    const fetchSite = req.headers.get('sec-fetch-site')

    if (fetchSite === 'same-origin' || fetchSite === 'none') {
      return null
    }

    if (referer) {
      try {
        const refererUrl = new URL(referer)
        if (refererUrl.host === host) return null
      } catch {
        return securityError('Invalid referer header.', 403)
      }
    }

    return securityError('Missing origin header.', 403)
  }

  try {
    const originUrl = new URL(origin)
    if (originUrl.host !== host) {
      return securityError('Cross-origin request blocked.', 403)
    }
  } catch {
    return securityError('Invalid origin header.', 403)
  }

  return null
}

export function rateLimit(req: NextRequest, action: string, maxRequests = 30, windowMs = 60_000) {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwardedFor || req.headers.get('x-real-ip') || 'unknown'
  const key = `${action}:${ip}`
  const now = Date.now()
  const current = rateLimits.get(key)

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }

  current.count += 1

  if (current.count > maxRequests) {
    return secureJson({ error: 'Too many requests. Please try again shortly.' }, 429)
  }

  return null
}

export async function requireAdmin(req: NextRequest, action: string): Promise<AdminContext> {
  const user = await requireAuthenticatedUser(req, action)
  if (!user.ok) return user

  if (user.role !== 'admin') {
    return { ok: false, response: securityError('Admin access required.', 403) }
  }

  return { ok: true, supabaseAdmin: user.supabaseAdmin, userId: user.userId }
}

export async function requireAuthenticatedUser(req: NextRequest, action: string): Promise<UserContext> {
  const originError = requireSameOrigin(req)
  if (originError) return { ok: false, response: originError }

  const limitError = rateLimit(req, action)
  if (limitError) return { ok: false, response: limitError }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return { ok: false, response: securityError('Server authentication is not configured.', 500) }
  }

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return { ok: false, response: securityError('Authentication required.', 401) }
  }

  const supabaseUser = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
  if (userError || !user) {
    return { ok: false, response: securityError('Invalid session.', 401) }
  }

  const { data: profile, error: profileError } = await supabaseUser
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    if (profileError || !profile?.role) {
      return { ok: false, response: securityError('Profile access required.', 403) }
    }
  }

  const supabaseAdmin = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { ok: true, supabaseAdmin, userId: user.id, role: profile.role }
}

export function normalizeUsername(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

export function validateUsername(username: string) {
  if (!usernamePattern.test(username)) {
    return 'Username must be 3-32 characters and use only letters, numbers, dot, underscore, or hyphen.'
  }

  return null
}

export function validateEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()

  if (!email || email.length > 254) {
    return { email, error: 'Valid email is required.' }
  }

  try {
    const parsed = new URL(`mailto:${email}`)
    if (parsed.pathname !== email || !email.includes('@')) {
      return { email, error: 'Valid email is required.' }
    }
  } catch {
    return { email, error: 'Valid email is required.' }
  }

  return { email, error: null }
}

export function validatePassword(value: unknown, required: boolean) {
  const password = String(value || '')

  if (!password && !required) {
    return { password, error: null }
  }

  if (password.length < 8 || password.length > 128) {
    return { password, error: 'Password must be 8-128 characters.' }
  }

  return { password, error: null }
}

export function normalizeHttpMethod(value: unknown): 'GET' | 'POST' | null {
  if (value === 'GET' || value === 'POST') return value
  if (typeof value !== 'string') return null

  const upper = value.toUpperCase()
  return upper === 'GET' || upper === 'POST' ? upper : null
}

export function validateWebhookUrl(value: unknown) {
  if (typeof value !== 'string') {
    return { url: '', error: 'Invalid n8n webhook URL.' }
  }

  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    const allowedHosts = new Set([
      'n8n.pazzy.store',
      ...(process.env.ALLOWED_N8N_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean),
    ])

    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(isLocalhost && url.protocol === 'http:')) {
      return { url: trimmed, error: 'Webhook URL must use HTTPS.' }
    }

    if (!isLocalhost && !allowedHosts.has(url.hostname)) {
      return { url: trimmed, error: 'Webhook host is not allowed.' }
    }

    if (!url.pathname.includes('/webhook/') && !url.pathname.includes('/webhook-test/')) {
      return { url: trimmed, error: 'Webhook URL must be an n8n webhook path.' }
    }

    return { url: trimmed, error: null }
  } catch {
    return { url: trimmed, error: 'Invalid n8n webhook URL.' }
  }
}
