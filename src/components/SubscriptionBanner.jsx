import React, { useState, useEffect } from 'react';
import { isTrialEndingSoon, dayCopy, pickBannerVariant, freeQuotesCopy } from '../utils/trialState.js';

/**
 * Subscription banner — surfaces the trial / billing state to the
 * user without dominating the UI.
 *
 * Variant picking lives in `src/utils/trialState.js` so it's
 * unit-testable without a JSX transform. This component is a thin
 * switch + presentation layer + fetch effect.
 *
 * The status endpoint (/api/billing/status) returns `configured:
 * false` when Stripe env vars aren't set in this environment. In that
 * case we render null — no point showing a "trial" banner when
 * billing isn't wired up.
 *
 * Errors fetching status are swallowed silently — a billing banner
 * that breaks the app isn't a banner, it's a bug. We re-fetch every
 * 5 minutes so the state stays roughly fresh.
 */
export default function SubscriptionBanner({ enabled = true }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/billing/status');
        if (!r.ok) return;
        const data = await r.json();
        if (alive) setStatus(data);
      } catch {
        // Ignore — the banner is best-effort.
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled]);

  const variant = pickBannerVariant(status);
  if (variant === 'none') return null;

  const openCheckout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!r.ok) throw new Error(`checkout ${r.status}`);
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      setBusy(false);
      // Best-effort — if the checkout fails, the user can try again.
    }
  };

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' });
      if (!r.ok) throw new Error(`portal ${r.status}`);
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      setBusy(false);
    }
  };

  // Variants — separated so the test suite can assert each shape
  // independently. Keep the JSX in this file deliberately flat.

  if (variant === 'past-due') {
    return (
      <Strip tone="urgent" testId="subscription-banner-past-due">
        <Body>
          <strong>Payment failed.</strong> Update your card to keep using FastQuote.
        </Body>
        <Cta onClick={openPortal} disabled={busy}>Update payment</Cta>
      </Strip>
    );
  }

  if (variant === 'canceled') {
    return (
      <Strip tone="urgent" testId="subscription-banner-canceled">
        <Body>
          <strong>Your subscription has ended.</strong> Resubscribe to keep using FastQuote.
        </Body>
        <Cta onClick={openCheckout} disabled={busy}>Resubscribe</Cta>
      </Strip>
    );
  }

  if (variant === 'expired') {
    return (
      <Strip tone="urgent" testId="subscription-banner-expired">
        <Body>
          <strong>Your free trial has ended.</strong> Add a payment method to keep using FastQuote.
        </Body>
        <Cta onClick={openCheckout} disabled={busy}>Subscribe — £{status.pricing?.gbpPerMonth?.toFixed(2) || '19.99'}/month</Cta>
      </Strip>
    );
  }

  if (variant === 'exhausted') {
    // Hard lockout (2026-06-22). Server's /analyse 402s on the next
    // attempt. CTA opens Stripe Checkout — no portal because the user
    // doesn't have a Stripe customer yet (they never started a paid
    // subscription, just used the 3 free quotes).
    return (
      <Strip tone="urgent" testId="subscription-banner-exhausted">
        <Body>
          <strong>You've used your 3 free quotes. Subscribe to continue.</strong>
        </Body>
        <Cta onClick={openCheckout} disabled={busy}>Subscribe — £{status.pricing?.gbpPerMonth?.toFixed(2) || '19.99'}/month</Cta>
      </Strip>
    );
  }

  if (variant === 'free-remaining') {
    // Soft CTA (2026-06-22). User is still inside the 3 free quotes
    // — banner reminds them quietly without blocking anything.
    return (
      <Strip tone="muted" testId="subscription-banner-free-remaining">
        <Body>
          {freeQuotesCopy(status.freeQuotesUsed ?? 0, status.freeQuotesLimit ?? 3)}.
        </Body>
        <Cta onClick={openCheckout} disabled={busy}>Subscribe</Cta>
      </Strip>
    );
  }

  if (variant === 'trial-ending') {
    // CTA opens Checkout, not Portal. During the no-card-upfront
    // trial the user has no Stripe customer yet — Portal would 400
    // with "No subscription on file". Checkout creates the
    // customer + subscription in one go and Stripe handles the
    // remaining trial days automatically before billing kicks in.
    return (
      <Strip tone="warning" testId="subscription-banner-trial-ending">
        <Body>
          <strong>Your free trial ends in {dayCopy(status.daysOfTrialRemaining)}.</strong> Add a payment method to keep using FastQuote when it does.
        </Body>
        <Cta onClick={openCheckout} disabled={busy}>Add payment method</Cta>
      </Strip>
    );
  }

  // variant === 'trial' — quiet strip without a CTA.
  return (
    <Strip tone="muted" testId="subscription-banner-trial">
      <Body>
        Free trial: {dayCopy(status.daysOfTrialRemaining)} remaining.
      </Body>
    </Strip>
  );
}

// ─────────────────── presentational ───────────────────

function Strip({ tone, testId, children }) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.muted;
  return (
    <div
      data-testid={testId}
      className="rounded px-4 py-3 mb-4 flex items-center justify-between gap-3"
      style={styles}
    >
      {children}
    </div>
  );
}

function Body({ children }) {
  return (
    <p className="text-sm font-body flex-1" style={{ margin: 0 }}>
      {children}
    </p>
  );
}

function Cta({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs font-heading font-bold uppercase tracking-wide px-3 py-1.5 rounded transition-colors shrink-0"
      style={{
        border: '1px solid currentColor',
        minHeight: 36,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'wait' : 'pointer',
        background: 'transparent',
        color: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

const TONE_STYLES = {
  muted: {
    backgroundColor: 'rgba(148, 163, 184, 0.10)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    color: '#94a3b8',
  },
  warning: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    border: '1px solid rgba(251, 191, 36, 0.35)',
    color: '#f59e0b',
  },
  urgent: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    border: '1px solid rgba(248, 113, 113, 0.35)',
    color: '#f87171',
  },
};
