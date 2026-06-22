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
 * "X of 3 free quotes used" copy helper (2026-06-22). Centralised
 * so the banner JSX stays a presentation layer and the test can pin
 * the exact string without scraping JSX.
 */
export function freeQuotesCopy(used, limit) {
  const safeUsed = Number.isFinite(used) ? used : 0;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 3;
  return `${safeUsed} of ${safeLimit} free quotes used`;
}

/**
 * Pick which banner variant to render given the status payload.
 * Returns one of: 'none' | 'trial' | 'trial-ending' | 'expired'
 * | 'past-due' | 'canceled' | 'free-remaining' | 'exhausted'.
 *
 * Centralising this so the JSX component is a thin switch and so
 * the precedence rules are testable without rendering.
 *
 * Quota model (2026-06-22) takes precedence over the legacy
 * trial mapping but NOT over Stripe-side billing issues — a
 * past_due / canceled customer should see Update Card / Resubscribe
 * rather than "X free quotes used", because they're already a
 * paying customer who just needs us to recover their payment state.
 * Order of evaluation:
 *
 *   1. Not configured → none
 *   2. Stripe past_due / canceled → those banners (account recovery
 *      is more urgent than quota copy)
 *   3. quotaState === 'subscribed' | 'comped' → none (no banner; the
 *      customer is good and we don't want to flash quota copy at them)
 *   4. quotaState === 'exhausted' → exhausted (hard CTA)
 *   5. quotaState === 'free-remaining' → free-remaining (soft CTA)
 *   6. Legacy state mapping (trialing/expired/active/unknown) for
 *      backwards-compat with older client builds before quotaState
 *      was wired up.
 */
export function pickBannerVariant(status) {
  if (!status) return 'none';
  if (!status.configured) return 'none';

  // Stripe-side problems beat quota state — paying customer with a
  // failed card must see Update Card, not free-quote copy.
  if (status.state === 'past_due') return 'past-due';
  if (status.state === 'canceled') return 'canceled';

  // Quota model (2026-06-22) takes over from the legacy trial mapping.
  if (status.quotaState === 'subscribed') return 'none';
  if (status.quotaState === 'comped') return 'none';
  if (status.quotaState === 'exhausted') return 'exhausted';
  if (status.quotaState === 'free-remaining') return 'free-remaining';

  // Legacy fallback — older client builds without quotaState.
  if (status.state === 'active' || status.state === 'unknown') return 'none';
  if (status.state === 'expired') return 'expired';
  if (status.state === 'trialing') {
    return isTrialEndingSoon(status) ? 'trial-ending' : 'trial';
  }
  return 'none';
}
