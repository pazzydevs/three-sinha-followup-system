# Three Sinha Follow-up System

Next.js app for daily job entry, user-level follow-up dashboards, admin reporting, Supabase Auth, Supabase Postgres, n8n webhook email delivery, and Vercel scheduled reports.

## Main Flow

- Staff users log in and manage only their own jobs.
- Admin sees all staff summaries and can add users.
- Daily report separates new jobs, collections, follow-ups, opening carry-forward, and closing carry-forward per user.
- Manual report sending posts to the configured n8n webhook through the app server.
- Admin can save the n8n webhook URL, boss email, workflow name, and delivery status from the Daily Report page.
- Vercel cron calls `/api/reports/daily` daily at 12:30 UTC, which is 6:00 PM Sri Lanka time.

## Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_N8N_WEBHOOK_URL=
N8N_WEBHOOK_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` is required for admin user creation and the scheduled server-side report route.

## Supabase Setup

Run [supabase/setup.sql](./supabase/setup.sql) in the Supabase SQL editor. It creates:

- `profiles`
- `jobs`
- `app_settings`
- non-recursive RLS policies
- auth user profile trigger
- realtime publication entries

The SQL also includes a final commented repair query for existing auth users.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run lint
npm run build
node scripts/check-db.js
```

The database check should pass after the Supabase SQL has been re-run and the `user1` password is set to `user1`.
