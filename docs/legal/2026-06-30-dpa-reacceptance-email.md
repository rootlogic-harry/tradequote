# DPA v2026-06-29 re-acceptance — manual outreach

**Audit-trail purpose.** PR #89 (Auth0 migration, 2026-06-29) bumped the
Privacy Policy and Data Processing Agreement to `'2026-06-29'` to disclose
Auth0 (Okta Inc., a US-based processor) as a new sub-processor for
authentication. The comment in `server.js`'s `LEGAL_VERSIONS` claimed
existing users would re-accept automatically; in fact no such mechanism
ships. This document is the manual audit trail until the user base is big
enough to warrant an in-app gate.

Status: **OPEN — Harry to send emails 2026-06-30.**

## Affected users

| Display name | Email | Stored `dpa_accepted_version` |
|---|---|---|
| Harry Doyle | rootvaluation@gmail.com (self) | 2026-06-15 |
| Mark | (see DB) | 2026-06-15 |
| Paul Clough | (see DB) | 2026-06-15 |

Confirm by running `SELECT id, email, dpa_accepted_version, privacy_accepted_version FROM users ORDER BY id;` on the live DB.

## Email — copy/paste

**Subject:** Quick FastQuote update — privacy & data processing changes

```
Hi {Name},

Quick housekeeping note — I've just switched FastQuote over to use Auth0
(an Okta-owned service, based in the US) for sign-in instead of going
directly to Google. It hosts both the "Sign in with Google" button and
the "magic link" email option behind one screen.

That means Auth0 is now a sub-processor of your account data — they
handle your email address and authentication token when you sign in.
They don't see anything else (no client data, no quotes, no photos).

I've updated the Privacy Policy and Data Processing Agreement (both
now versioned 2026-06-29) to reflect this:

  - https://fastquote.uk/privacy
  - https://fastquote.uk/dpa

Both documents are short — please skim them. If you're happy to keep
using FastQuote on the new sub-processor chain, just reply "I accept"
to this email and I'll log your acceptance against your account. If
you'd rather not, also reply and I'll close your account and delete
your data within 30 days (GDPR Art. 17).

This is a one-off — the day-to-day experience hasn't changed, just the
sign-in plumbing. Cheers,

Harry
```

## What to do on each reply

For each "I accept" reply:

1. Record the email + timestamp below.
2. UPDATE the user's row:
   ```sql
   UPDATE users
      SET dpa_accepted_version = '2026-06-29',
          privacy_accepted_version = '2026-06-29',
          dpa_accepted_at = NOW()::DATE,
          privacy_accepted_at = NOW()::DATE
    WHERE email = 'their@email.example';
   ```
3. Forward the email reply to yourself + archive in the FastQuote/Legal
   folder for the audit trail.

For any "not happy" or "delete me" reply, follow the right-to-erasure
runbook in `docs/legal/` (TODO if not present — for Mark/Paul/yourself
this is unlikely, but document the trigger).

## Acceptance log

| User | Email sent | Reply received | DB updated |
|---|---|---|---|
| Harry | _pending_ | _pending_ | _pending_ |
| Mark | _pending_ | _pending_ | _pending_ |
| Paul | _pending_ | _pending_ | _pending_ |

## Future: in-app gate

When users > ~20, ship the gate:

1. Add `/api/legal/accept` endpoint (requireAuth + small rate limit) that
   accepts `{ document: 'privacy' | 'dpa' | 'terms', version: 'YYYY-MM-DD' }`
   and UPDATEs the matching `users.*_accepted_version` column.
2. Expose `legal.staleAccepts: ['privacy', 'dpa']` (etc.) on `/auth/me`
   when the user's stored version differs from `LEGAL_VERSIONS`.
3. Mount a blocking modal in `App.jsx` when `legal.staleAccepts` is
   non-empty — short summary of what changed + two buttons: "I accept"
   (calls the endpoint) and "Email me" (mailto link). No quote routes
   render until accepted.
4. Skip the gate for the first 60s of an admin session so Harry can
   review without being trapped.
