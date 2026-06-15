# Data erasure & account cancellation (TRQ-158)

## Why this exists

The Privacy Policy (TRQ-151) promises every data-subject right under
UK GDPR — including the **right to erasure** (Article 17). A
policy that promises something the app cannot deliver is worse than
no policy. This runbook makes the promise keepable.

**Scale decision:** at current user count, erasure is a **manual
process operated by Harry**. No self-serve "Delete my account"
button yet. The few requests we get per year are best handled by
hand with full context. If volume grows past ~50 active accounts
we'll automate.

## Two request shapes

| Who's asking | What to do | Source |
|---|---|---|
| A waller cancels their FastQuote account | Cancellation + full data erasure for their personal data + everything they uploaded | Email / direct request |
| A homeowner asks their waller to remove their data | The waller emails Harry; Harry erases that specific job + photos | Forwarded by the waller (they are the controller for their end-clients) |

The second case is more common in theory than the first. In both
cases the inbox is `hello@fastquote.uk`.

---

## Where personal data lives (every location)

Before any erasure: know the inventory. Missing a location creates
a "we deleted you" promise that's untrue.

### Live database (Railway Postgres)

| Table | Personal data it holds | Erasure approach |
|---|---|---|
| `users` | id, name, email, avatar URL, OAuth provider id, plan, profile_complete, accepted-version timestamps | Hard `DELETE FROM users WHERE id = $1` — CASCADE cleans children |
| `profiles` | JSONB business details (company name, phone, trading address, VAT, day rate, logo data) | CASCADE-deleted with users |
| `settings` | user_id-keyed key/value JSONB (theme, voice_dictation toggle, etc.) | CASCADE |
| `jobs` | client_name, site_address, total_amount, JSONB `quote_snapshot` (entire quote payload), `rams_snapshot`, `client_snapshot` + `client_snapshot_profile` (frozen at-send time), client_token, client_ip, client_user_agent | CASCADE — but see "scrub-but-keep-learning" below |
| `drafts` | user_id-keyed JSONB of in-progress quote work | CASCADE |
| `user_photos` | user_id-keyed slot photos (TEXT base64) — the actual property images | CASCADE |
| `quote_diffs` | user_id, job_id, ai_value, confirmed_value — the LEARNING data | CASCADE on user deletion. If asked to keep learning value, see below. |
| `agent_runs` | user_id, job_id, input_summary, output_summary, model, tokens, error messages | CASCADE — input/output summaries may contain PII pulled from the job |
| `calibration_notes` | approved_by user_id only — no end-client PII | Doesn't need erasure for a homeowner request; user_id stays |
| `admin_audit` | actor_id, action, details JSONB — admin actions only | Audit retention argument: keep, OR scrub user_id on the requester's account row only |
| `agent_retry_queue` | user_id, payload JSONB | CASCADE (payload may hold completion feedback text) |
| `dictation_runs` | user_id, latency/byte telemetry only — no transcript text | CASCADE |
| `session` | session JSON contains the user's serialized id; expires naturally; safe to DELETE on cancellation |
| `system_errors` | optional user_id (NULL for anonymous errors), route, stack, user_agent | DELETE rows where user_id matches |
| `pageviews` | optional user_id (anonymous by default), path, referrer, ua_hash | DELETE rows where user_id matches; rest is anonymous already |

**CASCADE summary** — most child tables have
`user_id TEXT REFERENCES users(id) ON DELETE CASCADE`, so a single
`DELETE FROM users WHERE id = $1` removes them too. Exceptions:
- `agent_runs.job_id` is `ON DELETE SET NULL` (the agent run survives
  if the job is deleted, but the link to it is severed)
- `calibration_notes.approved_by` and `admin_audit.actor_id` have
  no cascade — those rows reference the user but the user_id stays
  even after a CASCADE-delete (Postgres allows orphan FKs when no
  action is specified)
