import React, { useState, useMemo, useRef, useEffect } from 'react';
import { formatCurrency } from '../utils/quoteBuilder.js';
import { formatCurrencyCompact } from '../utils/formatCurrencyCompact.js';
import { filterAndLimitJobs, computeFilterCounts, DASHBOARD_PREVIEW_LIMIT } from '../utils/dashboardFilter.js';

// ─────────────────────────────────────────────────────────────────────
// Dashboard redesign (2026-06-29) — money-first stats, one-action rows,
// rail-mounted quota chip. Source-of-truth prototype:
//   /tmp/fastquote-dashboard-handoff/design_handoff_dashboard/
//     FastQuote Dashboard Redesign.html
//
// TERMINOLOGY LOCKDOWN — IMPORTANT:
//   App chrome (nav, page titles, buttons, headings, empty states) says
//   "Quote" — literal string. Do NOT thread `documentTerm(profile)` into
//   anything user-visible on this surface. The client-facing DOCUMENT
//   (QuoteDocument.jsx, PDF, client portal, DOCX, email subjects) still
//   follows `profile.documentType` — that's the separate axis. The
//   Document Type setting controls how the document is titled to the
//   client; this dashboard always speaks "Quote" to the tradesman.
// ─────────────────────────────────────────────────────────────────────

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

// Days since a job was marked sent. Returns null if no sentAt timestamp
// (legacy data) so we don't flag rows we can't measure.
function daysSinceSent(job) {
  if (!job?.sentAt) return null;
  const sent = new Date(job.sentAt);
  if (Number.isNaN(sent.getTime())) return null;
  return Math.floor((Date.now() - sent.getTime()) / (1000 * 60 * 60 * 24));
}

// A row is "flagged" (needs attention amber bar + flag badge) when:
//   - sent quote with no reply for ≥ 2 days, OR
//   - accepted job without a RAMS attached.
// Driven by the prototype's `(status==='sent' && sentDays>=2) ||
// (status==='accepted' && rams===false)`. We map to FastQuote's job
// shape (`sentAt`, `hasRams`/`ramsSnapshot`).
function isFlaggedRow(job) {
  const status = (job.status || 'draft').toLowerCase();
  if (status === 'sent') {
    const d = daysSinceSent(job);
    return d !== null && d >= 2;
  }
  if (status === 'accepted') {
    return !(job.hasRams || !!job.ramsSnapshot);
  }
  return false;
}

