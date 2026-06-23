# Critique behavioural fixtures (TRQ-177)

Companion to `src/__tests__/selfCritique.test.js`. That suite asserts the
CRITIQUE prompt **contains** strings like "mortar" and "Stone tonnage range" —
it catches accidental prompt deletions but NOT the case where Haiku 4.5 (or
some future Haiku) silently stops following the rule.

This directory holds behavioural fixtures that prove the rule is being
**followed**, not just documented. Each fixture is a pre-baked Sonnet
`analysis` payload that planted one specific failure mode. The test
runs the real production `runSelfCritique` (which calls Haiku) and
asserts the resulting `critique.corrections` contains an entry matching
the planted category, at severity `high` or `medium`.

The pair — prompt-string assertions + behavioural fixtures — is the
difference between "the contract is written down" and "the contract
is being followed".

## Why this is separate from the main `regression/` suite

The main `regression/fixtures/` suite exercises the **Sonnet analysis
endpoint** end-to-end (photos in, analysis JSON out) for noise-band
regression. It needs a running FastQuote server, the `/analyse` route,
and real photographs.

This suite exercises **only the Haiku critique agent** with a hand-built
analysis payload. No photos, no server, no Sonnet. Cheaper to run, faster
to iterate, narrower failure surface — a critique fixture that flips
points at the critique prompt or the Haiku model, never at Sonnet or the
photo pipeline.

## Fixtures committed today

| File | Planted failure | Critique rule | Expected severity |
|------|-----------------|---------------|--------------------|
| `mortar-without-trigger.json` | `lime mortar` line item with no trigger in `damageDescription` or `scheduleOfWorks` | Rule #12 (Mortar over-inclusion) | medium+ |
| `labour-50-days.json` | 50 labour days on a 6sqm rebuild | Rule #2 (Labour days unrealistic) | medium+ |
| `tonnage-20t-1sqm.json` | 20 tonnes of stone for ~1sqm of wall face | Rule #10 (Stone tonnage range, 0.8–1.2 t/sqm) | medium+ |
| `arithmetic-mismatch.json` | `qty=2, unitCost=£100, totalCost=£500` | Rule #11 (Line-item arithmetic) | medium+ |

## Fixture schema

```jsonc
{
  "id":          "kebab-case identifier — must match the filename",
  "name":        "human-readable one-liner",
  "description": "what this fixture is planting and which critique rule should catch it",
  "briefNotes":  "string — the tradesman's brief notes passed to runSelfCritique",
  "analysis":    { /* pre-baked Sonnet analysis JSON, same shape /analyse emits */ },
  "expected": {
    "categoryKeywords": ["mortar"],   // case-insensitive substrings; at least
                                      // one must appear in the matching
                                      // correction's `field` or `issue` field
    "minSeverity":      "medium"      // "medium" passes if any matching
                                      // correction is "medium" or "high".
                                      // "high" requires "high".
  }
}
```

The matching rule is intentionally lenient: Haiku's exact wording will
drift between releases (today it might say "Lime mortar inclusion",
tomorrow "Mortar material — unjustified"). As long as one of
`categoryKeywords` appears in either the `field` or `issue` field of
some correction at the required severity, the fixture passes.

This buys robustness against vocabulary drift while still catching the
case where Haiku stops detecting the failure mode entirely.

## Running

```bash
# Behavioural fixtures (real Haiku calls — costs money, see below)
npm run regression:critique

# Skipped automatically by `npm test` unless RUN_CRITIQUE_FIXTURES=1
# is set in the environment. That keeps the default `npm test` free.
```

The Jest entry point is `src/__tests__/selfCritiqueBehavioural.test.js`.
It calls the real `runSelfCritique` against Haiku 4.5 with a stub
database pool (`agent_runs` writes are no-ops). `ANTHROPIC_API_KEY`
must be set in the environment.

## Cost

Each fixture sends one Haiku 4.5 call with the full analysis payload
in the user message plus the critique system prompt (~1,200 input
tokens, ~400 output tokens). At Haiku 4.5 list pricing ($1/MTok input,
$5/MTok output, ≈£0.78/£3.93 per million) that's roughly:

- Per fixture: 1200 × £0.78/M + 400 × £3.93/M ≈ **£0.0025**
- All four fixtures: **~£0.01 per full run**

First-run cost on this branch: **TODO — re-record after the first
green CI run lands a real Haiku invoice.** Worst-case ceiling is the
ticket's quoted £0.05; Haiku has been cheaper than that for every
agent call so far. Even at 100 runs/month the line item is rounding
error.

## Acceptance — pass rate locked at 100%

CI fails if **any** of the four fixtures stops catching its planted
failure. That includes:

- Haiku returning `corrections: []` (rule stopped firing)
- Haiku returning the correction at `severity: 'low'` (rule fires but
  is no longer load-bearing — should still fail)
- Haiku misclassifying the issue under an unrelated field
- The critique prompt being edited in a way that drops the relevant
  rule (rule #2/#10/#11/#12 in `agents/selfCritique.js`)

## Coordinating with TRQ-175

TRQ-175 is running in parallel on `agents/selfCritique.js`
(`applyCorrectedValues`). The behavioural tests live in a separate
file — `src/__tests__/selfCritiqueBehavioural.test.js` — and never
touch `src/__tests__/selfCritique.test.js`, so the two branches
won't collide on the same diff.

If TRQ-175's `applyCorrectedValues` changes break a fixture's
assertion, that's intentional cross-coverage: the behavioural
fixtures will catch regressions in the apply step too.

## When to bless a new fixture

When a real-world critique miss surfaces (Mark or Paul sends a quote
where the critique should have caught something but didn't), capture
the failing analysis as a new fixture here:

1. Save the raw Sonnet analysis JSON from `agent_runs.output_summary`
   (it's the row immediately preceding the critique row for that job).
2. Trim PII (postcode → outward half, customer names, addresses).
3. Pick `categoryKeywords` based on the critique rule that should have
   fired.
4. Run `npm run regression:critique` to confirm Haiku now catches it
   under the **current** prompt. If it doesn't, fix the prompt first
   (that's the bug, not the fixture).
5. Commit. The new fixture is now part of the locked-100% gate.
