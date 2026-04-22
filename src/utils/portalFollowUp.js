/**
 * Portal follow-up helpers — derive "needs a nudge" state and
 * human-readable "viewed X days ago" labels from the frozen portal
 * audit fields (TRQ-131 data) without any new DB columns.
 *
 * Paul's brief: "next time I log in is fine" — no push, no email, no
 * reminders. Just surface "this client viewed your quote N days ago
 * and hasn't responded" on the dashboard so he can decide whether
 * to chase.
 *
 * Threshold tuned at 2 days. Same-day is "they might still be
 * deciding", day 1 is "give them space", day 2+ is "worth a follow-up".
 * Kept as an exported constant so we can tune without chasing through
 * the codebase.
 */

// Default cutoff for "needs follow-up". If the client viewed the quote
// this many whole days ago AND hasn't responded, it lands in Paul's
// follow-up list.
export const FOLLOW_UP_AFTER_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(input) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Whole days between `viewedAt` and `now`, rounded down. Same-day = 0.
 */
export function viewedDaysAgo(job, now = Date.now()) {
  const viewed = toDate(job?.clientViewedAt);
  if (!viewed) return null;
  return Math.floor((now - viewed.getTime()) / DAY_MS);
}

/**
 * Should this job appear in the dashboard's "Needs follow-up" section?
 *
 * Criteria:
 *   1. The client has been issued a portal link.
 *   2. The client has actually viewed it (non-view ≠ follow-up — could
 *      just be email-in-spam; different problem).
 *   3. The client has NOT responded.
 *   4. The token hasn't expired (expired = "regenerate link" problem,
 *      different action).
 *   5. ≥ `FOLLOW_UP_AFTER_DAYS` whole days since the view.
 */
export function needsFollowUp(job, now = Date.now(), afterDays = FOLLOW_UP_AFTER_DAYS) {
  if (!job || !job.clientToken) return false;
  if (job.clientResponse === 'accepted' || job.clientResponse === 'declined') return false;

  const viewed = toDate(job.clientViewedAt);
  if (!viewed) return false;

  const expiresAt = toDate(job.clientTokenExpiresAt);
  if (expiresAt && expiresAt.getTime() <= now) return false;

  const days = Math.floor((now - viewed.getTime()) / DAY_MS);
  return days >= afterDays;
}

/**
 * Human-readable label for the Viewed badge.
 *   0 days  → "Viewed today"
 *   1 day   → "Viewed yesterday"
 *   n days  → "Viewed n days ago"
 * Returns null if the job hasn't been viewed.
 */
export function relativeViewedLabel(job, now = Date.now()) {
  const days = viewedDaysAgo(job, now);
  if (days === null) return null;
  if (days <= 0) return 'Viewed today';
  if (days === 1) return 'Viewed yesterday';
  return `Viewed ${days} days ago`;
}

/**
 * Normalise a UK phone number into a format WhatsApp's wa.me/ URL
 * accepts (digits only, no `+`, country code prefixed).
 *
 * Handles:
 *   "07554 040992"     → "447554040992"
 *   "+44 7554 040992"  → "447554040992"
 *   "(07554) 040992"   → "447554040992"
 * Returns null for anything that doesn't look like a phone we can wire
 * up — caller should hide the WhatsApp button in that case.
 */
export function normaliseUkPhoneForWhatsApp(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, '');
  if (!digits) return null;
  // Already has country code (44 for UK, or other international)
  if (digits.startsWith('44')) return digits;
  // Leading 0 = UK domestic, replace with 44
  if (digits.startsWith('0')) return `44${digits.slice(1)}`;
  // 10+ digit non-zero-prefix — treat as already international
  if (digits.length >= 10) return digits;
  // Too short to be a real number
  return null;
}
