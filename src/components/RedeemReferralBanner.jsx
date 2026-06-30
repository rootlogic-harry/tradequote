import React, { useState, useCallback } from 'react';

/**
 * Referrals Phase 1 (2026-06-30 fix) — manual redemption surface.
 *
 * The 2026-06-23 spec called for a "Got a referral code?" field on
 * the login page. When `LOGIN_PAGE_HTML` was rebuilt for Auth0
 * Universal Login (2026-06-29) the field never made it across, so the
 * existing POST /auth/redeem-referral endpoint had no client caller —
 * users who signed up without `?ref=` had no way to redeem retroactively.
 *
 * This banner restores that path on the Dashboard:
 *   - Collapsed by default ("Got a referral code?")
 *   - Expands to a short input + Apply button
 *   - POSTs to /auth/redeem-referral
 *   - On success: refreshes /auth/me and self-hides
 *   - On no-op (unknown / self / already-redeemed): inline message
 *
 * Gating (caller-side via the `billing` prop):
 *   - bonus_free_quotes === 0 (haven't already redeemed)
 *   - quotaState in {'free-remaining', 'quota_exhausted'} (still on the
 *     free tier — bug-hunt 2026-06-30 #5 added 'quota_exhausted' to the
 *     gate because an exhausted user is exactly who'd benefit most from
 *     redeeming a code: +2 bonus quotes bumps effectiveLimit past
 *     freeQuotesUsed, making them spendable again. Subscribed / comped
 *     / purchased-remaining users still don't see the banner — they'd
 *     get no immediate value from a code redeem.)
 *
 * Banned-vocab safe (referral / code / bonus all allowed per the
 * locked spec).
 */
export default function RedeemReferralBanner({ billing, onRedeemed }) {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const shouldShow =
    billing
    && Number(billing.bonusFreeQuotes) === 0
    && (billing.quotaState === 'free-remaining' || billing.quotaState === 'quota_exhausted');

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
        // Collapse after a short pause so the user reads the toast.
        setTimeout(() => setExpanded(false), 1800);
        return;
      }
      // applied === false: unknown / self / already-redeemed / malformed.
      // Server endpoint never errors on these — it returns 200 with
      // applied:false. Surface as a quiet inline message.
      setMessage({ kind: 'info', text: "Code not recognised — check it and try again." });
    } catch {
      setMessage({ kind: 'info', text: 'Could not reach the server. Try again in a moment.' });
    } finally {
      setSubmitting(false);
    }
  }, [code, onRedeemed]);

  if (!shouldShow) return null;

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
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="btn-link text-sm"
          style={{ minHeight: 44, padding: '0', textAlign: 'left' }}
          data-testid="redeem-referral-open"
        >
          Got a referral code? Add it for bonus quotes.
        </button>
      )}

      {expanded && (
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
            <button
              type="button"
              onClick={() => { setExpanded(false); setCode(''); setMessage(null); }}
              className="btn-ghost text-xs w-full fq:w-auto"
              style={{ minHeight: 44, padding: '0 12px' }}
              data-testid="redeem-referral-cancel"
              disabled={submitting}
            >
              Cancel
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
      )}
    </div>
  );
}
