import React from 'react';

function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function StatusBadge({ status }) {
  const statusKey = (status || 'DRAFT').toLowerCase();
  const statusMap = { accepted: 'accepted', completed: 'accepted', declined: 'declined' };
  const dataStatus = statusMap[statusKey] || (statusKey === 'sent' ? 'sent' : 'draft');
  return (
    <span className="jr-stamp shrink-0 inline-block" data-status={dataStatus}>
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
