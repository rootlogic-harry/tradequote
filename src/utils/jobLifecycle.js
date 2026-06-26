/**
 * Job lifecycle bucketing for the dashboard / saved-jobs tab split.
 *
 * Bucket definitions (Mark's ask 2026-06-26, three-tab structure):
 *   ACTIVE    = in-flight work: draft, sent (even past expiry), accepted,
 *               and unknown future statuses. Mark's feedback 2026-06-21:
 *               expired sent quotes stay active (late-authorisation use case).
 *   COMPLETED = completed only. Lives in its own tab so a hundred finished
 *               jobs don't crowd the working list.
 *   ARCHIVE   = declined only.
 *
 * The three buckets are mutually exclusive and total. `isExpired` is still
 * exported because the ExpiryBadge in Dashboard.jsx uses it to stamp
 * "EXPIRED" on sent-quote rows — it doesn't drive bucketing.
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
 * Completed = status === 'completed' only.
 *
 * The `now` parameter is unused today but kept for signature symmetry.
 */
// eslint-disable-next-line no-unused-vars
export function isCompletedJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  return status === 'completed';
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
