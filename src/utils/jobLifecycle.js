/**
 * Job lifecycle bucketing for the dashboard / saved-jobs Active vs Archive
 * split (Mark's ask, 2026-06-21).
 *
 * Bucket definitions:
 *   ACTIVE   = everything EXCEPT declined.
 *              Includes draft, sent (even past expiry), accepted, completed,
 *              and unknown future statuses. Mark's feedback 2026-06-21:
 *              expired sent quotes must stay active because customers
 *              regularly authorise walling jobs months after the quote
 *              technically expires.
 *   ARCHIVE  = declined only.
 *
 * The two buckets remain mutually exclusive and total. `isExpired` is
 * still exported because the ExpiryBadge in Dashboard.jsx uses it to
 * stamp "EXPIRED" on the sent-quote row — it just no longer drives
 * bucketing.
 *
 * Pure functions; no React, no DOM. Tested in jobLifecycle.test.js.
 */

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
 * Active = everything except declined. Expired sends stay here per
 * Mark's 2026-06-21 feedback (late-authorisation use case).
 *
 * The `now` parameter is kept in the signature for symmetry with
 * `isExpired` and to leave the door open for time-based bucketing
 * later (e.g. auto-archive completed jobs after 90 days). Today it
 * is unused.
 */
// eslint-disable-next-line no-unused-vars
export function isActiveJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'declined') return false;
  // Unknown statuses default to active so a future status value
  // (e.g. 'invoiced') doesn't disappear from the dashboard silently.
  return true;
}

/**
 * True if the job belongs in the Archive list.
 * Archive = declined only. (Expired sends are NOT archived — see
 * the file header for Mark's 2026-06-21 rationale.)
 *
 * The `now` parameter is kept for signature symmetry; today unused.
 */
// eslint-disable-next-line no-unused-vars
export function isArchivedJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  return status === 'declined';
}
