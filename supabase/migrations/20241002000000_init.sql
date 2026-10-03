-- TickLab initial schema.
--
-- Conventions:
--  * `updated_at` is maintained by trigger and is the sync cursor for every table.
--  * Deletes are soft (`deleted = true`) so they replicate and history survives.
--  * RLS is enabled everywhere and every policy is scoped to auth.uid().

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  tz text not null default 'Asia/Kolkata',
  theme text,
  rollover_hour int not null default 0 check (rollover_hour between 0 and 11),
  streak_threshold numeric not null default 0.7 check (streak_threshold > 0 and streak_threshold <= 1),
  freeze_per_week int not null default 0 check (freeze_per_week >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  icon text,
  grp text,
  kind text not null check (kind in ('tick', 'count', 'duration', 'number')),
  unit text,
  target numeric,
  -- ISO weekdays, Monday = 1 .. Sunday = 7.
  schedule int[] not null default '{1,2,3,4,5,6,7}',
  sort int not null default 0,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  constraint habits_schedule_is_iso check (
    schedule <@ array[1,2,3,4,5,6,7]::int[] and cardinality(schedule) > 0
  )
);

create table if not exists entries (
  habit_id uuid not null references habits on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  value numeric not null default 1 check (value >= 0),
  note text,
  updated_at timestamptz not null default now(),
  primary key (habit_id, day)
);

create table if not exists days (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  mood int check (mood between 0 and 10),
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists habits_touch on habits;
create trigger habits_touch before update on habits
  for each row execute function public.touch_updated_at();

drop trigger if exists entries_touch on entries;
create trigger entries_touch before update on entries
  for each row execute function public.touch_updated_at();

drop trigger if exists days_touch on days;
create trigger days_touch before update on days
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Profile bootstrap
--
-- The trigger runs as the auth service role and therefore bypasses RLS. This is
-- what lets a brand new user receive a profile row even though the "own rows"
-- policy cannot match an id that has not been inserted yet.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, tz, theme)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'tz', 'Asia/Kolkata'),
    coalesce(new.raw_user_meta_data ->> 'theme', 'system')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table habits    enable row level security;
alter table entries   enable row level security;
alter table days      enable row level security;

-- Force RLS even for table owners, so a leaked service key in a query cannot
-- quietly bypass the policies.
alter table profiles force row level security;
alter table habits    force row level security;
alter table entries   force row level security;
alter table days      force row level security;

drop policy if exists "own" on habits;
create policy "own" on habits
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own" on entries;
create policy "own" on entries
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own" on days;
create policy "own" on days
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Profiles are keyed by id rather than user_id, and are read-only from the client:
-- the row is created by handle_new_user() and updated through server functions.
drop policy if exists "read_own" on profiles;
create policy "read_own" on profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "update_own" on profiles;
create policy "update_own" on profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists habits_user_updated_idx   on habits  (user_id, updated_at);
create index if not exists habits_user_sort_idx     on habits  (user_id, sort) where deleted = false;
create index if not exists entries_user_updated_idx on entries (user_id, updated_at);
create index if not exists entries_user_day_idx     on entries (user_id, day);
create index if not exists days_user_updated_idx    on days    (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- Account deletion
--
-- Auth already cascades to habits/entries/days via the foreign keys; this makes
-- the guarantee explicit and gives us a single place to hang future cleanup.
-- ---------------------------------------------------------------------------

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_account() from public;
grant execute on function public.delete_account() to authenticated;