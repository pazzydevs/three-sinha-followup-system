-- Call Tracker intake table for the Android APK integration.
-- Run this in the Supabase SQL Editor for the Three Sinha project.

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  client_event_id text unique not null,
  device_id text not null,
  agent_name text,
  source text not null default 'other' check (source in ('cellular', 'whatsapp', 'whatsapp_business', 'other')),
  direction text not null default 'unknown' check (direction in ('incoming', 'outgoing', 'missed', 'unknown')),
  status text not null default 'captured' check (status in ('ringing', 'active', 'ended', 'missed', 'declined', 'captured', 'unknown')),
  contact_name text,
  phone_number text,
  app_package text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  captured_at timestamptz not null default timezone('utc'::text, now()),
  notification_title text,
  notification_text text,
  notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists call_events_captured_idx on public.call_events (captured_at desc);
create index if not exists call_events_device_idx on public.call_events (device_id, captured_at desc);
create index if not exists call_events_source_idx on public.call_events (source, captured_at desc);

alter table public.call_events enable row level security;

drop policy if exists "Call events admin select" on public.call_events;
drop policy if exists "Call events admin delete" on public.call_events;

create policy "Call events admin select"
  on public.call_events for select
  using (public.is_admin(auth.uid()));

create policy "Call events admin delete"
  on public.call_events for delete
  using (public.is_admin(auth.uid()));

do $$
begin
  begin
    alter publication supabase_realtime add table public.call_events;
  exception
    when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';
