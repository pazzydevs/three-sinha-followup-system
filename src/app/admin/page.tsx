'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  EditRequest,
  Job,
  Profile,
  UserSummary,
  buildReportPayload,
  buildUserSummaries,
  displayDate,
  formatMoney,
  getActionStatus,
  longDisplayDate,
  normalizeJob,
  todayISO,
} from '@/lib/followup'

type N8nConfig = {
  webhookUrl: string
  testWebhookUrl: string
  httpMethod: 'GET' | 'POST'
  emailTo: string
  workflowName: string
  enabled: boolean
}

type AdminTab = 'overview' | 'users' | 'inquiries' | 'report' | 'n8n'

const defaultN8nConfig: N8nConfig = {
  webhookUrl: process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || '',
  testWebhookUrl: '',
  httpMethod: 'POST',
  emailTo: '',
  workflowName: 'Daily Follow-up Report',
  enabled: true,
}

const n8nStorageKey = 'three-sinha-n8n-config'
const adminCompactViewStorageKey = 'three-sinha-admin-compact-view'

function avatarColor(name: string) {
  const colors = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#be185d']
  return colors[name.charCodeAt(0) % colors.length]
}

function getAdminTitle(tab: AdminTab) {
  if (tab === 'overview') return 'Company Overview'
  if (tab === 'users') return 'Manage Users'
  if (tab === 'inquiries') return 'User Inquiries'
  if (tab === 'n8n') return 'n8n Configuration'
  return 'Daily Report'
}

function isSuccessMessage(message: string) {
  const lower = message.toLowerCase()
  return lower.includes('success') || lower.includes('saved')
}

function inquiryColumnLabel(column: string) {
  const labels: Record<string, string> = {
    date: 'Date',
    job_no: 'Job No',
    cx_name: 'Cx Name',
    contact_no: 'Contact No',
    job_amount: 'Job Amount',
    amount_received: 'Amount Received',
    received_date: 'Received Date',
    first_follow_up: '1st Follow-up',
    second_follow_up: '2nd Follow-up',
    status: 'Status',
    action_require: 'Action Required',
  }

  return labels[column] || column
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'positive') return 'badge-positive'
  if (normalized === 'negative') return 'badge-negative'
  if (normalized === 'pending') return 'badge-pending'
  return 'badge-none'
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
    oscillator.frequency.setValueAtTime(620, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(900, audioContext.currentTime + 0.16)
    gain.gain.setValueAtTime(0.001, audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28)

    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.3)
  } catch {
    // Browser autoplay settings can block sound until the user interacts with the page.
  }
}