- `system_errors` and `pageviews` have nullable user_id with no
  CASCADE — must be DELETEd explicitly

### Off-platform locations

| Location | Personal data | Erasure approach |
|---|---|---|
| **Cloudflare R2 — backups** | Encrypted PG dumps containing whatever was in the DB at backup time | **Cannot surgically edit.** Backup retention is 7 daily + 4 weekly. Data ages out within ~5 weeks of erasure. Document this honestly to the requester. |
| **Anthropic** | Photos + transcripts sent during the live quote analysis | Per Anthropic API terms: inputs not retained beyond the API request. No erasure required from us — request to Anthropic if the requester wants written confirmation. |
| **OpenAI Whisper** | Audio sent during voice dictation / video transcription | Audio is in-memory only on FastQuote side; OpenAI's retention is per their API policy (typically 30 days). |
| **Railway logs** | May contain user_id strings, IP addresses (Railway's HTTP access logs) | Railway logs auto-rotate; we don't manually edit them. If the request is urgent, contact Railway support. |
| **Google OAuth** | Google holds the link between their user and our `auth_provider_id` | Out of our scope — direct the requester to Google's account settings. We DO delete our copy of `auth_provider_id` on erasure. |
| **Email inbox** | The original erasure request email itself | Move to a "GDPR / erasure" folder; don't delete (UK GDPR allows keeping the audit trail of the request). |

---

## Runbook: full account cancellation (waller asks to delete their account)

```bash
# 0. Confirm identity. Email reply from the address on file is enough
#    for current scale. If the request came from elsewhere, ask them
#    to send from the account email.

# 1. Take a fresh backup BEFORE deleting anything (TRQ-147).
#    The deletion is reversible if it turns out to be wrong-account.
#    Trigger an on-demand backup via Railway → backup service → Run now.
#    Wait for "backup-to-r2: ok" in the logs.

# 2. Snapshot the current row counts so we know the legitimate drop.
DATABASE_URL=$PROD_DATABASE_URL npm run check:moat
# Note quote_diffs, agent_runs, calibration_notes counts.

# 3. Find the user's id.
psql "$PROD_DATABASE_URL" -c \
  "SELECT id, name, email, created_at FROM users WHERE email = 'user@example.com';"

# 4. Survey what will be deleted (READ ONLY — no destructive command yet).
psql "$PROD_DATABASE_URL" <<SQL
\set user_id 'the-id-from-step-3'
SELECT COUNT(*) AS jobs FROM jobs WHERE user_id = :'user_id';
SELECT COUNT(*) AS quote_diffs FROM quote_diffs WHERE user_id = :'user_id';
SELECT COUNT(*) AS agent_runs FROM agent_runs WHERE user_id = :'user_id';
SELECT COUNT(*) AS user_photos FROM user_photos WHERE user_id = :'user_id';
SELECT COUNT(*) AS drafts FROM drafts WHERE user_id = :'user_id';
SELECT COUNT(*) AS dictation_runs FROM dictation_runs WHERE user_id = :'user_id';
SELECT COUNT(*) AS pageviews FROM pageviews WHERE user_id = :'user_id';
SELECT COUNT(*) AS system_errors FROM system_errors WHERE user_id = :'user_id';
SQL

# 5. Reply to the user with the inventory above so they can confirm.
#    "I'll delete N jobs, N photos, N learning records. Backups containing
#    your data will age out within 5 weeks. Confirm to proceed?"

# 6. On their confirmation, perform the erasure in a transaction.
#    All tables with CASCADE will follow `users` automatically.
#    The non-cascading tables (system_errors, pageviews) are explicit.
psql "$PROD_DATABASE_URL" <<SQL
BEGIN;

-- Non-cascading PII locations first
DELETE FROM system_errors WHERE user_id = 'the-id-from-step-3';
DELETE FROM pageviews     WHERE user_id = 'the-id-from-step-3';

-- The main delete — CASCADE cleans profiles, settings, jobs,
-- drafts, user_photos, quote_diffs, agent_runs, dictation_runs,
-- agent_retry_queue.
DELETE FROM users WHERE id = 'the-id-from-step-3';

-- Verify before COMMIT
SELECT COUNT(*) FROM users WHERE id = 'the-id-from-step-3';     -- expect 0
SELECT COUNT(*) FROM jobs  WHERE user_id = 'the-id-from-step-3'; -- expect 0

COMMIT;
SQL

# 7. Verify post-erasure moat counts.
DATABASE_URL=$PROD_DATABASE_URL npm run check:moat
# Expect: quote_diffs + agent_runs counts DROPPED by the user's
# share, but BOTH still above the production floor (100). If a
# single user's erasure pushes either table below floor, halt and
# ask Harry. That likely means a stale floor in scripts/check-moat.js
# rather than a corrupt erasure.

# 8. Email the user: "Erasure complete. Backups containing your data
#    will age out by <date 5 weeks from now>. Reply if you have any
#    questions or believe data remains."

# 9. Move the request email into the GDPR/erasure folder. Note
#    timestamp + scope in your records.
```

### Edge cases

- **The user has open Stripe subscriptions** (post-TRQ-150). Cancel
  Stripe FIRST — refund any pro-rated balance manually before DB
  deletion. Stripe holds payment records separately under their own
  retention; we cannot erase those.
- **The user is `mark` or `harry`** (the seed/admin users). Refuse —
  these are the project's own administrators; deleting one is a
  separate decision.
- **client_token-active jobs.** If a job's client portal link is
  live, the homeowner may be mid-decision. The waller's deletion
  takes precedence, but consider whether to email any pending
  homeowner first.

---

## Runbook: homeowner-data erasure (the harder case)

A homeowner asks the waller to scrub their data from a quote. The
waller forwards the request. We can do this **without** deleting
the waller's account.

### The principle: scrub PII, keep learning where you can

The two things we want to preserve:
- The waller's quote total in their history (they need it for
  accounts / records).
