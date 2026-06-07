import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import {
  readJsonBody,
  requireAdmin,
  secureJson,
  securityError,
} from '@/lib/server-security'

type CallEventBody = {
  clientEventId?: unknown
  deviceId?: unknown
  agentName?: unknown
  source?: unknown
  direction?: unknown
  status?: unknown
  contactName?: unknown
  phoneNumber?: unknown
  appPackage?: unknown
  timestamp?: unknown
  startedAt?: unknown
  endedAt?: unknown
  duration?: unknown
  durationSeconds?: unknown
  capturedAt?: unknown
  notificationTitle?: unknown
  notificationText?: unknown
  notes?: unknown
}

const validSources = new Set(['cellular', 'whatsapp', 'whatsapp_business', 'other'])
const validDirections = new Set(['incoming', 'outgoing', 'missed', 'unknown'])
const validStatuses = new Set(['ringing', 'active', 'ended', 'missed', 'declined', 'captured', 'unknown'])

export async function GET(req: NextRequest) {
  try {
    if (isValidIngestRequest(req)) {
      return secureJson({
        success: true,
        endpoint: '/api/call-events',
        accepts: ['POST'],
      })
    }

    const admin = await requireAdmin(req, 'call-events-read')
    if (!admin.ok) return admin.response

    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 100), 1), 250)
    const { data, error } = await admin.supabaseAdmin
      .from('call_events')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(limit)

    if (error) return securityError(error.message, 500)

    return secureJson({ events: data || [] })
  } catch {
    return securityError('Failed to load call events.', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isValidIngestRequest(req)) {
      return securityError('Unauthorized.', 401)
    }

    const body = await readJsonBody<CallEventBody>(req, 256_000)
    if (!body.ok) return body.response

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceKey) {
      return securityError('Supabase service environment variables are missing.', 500)
    }

    const event = normalizeCallEvent(body.data)
    const eventError = validateCallEvent(event)
    if (eventError) return securityError(eventError, 400)

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await supabaseAdmin
      .from('call_events')
      .upsert(event, { onConflict: 'client_event_id' })
      .select('id, client_event_id, captured_at')
      .single()

    if (error) return securityError(error.message, 500)

    return secureJson({ success: true, event: data }, 201)
  } catch {
    return securityError('Failed to save call event.', 500)
  }
}

function normalizeCallEvent(body: CallEventBody) {
  const capturedAt = isoDate(body.capturedAt) || epochMillisDate(body.timestamp) || new Date().toISOString()
  const startedAt = isoDate(body.startedAt) || epochMillisDate(body.timestamp)
  const durationSeconds = nonNegativeNumber(body.durationSeconds ?? body.duration)
  const endedAt = isoDate(body.endedAt) || (startedAt && durationSeconds ? new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString() : null)
  const source = normalizeSource(body.source)
  const direction = normalizeDirection(body.direction, body.status)
  const status = normalizeStatus(body.status)

  return {
    client_event_id: optionalString(body.clientEventId, 160) || buildClientEventId(body, capturedAt),
    device_id: stringValue(body.deviceId, 160),
    agent_name: optionalString(body.agentName, 120),
    source,
    direction,
    status,
    contact_name: optionalString(body.contactName, 200),
    phone_number: optionalString(body.phoneNumber, 80),
    app_package: optionalString(body.appPackage, 160),
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    captured_at: capturedAt,
    notification_title: optionalString(body.notificationTitle, 240),
    notification_text: optionalString(body.notificationText, 1200),
    notes: optionalString(body.notes, 1200),
    raw_payload: body as Record<string, unknown>,
  }
}

function validateCallEvent(event: ReturnType<typeof normalizeCallEvent>) {
  if (!event.device_id) return 'Device ID is required.'
  if (!event.client_event_id) return 'Client event ID is required.'
  if (event.started_at && event.ended_at && Date.parse(event.started_at) > Date.parse(event.ended_at)) {
    return 'Call start time cannot be after end time.'
  }

  return null
}

function isValidIngestRequest(req: NextRequest) {
  const ingestToken = process.env.CALL_TRACKER_INGEST_TOKEN
  const authHeader = req.headers.get('authorization') || ''

  return Boolean(ingestToken && authHeader === `Bearer ${ingestToken}`)
}

function normalizeSource(value: unknown) {
  const clean = String(value || '').trim().toLowerCase()
  if (clean === 'phone' || clean === 'normal' || clean === 'call' || clean === 'cell') return 'cellular'
  if (clean === 'wa') return 'whatsapp'
  if (clean === 'whatsapp business' || clean === 'whatsapp_business' || clean === 'w4b') return 'whatsapp_business'
  return validSources.has(clean) ? clean : 'other'
}

function normalizeStatus(value: unknown) {
  const clean = String(value || '').trim().toLowerCase()
  if (clean === 'answered') return 'ended'
  if (clean === 'incoming') return 'ringing'
  if (clean === 'outgoing') return 'ended'
  return validStatuses.has(clean) ? clean : 'captured'
}

function normalizeDirection(direction: unknown, status: unknown) {
  const cleanDirection = String(direction || '').trim().toLowerCase()
  if (validDirections.has(cleanDirection)) return cleanDirection

  const cleanStatus = String(status || '').trim().toLowerCase()
  if (cleanStatus === 'incoming' || cleanStatus === 'answered') return 'incoming'
  if (cleanStatus === 'outgoing') return 'outgoing'
  if (cleanStatus === 'missed' || cleanStatus === 'rejected' || cleanStatus === 'declined') return 'missed'
  return 'unknown'
}

function stringValue(value: unknown, maxLength: number) {
  return optionalString(value, maxLength) || ''
}

function optionalString(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return null
  const clean = String(value).trim()
  if (!clean) return null
  return clean.slice(0, maxLength)
}

function isoDate(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function epochMillisDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  const milliseconds = number < 10_000_000_000 ? number * 1000 : number
  return new Date(milliseconds).toISOString()
}

function nonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number)
}

function buildClientEventId(body: CallEventBody, capturedAt: string) {
  return [
    stringValue(body.deviceId, 80),
    normalizeSource(body.source),
    normalizeDirection(body.direction, body.status),
    optionalString(body.phoneNumber, 80) || optionalString(body.contactName, 120) || 'unknown',
    capturedAt,
  ].join(':')
}
