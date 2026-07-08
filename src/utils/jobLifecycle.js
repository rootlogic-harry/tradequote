/**
 * Job lifecycle bucketing for the dashboard / saved-jobs tab split.
 *
 * Bucket definitions (Mark's ask 2026-06-26, three-tab structure;
 * refined 2026-07-08 for the auto-archive rule):
 *
 *   ACTIVE    = in-flight work: draft, sent (even past expiry), accepted,
 *               and unknown future statuses. Expired sent quotes stay
 *               active per Mark's 2026-06-21 feedback (late-authorisation
 *               use case).
 *   COMPLETED = status='completed' AND touched within the last
 *               `AUTO_ARCHIVE_DAYS` (30). Recent finishes stay visible
 *               so Paul + Mark can reference them without expanding the
 *               archive.
 *   ARCHIVE   = declined OR (completed AND older than AUTO_ARCHIVE_DAYS).
 *               Mark's 2026-07-07 UAT: "move old jobs either accepted
 *               done or lost somewhere so we can save them out of the
 *               way. its not uncommon to write a job off or have it
 *               rejected only for the client to come back 12 months
 *               later asking if you can do it".
 *
 * "Age" is computed from `saved_at` — the closest proxy we have without
 * adding a `completed_at` column. If a completed job is edited later,
 * `saved_at` bumps forward and the job re-emerges from Archive, which
 * matches the "if I'm touching it, it's relevant" heuristic.
 *
 * The three buckets are mutually exclusive and total. `isExpired` is still
 * exported because the ExpiryBadge in Dashboard.jsx uses it to stamp
 * "EXPIRED" on sent-quote rows — it doesn't drive bucketing.
 *
 * Pure functions; no React, no DOM. Tested in jobLifecycle.test.js.
 */

/**
 * Days after which a `completed` job auto-slides into Archive. Kept as
 * a named constant so downstream code (empty states, copy) can read the
 * threshold without duplicating the number. Bump this and the whole
 * archive rule shifts together.
 */
export const AUTO_ARCHIVE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Age of a job in whole days since `saved_at`. Returns Infinity for
 * missing/unparseable timestamps so unknown-age rows fall into archive
 * (safer default — an ancient row with no timestamp is definitely not
 * "fresh"). */
function ageDaysSinceSaved(job, now) {
  const stamp = job?.savedAt;
  if (!stamp) return Infinity;
  const ms = new Date(stamp).getTime();
  if (Number.isNaN(ms)) return Infinity;
  return Math.floor((now.getTime() - ms) / MS_PER_DAY);
}

/**
 * True if `job` is a sent quote whose expiry date has passed.
 * Returns false for any status other than 'sent', and false if expiresAt
 * is missing (we never synthesise expiry — no expiresAt means "no expiry
 * to compare against").
 */
export function isExpired(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status !== 'sent') return false;
  if (!job.expiresAt) return false;
  const expiresMs = new Date(job.expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs < now.getTime();
}

/**
 * True if the job belongs in the Active list (the default view).
 * Active = in-flight work (draft/sent/accepted + any unknown future
 * status). Completed AND declined are bucketed elsewhere.
 *
 * Expired sends stay active per Mark's 2026-06-21 feedback
 * (late-authorisation use case).
 *
 * The `now` parameter is unused today but kept for signature symmetry.
 */
// eslint-disable-next-line no-unused-vars
export function isActiveJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'declined') return false;
  if (status === 'completed') return false;
  // Unknown statuses default to active so a future status value
  // (e.g. 'invoiced') doesn't disappear from the dashboard silently.
  return true;
}

/**
 * True if the job belongs in the Completed list.
 * Completed = status === 'completed' AND touched within the last
 * AUTO_ARCHIVE_DAYS. Ageing thresholds are compared against `saved_at`;
 * see the file header for why.
 */
export function isCompletedJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status !== 'completed') return false;
  return ageDaysSinceSaved(job, now) < AUTO_ARCHIVE_DAYS;
}

/**
 * True if the job belongs in the Archive list.
 * Archive = declined OR (completed AND older than AUTO_ARCHIVE_DAYS).
 * Expired sends are NOT archived — see the file header for Mark's
 * 2026-06-21 rationale.
 */
export function isArchivedJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'declined') return true;
  if (status === 'completed') {
    return ageDaysSinceSaved(job, now) >= AUTO_ARCHIVE_DAYS;
  }
  return false;
}
