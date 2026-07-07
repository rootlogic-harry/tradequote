# FastQuote — Client & Site Records spec (v3)

**Status:** Locked 2026-07-07. Supersedes v2 (which was Harry's draft ahead of Claude review). This is the source of truth for what to build.

**Origin:** Paul Clough's request (organise his pipeline / drop Trello) + Mark Doyle's insurance-work case.

**Pairs with:** `REFERRAL_SPEC_LOCKED.md`, `QUOTE_PACK_SPEC.md`, `CLIENTS_ROLLBACK.md`.

---

## 0. What's locked (do not re-litigate)

Every decision below is settled. If exploration of the real data surfaces something that would materially change one of these, **flag it back to Harry — don't silently pivot.**

- **Two entities**: Client + Site. No third Contact entity. Homeowner is site-contact fields on the Site, not a first-class entity.
- **Option A**: `sites.client_id` is a required FK. A Site belongs to exactly one Client. Same physical address under two Clients = two Site rows. Acknowledged cost, accepted.
- **Invisible split**: the current New Quote flow captures `clientName` + `siteAddress` inline as today. Client + Site rows are created LAZILY on first save (see §5). The relational model never surfaces in the common case.
- **Address propagation**: `sites.address` is CURRENT truth. `quote_snapshot.jobDetails.siteAddress` is HISTORICAL truth (rendered on saved-quote view + client portal, frozen at save time — Pitfall #14). Edit-details PATCH updates BOTH the Site row AND the current job's snapshot; historical/completed jobs at the same site keep their frozen copies.
- **Client status set**: `active` (default) / `needs_visit` / `lost`. That's it. `quoted / won` are DERIVED from a rollup over the Client's jobs — not manual states. Otherwise state drifts.
- **Backfill dedupe rule**: one Client + one Site per existing job, NO dedupe attempted. Ships alongside a "merge duplicates" affordance (§7) so Paul can consolidate manually.
- **Merge affordance**: Client list surfaces name+phone duplicate candidates as a dismissible banner at the top of the list. Merge is destructive (transactional; source rows soft-deleted, all Sites + Jobs reparent to target).
- **Feature flag**: `CLIENTS_ENABLED` env var. Unset = new routes 404, UI hides, `PATCH /jobs/:id/details` behaves exactly as today. Fail-closed default.

---

## 1. Data model

Additive only. New tables + one nullable column on `jobs`.

```sql
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clients_user_id_idx      ON clients (user_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_user_status_idx  ON clients (user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS clients_user_name_idx    ON clients (user_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sites (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id           TEXT NOT NULL REFERENCES clients(id),
  address             TEXT NOT NULL,
  site_contact_name   TEXT,
  site_contact_phone  TEXT,
  notes               TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sites_client_id_idx  ON sites (client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sites_user_id_idx    ON sites (user_id)   WHERE deleted_at IS NULL;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_id TEXT REFERENCES sites(id);
CREATE INDEX IF NOT EXISTS jobs_site_id_idx ON jobs (site_id) WHERE site_id IS NOT NULL;
```

Notes:
- `sites.client_id` FK is NOT `ON DELETE CASCADE` — Client deletion is application-controlled (soft-delete cascades via §6).
- Partial indexes exclude soft-deleted rows so lookups don't scan tombstones.

---

## 2. Feature flag

```js
// CLIENTS_ENABLED === 'true' → routes mount, UI renders, PATCH extension fires.
// Anything else (unset / 'false' / null) → routes 404, UI hides, PATCH is unchanged.
function isClientsEnabled() {
  return process.env.CLIENTS_ENABLED === 'true';
}
```

Sits alongside `EMAIL_INTEGRATION_ENABLED` and `VIDEO_ANALYSIS_ENABLED`. Same fail-closed contract.

---

## 3. Server routes

All auth-gated (`requireAuth + requireOwner` under the global `/api/users/:id` mount), all `billingRateLimit`-throttled, all return **404 when `isClientsEnabled()` is false** so operational disablement is instant.

**None of these routes consume quota.** Verified even at quota exhaustion — organising the pipeline must never be gated.

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/api/users/:id/clients` | List; query params: `search` (matches name/phone/address across owned sites), `status` (comma-sep), `limit`, `cursor` |
| `GET`    | `/api/users/:id/clients/duplicates` | Duplicate candidates for the merge banner. Returns `[{ candidateClientIds, matchType, confidence }]` |
| `POST`   | `/api/users/:id/clients` | Create client + optional first site in one call |
| `GET`    | `/api/users/:id/clients/:clientId` | Detail — client fields + sites list + rollup (§4) + chronological quote timeline |
| `PATCH`  | `/api/users/:id/clients/:clientId` | Whitelist patch on name/phone/email/notes/status |
| `POST`   | `/api/users/:id/clients/:clientId/merge` | Body `{ intoClientId }` — reparent all sites + jobs to target, soft-delete source, transactional |
| `DELETE` | `/api/users/:id/clients/:clientId` | Soft-delete (cascade to sites + jobs, moat-safe per §6) |
| `POST`   | `/api/users/:id/sites` | Create site (requires `clientId`) |
| `PATCH`  | `/api/users/:id/sites/:siteId` | Whitelist patch on address/contact fields; also propagates to `quote_snapshot.jobDetails.siteAddress` on any DRAFT job (`status='draft'`) at the site — historical jobs (sent+) keep their frozen copies |
| `DELETE` | `/api/users/:id/sites/:siteId` | Soft-delete (cascade to jobs) |

---

## 4. Rollup helper (pure function)

`src/utils/clientRollup.js` — exported `resolveClientRollup(jobs)` returns:

```ts
{
  totalWon: number,           // sum(total_amount) WHERE status IN ('accepted', 'completed')
  outstanding: number,        // sum WHERE status = 'sent'
  livePipeline: number,       // sum WHERE status = 'accepted' AND completed_at IS NULL
  lifetimeQuoteCount: number, // total count regardless of status
}
```

Pure function → real behavioural coverage in `clientsRollup.test.js`. Server route calls it after a single JOIN query so we're not doing N+1.

---

## 5. Placeholder client — lazy creation on first save

New Quote flow is **byte-identical** to today for the user. Rows are created LAZILY on first save:

```
On POST /api/users/:id/jobs:
  1. Look up existing client:
       matchByName = SELECT c.* FROM clients c
                     WHERE c.user_id = $userId
                       AND lower(c.name) = lower($jobDetails.clientName)
                       AND c.deleted_at IS NULL
                     LIMIT 1

  2. If match found:
       → attach to that client
       → look up site: SELECT s.* WHERE client_id = matchByName.id AND lower(address) = lower(jobDetails.siteAddress) AND deleted_at IS NULL
       → if match: attach; if not: create Site under matchByName
     (No prompt on POST — client-side "Attach to existing 'John Smith'?" prompt is a UI concern, not a route concern.)

  3. If no client match:
       → if jobDetails.clientName is blank/whitespace:
            create client with name = 'Draft — YYYY-MM-DD HH:MM' (status='needs_visit')
       → else:
            create client with name = jobDetails.clientName (status='active')
       → create site for that client with address = jobDetails.siteAddress || 'Address not set'

  4. Set jobs.site_id
```

- Placeholder clients (status='needs_visit', name starts 'Draft —') surface in the client list with a **"needs a name" chip** so the user is nudged to fix.
- Analytics event: `client_created` with `props: { via: 'quote_save' | 'manual', hadName: bool }`.

---

## 6. Deletion — soft, moat-safe

- Soft-delete Client → set `deleted_at`, cascade set `deleted_at` on all Sites and Jobs owned by the client. Immediate hide from lists. Recoverable within a retention window.
- **`quote_diffs` are never touched**. They carry `user_id` not `client_id`; PII was never stored in them. The moat learning survives client deletion. Moat check script (`scripts/check-moat.js`) is UNCHANGED.
- **Scheduled hard-purge** (runbook: `docs/CLIENTS_HARD_PURGE.md`) after 30 days:
  - Sets `clients.name = NULL, phone = NULL, email = NULL, notes = NULL` on soft-deleted rows past retention.
  - Sets `sites.address = 'purged', site_contact_name = NULL, site_contact_phone = NULL, notes = NULL`.
  - Scrubs `jobs.quote_snapshot.jobDetails.clientName / siteAddress / clientPhone / briefNotes` on soft-deleted jobs.
  - Deletes `user_photos` for those jobs.
  - Leaves rows in place (FK integrity) with all PII columns nulled. quote_diffs untouched.
- Purge is scoped (`WHERE deleted_at < NOW() - INTERVAL '30 days'`), backup-gated, dry-run required.

---

## 7. Merge affordance

**Push-based**: Client list surfaces a dismissible banner at the top listing candidate pairs. Detection:
- Same lower(name), OR
- Same normalised phone (strip whitespace/hyphens), OR
- Same lower(email)

Confidence ranked: name+phone match = high, name-only = medium, phone-only = medium, email-only = low.

**Merge action**: `POST /clients/:id/merge { intoClientId }`
- BEGIN transaction
- `UPDATE sites SET client_id = $intoClientId WHERE client_id = $sourceId AND deleted_at IS NULL`
- (Jobs follow via `site_id` — no direct FK to reparent.)
- Conflict resolution: if a Site with same address already exists under target, merge those Sites too (transactional, all jobs reparent).
- `UPDATE clients SET deleted_at = NOW() WHERE id = $sourceId`
- Copy `phone`, `email`, `notes` from source into target ONLY IF target has NULL for that field (never overwrite user-entered data on the target).
- COMMIT
- Analytics: `client_merged` event.

---

## 8. UI surfaces

- **Client list**: `/clients` route in the SPA. Search box (name/phone/address). Status filter chips (active / needs-visit / lost / all). Duplicate banner at top when candidates exist. Table columns: name, phone, `Total won £`, `Outstanding £`, status. Row click → detail.
- **Client detail**: `/clients/:id` route. Client fields (edit inline). Sites list with per-site quote counts. Rollup card (Total won / Outstanding / Live pipeline / Lifetime quotes). Chronological quote timeline across all sites. "Add site" button.
- **Merge review**: modal opened from banner. Shows source vs target field-by-field. User confirms.
- **Quote flow**: **no change** for the common case. Optional "pick from existing client" affordance appears in Step 2 (JobDetails) when `isClientsEnabled()` AND user has ≥3 saved clients. Even then, typing wins over picking — no forced dropdown.

---

## 9. Analytics events

Additive on `EVENT_NAME_ALLOWLIST`:

- `client_created` — props: `{ via, hadName }`
- `client_updated` — props: `{ fieldsChanged }`
- `client_merged` — props: `{ sourceClientId, intoClientId, siteCount, jobCount }`
- `client_soft_deleted` — props: `{ siteCount, jobCount }`
- `client_hard_purged` — props: `{ purgedCount, retentionDays }`

Fired server-side per existing pattern (best-effort, swallowed).

---

## 10. What's OUT

- Homeowner as first-class entity (site-contact fields only)
- Calendar sync (Apple/Google)
- Invoicing
- Full CRM (kanban, custom stages, reminders, automation)
- Shared/multi-user clients (each client belongs to one waller)

---

## 11. GDPR + docs

- Privacy policy update: `clients` + `sites` now hold PII (name, phone, address, email) as first-class rows persisting independently of a quote.
- Erasure runbook (`docs/RESTORE.md` § erasure) updated to include the two new tables.
- CLAUDE.md Data Model table updated.

---

## 12. Test structure (see `src/__tests__/clients*.test.js`)

Ships in PR #1 (this PR) as failing tests. Following the TDD approach we adopted 2026-06-30.

| File | Focus | Kind |
|---|---|---|
| `clientsSchema.test.js` | server.js SQL for the two tables + `jobs.site_id` column + indexes + feature-flag gating on routes | Source-level guards |
| `clientsRoutes.test.js` | Every route registered + shape (auth + rate-limit + flag-gated + no quota) | Source-level guards |
| `clientsRollup.test.js` | `resolveClientRollup(jobs)` pure function — every branch of totalWon/outstanding/livePipeline/lifetimeQuoteCount, edge cases | Pure behavioural |
| `clientsBackfill.test.js` | Backfill script shape (1 Client + 1 Site per job, no dedupe, idempotent, `quote_diffs` untouched, placeholder naming) | Source-level guards |
| `clientsEditDetailsExtension.test.js` | Existing `PATCH /jobs/:id/details` extends to touch Client + Site rows only when flag on | Source-level guards |

---

## 13. Success criteria (v3)

Everything from §10 of the v2 draft, plus:

- [ ] `CLIENTS_ENABLED` flag: `false` = all routes 404, PATCH `/details` unchanged, quote flow unchanged, no UI surfaces.
- [ ] Merge banner on client list surfaces name+phone dupes with confidence ranking.
- [ ] Client detail rollup renders totalWon / outstanding / livePipeline / lifetimeQuoteCount from a single JOIN.
- [ ] Placeholder client naming ("Draft — YYYY-MM-DD HH:MM") when quote saved with no name, and surfaces as "needs a name" chip on the client list.
- [ ] Address propagation: PATCH `/details` on a specific quote updates both the Site row AND that quote's snapshot; historical/completed jobs at the same site keep their frozen copies.
- [ ] `docs/CLIENTS_ROLLBACK.md` runbook exists + tested on a restored DB copy.

---

*Source: v2 draft + Claude Code v3 review, 2026-07-07. Locked.*
