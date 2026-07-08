/**
 * Unit tests for the Dashboard's Recent-quotes filter pure helper.
 *
 * This suite exists to catch the class of bug Harry reported on
 * 2026-06-29: the dashboard pills "visually selected" but did not filter
 * the underlying rows. The previous tests in `dashboard.test.js` were
 * source-level regex assertions that grep'd for the pill labels — those
 * passed while the behaviour silently regressed because the regression
 * lived in the slice-order, not in the markup.
 *
 * The helper is pure (no React, no DOM) and the Dashboard.jsx render
 * delegates to it via `filterAndLimitJobs(jobs, filter, 10)`. A separate
 * source-level test in `dashboard.test.js` asserts the wiring.
 */

import {
  filterAndLimitJobs,
  computeFilterCounts,
  DASHBOARD_FILTER_KEYS,
  DASHBOARD_PREVIEW_LIMIT,
} from '../utils/dashboardFilter.js';

const fixtureJobs = [
  { id: 'd1', status: 'draft', clientName: 'Draft 1' },
  { id: 's1', status: 'sent', clientName: 'Sent 1' },
  { id: 'a1', status: 'accepted', clientName: 'Accepted 1' },
  { id: 'c1', status: 'completed', clientName: 'Done 1' },
  { id: 'x1', status: 'declined', clientName: 'Declined 1' },
];

describe('DASHBOARD_FILTER_KEYS', () => {
  it('exports the six pill keys in the documented order', () => {
    expect(DASHBOARD_FILTER_KEYS).toEqual(['all', 'draft', 'sent', 'accepted', 'completed', 'declined']);
  });
});

