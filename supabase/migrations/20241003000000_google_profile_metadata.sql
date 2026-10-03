-- Google sign-in profile metadata.
--
-- The init migration already creates a profile row on auth.users insert and
-- uses `on conflict (id) do nothing`, so a second sign-in cannot produce a
-- duplicate profile. That guarantee is kept here rather than reimplemented.
--
-- display_name and avatar_url are populated from Google's user_metadata, which
-- only ever contains a verified email for the identity that just authenticated.

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text;

comment on column public.profiles.display_name is
  'Name shown in the UI, taken from the OAuth provider profile.';
comment on column public.profiles.avatar_url is
  'Avatar image URL from the OAuth provider profile.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, tz, theme, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'tz', 'Asia/Kolkata'),
    coalesce(new.raw_user_meta_data ->> 'theme', 'system'),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill rows for anyone who signed in before this migration. Only fills
-- blanks, so it cannot overwrite a name a user has since edited.
update public.profiles p
set display_name = u.raw_user_meta_data ->> 'full_name',
    avatar_url = u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
where u.id = p.id
  and p.display_name is null
  and u.raw_user_meta_data ? 'full_name';

-- Guard against a profile pointing at something other than an https image,
-- which would otherwise be rendered as an <img src> on the settings screen.
alter table public.profiles
  add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~* '^https://');