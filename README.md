# Three Sinha Follow-up System

Next.js app for daily job entry, user-level follow-up dashboards, admin reporting, Supabase Auth, Supabase Postgres, n8n webhook email delivery, and Vercel scheduled reports.

## Main Flow

- Staff users log in and manage only their own jobs.
- Admin sees all staff summaries and can add, edit, delete, and reset staff credentials.
- Daily report separates new jobs, collections, follow-ups, opening carry-forward, and closing carry-forward per user.
- Manual report sending posts to the configured n8n webhook through the app server.
- Admin can save the n8n production URL, test URL, HTTP method, boss email, workflow name, and delivery status from the Daily Report page.
- Vercel cron calls `/api/reports/daily` daily at 12:30 UTC, which is 6:00 PM Sri Lanka time.

## Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_N8N_WEBHOOK_URL=
N8N_WEBHOOK_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
ALLOWED_N8N_HOSTS=
CALL_TRACKER_INGEST_TOKEN=
```

`SUPABASE_SERVICE_ROLE_KEY` is required for admin user creation and the scheduled server-side report route. `CRON_SECRET` should be set in Vercel so scheduled report calls include an authorization header. `ALLOWED_N8N_HOSTS` is optional and defaults to `n8n.pazzy.store`. `CALL_TRACKER_INGEST_TOKEN` is the shared bearer token used by the Android call tracker app when posting to `/api/call-events`.

## Security Baseline

This codebase is maintained against an OWASP ASVS Level 2 oriented baseline:

- Supabase Auth is the application authentication provider; Vercel only hosts the app.
- Supabase RLS keeps users scoped to their own jobs, while admins can manage users, reports, and n8n settings.
- Server-side admin APIs verify the Supabase session, admin role, same-origin request, JSON content type, size limits, and basic rate limits.
- n8n webhook delivery is server-side only and restricted to HTTPS n8n webhook paths on allowed hosts.
- Security headers are configured in `next.config.ts`, including CSP, HSTS, frame denial, content sniffing protection, referrer policy, and permissions policy.
- Secrets must stay in Vercel/Supabase environment configuration and must not be committed.

Every new feature should preserve these controls and keep user authorization decisions on the server or in Supabase RLS.

## Call Tracker App Integration

Configure the Android call tracker app to send JSON events to:

```text
POST https://your-system-domain.com/api/call-events
Authorization: Bearer <CALL_TRACKER_INGEST_TOKEN>
Content-Type: application/json
```

Example payload:

```json
{
  "clientEventId": "device-001:whatsapp:2026-06-07T12:30:00Z",
  "deviceId": "device-001",
  "agentName": "Agent1",
  "source": "whatsapp",
  "direction": "incoming",
  "status": "captured",
  "contactName": "Customer Name",
  "phoneNumber": "+94770000000",
  "startedAt": "2026-06-07T12:30:00Z",
  "durationSeconds": 120,
  "capturedAt": "2026-06-07T12:32:00Z",
  "notificationTitle": "WhatsApp",
  "notificationText": "Incoming voice call"
}
```

The admin panel shows these events under **Call Tracker**. If the existing Supabase project is already set up, run only [supabase/call-events-setup.sql](./supabase/call-events-setup.sql) in Supabase.

The endpoint also accepts the current APK field names: `timestamp` in epoch milliseconds, `duration` in seconds, `source` as `PHONE` or `WHATSAPP`, and uppercase `status` values such as `INCOMING`, `ANSWERED`, `MISSED`, and `OUTGOING`.

## Supabase Setup

Run [supabase/setup.sql](./supabase/setup.sql) in the Supabase SQL editor. It creates:

- `profiles`
- `jobs`
- `call_events`
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
npm audit --audit-level=moderate
node scripts/check-db.js
```

The database check should pass after the Supabase SQL has been re-run and the `user1` password is set to `user1`.
