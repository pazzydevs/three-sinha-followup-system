'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
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

const defaultN8nConfig: N8nConfig = {
  webhookUrl: process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || '',
  testWebhookUrl: '',
  httpMethod: 'POST',
  emailTo: '',
  workflowName: 'Daily Follow-up Report',
  enabled: true,
}

const n8nStorageKey = 'three-sinha-n8n-config'

function avatarColor(name: string) {
  const colors = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#be185d']
  return colors[name.charCodeAt(0) % colors.length]
}

export default function AdminPage() {
  const router = useRouter()
  const [adminProfile, setAdminProfile] = useState<Profile | null>(null)
  const [users, setUsers] = useState<Profile[]>([])
  const [allJobs, setAllJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'report'>('overview')
  const [reportDate, setReportDate] = useState(todayISO())
  const [sendingReport, setSendingReport] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const [reportPreview, setReportPreview] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '' })
  const [addingUser, setAddingUser] = useState(false)
  const [addUserError, setAddUserError] = useState('')
  const [addUserSuccess, setAddUserSuccess] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [n8nConfig, setN8nConfig] = useState<N8nConfig>(defaultN8nConfig)
  const [savingN8nConfig, setSavingN8nConfig] = useState(false)
  const [testingN8n, setTestingN8n] = useState(false)
  const [n8nConfigMessage, setN8nConfigMessage] = useState('')

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

  const loadN8nConfig = useCallback(async () => {
    const storedConfig = window.localStorage.getItem(n8nStorageKey)
    if (storedConfig) {
      setN8nConfig({ ...defaultN8nConfig, ...JSON.parse(storedConfig) })
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
      void loadN8nConfig()
    })

    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadData)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [adminProfile, loadData, loadN8nConfig])

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

  const handlePreviewReport = () => {
    setReportPreview(buildReportPayload(summaries, reportDate).reportText)
  }

  const handleSendReport = async () => {
    setSendingReport(true)
    setReportMessage('')

    try {
      const payload = buildReportPayload(summaries, reportDate)
      const webhookUrl = n8nConfig.webhookUrl.trim()

      if (!webhookUrl) {
        setReportMessage('n8n webhook URL is not configured.')
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

      setReportPreview(payload.reportText)
      setReportMessage('Report sent to n8n successfully.')
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
      setN8nConfigMessage('Saved in this browser. Run the updated Supabase setup SQL to save it for everyone.')
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

      setN8nConfigMessage(response.ok ? 'n8n test sent successfully.' : `n8n test failed with status ${response.status}.`)
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

    try {
      const trimmedUsername = newUser.username.trim().toLowerCase()
      const email = trimmedUsername.includes('@') ? trimmedUsername : `${trimmedUsername}@three-sinha.com`
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
      setNewUser({ username: '', password: '' })
      await loadData()
    } catch {
      setAddUserError('Something went wrong while creating the user.')
    } finally {
      setAddingUser(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
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
    <div className="main-layout">
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
            { key: 'report', label: 'Daily Report' },
          ].map((item) => (
            <button
              key={item.key}
              className={`sidebar-nav-item ${activeTab === item.key ? 'active' : ''}`}
              onClick={() => setActiveTab(item.key as typeof activeTab)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="btn-secondary" onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{activeTab === 'overview' ? 'Company Overview' : activeTab === 'users' ? 'Manage Users' : 'Daily Report'}</h1>
            <p>{longDisplayDate(reportDate)}</p>
          </div>
          <div className="toolbar-row">
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
              )}
            </>
          )}

          {activeTab === 'users' && (
            <section className="narrow-panel">
              <div className="section-header">
                <h2 className="section-title">Staff Accounts</h2>
                <button className="btn-primary" onClick={() => setShowAddUser(true)}>Add User</button>
              </div>

              <div className="glass-card table-card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Jobs Today</th>
                      <th>Expected</th>
                      <th>Collected</th>
                      <th>Carry Forward</th>
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
                        <td>{summary.totalJobsToday}</td>
                        <td className="amount">Rs. {formatMoney(summary.expectedToday)}</td>
                        <td className="amount success-text">Rs. {formatMoney(summary.collectedToday)}</td>
                        <td className="amount danger-text">Rs. {formatMoney(summary.closingCarryForward)}</td>
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
                        <label className="form-label">Password</label>
                        <input className="form-input" type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} required minLength={6} />
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="btn-primary" disabled={addingUser}>{addingUser ? 'Creating...' : 'Create User'}</button>
                      <button className="btn-secondary" type="button" onClick={() => setShowAddUser(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          )}

          {activeTab === 'report' && (
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
                      <span>Enable daily report delivery</span>
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
                {n8nConfigMessage && <div className={`alert ${n8nConfigMessage.includes('success') || n8nConfigMessage.includes('saved') ? 'success' : 'error'}`}>{n8nConfigMessage}</div>}
              </div>

              <div className="glass-card form-card">
                <h2 className="section-title">Report to Boss</h2>
                <p className="muted-text">This report includes each user separately, today&apos;s new jobs, today&apos;s follow-ups, collections, and balances to carry into tomorrow.</p>
                <CompanyStats totals={companyTotals} compact />
                <div className="button-row">
                  <button className="btn-secondary" onClick={handlePreviewReport}>Preview Report</button>
                  <button className="btn-success" onClick={handleSendReport} disabled={sendingReport || !n8nConfig.enabled}>
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
    <button className="user-summary-card" onClick={onSelect}>
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

      {selected && (
        <div className="expanded-list">
          <JobList title="New jobs today" jobs={summary.todayJobs} />
          <JobList title="Carry-forward jobs" jobs={summary.carryForwardJobs} />
        </div>
      )}
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

function JobList({ title, jobs }: { title: string; jobs: Job[] }) {
  if (jobs.length === 0) return null

  return (
    <div>
      <h4>{title}</h4>
      {jobs.map((job) => (
        <div className="compact-job" key={job.id}>
          <div>
            <strong>{job.job_no}</strong>
            <span>{job.cx_name}</span>
          </div>
          <div>
            <span>Rs. {formatMoney(job.remaining_amount)}</span>
            <span>{getActionStatus(job)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
