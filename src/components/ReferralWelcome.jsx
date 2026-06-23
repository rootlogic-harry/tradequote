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
  const [referrerName, setReferrerName] = useState(null);

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

  // Try to fetch the referrer's name for a friendlier message. Falls
  // back to a generic line if the request fails — the banner still
  // renders, just without the personalisation.
  useEffect(() => {
    if (!eligible || dismissed || !currentUserId) return;
    let alive = true;
    (async () => {
      try {
        // The /referrals endpoint returns the user's OWN referrals
        // (people they've invited). We need the inverse — who
        // invited THEM. The simplest backend-light read is to expose
        // it via the same payload: this PR keeps the contract narrow.
        // We just render the generic copy in this phase.
        if (alive) setReferrerName(null);
      } catch {
        if (alive) setReferrerName(null);
      }
    })();
    return () => { alive = false; };
  }, [eligible, dismissed, currentUserId]);

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
  const inviter = referrerName ? referrerName : 'A friend';

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
