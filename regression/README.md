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

1. Pick a representative real job from production (or a synthetic one
   that exercises a specific failure mode you want to lock down).
2. Export the photos that were attached. Drop them in
   `regression/fixtures/<fixture-id>/photos/` and reference them in the
   fixture JSON by relative path.
3. Capture the ground truth from the saved quote — the values
   Mark/Paul confirmed after the AI's first pass. These are what we
   compare new runs against.
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
4. Diff the two reports. Look for:
   - Mean shifted toward ground truth → **improvement**
   - Mean shifted away → **regression**
   - Std widened → noise increased; the change made the model
     less stable, even if the mean is still in range
   - A fixture that was passing now fails → hard regression
5. Decide: accept (rebaseline) or reject (revert the change).

## Cost

Default 3 iterations × 5 fixtures = 15 analyse calls = ~£0.50 of Sonnet
tokens per full run. Not free — don't run on every push, run on
prompt/model changes.

## Files

```
regression/
  README.md            this file
  fixtures/            one .json + photos/ per fixture
  baselines/           saved noise band per fixture
  reports/             markdown output of each run
  lib/
    compare.js         pure comparator (numeric, set, composition)
    runner.js          loads fixture, posts to /analyse, captures output
    reporter.js        markdown renderer
  run.js               CLI entry point — `npm run regression`
```

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
