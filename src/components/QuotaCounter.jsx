import React from 'react';
import {
  selectCounterState,
  counterCopy,
  counterBreakdown,
} from '../utils/quotaCounter.js';

/**
 * Unified quotes-remaining banner — single source of truth for the
 * quota-driven banner surface.
 *
 * Locked spec 2026-06-23, extended 2026-06-24 with the £9.99
 * pay-as-you-go pack, and unified 2026-06-25 to absorb the quota
 * branches of SubscriptionBanner. One strip carries both CTAs (Buy
 * + Subscribe) so the user reads one count and sees both upgrade
 * paths together — no more two-component split.
 *
 * Per-state visibility (the locked table):
 *
 *   subscribed              → render nothing (no nudge needed)
 *   comped                  → label only ("Free through {month}");
 *                              no CTAs (Paul shouldn't see Buy/Subscribe
 *                              during a comp)
 *   free-remaining          → text + Buy + Subscribe
 *   purchased-remaining     → text + Buy + Subscribe
 *   quota_exhausted         → urgent text + Buy + Subscribe
 *
 * Mixed state (free + purchased > 0): main label shows the combined
 * total ("5 quotes left") with a breakdown underneath ("2 free + 3
 * paid"). Comes from `counterCopy` + `counterBreakdown` in the pure
 * helper.
 *
 * Buttons:
 *   - BUY 5 QUOTES — £9.99 → POST /api/billing/buy-quote-pack
 *   - SUBSCRIBE — £19.99/month → POST /api/billing/checkout
 *
 * Tone palette:
 *   - subscribed / comped / purchased-remaining → muted
 *   - free-remaining low (≤ 1 remaining) → muted (warmer)
 *   - quota_exhausted → urgent (red)
 *
 * Mobile: stack the text + CTAs vertically (text on top, CTAs as two
 * stacked buttons). Desktop: inline strip with text left, CTAs right.
 * The `fq:` Tailwind breakpoint mirrors the rest of the app.
 *
 * Refresh: when the parent (App.jsx) re-fetches /auth/me after a
 * successful analysis, the `billing` prop updates and this component
 * re-renders naturally. Failed analyses do NOT trigger a refetch —
 * the count stays put.
 */
export default function QuotaCounter({ billing }) {
  const state = selectCounterState(billing);
  if (!state) return null;

  const copy = counterCopy(billing);
  if (!copy) return null;

  const breakdown = counterBreakdown(billing);

  // CTA visibility per locked spec — Buy + Subscribe both visible in
  // the three quota-spending states; both suppressed for subscribed
  // (no nudge needed) and comped (Paul shouldn't see them).
  const showBuyButton =
    state === 'free-remaining' ||
    state === 'purchased-remaining' ||
    state === 'quota_exhausted';
  const showSubscribeButton =
    state === 'free-remaining' ||
    state === 'purchased-remaining' ||
    state === 'quota_exhausted';

  const isExhausted = state === 'quota_exhausted';

  // Tone — muted for healthy / mid states; urgent (red) for
  // quota_exhausted. Mirrors SubscriptionBanner's tone palette so the
  // visual language stays consistent across both banners. Uses --tq-*
  // vars only — no hard-coded fallbacks (the TRQ-168 lesson).
  const tone = isExhausted ? TONE_STYLES.urgent : TONE_STYLES.muted;

  return (
    <div
      data-testid="quota-counter"
      data-state={state}
      className="fq:flex-row flex-col fq:items-center items-stretch fq:gap-3 gap-2 rounded px-4 py-3 mb-4 flex justify-between"
      style={{
        backgroundColor: tone.backgroundColor,
        border: tone.border,
        color: tone.color,
      }}
    >
      <div className="flex-1 min-w-0">
        <p
          data-testid="quota-counter-text"
          className="text-sm font-body"
          style={{ margin: 0, color: 'var(--tq-text)' }}
        >
          {isExhausted ? <strong>{copy}</strong> : copy}
        </p>
        {breakdown && (
          <p
            data-testid="quota-counter-breakdown"
            className="text-xs font-body"
            style={{ margin: 0, marginTop: 2, color: 'var(--tq-muted)' }}
          >
            {breakdown}
          </p>
        )}
      </div>
      {(showBuyButton || showSubscribeButton) && (
        <div className="flex fq:flex-row flex-col fq:items-center items-stretch fq:gap-2 gap-2 shrink-0">
          {showBuyButton && (
            <button
              type="button"
              data-testid="quota-counter-buy"
              onClick={handleBuyClick}
              className="text-xs font-heading font-bold uppercase tracking-wide px-3 py-1.5 rounded transition-colors"
              style={{
                border: '1px solid currentColor',
                minHeight: 44,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Buy 5 quotes &mdash; £9.99
            </button>
          )}
          {showSubscribeButton && (
            <button
              type="button"
              data-testid="quota-counter-subscribe"
              onClick={handleSubscribeClick}
              className="text-xs font-heading font-bold uppercase tracking-wide px-3 py-1.5 rounded transition-colors"
              style={{
                border: '1px solid currentColor',
                minHeight: 44,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Subscribe &mdash; £19.99/month
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Anchor-style "Subscribe" button kicks the user into Stripe Checkout.
// Mirrors the SubscriptionBanner pattern — POST to /api/billing/checkout
// and follow the returned URL. Failures are silent — banner is the
// loud channel for billing.
function handleSubscribeClick(e) {
  e.preventDefault();
  (async () => {
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!r.ok) return;
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      // Best-effort — surface failures via the next /auth/me refresh.
    }
  })();
}

// Buy-pack button (2026-06-24). POSTs to /api/billing/buy-quote-pack
// and follows the returned Stripe Checkout URL. Failures are silent
// for the same reason as the subscribe button above.
function handleBuyClick(e) {
  e.preventDefault();
  (async () => {
    try {
      const r = await fetch('/api/billing/buy-quote-pack', { method: 'POST' });
      if (!r.ok) return;
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      // Best-effort — surface failures via the next /auth/me refresh.
    }
  })();
}

// Tone palette mirrors SubscriptionBanner's so the visual language
// stays consistent across both surfaces. Uses --tq-* CSS vars where
// possible (text colour) and stays with inline rgba for the tonal
// backgrounds — same as SubscriptionBanner.
const TONE_STYLES = {
  muted: {
    backgroundColor: 'rgba(148, 163, 184, 0.10)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    color: 'var(--tq-muted)',
  },
  urgent: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    border: '1px solid rgba(248, 113, 113, 0.35)',
    color: '#f87171',
  },
};
