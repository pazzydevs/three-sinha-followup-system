import { NextRequest } from 'next/server'
import { EditableJobColumn, EditRequest, UserNotification } from '@/lib/followup'
import {
  readJsonBody,
  requireAuthenticatedUser,
  secureJson,
  securityError,
} from '@/lib/server-security'

type WorkflowBody =
  | {
      action: 'request_edit'
      jobId: unknown
      requestedColumn: unknown
      message: unknown
    }
  | {
      action: 'decision'
      requestId: unknown
      status: unknown
      adminResponse?: unknown
    }
  | {
      action: 'mark_read'
      notificationId: unknown
    }
  | {
      action: 'complete'
      requestId: unknown
    }

type WorkflowJob = {
  id: string
  user_id: string
  job_no: string
  cx_name: string
  action_require: string
}

type EncodedEditRequest = {
  id: string
  requested_column: EditableJobColumn
  message: string
  status: 'pending' | 'approved' | 'rejected' | 'completed'
  admin_response: string | null
  approved_by: string | null
  approved_at: string | null
  completed_at: string | null
  read_at: string | null
  created_at: string
  updated_at: string
  original_action: string
}

const editRequestPrefix = 'EDIT_REQUEST:'
const allowedColumns = new Set([
  'date',
  'job_no',
  'cx_name',
  'contact_no',
  'job_amount',
  'amount_received',
  'received_date',
  'first_follow_up',
  'second_follow_up',
  'status',
])

export async function GET(req: NextRequest) {
  const user = await requireAuthenticatedUser(req, 'edit-workflow-read')
  if (!user.ok) return user.response

  const query = user.supabaseAdmin
    .from('jobs')
    .select('id,user_id,job_no,cx_name,action_require')
    .order('updated_at', { ascending: false })

  if (user.role !== 'admin') {
    query.eq('user_id', user.userId)
  }

  const { data, error } = await query
  if (error) return securityError(error.message, 500)

  const requests = ((data || []) as WorkflowJob[])
    .map((job) => requestFromJob(job))
    .filter((request): request is EditRequest => Boolean(request))

  return secureJson({
    requests,
    notifications: user.role === 'admin' ? [] : notificationsFromRequests(requests),
  })
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody<WorkflowBody>(req)
  if (!body.ok) return body.response

  const user = await requireAuthenticatedUser(req, 'edit-workflow-write')
  if (!user.ok) return user.response

  if (body.data.action === 'request_edit') {
    const jobId = String(body.data.jobId || '')
    const requestedColumn = String(body.data.requestedColumn || '') as EditableJobColumn
    const message = String(body.data.message || '').trim()

    if (!allowedColumns.has(requestedColumn)) return securityError('Invalid edit column.', 400)
    if (message.length < 3 || message.length > 1000) return securityError('Message must be 3-1000 characters.', 400)

    const job = await findJob(user.supabaseAdmin, jobId)
    if (!job || job.user_id !== user.userId) return securityError('Job not found.', 404)

    const existing = parseRequest(job.action_require)
    if (existing?.status === 'pending') return securityError('An edit request is already pending for this job.', 400)
    if (existing?.status === 'approved') return securityError('An edit request is already approved for this job.', 400)

    const now = new Date().toISOString()
    const request: EncodedEditRequest = {
      id: crypto.randomUUID(),
      requested_column: requestedColumn,
      message,
      status: 'pending',
      admin_response: null,
      approved_by: null,
      approved_at: null,
      completed_at: null,
      read_at: null,
      created_at: now,
      updated_at: now,
      original_action: existing?.original_action || job.action_require || 'NONE',
    }

    const error = await saveRequest(user.supabaseAdmin, job.id, request)
    if (error) return securityError(error, 500)

    return secureJson({ success: true, message: 'Edit request sent to admin.' })
  }

  if (body.data.action === 'decision') {
    if (user.role !== 'admin') return securityError('Admin access required.', 403)

    const requestId = String(body.data.requestId || '')
    const status = String(body.data.status || '')
    if (status !== 'approved' && status !== 'rejected') return securityError('Invalid decision.', 400)

    const found = await findJobByRequest(user.supabaseAdmin, requestId)
    if (!found) return securityError('Request not found.', 404)

    const now = new Date().toISOString()
    found.request.status = status
    found.request.admin_response = String(body.data.adminResponse || '').trim() || null
    found.request.approved_by = status === 'approved' ? user.userId : null
    found.request.approved_at = status === 'approved' ? now : null
    found.request.read_at = null
    found.request.updated_at = now

    const error = await saveRequest(user.supabaseAdmin, found.job.id, found.request)
    if (error) return securityError(error, 500)

    return secureJson({ success: true })
  }

  if (body.data.action === 'mark_read') {
    const markReadBody = body.data as Extract<WorkflowBody, { action: 'mark_read' }>
    const requestId = String(markReadBody.notificationId || '').replace(/^notification-/, '')
    const found = await findJobByRequest(user.supabaseAdmin, requestId)
    if (!found) return securityError('Notification not found.', 404)
    if (found.job.user_id !== user.userId && user.role !== 'admin') return securityError('Forbidden.', 403)

    found.request.read_at = found.request.read_at || new Date().toISOString()
    const error = await saveRequest(user.supabaseAdmin, found.job.id, found.request)
    if (error) return securityError(error, 500)

    return secureJson({ success: true })
  }

  if (body.data.action === 'complete') {
    const completeBody = body.data as Extract<WorkflowBody, { action: 'complete' }>
    const found = await findJobByRequest(user.supabaseAdmin, String(completeBody.requestId || ''))
    if (!found) return securityError('Request not found.', 404)
    if (found.job.user_id !== user.userId && user.role !== 'admin') return securityError('Forbidden.', 403)

    const { error } = await user.supabaseAdmin
      .from('jobs')
      .update({ action_require: found.request.original_action || 'NONE' })
      .eq('id', found.job.id)

    if (error) return securityError(error.message, 500)
    return secureJson({ success: true })
  }

  return securityError('Invalid action.', 400)
}

