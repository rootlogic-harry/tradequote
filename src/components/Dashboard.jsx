import React from 'react';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayFormatted() {
  const d = new Date();
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function isThisMonth(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function StatusBadge({ status }) {
  const styles = {
    SENT: { bg: 'var(--tq-status-sent)', color: 'var(--tq-status-sent-txt)' },
    ACCEPTED: { bg: 'var(--tq-status-acc)', color: 'var(--tq-status-acc-txt)' },
    DECLINED: { bg: 'var(--tq-error-bg)', color: 'var(--tq-error-txt)' },
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

function ExpiryBadge({ expiresAt }) {
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

function RamsBadge({ hasRams }) {
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

export default function Dashboard({
  userName,
  onStartNewQuote,
  onViewJobs,
  incompleteJobs,
  currentDraft,
  onResumeDraft,
  onResumeJob,
  onMarkRamsNotRequired,
  onCreateRamsFromSaved,
  savedJobs = [],
  recentJobs = [],
  dispatch,
  onViewJob,
  onViewRams,
}) {
  // Use recentJobs (from reducer) if available, fallback to savedJobs
  const jobs = recentJobs.length > 0 ? recentJobs : savedJobs;

  // Stat calculations
  const thisMonthJobs = jobs.filter(j => isThisMonth(j.savedAt));
  const thisMonthTotal = thisMonthJobs.reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const awaitingCount = jobs.filter(j => j.status === 'sent').length;
  const acceptedThisMonth = jobs.filter(j => j.status === 'accepted' && isThisMonth(j.acceptedAt));
  const acceptedValue = acceptedThisMonth.reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const sentCount = jobs.filter(j => ['sent', 'accepted', 'declined'].includes(j.status)).length;
  const acceptedCount = jobs.filter(j => j.status === 'accepted').length;
  const conversionRate = sentCount > 0 ? Math.round((acceptedCount / sentCount) * 100) : null;

  const displayJobs = jobs.slice(0, 5);

  const getStatus = (job) => (job.status || 'draft').toUpperCase();

  const openStatusModal = (e, jobId, targetStatus) => {
    e.stopPropagation();
    dispatch({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  const handleRowClick = (job) => {
    if (onViewJob) onViewJob(job);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header row */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1
            className="mb-1"
            style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 32, color: 'var(--tq-text)' }}
          >
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            {todayFormatted()}
          </p>
        </div>
        <button
          onClick={onStartNewQuote}
          className="shrink-0 rounded transition-colors"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 15,
            backgroundColor: 'var(--tq-accent)',
            color: '#ffffff',
            padding: '10px 20px',
          }}
        >
          + NEW QUOTE
        </button>
      </div>

      {/* Stat cards — 4 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>This month</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(thisMonthTotal)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
            {thisMonthJobs.length} quote{thisMonthJobs.length !== 1 ? 's' : ''} issued
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>Awaiting response</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>
            {awaitingCount}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>quotes sent</div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>Accepted</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(acceptedValue)}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
            {acceptedThisMonth.length} job{acceptedThisMonth.length !== 1 ? 's' : ''} this month
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em' }}>Conversion</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 26, fontWeight: 500, color: 'var(--tq-text)' }}>
            {conversionRate !== null ? `${conversionRate}%` : '\u2014'}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>accepted / sent</div>
        </div>
      </div>

      {/* Current draft banner */}
      {currentDraft && (
        <div
          className="rounded-lg p-4 flex items-center justify-between mb-6"
          style={{ backgroundColor: 'var(--tq-accent-bg)', border: '1.5px solid var(--tq-accent-bd)' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-status-draft)', color: 'var(--tq-status-draft-txt)' }}
              >
                Draft
              </span>
              <span className="font-heading font-bold text-tq-text truncate">
                {currentDraft.jobDetails?.clientName || 'Untitled'}
              </span>
            </div>
            <p className="text-sm truncate" style={{ color: 'var(--tq-muted)' }}>
              {currentDraft.jobDetails?.siteAddress || 'No address'}
              {currentDraft.step ? ` \u2014 Step ${currentDraft.step}` : ''}
            </p>
          </div>
          <button
            onClick={onResumeDraft}
            className="ml-4 font-heading font-bold uppercase tracking-wide text-xs px-4 py-2 rounded transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
          >
            Resume
          </button>
        </div>
      )}

      {/* Incomplete jobs (needs RAMS) */}
      {incompleteJobs && incompleteJobs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-heading font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--tq-muted)' }}>
            Needs Attention
          </h2>
          <div className="space-y-2">
            {incompleteJobs.map(job => (
              <div
                key={job.id}
                className="rounded-lg p-4 flex items-center justify-between"
                style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, backgroundColor: 'var(--tq-status-sent)', color: 'var(--tq-status-sent-txt)' }}
                    >
                      Needs RAMS
                    </span>
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--tq-accent)' }}>
                      {job.quoteReference}
                    </span>
                  </div>
                  <div className="font-heading font-bold truncate" style={{ color: 'var(--tq-text)' }}>
                    {job.clientName || 'Unnamed client'}
                  </div>
                </div>
                <div className="ml-4 flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => onCreateRamsFromSaved(job)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                    style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
                  >
                    Create RAMS
                  </button>
                  <button
                    onClick={() => onMarkRamsNotRequired(job.id)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors whitespace-nowrap"
                    style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-muted)' }}
                  >
                    Not Needed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent jobs card */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--tq-border-soft)' }}>
          <span style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--tq-text)' }}>
            RECENT JOBS
          </span>
          <button
            onClick={onViewJobs}
            className="text-xs"
            style={{ color: 'var(--tq-accent)', fontWeight: 500 }}
          >
            View all &rarr;
          </button>
        </div>

        {displayJobs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--tq-muted)' }}>
            No jobs yet. Start a new quote to get going.
          </div>
        ) : (
          <div>
            {displayJobs.map((job) => {
              const status = getStatus(job);
              const hasRams = job.hasRams || !!job.ramsSnapshot;
              const borderLeft = status === 'ACCEPTED'
                ? '3px solid var(--tq-confirmed-bd)'
                : status === 'DECLINED'
                  ? '3px solid var(--tq-error-bd)'
                  : '3px solid transparent';

              return (
                <div
                  key={job.id}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{ borderBottom: '1px solid var(--tq-border-soft)', borderLeft, cursor: 'pointer' }}
                  onClick={() => handleRowClick(job)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
                        {job.clientName || 'Unnamed'}
                      </span>
                      <StatusBadge status={status} />
                      {status === 'SENT' && <ExpiryBadge expiresAt={job.expiresAt} />}
                      {status === 'ACCEPTED' && <RamsBadge hasRams={hasRams} />}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                      {job.quoteReference}{job.siteAddress ? ` \u00b7 ${job.siteAddress}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 hidden sm:block" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
                    {formatCurrency(job.totalAmount || 0)}
                  </div>

                  {/* Contextual action buttons */}
                  <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {status === 'DRAFT' && (
                      <button
                        onClick={(e) => openStatusModal(e, job.id, 'sent')}
                        className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                        style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
                      >
                        Mark Sent
                      </button>
                    )}
                    {status === 'SENT' && (
                      <>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'accepted')}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)', backgroundColor: 'transparent' }}
                        >
                          {'\u2713'} Accepted
                        </button>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'declined')}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap hidden sm:inline-block"
                          style={{ border: '1.5px solid var(--tq-error-bd)', color: 'var(--tq-error-txt)', backgroundColor: 'transparent' }}
                        >
                          {'\u2717'} Declined
                        </button>
                      </>
                    )}
                    {status === 'ACCEPTED' && (
                      hasRams ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onViewRams?.(job); }}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-text)', backgroundColor: 'transparent' }}
                        >
                          View RAMS
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCreateRamsFromSaved?.(job); }}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1.5px solid var(--tq-accent)', color: 'var(--tq-accent)', backgroundColor: 'transparent' }}
                        >
                          Create RAMS
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
