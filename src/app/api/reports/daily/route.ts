import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Job, Profile, buildReportPayload, buildUserSummaries, normalizeJob } from '@/lib/followup'

export async function GET(req: NextRequest) {
  return sendDailyReport(req)
}

export async function POST(req: NextRequest) {
  return sendDailyReport(req)
}

async function sendDailyReport(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const fallbackWebhookUrl = process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase service environment variables are missing.' }, { status: 500 })
  }

  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }
  }

  const reportDate = req.nextUrl.searchParams.get('date') || sriLankaToday()
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: n8nSetting } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'n8n_config')
    .maybeSingle()

  const n8nConfig = isObject(n8nSetting?.value) ? n8nSetting.value : {}
  const webhookUrl = typeof n8nConfig.webhookUrl === 'string' && n8nConfig.webhookUrl.trim()
    ? n8nConfig.webhookUrl.trim()
    : fallbackWebhookUrl
  const httpMethod = n8nConfig.httpMethod === 'GET' ? 'GET' : 'POST'
  const deliveryEnabled = typeof n8nConfig.enabled === 'boolean' ? n8nConfig.enabled : true

  if (!deliveryEnabled) {
    return NextResponse.json({ success: true, skipped: true, reason: 'n8n delivery is disabled.', date: reportDate })
  }

  if (!webhookUrl) {
    return NextResponse.json({ error: 'n8n webhook URL is missing.' }, { status: 500 })
  }

  const [{ data: profiles, error: profilesError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('*').eq('role', 'user').order('username'),
    supabaseAdmin.from('jobs').select('*').lte('date', reportDate).order('date', { ascending: false }),
  ])

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 })
  }

  const summaries = buildUserSummaries(
    (profiles || []) as Profile[],
    ((jobs || []) as Job[]).map(normalizeJob),
    reportDate,
  )
  const payload = buildReportPayload(summaries, reportDate)
  const webhookPayload = {
    ...payload,
    delivery: {
      emailTo: typeof n8nConfig.emailTo === 'string' ? n8nConfig.emailTo : '',
      workflowName: typeof n8nConfig.workflowName === 'string' ? n8nConfig.workflowName : 'Daily Follow-up Report',
    },
  }
  const webhookResult = await sendWebhookWithFallback(webhookUrl, httpMethod, webhookPayload)
  const webhookResponse = webhookResult.response

  if (!webhookResponse.ok) {
    if (webhookResponse.status === 404) {
      return NextResponse.json({
        error: 'n8n returned 404. Activate the n8n workflow for the production webhook URL before scheduled reports can run.',
      }, { status: 502 })
    }

    return NextResponse.json({ error: `n8n returned status ${webhookResponse.status}` }, { status: 502 })
  }

  return NextResponse.json({
    success: true,
    date: reportDate,
    summary: payload.summary,
    usedMethod: webhookResult.method,
    usedWebhookUrl: webhookResult.url,
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

async function sendWebhookWithFallback(webhookUrl: string, method: 'GET' | 'POST', payload: unknown) {
  const candidates = buildWebhookCandidates(webhookUrl, method)
  let lastResult: { response: Response; url: string; method: 'GET' | 'POST' } | null = null

  for (const candidate of candidates) {
    const response = await sendWebhook(candidate.url, candidate.method, payload)
    const result = { response, url: candidate.url, method: candidate.method }

    if (response.ok) {
      return result
    }

    lastResult = result

    if (response.status !== 404 && response.status !== 405) {
      return result
    }
  }

  return lastResult!
}

function buildWebhookCandidates(webhookUrl: string, method: 'GET' | 'POST') {
  const alternateMethod: 'GET' | 'POST' = method === 'GET' ? 'POST' : 'GET'
  const relatedUrl = getRelatedWebhookUrl(webhookUrl)
  const rawCandidates: Array<{ url: string; method: 'GET' | 'POST' }> = [
    { url: webhookUrl, method },
    { url: webhookUrl, method: alternateMethod },
    ...(relatedUrl ? [
      { url: relatedUrl, method },
      { url: relatedUrl, method: alternateMethod },
    ] : []),
  ]
  const seen = new Set<string>()

  return rawCandidates.filter((candidate) => {
    const key = `${candidate.method}:${candidate.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getRelatedWebhookUrl(webhookUrl: string) {
  if (webhookUrl.includes('/webhook-test/')) {
    return webhookUrl.replace('/webhook-test/', '/webhook/')
  }

  if (webhookUrl.includes('/webhook/')) {
    return webhookUrl.replace('/webhook/', '/webhook-test/')
  }

  return null
}

function buildGetPayload(payload: unknown) {
  if (!isObject(payload)) {
    return {
      source: 'three-sinha-followup-system',
      payload: JSON.stringify(payload),
    }
  }

  return {
    source: 'three-sinha-followup-system',
    type: 'daily_report',
    date: stringValue(payload.date, new Date().toISOString().slice(0, 10)),
    summary: JSON.stringify(payload.summary || {}),
    users: JSON.stringify(payload.users || []),
    reportText: stringValue(payload.reportText, ''),
    delivery: JSON.stringify(payload.delivery || {}),
    sentAt: new Date().toISOString(),
  }
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback
}

function sriLankaToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  return `${year}-${month}-${day}`
}
