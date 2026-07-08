/**
 * Pure helper for the Dashboard's Recent-quotes filter pills (2026-06-29).
 *
 * The Dashboard renders six pills — All / Drafts / Sent / Accepted / Done /
 * Declined — that filter the Recent jobs list by status. The mechanical
 * logic used to be inlined inside the `useMemo` in Dashboard.jsx. Extracted
 * here so it can be unit-tested directly: source-level regex tests were
 * passing while the live behaviour silently regressed (Harry, 2026-06-29).
 *
 * Contract:
 *   - `jobs` is the (un-pre-sliced) array returned by listJobs(). The server
 *     orders by saved_at DESC and caps at 100, so callers should hand the
 *     full array in.
 *   - `filter` is one of {'all','draft','sent','accepted','completed','declined'}.
 *     The 'completed' bucket is what the "Done" pill maps to.
 *   - `limit` caps the returned list (Dashboard uses 10).
 *
 * The filter applies BEFORE the slice — that's the bug class this helper
 * exists to make impossible. Slicing before filtering would silently
 * truncate to the most recent 10 jobs and then filter within those 10,
 * which on a busy account looks identical to "the filter does nothing".
 *
 * Missing/falsy status defaults to 'draft' (matches the server schema
 * default) and the comparison is lowercase-insensitive.
 */

export const DASHBOARD_FILTER_KEYS = ['all', 'draft', 'sent', 'accepted', 'completed', 'declined'];

/**
 * Row cap for the Dashboard's Recent-quotes preview. Was 10 through
 * 2026-07-07; bumped to 25 on 2026-07-08 after Mark's UAT flagged that
 * he had 25 sent quotes and could only see 10 on the Dashboard preview.
 * The Dashboard is still a *preview* — SavedQuotes is the full list —
 * so we pair the higher cap with a "N more — see all in My Quotes"
 * footer link the Dashboard renders when `visibleJobs.length < counts[filter]`.
 */
export const DASHBOARD_PREVIEW_LIMIT = 25;

/**
 * Returns jobs matching `filter`, capped at `limit`.
 * Filter runs before the slice so the pill always reflects the user's intent.
 */
export function filterAndLimitJobs(jobs, filter, limit = 10) {
  if (!Array.isArray(jobs)) return [];
  const normalisedFilter = typeof filter === 'string' ? filter.toLowerCase() : 'all';
  const predicate = normalisedFilter === 'all'
    ? () => true
    : (j) => (j && j.status ? String(j.status) : 'draft').toLowerCase() === normalisedFilter;
  const filtered = jobs.filter(predicate);
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return filtered;
  return filtered.slice(0, limit);
}

/**
 * Returns the per-status counts for the pill badges. Counts are derived
 * from the full job list (not the pill-filtered list) so the badge always
 * shows the total available, not the slice-limited preview.
 */
export function computeFilterCounts(jobs) {
  const counts = { all: 0, draft: 0, sent: 0, accepted: 0, completed: 0, declined: 0 };
  if (!Array.isArray(jobs)) return counts;
  counts.all = jobs.length;
  for (const j of jobs) {
    const s = (j && j.status ? String(j.status) : 'draft').toLowerCase();
    if (counts[s] !== undefined && s !== 'all') counts[s] += 1;
  }
  return counts;
}
