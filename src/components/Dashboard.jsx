import React from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge } from './badges.jsx';

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


export default function Dashboard({
  userName,
  onStartNewQuote,
  onStartQuickQuote,
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
  isAdminPlan = false,
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
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
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onStartQuickQuote}
            className="rounded transition-colors flex-1 sm:flex-none"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              fontSize: 15,
              border: '1.5px solid var(--tq-accent)',
              color: 'var(--tq-accent)',
              backgroundColor: 'transparent',
              padding: '12px 20px',
              minHeight: 44,
            }}
            title="Skip the review step — auto-confirms all measurements"
          >
            QUICK QUOTE
          </button>
          <button
            onClick={onStartNewQuote}
            className="rounded transition-colors flex-1 sm:flex-none"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              fontSize: 15,
              backgroundColor: 'var(--tq-accent)',
              color: '#ffffff',
              padding: '12px 20px',
              minHeight: 44,
            }}
            title="Full workflow — review all measurements before generating"
          >
            + NEW QUOTE
          </button>
        </div>
      </div>

      {/* Stat cards — 4 cards, 2-col on mobile */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs sm:text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em', fontSize: 'max(12px, 0.75rem)' }}>This month</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 22, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(thisMonthTotal)}
          </div>
          <div className="mt-1" style={{ color: 'var(--tq-muted)', fontSize: 13 }}>
            {thisMonthJobs.length} quote{thisMonthJobs.length !== 1 ? 's' : ''} issued
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs sm:text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em', fontSize: 'max(12px, 0.75rem)' }}>Awaiting</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 22, fontWeight: 500, color: 'var(--tq-text)' }}>
            {awaitingCount}
          </div>
          <div className="mt-1" style={{ color: 'var(--tq-muted)', fontSize: 13 }}>quotes sent</div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs sm:text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em', fontSize: 'max(12px, 0.75rem)' }}>Accepted</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 22, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(acceptedValue)}
          </div>
          <div className="mt-1" style={{ color: 'var(--tq-muted)', fontSize: 13 }}>
            {acceptedThisMonth.length} job{acceptedThisMonth.length !== 1 ? 's' : ''} this month
          </div>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 10 }}
        >
          <div className="text-xs sm:text-xs uppercase mb-2" style={{ color: 'var(--tq-muted)', letterSpacing: '0.05em', fontSize: 'max(12px, 0.75rem)' }}>Conversion</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 22, fontWeight: 500, color: 'var(--tq-text)' }}>
            {conversionRate !== null ? `${conversionRate}%` : '\u2014'}
          </div>
          <div className="mt-1" style={{ color: 'var(--tq-muted)', fontSize: 13 }}>accepted / sent</div>
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
            className="ml-4 font-heading font-bold uppercase tracking-wide text-sm px-5 py-3 rounded transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff', minHeight: 44 }}
          >
            Resume
          </button>
        </div>
      )}

      {/* Incomplete jobs (needs RAMS) — full plan only */}
      {isAdminPlan && incompleteJobs && incompleteJobs.length > 0 && (
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
                  {job.siteAddress && (
                    <div className="text-sm truncate" style={{ color: 'var(--tq-muted)' }}>
                      {job.siteAddress}
                    </div>
                  )}
                </div>
                <div className="ml-4 flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => onCreateRamsFromSaved(job)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                    style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff', minHeight: 44 }}
                  >
                    Create RAMS
                  </button>
                  <button
                    onClick={() => onMarkRamsNotRequired(job.id)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                    style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-muted)', minHeight: 44 }}
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
            className="text-sm px-3 py-2"
            style={{ color: 'var(--tq-accent)', fontWeight: 500, minHeight: 44, minWidth: 44 }}
          >
            View all &rarr;
          </button>
        </div>

        {displayJobs.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-3xl mb-3 opacity-20">&#128221;</div>
            <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
              No jobs yet. Create your first quote to get started.
            </p>
            <button
              onClick={onStartNewQuote}
              className="font-heading font-bold uppercase tracking-wide text-sm px-5 py-2.5 rounded transition-colors"
              style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff', minHeight: 44 }}
            >
              + New Quote
            </button>
          </div>
        ) : (
          <div>
            {displayJobs.map((job) => {
              const status = getStatus(job);
              const hasRams = job.hasRams || !!job.ramsSnapshot;
              const borderLeft = status === 'ACCEPTED' || status === 'COMPLETED'
                ? '3px solid var(--tq-confirmed-bd)'
                : status === 'DECLINED'
                  ? '3px solid var(--tq-error-bd)'
                  : '3px solid transparent';

              return (
                <div
                  key={job.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4"
                  style={{ borderBottom: '1px solid var(--tq-border-soft)', borderLeft, cursor: 'pointer', minHeight: 56 }}
                  onClick={() => handleRowClick(job)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
                        {job.clientName || 'Unnamed'}
                      </span>
                      <StatusBadge status={status} />
                      {status === 'SENT' && <ExpiryBadge expiresAt={job.expiresAt} />}
                      {status === 'ACCEPTED' && isAdminPlan && <RamsBadge hasRams={hasRams} />}
                    </div>
                    <div className="truncate" style={{ color: 'var(--tq-muted)', fontSize: 13 }}>
                      {job.quoteReference}{job.siteAddress ? ` \u00b7 ${job.siteAddress}` : ''}
                      <span className="sm:hidden"> \u00b7 {formatCurrency(job.totalAmount || 0)}</span>
                    </div>
                  </div>
                  <div className="shrink-0 hidden sm:block" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
                    {formatCurrency(job.totalAmount || 0)}
                  </div>

                  {/* Contextual action buttons */}
                  <div className="flex flex-wrap gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {status === 'DRAFT' && (
                      <button
                        onClick={(e) => openStatusModal(e, job.id, 'sent')}
                        className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                        style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff', minHeight: 44 }}
                      >
                        Mark Sent
                      </button>
                    )}
                    {status === 'SENT' && (
                      <>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'accepted')}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)', backgroundColor: 'transparent', minHeight: 44 }}
                        >
                          {'\u2713'} Accepted
                        </button>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'declined')}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1.5px solid var(--tq-error-bd)', color: 'var(--tq-error-txt)', backgroundColor: 'transparent', minHeight: 44 }}
                        >
                          {'\u2717'} Declined
                        </button>
                      </>
                    )}
                    {status === 'ACCEPTED' && (
                      <>
                        {isAdminPlan && hasRams ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onViewRams?.(job); }}
                            className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                            style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-text)', backgroundColor: 'transparent', minHeight: 44 }}
                          >
                            View RAMS
                          </button>
                        ) : isAdminPlan ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onCreateRamsFromSaved?.(job); }}
                            className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                            style={{ border: '1.5px solid var(--tq-accent)', color: 'var(--tq-accent)', backgroundColor: 'transparent', minHeight: 44 }}
                          >
                            Create RAMS
                          </button>
                        ) : null}
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'completed')}
                          className="font-heading font-bold uppercase tracking-wide text-xs px-4 py-3 rounded transition-colors whitespace-nowrap"
                          style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)', backgroundColor: 'transparent', minHeight: 44 }}
                        >
                          Complete
                        </button>
                      </>
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
