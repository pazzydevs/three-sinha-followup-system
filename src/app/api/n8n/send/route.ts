import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase environment variables are missing.' }, { status: 500 })
    }

    const authHeader = req.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      return NextResponse.json({ error: 'Missing admin session.' }, { status: 401 })
    }

    const { webhookUrl, payload, method = 'POST' } = await req.json()
    const httpMethod = normalizeMethod(method)

    if (!isValidWebhookUrl(webhookUrl)) {
      return NextResponse.json({ error: 'Invalid n8n webhook URL.' }, { status: 400 })
    }

    if (!httpMethod) {
      return NextResponse.json({ error: 'Invalid n8n HTTP method.' }, { status: 400 })
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token)
    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid admin session.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabaseUser
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can send n8n webhooks.' }, { status: 403 })
    }

    const webhookResponse = await sendWebhook(webhookUrl, httpMethod, payload)

    if (!webhookResponse.ok) {
      if (webhookResponse.status === 404) {
        return NextResponse.json({
          error: 'n8n returned 404. Click "Listen for test event" in n8n and use the /webhook-test URL, or activate the workflow and use the /webhook production URL.',
        }, { status: 502 })
      }

      return NextResponse.json({ error: `n8n returned status ${webhookResponse.status}` }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send n8n webhook.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function normalizeMethod(value: unknown): 'GET' | 'POST' | null {
  if (value === 'GET' || value === 'POST') return value
  if (typeof value !== 'string') return null

  const upper = value.toUpperCase()
  return upper === 'GET' || upper === 'POST' ? upper : null
}

function sendWebhook(webhookUrl: string, method: 'GET' | 'POST', payload: unknown) {
  if (method === 'GET') {
    const url = new URL(webhookUrl)
    const getPayload = buildGetPayload(payload)

    Object.entries(getPayload).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })

    return fetch(url, { method: 'GET' })
  }

  return fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function buildGetPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return {
      source: 'three-sinha-followup-system',
      payload: JSON.stringify(payload),
    }
  }

  return {
    source: 'three-sinha-followup-system',
    type: stringValue(payload.type, 'daily_report'),
    date: stringValue(payload.date, new Date().toISOString().slice(0, 10)),
    summary: JSON.stringify(payload.summary || {}),
    users: JSON.stringify(payload.users || []),
    reportText: stringValue(payload.reportText, ''),
    delivery: JSON.stringify(payload.delivery || {}),
    sentAt: new Date().toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback
}

function isValidWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false

  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
