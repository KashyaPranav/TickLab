-- Development seed data.
--
-- Creates a demo user with a realistic set of habits and ~10 weeks of history
-- so the heatmap, streaks and insights screens have something to show.
--
-- Run with:  psql "$DATABASE_URL" -f supabase/seed.sql

begin;

-- Password for the demo account, created only if it does not already exist.
do $$
begin
  if not exists (select 1 from auth.users where email = 'demo@ticklab.app') then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (
      '00000000-0000-4000-8000-000000000001',
      'demo@ticklab.app',
      crypt('ticklab-demo', gen_salt('bf')),
      now(),
      '{"tz":"Asia/Kolkata"}'::jsonb
    );
  end if;
end;
$$;

insert into public.habits (id, user_id, name, icon, grp, kind, unit, target, schedule, sort)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'Morning run', 'run', 'Health', 'duration', 'min', 30, '{1,2,3,4,5,6,7}', 0),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
   'Drink water', 'water', 'Health', 'count', 'glasses', 8, '{1,2,3,4,5,6,7}', 1),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
   'Read', 'book', 'Learning', 'duration', 'min', 20, '{1,2,3,4,5,6,7}', 2),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001',
   'Push-ups', 'dumbbell', 'Health', 'count', 'reps', 25, '{1,3,5}', 3),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001',
   'No phone after 10pm', 'moon', 'Sleep', 'tick', null, '{1,2,3,4,5}', 4),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001',
   'Save money', 'wallet', 'Finance', 'tick', null, '{1,4}', 5)
on conflict (id) do nothing;

-- 70 days of history with a realistic ~82% hit rate, and a current streak that
-- runs right up to today.
insert into public.entries (habit_id, user_id, day, value)
select
  h.id,
  '00000000-0000-4000-8000-000000000001',
  d::date,
  case
    when h.kind = 'tick' then 1
    when h.kind = 'duration' then round((h.target::numeric * (0.7 + random() * 0.6))::numeric, 1)
    else round((h.target::numeric * (0.75 + random() * 0.5))::numeric, 1)
  end
from public.habits h
cross join generate_series(
  (current_date - 69)::date,
  current_date,
  interval '1 day'
) d
where
  h.user_id = '00000000-0000-4000-8000-000000000001'
  -- Only on scheduled ISO weekdays.
  and extract(isodow from d)::int = any (h.schedule)
  -- Skip roughly one day in six so the heatmap is not uniform.
  and random() > 0.18
on conflict (habit_id, day) do update set value = excluded.value;

-- Force a clean run over the last 9 days so the demo always shows a live streak.
insert into public.entries (habit_id, user_id, day, value)
select
  h.id,
  '00000000-0000-4000-8000-000000000001',
  d::date,
  case when h.kind = 'tick' then 1 else h.target end
from public.habits h
cross join generate_series(
  (current_date - 8)::date,
  current_date,
  interval '1 day'
) d
where
  h.user_id = '00000000-0000-4000-8000-000000000001'
  and extract(isodow from d)::int = any (h.schedule)
on conflict (habit_id, day) do update set value = excluded.value;

insert into public.days (user_id, day, mood, note)
select
  '00000000-0000-4000-8000-000000000001',
  d::date,
  case when random() > 0.25 then 6 + floor(random() * 5)::int else null end,
  null
from generate_series(
  (current_date - 69)::date,
  current_date,
  interval '1 day'
) d
on conflict (user_id, day) do update set mood = excluded.mood;

commit;

-- Sign in as demo@ticklab.app with the password "ticklab-demo".