- The anonymous learning value in `quote_diffs` (AI suggestion vs
  waller's confirmed value).

The things we MUST delete:
- The homeowner's name, contact details, site address.
- The property photos.
- The `client_snapshot` (it carries the same data, frozen at-send).
- The audit-only `client_ip` and `client_user_agent`.

### The scrub procedure

```bash
# 1. Find the job(s).
psql "$PROD_DATABASE_URL" -c \
  "SELECT j.id, j.client_name, j.site_address, j.saved_at, u.email
   FROM jobs j JOIN users u ON u.id = j.user_id
   WHERE j.user_id = 'the-waller-id'
     AND (j.client_name ILIKE '%the-homeowner-name%' OR j.site_address ILIKE '%their-postcode%');"

# 2. Take a backup (same as full-cancellation step 1).

# 3. Scrub PII columns + nullify JSONB-embedded PII inside snapshots.
#    The quote_snapshot JSONB is the trickiest — it contains the
#    full client block. We surgically NULL out client-identifying
#    paths but keep measurements / costs / model output.
psql "$PROD_DATABASE_URL" <<SQL
BEGIN;
UPDATE jobs SET
  client_name = '[erased]',
  site_address = '[erased]',
  client_ip = NULL,
  client_user_agent = NULL,
  client_snapshot = NULL,
  client_snapshot_profile = NULL,
  client_decline_reason = NULL,
  -- Surgically scrub the same fields inside the JSONB snapshot
  -- without touching reviewData / quotePayload / diffs.
  quote_snapshot = jsonb_set(
    jsonb_set(
      jsonb_set(quote_snapshot, '{jobDetails,clientName}', '"[erased]"'),
      '{jobDetails,siteAddress}', '"[erased]"'
    ),
    '{jobDetails,clientEmail}', '""'
  )
WHERE id = 'the-job-id';

-- Photos — these carry the actual property images. Delete.
DELETE FROM user_photos WHERE user_id = 'the-waller-id'
  AND context = 'the-job-id';

-- Any quote_diffs anonymisation is automatic — diffs don't store
-- client identity, just measurement values + confidence. They stay.

COMMIT;
SQL

# 4. Verify
psql "$PROD_DATABASE_URL" -c \
  "SELECT id, client_name, site_address FROM jobs WHERE id = 'the-job-id';"
# Expect both '[erased]'.

# 5. Confirm to the waller + homeowner. Note that the photos are
#    also gone from the live database; backups will age out in 5 weeks.
```

### When scrub doesn't cleanly preserve learning value

For some quote types the PII is woven into the AI prompt context
(e.g. a brief note saying "Mrs. Smith wants the wall raised by
500mm because of overlooking concern from next door"). In those
cases, scrubbing the note destroys the AI input context. **Err
toward honouring the erasure request** — that's the law. The
small loss to learning value is acceptable.

---

## Interaction with the moat-integrity check (TRQ-146)

A legitimate erasure reduces `quote_diffs` and `agent_runs` row
counts. The production floors in `scripts/check-moat.js` are 100
each, set generously enough that a single user's erasure shouldn't
drop below them at current scale.

**If an erasure DOES push a moat table below its floor:**

1. Halt. Take a fresh snapshot of post-erasure counts.
2. Decide whether to lower the floor (the production scale really
   has fallen) or whether this is an unusual large-account
   erasure that shouldn't drive policy.
3. Update `scripts/check-moat.js` in a PR if the floor needs to
   change. The change goes through review (per branch protection)
   so the floor isn't quietly lowered.

The moat-integrity tripwire is NOT meant to obstruct legitimate
erasures. It's there to catch catastrophic destruction (an entire
table dropped, truncated). Erasing one user's rows is a normal
operation and should pass.

---

## Audit trail

For every erasure:

- Save the original request email (move to GDPR folder, don't delete).
- Save the SELECT output from step 4 (the inventory) in your own
  records: user id, table counts, date.
- Note the date of the eventual backup-aging-out so you can confirm
  to the user when their data is fully gone (~5 weeks).
- Do NOT log PII into `admin_audit`. The point of erasure is to
  remove the person's data, not to write it into a separate
  immortal audit table.

UK GDPR allows keeping a record of the fact-of-deletion (the
metadata) — that's what these notes are. Don't keep a record of
what was deleted (the deleted content itself).

---

## What this runbook deliberately doesn't include

- **A self-serve "Delete account" button.** Not yet. Manual gives
  Harry a chance to confirm + check for edge cases. Add when
  active accounts cross ~50.
- **Anonymising existing learning data en masse.** `quote_diffs`
  already holds no PII directly — diffs are numeric measurements
  + AI/confirmed value pairs. No bulk scrub needed.
- **Automated deletion-window scheduling.** Postgres doesn't ship
  with a "delete in 30 days" feature; if we ever want this it
  would be a cron, not a fragile trigger.
- **GDPR data-export ("right to portability").** Separate ticket
  when needed — the Privacy Policy mentions it but the JSON
  export route already exists at `/api/users/:id/export`. That
  route may need a documentation pass on its own.

---

## Hard rules (per the agent constitution)

Every step in this runbook follows the safety constitution:

1. **No `DELETE` / `UPDATE` without a scoped `WHERE`** — every
   query in this runbook has a `WHERE id = ...` or
   `WHERE user_id = ...`.
2. **Backup first** — step 1 of every procedure.
3. **Transaction-wrapped destructive ops** — BEGIN / COMMIT around
   every multi-row change so a partial failure rolls back.
4. **`check-moat.js` before and after** — verifies the live
   database is healthy on both sides of the operation.

If anything in the runbook conflicts with the constitution, the
constitution wins. Stop and ask.
