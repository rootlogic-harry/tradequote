import React, { useState, useEffect, useMemo, useRef } from 'react';
import { listJobs, deleteJob, deletePhotos } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';
import { documentTerm } from '../utils/documentType.js';
import { isActiveJob, isCompletedJob, isArchivedJob } from '../utils/jobLifecycle.js';

// Active-view filters drop Completed (its own tab as of 2026-06-26) and
// Declined (archive bucket). The "All" pill within Active matches both.
const ACTIVE_FILTERS = ['All', 'Draft', 'Sent', 'Accepted'];

const VIEW_MODES = ['active', 'completed', 'archive'];

// ─────────────────────────────────────────────────────────────────────
// Mirrors Dashboard.jsx's per-status primary action contract — keeps
// the two surfaces' row UX byte-identical (Harry's 2026-06-29 audit:
// SavedQuotes mobile was "an absolute mess" because the old layout
// stacked 3-4 buttons full-width per row). Now: status stamp + client
// + ref/£ + ONE primary button + kebab. Same row-redesign grid.
// ─────────────────────────────────────────────────────────────────────
const PRIMARY_ACTION = {
  draft: { label: 'Send', target: 'sent' },
  sent: { label: 'Mark accepted', target: 'accepted' },
  accepted: { label: 'Mark complete', target: 'completed' },
};

// Per-status kebab item set. SavedQuotes adds RAMS items for admin
// users on accepted jobs (Dashboard's kebab dropped them because the
// canonical RAMS button lives on QuoteOutput — but SavedQuotes is the
// archive browser, so surfacing existing RAMS access here is useful).
function kebabItemsFor(status, { isAdminPlan = false, hasRams = false, canViewRams = false, canCreateRams = false } = {}) {
  if (status === 'draft') {
    return [
      { id: 'edit', label: 'Edit quote' },
      { id: '__' },
      { id: 'decline', label: 'Mark declined', danger: true },
      { id: 'delete', label: 'Delete', danger: true },
    ];
  }
  if (status === 'sent') {
    return [
      { id: 'decline', label: 'Mark declined', danger: true },
    ];
  }
  if (status === 'accepted') {
    const items = [];
    if (isAdminPlan && hasRams && canViewRams) {
      items.push({ id: 'view-rams', label: 'View RAMS' });
      items.push({ id: '__' });
    } else if (isAdminPlan && canCreateRams) {
      items.push({ id: 'create-rams', label: 'Create RAMS' });
      items.push({ id: '__' });
    }
    items.push({ id: 'decline', label: 'Mark declined', danger: true });
    return items;
  }
  if (status === 'completed') {
    // Completed is terminal but we still want a Delete affordance so
    // old finished jobs can be pruned. Dashboard's kebab returns []
    // here because Dashboard's Recent list is bounded; SavedQuotes is
    // the full archive, so users will accumulate completed rows.
    return [
      { id: 'delete', label: 'Delete', danger: true },
    ];
  }
  if (status === 'declined') {
    return [
      { id: 'delete', label: 'Delete', danger: true },
    ];
  }
  return [];
}