export default function AdminPage() {
  const router = useRouter()
  const [adminProfile, setAdminProfile] = useState<Profile | null>(null)
  const [users, setUsers] = useState<Profile[]>([])
  const [allJobs, setAllJobs] = useState<Job[]>([])
  const [editRequests, setEditRequests] = useState<EditRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')
  const [reportDate, setReportDate] = useState(todayISO())
  const [sendingReport, setSendingReport] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const [reportPreview, setReportPreview] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '' })
  const [addingUser, setAddingUser] = useState(false)
  const [addUserError, setAddUserError] = useState('')
  const [addUserSuccess, setAddUserSuccess] = useState('')
  const [editingUser, setEditingUser] = useState<Profile | null>(null)
  const [editUserForm, setEditUserForm] = useState({ username: '', email: '', password: '' })
  const [updatingUser, setUpdatingUser] = useState(false)
  const [userActionError, setUserActionError] = useState('')
  const [userActionSuccess, setUserActionSuccess] = useState('')
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [n8nConfig, setN8nConfig] = useState<N8nConfig>(defaultN8nConfig)
  const [savingN8nConfig, setSavingN8nConfig] = useState(false)
  const [testingN8n, setTestingN8n] = useState(false)
  const [n8nConfigMessage, setN8nConfigMessage] = useState('')
  const [compactView, setCompactView] = useState(false)
  const [adminResponses, setAdminResponses] = useState<Record<string, string>>({})
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [inquiriesLoaded, setInquiriesLoaded] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      setCompactView(window.localStorage.getItem(adminCompactViewStorageKey) === 'true')
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error || !profile || profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }

      setAdminProfile(profile)
      setLoading(false)
    }

    init()
  }, [router])

  const loadData = useCallback(async () => {
    if (!adminProfile) return

    const [{ data: profiles }, { data: jobs }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'user').order('username'),
      supabase.from('jobs').select('*').lte('date', reportDate).order('date', { ascending: false }),
    ])

    setUsers((profiles || []) as Profile[])
    setAllJobs(((jobs || []) as Job[]).map(normalizeJob))
  }, [adminProfile, reportDate])

  const loadEditRequests = useCallback(async () => {
    if (!adminProfile) return

    const { data: session } = await supabase.auth.getSession()
    const response = await fetch('/api/edit-workflow', {
      headers: { Authorization: `Bearer ${session.session?.access_token || ''}` },
    })
    const data = await response.json().catch(() => null)

    setEditRequests((data?.requests || []) as EditRequest[])
    setInquiriesLoaded(true)
  }, [adminProfile])

  const loadN8nConfig = useCallback(async () => {
    const storedConfig = window.localStorage.getItem(n8nStorageKey)
    if (storedConfig) {
      try {
        setN8nConfig({ ...defaultN8nConfig, ...JSON.parse(storedConfig) })
      } catch {
        window.localStorage.removeItem(n8nStorageKey)
      }
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'n8n_config')
      .maybeSingle()

    if (!error && data?.value && typeof data.value === 'object') {
      const remoteConfig = { ...defaultN8nConfig, ...(data.value as Partial<N8nConfig>) }
      setN8nConfig(remoteConfig)
      window.localStorage.setItem(n8nStorageKey, JSON.stringify(remoteConfig))
    }
  }, [])

  useEffect(() => {
    if (!adminProfile) return
    queueMicrotask(() => {
      void loadData()
      void loadEditRequests()
      void loadN8nConfig()
    })

    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadData)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_settings', filter: 'key=eq.edit_workflow_state' }, () => {
        if (inquiriesLoaded) {
          playNotificationSound()
        }
        void loadEditRequests()
      })
      .subscribe()

    const interval = window.setInterval(() => {
      void loadEditRequests()
    }, 15_000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [adminProfile, inquiriesLoaded, loadData, loadEditRequests, loadN8nConfig])

  const summaries = useMemo(() => buildUserSummaries(users, allJobs, reportDate), [users, allJobs, reportDate])
  const selectedSummary = summaries.find((summary) => summary.profile.id === selectedUserId) || null

  const companyTotals = useMemo(() => ({
    jobs: summaries.reduce((sum, user) => sum + user.totalJobsToday, 0),
    expected: summaries.reduce((sum, user) => sum + user.expectedToday, 0),
    collected: summaries.reduce((sum, user) => sum + user.collectedToday, 0),
    openingCarry: summaries.reduce((sum, user) => sum + user.openingCarryForward, 0),
    closingCarry: summaries.reduce((sum, user) => sum + user.closingCarryForward, 0),
    followUps: summaries.reduce((sum, user) => sum + user.followUpsToday.length, 0),
    overdue: summaries.reduce((sum, user) => sum + user.overdueCount, 0),
  }), [summaries])
  const pendingInquiryCount = editRequests.filter((request) => request.status === 'pending').length

  const handlePreviewReport = () => {
    setReportPreview(buildReportPayload(summaries, reportDate).reportText)
  }

  const handleSendReport = async () => {
    setSendingReport(true)
    setReportMessage('')

    try {
      const payload = buildReportPayload(summaries, reportDate)
      const webhookUrl = (n8nConfig.webhookUrl || n8nConfig.testWebhookUrl).trim()
      const usingTestUrl = !n8nConfig.webhookUrl.trim() && Boolean(n8nConfig.testWebhookUrl.trim())

      if (!webhookUrl) {
        setReportMessage('Add a production or test n8n webhook URL first.')
        return
      }

      const { data: session } = await supabase.auth.getSession()
      const response = await fetch('/api/n8n/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          webhookUrl,
          method: n8nConfig.httpMethod,
          payload: {
            ...payload,
            delivery: {
              emailTo: n8nConfig.emailTo,
              workflowName: n8nConfig.workflowName,
            },
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setReportMessage(data?.error || `Report send failed with status ${response.status}.`)
        return
      }

      const data = await response.json().catch(() => null)
      setReportPreview(payload.reportText)
      const target = data?.usedWebhookUrl?.includes('/webhook-test/') || usingTestUrl ? 'test webhook' : 'production webhook'
      const method = data?.usedMethod ? ` using ${data.usedMethod}` : ''
      setReportMessage(`Report sent to n8n ${target}${method} successfully.`)
    } catch {
      setReportMessage('Report send failed. Please check the network and webhook.')
    } finally {
      setSendingReport(false)
    }
  }

  const handleSaveN8nConfig = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adminProfile) return

    setSavingN8nConfig(true)
    setN8nConfigMessage('')

    const cleanConfig = {
      ...n8nConfig,
      webhookUrl: n8nConfig.webhookUrl.trim(),
      testWebhookUrl: n8nConfig.testWebhookUrl.trim(),
      emailTo: n8nConfig.emailTo.trim(),
      workflowName: n8nConfig.workflowName.trim() || 'Daily Follow-up Report',
    }

    window.localStorage.setItem(n8nStorageKey, JSON.stringify(cleanConfig))

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'n8n_config',
        value: cleanConfig,
        updated_by: adminProfile.id,
      }, { onConflict: 'key' })

    if (error) {
      setN8nConfig(cleanConfig)
      setN8nConfigMessage('n8n configuration saved in this browser.')
    } else {
      setN8nConfig(cleanConfig)
      setN8nConfigMessage('n8n configuration saved.')
    }

    setSavingN8nConfig(false)
  }

  const handleTestN8nWebhook = async () => {
    const webhookUrl = (n8nConfig.testWebhookUrl || n8nConfig.webhookUrl).trim()
    setTestingN8n(true)
    setN8nConfigMessage('')

    if (!webhookUrl) {
      setN8nConfigMessage('Add the n8n webhook URL before testing.')
      setTestingN8n(false)
      return
    }

    try {
      const { data: session } = await supabase.auth.getSession()
      const response = await fetch('/api/n8n/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
        body: JSON.stringify({
          webhookUrl,
          method: n8nConfig.httpMethod,
          payload: {
            type: 'n8n_configuration_test',
            source: 'three-sinha-followup-system',
            workflowName: n8nConfig.workflowName,
            emailTo: n8nConfig.emailTo,
            sentAt: new Date().toISOString(),
          },
        }),
      })

      const data = await response.json().catch(() => null)
      setN8nConfigMessage(response.ok
        ? `n8n test sent successfully${data?.usedMethod ? ` using ${data.usedMethod}` : ''}.`
        : data?.error || `n8n test failed with status ${response.status}.`)
    } catch {
      setN8nConfigMessage('n8n test failed. Check the webhook URL.')
    } finally {
      setTestingN8n(false)
    }
  }

  const handleAddUser = async (event: React.FormEvent) => {
    event.preventDefault()
    setAddingUser(true)
    setAddUserError('')
    setAddUserSuccess('')
    setUserActionError('')
    setUserActionSuccess('')

    try {
      const trimmedUsername = newUser.username.trim().toLowerCase()
      const email = newUser.email.trim().toLowerCase() || `${trimmedUsername}@three-sinha.com`
      const { data: session } = await supabase.auth.getSession()

      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
        body: JSON.stringify({ username: trimmedUsername, password: newUser.password, email }),
      })

      const data = await response.json()
      if (!response.ok) {
        setAddUserError(data.error || 'Failed to create user.')
        return
      }

      setAddUserSuccess(`User "${trimmedUsername}" created successfully.`)
      setNewUser({ username: '', email: '', password: '' })
      await loadData()
    } catch {
      setAddUserError('Something went wrong while creating the user.')
    } finally {
      setAddingUser(false)
    }
  }

  const openEditUser = (user: Profile) => {
    setEditingUser(user)
    setEditUserForm({
      username: user.username,
      email: user.email || `${user.username}@three-sinha.com`,
      password: '',
    })
    setUserActionError('')
    setUserActionSuccess('')
  }

  const handleUpdateUser = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingUser) return

    setUpdatingUser(true)
    setUserActionError('')
    setUserActionSuccess('')

    try {
      const { data: session } = await supabase.auth.getSession()
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
        body: JSON.stringify(editUserForm),
      })
      const data = await response.json()

      if (!response.ok) {
        setUserActionError(data.error || 'Failed to update user.')
        return
      }

      setUserActionSuccess(`User "${editUserForm.username}" updated successfully.`)
      setEditingUser(null)
      setEditUserForm({ username: '', email: '', password: '' })
      await loadData()
    } catch {
      setUserActionError('Something went wrong while updating the user.')
    } finally {
      setUpdatingUser(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    setUserActionError('')
    setUserActionSuccess('')

    try {
      const { data: session } = await supabase.auth.getSession()
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.session?.access_token || ''}`,
        },
      })
      const data = await response.json()

      if (!response.ok) {
        setUserActionError(data.error || 'Failed to delete user.')
        return
      }

      setUserActionSuccess('User deleted successfully.')
      setDeleteUserId(null)
      if (editingUser?.id === userId) {
        setEditingUser(null)
      }
      await loadData()
    } catch {
      setUserActionError('Something went wrong while deleting the user.')
    }
  }

  const handleInquiryDecision = async (request: EditRequest, status: 'approved' | 'rejected') => {
    if (!adminProfile) return

    const response = (adminResponses[request.id] || '').trim()
    const { data: session } = await supabase.auth.getSession()
    const result = await fetch('/api/edit-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token || ''}`,
      },
      body: JSON.stringify({
        action: 'decision',
        requestId: request.id,
        status,
        adminResponse: response,
      }),
    })

    if (!result.ok) return

    setAdminResponses((current) => ({ ...current, [request.id]: '' }))
    await loadEditRequests()
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleCompactViewChange = (checked: boolean) => {
    setCompactView(checked)
    window.localStorage.setItem(adminCompactViewStorageKey, String(checked))
  }

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>Loading admin panel...</p>
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
            <div className="brand-subtitle">Admin Control Panel</div>
          </div>
        </div>

        <div className="sidebar-profile">
          <div className="avatar" style={{ background: '#d97706' }}>A</div>
          <div>
            <div className="profile-name">Admin</div>
            <div className="online-row"><span className="notification-dot" />Online</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'users', label: 'Manage Users' },
            { key: 'inquiries', label: 'User Inquiries' },
            { key: 'report', label: 'Daily Report' },
            { key: 'n8n', label: 'n8n Configuration' },
          ].map((item) => (
            <button
              key={item.key}
              className={`sidebar-nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key as typeof activeTab)}
            >
              <span>{item.label}</span>
              {item.key === 'inquiries' && pendingInquiryCount > 0 && <span className="nav-count">{pendingInquiryCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="btn-secondary" onClick={() => setShowLogoutConfirm(true)}>Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{getAdminTitle(activeTab)}</h1>
            <p>{longDisplayDate(reportDate)}</p>
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
            <input className="form-input compact-input" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
            <button className="btn-secondary" onClick={loadData}>Refresh</button>
          </div>
        </header>

        <div className="page-content">
          {activeTab === 'overview' && (
            <>
              <CompanyStats totals={companyTotals} />
              <h2 className="section-title">Staff performance for {displayDate(reportDate)}</h2>

              {summaries.length === 0 ? (
                <div className="glass-card empty-state">No staff accounts found.</div>
              ) : (
                <>
                  <div className="summary-grid">
                    {summaries.map((summary) => (
                      <StaffSummaryCard
                        key={summary.profile.id}
                        summary={summary}
                        selected={selectedSummary?.profile.id === summary.profile.id}
                        onSelect={() => setSelectedUserId(selectedSummary?.profile.id === summary.profile.id ? null : summary.profile.id)}
                      />
                    ))}
                  </div>

                  {selectedSummary && (
                    <AdminUserDetail
                      summary={selectedSummary}
                      reportDate={reportDate}
                      onClose={() => setSelectedUserId(null)}
                    />
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'users' && (
            <section className="narrow-panel">
              <div className="section-header">
                <h2 className="section-title">Staff Accounts</h2>
                <button className="btn-primary" onClick={() => setShowAddUser(true)}>Add User</button>
              </div>

              {userActionError && <div className="alert error">{userActionError}</div>}
              {userActionSuccess && <div className="alert success">{userActionSuccess}</div>}

              <div className="glass-card table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Jobs Today</th>
                      <th>Expected</th>
                      <th>Collected</th>
                      <th>Carry Forward</th>
                      <th>Credentials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((summary) => (
                      <tr key={summary.profile.id}>
                        <td>
                          <div className="identity-cell">
                            <div className="avatar small" style={{ background: avatarColor(summary.profile.username) }}>
                              {summary.profile.username.charAt(0).toUpperCase()}
                            </div>
                            <span>{summary.profile.username}</span>
                          </div>
                        </td>
                        <td>{summary.profile.email || `${summary.profile.username}@three-sinha.com`}</td>
                        <td>{summary.totalJobsToday}</td>
                        <td className="amount">Rs. {formatMoney(summary.expectedToday)}</td>
                        <td className="amount success-text">Rs. {formatMoney(summary.collectedToday)}</td>
                        <td className="amount danger-text">Rs. {formatMoney(summary.closingCarryForward)}</td>
                        <td>
                          <div className="button-row compact">
                            <button className="btn-secondary icon-btn" onClick={() => openEditUser(summary.profile)}>Edit</button>
                            {deleteUserId === summary.profile.id ? (
                              <>
                                <button className="btn-danger icon-btn" onClick={() => handleDeleteUser(summary.profile.id)}>Yes</button>
                                <button className="btn-secondary icon-btn" onClick={() => setDeleteUserId(null)}>No</button>
                              </>
                            ) : (
                              <button className="btn-danger icon-btn" onClick={() => setDeleteUserId(summary.profile.id)}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {showAddUser && (
                <div className="glass-card form-card">
                  <h3>Create Staff Account</h3>
                  {addUserError && <div className="alert error">{addUserError}</div>}
                  {addUserSuccess && <div className="alert success">{addUserSuccess}</div>}
                  <form onSubmit={handleAddUser}>
                    <div className="grid-2">
                      <div>
                        <label className="form-label">Username</label>
                        <input className="form-input" value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} required />
                      </div>
                      <div>
                        <label className="form-label">Email</label>
                        <input className="form-input" type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="Auto-created from username if blank" />
                      </div>
                      <div>
                        <label className="form-label">Password</label>
                        <input className="form-input" type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required minLength={8} />
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="btn-primary" disabled={addingUser}>{addingUser ? 'Creating...' : 'Create User'}</button>
                      <button className="btn-secondary" type="button" onClick={() => setShowAddUser(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              {editingUser && (
                <div className="glass-card form-card">
                  <div className="section-header">
                    <h3>Edit Staff Credentials</h3>
                    <button className="btn-secondary" type="button" onClick={() => setEditingUser(null)}>Close</button>
                  </div>
                  <form onSubmit={handleUpdateUser}>
                    <div className="grid-2">
                      <div>
                        <label className="form-label">Username</label>
                        <input className="form-input" value={editUserForm.username} onChange={(event) => setEditUserForm({ ...editUserForm, username: event.target.value })} required />
                      </div>
                      <div>
                        <label className="form-label">Email</label>
                        <input className="form-input" type="email" value={editUserForm.email} onChange={(event) => setEditUserForm({ ...editUserForm, email: event.target.value })} required />
                      </div>
                      <div>
                        <label className="form-label">New Password</label>
                        <input className="form-input" type="password" value={editUserForm.password} onChange={(event) => setEditUserForm({ ...editUserForm, password: event.target.value })} placeholder="Leave blank to keep current password" minLength={8} />
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="btn-primary" disabled={updatingUser}>{updatingUser ? 'Updating...' : 'Update Credentials'}</button>
                      <button className="btn-secondary" type="button" onClick={() => setEditingUser(null)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          )}

          {activeTab === 'inquiries' && (
            <section className="narrow-panel wide">
              <div className="section-header">
                <h2>User edit requests</h2>
                <span className="badge badge-pending">{pendingInquiryCount} pending</span>
              </div>

              {editRequests.length === 0 ? (
                <div className="glass-card empty-state">No user inquiries yet.</div>
              ) : (
                <div className="inquiry-list">
                  {editRequests.map((request) => {
                    const job = allJobs.find((item) => item.id === request.job_id)
                    const user = users.find((item) => item.id === request.user_id)

                    return (
                      <div key={request.id} className={`glass-card inquiry-card ${request.status}`}>
                        <div className="inquiry-topline">
                          <div>
                            <strong>{user?.username || 'User'} requested {inquiryColumnLabel(request.requested_column)}</strong>
                            <p>{job ? `${job.job_no} - ${job.cx_name}` : 'Job details unavailable'}</p>
                          </div>
                          <span className={`badge badge-${request.status === 'approved' ? 'positive' : request.status === 'rejected' ? 'negative' : request.status === 'completed' ? 'none' : 'pending'}`}>
                            {request.status}
                          </span>
                        </div>
                        <p className="inquiry-message">{request.message}</p>
                        {request.admin_response && <p className="muted-text">Admin note: {request.admin_response}</p>}

                        {request.status === 'pending' && (
                          <div className="inquiry-actions">
                            <textarea
                              className="form-input textarea-input"
                              value={adminResponses[request.id] || ''}
                              onChange={(event) => setAdminResponses({ ...adminResponses, [request.id]: event.target.value })}
                              placeholder="Optional message back to the user"
                            />
                            <div className="button-row end">
                              <button className="btn-secondary" onClick={() => handleInquiryDecision(request, 'rejected')}>Reject</button>
                              <button className="btn-primary" onClick={() => handleInquiryDecision(request, 'approved')}>Approve Edit</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'n8n' && (
            <section className="narrow-panel wide">
              <div className="glass-card form-card">
                <h2 className="section-title">n8n Configuration</h2>
                <form onSubmit={handleSaveN8nConfig}>
                  <div className="grid-2">
                    <div>
                      <label className="form-label">Production Webhook URL</label>
                      <input
                        className="form-input"
                        type="url"
                        value={n8nConfig.webhookUrl}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, webhookUrl: event.target.value })}
                        placeholder="https://n8n.example.com/webhook/..."
                      />
                    </div>
                    <div>
                      <label className="form-label">Test Webhook URL</label>
                      <input
                        className="form-input"
                        type="url"
                        value={n8nConfig.testWebhookUrl}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, testWebhookUrl: event.target.value })}
                        placeholder="https://n8n.example.com/webhook-test/..."
                      />
                    </div>
                    <div>
                      <label className="form-label">HTTP Method</label>
                      <select
                        className="form-input"
                        value={n8nConfig.httpMethod}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, httpMethod: event.target.value as 'GET' | 'POST' })}
                      >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Boss Email</label>
                      <input
                        className="form-input"
                        type="email"
                        value={n8nConfig.emailTo}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, emailTo: event.target.value })}
                        placeholder="boss@example.com"
                      />
                    </div>
                    <div>
                      <label className="form-label">Workflow Name</label>
                      <input
                        className="form-input"
                        value={n8nConfig.workflowName}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, workflowName: event.target.value })}
                      />
                    </div>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={n8nConfig.enabled}
                        onChange={(event) => setN8nConfig({ ...n8nConfig, enabled: event.target.checked })}
                      />
                      <span>Enable automatic daily delivery</span>
                    </label>
                  </div>

                  <div className="n8n-config-notes">
                    <div>
                      <span>Method</span>
                      <strong>{n8nConfig.httpMethod}</strong>
                    </div>
                    <div>
                      <span>Test Target</span>
                      <strong>{n8nConfig.testWebhookUrl ? 'Test URL' : 'Production URL'}</strong>
                    </div>
                    <div>
                      <span>Schedule</span>
                      <strong>6:00 PM Sri Lanka</strong>
                    </div>
                  </div>

                  <div className="button-row">
                    <button className="btn-primary" disabled={savingN8nConfig}>
                      {savingN8nConfig ? 'Saving...' : 'Save Configuration'}
                    </button>
                    <button className="btn-secondary" type="button" onClick={handleTestN8nWebhook} disabled={testingN8n}>
                      {testingN8n ? 'Testing...' : 'Test Webhook'}
                    </button>
                  </div>
                </form>
                {n8nConfigMessage && <div className={`alert ${isSuccessMessage(n8nConfigMessage) ? 'success' : 'error'}`}>{n8nConfigMessage}</div>}
              </div>
            </section>
          )}

          {activeTab === 'report' && (
            <section className="narrow-panel wide">
              <div className="glass-card form-card">
                <h2 className="section-title">Report to Boss</h2>
                <p className="muted-text">This report includes each user separately, today&apos;s new jobs, today&apos;s follow-ups, collections, and balances to carry into tomorrow.</p>
                <CompanyStats totals={companyTotals} compact />
                <div className="button-row">
                  <button className="btn-secondary" onClick={handlePreviewReport}>Preview Report</button>
                  <button className="btn-success" onClick={handleSendReport} disabled={sendingReport}>
                    {sendingReport ? 'Sending...' : 'Send to n8n'}
                  </button>
                </div>
                {reportMessage && <div className={`alert ${reportMessage.includes('success') ? 'success' : 'error'}`}>{reportMessage}</div>}
              </div>

              {reportPreview && (
                <div className="glass-card form-card">
                  <div className="section-header">
                    <h3>Report Preview</h3>
                    <button className="btn-secondary" onClick={() => setReportPreview('')}>Close</button>
                  </div>
                  <pre className="report-box">{reportPreview}</pre>
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {showLogoutConfirm && (
        <ConfirmDialog
          title="Sign out?"
          message="You will be returned to the login screen."
          confirmLabel={loggingOut ? 'Signing out...' : 'Yes, sign out'}
          disabled={loggingOut}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
        />
      )}
    </div>
  )
}

function CompanyStats({ totals, compact = false }: { totals: { jobs: number; expected: number; collected: number; openingCarry: number; closingCarry: number; followUps: number; overdue: number }, compact?: boolean }) {
  const cards = [
    { label: 'Jobs Today', value: String(totals.jobs), className: 'blue' },
    { label: 'Expected Today', value: `Rs. ${formatMoney(totals.expected)}`, className: 'amber' },
    { label: 'Collected Today', value: `Rs. ${formatMoney(totals.collected)}`, className: 'emerald' },
    { label: 'Carry Forward', value: `Rs. ${formatMoney(totals.closingCarry)}`, className: 'rose' },
    { label: 'Opening Carry', value: `Rs. ${formatMoney(totals.openingCarry)}`, className: 'purple' },
    { label: 'Follow-ups', value: String(totals.followUps), className: 'blue' },
    { label: 'Overdue', value: String(totals.overdue), className: 'rose' },
  ]

  return (
    <div className={compact ? 'stats-strip' : 'grid-4'}>
      {cards.map((card) => (
        <div key={card.label} className={`stat-card ${card.className}`}>
          <p>{card.label}</p>
          <strong className="amount">{card.value}</strong>
        </div>
      ))}
    </div>
  )
}

function StaffSummaryCard({ summary, selected, onSelect }: { summary: UserSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`user-summary-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="card-topline">
        <div className="identity-cell">
          <div className="avatar" style={{ background: avatarColor(summary.profile.username) }}>
            {summary.profile.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="profile-name">{summary.profile.username}</div>
            <div className="muted-text">{summary.totalJobsToday} jobs today</div>
          </div>
        </div>
        {summary.overdueCount > 0 && <span className="badge badge-overdue">{summary.overdueCount} overdue</span>}
      </div>

      <div className="mini-grid">
        <Metric label="Expected" value={`Rs. ${formatMoney(summary.expectedToday)}`} />
        <Metric label="Collected" value={`Rs. ${formatMoney(summary.collectedToday)}`} good />
        <Metric label="Opening Carry" value={`Rs. ${formatMoney(summary.openingCarryForward)}`} />
        <Metric label="Closing Carry" value={`Rs. ${formatMoney(summary.closingCarryForward)}`} danger />
        <Metric label="Follow-ups" value={String(summary.followUpsToday.length)} />
        <Metric label="Pending" value={String(summary.pendingCount)} />
      </div>

      <div className="card-action-hint">{selected ? 'Viewing details' : 'Click to view jobs and performance'}</div>
    </button>
  )
}

function Metric({ label, value, good = false, danger = false }: { label: string; value: string; good?: boolean; danger?: boolean }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong className={`${good ? 'success-text' : ''} ${danger ? 'danger-text' : ''}`}>{value}</strong>
    </div>
  )
}

function AdminUserDetail({ summary, reportDate, onClose }: { summary: UserSummary; reportDate: string; onClose: () => void }) {
  const collectionRate = summary.expectedToday > 0
    ? Math.min(100, Math.round((summary.collectedToday / summary.expectedToday) * 100))
    : 0

  return (
    <section className="glass-card admin-user-detail">
      <div className="section-header">
        <div className="identity-cell">
          <div className="avatar" style={{ background: avatarColor(summary.profile.username) }}>
            {summary.profile.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2>{summary.profile.username} details</h2>
            <p className="muted-text">{summary.profile.email || `${summary.profile.username}@three-sinha.com`} · {displayDate(reportDate)}</p>
          </div>
        </div>
        <button className="btn-secondary icon-btn" onClick={onClose}>Close</button>
      </div>

      <div className="user-detail-grid">
        <Metric label="All Jobs" value={String(summary.allJobs.length)} />
        <Metric label="Open Jobs" value={String(summary.openJobs.length)} />
        <Metric label="Follow-ups Due" value={String(summary.followUpsToday.length)} />
        <Metric label="Collection Rate" value={`${collectionRate}%`} good={collectionRate >= 75} danger={collectionRate > 0 && collectionRate < 50} />
        <Metric label="Positive" value={String(summary.positiveCount)} good />
        <Metric label="Negative" value={String(summary.negativeCount)} danger />
      </div>

      <AdminJobTable title="Follow-ups due today" jobs={summary.followUpsToday} reportDate={reportDate} />
      <AdminJobTable title="New jobs today" jobs={summary.todayJobs} reportDate={reportDate} />
      <AdminJobTable title="Carry-forward jobs" jobs={summary.carryForwardJobs} reportDate={reportDate} />
      <AdminJobTable title="All jobs for this user" jobs={summary.allJobs} reportDate={reportDate} />
    </section>
  )
}

function AdminJobTable({ title, jobs, reportDate }: { title: string; jobs: Job[]; reportDate: string }) {
  return (
    <div className="detail-table-block">
      <div className="table-header compact-header">
        <h3>{title}</h3>
        <span className="badge badge-none">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <div className="empty-state compact-empty">No jobs in this section.</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table detail-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Job No</th>
                <th>Cx Name</th>
                <th>Contact</th>
                <th>Amount</th>
                <th>Received</th>
                <th>Balance</th>
                <th>Follow-up</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{displayDate(job.date)}</td>
                  <td className="link-text">{job.job_no}</td>
                  <td>{job.cx_name}</td>
                  <td>{job.contact_no}</td>
                  <td className="amount">Rs. {formatMoney(job.job_amount)}</td>
                  <td className="amount success-text">Rs. {formatMoney(job.amount_received)}</td>
                  <td className={`amount ${job.remaining_amount > 0 ? 'danger-text' : 'success-text'}`}>Rs. {formatMoney(job.remaining_amount)}</td>
                  <td>{displayDate(job.second_follow_up || job.first_follow_up)}</td>
                  <td><span className={`badge ${statusBadgeClass(job.status)}`}>{job.status}</span></td>
                  <td><span className={`badge ${getActionStatus(job, reportDate) === 'OVERDUE' ? 'badge-overdue' : 'badge-none'}`}>{getActionStatus(job, reportDate)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