async function findJob(supabaseAdmin: SupabaseAdminClient, jobId: string) {
  const { data } = await supabaseAdmin
    .from('jobs')
    .select('id,user_id,job_no,cx_name,action_require')
    .eq('id', jobId)
    .single()

  return data as WorkflowJob | null
}

async function findJobByRequest(supabaseAdmin: SupabaseAdminClient, requestId: string) {
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('id,user_id,job_no,cx_name,action_require')

  if (error) return null

  for (const job of (data || []) as WorkflowJob[]) {
    const request = parseRequest(job.action_require)
    if (request?.id === requestId) {
      return { job, request }
    }
  }

  return null
}

async function saveRequest(supabaseAdmin: SupabaseAdminClient, jobId: string, request: EncodedEditRequest) {
  const { error } = await supabaseAdmin
    .from('jobs')
    .update({ action_require: encodeRequest(request) })
    .eq('id', jobId)

  return error?.message || null
}

function requestFromJob(job: WorkflowJob): EditRequest | null {
  const request = parseRequest(job.action_require)
  if (!request) return null

  return {
    id: request.id,
    job_id: job.id,
    user_id: job.user_id,
    requested_column: request.requested_column,
    message: request.message,
    status: request.status,
    admin_response: request.admin_response,
    approved_by: request.approved_by,
    approved_at: request.approved_at,
    completed_at: request.completed_at,
    read_at: request.read_at,
    created_at: request.created_at,
    updated_at: request.updated_at,
  }
}

function notificationsFromRequests(requests: EditRequest[]): UserNotification[] {
  return requests
    .filter((request) => request.status === 'approved' || request.status === 'rejected')
    .map((request) => {
      const encoded = request as EditRequest & { read_at?: string | null }
      return {
        id: `notification-${request.id}`,
        user_id: request.user_id,
        title: request.status === 'approved' ? 'Edit request approved' : 'Edit request rejected',
        message: request.status === 'approved'
          ? `You can now edit ${columnLabel(request.requested_column)} for the selected job.`
          : `Your edit request for ${columnLabel(request.requested_column)} was rejected.${request.admin_response ? ` ${request.admin_response}` : ''}`,
        type: request.status === 'approved' ? 'edit_approved' : 'edit_rejected',
        related_request_id: request.id,
        read_at: encoded.read_at || null,
        created_at: request.updated_at,
      }
    })
}

function encodeRequest(request: EncodedEditRequest) {
  return `${editRequestPrefix}${encodeURIComponent(JSON.stringify(request))}`
}

function parseRequest(value: string | null | undefined): EncodedEditRequest | null {
  if (!value?.startsWith(editRequestPrefix)) return null

  try {
    return JSON.parse(decodeURIComponent(value.slice(editRequestPrefix.length))) as EncodedEditRequest
  } catch {
    return null
  }
}

function columnLabel(column: string) {
  return column.replace(/_/g, ' ')
}

type SupabaseAdminClient = Extract<Awaited<ReturnType<typeof requireAuthenticatedUser>>, { ok: true }>['supabaseAdmin']
