export type JobStatus = 'Positive' | 'Negative' | 'Pending'

export type Profile = {
  id: string
  username: string
  role: 'admin' | 'user'
  created_at?: string
}

export type Job = {
  id: string
  user_id: string
  date: string
  job_no: string
  cx_name: string
  contact_no: string
  job_amount: number
  amount_received: number
  remaining_amount: number
  received_date: string | null
  first_follow_up: string | null
  second_follow_up: string | null
  status: JobStatus
  action_require: string
  created_at?: string
  updated_at?: string
}

export type UserSummary = {
  profile: Profile
  allJobs: Job[]
  todayJobs: Job[]
  carryForwardJobs: Job[]
  openJobs: Job[]
  followUpsToday: Job[]
  totalJobsToday: number
  expectedToday: number
  collectedToday: number
  openingCarryForward: number
  todayOutstanding: number
  closingCarryForward: number
  overdueCount: number
  positiveCount: number
  negativeCount: number
  pendingCount: number
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)
}

export function displayDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB')
}

export function longDisplayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeJob<T extends Partial<Job>>(job: T): T & Job {
  return {
    ...job,
    job_amount: toNumber(job.job_amount),
    amount_received: toNumber(job.amount_received),
    remaining_amount: toNumber(job.remaining_amount),
  } as T & Job
}

export function getActionStatus(job: Pick<Job, 'action_require' | 'first_follow_up' | 'second_follow_up' | 'status' | 'remaining_amount'>, asOfDate = todayISO()) {
  if (job.remaining_amount <= 0 || job.status === 'Positive') {
    return job.action_require && job.action_require !== 'OVERDUE' ? job.action_require : 'NONE'
  }

  const latestFollowUp = job.second_follow_up || job.first_follow_up
  if (latestFollowUp && latestFollowUp < asOfDate && job.status === 'Pending') {
    return 'OVERDUE'
  }

  return job.action_require || 'NONE'
}

export function buildUserSummaries(users: Profile[], jobs: Job[], reportDate: string): UserSummary[] {
  const normalizedJobs = jobs.map(normalizeJob)

  return users.map((profile) => {
    const userJobs = normalizedJobs.filter((job) => job.user_id === profile.id)
    const todayJobs = userJobs.filter((job) => job.date === reportDate)
    const carryForwardJobs = userJobs.filter((job) => job.date < reportDate && job.remaining_amount > 0)
    const openJobs = userJobs.filter((job) => job.date <= reportDate && job.remaining_amount > 0)
    const followUpsToday = userJobs.filter((job) => job.first_follow_up === reportDate || job.second_follow_up === reportDate)

    const expectedToday = todayJobs.reduce((sum, job) => sum + job.job_amount, 0)
    const collectedToday = userJobs
      .filter((job) => job.received_date === reportDate)
      .reduce((sum, job) => sum + job.amount_received, 0)
    const openingCarryForward = carryForwardJobs.reduce((sum, job) => sum + job.remaining_amount, 0)
    const todayOutstanding = todayJobs.reduce((sum, job) => sum + job.remaining_amount, 0)
    const closingCarryForward = openJobs.reduce((sum, job) => sum + job.remaining_amount, 0)

    return {
      profile,
      allJobs: userJobs,
      todayJobs,
      carryForwardJobs,
      openJobs,
      followUpsToday,
      totalJobsToday: todayJobs.length,
      expectedToday,
      collectedToday,
      openingCarryForward,
      todayOutstanding,
      closingCarryForward,
      overdueCount: openJobs.filter((job) => getActionStatus(job, reportDate) === 'OVERDUE').length,
      positiveCount: todayJobs.filter((job) => job.status === 'Positive').length,
      negativeCount: todayJobs.filter((job) => job.status === 'Negative').length,
      pendingCount: todayJobs.filter((job) => job.status === 'Pending').length,
    }
  })
}

