import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { formatCurrencyCompact } from '../utils/formatCurrencyCompact.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';
import PortalBadge from './PortalBadge.jsx';
import { documentTerm } from '../utils/documentType.js';
import { isThisMonth, isThisYear, buildMonthlyTotals } from '../utils/monthlyTotals.js';
import { isActiveJob, isCompletedJob, isArchivedJob } from '../utils/jobLifecycle.js';

const VIEW_MODES = ['active', 'completed', 'archive'];
import {
  needsFollowUp,
  relativeViewedLabel,
  normaliseUkPhoneForWhatsApp,
} from '../utils/portalFollowUp.js';

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

function buildPortalUrl(clientToken) {
  if (!clientToken) return '';
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';
  return `${origin}/q/${clientToken}`;
}

function FollowUpRow({ job }) {
  const clientPhone = job.snapshot?.jobDetails?.clientPhone || '';
  const waPhone = normaliseUkPhoneForWhatsApp(clientPhone);
  const portalUrl = buildPortalUrl(job.clientToken);
  const viewedLabel = relativeViewedLabel(job) || 'Viewed';

  const handleCopy = async (e) => {
    e.stopPropagation();
    if (!portalUrl) return;
    try {
      await navigator.clipboard?.writeText?.(portalUrl);
    } catch {
      // Clipboard permission denied / not available — silently fail.
      // Paul can still tap Call/WhatsApp.
    }
  };

  return (
    <div className="job-row flex-col fq:flex-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="jr-ref">{job.quoteReference}</span>
          <span className="portal-badge portal-badge--viewed">
            <span className="portal-badge-dot" aria-hidden />
            {viewedLabel}
          </span>
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

      {/* Action buttons — Call, WhatsApp, Copy link.
          Call + WhatsApp are hidden if no phone is on file so we
          don't wire dead buttons. Copy link always works. */}
      <div className="flex flex-wrap gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        {clientPhone && (
          <a
            href={`tel:${clientPhone.replace(/\s+/g, '')}`}
            className="btn-ghost text-xs"
            style={{ height: 36, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            aria-label={`Call ${job.clientName || 'client'}`}
          >
            {'\u260E'} Call
          </a>
        )}
        {waPhone && (
          <a
            href={`https://wa.me/${waPhone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs"
            style={{ height: 36, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            aria-label={`WhatsApp ${job.clientName || 'client'}`}
          >
            WhatsApp
          </a>
        )}
        {portalUrl && (
          <button
            type="button"
            onClick={handleCopy}
            className="btn-ghost text-xs"
            style={{ height: 36, padding: '0 16px' }}
          >
            Copy link
          </button>
        )}
      </div>
    </div>
  );
}

function FollowUpSection({ jobs }) {
  const followUps = (jobs || []).filter((j) => needsFollowUp(j));
  if (followUps.length === 0) return null;
  return (
    <div className="mb-8">
      <div className="eyebrow mb-3">Needs follow-up</div>
      <div className="space-y-2">
        {followUps.map((job) => (
          <FollowUpRow key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
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
  viewMode = 'active',
}) {
  const term = documentTerm(profile);
  // Use recentJobs (from reducer) if available, fallback to savedJobs
  const jobs = recentJobs.length > 0 ? recentJobs : savedJobs;

  // Stat calculations — stats are intentionally based on the full job list,
  // not the active/archive view. Mark wants this-month / this-year revenue
  // to include accepted jobs whether or not they're archived later.
  const thisMonthJobs = jobs.filter(j => isThisMonth(j.savedAt));
  const thisMonthTotal = thisMonthJobs.reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const thisYearTotal = jobs
    .filter(j => isThisYear(j.savedAt))
    .reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  const awaitingCount = jobs.filter(j => j.status === 'sent').length;
  const acceptedThisMonth = jobs.filter(j => j.status === 'accepted' && isThisMonth(j.acceptedAt));
  const acceptedValue = acceptedThisMonth.reduce((s, j) => s + (j.totalAmount ?? 0), 0);

  const monthlyTotals = useMemo(() => buildMonthlyTotals(jobs), [jobs]);
  const [showMonthly, setShowMonthly] = useState(false);
  const currentYear = new Date().getFullYear();

  // Active vs Archive split — only declined quotes move off the main
  // list. Per Mark's 2026-06-21 feedback, expired sends stay active
  // because customers regularly authorise walling jobs months after
  // the quote technically expires. Bucket logic lives in
  // src/utils/jobLifecycle.js.
  const now = new Date();
  const activeJobs = useMemo(() => jobs.filter(j => isActiveJob(j, now)), [jobs]);
  const completedJobs = useMemo(() => jobs.filter(j => isCompletedJob(j, now)), [jobs]);
  const archivedJobs = useMemo(() => jobs.filter(j => isArchivedJob(j, now)), [jobs]);
  const view = VIEW_MODES.includes(viewMode) ? viewMode : 'active';
  const isActiveView = view === 'active';
  const isCompletedView = view === 'completed';
  const isArchiveView = view === 'archive';
  const visibleJobs = isArchiveView ? archivedJobs : isCompletedView ? completedJobs : activeJobs;
  const completedCount = completedJobs.length;
  const archiveCount = archivedJobs.length;

  const displayJobs = visibleJobs.slice(0, 5);

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
        {/* Header CTAs.
            QUICK is an admin-only fast-path (Harry's Q3 audit ask,
            approved 2026-06-26) — hidden on mobile entirely, where the
            header just shows the primary `+ NEW QUOTE` action.
            flex-wrap keeps the row from overflowing on 360px Androids
            when both buttons are visible at the desktop breakpoint
            mid-resize / between media-query steps. */}
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            onClick={onStartQuickQuote}
            className="btn-ghost hidden fq:inline-flex"
            title="Skip the review step"
          >
            QUICK {term.upper}
          </button>
          <button onClick={onStartNewQuote} className="btn-primary">
            + NEW {term.upper}
          </button>
        </div>
      </div>

      {/* Stats strip.
          Money values are rendered twice — full form (`£1,200,000.00`)
          and abbreviated form (`£1.2M`). CSS media query in index.html
          shows the appropriate one per viewport: full ≥360px, compact
          <360px — so 7-figure year totals don't overflow the ~165px
          cell on an iPhone SE / older Android (audit item #19).
          Awaiting is an integer count so it never needs abbreviation. */}
      <div className="stats-strip" style={{ borderRadius: 2 }}>
        <div className="stat-cell">
          <div className="stat-label">This month</div>
          <div className="stat-value">
            <span className="stat-value-full">{formatCurrency(thisMonthTotal)}</span>
            <span className="stat-value-compact">{formatCurrencyCompact(thisMonthTotal)}</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">This year</div>
          <div className="stat-value">
            <span className="stat-value-full">{formatCurrency(thisYearTotal)}</span>
            <span className="stat-value-compact">{formatCurrencyCompact(thisYearTotal)}</span>
          </div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Awaiting</div>
          <div className="stat-value">{awaitingCount}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Accepted</div>
          <div className="stat-value">
            <span className="stat-value-full">{formatCurrency(acceptedValue)}</span>
            <span className="stat-value-compact">{formatCurrencyCompact(acceptedValue)}</span>
          </div>
        </div>
      </div>

      <div className="mb-8 mt-2">
        <button
          type="button"
          onClick={() => setShowMonthly(v => !v)}
          className="text-xs uppercase tracking-wide inline-flex items-center"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--tq-muted)', minHeight: 44, padding: '4px 0' }}
          aria-expanded={showMonthly}
        >
          {showMonthly ? '\u2212' : '+'} Monthly breakdown ({currentYear})
        </button>
        {showMonthly && (
          <div
            className="mt-3 p-4"
            style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}
          >
            {/* On 320-360px phones, 3 columns squashes the £ value
                under a "Jan" label that already touches its neighbour.
                Drop to 2 cols on very-small viewports — month label and
                cell value both get more breathing room. Desktop unchanged
                (6 cols = 2 rows). Audit item #20. */}
            <div className="grid grid-cols-2 fq:grid-cols-6 gap-3">
              {monthlyTotals.map((m) => (
                <div key={m.month} className="text-center">
                  <div
                    className="text-xs uppercase mb-1"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--tq-muted)' }}
                  >
                    {m.label}
                  </div>
                  <div
                    style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: m.total > 0 ? 'var(--tq-text)' : 'var(--tq-muted)' }}
                  >
                    {formatCurrency(m.total)}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--tq-muted)' }}>
                    {m.count} {term.lower}{m.count === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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

      {/* Needs follow-up — viewed by the client ≥2 days ago, no response.
          Paul's "chase list": see who's gone cold and tap through to
          Call / WhatsApp / Copy link. No nudge emails, no pushes — it
          just surfaces the decision for the next time he logs in.
          Same view for both basic and admin (per Paul's brief). */}
      <FollowUpSection jobs={jobs} />

      {/* Recent jobs */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">{isArchiveView ? 'ARCHIVED JOBS' : isCompletedView ? 'COMPLETED JOBS' : 'RECENT JOBS'}</div>
          <button
            onClick={onViewJobs}
            className="text-sm inline-flex items-center"
            style={{ color: 'var(--tq-accent)', fontWeight: 500, minHeight: 44, padding: '4px 8px' }}
          >
            View all &rarr;
          </button>
        </div>

        {/* Active / Completed / Archive tabs (Mark's 2026-06-26 ask).
            Reuses the existing .pill class so the look matches the
            SavedQuotes filter chips. Count badge hidden when zero so
            tabs don't read "(0)". */}
        <div className="flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Job list view">
          <button
            type="button"
            role="tab"
            aria-selected={isActiveView}
            onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'active' })}
            className={`pill ${isActiveView ? 'active' : ''}`}
          >
            Active
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isCompletedView}
            onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'completed' })}
            className={`pill ${isCompletedView ? 'active' : ''}`}
          >
            Completed{completedCount > 0 ? ` (${completedCount})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isArchiveView}
            onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'archive' })}
            className={`pill ${isArchiveView ? 'active' : ''}`}
          >
            Archived{archiveCount > 0 ? ` (${archiveCount})` : ''}
          </button>
        </div>

        {displayJobs.length === 0 ? (
          <div
            className="px-5 py-10 text-center"
            style={{ backgroundColor: 'var(--tq-card)', border: '1.5px solid var(--tq-border)', borderRadius: 2 }}
          >
            <div className="text-3xl mb-3 opacity-20">&#128221;</div>
            <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
              {isArchiveView
                ? `No archived ${term.lower}s yet — declined ${term.lower}s will show here once you have any.`
                : isCompletedView
                  ? `No completed ${term.lower}s yet — finished work shows here once you mark a job as completed.`
                  : `No jobs yet. Create your first ${term.lower} to get started.`}
            </p>
            {isActiveView && (
              <button onClick={onStartNewQuote} className="btn-primary">
                + New {term.title}
              </button>
            )}
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

                  {/* Contextual action buttons. Hidden in archive view \u2014
                      archived rows are read-only-ish; user can still open
                      the row to view the quote and change status from
                      there if they want to restore. */}
                  {!isArchiveView && (
                    <div className="flex flex-wrap gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {/* Per-row action buttons use the shared
                          .row-action-btn class so the global mobile rule
                          (44px tall + full-width below the fq breakpoint)
                          kicks in. Previously these were inline-styled
                          at a fixed 36px height and spilled out of the
                          column on 360px (audit item #9). Status-specific
                          tints are kept via inline style. */}
                      {status === 'DRAFT' && (
                        <>
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'sent')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-accent)', background: 'var(--tq-accent)', color: '#ffffff' }}
                          >
                            Mark Sent
                          </button>
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'declined')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                          >
                            {'✗'} Declined
                          </button>
                        </>
                      )}
                      {status === 'SENT' && (
                        <>
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'accepted')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                          >
                            {'\u2713'} Accepted
                          </button>
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'declined')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
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
                              className="row-action-btn"
                            >
                              View RAMS
                            </button>
                          ) : isAdminPlan ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); onCreateRamsFromSaved?.(job); }}
                              className="row-action-btn"
                              style={{ borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
                            >
                              Create RAMS
                            </button>
                          ) : null}
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'completed')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                          >
                            Complete
                          </button>
                          {/* Manual decline from accepted — customer pulled
                              out after acceptance (deposit refund, change of
                              mind, etc.). Reuses the same status modal as
                              the SENT decline path so note-capture works. */}
                          <button
                            onClick={(e) => openStatusModal(e, job.id, 'declined')}
                            className="row-action-btn"
                            style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                          >
                            {'✗'} Declined
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
