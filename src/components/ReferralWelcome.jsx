import React, { useEffect, useState } from 'react';

/**
 * Referrals Phase 1 (2026-06-23) — referee-side welcome banner.
 *
 * Renders on first dashboard load for a referred user, then dismisses
 * and never shows again (sessionStorage-persisted).
 *
 * Detection rule (matches the spec): show the banner when the user
 * has bonus quotes but has not yet used any — i.e. they signed up via
 * a referral and haven't started consuming the bonus yet. This avoids
 * an extra API roundtrip for the referral row (which is also a fine
 * signal, but bonus-quotes>0 + used=0 captures the same intent).
 *
 * Banned-vocab safe: uses "invited" + "free quotes" — both on the
 * locked spec's allow list.
 */
const DISMISS_KEY = 'fq.ref.welcome.dismissed';

export default function ReferralWelcome({ billing, currentUserId }) {
  const [dismissed, setDismissed] = useState(false);

  // Read persisted dismissal once on mount. sessionStorage so the user
  // sees it once per browser session but it won't reappear on every
  // page refresh.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage?.getItem(DISMISS_KEY)) {
        setDismissed(true);
      }
    } catch {
      // sessionStorage unavailable (private mode in some browsers) —
      // banner will show each load; acceptable degradation.
    }
  }, []);

  const eligible = Boolean(
    billing
      && Number(billing.bonusFreeQuotes) > 0
      && Number(billing.freeQuotesUsed) === 0
  );

  if (!eligible || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.setItem(DISMISS_KEY, '1');
      }
    } catch {
      // Ignore — banner is dismissed for this render either way.
    }
  };

  const total = Number(billing.freeQuotesLimit) || 5;
  // Referrer name comes from /auth/me's billing.referredBy block.
  // Falls back to "A friend" if the JOIN failed or this user is somehow
  // eligible-by-bonus-but-no-referral-row (edge case from manual bonus
  // grants, shouldn't happen in normal flow).
  const inviter = billing?.referredBy?.name || 'A friend';

  return (
    <div
      data-testid="referral-welcome-banner"
      className="rounded px-4 py-3 mb-4 flex items-center justify-between gap-3"
      style={{
        backgroundColor: 'rgba(232, 168, 56, 0.10)',
        border: '1px solid rgba(232, 168, 56, 0.35)',
        color: '#e8a838',
      }}
    >
      <p className="text-sm font-body flex-1" style={{ margin: 0 }}>
        <strong>Welcome.</strong> {inviter} invited you. You've got {total} free quotes to try FastQuote.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        className="text-xs font-heading font-bold uppercase tracking-wide px-3 py-1.5 rounded transition-colors shrink-0"
        style={{
          border: '1px solid currentColor',
          minHeight: 36,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
        aria-label="Dismiss welcome banner"
      >
        Dismiss
      </button>
    </div>
  );
}
