'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Job,
  JobStatus,
  Profile,
  EditableJobColumn,
  EditRequest,
  UserNotification,
  addDaysISO,
  buildUserSummaries,
  displayDate,
  formatMoney,
  getActionStatus,
  longDisplayDate,
  normalizeJob,
  todayISO,
} from '@/lib/followup'

type JobForm = {
  date: string
  job_no: string
  cx_name: string
  contact_no: string
  job_amount: string
  amount_received: string
  received_date: string
  first_follow_up: string
  second_follow_up: string
  status: JobStatus
  action_require: string
}

const emptyForm: JobForm = {
  date: todayISO(),
  job_no: '',
  cx_name: '',
  contact_no: '',
  job_amount: '',
  amount_received: '',
  received_date: todayISO(),
  first_follow_up: todayISO(),
  second_follow_up: addDaysISO(todayISO(), 7),
  status: 'Pending',
  action_require: 'NONE',
}

const compactViewStorageKey = 'three-sinha-dashboard-compact-view'

const editableJobColumns: Array<{ value: EditableJobColumn; label: string }> = [
  { value: 'date', label: 'Date' },
  { value: 'job_no', label: 'Job No' },
  { value: 'cx_name', label: 'Cx Name' },
  { value: 'contact_no', label: 'Contact No' },
  { value: 'job_amount', label: 'Job Amount' },
  { value: 'amount_received', label: 'Amount Received' },
  { value: 'received_date', label: 'Received Date' },
  { value: 'first_follow_up', label: '1st Follow-up' },
  { value: 'second_follow_up', label: '2nd Follow-up' },
  { value: 'status', label: 'Status' },
]

function avatarColor(name: string) {
  const colors = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed']
  return colors[name.charCodeAt(0) % colors.length]
}

