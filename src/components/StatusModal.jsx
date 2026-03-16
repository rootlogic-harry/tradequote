import React, { useState } from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { calculateExpiresAt } from '../utils/quoteBuilder.js';

const DECLINE_REASONS = [
  'No reason given',
  'Too expensive',
  'Went with another contractor',
  'Job no longer needed',
  'Other',
];

export default function StatusModal({ modal, job, onConfirm, onCancel }) {
  const { jobId, targetStatus } = modal;
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0]);

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
                  <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: 'var(--tq-text)', fontSize: 14, fontWeight: 500 }}>
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
                    color: 'var(--tq-text)', fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif',
                  }}
                >
                  {DECLINE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </>
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
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
