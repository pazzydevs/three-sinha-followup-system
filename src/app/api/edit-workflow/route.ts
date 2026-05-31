import { NextRequest } from 'next/server'
import { EditableJobColumn, EditRequest, UserNotification } from '@/lib/followup'
import {
  readJsonBody,
  requireAuthenticatedUser,
  secureJson,
  securityError,
} from '@/lib/server-security'

type WorkflowState = {
  requests: EditRequest[]
  notifications: UserNotification[]
}

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

const workflowKey = 'edit_workflow_state'
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
  'action_require',
])

export async function GET(req: NextRequest) {
  const user = await requireAuthenticatedUser(req, 'edit-workflow-read')
  if (!user.ok) return user.response

  const state = await readWorkflowState(user.supabaseAdmin)
  if (user.role === 'admin') {
    return secureJson(state)
  }

  return secureJson({
    requests: state.requests.filter((request) => request.user_id === user.userId),
    notifications: state.notifications.filter((notification) => notification.user_id === user.userId),
  })
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody<WorkflowBody>(req)
  if (!body.ok) return body.response

  const user = await requireAuthenticatedUser(req, 'edit-workflow-write')
  if (!user.ok) return user.response

  const state = await readWorkflowState(user.supabaseAdmin)

  if (body.data.action === 'request_edit') {
    const jobId = String(body.data.jobId || '')
    const requestedColumn = String(body.data.requestedColumn || '') as EditableJobColumn
    const message = String(body.data.message || '').trim()

    if (!allowedColumns.has(requestedColumn)) return securityError('Invalid edit column.', 400)
    if (message.length < 3 || message.length > 1000) return securityError('Message must be 3-1000 characters.', 400)

    const { data: job, error } = await user.supabaseAdmin
      .from('jobs')
      .select('id,user_id,job_no,cx_name')
      .eq('id', jobId)
      .single()

    if (error || !job || job.user_id !== user.userId) {
      return securityError('Job not found.', 404)
    }

    const existing = state.requests.find((request) => request.job_id === jobId && request.user_id === user.userId && request.status === 'pending')
    if (existing) return securityError('An edit request is already pending for this job.', 400)

    const now = new Date().toISOString()
    state.requests.unshift({
      id: crypto.randomUUID(),
      job_id: jobId,
      user_id: user.userId,
      requested_column: requestedColumn,
      message,
      status: 'pending',
      admin_response: null,
      approved_by: null,
      approved_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    })

    await writeWorkflowState(user.supabaseAdmin, state, user.userId)
    return secureJson({ success: true })
  }

  if (body.data.action === 'decision') {
    if (user.role !== 'admin') return securityError('Admin access required.', 403)

    const requestId = String(body.data.requestId || '')
    const status = String(body.data.status || '')
    if (status !== 'approved' && status !== 'rejected') return securityError('Invalid decision.', 400)

    const request = state.requests.find((item) => item.id === requestId)
    if (!request) return securityError('Request not found.', 404)

    const now = new Date().toISOString()
    request.status = status
    request.admin_response = String(body.data.adminResponse || '').trim() || null
    request.approved_by = status === 'approved' ? user.userId : null
    request.approved_at = status === 'approved' ? now : null
    request.updated_at = now

    state.notifications.unshift({
      id: crypto.randomUUID(),
      user_id: request.user_id,
      title: status === 'approved' ? 'Edit request approved' : 'Edit request rejected',
      message: status === 'approved'
        ? `You can now edit ${columnLabel(request.requested_column)} for the selected job.`
        : `Your edit request for ${columnLabel(request.requested_column)} was rejected.${request.admin_response ? ` ${request.admin_response}` : ''}`,
      type: status === 'approved' ? 'edit_approved' : 'edit_rejected',
      related_request_id: request.id,
      read_at: null,
      created_at: now,
    })

    await writeWorkflowState(user.supabaseAdmin, state, user.userId)
    return secureJson({ success: true })
  }

  if (body.data.action === 'mark_read') {
    const markReadBody = body.data as Extract<WorkflowBody, { action: 'mark_read' }>
    const notification = state.notifications.find((item) => item.id === String(markReadBody.notificationId || ''))
    if (!notification) return securityError('Notification not found.', 404)
    if (notification.user_id !== user.userId && user.role !== 'admin') return securityError('Forbidden.', 403)

    notification.read_at = notification.read_at || new Date().toISOString()
    await writeWorkflowState(user.supabaseAdmin, state, user.userId)
    return secureJson({ success: true })
  }

  return securityError('Invalid action.', 400)
}

async function readWorkflowState(supabaseAdmin: ReturnType<typeof requireAuthenticatedUser> extends Promise<infer T> ? T extends { ok: true; supabaseAdmin: infer S } ? S : never : never): Promise<WorkflowState> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', workflowKey)
    .maybeSingle()

  const value = data?.value as Partial<WorkflowState> | null | undefined
  return {
    requests: Array.isArray(value?.requests) ? value.requests as EditRequest[] : [],
    notifications: Array.isArray(value?.notifications) ? value.notifications as UserNotification[] : [],
  }
}

async function writeWorkflowState(
  supabaseAdmin: Parameters<typeof readWorkflowState>[0],
  state: WorkflowState,
  userId: string,
) {
  await supabaseAdmin.from('app_settings').upsert({
    key: workflowKey,
    value: state,
    updated_by: userId,
  }, { onConflict: 'key' })
}

function columnLabel(column: string) {
  return column.replace(/_/g, ' ')
}