export function buildDailyReportText(userSummaries: UserSummary[], reportDate: string) {
  const dateStr = longDisplayDate(reportDate)
  const totalJobs = userSummaries.reduce((sum, user) => sum + user.totalJobsToday, 0)
  const companyExpected = userSummaries.reduce((sum, user) => sum + user.expectedToday, 0)
  const companyCollected = userSummaries.reduce((sum, user) => sum + user.collectedToday, 0)
  const companyOpeningCarry = userSummaries.reduce((sum, user) => sum + user.openingCarryForward, 0)
  const companyClosingCarry = userSummaries.reduce((sum, user) => sum + user.closingCarryForward, 0)
  const companyFollowUps = userSummaries.reduce((sum, user) => sum + user.followUpsToday.length, 0)

  const lines = [
    `DAILY FOLLOW-UP REPORT - ${dateStr}`,
    '='.repeat(62),
    '',
    'COMPANY OVERVIEW',
    `Total jobs added today : ${totalJobs}`,
    `Expected from new jobs : Rs. ${formatMoney(companyExpected)}`,
    `Collected today        : Rs. ${formatMoney(companyCollected)}`,
    `Opening carry-forward  : Rs. ${formatMoney(companyOpeningCarry)}`,
    `Closing carry-forward  : Rs. ${formatMoney(companyClosingCarry)}`,
    `Follow-ups today       : ${companyFollowUps}`,
    '',
  ]

  userSummaries.forEach((summary) => {
    lines.push('-'.repeat(62))
    lines.push(summary.profile.username.toUpperCase())
    lines.push(`Jobs added today      : ${summary.totalJobsToday}`)
    lines.push(`Expected today        : Rs. ${formatMoney(summary.expectedToday)}`)
    lines.push(`Collected today       : Rs. ${formatMoney(summary.collectedToday)}`)
    lines.push(`Opening carry-forward : Rs. ${formatMoney(summary.openingCarryForward)}`)
    lines.push(`Closing carry-forward : Rs. ${formatMoney(summary.closingCarryForward)}`)
    lines.push(`Follow-ups today      : ${summary.followUpsToday.length}`)
    lines.push(`Status today          : ${summary.positiveCount} Positive | ${summary.negativeCount} Negative | ${summary.pendingCount} Pending`)

    if (summary.overdueCount > 0) {
      lines.push(`Overdue jobs          : ${summary.overdueCount}`)
    }

    if (summary.todayJobs.length > 0) {
      lines.push('')
      lines.push('New jobs today:')
      summary.todayJobs.forEach((job) => {
        lines.push(`- ${job.job_no} | ${job.cx_name} | Rs. ${formatMoney(job.job_amount)} | received Rs. ${formatMoney(job.amount_received)} | balance Rs. ${formatMoney(job.remaining_amount)}`)
        lines.push(`  Status: ${job.status} | Action: ${getActionStatus(job, reportDate)} | Contact: ${job.contact_no}`)
      })
    } else {
      lines.push('New jobs today: none')
    }

    if (summary.followUpsToday.length > 0) {
      lines.push('')
      lines.push('Follow-ups for today:')
      summary.followUpsToday.forEach((job) => {
        lines.push(`- ${job.job_no} | ${job.cx_name} | Status: ${job.status} | Action: ${getActionStatus(job, reportDate)} | Balance Rs. ${formatMoney(job.remaining_amount)}`)
      })
    }

    if (summary.carryForwardJobs.length > 0) {
      lines.push('')
      lines.push('Carry-forward to discuss tomorrow:')
      summary.carryForwardJobs.forEach((job) => {
        lines.push(`- ${job.job_no} | ${job.cx_name} | Balance Rs. ${formatMoney(job.remaining_amount)} | Action: ${getActionStatus(job, reportDate)}`)
      })
    }

    lines.push('')
  })

  lines.push('='.repeat(62))
  lines.push(`Generated by Three Sinha Follow-up System at ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`)

  return lines.join('\n')
}

export function buildReportPayload(userSummaries: UserSummary[], reportDate: string) {
  const companyExpected = userSummaries.reduce((sum, user) => sum + user.expectedToday, 0)
  const companyCollected = userSummaries.reduce((sum, user) => sum + user.collectedToday, 0)
  const companyOpeningCarry = userSummaries.reduce((sum, user) => sum + user.openingCarryForward, 0)
  const companyClosingCarry = userSummaries.reduce((sum, user) => sum + user.closingCarryForward, 0)

  return {
    date: reportDate,
    reportText: buildDailyReportText(userSummaries, reportDate),
    summary: {
      totalJobs: userSummaries.reduce((sum, user) => sum + user.totalJobsToday, 0),
      expectedToday: companyExpected,
      collectedToday: companyCollected,
      openingCarryForward: companyOpeningCarry,
      closingCarryForward: companyClosingCarry,
      followUpsToday: userSummaries.reduce((sum, user) => sum + user.followUpsToday.length, 0),
    },
    users: userSummaries.map((summary) => ({
      username: summary.profile.username,
      totalJobsToday: summary.totalJobsToday,
      expectedToday: summary.expectedToday,
      collectedToday: summary.collectedToday,
      openingCarryForward: summary.openingCarryForward,
      closingCarryForward: summary.closingCarryForward,
      followUpsToday: summary.followUpsToday.length,
      overdueCount: summary.overdueCount,
      statusSummary: {
        positive: summary.positiveCount,
        negative: summary.negativeCount,
        pending: summary.pendingCount,
      },
      todayJobs: summary.todayJobs.map((job) => reportJob(job, reportDate)),
      carryForwardJobs: summary.carryForwardJobs.map((job) => reportJob(job, reportDate)),
      followUpJobs: summary.followUpsToday.map((job) => reportJob(job, reportDate)),
    })),
  }
}

function reportJob(job: Job, reportDate: string) {
  return {
    jobNo: job.job_no,
    cxName: job.cx_name,
    contactNo: job.contact_no,
    jobAmount: job.job_amount,
    amountReceived: job.amount_received,
    remainingAmount: job.remaining_amount,
    receivedDate: job.received_date,
    firstFollowUp: job.first_follow_up,
    secondFollowUp: job.second_follow_up,
    status: job.status,
    actionRequired: getActionStatus(job, reportDate),
  }
}
