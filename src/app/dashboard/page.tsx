'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  Job,
  JobStatus,
  Profile,
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
  first_follow_up: '',
  second_follow_up: '',
  status: 'Pending',
  action_require: 'NONE',
}

const compactViewStorageKey = 'three-sinha-dashboard-compact-view'

function avatarColor(name: string) {
  const colors = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed']
  return colors[name.charCodeAt(0) % colors.length]
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'today' | 'all'>('today')
  const [filterDate, setFilterDate] = useState(todayISO())
  const [showModal, setShowModal] = useState(false)
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [form, setForm] = useState<JobForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [compactView, setCompactView] = useState(false)

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

  useEffect(() => {
    if (!profile) return
    queueMicrotask(() => {
      void loadJobs()
    })

    const channel = supabase
      .channel(`jobs-${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'jobs',
        filter: `user_id=eq.${profile.id}`,
      }, loadJobs)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile, loadJobs])

  const summary = useMemo(() => {
    if (!profile) return null
    return buildUserSummaries([profile], jobs, filterDate)[0]
  }, [profile, jobs, filterDate])

  const allDisplayJobs = useMemo(() => {
    if (activeTab === 'all') return jobs
    return summary ? [...summary.todayJobs, ...summary.carryForwardJobs] : []
  }, [activeTab, jobs, summary])

  const openAddModal = () => {
    setEditJob(null)
    setForm({ ...emptyForm, date: filterDate, received_date: filterDate })
    setFormError('')
    setShowModal(true)
  }

  const openEditModal = (job: Job) => {
    setEditJob(job)
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
    await loadJobs()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('jobs').delete().eq('id', id)
    setDeleteConfirm(null)
    await loadJobs()
  }

  const handleLogout = async () => {
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
        </nav>

        <div className="sidebar-footer">
          <button className="btn-secondary" onClick={handleLogout}>Sign Out</button>
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
            {activeTab === 'today' && (
              <input className="form-input compact-input" type="date" value={filterDate} onChange={(event) => setFilterDate(event.target.value)} />
            )}
            <button className="btn-primary" onClick={openAddModal}>Add Job</button>
          </div>
        </header>

        <div className="page-content">
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
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleteConfirm={deleteConfirm}
                setDeleteConfirm={setDeleteConfirm}
              />
            </>
          )}

          {activeTab === 'all' && (
            <JobTable
              title="All Jobs History"
              jobs={allDisplayJobs}
              reportDate={filterDate}
              onEdit={openEditModal}
              onDelete={handleDelete}
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
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
          onClose={() => setShowModal(false)}
          onSubmit={handleSubmit}
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
  onDelete,
  deleteConfirm,
  setDeleteConfirm,
}: {
  title: string
  jobs: Job[]
  reportDate: string
  onEdit: (job: Job) => void
  onDelete: (id: string) => void
  deleteConfirm: string | null
  setDeleteConfirm: (id: string | null) => void
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
                        <button className="btn-secondary icon-btn" onClick={() => onEdit(job)} title="Edit job">Edit</button>
                        {deleteConfirm === job.id ? (
                          <>
                            <button className="btn-danger icon-btn" onClick={() => onDelete(job.id)}>Yes</button>
                            <button className="btn-secondary icon-btn" onClick={() => setDeleteConfirm(null)}>No</button>
                          </>
                        ) : (
                          <button className="btn-danger icon-btn" onClick={() => setDeleteConfirm(job.id)} title="Delete job">Delete</button>
                        )}
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
  onClose,
  onSubmit,
}: {
  editJob: Job | null
  form: JobForm
  setForm: (form: JobForm) => void
  formError: string
  saving: boolean
  onClose: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  const remaining = Math.max(0, Number(form.job_amount || 0) - Number(form.amount_received || 0))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="section-header">
          <h2>{editJob ? 'Edit Job' : 'Add Job'}</h2>
          <button className="btn-secondary icon-btn" onClick={onClose}>Close</button>
        </div>

        {formError && <div className="alert error">{formError}</div>}

        <form onSubmit={onSubmit}>
          <div className="grid-2">
            <Field label="Date"><input className="form-input" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></Field>
            <Field label="Job No"><input className="form-input" value={form.job_no} onChange={(event) => setForm({ ...form, job_no: event.target.value })} required /></Field>
            <Field label="Cx Name"><input className="form-input" value={form.cx_name} onChange={(event) => setForm({ ...form, cx_name: event.target.value })} required /></Field>
            <Field label="Contact No"><input className="form-input" value={form.contact_no} onChange={(event) => setForm({ ...form, contact_no: event.target.value })} required /></Field>
            <Field label="Job Amount"><input className="form-input" type="number" min="0" step="0.01" value={form.job_amount} onChange={(event) => setForm({ ...form, job_amount: event.target.value })} required /></Field>
            <Field label="Amount Received"><input className="form-input" type="number" min="0" step="0.01" value={form.amount_received} onChange={(event) => setForm({ ...form, amount_received: event.target.value })} /></Field>
            <Field label="Received Date"><input className="form-input" type="date" value={form.received_date} onChange={(event) => setForm({ ...form, received_date: event.target.value })} /></Field>
            <Field label="1st Follow-up"><input className="form-input" type="date" value={form.first_follow_up} onChange={(event) => setForm({ ...form, first_follow_up: event.target.value })} /></Field>
            <Field label="2nd Follow-up"><input className="form-input" type="date" value={form.second_follow_up} onChange={(event) => setForm({ ...form, second_follow_up: event.target.value })} /></Field>
            <Field label="Status">
              <select className="form-input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as JobStatus })}>
                <option value="Pending">Pending</option>
                <option value="Positive">Positive</option>
                <option value="Negative">Negative</option>
              </select>
            </Field>
            <Field label="Action Required">
              <select className="form-input" value={form.action_require} onChange={(event) => setForm({ ...form, action_require: event.target.value })}>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}