// Win-rate over the last 30 days: won / (won + declined). Returns null
// when there's no signal in the window (don't surface "0%" — that's a
// misleading-not-confidence-inducing number).
function computeWinRate(jobs) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = jobs.filter(j => {
    const stamp = j.acceptedAt || j.declinedAt || j.savedAt;
    if (!stamp) return false;
    const t = new Date(stamp).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
  const won = recent.filter(j => j.status === 'accepted' || j.status === 'completed').length;
  const lost = recent.filter(j => j.status === 'declined').length;
  if (won + lost === 0) return null;
  return Math.round((won / (won + lost)) * 100);
}

// Per-row primary action contract. The button advances status to the
// next stage (NEVER opens the row — `stopPropagation` on click). Absent
// for terminal statuses (completed / declined) — column stays empty so
// alignment holds.
const PRIMARY_ACTION = {
  draft: { label: 'Send', target: 'sent' },
  sent: { label: 'Mark accepted', target: 'accepted' },
  accepted: { label: 'Mark complete', target: 'completed' },
};

// ─────────────────────────────────────────────────────────────────────
// Per-status kebab item set. Exported at module scope so JobRow can
// decide whether to render the kebab button at all (empty list ⇒ no
// kebab; Completed quotes are terminal and have nothing to add).
//
// 2026-06-29 (Harry): Duplicate and Create/View RAMS removed.
// Duplicate had no real wiring (routed to onViewJob — a placeholder
// promise). RAMS lives on QuoteOutput behind a dedicated button —
// surfacing it in the row-level kebab created ambiguity ("which
// Create RAMS am I tapping?"). Row click opens the quote; canonical
// RAMS button lives there.
//
// `__` is a divider sentinel.
// ─────────────────────────────────────────────────────────────────────
function kebabItemsFor(status) {
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
      { id: 'resend', label: 'Resend link' },
      { id: '__' },
      { id: 'decline', label: 'Mark declined', danger: true },
    ];
  }
  if (status === 'accepted') {
    // The row's primary button is "Mark complete". The only remaining
    // off-path action is Mark declined (client backed out post-
    // acceptance — Mark's 2026-06-26 use case).
    return [
      { id: 'decline', label: 'Mark declined', danger: true },
    ];
  }
  if (status === 'completed') {
    // Terminal. Row click opens the quote; the kebab adds nothing.
    return [];
  }
  if (status === 'declined') {
    return [
      { id: 'reopen', label: 'Re-open' },
      { id: '__' },
      { id: 'delete', label: 'Delete', danger: true },
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────
// Kebab overflow menu — contextual per status. Click-outside closes.
// Click on a menu item fires onAction(label, job) and closes the menu.
// stopPropagation on both the kebab and the menu so the row doesn't
// open underneath.
// ─────────────────────────────────────────────────────────────────────
function KebabMenu({ job, status, isAdminPlan, onClose, onAction }) {
  const ref = useRef(null);
  // 2026-06-29: inline two-tap confirm for destructive items (Delete).
  // First tap arms; second tap (within the same menu open) fires the
  // action. Menu close-on-outside-click clears the arming naturally.
  // Mirrors the SavedQuotes confirmDeleteId pattern but scoped to a
  // single open menu — no need for a job-id key.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const items = kebabItemsFor(status);

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
                // Inline two-tap for Delete only — other danger items
                // (Mark declined) route through their own modal/flow.
                if (it.id === 'delete' && !deleteArmed) {
                  setDeleteArmed(true);
                  return;
                }
                onAction(it.id, job);
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
// JobRow — one row in the Recent jobs table. 5-column grid on desktop:
//   [ status stamp ] [ client + site + flag ] [ ref + £ ] [ primary ] [ ⋯ ]
// Mobile reflows per index.html @media block.
// Row click → onOpen(job). Primary button → onAdvance(job). Kebab →
// KebabMenu, which calls onMenuAction(itemId, job).
// ─────────────────────────────────────────────────────────────────────
function JobRow({ job, isAdminPlan, onOpen, onAdvance, onMenuAction }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const status = (job.status || 'draft').toLowerCase();
  const primary = PRIMARY_ACTION[status];
  const flagged = isFlaggedRow(job);
  const sentDays = daysSinceSent(job);
  const hasRams = job.hasRams || !!job.ramsSnapshot;

  // Status label is the on-screen text for the row's status stamp.
  // Capitalised — "Sent" / "Accepted" not "SENT" — matches the
  // prototype's body voice.
  const statusLabel = {
    draft: 'Draft',
    sent: 'Sent',
    accepted: 'Accepted',
    completed: 'Completed',
    declined: 'Declined',
  }[status] || 'Draft';

  return (
    <div
      className={`job-row job-row-redesign${flagged ? ' flagged' : ''}`}
      onClick={() => onOpen(job)}
      role="button"
      tabIndex={0}
      style={{ minHeight: 44 }}
    >
      <div className="job-row-stamp" data-s={status}>{statusLabel}</div>

      <div className="min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--tq-text)' }}>
          {job.clientName || 'Unnamed'}
        </div>
        {job.siteAddress && (
          <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
            {job.siteAddress}
          </div>
        )}
        {/* Flag badge under the client name — "RAMS needed" / "No
            reply · 8d". Mirrors the prototype's small amber tag. */}
        {flagged && status === 'accepted' && !hasRams && (
          <span className="job-flag">RAMS needed</span>
        )}
        {flagged && status === 'sent' && sentDays !== null && (
          <span className="job-flag">No reply &middot; {sentDays}d</span>
        )}
      </div>

      <div className="job-row-money">
        <div className="ref">{job.quoteReference || '—'}</div>
        <div className="total">{formatCurrency(job.totalAmount || 0)}</div>
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
            onClick={(e) => { e.stopPropagation(); onAdvance(job, primary.target); }}
          >
            {primary.label}
          </button>
        )}
      </div>

      {/* Kebab is only rendered when the status has at least one
          off-path action. Completed quotes are terminal — no kebab. */}
      {kebabItemsFor(status).length > 0 && (
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
              job={job}
              status={status}
              isAdminPlan={isAdminPlan}
              onClose={() => setMenuOpen(false)}
              onAction={onMenuAction}
            />
          )}
        </div>
      )}
    </div>
  );
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

