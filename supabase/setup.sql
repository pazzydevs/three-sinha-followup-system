-- ============================================================
-- THREE SINHA FOLLOW-UP SYSTEM - Supabase setup
-- Run this in the Supabase SQL editor for the project.
-- ============================================================

create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profiles
  add column if not exists email text;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default current_date,
  job_no text not null,
  cx_name text not null,
  contact_no text not null,
  job_amount numeric(12, 2) not null default 0 check (job_amount >= 0),
  amount_received numeric(12, 2) not null default 0 check (amount_received >= 0),
  remaining_amount numeric(12, 2) generated always as (job_amount - amount_received) stored,
  received_date date,
  first_follow_up date,
  second_follow_up date,
  status text not null default 'Pending' check (status in ('Positive', 'Negative', 'Pending')),
  action_require text not null default 'NONE',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint jobs_amount_received_not_over_amount check (amount_received <= job_amount)
);

create index if not exists jobs_user_date_idx on public.jobs (user_id, date desc);
create index if not exists jobs_received_date_idx on public.jobs (received_date);
create index if not exists jobs_follow_up_idx on public.jobs (first_follow_up, second_follow_up);

create table if not exists public.edit_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_column text not null check (requested_column in (
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
    'action_require'
  )),
  message text not null check (char_length(trim(message)) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'completed')),
  admin_response text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists edit_requests_user_status_idx on public.edit_requests (user_id, status, created_at desc);
create index if not exists edit_requests_job_status_idx on public.edit_requests (job_id, status, created_at desc);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info',
  related_request_id uuid references public.edit_requests(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists user_notifications_user_read_idx on public.user_notifications (user_id, read_at, created_at desc);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists jobs_updated_at on public.jobs;
create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function public.handle_updated_at();

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.handle_updated_at();

drop trigger if exists edit_requests_updated_at on public.edit_requests;
create trigger edit_requests_updated_at
  before update on public.edit_requests
  for each row execute function public.handle_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_name text;
begin
  user_name := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));

  insert into public.profiles (id, username, email, role)
  values (
    new.id,
    user_name,
    new.email,
    case when user_name = 'admin' then 'admin' else 'user' end
  )
  on conflict (id) do update
    set username = excluded.username,
        email = new.email,
        role = case when excluded.username = 'admin' then 'admin' else public.profiles.role end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- SECURITY DEFINER helper avoids recursive RLS policies on profiles.
create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

create or replace function public.enforce_job_update_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_request public.edit_requests%rowtype;
  changed_count integer := 0;
  changed_column text := null;
begin
  if public.is_admin(auth.uid()) then
    return new;
  end if;

  if auth.uid() is null or auth.uid() <> old.user_id or new.user_id <> old.user_id then
    raise exception 'Only admins can update this job.';
  end if;

  select *
    into approved_request
    from public.edit_requests
    where job_id = old.id
      and user_id = auth.uid()
      and status = 'approved'
    order by approved_at desc nulls last, created_at desc
    limit 1;

  if not found then
    raise exception 'Admin approval is required before editing a job.';
  end if;

  if new.date is distinct from old.date then changed_count := changed_count + 1; changed_column := 'date'; end if;
  if new.job_no is distinct from old.job_no then changed_count := changed_count + 1; changed_column := 'job_no'; end if;
  if new.cx_name is distinct from old.cx_name then changed_count := changed_count + 1; changed_column := 'cx_name'; end if;
  if new.contact_no is distinct from old.contact_no then changed_count := changed_count + 1; changed_column := 'contact_no'; end if;
  if new.job_amount is distinct from old.job_amount then changed_count := changed_count + 1; changed_column := 'job_amount'; end if;
  if new.amount_received is distinct from old.amount_received then changed_count := changed_count + 1; changed_column := 'amount_received'; end if;
  if new.received_date is distinct from old.received_date then changed_count := changed_count + 1; changed_column := 'received_date'; end if;
  if new.first_follow_up is distinct from old.first_follow_up then changed_count := changed_count + 1; changed_column := 'first_follow_up'; end if;
  if new.second_follow_up is distinct from old.second_follow_up then changed_count := changed_count + 1; changed_column := 'second_follow_up'; end if;
  if new.status is distinct from old.status then changed_count := changed_count + 1; changed_column := 'status'; end if;
  if new.action_require is distinct from old.action_require then changed_count := changed_count + 1; changed_column := 'action_require'; end if;

  if changed_count <> 1 or changed_column <> approved_request.requested_column then
    raise exception 'Only the approved job field can be edited.';
  end if;

  update public.edit_requests
    set status = 'completed',
        completed_at = timezone('utc'::text, now())
    where id = approved_request.id;

  insert into public.user_notifications (user_id, title, message, type, related_request_id)
  values (
    old.user_id,
    'Edit completed',
    'Your approved edit for job ' || old.job_no || ' was saved.',
    'edit_completed',
    approved_request.id
  );

  return new;