describe('DASHBOARD_PREVIEW_LIMIT', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(DASHBOARD_PREVIEW_LIMIT)).toBe(true);
    expect(DASHBOARD_PREVIEW_LIMIT).toBeGreaterThan(0);
  });

  it('is at least 25 so Mark\'s 25-sent-quote UAT case surfaces without truncation', () => {
    // 2026-07-08 rationale — see the constant\'s JSDoc.
    expect(DASHBOARD_PREVIEW_LIMIT).toBeGreaterThanOrEqual(25);
  });

  it('caps filterAndLimitJobs to exactly this many rows', () => {
    // Build a fixture with 30 sent quotes so the limit definitely bites.
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`, status: 'sent', clientName: `Sent ${i}`,
    }));
    const result = filterAndLimitJobs(many, 'sent', DASHBOARD_PREVIEW_LIMIT);
    expect(result.length).toBe(DASHBOARD_PREVIEW_LIMIT);
  });
});

describe('filterAndLimitJobs — pill behaviour', () => {
  it('returns all jobs when filter is "all"', () => {
    const result = filterAndLimitJobs(fixtureJobs, 'all');
    expect(result.length).toBe(5);
  });

  it('"draft" returns only drafts', () => {
    const result = filterAndLimitJobs(fixtureJobs, 'draft');
    expect(result.map(j => j.id)).toEqual(['d1']);
  });

  it('"sent" returns only sent jobs', () => {
    const result = filterAndLimitJobs(fixtureJobs, 'sent');
    expect(result.map(j => j.id)).toEqual(['s1']);
  });

  it('"accepted" returns only accepted jobs', () => {
    const result = filterAndLimitJobs(fixtureJobs, 'accepted');
    expect(result.map(j => j.id)).toEqual(['a1']);
  });

  it('"completed" (Done pill) returns only completed jobs', () => {
    // This is the exact scenario Harry tested live on 2026-06-29: click
    // "Done" pill → list should drop to the one completed job.
    const result = filterAndLimitJobs(fixtureJobs, 'completed');
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
  });

  it('"declined" returns only declined jobs', () => {
    const result = filterAndLimitJobs(fixtureJobs, 'declined');
    expect(result.map(j => j.id)).toEqual(['x1']);
  });

  it('regression: filter applies BEFORE the slice (not after)', () => {
    // 12 sent jobs + 1 completed at the END of the list. If the slice
    // happened before the filter, the slice(0, 10) would lop off the
    // completed job and clicking "Done" would return an empty array.
    // This test would have caught the slice-before-filter regression.
    const jobs = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, status: 'sent' })),
      { id: 'c1', status: 'completed' },
    ];
    const result = filterAndLimitJobs(jobs, 'completed', 10);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
  });

  it('caps results at the limit', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `j${i}`, status: 'draft' }));
    const result = filterAndLimitJobs(many, 'draft', 10);
    expect(result.length).toBe(10);
  });

  it('preserves input order (server returns saved_at DESC; helper must not re-sort)', () => {
    const inOrder = [
      { id: 'a', status: 'draft' },
      { id: 'b', status: 'draft' },
      { id: 'c', status: 'draft' },
    ];
    expect(filterAndLimitJobs(inOrder, 'draft').map(j => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats missing status as "draft" (server schema default)', () => {
    const jobs = [{ id: '1' }, { id: '2', status: 'sent' }];
    const result = filterAndLimitJobs(jobs, 'draft');
    expect(result.map(j => j.id)).toEqual(['1']);
  });

  it('is case-insensitive on the job status (DRAFT == draft)', () => {
    const jobs = [{ id: '1', status: 'DRAFT' }, { id: '2', status: 'Sent' }];
    expect(filterAndLimitJobs(jobs, 'draft').map(j => j.id)).toEqual(['1']);
    expect(filterAndLimitJobs(jobs, 'sent').map(j => j.id)).toEqual(['2']);
  });

  it('returns empty array for non-array input', () => {
    expect(filterAndLimitJobs(null, 'all')).toEqual([]);
    expect(filterAndLimitJobs(undefined, 'all')).toEqual([]);
    expect(filterAndLimitJobs({}, 'all')).toEqual([]);
  });

  it('returns empty array when no jobs match the filter', () => {
    const onlyDrafts = [{ id: '1', status: 'draft' }];
    expect(filterAndLimitJobs(onlyDrafts, 'completed')).toEqual([]);
  });

  it('falls back to "all" when filter is non-string', () => {
    expect(filterAndLimitJobs(fixtureJobs, null).length).toBe(5);
    expect(filterAndLimitJobs(fixtureJobs, undefined).length).toBe(5);
  });
});

describe('computeFilterCounts — pill badges', () => {
  it('returns one count per pill key', () => {
    const counts = computeFilterCounts(fixtureJobs);
    expect(Object.keys(counts).sort()).toEqual(
      ['accepted', 'all', 'completed', 'declined', 'draft', 'sent']
    );
  });

  it('"all" count equals the total job list length', () => {
    const counts = computeFilterCounts(fixtureJobs);
    expect(counts.all).toBe(fixtureJobs.length);
  });

  it('per-status counts match the live filtered list lengths', () => {
    const counts = computeFilterCounts(fixtureJobs);
    expect(counts.draft).toBe(filterAndLimitJobs(fixtureJobs, 'draft', Infinity).length);
    expect(counts.sent).toBe(filterAndLimitJobs(fixtureJobs, 'sent', Infinity).length);
    expect(counts.accepted).toBe(filterAndLimitJobs(fixtureJobs, 'accepted', Infinity).length);
    expect(counts.completed).toBe(filterAndLimitJobs(fixtureJobs, 'completed', Infinity).length);
    expect(counts.declined).toBe(filterAndLimitJobs(fixtureJobs, 'declined', Infinity).length);
  });

  it('counts use the full job list (not the 10-row preview)', () => {
    // Regression guard: if the badge calculation were ever shifted to run
    // on the pill-sliced visibleJobs, a busy account with 25 drafts would
    // show "10" next to the Drafts pill instead of "25".
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `d${i}`, status: 'draft' }));
    const counts = computeFilterCounts(many);
    expect(counts.draft).toBe(25);
    expect(counts.all).toBe(25);
  });

  it('handles missing status as draft', () => {
    const jobs = [{ id: '1' }, { id: '2', status: 'sent' }];
    const counts = computeFilterCounts(jobs);
    expect(counts.draft).toBe(1);
    expect(counts.sent).toBe(1);
  });

  it('ignores unknown statuses (never throws, never inflates the count map)', () => {
    const jobs = [{ id: '1', status: 'archived' }, { id: '2', status: 'sent' }];
    const counts = computeFilterCounts(jobs);
    expect(counts.sent).toBe(1);
    expect(counts.draft).toBe(0);
    expect(counts.all).toBe(2);
    expect(counts).not.toHaveProperty('archived');
  });

  it('returns zero counts for non-array input', () => {
    const counts = computeFilterCounts(null);
    expect(counts.all).toBe(0);
    expect(counts.draft).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The behavioural test below simulates the exact scenario Harry tested
// live on 2026-06-29: a Dashboard whose recent-jobs list contains one
// job per status. The simulated "click" is just a state assignment
// because the helper is the single source of truth for the filter.
// ─────────────────────────────────────────────────────────────────────
describe('regression test for the 2026-06-29 pill-filter bug', () => {
  it('clicking "Done" drops the visible row count from 5 to 1', () => {
    // Step 1: initial state — no filter, all 5 rows visible.
    let activeFilter = 'all';
    const initial = filterAndLimitJobs(fixtureJobs, activeFilter, 10);
    expect(initial.length).toBe(5);

    // Step 2: simulate clicking the "Done" pill → setFilter('completed').
    activeFilter = 'completed';
    const afterClick = filterAndLimitJobs(fixtureJobs, activeFilter, 10);

    // Step 3: only the one completed job is visible.
    expect(afterClick.length).toBe(1);
    expect(afterClick[0].status).toBe('completed');
  });

  it('clicking "All" after a sub-filter restores the full list', () => {
    let activeFilter = 'draft';
    expect(filterAndLimitJobs(fixtureJobs, activeFilter, 10).length).toBe(1);
    activeFilter = 'all';
    expect(filterAndLimitJobs(fixtureJobs, activeFilter, 10).length).toBe(5);
  });
});