export default function Dashboard({
  userName,
  profile, // intentionally NOT used for document-term lockdown (see header)
  onStartNewQuote,
  onStartQuickQuote,
  onViewJobs,
  currentDraft,
  onResumeDraft,
  onMarkRamsNotRequired, // kept for legacy callers
  onCreateRamsFromSaved,
  savedJobs = [],
  recentJobs = [],
  dispatch,
  onViewJob,
  onViewRams,
  onResendLink,
  onDeleteJob,
  showToast,
  isAdminPlan = false,
}) {
  // Note: `profile` is still in props for back-compat with App.jsx —
  // intentionally unused for any nav/heading/button text. The dashboard
  // chrome speaks "Quote" everywhere; the client-facing document follows
  // profile.documentType via QuoteDocument.jsx (separate concern).

  const jobs = recentJobs.length > 0 ? recentJobs : savedJobs;

  // Status filter pills (six pills with live counts). The prototype's
  // labels are: All · Drafts · Sent · Accepted · Done · Declined. We
  // map "Done" → status === 'completed'.
  const [filter, setFilter] = useState('all');
  const [showMonthly, setShowMonthly] = useState(false);
  // Mark's UAT (2026-07-23): "big list of jobs [...] add a search
  // option [...] it isn't visible on the dashboard". Same shape as
  // SavedQuotes's search — client / quote reference / site address,
  // case-insensitive substring. Runs BEFORE the pill filter + preview
  // cap so the pill counts + "N more" footer both reflect the search.
  const [searchTerm, setSearchTerm] = useState('');
  const currentYear = new Date().getFullYear();

  // Apply search first — every downstream memo consumes the searched
  // list so filter pills + counts + "N more" footer all reflect it.
  const searchedJobs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => (
      (j.clientName || '').toLowerCase().includes(q) ||
      (j.quoteReference || '').toLowerCase().includes(q) ||
      (j.siteAddress || '').toLowerCase().includes(q)
    ));
  }, [jobs, searchTerm]);

  // ── Live filter counts ──
  // Both counts + visibleJobs delegate to pure helpers in
  // `src/utils/dashboardFilter.js` so the wiring is unit-testable end-to-
  // end (Harry, 2026-06-29: source-level regex tests passed while the
  // live behaviour silently regressed). `filterAndLimitJobs` filters
  // BEFORE slicing — slicing first would truncate to the most recent 10
  // jobs and then filter within those 10, which on a busy account looks
  // identical to "the filter does nothing".
  const counts = useMemo(() => computeFilterCounts(searchedJobs), [searchedJobs]);
  const visibleJobs = useMemo(
    () => filterAndLimitJobs(searchedJobs, filter, DASHBOARD_PREVIEW_LIMIT),
    [searchedJobs, filter],
  );
  // "N more" footer only renders when the current filter has more rows
  // than fit in the preview. counts.all is the total across all statuses;
  // counts[<filter>] is the total for the active pill.
  const totalForFilter = filter === 'all' ? counts.all : (counts[filter] || 0);
  const hiddenCount = Math.max(0, totalForFilter - visibleJobs.length);

  // ── Money-first stats (spec §"Money-first stat hierarchy") ──
  const wonThisYear = useMemo(() => {
    const year = new Date().getFullYear();
    return jobs
      .filter(j => (j.status === 'accepted' || j.status === 'completed'))
      .filter(j => {
        const t = j.acceptedAt || j.savedAt;
        if (!t) return false;
        return new Date(t).getFullYear() === year;
      })
      .reduce((s, j) => s + (j.totalAmount ?? 0), 0);
  }, [jobs]);

  const awaitingJobs = useMemo(() => jobs.filter(j => j.status === 'sent'), [jobs]);
  const awaitingValue = useMemo(() => awaitingJobs.reduce((s, j) => s + (j.totalAmount ?? 0), 0), [awaitingJobs]);

  const openPipeline = useMemo(
    () => jobs
      .filter(j => j.status !== 'declined' && j.status !== 'completed')
      .reduce((s, j) => s + (j.totalAmount ?? 0), 0),
    [jobs]
  );

  const winRate = useMemo(() => computeWinRate(jobs), [jobs]);

  // ── Monthly breakdown (2026) ── kept from the prototype + existing
  // dashboard. Collapsible, 12-month grid, peak month highlighted.
  const monthlyTotals = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, m) => ({
      label: new Date(currentYear, m, 1).toLocaleString('en-GB', { month: 'short' }),
      total: 0,
      count: 0,
    }));
    for (const j of jobs) {
      const stamp = j.savedAt;
      if (!stamp) continue;
      const d = new Date(stamp);
      if (Number.isNaN(d.getTime())) continue;
      if (d.getFullYear() !== currentYear) continue;
      const idx = d.getMonth();
      buckets[idx].total += j.totalAmount || 0;
      buckets[idx].count += 1;
    }
    return buckets;
  }, [jobs, currentYear]);

  const peakMonthTotal = useMemo(() => Math.max(0, ...monthlyTotals.map(m => m.total)), [monthlyTotals]);
  const yearTotal = useMemo(() => monthlyTotals.reduce((s, m) => s + m.total, 0), [monthlyTotals]);

  // ── Row interaction handlers ──
  const openStatusModal = (jobId, targetStatus) => {
    dispatch?.({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  const handleRowClick = (job) => {
    if (onViewJob) onViewJob(job);
  };

  const handleAdvance = (job, targetStatus) => {
    // Primary button uses the same status-lifecycle modal as before so
    // notes/expiry capture stays in one place. The modal then routes
    // through App.jsx's handleStatusConfirm → PUT /status.
    openStatusModal(job.id, targetStatus);
  };

  const handleMenuAction = (actionId, job) => {
    switch (actionId) {
      case 'edit':
        // Reuse the "open quote" path — SavedQuoteViewer offers Edit.
        onViewJob?.(job);
        return;
      case 'view':
        onViewJob?.(job);
        return;
      case 'duplicate':
        // Duplicate is not yet wired across the app; fall through to
        // open the quote so the user has a path forward. Flagged in
        // PR body as a follow-up to wire properly.
        onViewJob?.(job);
        return;
      case 'decline':
        // Routes through the existing status modal (note capture, etc.)
        openStatusModal(job.id, 'declined');
        return;
      case 'delete':
        // 2026-06-29: KebabMenu enforces an inline two-tap confirm so by
        // the time this fires the user has already confirmed. Delegates
        // to App.handleDeleteJob which calls deleteJob + refreshes.
        if (onDeleteJob) onDeleteJob(job.id);
        else onViewJob?.(job); // fail-safe for callers that haven't wired it yet
        return;
      case 'resend':
        // 2026-06-29: copy the client-portal URL to clipboard so the
        // waller can paste into WhatsApp / SMS / email without a
        // context switch. App.handleResendLink fetches the existing
        // token (or generates one) + copies + toasts.
        if (onResendLink) onResendLink(job);
        else onViewJob?.(job);
        return;
      case 'reopen':
        // 2026-06-29: server VALID_TRANSITIONS widened to allow
        // declined → draft. A customer who called back to discuss is
        // best served by the quote being back in the waller's hands
        // for edit, not magically marked Sent again. StatusModal
        // renders a confirm pane for the 'draft' target.
        openStatusModal(job.id, 'draft');
        return;
      case 'create-rams':
        onCreateRamsFromSaved?.(job);
        return;
      case 'view-rams':
        onViewRams?.(job);
        return;
      default:
        onViewJob?.(job);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Top line — greeting + date eyebrow, View all quotes + New quote
          CTAs. The old top-of-page quota strip is gone (moved to the
          rail). Mobile keeps the New Quote button only — QUICK is admin-
          only and hidden < fq breakpoint. */}
      <div className="flex flex-col fq:flex-row fq:items-end fq:justify-between gap-4 mb-8">
        <div>
          <div className="eyebrow mb-2">{todayFormatted()}</div>
          <h1 className="page-title" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
        </div>
        {/* Header CTAs. Terminology lockdown: literal "Quote" strings.
            See the comment at the top of this file — the rendered
            DOCUMENT title still follows profile.documentType, but app
            chrome is locked to "Quote". */}
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            onClick={onViewJobs}
            className="btn-ghost"
            type="button"
          >
            View all quotes
          </button>
          <button
            onClick={onStartQuickQuote}
            className="btn-ghost hidden fq:inline-flex"
            title="Skip the review step"
            type="button"
          >
            QUICK QUOTE
          </button>
          <button onClick={onStartNewQuote} className="btn-primary" type="button">
            + NEW QUOTE
          </button>
        </div>
      </div>

      {/* Money-first stats strip. 4 cells, ordered Won/Awaiting/
          Pipeline/Win-rate. Awaiting is the actionable one (amber-
          tinted, with a Chase-these link that snaps the filter to
          Sent). Demote zeros — handled via tone, not absence. */}
      <div className="stats-strip" style={{ borderRadius: 2 }}>
        <div className="stat-cell accent">
          <div className="stat-label">Won this year</div>
          <div className="stat-value">
            <span className="stat-value-full">{formatCurrency(wonThisYear)}</span>
            <span className="stat-value-compact">{formatCurrencyCompact(wonThisYear)}</span>
          </div>
          <div className="stat-sub">{counts.accepted + counts.completed} quotes accepted</div>
        </div>
        <div className="stat-cell warn">
          <div className="stat-label">Awaiting reply</div>
          <div className="stat-value">
            {awaitingJobs.length}
            {awaitingJobs.length > 0 && (
              <>
                {' '}&middot;{' '}
                <span className="stat-value-full">{formatCurrency(awaitingValue)}</span>
                <span className="stat-value-compact">{formatCurrencyCompact(awaitingValue)}</span>
              </>
            )}
          </div>
          {awaitingJobs.length > 0 && (
            <button
              type="button"
              className="stat-link touch-44"
              style={{ minHeight: 44 }}
              onClick={() => setFilter('sent')}
            >
              Chase these &rarr;
            </button>
          )}
        </div>
        <div className="stat-cell">
          <div className="stat-label">Open pipeline</div>
          <div className="stat-value">
            <span className="stat-value-full">{formatCurrencyCompact(openPipeline)}</span>
            <span className="stat-value-compact">{formatCurrencyCompact(openPipeline)}</span>
          </div>
          <div className="stat-sub">Live work</div>
        </div>
        <div className="stat-cell">
          <div className="stat-label">Win rate</div>
          <div className="stat-value">
            {winRate === null ? '—' : `${winRate}%`}
          </div>
          <div className="stat-sub">Last 30 days</div>
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
          {showMonthly ? '−' : '+'} Monthly breakdown ({currentYear})
        </button>
        {showMonthly && (
          <div
            className="mt-3 p-4"
            style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}
          >
            <div className="grid grid-cols-2 fq:grid-cols-6 gap-3">
              {monthlyTotals.map((m) => {
                const isPeak = m.total > 0 && m.total === peakMonthTotal;
                return (
                  <div key={m.label} className="text-center">
                    <div
                      className="text-xs uppercase mb-1"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--tq-muted)' }}
                    >
                      {m.label}
                    </div>
                    <div
                      style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: isPeak ? 'var(--tq-accent)' : (m.total > 0 ? 'var(--tq-text)' : 'var(--tq-muted)') }}
                    >
                      {formatCurrency(m.total)}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--tq-muted)' }}>
                      {m.count} {m.count === 1 ? 'quote' : 'quotes'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className="mt-4 pt-3"
              style={{ borderTop: '1px solid var(--tq-border)', fontSize: 12, color: 'var(--tq-muted)' }}
            >
              Total quoted in {currentYear} &middot; <strong style={{ color: 'var(--tq-text)' }}>{formatCurrency(yearTotal)}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Current draft banner — preserved from the previous dashboard.
          When a draft is in progress, surface it above the recent jobs
          list so the user has a one-click resume path. */}
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
              {currentDraft.step ? ` — Step ${currentDraft.step}` : ''}
            </p>
          </div>
          <button onClick={onResumeDraft} className="btn-primary whitespace-nowrap" type="button">
            Resume
          </button>
        </div>
      )}

      {/* Recent jobs — heading + caption + 6 filter pills + the table.
          No more FollowUpSection panel; urgency is surfaced inline on
          flagged rows. Mark's 3-tab parent (Active/Completed/Archive)
          is GONE from Dashboard per Harry's 2026-06-29 call — kept on
          SavedQuotes because that's the archive-browser surface. */}
      <div className="mb-8">
        <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
          <div>
            <div className="eyebrow">RECENT QUOTES</div>
            <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
              Anything needing action is marked with an amber bar.
            </div>
          </div>
        </div>
        {/* Search + filter pills. Search stacks above the pills on
             mobile, sits on the same row on desktop. Same shape as
             SavedQuotes for continuity. Mark's 2026-07-23 UAT. */}
        <div className="flex flex-col fq:flex-row gap-3 mb-3 fq:items-center">
          <div className="relative flex-1 fq:max-w-xs">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by client, reference, or address…"
              className="nq-field w-full pl-9"
              data-testid="dashboard-search"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="var(--tq-muted)" strokeWidth="2" strokeLinecap="round"
              aria-hidden
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
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter quotes">
            {[
              ['all', 'All'],
              ['draft', 'Drafts'],
              ['sent', 'Sent'],
              ['accepted', 'Accepted'],
              ['completed', 'Done'],
              ['declined', 'Declined'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`pill ${filter === key ? 'active' : ''}`}
              >
                {label}
                <span className="ml-1.5 text-[11px] opacity-70" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {visibleJobs.length === 0 ? (
          <div
            className="px-5 py-10 text-center"
            style={{ backgroundColor: 'var(--tq-card)', border: '1.5px solid var(--tq-border)', borderRadius: 2 }}
          >
            <div className="text-3xl mb-3 opacity-20">&#128221;</div>
            <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
              {searchTerm.trim()
                ? `No quotes match "${searchTerm.trim()}".`
                : filter === 'all'
                  ? 'No quotes yet. Create your first quote to get started.'
                  : `No ${filter === 'completed' ? 'done' : filter} quotes.`}
            </p>
            {searchTerm.trim() ? (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="btn-ghost"
                style={{ minHeight: 44, padding: '0 18px' }}
              >
                Clear search
              </button>
            ) : filter === 'all' && (
              <button onClick={onStartNewQuote} className="btn-primary" type="button">
                + New quote
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isAdminPlan={isAdminPlan}
                onOpen={handleRowClick}
                onAdvance={handleAdvance}
                onMenuAction={handleMenuAction}
              />
            ))}
            {/* "See all" footer — 2026-07-08. Mark's UAT: had 25 sent
                quotes, could only see 10 on the Dashboard preview and
                thought the app had lost them. Now the cap is 25 AND
                the preview declares itself as a preview when there's
                more to see. onViewJobs navigates to SavedQuotes (the
                full, uncapped list). */}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={onViewJobs}
                className="btn-link w-full text-sm"
                style={{ minHeight: 44, textAlign: 'center', padding: '10px 12px' }}
                data-testid="dashboard-see-all-more"
              >
                {hiddenCount} more {hiddenCount === 1 ? 'quote' : 'quotes'} — see all in My Quotes →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