function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function KebabMenu({ items, onClose, onAction }) {
  const ref = useRef(null);
  // Inline two-tap confirm for destructive items (Delete). First tap
  // arms; second tap fires. Mirrors Dashboard.jsx.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  return (
    <div className="kebab-menu" ref={ref} role="menu">
      {items.map((it, i) =>
        it.id === '__'
          ? <div key={`d${i}`} className="kebab-menu-div" aria-hidden="true" />
          : (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`touch-44 ${it.danger ? 'danger' : ''} ${it.id === 'delete' && deleteArmed ? 'armed' : ''}`}
              style={{ minHeight: 44, width: '100%', justifyContent: 'flex-start' }}
              onClick={(e) => {
                e.stopPropagation();
                if (it.id === 'delete' && !deleteArmed) {
                  setDeleteArmed(true);
                  return;
                }
                onAction(it.id);
                onClose();
              }}
            >
              {it.id === 'delete' && deleteArmed ? 'Tap again to confirm' : it.label}
            </button>
          )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// JobRow — single row in the saved-jobs list. Same grid contract as
// Dashboard's JobRow: [stamp] [client+site] [ref+£] [primary] [⋯].
// Mobile reflows via the .job-row-redesign @media block in index.html.
//
// Two SavedQuotes-specific differences vs Dashboard:
//   1. Carries the additional badges (Expiry / RAMS / Video) inline
//      next to the client name — SavedQuotes is the archive browser
//      so denser metadata is acceptable.
//   2. Kebab includes Delete on completed/declined (Dashboard hides
//      these because its Recent list is bounded).
// ─────────────────────────────────────────────────────────────────────
function JobRow({
  quote,
  isAdminPlan,
  onOpen,
  onAdvance,
  onMenuAction,
  onCreateRams,
  onViewRams,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = (quote.status || 'draft').toLowerCase();
  const primary = PRIMARY_ACTION[status];
  const hasRams = quote.hasRams || !!quote.ramsSnapshot;
  const canViewRams = !!onViewRams;
  const canCreateRams = !!onCreateRams;

  const statusLabel = {
    draft: 'Draft',
    sent: 'Sent',
    accepted: 'Accepted',
    completed: 'Completed',
    declined: 'Declined',
  }[status] || 'Draft';

  const items = kebabItemsFor(status, { isAdminPlan, hasRams, canViewRams, canCreateRams });

  return (
    <div
      className="job-row job-row-redesign"
      onClick={() => onOpen(quote)}
      role="button"
      tabIndex={0}
      style={{ minHeight: 44 }}
    >
      <div className="job-row-stamp" data-s={status}>{statusLabel}</div>

      <div className="min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
          {quote.clientName || 'Unnamed client'}
        </div>
        {quote.siteAddress && (
          <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
            {quote.siteAddress}
            {quote.quoteDate ? ` · ${formatDate(quote.quoteDate)}` : ''}
          </div>
        )}
        {/* Inline badges — wrap on mobile so they never overflow */}
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <VideoBadge captureMode={quote.snapshot?.captureMode} />
          {status === 'sent' && <ExpiryBadge expiresAt={quote.expiresAt} />}
          {status === 'accepted' && isAdminPlan && <RamsBadge hasRams={hasRams} />}
        </div>
      </div>

      <div className="job-row-money">
        <div className="ref">{quote.quoteReference || '—'}</div>
        <div className="total">{formatCurrency(quote.totalAmount || 0)}</div>
      </div>

      <div className="job-row-primary">
        {primary && (
          <button
            type="button"
            className="row-action-btn"
            style={
              primary.target === 'sent'
                ? { borderColor: 'var(--tq-accent)', background: 'var(--tq-accent)', color: '#ffffff' }
                : { borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }
            }
            onClick={(e) => { e.stopPropagation(); onAdvance(quote, primary.target); }}
          >
            {primary.label}
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="kebab-menu-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="kebab-btn touch-44"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{ minHeight: 44, minWidth: 44 }}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(m => !m); }}
          >
            <KebabIcon />
          </button>
          {menuOpen && (
            <KebabMenu
              items={items}
              onClose={() => setMenuOpen(false)}
              onAction={(id) => onMenuAction(id, quote)}
            />
          )}
        </div>
      )}
    </div>
  );
}

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
      showToast?.('Job deleted', 'success');
    } catch (err) {
      console.error('Failed to delete quote:', err);
      showToast?.('Failed to delete job. Check your connection and try again.', 'error');
    }
  };

  // Three-tab split (Mark's ask 2026-06-26): Active | Completed | Archive.
  const now = useMemo(() => new Date(), []);
  const view = VIEW_MODES.includes(viewMode) ? viewMode : 'active';
  const isActiveView = view === 'active';
  const isCompletedView = view === 'completed';
  const isArchiveView = view === 'archive';

  const bucketedQuotes = useMemo(() => {
    const fn = isArchiveView ? isArchivedJob : isCompletedView ? isCompletedJob : isActiveJob;
    return quotes.filter(q => fn(q, now));
  }, [quotes, view, now]);

  const completedCount = useMemo(() => quotes.filter(q => isCompletedJob(q, now)).length, [quotes, now]);
  const archiveCount = useMemo(() => quotes.filter(q => isArchivedJob(q, now)).length, [quotes, now]);
  const activeCount = useMemo(() => quotes.filter(q => isActiveJob(q, now)).length, [quotes, now]);

  // Per-pill counts within Active. Draft / Sent / Accepted are computed
  // against the active bucket only (not the full quotes list) so they
  // never inflate for a completed/declined job. Mark's 2026-07-07 UAT:
  // wanted the SavedQuotes numbers to reconcile with the Dashboard's
  // pill counts (both now count the same active-bucketed jobs by
  // status). All = every job in Active.
  const activePillCounts = useMemo(() => {
    const counts = { All: 0, Draft: 0, Sent: 0, Accepted: 0 };
    for (const q of quotes) {
      if (!isActiveJob(q, now)) continue;
      counts.All += 1;
      const s = (q.status || 'draft').toLowerCase();
      if (s === 'draft')    counts.Draft    += 1;
      else if (s === 'sent')     counts.Sent     += 1;
      else if (s === 'accepted') counts.Accepted += 1;
    }
    return counts;
  }, [quotes, now]);

  const getStatus = (job) => (job.status || 'draft').toUpperCase();

  // Status-filter pills only render in Active. Completed + Archive are
  // single-status buckets — another axis would just be noise.
  const statusFiltered = (!isActiveView || activeFilter === 'All')
    ? bucketedQuotes
    : bucketedQuotes.filter(q => getStatus(q) === activeFilter.toUpperCase());

  const filteredQuotes = searchTerm.trim()
    ? statusFiltered.filter(q => {
        const t = searchTerm.toLowerCase();
        return (q.clientName || '').toLowerCase().includes(t) ||
               (q.quoteReference || '').toLowerCase().includes(t) ||
               (q.siteAddress || '').toLowerCase().includes(t);
      })
    : statusFiltered;

  const openStatusModal = (jobId, targetStatus) => {
    if (dispatch) dispatch({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  const handleAdvance = (quote, targetStatus) => {
    openStatusModal(quote.id, targetStatus);
  };

  const handleMenuAction = (actionId, quote) => {
    switch (actionId) {
      case 'edit':
        onViewQuote?.(quote);
        return;
      case 'decline':
        openStatusModal(quote.id, 'declined');
        return;
      case 'delete':
        handleDelete(quote.id);
        return;
      case 'view-rams':
        onViewRams?.(quote);
        return;
      case 'create-rams':
        onCreateRams?.(quote);
        return;
      default:
        onViewQuote?.(quote);
    }
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
          {bucketedQuotes.length} {isArchiveView ? 'archived' : isCompletedView ? 'completed' : 'active'} job{bucketedQuotes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Active / Completed / Archive tabs (Mark's 2026-06-26 ask; count
          rendering unified 2026-07-08 for filter consistency with the
          Dashboard's pill counts). Every tab now carries a count so
          the totals reconcile at a glance:
            Active + Completed + Archived = Dashboard's ALL count.
          Default tab is 'Active' on every session — the others are
          opt-in. */}
      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Job list view">
        <button
          type="button"
          role="tab"
          aria-selected={isActiveView}
          onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'active' })}
          className={`pill ${isActiveView ? 'active' : ''}`}
          data-testid="savedquotes-tab-active"
        >
          Active ({activeCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isCompletedView}
          onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'completed' })}
          className={`pill ${isCompletedView ? 'active' : ''}`}
          data-testid="savedquotes-tab-completed"
        >
          Completed ({completedCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isArchiveView}
          onClick={() => dispatch?.({ type: 'SET_VIEW_MODE', mode: 'archive' })}
          className={`pill ${isArchiveView ? 'active' : ''}`}
          data-testid="savedquotes-tab-archive"
        >
          Archived ({archiveCount})
        </button>
      </div>

      {/* Search and filter row. Status pills only render in active view —
          archive jobs are already constrained to declined. Stacks
          vertically on mobile so neither field cramps the other. */}
      <div className="flex flex-col fq:flex-row gap-3 mb-6">
        <div className="relative flex-1 fq:max-w-xs">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by client, reference, or address..."
            className="nq-field w-full pl-9"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="var(--tq-muted)" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
              className="touch-44 absolute right-1 top-1/2 -translate-y-1/2"
              style={{ minHeight: 44, minWidth: 44, color: 'var(--tq-muted)', lineHeight: 1, fontSize: 20, background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              &times;
            </button>
          )}
        </div>

        {/* Filter pills — Active view only. Completed + Archive are
            single-status buckets. Counts render inline in the pill
            label (matches the Dashboard's pill contract). */}
        {isActiveView && (
          <div className="flex flex-wrap gap-2 self-start">
            {ACTIVE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`pill ${activeFilter === f ? 'active' : ''}`}
                data-testid={`savedquotes-pill-${f.toLowerCase()}`}
              >
                {f}
                <span className="ml-1.5 text-[11px] opacity-70" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {activePillCounts[f] || 0}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty bucket — Completed or Archive view, no jobs at all */}
      {isCompletedView && bucketedQuotes.length === 0 && !searchTerm.trim() && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            No completed {term.lower}s yet — finished work shows here once you mark a job as completed.
          </p>
        </div>
      )}

      {isArchiveView && bucketedQuotes.length === 0 && !searchTerm.trim() && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            No archived {term.lower}s yet — declined {term.lower}s will show here once you have any.
          </p>
        </div>
      )}

      {/* Empty filter/search state — active view only */}
      {isActiveView && filteredQuotes.length === 0 && (activeFilter !== 'All' || searchTerm.trim()) && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            {searchTerm.trim()
              ? `No jobs matching "${searchTerm.trim()}"`
              : `No ${activeFilter.toLowerCase()} jobs.`}
          </p>
          <button
            type="button"
            onClick={() => { setActiveFilter('All'); setSearchTerm(''); }}
            className="touch-44 mt-2 text-sm px-3"
            style={{ minHeight: 44, color: 'var(--tq-accent)', background: 'transparent', border: 'none' }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Search-with-no-results inside Completed or Archive view */}
      {!isActiveView && filteredQuotes.length === 0 && searchTerm.trim() && (
        <div className="text-center py-12">
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            No {isArchiveView ? 'archived' : 'completed'} jobs matching "{searchTerm.trim()}"
          </p>
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="touch-44 mt-2 text-sm px-3"
            style={{ minHeight: 44, color: 'var(--tq-accent)', background: 'transparent', border: 'none' }}
          >
            Clear search
          </button>
        </div>
      )}

      {/* Job rows — same redesign grid as Dashboard (Harry's 2026-06-29
          audit). Mobile reflows via index.html's .job-row-redesign
          @media block. */}
      <div className="space-y-2">
        {filteredQuotes.map(quote => (
          <JobRow
            key={quote.id}
            quote={quote}
            isAdminPlan={isAdminPlan}
            onOpen={onViewQuote}
            onAdvance={handleAdvance}
            onMenuAction={handleMenuAction}
            onCreateRams={onCreateRams}
            onViewRams={onViewRams}
          />
        ))}
      </div>
    </div>
  );
}

