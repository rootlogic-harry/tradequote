/**
 * Client rollup helper — pure function.
 *
 * Given a list of `jobs` rows for a single client (typically fetched
 * via a JOIN through the client's sites), compute the four numbers
 * that make the Client detail page useful:
 *
 *   - totalWon           = sum(total_amount) WHERE status IN ('accepted', 'completed')
 *   - outstanding        = sum(total_amount) WHERE status = 'sent'
 *   - livePipeline       = sum(total_amount) WHERE status = 'accepted' AND completedAt IS NULL
 *   - lifetimeQuoteCount = count(*) — every job regardless of status
 *
 * Callers pass an array of plain objects with { status, totalAmount,
 * completedAt } — the field names match the columns returned from a
 * standard jobs SELECT. Any missing/null fields are treated as
 * zero/absent per docs/CLIENTS_SPEC_v3.md § 4.
 *
 * Locked contract in src/__tests__/clientsRollup.test.js (17 tests).
 */

const ZERO = Object.freeze({
  totalWon: 0,
  outstanding: 0,
  livePipeline: 0,
  lifetimeQuoteCount: 0,
});

// totalAmount arrives from the pg driver as either a Number, a String
// (when the driver returns numeric columns as text), or null/undefined
// (missing). Normalise to a finite Number or 0.
function num(value) {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function resolveClientRollup(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { ...ZERO };
  }

  let totalWon = 0;
  let outstanding = 0;
  let livePipeline = 0;
  let lifetimeQuoteCount = 0;

  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    lifetimeQuoteCount += 1;

    const status = job.status;
    const amount = num(job.totalAmount);

    if (status === 'accepted' || status === 'completed') {
      totalWon += amount;
    }
    if (status === 'sent') {
      outstanding += amount;
    }
    // Accepted-but-not-yet-completed = the live work in progress.
    // Both null and undefined mean "no completion timestamp".
    if (status === 'accepted' && (job.completedAt == null)) {
      livePipeline += amount;
    }
  }

  return { totalWon, outstanding, livePipeline, lifetimeQuoteCount };
}
