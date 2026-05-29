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
  const webhookUrl = process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL
  const cronSecret = process.env.CRON_SECRET

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase service environment variables are missing.' }, { status: 500 })
  }

  if (!webhookUrl) {
    return NextResponse.json({ error: 'n8n webhook URL is missing.' }, { status: 500 })
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
  const webhookResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!webhookResponse.ok) {
    return NextResponse.json({ error: `n8n returned status ${webhookResponse.status}` }, { status: 502 })
  }

  return NextResponse.json({ success: true, date: reportDate, summary: payload.summary })
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
