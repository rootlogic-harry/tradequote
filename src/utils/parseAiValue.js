/**
 * parseAiValue — robust numeric parser for the `ai_value` / `confirmed_value`
 * strings stored in quote_diffs.
 *
 * Background: `aiValue` is set once at AI-response time as a formatted
 * display string (e.g. `"2,000mm"`, `"£415"`, `"3.5t"`) and is on the
 * Do-Not-Touch List (CLAUDE.md: "Set once, never overwritten — All
 * learning data corrupted if violated"). The writer therefore cannot
 * be changed to a numeric form.
 *
 * Readers using the standard `parseFloat()` on these strings produce
 * silently wrong numbers — `parseFloat("2,000mm")` returns `2`, not
 * `2000`, because parseFloat stops at the first non-digit. That bad
 * number then flows into the per-field bias chart in
 * `LearningDashboard.jsx`, where 1500% biases show up because
 * `(3100 - 2) / 2 ≈ 1549`. The 2026-06-22 calibration investigation
 * flagged this as a data-quality landmine.
 *
 * This util normalises the common shapes by:
 *   1. Returning `null` for any non-string (or empty string) input.
 *   2. Stripping the recognised currency symbols (£, $, €) AND any
 *      trailing alphabetic unit suffix (mm, cm, m, t, kg, days, etc).
 *   3. Stripping thousand-separator commas — and only commas, so we
 *      don't strip the comma in a European decimal `"1,5"` (currently
 *      unused but documented behaviour: comma-as-thousand-separator
 *      assumption matches the AI's en-GB output convention).
 *   4. Calling `Number()` (not `parseFloat`) so trailing garbage
 *      makes the whole input null instead of silently truncating.
 *
 * Returns:
 *   - finite number if the string parsed cleanly
 *   - `null` for null/undefined/empty/non-string/un-parseable input
 *
 * Tests in src/__tests__/parseAiValue.test.js cover every shape that
 * appears in the production `quote_diffs.ai_value` corpus as of
 * 2026-06-22, plus the safety paths (null, undefined, empty, garbage).
 */
export function parseAiValue(raw) {
  // Reject null, undefined, non-strings (numbers pass through as-is
  // if finite — defensive against future writers that might already
  // store numerics).
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Strip leading currency symbols (£, $, €). Whitespace between the
  // symbol and the number is allowed ("£ 125").
  let s = trimmed.replace(/^[£$€]\s*/, '');

  // Strip thousand-separator commas. We deliberately do NOT preserve
  // commas as European decimal separators — the AI's output convention
  // is en-GB with comma as thousand-separator, full stop as decimal.
  s = s.replace(/,/g, '');

  // Strip a trailing alphabetic unit suffix (mm, cm, m, t, kg, days,
  // sqm, etc). Permissive — anything after the numeric portion that's
  // pure alphabetic or space gets stripped. This MUST run after the
  // comma strip so `"2,000mm"` becomes `"2000"` not `"2,000"`.
  s = s.replace(/\s*[a-zA-Z²³]+\s*$/, '');

  // After cleanup, the remainder must be a clean number — use Number()
  // not parseFloat() so trailing junk fails-closed rather than getting
  // silently truncated.
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}
