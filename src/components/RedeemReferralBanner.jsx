import React, { useState, useCallback } from 'react';

/**
 * Referrals — manual code redemption surface.
 *
 * History:
 *   - 2026-06-23: spec called for the field on the login page.
 *   - 2026-06-29: Auth0 Universal Login rebuild dropped it.
 *   - 2026-06-30: revived as a Dashboard banner (collapse + expand).
 *   - 2026-06-30 (later): Harry moved redeem + share into a single
 *     "Bonus quotes" section in Settings. The component now renders
 *     always-expanded inside that section. The old gating that auto-
 *     hid the form when the user was subscribed / comped / had bonus
 *     quotes is replaced with a "you've redeemed +N" confirmation
 *     state — the section is no longer a banner, it's a settings
 *     surface and should always tell the user where they stand.
 *
 * Component name kept (RedeemReferralBanner) for test stability —
 * the Dashboard-banner concept is gone but the file path is the
 * same so the test suite + project docs don't churn.
 */
export default function RedeemReferralBanner({ billing, onRedeemed }) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault?.();
    const trimmed = (code || '').trim();
    if (!trimmed) {
      setMessage({ kind: 'error', text: 'Enter a code to continue.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const r = await fetch('/auth/redeem-referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.applied === true) {
        setMessage({ kind: 'success', text: 'Code applied — 2 bonus quotes added.' });
        if (typeof onRedeemed === 'function') onRedeemed(j.billing || null);
        return;
      }
      setMessage({ kind: 'info', text: "Code not recognised — check it and try again." });
    } catch {
      setMessage({ kind: 'info', text: 'Could not reach the server. Try again in a moment.' });
    } finally {
      setSubmitting(false);
    }
  }, [code, onRedeemed]);

  // Confirmation state — once a user has redeemed a code (or arrived as
  // a referee whose bonus was applied at signup), there's nothing to
  // enter. Surface the balance so they know the section "did its job"
  // rather than wondering why the form vanished.
  const bonus = Number(billing?.bonusFreeQuotes) || 0;
  if (bonus > 0) {
    return (
      <div
        className="mb-4 fq:mb-6"
        data-testid="redeem-referral-banner"
        style={{
          backgroundColor: 'var(--tq-card)',
          border: '1px solid var(--tq-border)',
          borderRadius: 2,
          padding: '12px 16px',
        }}
      >
        <p
          className="text-sm"
          style={{ color: 'var(--tq-muted)', margin: 0 }}
          data-testid="redeem-referral-redeemed-confirmation"
        >
          You've redeemed a referral code — <strong style={{ color: 'var(--tq-text)' }}>{bonus} bonus quote{bonus === 1 ? '' : 's'}</strong> added to your allowance.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mb-4 fq:mb-6"
      data-testid="redeem-referral-banner"
      style={{
        backgroundColor: 'var(--tq-card)',
        border: '1px solid var(--tq-border)',
        borderRadius: 2,
        padding: '12px 16px',
      }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label
          htmlFor="redeem-referral-code"
          className="eyebrow"
          style={{ color: 'var(--tq-muted)' }}
        >
          Referral code
        </label>
        <div className="flex flex-col fq:flex-row gap-2 fq:items-center">
          <input
            id="redeem-referral-code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. PAULJULY"
            className="nq-field flex-1 font-mono"
            style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}
            data-testid="redeem-referral-input"
            disabled={submitting}
          />
          <button
            type="submit"
            className="btn-primary text-sm w-full fq:w-auto"
            style={{ minHeight: 44, padding: '0 16px' }}
            data-testid="redeem-referral-submit"
            disabled={submitting || !code.trim()}
          >
            {submitting ? 'Applying…' : 'Apply'}
          </button>
        </div>
        {message && (
          <div
            className="text-xs"
            style={{
              color: message.kind === 'success' ? 'var(--tq-accent)' : 'var(--tq-muted)',
              marginTop: 2,
            }}
            data-testid="redeem-referral-message"
            role={message.kind === 'success' ? 'status' : 'alert'}
          >
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}
