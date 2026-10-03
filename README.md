# TickLab

Habit tracking made simple. Installable PWA with offline-first sync.

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in Supabase credentials
2. Install dependencies: `npm install`
3. Run development server: `npm run dev`
4. Build: `npm run build`

## Google auth setup

Sign-in is optional. TickLab works with no account at all, and rows live in
IndexedDB on the device. An account only adds cross-device sync.

1. In the Supabase dashboard, enable the **Google** provider under
   Authentication → Providers. Client ID and secret come from Google Cloud
   Console → APIs & Services → Credentials.
2. Set the redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
   This is the URL Google calls; TickLab's own `/auth/callback` route is
   downstream of it.
3. Leave **email confirmation enabled**. This is a security requirement, not a
   preference: Supabase links a Google identity to an existing account only when
   the emails match *and* are verified. With confirmation off, someone who
   registers an unverified address matching a victim's email could have Google
   silently link them into that account.
4. Add `http://localhost:3000/auth/callback` and your production URL to the
   Supabase **Redirect URLs** allow-list, and add the same URLs to the Google
   OAuth client's authorised redirect URIs.
5. Point `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at the
   project, then apply the migrations in `supabase/migrations/`.

### How the flow works

- `/login` and `/signup` share one `AuthCard` and one Google button. The button
  starts PKCE OAuth with `prompt=select_account`, so Google shows the account
  chooser instead of silently reusing whoever signed in last.
- Google returns to Supabase, which redirects to `/auth/callback?code=...`. That
  route handler exchanges the code and writes the session cookie.
- `src/proxy.ts` calls `getClaims()` on each request. That reads the cookie
  without a network call and only reaches Supabase when the token has actually
  expired, which is what keeps an offline reload signed in.
- The landing page reads the session server-side and renders the signed-in CTA
  on the first paint.

### What is deliberately not gated

The app routes are **not** redirected to `/login` when signed out. Two
requirements made that impossible to satisfy together: the app is meant to work
with no account, and guest data has to be re-owned into the account on first
sign-in. A redirect would mean guest rows could never be created, so the merge
would be unreachable. Authorization is enforced where it actually matters, by
row-level security on the sync tables; a signed-out visitor simply has nothing to
sync.

### Sessions and local data

- The session lives in a cookie, not `localStorage`, so the server and the proxy
  see the same signed-in state and it survives an offline reload.
- On first sign-in, guest rows are re-owned to the account in a single Dexie
  transaction that also queues them in the outbox. Overlapping rows are resolved
  last-write-wins on `updated_at`; rows with different ids are both kept, because
  two same-named habits on two devices are two real habits.
- Signing out asks whether to keep the local copy. "Keep data on this device"
  leaves rows and the outbox in place so signing back in re-syncs them;
  "Remove data from this device" clears them, which is what a shared machine
  needs. Clearing unconditionally used to silently discard unsynced work.
- Only the anon key is ever exposed to the browser. RLS is the sole authority on
  row access; no service-role key exists in the client or the app.

## Tech Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4
- Zustand + Dexie (IndexedDB)
- Supabase (Auth, Postgres, RLS)
- Serwist (PWA)
- Vitest + Playwright
