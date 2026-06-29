# Auth0 Universal Login — Setup Runbook

**Date:** 2026-06-29  
**Owner:** Harry  
**Status:** Implementation merged. Dashboard config + env vars are
Harry-only follow-ups.

This runbook gets FastQuote onto Auth0 Universal Login. Auth0 hosts BOTH
Google social sign-in AND Email Passwordless (magic link) behind one
screen, replacing the previous direct Google OAuth integration via
`passport-google-oauth20`.

The code change (PR: `feat(auth): Auth0 Universal Login — Google +
magic link`) is shipped. **Do not merge that PR until steps 1–8 below
are complete on the Auth0 dashboard and the four env vars are live on
Railway** — the production deploy will fail-closed at boot if
`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`,
`AUTH0_CALLBACK_URL` are missing.

---

## Why Auth0?

- One screen for Google + magic link. No bespoke email-token table to
  maintain. No mailing-list-style template work.
- Anomaly Detection (brute-force, breached-password) for free.
- UK + EU data residency available — keeps the EU migration story clean.
- Re-uses the existing `idx_users_email_unique` partial index for
  account linking (Google → Auth0 first login auto-links by
  `lower(email)`).

---

## 1. Create the Auth0 tenant

Auth0 dashboard → top-left tenant dropdown → **Create tenant**.

| Field | Value |
|---|---|
| Tenant Name | `fastquote-prod` |
| Region | **EU (Frankfurt)** — keeps the data residency story aligned with the Railway EU migration (TRQ-149) |
| Environment Tag | Production |

Repeat the process to create a `fastquote-staging` tenant if/when
staging is wired up (TRQ-153).

The tenant URL becomes `fastquote-prod.eu.auth0.com` (or the equivalent
for whatever name you picked). That value goes into the `AUTH0_DOMAIN`
env var **without** the `https://` prefix.

---

## 2. Create the Application

Auth0 dashboard → **Applications** → **+ Create Application**.

| Field | Value |
|---|---|
| Name | `FastQuote Web App` |
| Type | **Regular Web Application** |

Then on the **Settings** tab:

| Field | Value |
|---|---|
| Allowed Callback URLs | `https://fastquote.uk/auth/callback` |
| Allowed Logout URLs | `https://fastquote.uk/login` |
| Allowed Web Origins | `https://fastquote.uk` |
| Application Login URI | `https://fastquote.uk/auth/login` |
| ID Token Expiration | `36000` (default 10 hours; the FastQuote session cookie is the real authority) |
| Refresh Token Behavior | Disabled — we don't need refresh tokens; the FastQuote session is the credential post-callback |
| Grant Types | `Authorization Code` + `Implicit` (default; uncheck Implicit if available — we use the code flow only) |
| Token Endpoint Authentication | Post |

For local development, also add these to the same three URL fields
(comma-separated):

- Callback: `http://localhost:3000/auth/callback`
- Logout: `http://localhost:3000/login`
- Web Origin: `http://localhost:3000`

Copy from the Settings tab:

- **Domain** → goes into `AUTH0_DOMAIN`
- **Client ID** → goes into `AUTH0_CLIENT_ID`
- **Client Secret** → goes into `AUTH0_CLIENT_SECRET` (treat as sensitive — Railway env var, never commit)

---

## 3. Set up the Google social connection

Auth0 dashboard → **Authentication** → **Social** → **+ Create
Connection** → **Google**.

You have two options:

**Option A — re-use existing Google OAuth client (recommended):** paste
the existing `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` Harry already
has on Railway into the Auth0 Google connection. Then add Auth0's
callback URL (`https://fastquote-prod.eu.auth0.com/login/callback`) to
the **Authorized redirect URIs** list inside the existing Google Cloud
Console OAuth client. Removes the old `https://fastquote.uk/auth/google/callback`
from that list after the migration is verified (give it a week).

**Option B — create a new Google OAuth client:** Google Cloud Console
→ APIs & Services → Credentials → + Create Credentials → OAuth client
ID → Web Application. Set Authorized redirect URIs to
`https://fastquote-prod.eu.auth0.com/login/callback`. Copy the new
Client ID + Secret into Auth0. Cleaner separation; slightly more setup.

**Either way**, on the Auth0 Google connection settings:

- **Attributes** → enable: `email`, `email_verified`, `name`, `picture`.
- **Applications** tab → enable the FastQuote Web App.

