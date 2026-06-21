import React, { useState, useEffect, useMemo } from 'react';
import { listJobs, deleteJob, deletePhotos } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';
import { documentTerm } from '../utils/documentType.js';
import { isActiveJob, isArchivedJob } from '../utils/jobLifecycle.js';

// Active-view filters drop Declined because declined jobs live in the
// archive bucket. The "All" pill within Active still excludes declined.
const ACTIVE_FILTERS = ['All', 'Draft', 'Sent', 'Accepted', 'Completed'];

export default function SavedQuotes({
  onViewQuote,
  onCreateRams,
  onViewRams,
  currentUserId,
  profile,
  recentJobs = [],
  dispatch,
  isAdminPlan = false,
  showToast,
  viewMode = 'active',
}) {
  const term = documentTerm(profile);
  const [localQuotes, setLocalQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // Use recentJobs from reducer if available, otherwise fetch locally
  const quotes = recentJobs.length > 0 ? recentJobs : localQuotes;

  useEffect(() => {
    if (recentJobs.length > 0) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    listJobs(currentUserId)
      .then((data) => {
        setLocalQuotes(data);
        setLoadError(null);
      })
      .catch(err => {
        console.error('Failed to load saved quotes:', err);
        setLoadError('Could not load your saved jobs. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [currentUserId, recentJobs.length]);

  const handleDelete = async (id) => {
    try {
      await deleteJob(currentUserId, id);
      deletePhotos(currentUserId, id).catch(() => {});
      setLocalQuotes(prev => prev.filter(q => q.id !== id));
      if (dispatch) dispatch({ type: 'DELETE_JOB', id });
      setConfirmDeleteId(null);
      showToast?.('Job deleted', 'success');
    } catch (err) {
      console.error('Failed to delete quote:', err);
      showToast?.('Failed to delete job. Check your connection and try again.', 'error');
      setConfirmDeleteId(null);
    }
  };

  const getStatus = (job) => (job.status || 'draft').toUpperCase();

  // Active vs Archive split — only declined quotes move off the main
  // list. Per Mark's 2026-06-21 feedback, expired sends stay active
  // because customers regularly authorise walling jobs months after
  // the quote technically expires. Bucket logic lives in
  // src/utils/jobLifecycle.js.
  const now = useMemo(() => new Date(), []);
  const isArchiveView = viewMode === 'archive';
  const bucketedQuotes = useMemo(
    () => quotes.filter(q => (isArchiveView ? isArchivedJob(q, now) : isActiveJob(q, now))),
    [quotes, isArchiveView, now]
  );
  const archiveCount = useMemo(() => quotes.filter(q => isArchivedJob(q, now)).length, [quotes, now]);

  // In archive view the status-filter pills don't apply — both buckets
  // already constrain the list, and adding another axis is just noise.
  const statusFiltered = (isArchiveView || activeFilter === 'All')
    ? bucketedQuotes
    : bucketedQuotes.filter(q => getStatus(q) === activeFilter.toUpperCase());

  const filteredQuotes = searchTerm.trim()
    ? statusFiltered.filter(q => {
        const term = searchTerm.toLowerCase();
        return (q.clientName || '').toLowerCase().includes(term) ||
               (q.quoteReference || '').toLowerCase().includes(term) ||
               (q.siteAddress || '').toLowerCase().includes(term);
      })
    : statusFiltered;

  const openStatusModal = (e, jobId, targetStatus) => {
    e.stopPropagation();
    if (dispatch) dispatch({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  if (loading) {
    return (
      <div className="text-center py-20" style={{ color: 'var(--tq-muted)' }}>
        <div className="w-10 h-10 border-3 border-tq-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        Loading saved jobs...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4 opacity-30">&#9888;</div>
        <h2 className="text-xl font-heading font-bold mb-2" style={{ color: 'var(--tq-text)' }}>Could not load jobs</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
          {loadError}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            setLoadError(null);
            listJobs(currentUserId)
              .then((data) => { setLocalQuotes(data); setLoadError(null); })
              .catch(() => setLoadError('Still could not load jobs. Check your connection.'))
              .finally(() => setLoading(false));
          }}
          className="btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="max-w-5xl mx-auto">
        <h2 className="page-title mb-6">My {term.title}s</h2>
        <div className="text-center py-20">
          <div className="text-4xl mb-4 opacity-30">&#128193;</div>
          <h2 className="text-xl font-heading font-bold mb-2" style={{ color: 'var(--tq-text)' }}>No saved jobs yet</h2>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            Generate a {term.lower} and click "Save {term.title}" to store it here for later.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2 className="page-title mb-1">
          Saved jobs
        </h2>
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
          {bucketedQuotes.length} {isArchiveView ? 'archived' : 'active'} job{bucketedQuotes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Active / Archive tabs. Default 'Active' on every session — the
          archive view is opt-in. Count badge hidden when zero so the
          tab doesn't read "(0)". */}
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Job list view">
        <button
          type="button"
          role="tab"
          aria-selected={!isArchiveView}
          onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'active' })}
          className={`pill ${!isArchiveView ? 'active' : ''}`}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isArchiveView}
          onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'archive' })}
          className={`pill ${isArchiveView ? 'active' : ''}`}
        >
          Archive{archiveCount > 0 ? ` (${archiveCount})` : ''}
        </button>
      </div>

      {/* Search and filter row. Status pills only render in active view —
          archive jobs are already constrained to declined. */}
      <div className="flex flex-col fq:flex-row gap-3 mb-6">
        <div className="relative flex-1 fq:max-w-xs">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by client, reference, or address..."
            className="nq-field w-full pl-9"
            style={{ minHeight: 40 }}
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2"
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="var(--tq-muted)" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: 'var(--tq-muted)', lineHeight: 1 }}
            >
              &times;
            </button>
          )}
        </div>

        {/* Filter pills — active view only */}
        {!isArchiveView && (
          <div className="flex flex-wrap gap-2 self-start">
            {ACTIVE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`pill ${activeFilter === f ? 'active' : ''}`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty bucket — archive has no jobs at all */}
      {isArchiveView && bucketedQuotes.length === 0 && !searchTerm.trim() && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            No archived {term.lower}s yet — declined {term.lower}s will show here once you have any.
          </p>
        </div>
      )}

      {/* Empty filter/search state — active view only */}
      {!isArchiveView && filteredQuotes.length === 0 && (activeFilter !== 'All' || searchTerm.trim()) && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            {searchTerm.trim()
              ? `No jobs matching "${searchTerm.trim()}"`
              : `No ${activeFilter.toLowerCase()} jobs.`}
          </p>
          <button
            onClick={() => { setActiveFilter('All'); setSearchTerm(''); }}
            className="mt-2 text-xs"
            style={{ color: 'var(--tq-accent)' }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Search-with-no-results inside archive view */}
      {isArchiveView && filteredQuotes.length === 0 && searchTerm.trim() && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            No archived jobs matching "{searchTerm.trim()}"
          </p>
          <button
            onClick={() => setSearchTerm('')}
            className="mt-2 text-xs"
            style={{ color: 'var(--tq-accent)' }}
          >
            Clear search
          </button>
        </div>
      )}

      {/* Job rows */}
      <div className="space-y-2">
        {filteredQuotes.map(quote => {
          const hasRams = quote.hasRams || !!quote.ramsSnapshot;
          const status = getStatus(quote);
          const borderLeft = status === 'ACCEPTED' || status === 'COMPLETED'
            ? '3px solid var(--tq-confirmed-bd)'
            : status === 'DECLINED'
              ? '3px solid var(--tq-error-bd)'
              : '3px solid transparent';

          return (
            <div
              key={quote.id}
              className="job-row"
              style={{ borderLeft }}
              onClick={() => onViewQuote(quote)}
            >
              {/* Left: name, status, metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="jr-ref">{quote.quoteReference}</span>
                  <StatusBadge status={status} />
                  <VideoBadge captureMode={quote.snapshot?.captureMode} />
                  {status === 'SENT' && <ExpiryBadge expiresAt={quote.expiresAt} />}
                  {status === 'ACCEPTED' && <RamsBadge hasRams={hasRams} />}
                </div>
                <div className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
                  {quote.clientName || 'Unnamed client'}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                  {quote.siteAddress || ''}
                  {quote.quoteDate ? ` \u00b7 ${formatDate(quote.quoteDate)}` : ''}
                  <span className="fq:hidden"> · {formatCurrency(quote.totalAmount)}</span>
                </div>
              </div>

              {/* Middle: amount (desktop) */}
              <div
                className="mx-4 shrink-0 hidden fq:block"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}
              >
                {formatCurrency(quote.totalAmount)}
              </div>

              {/* Action buttons. `.row-action-btn` is compact 36px on
                  desktop, full-width 44px on mobile so each tap target
                  is unambiguous. Wrapper goes flex-col on mobile so the
                  buttons stack vertically.

                  In archive view, per-status action buttons (Mark Sent /
                  Accepted / Declined / Complete) are hidden \u2014 archive
                  rows are read-only-ish, the user opens the row to view
                  the quote and can change status from there if needed.
                  Delete stays visible so declined jobs can still be
                  pruned. */}
              <div className="flex flex-col fq:flex-row gap-2 shrink-0 fq:flex-wrap w-full fq:w-auto" onClick={e => e.stopPropagation()}>
                {!isArchiveView && status === 'DRAFT' && (
                  <>
                    <button onClick={(e) => openStatusModal(e, quote.id, 'sent')} className="row-action-btn" style={{ background: 'var(--tq-accent)', color: '#fff', borderColor: 'var(--tq-accent)' }}>
                      Mark Sent
                    </button>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="row-action-btn"
                      style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'✗'} Declined
                    </button>
                  </>
                )}

                {!isArchiveView && status === 'SENT' && (
                  <>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'accepted')}
                      className="row-action-btn"
                      style={{ borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      {'\u2713'} Accepted
                    </button>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="row-action-btn"
                      style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'\u2717'} Declined
                    </button>
                  </>
                )}

                {!isArchiveView && status === 'ACCEPTED' && (
                  <>
                    {isAdminPlan && hasRams && onViewRams ? (
                      <button onClick={() => onViewRams(quote)} className="row-action-btn">
                        View RAMS
                      </button>
                    ) : isAdminPlan && onCreateRams ? (
                      <button
                        onClick={() => onCreateRams(quote)}
                        className="row-action-btn"
                        style={{ borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
                      >
                        Create RAMS
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'completed')}
                      className="row-action-btn"
                      style={{ borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      Complete
                    </button>
                    {/* Manual decline from accepted — customer pulled out
                        after acceptance. Mirrors the same button on
                        Dashboard.jsx. */}
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="row-action-btn"
                      style={{ borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'✗'} Declined
                    </button>
                  </>
                )}

                {confirmDeleteId === quote.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(quote.id)}
                      className="row-action-btn"
                      style={{ backgroundColor: 'var(--tq-error-bg)', color: 'var(--tq-error-txt)', borderColor: 'var(--tq-error-bd)' }}
                    >
                      Confirm
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="row-action-btn">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDeleteId(quote.id)} className="row-action-btn" style={{ color: 'var(--tq-muted)' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
