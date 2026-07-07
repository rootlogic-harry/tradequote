/**
 * Persistent quotes-remaining counter — pure decision helpers.
 *
 * Locked spec 2026-06-23, extended 2026-06-24 with the £9.99
 * pay-as-you-go pack (5th state). The counter is the always-visible
 * companion to SubscriptionBanner — smaller, less screamy, present on
 * every authenticated screen. Same data source: the `billing` block
 * from /auth/me.
 *
 * Splitting the decision logic into pure helpers means the JSX is a
 * thin presentation layer and the test suite (with `transform: {}` in
 * Jest config) can exercise the contract without rendering React.
 *
 * Five states:
 *
 *   1. subscribed             — "Unlimited"
 *   2. comped                  — "Free during {month}" or "Free through {month}"
 *   3. free-remaining         — "{total} quotes left" (with mixed-state
 *                                breakdown if pack quotes also present)
 *   4. purchased-remaining    — "{n} quotes left" (free exhausted; pack only)
 *   5. quota_exhausted        — "0 quotes left" + Subscribe link
 *
 * Buy-button visibility (2026-06-24):
 *   - VISIBLE in: free-remaining / purchased-remaining / quota_exhausted
 *   - SUPPRESSED for: subscribed / comped
 *
 * Mixed-state display choice (free + purchased both > 0): show the
 * combined total in the main label, with a subtle breakdown below
 * ("{free} free + {purchased} paid").
 *
 * Banned-vocab safe (locked spec safe list):
 *   quote, free quote, quotes left, free during, free through, unlimited,
 *   remaining, paid, pack
 */

/**
 * Map the /auth/me billing block to one of the five counter states.
 * Falls back to `null` (render nothing) if billing is missing — same
 * defensive posture the other components take.
 *
 * @param {object|null|undefined} billing — the /auth/me billing block.
 *   Shape: { quotaState, freeQuotesUsed, freeQuotesLimit, compUntil?,
 *            purchasedQuotesRemaining? }.
 * @returns {string|null} One of:
 *   - 'subscribed'
 *   - 'comped'
 *   - 'free-remaining'
 *   - 'purchased-remaining'
 *   - 'quota_exhausted'
 *   - null (billing not loaded yet)
 *
 * 2026-06-24: 'purchased-remaining' added for the £9.99 quote pack.
 * The quotaGate's load-bearing order means a user with both free AND
 * purchased quotes is reported as 'free-remaining' — the counter
 * surfaces the mixed-state breakdown via counterCopy().
 */
export function selectCounterState(billing) {
  if (!billing) return null;
  const raw = billing.quotaState;
  // Admin plans (Harry + Mark) — treat identically to 'subscribed' at
  // the UI layer. The Dashboard has no meaningful counter to show and
  // the "Buy 5 quotes" CTA would be nonsense. Bug 2026-07-07.
  if (raw === 'admin') return 'subscribed';
  if (raw === 'subscribed') return 'subscribed';
  if (raw === 'comped') return 'comped';
  // /auth/me uses 'exhausted', /api/billing/status uses 'exhausted',
  // analyseJob dispatches 'ANALYSIS_QUOTA_EXHAUSTED'. The reducer key
  // we want for the UI is `quota_exhausted` so it doesn't clash with
  // the Stripe-driven 'expired'/'canceled' states. Accept both forms.
  if (raw === 'quota_exhausted' || raw === 'exhausted') return 'quota_exhausted';
  if (raw === 'free-remaining') return 'free-remaining';
  if (raw === 'purchased-remaining') return 'purchased-remaining';
  return null;
}

/**
 * Format a month-name from a date string or Date instance, in en-GB.
 * Returns null on invalid input. Pure — accepts an injectable `now`
 * for tests.
 *
 * Used to build the comped copy: "Free during {month}" if comp_until
 * is in the current calendar month, "Free through {month}" if it's
 * in a future month. Past dates fall through to null (caller renders
 * the defensive "Free" fallback instead).
 *
 * The locked spec says: don't hardcode "July" — Paul's comp could be
 * extended. So we derive the month from the timestamp every render.
 */
