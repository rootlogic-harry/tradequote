# Clients feature — rollback runbook

Three independent revert levers, applied in order of decreasing severity. Try the lightest one first.

## Prerequisite

Before ANY of these run, take a fresh backup:

```bash
# On Harry's laptop, with railway CLI linked to tradequote
node scripts/backup-to-r2.js  # writes to fastquote-backups R2 bucket
```

Confirm the backup landed in R2 before continuing. See `docs/BACKUP.md`.

---

## Lever 1 — Flag off (30 seconds, no deploy)

The safest option. Instantly hides all Client/Site surfaces without touching data.

```bash
# 1. Set the flag off on Railway (auto-redeploys the app service)
railway variables --set "CLIENTS_ENABLED=false"

# 2. Confirm in Railway logs that the new deploy shipped and the app
#    is responding
curl -sI https://fastquote.uk/ | head -3
```

What this does:
- New Client routes (`/api/users/:id/clients`, `/sites`, etc.) return 404
- SPA's `/clients` route hides from navigation
- Duplicate merge banner disappears from the SavedQuotes surface
- `PATCH /jobs/:id/details` reverts to pre-Clients behaviour (only touches `quote_snapshot`, NOT the Site row)
- Existing Client + Site rows in the DB sit untouched — the data is safe if you want to re-enable later
- Existing quote flow unaffected

What it does NOT do:
- Roll back the SCHEMA (tables + column stay; they're additive and cost nothing)
- Roll back the CODE (route handlers stay in-tree; they just refuse to serve requests when the flag is off)

If you want to re-enable later, flip the flag back on. Everything resumes.

---

## Lever 2 — Code revert (5 minutes, one PR)

If the flag-off state is confusing (dead code, orphan tests) OR if we want to fix the code and re-ship cleanly.

```bash
# 1. Find the merge commits for PRs #2 through #5 (schema, routes, UI, backfill)
gh pr list --state merged --search "clients"

# 2. Revert them in reverse order
gh pr revert <UI_PR_NUM>
gh pr revert <ROUTES_PR_NUM>
gh pr revert <SCHEMA_PR_NUM>

# 3. Merge the revert PRs
```

What this does:
- Removes all Client/Site route handlers, UI components, and helper code
- Removes the `CLIENTS_ENABLED` flag references
- Reverts the `PATCH /jobs/:id/details` extension to its pre-Clients shape
- Leaves the schema (tables + column) IN PLACE — additive migrations are idempotent, dropping the tables is a separate operation (see Lever 3)
- Leaves any Client + Site rows created before revert IN PLACE — they become orphaned but harmless

What it does NOT do:
- Drop the tables
- Delete any Client, Site, or backfilled data

Useful when the code is broken but data is fine, or when you want to try a different implementation approach later.

---

## Lever 3 — Data revert (last resort)

Only run this if the backfill went wrong (bad dedupe outcome, corrupted rows) and re-running from scratch is cheaper than fixing forward. **Requires an explicit "yes, wipe" from Harry.**

```bash
# 1. Confirm backup landed (see Prerequisite above)

# 2. Confirm you understand what this deletes
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM clients) AS clients_total,
    (SELECT COUNT(*) FROM clients WHERE deleted_at IS NULL) AS clients_active,
    (SELECT COUNT(*) FROM sites) AS sites_total,
    (SELECT COUNT(*) FROM jobs WHERE site_id IS NOT NULL) AS jobs_with_site_id;
"

# 3. Run the undo script (transactional; verify counts after)
psql "$DATABASE_URL" -f scripts/undo-clients-backfill.sql
```

The script (in `scripts/undo-clients-backfill.sql`, shipped with PR #2):

```sql
BEGIN;

-- Detach all jobs from sites. No data loss — jobs still carry their
-- inline client_name / site_address / quote_snapshot.jobDetails copies.
UPDATE jobs SET site_id = NULL WHERE site_id IS NOT NULL;

-- Drop rows. FK order matters: sites first, then clients.
DELETE FROM sites;
DELETE FROM clients;

-- Verify quote_diffs and users tables are UNTOUCHED.
SELECT
  (SELECT COUNT(*) FROM quote_diffs) AS quote_diffs_after,
  (SELECT COUNT(*) FROM users) AS users_after;

COMMIT;
```

What this does:
- Wipes every Client and Site row (both active and soft-deleted)
- Sets `jobs.site_id = NULL` on every job
- Preserves all inline client data (`jobs.client_name`, `jobs.site_address`, `jobs.quote_snapshot.jobDetails.*`)
- Preserves `quote_diffs` (the moat)
- Preserves `users`, `profiles`, `sessions`, everything else

What it does NOT do:
- Drop the `clients` / `sites` tables or the `site_id` column
- Break the quote flow (still writes to inline fields regardless)
- Touch photos, RAMS, or any other user data

After this runs, you can re-run the backfill from scratch (with a corrected dedupe rule) OR leave the tables empty and rely on lazy creation from that point forward.

**Never run Lever 3 without a fresh backup + Harry's explicit confirmation.**

---

## Table drop (nuclear, avoid unless you're sure)

If we decide the whole Clients feature was wrong and we want the schema clean:

```sql
BEGIN;
-- Detach any remaining site_id first.
ALTER TABLE jobs DROP COLUMN IF EXISTS site_id;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS clients;
COMMIT;
```

This is not scripted deliberately — running it should require you to open psql, paste it, and be aware of what you're doing.

---

## Recovery — going back to enabled after a rollback

The three levers are undoable in reverse:

- Lever 1 → `railway variables --set "CLIENTS_ENABLED=true"` and everything works again (assuming schema + code still in place).
- Lever 2 → cherry-pick the reverted PRs back onto main, or re-open + re-merge.
- Lever 3 → re-run the backfill script from `scripts/backfill-clients.sql` (see PR #5). Lazy creation from that point onwards will populate rows for new saves.

---

## Verification after any rollback

Run the smoke suite against production:

```bash
npm run smoke
```

All 27 tests should pass. If any fail, the rollback introduced a regression — investigate BEFORE assuming the rollback succeeded.
