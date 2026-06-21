/**
 * Job lifecycle bucketing for the dashboard / saved-jobs Active vs Archive
 * split (Mark's ask, 2026-06-21).
 *
 * Bucket definitions (decided in spec — do not relitigate):
 *   ACTIVE   = draft + sent + accepted + completed
 *              Completed STAYS active because Mark uses these for invoicing
 *              and reference lookups.
 *   ARCHIVE  = declined + expired (sent AND expiresAt < now())
 *
 * The two buckets are mutually exclusive and total across the known status
 * values — every job falls in exactly one. `isExpired` is extracted because
 * the same predicate is used by the archive bucketer and the ExpiryBadge.
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
 * Active = draft + sent (not expired) + accepted + completed.
 */
export function isActiveJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'declined') return false;
  if (status === 'sent' && isExpired(job, now)) return false;
  // Unknown statuses default to active so a future status value
  // (e.g. 'invoiced') doesn't disappear from the dashboard silently.
  return true;
}

/**
 * True if the job belongs in the Archive list.
 * Archive = declined + expired sends.
 */
export function isArchivedJob(job, now = new Date()) {
  if (!job || typeof job !== 'object') return false;
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'declined') return true;
  if (status === 'sent' && isExpired(job, now)) return true;
  return false;
}
