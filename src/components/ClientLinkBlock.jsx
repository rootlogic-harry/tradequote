import React, { useState, useEffect, useCallback } from 'react';
import { getClientStatus, generateClientToken, SessionExpiredError } from '../utils/userDB.js';
import { documentTerm } from '../utils/documentType.js';

/**
 * Trader-side Client Portal hero card (Step 5 / QuoteOutput redesign).
 *
 * Promoted from the buried dark box at the bottom of Step 5 to the hero
 * card right under the Send / Download split-buttons (see the Quote
 * Screen redesign spec). The structural design is now:
 *
 *   ┌─ Client link ────────────────────── [Accepted ●]
 *   │ Your client views and accepts here…
 *   │ ┌──────────────────────────────────┐ ┌──────┐
 *   │ │ https://fastquote.uk/q/…         │ │ Copy │
 *   │ └──────────────────────────────────┘ └──────┘
 *   │  ●—————————●—————————○
 *   │  Sent       Viewed     Accepted
 *   │  22 Apr     22 Apr     —
 *   │  Sending to someone else? Regenerate link
 *   └─────────────────────────────────────────────
 *
 * Five derivable states, all driven by the existing client-status route
 * (server.js:3055 — no schema change). The component still exposes the
 * pre-generate CTA when no token exists yet.
 *
 * URL is always what the server returned — never synthesised client-side
 * (TRQ-131 contract). Regenerate is gated by a window.confirm so the
 * trader can't silently invalidate the link they've already shared.
 */
