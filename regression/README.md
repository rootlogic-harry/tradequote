# FastQuote regression suite

Detects whether changes to the system prompt, the self-critique prompt, the
model, or the analysis pipeline have **moved the quote output outside the
model's natural noise band** for a fixed set of representative jobs.

LLM outputs are not deterministic, even at low temperature. We don't try to
fix that — we baseline the noise on known jobs, then watch for shifts.

## Concepts

- **Fixture** — a representative job (photos + job details + the
  tradesman's confirmed "ground truth" output after editing in Step 4).
  Lives in `regression/fixtures/*.json`. Photos live alongside as files.
- **Run** — one execution of one fixture against an `/analyse` endpoint.
  Usually we run each fixture N times (default 3) to estimate the noise.
- **Baseline** — the saved mean and standard deviation of a fixture's
  outputs under the current prompt + model + pipeline. Stored in
  `regression/baselines/<fixture-id>.json`. Updated explicitly, never
  silently — a baseline change means we're accepting a new normal.
- **Tolerance** — per-field allowed deviation in the fixture's
  `groundTruth`. Numeric tolerances are `{ value, tolerance }` where
  tolerance is a fraction (0.15 = ±15%) or an absolute (`abs: 0.5`).
  Numeric values within `value ± tolerance` of the ground truth pass.

## Workflow — adding a fixture

There are two paths: the **automated extractor** (preferred — the
typical "Mark just completed a job, snapshot it" case) and the
**hand-built path** (synthetic fixtures that exercise a specific
failure mode).

### Automated — `scripts/build-fixture-from-job.js`

Mark's completed jobs in production already contain ground truth —
`jobs.quote_snapshot.reviewData` is whatever he confirmed in Step 4
after editing the AI's draft. The extractor reads that snapshot +
the job's photos straight from the DB and writes a fixture in the
right shape.

```bash
# 1. Restore the latest R2 backup locally (see docs/RESTORE.md).
#    This gives you a localhost-only Postgres on an ephemeral port.

# 2. Point DATABASE_URL at the restored DB. The script REFUSES to run
#    against railway.app / rlwy.net hosts as a belt-and-braces guard.
export DATABASE_URL="postgres://restore_user@localhost:55432/restore_scratch"

# 3. Extract a fixture. The id defaults to a slug derived from the
#    job's site_address; pass --id to override.
node scripts/build-fixture-from-job.js <job_uuid>
node scripts/build-fixture-from-job.js <job_uuid> --id pro-drive-221
node scripts/build-fixture-from-job.js <job_uuid> --output regression/fixtures --force
```

Sample output:

```
build-fixture-from-job: connecting to host=localhost database=restore_scratch

Fixture written: /…/regression/fixtures/pro-drive-221-high-greave-sheffield-s5.json
  id              pro-drive-221-high-greave-sheffield-s5
  measurements    4
  materials       2
  totalAmount     £4500
  estimatedDays   3
  numberOfWorkers 2
  photos          4 / 5
  - overview         842.1 KB  overview.jpg
  - closeup          612.4 KB  closeup.jpg
  - sideProfile      733.0 KB  sideProfile.jpg
  - access           498.7 KB  access.jpg
  source job_id   11111111-2222-3333-4444-555555555555

Review the fixture, mark any forbidden materials, then commit.
```

After it writes the fixture JSON + photos:

1. Open the JSON and mark any materials that should NOT appear in a
   fresh analysis as `"forbidden": true`. The extractor leaves this
   judgement to you — it can only tell what WAS in the quote, not what
   shouldn't be.
2. Confirm the sanitised `inputs.siteAddress` still has enough regional
   context to be useful (postcode trimmed to outward half by default).
3. Run the suite to establish the baseline (see below).

#### Privacy posture (READ THIS)

The fixture JSON gets PII redacted (postcode trimmed to outward half,
street/house numbers + street name redacted, customer name from
`briefNotes` redacted, email + phone swept). **Photos are NOT
sanitised.** They contain real customer property — house exteriors,
walls, sometimes faces in the background.

This trade-off was explicit:
- The regression suite is useless without representative imagery.
- The fixtures live in a **private repo**; access is restricted to
  Mark + Harry + agents operating on Harry's behalf.
- Re-encoding/blurring photos would invalidate the suite (the model
  sees materially different inputs from production).

**Do NOT fork or mirror this repo publicly without redacting
`regression/fixtures/*/photos/`.** If you push these to a CI service,
ensure CI logs do not echo photo contents. The extractor itself
never logs photo bytes to stdout/stderr — only summarised sizes.

### Hand-built — synthetic fixtures

For specific failure modes (e.g. "the model over-counts stones when
the reference card is missing"):

1. Pick or fabricate inputs that trigger the failure mode.
2. Drop photos in `regression/fixtures/<fixture-id>/photos/` and
   reference them by relative path.
3. Hand-write the ground truth values you want to lock down.
4. Decide per-field tolerances. Suggested defaults:
   - Wall measurements: ±15% (or ±150mm absolute, whichever larger)
   - Stone tonnage: ±20%
   - Labour days: ±0.5 days absolute
   - Total quote: ±10%
   - Material composition: every line in `groundTruth.materials` must
     have a matching `description` substring in the AI output

5. Run the suite once to establish the baseline:
   `npm run regression -- --fixture <id> --iterations 5`
   This stores `regression/baselines/<id>.json` with the run's mean,
   std, and per-field pass/fail counts.

## Workflow — running before a prompt change

1. `npm run regression` — runs all fixtures against the current code
   N times each. Writes a report to `regression/reports/YYYY-MM-DD-HH-MM.md`.
2. Make your prompt change.
3. `npm run regression` again. Same report path with a new timestamp.
4. The report shows per-fixture and per-field `was X / now Y` deltas
   against the saved baseline (if any). Look for:
   - Mean shifted toward ground truth → **improvement**
   - Mean shifted away → **regression**
   - Std widened → noise increased; the change made the model
     less stable, even if the mean is still in range
   - Pass rate dropped on any field → hard regression
5. Decide: accept (`npm run regression -- --bless` to update baselines)
   or reject (revert the change).

## Flags

| Flag | Effect |
|------|--------|
| `--iterations N` | Iterations per fixture (default 3) |
| `--base-url URL` | FastQuote endpoint (default `http://localhost:3000`) |
| `--user-id ID`   | User to impersonate via `x-test-user-id` (default `markdoyle`) |
| `--fixture ID`   | Run only the named fixture |
| `--no-write`     | Don't write a report or baseline file (stdout only) |
| `--strict`       | Treat skipped fixtures as failures. Also via env `REGRESSION_STRICT=1`. CI flips this on once at least one real fixture is committed — see "When to enable strict in CI" below. |
| `--require-min-fixtures N` | Exit non-zero if fewer than N runnable fixtures exist (default 0). Use once fixtures land to guard against "someone moved the photos dir and we didn't notice". |
| `--bless`        | Write per-fixture baselines to `regression/baselines/<id>.json`. A baseline change is a conscious accept-the-new-normal decision — never silent. Combine with `--no-write` for a dry-run. |

## Baselines

`regression/baselines/<fixture-id>.json` captures the mean, std dev,
and per-field pass rate of a blessed run, plus the `promptVersion`
hash. Subsequent runs load the baseline (if any) and show `was X / now
Y` deltas in the report.

Baseline files **are** committed to git — they're the audit trail of
"what passing looked like at the point we accepted it". The diff on a
baseline file is itself meaningful: a PR that changes a baseline is
saying "the new mean is the new normal, please review".

If a baseline was blessed under a different prompt version than the
current run, the report shows a warning line: "baseline was prompt vX,
this run is prompt vY — deltas may not be comparable". Re-bless after
prompt changes to keep deltas trustworthy.

## When to enable strict in CI

Today the GitHub Actions workflow does NOT pass `--strict`. That's
deliberate: with no real fixtures committed, every run skips and
strict mode would fail every PR. Once the first real fixture lands
(see TRQ-173), update `.github/workflows/regression.yml` to pass
`--strict` so a fixture that fails to load (missing photo, JSON
typo) becomes a CI failure instead of a silent skip.

## Cost

Default 3 iterations × 5 fixtures = 15 analyse calls = ~£0.50 of Sonnet
tokens per full run. Not free — don't run on every push, run on
prompt/model changes.

## Files

```
regression/
  README.md            this file
  fixtures/            one .json + photos/ per fixture
  baselines/           saved noise band per fixture (committed to git)
  reports/             markdown output of each run (NOT committed)
  lib/
    compare.js         pure comparator (numeric, word-boundary material match)
    runner.js          loads fixture, posts to /analyse, captures output + raw
    reporter.js        markdown renderer (per-field pass rate, raw-on-fail, deltas)
    baseline.js        baseline payload builder, loader, writer, delta computer
    cli.js             arg parser + exit-code decision (strict, min-fixtures, bless)
    fixtureLoader.js   fixture validation
  run.js               CLI entry point — `npm run regression`
```

## What's committed

| Path | Committed? | Why |
|------|-----------|-----|
| `regression/baselines/*.json` | YES | Audit trail of "what we accepted as passing". The diff on a baseline file is itself meaningful — a PR that bumps a baseline is the explicit accept-the-new-normal moment. |
| `regression/reports/*.md`     | NO  | Timestamp-named, regenerated every run. The latest is uploaded as a CI artifact on each PR. See `.gitignore`. |
| `regression/fixtures/*.json`  | YES | Fixture definitions. |
| `regression/fixtures/*/photos/` | varies — see TRQ-173 | Customer photos are PII-sensitive. Real fixtures may keep photos out of git and rely on CI to fetch them from object storage (decision pending). |

## What this suite does NOT do

- It does **not** make the model deterministic.
- It does **not** replace user feedback. Mark saying "this was wildly off"
  is a higher-signal failure than the suite ever produces.
- It does **not** test surfaces outside the analysis pipeline (it doesn't
  exercise the portal, PDF export, save flow, etc. — those have unit tests).
- It does **not** cover jobs unlike the fixtures. The suite is sampling, not
  exhaustively testing. A 6-photo brick-cladding job behaves differently
  from a 5-photo dry-stone fixture.

It does one thing: distinguishes noise from regression on a fixed set of
known jobs. That's the missing eval surface as of the last QE review.
