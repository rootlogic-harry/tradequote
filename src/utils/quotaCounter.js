/**
 * Persistent quotes-remaining counter — pure decision helpers.
 *
 * Locked spec 2026-06-23. The counter is the always-visible companion
 * to SubscriptionBanner — smaller, less screamy, present on every
 * authenticated screen. Same data source: the `billing` block from
 * /auth/me.
 *
 * Splitting the decision logic into pure helpers means the JSX is a
 * thin presentation layer and the test suite (with `transform: {}` in
 * Jest config) can exercise the contract without rendering React.
 *
 * Five states are conceptually possible, but PR B (this PR) ships
 * FOUR of them. The fifth — `purchased-remaining` — is reserved for
 * PR C (the £9.99 quote-pack). The state selector below has a TODO
 * comment where PR C will graft in.
 *
 *   1. subscribed         — "Unlimited"
 *   2. comped              — "Free during {month}" or "Free through {month}"
 *   3. free-remaining     — "{remaining} of {limit} free quotes left"
 *   4. quota_exhausted    — "0 quotes left" + Subscribe link
 *   5. purchased-remaining — RESERVED for PR C
 *
 * No buy button in this PR — PR C will add one.
 *
 * Banned-vocab safe (locked spec safe list):
 *   quote, free quote, quotes left, free during, free through, unlimited,
 *   remaining
 */

/**
 * Map the /auth/me billing block to one of the four counter states
 * this PR ships. Falls back to `null` (render nothing) if billing is
 * missing — same defensive posture the other components take.
 *
 * @param {object|null|undefined} billing — the /auth/me billing block.
 *   Shape: { quotaState, freeQuotesUsed, freeQuotesLimit, compUntil? }.
 * @returns {string|null} One of:
 *   - 'subscribed'
 *   - 'comped'
 *   - 'free-remaining'
 *   - 'quota_exhausted'
 *   - null (billing not loaded yet)
 *
 * TODO (PR C): add a 'purchased-remaining' branch when
 * users.purchased_quotes lands. The counter will then render
 * "{remaining} purchased quotes left" when the user has a buy-pack
 * balance and isn't subscribed.
 */
export function selectCounterState(billing) {
  if (!billing) return null;
  const raw = billing.quotaState;
  if (raw === 'subscribed') return 'subscribed';
  if (raw === 'comped') return 'comped';
  // /auth/me uses 'exhausted', /api/billing/status uses 'exhausted',
  // analyseJob dispatches 'ANALYSIS_QUOTA_EXHAUSTED'. The reducer key
  // we want for the UI is `quota_exhausted` so it doesn't clash with
  // the Stripe-driven 'expired'/'canceled' states. Accept both forms.
  if (raw === 'quota_exhausted' || raw === 'exhausted') return 'quota_exhausted';
  if (raw === 'free-remaining') return 'free-remaining';
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
 * `subscribed`      → "Unlimited"
 * `comped`          → "Free during {month}" / "Free through {month}"
 *                     (falls back to "Free" if compUntil missing —
 *                     defensive; shouldn't happen in practice)
 * `free-remaining`  → "{remaining} of {limit} free quotes left"
 * `quota_exhausted` → "0 quotes left"
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
    const remaining = Math.max(0, limit - used);
    return `${remaining} of ${limit} free quotes left`;
  }

  if (state === 'quota_exhausted') return '0 quotes left';

  return null;
}