function playNotificationSound() {
  try {
    const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextClass = window.AudioContext || audioWindow.webkitAudioContext
    if (!AudioContextClass) return

    const audioContext = new AudioContextClass()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(740, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(980, audioContext.currentTime + 0.12)
    gain.gain.setValueAtTime(0.001, audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28)

    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.3)
  } catch {
    // Browser autoplay settings can block sound until the user has interacted with the page.
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [editRequests, setEditRequests] = useState<EditRequest[]>([])
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'today' | 'all' | 'notifications'>('today')
  const [filterDate, setFilterDate] = useState(todayISO())
  const [showModal, setShowModal] = useState(false)
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [activeEditRequest, setActiveEditRequest] = useState<EditRequest | null>(null)
  const [requestJob, setRequestJob] = useState<Job | null>(null)
  const [requestColumn, setRequestColumn] = useState<EditableJobColumn>('contact_no')
  const [requestNote, setRequestNote] = useState('')
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestFeedback, setRequestFeedback] = useState('')
  const [requestSuccess, setRequestSuccess] = useState('')
  const [form, setForm] = useState<JobForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [compactView, setCompactView] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const notificationsLoadedRef = useRef(false)

  useEffect(() => {
    queueMicrotask(() => {
      setCompactView(window.localStorage.getItem(compactViewStorageKey) === 'true')
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: userProfile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error || !userProfile) {
        router.push('/login')
        return
      }

      if (userProfile.role === 'admin') {
        router.push('/admin')
        return
      }

      setProfile(userProfile)
      setLoading(false)
    }

    init()
  }, [router])

  const loadJobs = useCallback(async () => {
    if (!profile) return

    const query = supabase
      .from('jobs')
      .select('*')
      .eq('user_id', profile.id)
      .order('date', { ascending: false })

    if (activeTab === 'today') {
      query.lte('date', filterDate)
    }

    const { data } = await query
    setJobs(((data || []) as Job[]).map(normalizeJob))
  }, [profile, activeTab, filterDate])

  const loadRequests = useCallback(async () => {
    if (!profile) return

    const { data: session } = await supabase.auth.getSession()
    const response = await fetch('/api/edit-workflow', {
      headers: { Authorization: `Bearer ${session.session?.access_token || ''}` },
    })
    const data = await response.json().catch(() => null)

    setEditRequests((data?.requests || []) as EditRequest[])
    setNotifications((data?.notifications || []) as UserNotification[])
    notificationsLoadedRef.current = true
  }, [profile])

  const loadNotifications = useCallback(async () => {
    await loadRequests()
  }, [loadRequests])

  useEffect(() => {
    if (!profile) return
    queueMicrotask(() => {
      void loadJobs()
      void loadRequests()
      void loadNotifications()
    })

    const channel = supabase
      .channel(`jobs-${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${profile.id}`,
      }, loadJobs)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'app_settings',
        filter: 'key=eq.edit_workflow_state',
      }, () => {
        if (notificationsLoadedRef.current) {
          playNotificationSound()
        }
        void loadNotifications()
      })
      .subscribe()

    const interval = window.setInterval(() => {
      void loadNotifications()
    }, 15_000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [profile, loadJobs, loadNotifications, loadRequests])

  const summary = useMemo(() => {
    if (!profile) return null
    return buildUserSummaries([profile], jobs, filterDate)[0]
  }, [profile, jobs, filterDate])

  const allDisplayJobs = useMemo(() => {
    if (activeTab === 'all') return jobs
    return summary ? [...summary.todayJobs, ...summary.carryForwardJobs] : []
  }, [activeTab, jobs, summary])

  const unreadNotificationCount = notifications.filter((notification) => !notification.read_at).length
  const pendingRequestCount = editRequests.filter((request) => request.status === 'pending').length

  const openAddModal = () => {
    setEditJob(null)
    setActiveEditRequest(null)
    setForm({
      ...emptyForm,
      date: filterDate,
      received_date: filterDate,
      first_follow_up: filterDate,
      second_follow_up: addDaysISO(filterDate, 7),
    })
    setFormError('')
    setShowModal(true)
  }

  const openApprovedEditModal = (job: Job, request: EditRequest) => {
    setEditJob(job)
    setActiveEditRequest(request)
    setForm({
      date: job.date,
      job_no: job.job_no,
      cx_name: job.cx_name,
      contact_no: job.contact_no,
      job_amount: String(job.job_amount),
      amount_received: String(job.amount_received),
      received_date: job.received_date || filterDate,
      first_follow_up: job.first_follow_up || '',
      second_follow_up: job.second_follow_up || '',
      status: job.status,
      action_require: job.action_require,
    })
    setFormError('')
    setShowModal(true)
  }

  const openEditRequestModal = (job: Job) => {
    const existingApproved = editRequests.find((request) => request.job_id === job.id && request.status === 'approved')
    if (existingApproved) {
      openApprovedEditModal(job, existingApproved)
      return
    }

    setRequestJob(job)
    setRequestColumn('contact_no')
    setRequestNote('')
    setRequestFeedback('')
    setRequestSuccess('')
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile) return

    setSaving(true)
    setFormError('')

    const jobAmount = Number(form.job_amount || 0)
    const amountReceived = Number(form.amount_received || 0)

    if (amountReceived > jobAmount) {
      setFormError('Amount received cannot be greater than job amount.')
      setSaving(false)
      return
    }

    const payload = {
      date: form.date,
      job_no: form.job_no.trim(),
      cx_name: form.cx_name.trim(),
      contact_no: form.contact_no.trim(),
      job_amount: jobAmount,
      amount_received: amountReceived,
      received_date: form.received_date || null,
      first_follow_up: form.first_follow_up || null,
      second_follow_up: form.second_follow_up || null,
      status: form.status,
      action_require: form.action_require,
    }

    const { error } = editJob
      ? await supabase.from('jobs').update(payload).eq('id', editJob.id)
      : await supabase.from('jobs').insert({ ...payload, user_id: profile.id })

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setShowModal(false)
    if (activeEditRequest) {
      const { data: session } = await supabase.auth.getSession()
      await fetch('/api/edit-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'complete', requestId: activeEditRequest.id }),
      })
    }
    setActiveEditRequest(null)
    await loadJobs()
    await loadRequests()
    await loadNotifications()
  }

  const handleEditRequestSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile || !requestJob) return

    setRequestSaving(true)
    setRequestFeedback('')

    const cleanNote = requestNote.trim()
    if (cleanNote.length < 3) {
      setRequestFeedback('Please add a short reason for the edit request.')
      setRequestSaving(false)
      return
    }

    const { data: session } = await supabase.auth.getSession()
    const response = await fetch('/api/edit-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token || ''}`,
      },
      body: JSON.stringify({
        action: 'request_edit',
        jobId: requestJob.id,
        requestedColumn: requestColumn,
        message: cleanNote,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setRequestFeedback(data?.error || 'Could not send request.')
      setRequestSaving(false)
      return
    }

    setRequestSaving(false)
    setRequestJob(null)
    setRequestSuccess('Edit request sent to admin successfully.')
    await loadRequests()
  }

  const markNotificationRead = async (notification: UserNotification) => {
    if (notification.read_at) return

    const { data: session } = await supabase.auth.getSession()
    await fetch('/api/edit-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token || ''}`,
      },
      body: JSON.stringify({ action: 'mark_read', notificationId: notification.id }),
    })
    await loadNotifications()
  }

  const handleNotificationAction = async (notification: UserNotification) => {
    await markNotificationRead(notification)

    if (!notification.related_request_id) return
    const request = editRequests.find((item) => item.id === notification.related_request_id)
    if (!request || request.status !== 'approved') return

    const job = jobs.find((item) => item.id === request.job_id)
    if (job) {
      openApprovedEditModal(job, request)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleCompactViewChange = (checked: boolean) => {
    setCompactView(checked)
    window.localStorage.setItem(compactViewStorageKey, String(checked))
  }

  if (loading || !summary || !profile) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>Loading your dashboard...</p>
      </div>
    )
  }

  return (
    <div className={`main-layout ${compactView ? 'compact-work-view' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">TS</div>
          <div>
            <div className="brand-title">Three Sinha</div>
            <div className="brand-subtitle">Follow-up System</div>
          </div>
        </div>

        <div className="sidebar-profile">
          <div className="avatar" style={{ background: avatarColor(profile.username) }}>
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="profile-name">{profile.username}</div>
            <div className="online-row"><span className="notification-dot" />Online</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={`sidebar-nav-item ${activeTab === 'today' ? 'active' : ''}`} onClick={() => setActiveTab('today')}>
            Today & Carry Forward
          </button>
          <button className={`sidebar-nav-item ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
            All Jobs
          </button>
          <button className={`sidebar-nav-item ${activeTab === 'notifications' ? 'active' : ''}`} onClick={() => setActiveTab('notifications')}>
            <span>Notifications</span>
            {unreadNotificationCount > 0 && <span className="nav-count">{unreadNotificationCount}</span>}
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="btn-secondary" onClick={() => setShowLogoutConfirm(true)}>Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{activeTab === 'today' ? 'Daily Dashboard' : 'All Jobs'}</h1>
            <p>{longDisplayDate(filterDate)}</p>
          </div>
          <div className="toolbar-row">
            <label className="view-toggle">
              <input
                type="checkbox"
                checked={compactView}
                onChange={(event) => handleCompactViewChange(event.target.checked)}
              />
              <span>Compact view</span>
            </label>
            {pendingRequestCount > 0 && <span className="badge badge-pending">{pendingRequestCount} edit pending</span>}
            {activeTab === 'today' && (
              <input className="form-input compact-input" type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
            )}
            <button className="btn-primary" onClick={openAddModal}>Add Job</button>
          </div>
        </header>

        <div className="page-content">
          {requestSuccess && <div className="alert success">{requestSuccess}</div>}

          {activeTab === 'today' && (
            <>
              <div className="grid-4">
                <StatCard label="Jobs Today" value={String(summary.totalJobsToday)} color="blue" />
                <StatCard label="Expected Today" value={`Rs. ${formatMoney(summary.expectedToday)}`} color="amber" />
                <StatCard label="Collected Today" value={`Rs. ${formatMoney(summary.collectedToday)}`} color="emerald" />
                <StatCard label="Carry Forward" value={`Rs. ${formatMoney(summary.closingCarryForward)}`} color="rose" />
                <StatCard label="Opening Carry" value={`Rs. ${formatMoney(summary.openingCarryForward)}`} color="purple" />
                <StatCard label="Today Outstanding" value={`Rs. ${formatMoney(summary.todayOutstanding)}`} color="rose" />
                <StatCard label="Follow-ups Today" value={String(summary.followUpsToday.length)} color="blue" />
                <StatCard label="Overdue" value={String(summary.overdueCount)} color="rose" />
              </div>
              <JobTable
                title={`Jobs and carry-forward for ${displayDate(filterDate)}`}
                jobs={allDisplayJobs}
                reportDate={filterDate}
                onEdit={openEditRequestModal}
                editRequests={editRequests}
              />
            </>
          )}

          {activeTab === 'all' && (
            <JobTable
              title="All Jobs History"
              jobs={allDisplayJobs}
              reportDate={filterDate}
              onEdit={openEditRequestModal}
              editRequests={editRequests}
            />
          )}

          {activeTab === 'notifications' && (
            <NotificationsPanel
              notifications={notifications}
              editRequests={editRequests}
              jobs={jobs}
              onAction={handleNotificationAction}
              onMarkRead={markNotificationRead}
            />
          )}
        </div>
      </main>

      {showModal && (
        <JobModal
          editJob={editJob}
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          allowedColumn={activeEditRequest?.requested_column || null}
          onClose={() => {
            setShowModal(false)
            setActiveEditRequest(null)
          }}
          onSubmit={handleSubmit}
        />
      )}

      {requestJob && (
        <EditRequestModal
          job={requestJob}
          column={requestColumn}
          setColumn={setRequestColumn}
          note={requestNote}
          setNote={setRequestNote}
          feedback={requestFeedback}
          saving={requestSaving}
          onClose={() => setRequestJob(null)}
          onSubmit={handleEditRequestSubmit}
        />
      )}

      {showLogoutConfirm && (
        <ConfirmDialog
          title="Sign out?"
          message="You will be returned to the login screen."
          confirmLabel={loggingOut ? 'Signing out...' : 'Yes, sign out'}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
          disabled={loggingOut}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`stat-card ${color}`}>
      <p>{label}</p>
      <strong className="amount">{value}</strong>
    </div>
  )
}

function JobTable({
  title,
  jobs,
  reportDate,
  onEdit,
  editRequests,
}: {
  title: string
  jobs: Job[]
  reportDate: string
  onEdit: (job: Job) => void
  editRequests: EditRequest[]
}) {
  return (
    <div className="glass-card table-card">
      <div className="table-header">
        <h2>{title}</h2>
        <span className="badge badge-none">{jobs.length}</span>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">No jobs found for this view.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job No</th>
                <th>Cx Name</th>
                <th>Contact</th>
                <th>Job Amount</th>
                <th>Received</th>
                <th>Balance</th>
                <th>Received Date</th>
                <th>1st Follow-up</th>
                <th>2nd Follow-up</th>
                <th>Status</th>
                <th>Action Required</th>
                <th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const action = getActionStatus(job, reportDate)
                const approvedRequest = editRequests.find((request) => request.job_id === job.id && request.status === 'approved')
                const pendingRequest = editRequests.find((request) => request.job_id === job.id && request.status === 'pending')
                return (
                  <tr key={job.id}>
                    <td>{displayDate(job.date)}</td>
                    <td className="link-text">{job.job_no}</td>
                    <td>{job.cx_name}</td>
                    <td>{job.contact_no}</td>
                    <td className="amount">Rs. {formatMoney(job.job_amount)}</td>
                    <td className="amount success-text">Rs. {formatMoney(job.amount_received)}</td>
                    <td className={`amount ${job.remaining_amount > 0 ? 'danger-text' : 'success-text'}`}>Rs. {formatMoney(job.remaining_amount)}</td>
                    <td>{displayDate(job.received_date)}</td>
                    <td>{displayDate(job.first_follow_up)}</td>
                    <td>{displayDate(job.second_follow_up)}</td>
                    <td><span className={`badge badge-${job.status.toLowerCase()}`}>{job.status}</span></td>
                    <td><span className={`badge ${action === 'OVERDUE' ? 'badge-overdue' : 'badge-none'}`}>{action}</span></td>
                    <td>
                      <div className="button-row compact">
                        <button className="btn-secondary icon-btn" onClick={() => onEdit(job)} disabled={Boolean(pendingRequest && !approvedRequest)}>
                          {approvedRequest ? 'Edit' : pendingRequest ? 'Pending' : 'Request'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function JobModal({
  editJob,
  form,
  setForm,
  formError,
  saving,
  allowedColumn,
  onClose,
  onSubmit,
}: {
  editJob: Job | null
  form: JobForm
  setForm: (form: JobForm) => void
  formError: string
  saving: boolean
  allowedColumn: EditableJobColumn | null
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const remaining = Math.max(0, Number(form.job_amount || 0) - Number(form.amount_received || 0))
  const canEdit = (column: EditableJobColumn) => !editJob || allowedColumn === column

  const handleDateChange = (date: string) => {
    setForm({
      ...form,
      date,
      first_follow_up: editJob ? form.first_follow_up : date,
      second_follow_up: editJob ? form.second_follow_up : addDaysISO(date, 7),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="section-header">
          <h2>{editJob ? 'Approved Job Edit' : 'Add Job'}</h2>
          <button className="btn-secondary icon-btn" onClick={onClose}>Close</button>
        </div>

        {editJob && allowedColumn && (
          <div className="alert success">Admin approved editing only: {editableJobColumns.find((column) => column.value === allowedColumn)?.label}</div>
        )}

        {formError && <div className="alert error">{formError}</div>}

        <form onSubmit={onSubmit}>
          <div className="grid-2">
            <Field label="Date"><input className="form-input" type="date" value={form.date} onChange={(event) => handleDateChange(event.target.value)} required disabled={!canEdit('date')} /></Field>
            <Field label="Job No"><input className="form-input" value={form.job_no} onChange={(event) => setForm({ ...form, job_no: event.target.value })} required disabled={!canEdit('job_no')} /></Field>
            <Field label="Cx Name"><input className="form-input" value={form.cx_name} onChange={(event) => setForm({ ...form, cx_name: event.target.value })} required disabled={!canEdit('cx_name')} /></Field>
            <Field label="Contact No"><input className="form-input" value={form.contact_no} onChange={(event) => setForm({ ...form, contact_no: event.target.value })} required disabled={!canEdit('contact_no')} /></Field>
            <Field label="Job Amount"><input className="form-input" type="number" min="0" step="0.01" value={form.job_amount} onChange={(event) => setForm({ ...form, job_amount: event.target.value })} required disabled={!canEdit('job_amount')} /></Field>
            <Field label="Amount Received"><input className="form-input" type="number" min="0" step="0.01" value={form.amount_received} onChange={(event) => setForm({ ...form, amount_received: event.target.value })} disabled={!canEdit('amount_received')} /></Field>
            <Field label="Received Date"><input className="form-input" type="date" value={form.received_date} onChange={(event) => setForm({ ...form, received_date: event.target.value })} disabled={!canEdit('received_date')} /></Field>
            <Field label="1st Follow-up"><input className="form-input" type="date" value={form.first_follow_up} onChange={(event) => setForm({ ...form, first_follow_up: event.target.value })} disabled={!canEdit('first_follow_up')} /></Field>
            <Field label="2nd Follow-up"><input className="form-input" type="date" value={form.second_follow_up} onChange={(event) => setForm({ ...form, second_follow_up: event.target.value })} disabled={!canEdit('second_follow_up')} /></Field>
            <Field label="Status">
              <select className="form-input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as JobStatus })} disabled={!canEdit('status')}>
                <option value="Pending">Pending</option>
                <option value="Positive">Positive</option>
                <option value="Negative">Negative</option>
              </select>
            </Field>
            <Field label="Action Required">
              <select className="form-input" value={form.action_require} onChange={(event) => setForm({ ...form, action_require: event.target.value })} disabled={!canEdit('action_require')}>
                <option value="NONE">NONE</option>
                <option value="CALL">CALL</option>
                <option value="VISIT">VISIT</option>
                <option value="EMAIL">EMAIL</option>
                <option value="FOLLOW UP">FOLLOW UP</option>
                <option value="OVERDUE">OVERDUE</option>
              </select>
            </Field>
          </div>

          <div className="live-total">
            <span>Balance</span>
            <strong>Rs. {formatMoney(remaining)}</strong>
          </div>

          <div className="button-row end">
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editJob ? 'Update Job' : 'Add Job'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditRequestModal({
  job,
  column,
  setColumn,
  note,
  setNote,
  feedback,
  saving,
  onClose,
  onSubmit,
}: {
  job: Job
  column: EditableJobColumn
  setColumn: (column: EditableJobColumn) => void
  note: string
  setNote: (note: string) => void
  feedback: string
  saving: boolean
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box small-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-header">
          <h2>Request Job Edit</h2>
          <button className="btn-secondary icon-btn" onClick={onClose}>Close</button>
        </div>
        <div className="request-summary">
          <strong>{job.job_no}</strong>
          <span>{job.cx_name}</span>
        </div>
        {feedback && <div className="alert error">{feedback}</div>}
        <form onSubmit={onSubmit}>
          <Field label="Column to edit">
            <select className="form-input" value={column} onChange={(event) => setColumn(event.target.value as EditableJobColumn)}>
              {editableJobColumns.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Message to admin">
            <textarea
              className="form-input textarea-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Explain what needs to be corrected and why."
              required
            />
          </Field>
          <div className="button-row end">
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={saving}>{saving ? 'Sending...' : 'Send Request'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NotificationsPanel({
  notifications,
  editRequests,
  jobs,
  onAction,
  onMarkRead,
}: {
  notifications: UserNotification[]
  editRequests: EditRequest[]
  jobs: Job[]
  onAction: (notification: UserNotification) => void
  onMarkRead: (notification: UserNotification) => void
}) {
  if (notifications.length === 0) {
    return <div className="glass-card empty-state">No notifications yet.</div>
  }

  return (
    <section className="narrow-panel">
      <h2 className="section-title">Notifications</h2>
      <div className="notification-list">
        {notifications.map((notification) => {
          const request = notification.related_request_id
            ? editRequests.find((item) => item.id === notification.related_request_id)
            : null
          const job = request ? jobs.find((item) => item.id === request.job_id) : null
          const canApply = request?.status === 'approved' && Boolean(job)

          return (
            <div key={notification.id} className={`glass-card notification-card ${notification.read_at ? '' : 'unread'}`}>
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                {request && (
                  <span className="muted-text">Field: {editableJobColumns.find((item) => item.value === request.requested_column)?.label}</span>
                )}
              </div>
              <div className="button-row compact">
                {canApply && <button className="btn-primary icon-btn" onClick={() => onAction(notification)}>Apply edit</button>}
                {!notification.read_at && <button className="btn-secondary icon-btn" onClick={() => onMarkRead(notification)}>Read</button>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  disabled,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box confirm-box" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="button-row end">
          <button className="btn-secondary" onClick={onCancel} disabled={disabled}>No</button>
          <button className="btn-danger" onClick={onConfirm} disabled={disabled}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}
