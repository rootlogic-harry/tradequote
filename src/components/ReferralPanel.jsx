import React, { useEffect, useState, useCallback } from 'react';

/**
 * Referrals Phase 1 (2026-06-23) — referrer surface.
 *
 * Lives on the Dashboard. Shows three things:
 *   1. The user's referral code (lazy-generated server-side on first GET).
 *   2. How many bonus quotes they've earned so far.
 *   3. A shareable link with a one-tap share/copy button.
 *
 * The "share" button uses navigator.share (Web Share API) on mobile —
 * Paul will tap it then pick WhatsApp from the OS sheet. Desktop falls
 * back to clipboard copy with a toast confirmation.
 *
 * Banned-vocab safe (referral / code / invite / share / earn / bonus
 * are all explicitly safe per the locked spec).
 */
export default function ReferralPanel({ currentUserId, userName, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!currentUserId) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/users/${currentUserId}/referrals`);
        if (!r.ok) {
          if (alive) setLoading(false);
          return;
        }
        const j = await r.json();
        if (alive) {
          setData(j);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [currentUserId]);

  const shareUrl = data?.code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://fastquote.uk'}/?ref=${encodeURIComponent(data.code)}`
    : '';

  const handleShare = useCallback(async () => {
    if (!shareUrl) return;
    const shareText = `Try FastQuote — quotes in minutes, not hours. Use my code ${data?.code} for 2 free quotes: ${shareUrl}`;
    // Prefer the OS share sheet on mobile (Paul → WhatsApp). Fall
    // back to clipboard on desktop where navigator.share is absent.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'FastQuote', text: shareText, url: shareUrl });
        return;
      } catch {
        // User cancelled or share unsupported — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard?.writeText?.(shareUrl);
      setCopied(true);
      if (typeof showToast === 'function') showToast('Link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Final fallback: select the link text so the user can copy manually.
      // Browsers without clipboard permission still allow selection.
    }
  }, [shareUrl, data?.code, showToast]);

  const handleCopyCode = useCallback(async () => {
    if (!data?.code) return;
    try {
      await navigator.clipboard?.writeText?.(data.code);
      if (typeof showToast === 'function') showToast('Code copied');
    } catch {
      // Silent — clipboard permission may be denied. Code is visible
      // on-screen so the user can copy manually.
    }
  }, [data?.code, showToast]);

  if (loading || !data || !data.code) return null;

  const bonus = Number(data.bonusFreeQuotes) || 0;
  const earnedCount = (data.referrals || []).filter((r) => r.status === 'earned').length;

  return (
    <div
      className="mb-8 p-4 fq:p-5"
      data-testid="referral-panel"
      style={{
        backgroundColor: 'var(--tq-card)',
        border: '1px solid var(--tq-border)',
        borderRadius: 2,
      }}
    >
      <div className="flex flex-col fq:flex-row fq:items-start fq:justify-between gap-3 mb-4">
        <div>
          <div className="eyebrow mb-1">Share FastQuote</div>
          <div className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            Friends get 2 extra free quotes. You earn 2 more every time someone you invite finishes their first quote.
          </div>
        </div>
        <div className="text-sm shrink-0" style={{ color: 'var(--tq-muted)' }}>
          <strong style={{ color: 'var(--tq-text)' }}>{bonus}</strong> bonus quote{bonus === 1 ? '' : 's'} earned
        </div>
      </div>

      <div className="flex flex-col fq:flex-row gap-2 fq:items-center">
        <div
          className="flex-1 px-3 py-2 font-mono text-sm"
          style={{
            backgroundColor: 'var(--tq-bg)',
            border: '1px solid var(--tq-border)',
            borderRadius: 2,
            letterSpacing: '0.05em',
            color: 'var(--tq-text)',
          }}
          data-testid="referral-code"
        >
          {data.code}
        </div>
        <button
          type="button"
          onClick={handleCopyCode}
          className="btn-ghost text-xs"
          style={{ height: 40, padding: '0 16px' }}
        >
          Copy code
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="btn-primary text-xs"
          style={{ height: 40, padding: '0 16px' }}
          data-testid="referral-share"
        >
          {copied ? 'Copied!' : 'Share link'}
        </button>
      </div>

      {earnedCount > 0 && (
        <div className="mt-3 text-xs" style={{ color: 'var(--tq-muted)' }}>
          {earnedCount} friend{earnedCount === 1 ? '' : 's'} active so far.
        </div>
      )}
    </div>
  );
}
