import React, { useState } from 'react';

/**
 * Quota-exhausted modal (2026-06-29).
 *
 * Shown when `state.quotaLockout` is set — fired by either:
 *   - `handleStartNewQuote` / `handleStartQuickQuote` in App.jsx when an
 *     exhausted user clicks the "New quote" CTA
 *   - the analyse-success path when the 402 lockout comes back from the
 *     server (per `src/utils/analyseJob.js`)
 *
 * Previously the lockout UI was only rendered as an inline panel on the
 * AIAnalysis (Step 3) screen — which the user never reaches if they're
 * stopped at Step 1 / Dashboard. The click became a silent dead-end.
 *
 * This modal mounts globally in App.jsx so the lockout surfaces wherever
 * the user is, with both forward paths (Buy 5 / Subscribe) plus a cancel.
 *
 * Visibility: basic-user surface. No banned vocab. The Stripe round-trip
 * survives natively — both endpoints return `{ url }` and we
 * `window.location.href` straight to Stripe Checkout.
 */
export default function QuotaExhaustedModal({ lockout, onDismiss }) {
  const [busy, setBusy] = useState(null); // 'pack' | 'sub' | null

  if (!lockout) return null;

  const lockoutLimit = Number.isFinite(lockout.freeQuotesLimit) && lockout.freeQuotesLimit > 0
    ? lockout.freeQuotesLimit
    : 3;

  const handleBuyPack = async () => {
    setBusy('pack');
    try {
      const r = await fetch('/api/billing/buy-quote-pack', { method: 'POST' });
      if (!r.ok) { setBusy(null); return; }
      const { url } = await r.json();
      if (url) window.location.href = url;
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  };

  const handleSubscribe = async () => {
    setBusy('sub');
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!r.ok) { setBusy(null); return; }
      const { url } = await r.json();
      if (url) window.location.href = url;
      else setBusy(null);
    } catch {
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-modal-title"
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 460,
          maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1.5px solid var(--tq-border)',
          boxShadow: '0 24px 60px -12px rgba(40,28,12,0.4)',
        }}
      >
        {/* Header band */}
        <div
          style={{
            padding: '18px 22px',
            background: 'var(--tq-accent-bg, rgba(189,94,9,0.08))',
            borderBottom: '1.5px solid var(--tq-accent-bd, var(--tq-accent))',
          }}
        >
          <h3
            id="quota-modal-title"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800, fontSize: 22, color: 'var(--tq-text)',
              margin: 0, letterSpacing: '0.01em',
            }}
          >
            You're out of free quotes
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--tq-muted)', fontSize: 13.5 }}>
            You've used all {lockoutLimit} free quotes. Pick how you'd like to keep going.
          </p>
        </div>

        {/* Body — two options */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: '1 1 auto' }}>
          <button
            type="button"
            onClick={handleBuyPack}
            disabled={busy !== null}
            style={{
              width: '100%', textAlign: 'left',
              padding: '14px 16px', marginBottom: 12,
              border: '1.5px solid var(--tq-accent)',
              borderRadius: 8, background: 'var(--tq-accent)',
              color: '#fff', cursor: busy === null ? 'pointer' : 'not-allowed',
              opacity: busy !== null && busy !== 'pack' ? 0.55 : 1,
              minHeight: 64,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <div
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 16, letterSpacing: '0.04em',
                textTransform: 'uppercase', marginBottom: 2,
              }}
            >
              {busy === 'pack' ? 'Opening checkout…' : 'Buy 5 quotes — £9.99'}
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.92 }}>
              One-off top up · no expiry · use when you need them
            </div>
          </button>

          <button
            type="button"
            onClick={handleSubscribe}
            disabled={busy !== null}
            style={{
              width: '100%', textAlign: 'left',
              padding: '14px 16px',
              border: '1.5px solid var(--tq-border)',
              borderRadius: 8, background: 'var(--tq-surface)',
              color: 'var(--tq-text)', cursor: busy === null ? 'pointer' : 'not-allowed',
              opacity: busy !== null && busy !== 'sub' ? 0.55 : 1,
              minHeight: 64,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <div
              style={{
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 16, letterSpacing: '0.04em',
                textTransform: 'uppercase', marginBottom: 2,
                color: 'var(--tq-text)',
              }}
            >
              {busy === 'sub' ? 'Opening checkout…' : 'Subscribe — £19.99 / month'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--tq-muted)' }}>
              Unlimited quotes · cancel any time
            </div>
          </button>
        </div>

        {/* Footer — single Cancel */}
        <div
          style={{
            display: 'flex', justifyContent: 'flex-end',
            padding: '12px 20px',
            borderTop: '1px solid var(--tq-border)',
            background: 'var(--tq-card)',
          }}
        >
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy !== null}
            style={{
              padding: '10px 18px', borderRadius: 6,
              border: '1px solid var(--tq-border)',
              background: 'transparent', color: 'var(--tq-muted)',
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700, fontSize: 13, letterSpacing: '0.04em',
              textTransform: 'uppercase', cursor: 'pointer',
              minHeight: 44,
            }}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
