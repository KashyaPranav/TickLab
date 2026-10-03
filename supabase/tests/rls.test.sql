-- Row level security tests.
--
-- Run with:  supabase test db
--
-- Each test impersonates a real authenticated user via `set local role
-- authenticated` plus `request.jwt.claims`, so the policies are exercised the
-- same way PostgREST exercises them.

begin;

select plan(20);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function tests.sign_in_as(uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid::text,
    'role', 'authenticated'
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.sign_out()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- Runs `sql` with the request role forced to `authenticated` for uid.
create or replace function tests.as_user(uid uuid, sql text)
returns setof anyelement
language plpgsql
as $$
begin
  return query execute format('set local role authenticated; set local request.jwt.claims = %L; %s',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, sql);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

-- The auth trigger should have created both profiles.
select ok(
  (select count(*) from public.profiles) = 2,
  'handle_new_user() creates a profile for every new user'
);

select ok(
  (select tz from public.profiles where id = '11111111-1111-1111-1111-111111111111') = 'Asia/Kolkata',
  'new profiles default to Asia/Kolkata'
);

insert into public.habits (id, user_id, name, kind, schedule, sort)
values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice read', 'tick', '{1,2,3}', 0),
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Bob lifted', 'count', '{1}', 0);

insert into public.entries (habit_id, user_id, day, value)
values
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2024-01-01', 1),
  ('bbbbbbb1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2024-01-01', 3);

insert into public.days (user_id, day, mood)
values ('11111111-1111-1111-1111-111111111111', '2024-01-01', 8);

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select * from tests.as_user('22222222-2222-2222-2222-222222222222',
       'select * from public.habits') $$,
  'a user cannot read another user''s habits'
);

select is(
  (select count(*) from tests.as_user('11111111-1111-1111-1111-111111111111',
      'select * from public.habits')),
  1::bigint,
  'a user can read their own habits'
);

select throws_ok(
  $$ insert into public.habits (user_id, name, kind)
     values ('22222222-2222-2222-2222-222222222222', 'Injected', 'tick') $$,
  '42501',
  'a user cannot insert a habit on behalf of someone else'
);

select is_empty(
  $$ select * from tests.as_user('22222222-2222-2222-2222-222222222222',
       'delete from public.habits where id = ''aaaaaaa1-0000-0000-0000-000000000001''') $$,
  'a user cannot delete another user''s habit'
);

select throws_ok(
  $$ update public.habits set user_id = '22222222-2222-2222-2222-222222222222'
     where id = 'aaaaaaa1-0000-0000-0000-000000000001' $$,
  '42501',
  'a user cannot reassign a habit to another user'
);

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select * from tests.as_user('22222222-2222-2222-2222-222222222222',
       'select * from public.entries') $$,
  'a user cannot read another user''s entries'
);

select throws_ok(
  $$ update public.entries set value = 999
     where habit_id = 'bbbbbbb1-0000-0000-0000-000000000001' $$,
  '42501',
  'a user cannot update another user''s entry'
);

select throws_ok(
  $$ insert into public.entries (habit_id, user_id, day, value)
     values ('bbbbbbb1-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', '2024-01-02', 1) $$,
  '42501',
  'a user cannot write an entry against another user''s habit'
);

-- A user must not be able to claim another user's habit_id even for their own day.
select throws_ok(
  $$ insert into public.entries (habit_id, user_id, day, value)
     values ('bbbbbbb1-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111', '2024-01-09', 1) $$,
  '23503',
  'entries cannot reference a habit owned by someone else'
);

-- ---------------------------------------------------------------------------
-- days
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select * from tests.as_user('22222222-2222-2222-2222-222222222222',
       'select * from public.days') $$,
  'a user cannot read another user''s day notes'
);

select throws_ok(
  $$ insert into public.days (user_id, day, mood)
     values ('22222222-2222-2222-2222-222222222222', '2024-01-01', 3) $$,
  '42501',
  'a user cannot insert day notes for someone else'
);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select * from tests.as_user('22222222-2222-2222-2222-222222222222',
       'select * from public.profiles') $$,
  'a user cannot read another user''s profile'
);

select ok(
  (select count(*) from tests.as_user('11111111-1111-1111-1111-111111111111',
     'select * from public.profiles')) = 1,
  'a user can read their own profile'
);

select is(
  (select tz from tests.as_user('11111111-1111-1111-1111-111111111111',
     'update public.profiles set tz = ''Europe/Berlin''
      where id = ''11111111-1111-1111-1111-111111111111''
      returning tz')),
  'Europe/Berlin',
  'a user can update their own timezone'
);

select throws_ok(
  $$ update public.profiles set tz = 'Mars/Olympus'
     where id = '22222222-2222-2222-2222-222222222222' $$,
  '42501',
  'a user cannot update another user''s profile'
);

-- ---------------------------------------------------------------------------
-- constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.habits (user_id, name, kind, schedule)
     values ('11111111-1111-1111-1111-111111111111', 'Bad', 'tick', '{0,8}') $$,
  '23514',
  'schedule rejects non-ISO weekdays'
);

select throws_ok(
  $$ insert into public.habits (user_id, name, kind)
     values ('11111111-1111-1111-1111-111111111111', 'Bad', 'nonsense') $$,
  '23514',
  'kind rejects unknown habit types'
);

select is(
  (select value from tests.as_user('11111111-1111-1111-1111-111111111111',
     'update public.entries set value = 2
      where habit_id = ''aaaaaaa1-0000-0000-0000-000000000001'' and day = ''2024-01-01''
      returning value')),
  2,
  'updating a row bumps updated_at via the trigger'
);

select * from finish();
rollback;