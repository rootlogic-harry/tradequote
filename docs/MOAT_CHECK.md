# Moat-integrity check

## What this is

`scripts/check-moat.js` is a small tripwire that asserts the three
irreplaceable learning tables exist and look plausible. If an autonomous
run quietly degrades the moat — drops a table, truncates rows, breaks a
schema — the check trips an alarm instead of letting the damage sit
unnoticed.

The protected tables:

| Table | Holds | Why it matters |
|---|---|---|
| `quote_diffs` | Per-field AI-vs-confirmed value diffs from every saved quote | The core learning signal. Each row records what the model proposed vs what the tradesman actually used. |
| `calibration_notes` | Approved system-prompt adjustments | Tuning that's already been applied. Includes a hard-coded migration row that should always be present. |
| `agent_runs` | Every analyse / self-critique / feedback / calibration execution | Drives spend, reliability, and per-quote token analytics. |

These are CASCADE-deleted when a user is deleted, but otherwise immutable
(append-only). They cannot be regenerated from anything else in the
system.

## How to run it

```bash
DATABASE_URL=postgres://… node scripts/check-moat.js
```

or via npm:

```bash
DATABASE_URL=postgres://… npm run check:moat
```

### Flags

- `--json` — machine-readable output (single JSON object). Used by CI
  and post-deploy hooks.
- `--fresh` — relax row-count floors to zero. Use this against a
  freshly-restored scratch database (TRQ-148) where the moat hasn't been
  populated yet. In production mode the floors are: `quote_diffs ≥ 100`,
  `calibration_notes ≥ 1`, `agent_runs ≥ 100`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Every check passed |
| `1` | At least one moat check failed (missing table, row count below floor) |
| `2` | Configuration error (no `DATABASE_URL`, connection refused, query timed out) |

CI / Railway smoke checks should treat `1` as a hard fail and `2` as a
"could not run" (page someone, but don't assume the moat is broken).

## When to run it

| Situation | Run mode | Notes |
|---|---|---|
| After any DB-touching ticket (TRQ-140, TRQ-149, migrations) | prod | Catches "did I accidentally truncate something". |
| After every restore-test (TRQ-148) | `--fresh` | Confirms the restored DB at least has the schema. |
| Post-deploy on production | prod | A passing run is the green light that the deploy didn't drop a table. |
| Locally during development | prod (against staging once it exists) | Fast sanity check; takes <1s. |

## Why the floors are what they are

The floors are deliberately generous. They don't try to predict growth.
They catch the catastrophic case: a table gone, truncated to empty, or
the schema drifted to where the table no longer exists at all. Routine
quoting activity easily clears these floors within the first day of use.

If you genuinely need to start a new database from zero — e.g. a clean
EU migration target — use `--fresh` and run the prod-floor check again
once the data has been loaded.

## Performance + safety

- Cheap: three `SELECT COUNT(*)` queries. Sub-second on production
  shape.
- Hard 5s connection + statement timeout — the script can never hang a
  deploy.
- Read-only. Never writes.
- No secrets are emitted to logs — only table names and counts.

## Why it's not in the CI workflow

The CI workflow (`/.github/workflows/ci.yml`) runs against a
deterministic test suite without a live database. The moat check needs
the real production database, so it lives outside CI and runs as a
post-deploy step + as an on-demand command. CI is for code correctness;
the moat check is for data integrity.
