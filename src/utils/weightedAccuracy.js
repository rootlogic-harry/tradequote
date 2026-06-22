/**
 * weightedAccuracy — magnitude-weighted accuracy metric.
 *
 * Why this exists
 * ----------------
 * The existing `calculateAIAccuracyScore` in `diffTracking.js` is an
 * edit-presence metric: it counts the fraction of numeric fields the
 * tradesman did not edit at all. A 1% edit and a 100% edit both score
 * as "missed". The 2026-06-22 calibration investigation flagged this
 * as the reason "mid-70s" feels persistent — the metric can't reward
 * getting closer, only getting exact.
 *
 * This module computes a SECOND, complementary metric: per-field
 * accuracy as `1 - clamped(|delta|)` where `delta` is the relative
 * size of the edit. Aggregated to a quote-level mean, then a
 * distribution (mean / p50 / p90) across quotes.
 *
 * It is ADDITIVE — both metrics surface on the Learning Dashboard
 * side by side so the trajectory can be compared.
 *
 * Worked examples
 * ----------------
 *   - Tradesman doesn't edit at all  -> delta=0,    fieldAccuracy=1
 *   - 5% edit                        -> delta=0.05, fieldAccuracy=0.95
 *   - 50% edit                       -> delta=0.5,  fieldAccuracy=0.5
 *   - 200% edit (capped)             -> delta=1.0,  fieldAccuracy=0
 *
 * Skip semantics
 * --------------
 * If `aiValue` can't be parsed as a number (null / missing /
 * non-numeric / garbage string), the field is skipped — NOT scored
 * zero. This mirrors the existing metric's behaviour ("only numeric
 * fields contribute") so the two are apples-to-apples.
 *
 * Empty / no-scoreable-fields returns `null`, deliberately distinct
 * from `0` so the caller can render "no data" vs "model totally off"
 * differently.
 *
 * Pure functions — no DB, no React, no side effects. Tested in
 * `src/__tests__/weightedAccuracy.test.js`.
 */

import { parseAiValue } from './parseAiValue.js';

/**
 * Per-field accuracy contribution: `1 - clamped relative delta`.
 *
 * @param {{ aiValue: any, confirmedValue: any }} diff
 * @returns {number|null} accuracy in [0, 1], or null if not scoreable
 */
export function fieldWeightedAccuracy(diff) {
  if (!diff || typeof diff !== 'object') return null;

  // Use parseAiValue — handles `"2,000mm"`, `"£415"`, `"3.5t"` etc.
  // Returns null for unparseable / missing / non-string-non-number.
  const ai = parseAiValue(diff.aiValue);
  const confirmed = parseAiValue(diff.confirmedValue);

  // Skip when AI didn't produce a number we can score against —
  // don't penalise the model for absent data.
  if (ai === null) return null;
  // Same on the confirmed side: if the tradesman's value can't be
  // parsed (rare; "TBC", "see notes"), skip rather than score zero.
  if (confirmed === null) return null;

  // Relative delta, denominator clamped to 1 to avoid divide-by-zero
  // when aiValue is 0 (e.g. a labour_workers field the AI estimated
  // at 0). At aiValue=0, the delta becomes the raw absolute edit;
  // capped at 1.0 below, so worst case still contributes 0, not -Inf.
  const denom = Math.max(Math.abs(ai), 1);
  const rawDelta = Math.abs(confirmed - ai) / denom;

  // Cap at 1.0 — anything more than 100% off contributes a full
  // miss. Without this, a single extreme outlier (e.g. AI says £10,
  // tradesman confirms £1000 -> 99x delta) would swamp the average.
  const delta = Math.min(rawDelta, 1);

  return 1 - delta;
}

/**
 * Quote-level accuracy: mean of per-field contributions across all
 * scoreable diffs in the quote.
 *
 * @param {Array} diffs — array of { aiValue, confirmedValue, ... }
 * @returns {number|null} mean accuracy in [0, 1], or null if no
 *                        scoreable fields exist
 */
export function quoteWeightedAccuracy(diffs) {
  if (!Array.isArray(diffs) || diffs.length === 0) return null;

  const scores = [];
  for (const d of diffs) {
    const s = fieldWeightedAccuracy(d);
    if (s !== null) scores.push(s);
  }

  if (scores.length === 0) return null;

  const sum = scores.reduce((a, b) => a + b, 0);
  return sum / scores.length;
}

/**
 * Aggregate weighted accuracy across multiple quotes (e.g. a week).
 *
 * Returns the distribution, not just the mean — `p50` and `p90`
 * surface the long tail. A week where mean=0.7 but p90=0.95 tells a
 * very different story from mean=0.7 / p90=0.75.
 *
 * @param {Array<Array>} quotes — array of diff-arrays. Each inner
 *   array is one quote's diffs. (Pre-grouped by job_id upstream.)
 * @returns {{ count: number, mean: number|null, p50: number|null, p90: number|null }}
 *   `count` is the number of quotes that contributed a scoreable
 *   value. `mean`/`p50`/`p90` are null when count is 0.
 */
export function summariseWeightedAccuracy(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) {
    return { count: 0, mean: null, p50: null, p90: null };
  }

  const perQuote = [];
  for (const q of quotes) {
    const s = quoteWeightedAccuracy(q);
    if (s !== null) perQuote.push(s);
  }

  if (perQuote.length === 0) {
    return { count: 0, mean: null, p50: null, p90: null };
  }

  const mean = perQuote.reduce((a, b) => a + b, 0) / perQuote.length;

  // Sorted copy for percentiles — don't mutate the caller's array.
  const sorted = [...perQuote].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);

  return { count: perQuote.length, mean, p50, p90 };
}

/**
 * Linear-interpolated percentile on a pre-sorted array.
 * Matches numpy's default ("linear") percentile semantics — the
 * common house style for reporting p50 / p90 distribution stats.
 *
 * Not exported (internal helper) — but kept testable indirectly
 * via `summariseWeightedAccuracy`.
 *
 * @param {number[]} sorted ascending-sorted array
 * @param {number} p in [0, 1]
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
