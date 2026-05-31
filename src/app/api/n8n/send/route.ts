import { NextRequest } from 'next/server'
import {
  normalizeHttpMethod,
  readJsonBody,
  requireAdmin,
  secureJson,
  securityError,
  validateWebhookUrl,
} from '@/lib/server-security'

type N8nSendBody = {
  webhookUrl: unknown
  payload: unknown
  method?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<N8nSendBody>(req, 1_000_000)
    if (!body.ok) return body.response

    const admin = await requireAdmin(req, 'n8n-send')
    if (!admin.ok) return admin.response

    const { url: webhookUrl, error: webhookError } = validateWebhookUrl(body.data.webhookUrl)
    if (webhookError) return securityError(webhookError, 400)

    const httpMethod = normalizeHttpMethod(body.data.method || 'POST')
    if (!httpMethod) return securityError('Invalid n8n HTTP method.', 400)

    const webhookResult = await sendWebhookWithFallback(webhookUrl, httpMethod, body.data.payload)
    const webhookResponse = webhookResult.response

    if (!webhookResponse.ok) {
      if (webhookResponse.status === 404) {
        return securityError(
          'n8n returned 404. Click "Listen for test event" in n8n and use the /webhook-test URL, or activate the workflow and use the /webhook production URL.',
          502,
        )
      }

      return securityError(`n8n returned status ${webhookResponse.status}`, 502)
    }

    return secureJson({
      success: true,
      usedMethod: webhookResult.method,
      usedWebhookUrl: webhookResult.url,
    })
  } catch {
    return securityError('Failed to send n8n webhook.', 500)
  }
}

function sendWebhook(webhookUrl: string, method: 'GET' | 'POST', payload: unknown) {
  if (method === 'GET') {
    const url = new URL(webhookUrl)
    const getPayload = buildGetPayload(payload)

    Object.entries(getPayload).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })

    return fetch(url, { method: 'GET', redirect: 'manual' })
  }

  return fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
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
