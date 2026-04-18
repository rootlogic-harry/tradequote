import React from 'react';

function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function StatusBadge({ status }) {
  const styles = {
    SENT: { bg: 'var(--tq-status-sent)', color: 'var(--tq-status-sent-txt)' },
    ACCEPTED: { bg: 'var(--tq-status-acc)', color: 'var(--tq-status-acc-txt)' },
    DECLINED: { bg: 'var(--tq-error-bg)', color: 'var(--tq-error-txt)' },
    COMPLETED: { bg: 'var(--tq-confirmed-bg)', color: 'var(--tq-confirmed-txt)' },
    DRAFT: { bg: 'var(--tq-status-draft)', color: 'var(--tq-status-draft-txt)' },
  };
  const s = styles[status] || styles.DRAFT;
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 inline-block"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

export function ExpiryBadge({ expiresAt }) {
  const days = daysUntilExpiry(expiresAt);
  if (days === null || days > 7) return null;
  const isExpired = days <= 0;
  const isUrgent = days >= 1 && days <= 3;
  const bgColor = isExpired || isUrgent ? 'var(--tq-error-bg)' : 'var(--tq-accent-bg)';
  const textColor = isExpired || isUrgent ? 'var(--tq-error-txt)' : 'var(--tq-accent)';
  const label = isExpired ? 'EXPIRED' : `\u26A0 ${days} DAY${days !== 1 ? 'S' : ''}`;
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 inline-block"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: bgColor, color: textColor }}
    >
      {label}
    </span>
  );
}

export function RamsBadge({ hasRams }) {
  if (hasRams) {
    return (
      <span
        className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 inline-block"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-confirmed-bg)', color: 'var(--tq-confirmed-txt)' }}
      >
        {'\u2713'} RAMS
      </span>
    );
  }
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 inline-block"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-accent-bg)', color: 'var(--tq-accent)' }}
    >
      RAMS NEEDED
    </span>
  );
}

export function VideoBadge({ captureMode }) {
  if (captureMode !== 'video') return null;
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded shrink-0 inline-block"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-accent-bg)', color: 'var(--tq-accent)' }}
    >
      {'\uD83C\uDFA5'} VIDEO
    </span>
  );
}