end;
$$;

drop trigger if exists enforce_job_update_approval on public.jobs;
create trigger enforce_job_update_approval
  before update on public.jobs
  for each row execute function public.enforce_job_update_approval();

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.app_settings enable row level security;
alter table public.edit_requests enable row level security;
alter table public.user_notifications enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Admin can view all profiles" on public.profiles;
drop policy if exists "Admin can insert profiles" on public.profiles;
drop policy if exists "Profiles select access" on public.profiles;
drop policy if exists "Profiles insert admin access" on public.profiles;
drop policy if exists "Profiles update admin access" on public.profiles;
drop policy if exists "Profiles delete admin access" on public.profiles;

create policy "Profiles select access"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin(auth.uid()));

create policy "Profiles insert admin access"
  on public.profiles for insert
  with check (public.is_admin(auth.uid()));

create policy "Profiles update admin access"
  on public.profiles for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Profiles delete admin access"
  on public.profiles for delete
  using (public.is_admin(auth.uid()));

drop policy if exists "Users can manage own jobs" on public.jobs;
drop policy if exists "Admin can view all jobs" on public.jobs;
drop policy if exists "Jobs select access" on public.jobs;
drop policy if exists "Jobs insert access" on public.jobs;
drop policy if exists "Jobs update access" on public.jobs;
drop policy if exists "Jobs delete access" on public.jobs;

create policy "Jobs select access"
  on public.jobs for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Jobs insert access"
  on public.jobs for insert
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Jobs update access"
  on public.jobs for update
  using (
    public.is_admin(auth.uid())
    or (
      auth.uid() = user_id
      and exists (
        select 1 from public.edit_requests
        where edit_requests.job_id = jobs.id
          and edit_requests.user_id = auth.uid()
          and edit_requests.status = 'approved'
      )
    )
  )
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Jobs delete access"
  on public.jobs for delete
  using (public.is_admin(auth.uid()));

drop policy if exists "Edit requests select access" on public.edit_requests;
drop policy if exists "Edit requests insert own" on public.edit_requests;
drop policy if exists "Edit requests admin update" on public.edit_requests;
drop policy if exists "Edit requests delete admin" on public.edit_requests;

create policy "Edit requests select access"
  on public.edit_requests for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Edit requests insert own"
  on public.edit_requests for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.jobs
      where jobs.id = edit_requests.job_id
        and jobs.user_id = auth.uid()
    )
  );

create policy "Edit requests admin update"
  on public.edit_requests for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Edit requests delete admin"
  on public.edit_requests for delete
  using (public.is_admin(auth.uid()));

drop policy if exists "Notifications select own" on public.user_notifications;
drop policy if exists "Notifications insert admin" on public.user_notifications;
drop policy if exists "Notifications update own" on public.user_notifications;
drop policy if exists "Notifications delete admin" on public.user_notifications;

create policy "Notifications select own"
  on public.user_notifications for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Notifications insert admin"
  on public.user_notifications for insert
  with check (public.is_admin(auth.uid()));

create policy "Notifications update own"
  on public.user_notifications for update
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Notifications delete admin"
  on public.user_notifications for delete
  using (public.is_admin(auth.uid()));

drop policy if exists "App settings admin select" on public.app_settings;
drop policy if exists "App settings admin insert" on public.app_settings;
drop policy if exists "App settings admin update" on public.app_settings;
drop policy if exists "App settings admin delete" on public.app_settings;

create policy "App settings admin select"
  on public.app_settings for select
  using (public.is_admin(auth.uid()));

create policy "App settings admin insert"
  on public.app_settings for insert
  with check (public.is_admin(auth.uid()));

create policy "App settings admin update"
  on public.app_settings for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "App settings admin delete"
  on public.app_settings for delete
  using (public.is_admin(auth.uid()));

do $$
begin
  begin
    alter publication supabase_realtime add table public.jobs;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.profiles;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.edit_requests;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.user_notifications;
  exception
    when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';

-- Existing auth users can be repaired after running this setup:
-- insert into public.profiles (id, username, role)
-- select id, split_part(email, '@', 1), case when split_part(email, '@', 1) = 'admin' then 'admin' else 'user' end
-- from auth.users
-- on conflict (id) do update set username = excluded.username, role = excluded.role;
