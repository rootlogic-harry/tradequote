import React, { useState, useEffect, useCallback } from 'react';
import { getClientStatus, generateClientToken, SessionExpiredError } from '../utils/userDB.js';

/**
 * Trader-side Client Portal block on Step 5 (TRQ-131).
 *
 * Five states, driven by `GET /api/users/:id/jobs/:jobId/client-status`:
 *   1. No token yet              → amber "Create client link" CTA
 *   2. Token exists, not viewed  → URL + Copy + expiry
 *   3. Viewed, no response yet   → + "Viewed {when}"
 *   4. Accepted                  → + "Accepted {when}" (green)
 *   5. Declined                  → + "Declined {when}" + optional reason (red)
 *   (expired   → shown as a single "link expired" line with a Regenerate CTA)
 *
 * URL is always what the server returned — never synthesised client-side.
 * Regenerate is gated by a window.confirm so the trader can't silently
 * invalidate the link they've already shared.
 *
 * Session expiry is handled upstream via `SessionExpiredError` → the
 * block redirects to /login?error=session_expired, matching the
 * dashboard's behaviour (TRQ-128).
 */
export default function ClientLinkBlock({ currentUserId, jobId, showToast }) {
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
    } catch {
      showToast?.('Copy failed — please select and copy the link manually', 'error');
    }
  }

  if (!currentUserId || !jobId) return null;
  if (loadError) {
    return (
      <div className="link-block">
        <div className="link-block-body" style={{ color: '#d97565' }}>
          {loadError}
        </div>
      </div>
    );
  }

  // Pre-generate — single CTA, no link yet.
  if (!status || !status.hasToken) {
    return (
      <div style={{ margin: '20px 0' }}>
        <button
          type="button"
          className="link-first-btn"
          onClick={handleGenerate}
          disabled={generating || status === null}
        >
          {generating ? 'Creating link…' : 'Create client link'}
        </button>
        <p className="link-first-help">
          Generates a private, expiring link you can send to your client
          via email, SMS or WhatsApp. They can review the quote and tap
          Accept or Decline — you&#39;ll see the response on your dashboard.
        </p>
      </div>
    );
  }

  // Derived display state for the header status pill + meta rows.
  const { expired, viewed, viewedAt, response, responseAt, expires, declineReason } = status;
  const pillKind = expired && !response
    ? 'expired'
    : response === 'accepted'
      ? 'accepted'
      : response === 'declined'
        ? 'declined'
        : viewed
          ? 'viewed'
          : null;

  const pillLabel = {
    viewed:   'Viewed',
    accepted: 'Accepted',
    declined: 'Declined',
    expired:  'Link expired',
  }[pillKind] || 'Awaiting view';

  return (
    <div className="link-block">
      <div className="link-block-head">
        <div className="link-block-title">Client link</div>
        <div className={`link-block-status${pillKind ? ` link-block-status--${pillKind}` : ''}`}>
          <span className="link-block-status-dot" aria-hidden />
          {pillLabel}
        </div>
      </div>
      <div className="link-block-body">
        <div className="link-url-row">
          <div className="link-url" title={status.url}>{status.url}</div>
          <button
            type="button"
            className={`link-url-copy${copied ? ' link-url-copy--copied' : ''}`}
            onClick={handleCopy}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>

        <div className="link-meta">
          <div>
            Expires
            <strong>{formatDate(expires)}</strong>
          </div>
          {viewed && (
            <div>
              Viewed
              <strong>{formatDateTime(viewedAt)}</strong>
            </div>
          )}
          {response === 'accepted' && (
            <div className="link-meta-accepted">
              Accepted
              <strong>{formatDateTime(responseAt)}</strong>
            </div>
          )}
          {response === 'declined' && (
            <div className="link-meta-declined">
              Declined
              <strong>{formatDateTime(responseAt)}</strong>
            </div>
          )}
        </div>

        {response === 'declined' && declineReason && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'rgba(184, 74, 58, 0.08)',
              border: '1px solid #3a2220',
              color: '#d9c9a8',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: '#8a7d66', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Decline reason
            </span>
            <br />
            {declineReason}
          </div>
        )}

        <div className="link-regenerate">
          <span className="link-regenerate-text">
            Need to send to a different client? Regenerate the link.
          </span>
          <button
            type="button"
            className="link-regenerate-btn"
            onClick={handleRegenerate}
            disabled={generating}
          >
            {generating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
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
  return `${date} at ${time}`;
}
