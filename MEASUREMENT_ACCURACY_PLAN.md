# Measurement accuracy plan — "right first time"

**Goal:** minimise the number of measurements a user has to edit on Step 4 by getting them right at analysis time. Investment: ~1 hour, no new infrastructure.

## Current measurement pipeline in one paragraph
User uploads 5 photos (or a 3-min video → up to 50 uniformly-sampled frames) → server builds a single payload containing all images + `briefNotes` + `siteAddress` → Claude Sonnet 4 analyses under the server-side `SYSTEM_PROMPT` → Claude emits JSON including `measurements[]` each with `displayValue` + `confidence: high|medium|low` + `referenceCardDetected: boolean` → `aiParser.js` validates the schema (structure only, no plausibility bounds) → state flows to Step 4 where each measurement appears in `MeasurementRow` with a CONFIRM button. User must tap CONFIRM on every row before Generate Quote enables.

## Where accuracy is lost today
1. **No ground-truth injection.** The user frequently *knows* dimensions of things in frame (gate widths, fence posts, doors). The UI doesn't ask. Claude has to guess scale from nothing.
2. **Reference card is all-or-nothing.** Present → confident measurements. Absent → `confidence: "low"` but the number Claude picked is still the number the user sees.
3. **Claude's confidence is self-graded and optimistic.** In practice Claude over-marks `medium` when it should be `low`. Nothing post-hoc audits this.
4. **No plausibility bounds.** A measurement of 15m wall height passes validation silently (fine in theory — Pendle Forest has tall walls; risky in practice — Claude occasionally off by 10×).
5. **No chain-of-thought in the prompt.** Claude emits numbers without explicit reasoning. No opportunity for the model to catch its own mistakes.
6. **Capture UX doesn't coach.** No "include a tape measure or a known-size object" hint.

## The hour's plan (ranked by ROI)

### 1. **Prompt overhaul — rigorous measurement methodology** (highest ROI, ~15 min)
Add a `MEASUREMENT METHODOLOGY` section that forces Claude to:
1. First pass: list every object in-frame whose size is known or standard (reference card, doors, gates, bricks, fence posts, vehicles). Call these `scaleAnchors`.
2. Use the user-supplied `briefNotes` as authoritative on scale ("the gate is 1.2m wide").
3. Establish scale from the most reliable anchor available. If only low-reliability anchors available, set all measurement confidences to `low`.
4. Before emitting each measurement, sanity-check against domain bounds:
    - Dry stone wall height: typically 800–2000mm. 3000mm+ is rare — flag.
    - Breach length: typically 500–15000mm. 20000mm+ is exceptional.
    - Wall thickness: 400–900mm. Outside → flag.
5. Add a new schema field `measurementReasoning` (string, hidden from basic users) where Claude narrates how it arrived at the scale. Admins can inspect for debugging.

### 2. **User-supplied scale references — `scaleReferences` field** (high ROI, ~15 min)
Add an optional text input on Job Details below `briefNotes`:
> *"Anything in the photos we can measure against? (e.g. 'The gate is 1.2m wide' or 'That fence post is 1.8m tall')"*

Plumb it through to the payload. Prompt is updated to treat `USER-PROVIDED SCALE REFERENCES` as the highest-priority anchor when no reference card is detected.

### 3. **Plausibility validation in `aiParser.js`** (medium ROI, ~10 min)
Post-parse, walk every measurement. If `valueMm` is `0`, `< 10`, or `> 100000`, force `confidence = 'low'` and append a note. Not rejection (false positives would break legitimate jobs) — just downgrading confidence so the user actually reviews it.

### 4. **Confidence floor when no reference card** (low effort, high trust impact, ~5 min)
If `referenceCardDetected === false` AND no `scaleReferences` supplied, force every measurement's `confidence` to `low`. Currently Claude chooses per-measurement confidence independently; this enforces the floor in code.

### 5. **Capture UX coaching** (low effort, high behaviour impact, ~5 min)
Update the copy near the photo slots and video upload:
> "📏 **For best accuracy:** include your FastQuote Reference Card, a tape measure, or any known-size object (gate, door, fence post) in at least one photo. Then describe it below."

## Scope out for this session
- Frame selection heuristics (needs CV, 1 week)
- CV-based reference card pre-detection (1 week)
- Second-pass auditor agent (costly, 3 days, invasive)
- Structure-from-motion 3D reconstruction (4 weeks, uncertain)
- Semantic segmentation to isolate the subject wall (already partially addressed by TRQ-79)
- Per-measurement frame evidence tagging (nice but requires prompt schema expansion — do later)
- Measurement-specific learning loop (meaningful only after we have more production data)

## Success criteria
- Tradesmen editing fewer measurements on Step 4 (measurable via `quote_diffs.edit_magnitude` trend over next month)
- Fewer low-confidence rows on jobs where a reference card or scale anchor was provided
- No regression in analysis latency (Claude's CoT adds a small % of tokens; acceptable)
- Admin can inspect `measurementReasoning` for audit

## Rollout
Single commit, single deploy. System prompt change is a protected item per `CLAUDE.md` — but the user explicitly authorised it for this session. Note added to calibration table convention so the next calibration run has a fresh baseline.