export default function ClientLinkBlock({ currentUserId, jobId, profile, showToast, requireProfile, jobStatus }) {
  const term = documentTerm(profile);
  const [status, setStatus] = useState(null);   // null = loading; {} = loaded
  const [loadError, setLoadError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentUserId || !jobId) return;
    try {
      const s = await getClientStatus(currentUserId, jobId);
      setStatus(s);
      setLoadError(null);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        window.location.href = '/login?error=session_expired';
        return;
      }
      setLoadError(err.message || 'Failed to load client link status');
    }
  }, [currentUserId, jobId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleGenerate() {
    // TRQ-94: block link generation until the tradesman's company
    // details are filled in. The portal renders profile.companyName,
    // address, VAT etc. — generating with a blank profile would freeze
    // an embarrassing snapshot (see CLAUDE.md frozen-snapshot contract).
    if (requireProfile && !requireProfile()) return;
    setGenerating(true);
    try {
      await generateClientToken(currentUserId, jobId);
      await refresh();
      showToast?.('Client link ready — tap Copy to share it', 'success');
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        window.location.href = '/login?error=session_expired';
        return;
      }
      showToast?.(err.message || 'Could not create client link', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    const ok = window.confirm(
      'Regenerating will immediately invalidate the link you already shared. Continue?'
    );
    if (!ok) return;
    setGenerating(true);
    try {
      await generateClientToken(currentUserId, jobId);
      await refresh();
      showToast?.('Fresh link ready — the previous one no longer works', 'success');
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        window.location.href = '/login?error=session_expired';
        return;
      }
      showToast?.(err.message || 'Could not regenerate link', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!status?.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast?.('Link copied — paste into WhatsApp or email', 'success');
    } catch {
      showToast?.('Copy failed — please select and copy the link manually', 'error');
    }
  }

  if (!currentUserId || !jobId) return null;
  if (loadError) {
    return (
      <div className="qo-hero-card" style={{ color: 'var(--tq-error-txt)' }}>
        {loadError}
      </div>
    );
  }

  // Pre-generate — single CTA, no link yet.
  if (!status || !status.hasToken) {
    return (
      <div className="qo-hero-card qo-hero-card--pre">
        <div className="qo-hero-head">
          <span className="qo-hero-title">Client link</span>
          <span className="qo-status-badge qo-status-badge--draft" data-testid="static">
            <i aria-hidden /> Not generated
          </span>
        </div>
        <p className="qo-hero-sub">
          Generates a private, expiring link you can send to your client
          via email, SMS or WhatsApp. They can review the {term.lower} and tap
          Accept or Decline &mdash; you&rsquo;ll see the response on your dashboard.
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={handleGenerate}
          disabled={generating || status === null}
          style={{ minHeight: 44 }}
        >
          {generating ? 'Creating link…' : 'Create client link'}
        </button>
      </div>
    );
  }

  // Derived display state for the header status pill + timeline.
  const { expired, viewed, viewedAt, response, responseAt, expires, declineReason } = status;

  // We need a "sent" timestamp anchor — the closest the server gives us
  // is the token issuance reflected in `expires - 30 days`. We don't
  // surface that as the literal "sent" time though; the timeline shows
  // the canonical milestones (sent → viewed → accepted) and uses the
  // recorded timestamps when present.
  //
  // For the "Sent" stage we use the token's implied creation time when
  // we have it. The expires column carries `client_token_expires_at`,
  // which is set at token generation. We treat token issuance as the
  // moment the quote was made shareable — it's the only "sent"-ish
  // timestamp the existing schema gives us without a migration.
  const sentAt = status.expires
    ? new Date(new Date(status.expires).getTime() - 30 * 24 * 60 * 60 * 1000)
    : null;

  const pillKind = expired && !response
    ? 'expired'
    : response === 'accepted'
      ? 'accepted'
      : response === 'declined'
        ? 'declined'
        : viewed
          ? 'viewed'
          : 'sent';

  const pillLabel = {
    sent:     'Sent',
    viewed:   'Viewed',
    accepted: 'Accepted',
    declined: 'Declined',
    expired:  'Link expired',
  }[pillKind];

  return (
    <div className={`qo-hero-card qo-hero-card--${pillKind}`} data-testid="client-link-hero">
      <div className="qo-hero-head">
        <span className="qo-hero-title">Client link</span>
        <span className={`qo-status-badge qo-status-badge--${pillKind}`}>
          <i aria-hidden /> {pillLabel}
        </span>
      </div>
      <p className="qo-hero-sub">
        Your client views and accepts the {term.lower} here &mdash; no login needed.
      </p>

      <div className="qo-link-url">
        <input
          readOnly
          value={status.url}
          aria-label="Client portal link"
          onFocus={(e) => e.target.select()}
          style={{ minHeight: 44 }}
        />
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy client link"
          style={{ minHeight: 44 }}
          className={copied ? 'qo-link-url-copy qo-link-url-copy--copied' : 'qo-link-url-copy'}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>

      <ol className="qo-timeline" aria-label="Client link timeline">
        <li className={`qo-tl qo-tl--done`} data-stage="sent">
          <span className="qo-tl-dot" aria-hidden />
          <span className="qo-tl-k">Sent</span>
          <span className="qo-tl-t">{formatDateTime(sentAt) || '—'}</span>
        </li>
        <li className={`qo-tl ${viewed ? 'qo-tl--done' : 'qo-tl--pending'}`} data-stage="viewed">
          <span className="qo-tl-dot" aria-hidden />
          <span className="qo-tl-k">Viewed</span>
          <span className="qo-tl-t">{viewed ? formatDateTime(viewedAt) : '—'}</span>
        </li>
        <li
          className={`qo-tl ${response === 'accepted' ? 'qo-tl--done' : response === 'declined' ? 'qo-tl--declined' : 'qo-tl--pending'}`}
          data-stage="accepted"
        >
          <span className="qo-tl-dot" aria-hidden />
          <span className="qo-tl-k">
            {response === 'declined' ? 'Declined' : 'Accepted'}
          </span>
          <span className="qo-tl-t">
            {response ? formatDateTime(responseAt) : '—'}
          </span>
        </li>
      </ol>

      {response === 'declined' && declineReason && (
        <div className="qo-decline-reason">
          <span className="qo-decline-reason-k">Decline reason</span>
          <span>{declineReason}</span>
        </div>
      )}

      {expires && (
        <div className="qo-hero-expiry">Link expires {formatDate(expires)}</div>
      )}

      <div className="qo-hero-regen">
        <span className="qo-hero-regen-txt">Sending to someone else?</span>
        <button
          type="button"
          className="qo-hero-regen-btn"
          onClick={handleRegenerate}
          disabled={generating}
          style={{ minHeight: 44 }}
        >
          {generating ? 'Regenerating…' : 'Regenerate link'}
        </button>
      </div>
    </div>
  );
}

function formatDate(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(input) {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}
