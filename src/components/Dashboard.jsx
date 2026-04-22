import React from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';
import PortalBadge from './PortalBadge.jsx';
import { documentTerm } from '../utils/documentType.js';

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
  profile,
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
  const term = documentTerm(profile);
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
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col fq:flex-row fq:items-end fq:justify-between gap-4 mb-8">
        <div>
          <div className="eyebrow mb-2">{todayFormatted()}</div>
          <h1 className="page-title" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onStartQuickQuote} className="btn-ghost" title="Skip the review step">
            QUICK {term.upper}
          </button>
          <button onClick={onStartNewQuote} className="btn-primary">
            + NEW {term.upper}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="stats-strip mb-8" style={{ borderRadius: 2 }}>
        <div className="stat-cell">
          <div className="stat-label">This month</div>
          <div className="stat-value">{formatCurrency(thisMonthTotal)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Awaiting</div>
          <div className="stat-value">{awaitingCount}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Accepted</div>
          <div className="stat-value">{formatCurrency(acceptedValue)}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Conversion</div>
          <div className="stat-value">{conversionRate !== null ? `${conversionRate}%` : '\u2014'}</div>
        </div>
      </div>

      {/* Current draft banner */}
      {currentDraft && (
        <div
          className="flex items-center justify-between gap-4 p-4 mb-6"
          style={{ backgroundColor: 'var(--tq-accent-bg)', border: '1.5px solid var(--tq-accent-bd)', borderRadius: 2 }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="jr-stamp" data-status="draft">Draft</span>
              <span className="font-heading font-bold text-tq-text truncate">
                {currentDraft.jobDetails?.clientName || 'Untitled'}
              </span>
            </div>
            <p className="text-sm truncate" style={{ color: 'var(--tq-muted)' }}>
              {currentDraft.jobDetails?.siteAddress || 'No address'}
              {currentDraft.step ? ` \u2014 Step ${currentDraft.step}` : ''}
            </p>
          </div>
          <button onClick={onResumeDraft} className="btn-primary whitespace-nowrap">
            Resume
          </button>
        </div>
      )}

      {/* Incomplete jobs (needs RAMS) — admin only */}
      {isAdminPlan && incompleteJobs && incompleteJobs.length > 0 && (
        <div className="mb-8">
          <div className="eyebrow mb-3">Needs Attention</div>
          <div className="space-y-2">
            {incompleteJobs.map(job => (
              <div
                key={job.id}
                className="job-row flex-col fq:flex-row"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="jr-stamp" data-status="sent">Needs RAMS</span>
                    <VideoBadge captureMode={job.snapshot?.captureMode} />
                    <span className="jr-ref">{job.quoteReference}</span>
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
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => onCreateRamsFromSaved(job)} className="btn-primary text-xs">
                    Create RAMS
                  </button>
                  <button onClick={() => onMarkRamsNotRequired(job.id)} className="btn-ghost text-xs">
                    Not Needed
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent jobs */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">RECENT JOBS</div>
          <button
            onClick={onViewJobs}
            className="text-sm"
            style={{ color: 'var(--tq-accent)', fontWeight: 500 }}
          >
            View all &rarr;
          </button>
        </div>

        {displayJobs.length === 0 ? (
          <div
            className="px-5 py-10 text-center"
            style={{ backgroundColor: 'var(--tq-card)', border: '1.5px solid var(--tq-border)', borderRadius: 2 }}
          >
            <div className="text-3xl mb-3 opacity-20">&#128221;</div>
            <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
              No jobs yet. Create your first quote to get started.
            </p>
            <button onClick={onStartNewQuote} className="btn-primary">
              + New Quote
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {displayJobs.map((job) => {
              const status = getStatus(job);
              const hasRams = job.hasRams || !!job.ramsSnapshot;

              return (
                <div
                  key={job.id}
                  className="job-row flex-col fq:flex-row"
                  onClick={() => handleRowClick(job)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="jr-ref">{job.quoteReference}</span>
                      <StatusBadge status={status} />
                      <VideoBadge captureMode={job.snapshot?.captureMode} />
                      {status === 'SENT' && <ExpiryBadge expiresAt={job.expiresAt} />}
                      {status === 'ACCEPTED' && isAdminPlan && <RamsBadge hasRams={hasRams} />}
                      <PortalBadge job={job} />
                    </div>
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
                      {job.clientName || 'Unnamed'}
                    </div>
                    {job.siteAddress && (
                      <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                        {job.siteAddress}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 hidden fq:block" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
                    {formatCurrency(job.totalAmount || 0)}
                  </div>

                  {/* Contextual action buttons */}
                  <div className="flex flex-wrap gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {status === 'DRAFT' && (
                      <button
                        onClick={(e) => openStatusModal(e, job.id, 'sent')}
                        className="btn-primary text-xs"
                        style={{ height: 36, padding: '0 16px' }}
                      >
                        Mark Sent
                      </button>
                    )}
                    {status === 'SENT' && (
                      <>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'accepted')}
                          className="btn-ghost text-xs"
                          style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                        >
                          {'\u2713'} Accepted
                        </button>
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'declined')}
                          className="btn-ghost text-xs"
                          style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
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
                            className="btn-ghost text-xs"
                            style={{ height: 36, padding: '0 16px' }}
                          >
                            View RAMS
                          </button>
                        ) : isAdminPlan ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onCreateRamsFromSaved?.(job); }}
                            className="btn-ghost text-xs"
                            style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
                          >
                            Create RAMS
                          </button>
                        ) : null}
                        <button
                          onClick={(e) => openStatusModal(e, job.id, 'completed')}
                          className="btn-ghost text-xs"
                          style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
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
