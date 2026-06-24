import React from 'react';
import { selectCounterState, counterCopy } from '../utils/quotaCounter.js';

/**
 * Persistent quotes-remaining counter (locked spec 2026-06-23).
 *
 * Always-visible companion to SubscriptionBanner. Smaller (~12px),
 * single line, sits above the banner on every authenticated screen.
 * Reads the `billing` block from /auth/me — no new API.
 *
 * Four states ship in this PR (PR B). The fifth — purchased-remaining
 * — is RESERVED for PR C; see the TODO in quotaCounter.js.
 *
 * Refresh: when the parent (App.jsx) re-fetches /auth/me after a
 * successful analysis, the `billing` prop updates and this component
 * re-renders naturally. Failed analyses do NOT trigger a refetch —
 * the count stays put.
 *
 * Mobile + desktop placement is identical (top of the main content
 * column, above SubscriptionBanner). The `fq:` breakpoint is mirrored
 * in the wrapper class so future divergence stays simple.
 */
export default function QuotaCounter({ billing }) {
  const state = selectCounterState(billing);
  if (!state) return null;

  const copy = counterCopy(billing);
  if (!copy) return null;

  // Tone hints — keeps the strip visually quiet for healthy states
  // (subscribed / comped) and slightly warmer when the user is
  // burning down the free allowance. Uses --tq-* vars only — no
  // hard-coded fallbacks (the TRQ-168 lesson on cache-buster /
  // default colour drift).
  const isLow = state === 'free-remaining' && remainingFromBilling(billing) <= 1;
  const isExhausted = state === 'quota_exhausted';

  let tint;
  if (isExhausted) tint = 'rgba(248, 113, 113, 0.12)';
  else if (isLow) tint = 'rgba(251, 191, 36, 0.10)';
  else tint = 'transparent';

  return (
    <div
      data-testid="quota-counter"
      data-state={state}
      className="fq:text-xs text-[12px] font-body fq:mb-2 mb-2 px-3 py-1.5 rounded flex items-center justify-between gap-2"
      style={{
        backgroundColor: tint,
        color: 'var(--tq-muted)',
        border: tint === 'transparent' ? '1px solid transparent' : '1px solid currentColor',
        lineHeight: 1.2,
      }}
    >
      <span data-testid="quota-counter-text">{copy}</span>
      {isExhausted && (
        <a
          data-testid="quota-counter-subscribe"
          href="/api/billing/checkout"
          onClick={handleSubscribeClick}
          className="text-[11px] font-heading font-bold uppercase tracking-wide underline"
          style={{ color: 'inherit', textDecorationColor: 'currentColor' }}
        >
          Subscribe
        </a>
      )}
    </div>
  );
}

// Helper kept outside the component so the test source-scan can find
// it without faking React state.
function remainingFromBilling(billing) {
  const used = Number(billing?.freeQuotesUsed) || 0;
  const limit = Number(billing?.freeQuotesLimit) || 0;
  return Math.max(0, limit - used);
}

// Anchor-style "Subscribe" link kicks the user into Stripe Checkout.
// The SubscriptionBanner's "exhausted" variant uses a POST + redirect
// dance; here we hand off to the same endpoint via a plain link so
// the counter stays simple. The browser fetches the checkout URL via
// a quick POST and follows the returned redirect. Failures are
// silent — banner remains the loud channel.
function handleSubscribeClick(e) {
  e.preventDefault();
  (async () => {
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!r.ok) return;
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      // Best-effort — banner is the loud channel for billing.
    }
  })();
}
