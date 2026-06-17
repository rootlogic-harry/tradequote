/**
 * Pure helpers for SubscriptionBanner (TRQ-164). Split out of the
 * JSX component so Jest can unit-test them — the Jest config has
 * `transform: {}` (no JSX compile step), so anything importable
 * from a test file has to live in a plain .js module.
 */

/**
 * Trial-ending-soon predicate. Two signal sources:
 *
 *   1. `trialWillEndAt` — the timestamp captured from Stripe's
 *      `customer.subscription.trial_will_end` webhook (TRQ-150
 *      PR #26). Authoritative when present.
 *   2. `daysOfTrialRemaining` — server-computed from the user's
 *      `trial_ends_at` column. The fallback for users whose trial
 *      is too short for Stripe to have fired the webhook yet
 *      (Stripe fires it ~3 days before conversion).
 *
 * Returns true if EITHER signal says we're inside the 3-day window.
 * Belt-and-braces — a UI banner that flips on too eagerly is a
 * minor annoyance; one that fails to warn the user before their
 * trial converts is a billing complaint.
 */
export function isTrialEndingSoon(status) {
  if (!status) return false;
  if (status.state !== 'trialing') return false;
  if (status.trialWillEndAt) {
    const target = new Date(status.trialWillEndAt).getTime();
    const now = Date.now();
    const diffDays = (target - now) / (1000 * 60 * 60 * 24);
    if (diffDays >= 0 && diffDays <= 3) return true;
  }
  if (
    typeof status.daysOfTrialRemaining === 'number'
    && status.daysOfTrialRemaining >= 0
    && status.daysOfTrialRemaining <= 3
  ) {
    return true;
  }
  return false;
}

/** Singular vs plural day-count copy. */
export function dayCopy(n) {
  if (n === 1) return '1 day';
  return `${n ?? 0} days`;
}

/**
 * Pick which banner variant to render given the status payload.
 * Returns one of: 'none' | 'trial' | 'trial-ending' | 'expired'
 * | 'past-due' | 'canceled'.
 *
 * Centralising this so the JSX component is a thin switch and so
 * the precedence rules are testable without rendering.
 */
export function pickBannerVariant(status) {
  if (!status) return 'none';
  if (!status.configured) return 'none';
  if (status.state === 'active' || status.state === 'unknown') return 'none';
  if (status.state === 'past_due') return 'past-due';
  if (status.state === 'canceled') return 'canceled';
  if (status.state === 'expired') return 'expired';
  if (status.state === 'trialing') {
    return isTrialEndingSoon(status) ? 'trial-ending' : 'trial';
  }
  return 'none';
}