export function compedMonthCopy(compUntil, now = new Date()) {
  if (!compUntil) return null;
  const end = new Date(compUntil);
  if (!Number.isFinite(end.getTime())) return null;

  const nowMonth = now.getUTCMonth();
  const nowYear = now.getUTCFullYear();
  const endMonth = end.getUTCMonth();
  const endYear = end.getUTCFullYear();

  // If comp_until is in the past, no valid label — let the caller
  // render the fallback.
  if (endYear < nowYear || (endYear === nowYear && endMonth < nowMonth)) {
    return null;
  }

  const monthName = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  }).format(end);

  // Same calendar month → "during"; later month → "through".
  if (endYear === nowYear && endMonth === nowMonth) {
    return `Free during ${monthName}`;
  }
  return `Free through ${monthName}`;
}

/**
 * Build the counter copy from a billing block. Returns a string —
 * the rendering component wraps it in JSX.
 *
 * `subscribed`           → "Unlimited"
 * `comped`               → "Free during {month}" / "Free through {month}"
 *                          (falls back to "Free" if compUntil missing —
 *                          defensive; shouldn't happen in practice)
 * `free-remaining`       → "{remaining} of {limit} free quotes left"
 *                          UNLESS the user also has purchased quotes,
 *                          in which case → "{total} quotes left" with
 *                          a breakdown line (see counterBreakdown).
 * `purchased-remaining`  → "{remaining} quotes left" (free exhausted;
 *                          showing only the pack balance)
 * `quota_exhausted`      → "0 quotes left"
 *
 * Mixed-state choice (2026-06-24): when both free + purchased > 0 we
 * show TOTAL in the main label (so the user always sees one number
 * for "how many can I run") with a breakdown below for transparency.
 *
 * The strings here are load-bearing — they're what the user actually
 * reads. Don't change without re-checking the banned-vocab list in
 * CLAUDE.md.
 */
export function counterCopy(billing, now = new Date()) {
  const state = selectCounterState(billing);
  if (!state) return null;

  if (state === 'subscribed') return 'Unlimited';

  if (state === 'comped') {
    const label = compedMonthCopy(billing?.compUntil, now);
    return label || 'Free';
  }

  if (state === 'free-remaining') {
    const used = Number(billing?.freeQuotesUsed) || 0;
    const limit = Number(billing?.freeQuotesLimit) || 0;
    const freeRemaining = Math.max(0, limit - used);
    const purchased = Math.max(0, Number(billing?.purchasedQuotesRemaining) || 0);
    if (purchased > 0) {
      // Mixed state — combine into a single total so the user reads
      // ONE number for "how many quotes can I run right now". The
      // breakdown ({n} free + {m} paid) renders separately via
      // counterBreakdown().
      const total = freeRemaining + purchased;
      return `${total} quotes left`;
    }
    return `${freeRemaining} of ${limit} free quotes left`;
  }

  if (state === 'purchased-remaining') {
    const purchased = Math.max(0, Number(billing?.purchasedQuotesRemaining) || 0);
    return `${purchased} quotes left`;
  }

  if (state === 'quota_exhausted') return '0 quotes left';

  return null;
}

/**
 * Secondary line for the counter when the user has BOTH free and
 * purchased quotes. Returns null when no breakdown is needed (single
 * bucket only, or no quotes left). The JSX renders this in a quieter
 * style underneath the main label.
 *
 * Examples:
 *   { free: 2, purchased: 3 } → "2 free + 3 paid"
 *   { free: 0, purchased: 5 } → null (purchased-only — main label is "5 quotes left")
 *   { free: 3, purchased: 0 } → null (free-only — main label is "3 of 3 free quotes left")
 */
export function counterBreakdown(billing) {
  if (!billing) return null;
  const state = selectCounterState(billing);
  if (state !== 'free-remaining') return null;
  const used = Number(billing?.freeQuotesUsed) || 0;
  const limit = Number(billing?.freeQuotesLimit) || 0;
  const freeRemaining = Math.max(0, limit - used);
  const purchased = Math.max(0, Number(billing?.purchasedQuotesRemaining) || 0);
  if (freeRemaining > 0 && purchased > 0) {
    return `${freeRemaining} free + ${purchased} paid`;
  }
  return null;
}
