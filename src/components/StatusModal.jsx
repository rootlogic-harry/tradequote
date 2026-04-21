import React, { useState } from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { calculateExpiresAt } from '../utils/quoteBuilder.js';
import { generateClientToken, SessionExpiredError } from '../utils/userDB.js';

const DECLINE_REASONS = [
  'No reason given',
  'Too expensive',
  'Went with another contractor',
  'Job no longer needed',
  'Other',
];

export default function StatusModal({ modal, job, currentUserId, onConfirm, onCancel, isAdminPlan = false }) {
  if (!modal) return null;
  const { jobId, targetStatus } = modal;
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0]);
  const [completionFeedback, setCompletionFeedback] = useState('spot_on');
  const [completionNotes, setCompletionNotes] = useState('');

  const now = new Date().toISOString();
  const expiresAt = calculateExpiresAt(now);

  const formatDisplayDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const handleConfirm = () => {
    if (targetStatus === 'sent') {
      onConfirm(jobId, 'sent', { sentAt: now, expiresAt });
    } else if (targetStatus === 'accepted') {
      onConfirm(jobId, 'accepted', { acceptedAt: now });
    } else if (targetStatus === 'declined') {
      onConfirm(jobId, 'declined', { declinedAt: now, declineReason });
    } else if (targetStatus === 'completed') {
      onConfirm(jobId, 'completed', { completionFeedback, completionNotes: completionNotes || undefined });
    }
  };

  // Color configs per variant
  const configs = {
    sent: {
      bandBg: 'var(--tq-accent-bg)',
      bandBd: 'var(--tq-accent-bd)',
      btnBg: 'var(--tq-accent)',
      btnColor: '#ffffff',
      header: 'Mark quote as sent',
    },
    accepted: {
      bandBg: 'var(--tq-confirmed-bg)',
      bandBd: 'var(--tq-confirmed-bd)',
      btnBg: 'var(--tq-confirmed-bd)',
      btnColor: '#ffffff',
      header: 'Mark quote as accepted',
    },
    declined: {
      bandBg: 'var(--tq-error-bg)',
      bandBd: 'var(--tq-error-bd)',
      btnBg: 'var(--tq-error-bd)',
      btnColor: '#ffffff',
      header: 'Mark quote as declined',
    },
    completed: {
      bandBg: 'var(--tq-confirmed-bg)',
      bandBd: 'var(--tq-confirmed-bd)',
      btnBg: 'var(--tq-confirmed-bd)',
      btnColor: '#ffffff',
      header: 'Mark job as completed',
    },
  };

  const cfg = configs[targetStatus] || configs.sent;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 420,
          maxWidth: '90vw', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header band */}
        <div style={{ padding: '16px 20px', backgroundColor: cfg.bandBg, borderBottom: `1.5px solid ${cfg.bandBd}` }}>
          <h3 style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--tq-text)', margin: 0 }}>
            {cfg.header}
          </h3>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {targetStatus === 'sent' && (
            <>
              <p style={{ color: 'var(--tq-muted)', fontSize: 14, marginBottom: 16 }}>
                This will record today as the sent date and start the 30-day expiry clock.
              </p>
              <div style={{
                backgroundColor: 'var(--tq-surface)', border: '1px solid var(--tq-border)',
                borderRadius: 8, padding: '12px 16px', marginBottom: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--tq-muted)', fontSize: 12 }}>Sent date</span>
                  <span style={{ color: 'var(--tq-text)', fontSize: 13, fontWeight: 500 }}>{formatDisplayDate(now)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--tq-muted)', fontSize: 12 }}>Expires</span>
                  <span style={{ color: 'var(--tq-text)', fontSize: 13, fontWeight: 500 }}>{formatDisplayDate(expiresAt)}</span>
                </div>
              </div>
            </>
          )}

          {targetStatus === 'accepted' && (
            <>
              <p style={{ color: 'var(--tq-muted)', fontSize: 14, marginBottom: 16 }}>
                Mark this quote as accepted to update your dashboard and pipeline.
              </p>
              <div style={{
                backgroundColor: 'var(--tq-surface)', border: '1px solid var(--tq-border)',
                borderRadius: 8, padding: '12px 16px', marginBottom: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--tq-muted)', fontSize: 12 }}>Quote value</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--tq-text)', fontSize: 14, fontWeight: 500 }}>
                    {job ? formatCurrency(job.totalAmount || 0) : '-'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--tq-muted)', fontSize: 12 }}>Next step</span>
                  <span style={{ color: 'var(--tq-text)', fontSize: 13, fontWeight: 500 }}>Create RAMS document</span>
                </div>
              </div>
            </>
          )}

          {targetStatus === 'declined' && (
            <>
              <p style={{ color: 'var(--tq-muted)', fontSize: 14, marginBottom: 16 }}>
                Record that this quote was declined.
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={{ color: 'var(--tq-muted)', fontSize: 12, display: 'block', marginBottom: 6 }}>Reason</label>
                <select
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    backgroundColor: 'var(--tq-surface)', border: '1px solid var(--tq-border)',
                    color: 'var(--tq-text)', fontSize: 14, fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </>
          )}

          {targetStatus === 'completed' && (
            <>
              <p style={{ color: 'var(--tq-muted)', fontSize: 14, marginBottom: 16 }}>
                How accurate was this quote?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {[
                  { value: 'spot_on', label: 'Spot on', desc: 'Quote matched the actual job cost' },
                  { value: 'under_quoted', label: 'Under-quoted', desc: 'The job cost more than quoted' },
                  { value: 'over_quoted', label: 'Over-quoted', desc: 'The job cost less than quoted' },
                ].map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      borderRadius: 8, cursor: 'pointer',
                      backgroundColor: completionFeedback === opt.value ? 'var(--tq-confirmed-bg)' : 'var(--tq-surface)',
                      border: `1.5px solid ${completionFeedback === opt.value ? 'var(--tq-confirmed-bd)' : 'var(--tq-border)'}`,
                    }}
                  >
                    <input
                      type="radio"
                      name="completionFeedback"
                      value={opt.value}
                      checked={completionFeedback === opt.value}
                      onChange={() => setCompletionFeedback(opt.value)}
                      style={{ accentColor: 'var(--tq-confirmed-bd)' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tq-text)' }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--tq-muted)' }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              {isAdminPlan && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ color: 'var(--tq-muted)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                    Notes on what went differently than quoted (optional)
                  </label>
                  <textarea
                    value={completionNotes}
                    onChange={e => setCompletionNotes(e.target.value)}
                    rows={3}
                    placeholder="E.g. more stone needed than estimated, access was harder than expected..."
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      backgroundColor: 'var(--tq-surface)', border: '1px solid var(--tq-border)',
                      color: 'var(--tq-text)', fontSize: 13, fontFamily: 'Inter, sans-serif',
                      resize: 'vertical',
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* TRQ-133: Client Portal audit section — admin-only and
               only when the job has a client token. Shows the audit
               trail (when viewed, from what IP) and Copy/Regenerate
               link controls. Basic users never see this surface;
               that's the design-law separation between the customer
               product and the admin operating layer. */}
          {isAdminPlan && job?.clientToken && (
            <PortalAuditBlock job={job} currentUserId={currentUserId} />
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCancel}
              style={{
                flex: 1, padding: '10px 16px', borderRadius: 6,
                border: '1px solid var(--tq-border)', backgroundColor: 'transparent',
                color: 'var(--tq-muted)', fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              style={{
                flex: 2, padding: '10px 16px', borderRadius: 6,
                border: 'none', backgroundColor: cfg.btnBg,
                color: cfg.btnColor, fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {targetStatus === 'sent' && 'CONFIRM \u2014 MARK AS SENT'}
              {targetStatus === 'accepted' && 'CONFIRM ACCEPTED'}
              {targetStatus === 'declined' && 'CONFIRM DECLINED'}
              {targetStatus === 'completed' && 'CONFIRM COMPLETED'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Admin-only Client Portal audit block (TRQ-133).
 *
 * Shows when the client opened the link, what IP they came from, the
 * recorded response, and — when the response is "declined" — the
 * free-text reason the client gave. Also exposes Copy link + Regenerate
 * so the admin can either share the URL again or kill it and mint a
 * fresh one. Regenerate is gated by window.confirm, matching the
 * Step-5 ClientLinkBlock pattern (TRQ-131).
 */
function PortalAuditBlock({ job, currentUserId }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = job.clientToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/q/${job.clientToken}`
    : '';

  const fmt = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${date} at ${time}`;
  };

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // swallow — user can select & copy manually
    }
  }

  async function handleRegenerate() {
    if (busy) return;
    const ok = window.confirm(
      'Regenerating will immediately invalidate the link you already shared. Continue?'
    );
    if (!ok) return;
    if (!currentUserId) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      await generateClientToken(currentUserId, job.id);
      window.location.reload();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        window.location.href = '/login?error=session_expired';
        return;
      }
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginBottom: 20,
        padding: '14px 16px',
        borderRadius: 8,
        border: '1px solid var(--tq-border)',
        background: 'var(--tq-surface)',
      }}
    >
      <div
        style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--tq-muted)',
          marginBottom: 10,
        }}
      >
        Client Portal
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 12 }}>
        <span style={{ color: 'var(--tq-muted)' }}>Link</span>
        <span style={{ color: 'var(--tq-text)', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
          {url}
        </span>
        <span style={{ color: 'var(--tq-muted)' }}>Viewed</span>
        <span style={{ color: 'var(--tq-text)' }}>
          {job.clientViewedAt
            ? `${fmt(job.clientViewedAt)}${job.clientIp ? ` · from ${job.clientIp}` : ''}`
            : 'Not yet viewed'}
        </span>
        <span style={{ color: 'var(--tq-muted)' }}>Response</span>
        <span style={{ color: 'var(--tq-text)' }}>
          {job.clientResponse
            ? `${job.clientResponse === 'accepted' ? 'Accepted' : 'Declined'} ${fmt(job.clientResponseAt)}`
            : 'Awaiting'}
        </span>
        {job.clientResponse === 'declined' && job.clientDeclineReason && (
          <>
            <span style={{ color: 'var(--tq-muted)' }}>Reason</span>
            <span style={{ color: 'var(--tq-text)' }}>{job.clientDeclineReason}</span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            border: '1px solid var(--tq-border)',
            background: copied ? 'var(--tq-confirmed-bg)' : 'transparent',
            color: 'var(--tq-text)',
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={busy}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            border: '1px solid var(--tq-border)',
            background: 'transparent',
            color: 'var(--tq-muted)',
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 12,
            cursor: busy ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>
    </div>
  );
}