Test the connection from Auth0's "Try Connection" button before
flipping the env vars on Railway.

---

## 4. Enable Email Passwordless (magic link)

Auth0 dashboard → **Authentication** → **Passwordless** → **Email**
(toggle on).

| Field | Value |
|---|---|
| Authentication Method | **Code AND Link** (Harry's locked design call) |
| OTP Length | 6 |
| OTP Lifetime | **600 seconds (10 minutes)** (Harry's locked design call) |
| Disable Signups | OFF — new users self-serve via the magic link flow |
| Apps | FastQuote Web App ✓ |

### Email template

Authentication → Passwordless → Email → **Customize Template**:

- **From**: `FastQuote <noreply@fastquote-prod.eu.auth0.com>` (Auth0
  default SMTP — bumping to a custom domain is a Phase 2 follow-up if
  deliverability becomes an issue)
- **Subject**: `Your FastQuote sign-in link`
- **Body** (HTML): Auth0 ships a tasteful default — paste the
  `--tq-accent` colour `#bd5e09` into the Customize colour picker if
  available; otherwise the default amber-ish is close enough.

---

## 5. DISABLE the username/password Database connection

Auth0 dashboard → **Authentication** → **Database** → for any default
connection (named `Username-Password-Authentication` or similar):

- **Settings** tab → **Disable Sign Ups**: ON
- **Applications** tab → **disable** the FastQuote Web App for this
  connection.

We don't want users picking a username + password. Only Google and
Email Passwordless. Hard-disabling at the application level prevents
Auth0 from rendering the email/password fields on Universal Login.

---

## 6. Enable Anomaly Detection

Auth0 dashboard → **Security** → **Attack Protection**.

- **Bot Detection** → On (Auth0-managed CAPTCHA).
- **Suspicious IP Throttling** → On.
- **Brute-Force Protection** → On (default thresholds).
- **Breached Password Detection** → On for any future password flow;
  has no effect today since we've disabled the database connection.

Set notification email to `fastquote@harrydoyle.uk`.

---

## 7. Brand the Universal Login screen

Auth0 dashboard → **Branding** → **Universal Login** → **Customize
the Login Page**.

Use the **Classic** experience (the "New" one is React-based and
overkill for v1).

| Setting | Value |
|---|---|
| Primary colour | `#bd5e09` (FastQuote amber, matches `--tq-accent`) |
| Page background | `#fffdf8` (Daylight cream) |
| Logo URL | Upload `public/landing/og.png` or the FastQuote logomark to your CDN of choice and paste the URL here. Make sure it's HTTPS. |
| Logo height | 40 px |

Auth0 dashboard → **Branding** → **Universal Login** → **Theme** tab:

- **Page Title**: `FastQuote`
- **Page Description**: `Sign in to send your next quote`

Auth0 dashboard → **Branding** → **Universal Login** → **Customize
Login Text**:

- **Welcome / Sign-in title**: `Sign in to FastQuote`
- **Welcome / Sign-in subtitle**: `Send your next quote in five minutes.`

Keep the rest of the copy at Auth0 defaults. The locked-spec safe
vocabulary applies — no "AI", "calibration", or other banned terms in
any Auth0 dashboard copy.

---

## 8. Set the env vars on Railway

Railway → fastquote service → **Variables** tab. Add:

| Variable | Value |
|---|---|
| `AUTH0_DOMAIN` | `fastquote-prod.eu.auth0.com` (whatever Auth0 gave you in step 1) |
| `AUTH0_CLIENT_ID` | from Application Settings (step 2) |
| `AUTH0_CLIENT_SECRET` | from Application Settings (step 2) — sensitive |
| `AUTH0_CALLBACK_URL` | `https://fastquote.uk/auth/callback` |

Optional (only if you want the Auth0 logout to bounce back to a
different URL than the current host):

| Variable | Value |
|---|---|
| `AUTH0_LOGOUT_RETURN_TO` | `https://fastquote.uk/login` (defaults to `${req.protocol}://${req.get('host')}/login` if unset, which works fine for prod) |

**Keep the legacy `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars
on Railway for a week** — gives a quick rollback path if Auth0 is
misconfigured. The server doesn't read them anymore (the
`REQUIRED_PROD_ENV` list lists Auth0 vars only) so they're harmless.
Delete them once the first 24 hours of post-migration prod look clean.

---

## 9. Smoke test the migration

After step 8, Railway will auto-deploy the PR (or you can trigger a
manual redeploy). Then on a clean browser session:

1. `https://fastquote.uk/login` → should 302 you to
   `https://fastquote-prod.eu.auth0.com/login?...` (Universal Login).
2. Click "Continue with Google" → Google consent screen → back to
   `https://fastquote.uk/auth/callback?code=...&state=...` → back to
   `/` (the FastQuote dashboard).
3. Sign out → should hit `/auth/logout` → `Auth0 /v2/logout` → back
   to `/login`.
4. Try the magic link path: clear cookies, hit `/login` again, enter
   your email, get the email, click the link → back into FastQuote
   with the same account row.

If step 2 lands you on `/login?error=oauth_failed`, check the Railway
logs for `[OAuth] callback error: ...` — most likely an
`AUTH0_CALLBACK_URL` mismatch with what's listed in the Auth0
Application settings.

---

## 10. Existing 10 users — migration mechanics

The existing 10 users (Mark, Paul, Harry, plus seven others) currently
have `auth_provider = 'google'` and `auth_provider_id = '<google_sub>'`.

On their first login via Auth0:

1. Auth0 returns a NEW `sub` (e.g. `google-oauth2|<google_sub>` or
   `email|<random>` depending on the path).
2. The `/auth/callback` verify callback matches them by
   `lower(email)` (the partial unique index makes this a single index
   seek). Found → UPDATE sets `auth_provider = 'auth0'` +
   `auth_provider_id = <new_sub>` + `last_login_at = NOW()`.
3. The Stripe `client_reference_id` lineage uses `users.id`, which is
   unchanged. Their subscription / quota state survives untouched.
4. The DPA bump (`LEGAL_VERSIONS.dpa = '2026-06-29'`) re-prompts them
   via the existing version-bump re-acceptance flow.

No DB migration step is required. The first-login UPDATE happens
inside a single SQL statement. The `idx_users_email_unique` partial
index guarantees no dupe rows even under concurrent first-logins.

**Do not delete existing session table rows on deploy.** Active
sessions stay valid until they expire naturally OR the user
re-authenticates. There's no forced-logout step in this migration.

---

## 11. Rollback plan

If the Auth0 migration goes sideways within the first hour:

1. Railway → fastquote service → **Deploys** → revert to the previous
   deploy (one click). The pre-Auth0 code path is restored;
   `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` are still on Railway
   from step 8's "keep for a week" note, so the direct-Google flow
   works again immediately.
2. Active Auth0-issued sessions stay valid against the rolled-back
   server (the session row in PG has a serialised user id; the
   server's `passport.deserializeUser` looks it up by id and doesn't
   care which strategy issued it).
3. Users who linked via Auth0 in the test window will have
   `auth_provider = 'auth0'` with a sub that doesn't match the
   reverted Google strategy's `WHERE auth_provider = 'google' AND
   auth_provider_id = ?` lookup — they'll fall through to the "new
   user" branch on next login, which will re-INSERT a row.
   **EXCEPT** the `idx_users_email_unique` partial unique index will
   reject the duplicate INSERT, so the new code path will throw on
   `auth_provider_id` UPDATE. To clean up: `UPDATE users SET
   auth_provider = 'google' WHERE auth_provider = 'auth0' AND id IN
   (...);` — but this is only needed if the rollback happened after
   real users had migrated. In the typical "rollback inside an hour"
   case, just Harry's QA account will be affected.

For anything beyond an hour after migration: the cleanest rollback is
forward — fix the Auth0 config rather than reverting the code.

---

## Action items checklist (for Harry)

- [ ] Create the `fastquote-prod` Auth0 tenant in the EU region (step 1)
- [ ] Create the FastQuote Web App application (step 2)
- [ ] Configure the Google social connection (step 3)
- [ ] Configure Email Passwordless with 10-min expiry, OTP + link (step 4)
- [ ] Disable the username/password Database connection (step 5)
- [ ] Enable Anomaly Detection (step 6)
- [ ] Brand Universal Login (step 7) — amber `#bd5e09`, cream `#fffdf8`, "Sign in to send your next quote"
- [ ] Set the four `AUTH0_*` env vars on Railway (step 8)
- [ ] Smoke test the four flows after deploy (step 9)
- [ ] Delete `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` env vars after 24 hours of clean prod (step 8 note)
