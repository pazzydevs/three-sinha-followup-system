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

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.app_settings enable row level security;

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
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

create policy "Jobs delete access"
  on public.jobs for delete
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

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
end;
$$;

-- Existing auth users can be repaired after running this setup:
-- insert into public.profiles (id, username, role)
-- select id, split_part(email, '@', 1), case when split_part(email, '@', 1) = 'admin' then 'admin' else 'user' end
-- from auth.users
-- on conflict (id) do update set username = excluded.username, role = excluded.role;
