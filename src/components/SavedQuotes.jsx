import React, { useState, useEffect } from 'react';
import { listJobs, deleteJob, deletePhotos } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';
import { documentTerm } from '../utils/documentType.js';

const FILTERS = ['All', 'Draft', 'Sent', 'Accepted', 'Completed', 'Declined'];

export default function SavedQuotes({ onViewQuote, onCreateRams, onViewRams, currentUserId, profile, recentJobs = [], dispatch, isAdminPlan = false, showToast }) {
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

  const statusFiltered = activeFilter === 'All'
    ? quotes
    : quotes.filter(q => getStatus(q) === activeFilter.toUpperCase());

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
        <h2 className="page-title mb-6" style={{ fontSize: 28 }}>My {term.title}s</h2>
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
        <h2 className="page-title mb-1" style={{ fontSize: 28 }}>
          Saved jobs
        </h2>
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
          {quotes.length} saved job{quotes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Search and filter row */}
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

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 self-start">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`pill ${activeFilter === f ? 'active' : ''}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Empty filter/search state */}
      {filteredQuotes.length === 0 && (activeFilter !== 'All' || searchTerm.trim()) && (
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
                  <span className="fq:hidden"> \u00b7 {formatCurrency(quote.totalAmount)}</span>
                </div>
              </div>

              {/* Middle: amount (desktop) */}
              <div
                className="mx-4 shrink-0 hidden fq:block"
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}
              >
                {formatCurrency(quote.totalAmount)}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
                {status === 'DRAFT' && (
                  <button onClick={(e) => openStatusModal(e, quote.id, 'sent')} className="btn-primary text-xs" style={{ height: 36, padding: '0 16px' }}>
                    Mark Sent
                  </button>
                )}

                {status === 'SENT' && (
                  <>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'accepted')}
                      className="btn-ghost text-xs"
                      style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      {'\u2713'} Accepted
                    </button>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="btn-ghost text-xs"
                      style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'\u2717'} Declined
                    </button>
                  </>
                )}

                {status === 'ACCEPTED' && (
                  <>
                    {isAdminPlan && hasRams && onViewRams ? (
                      <button onClick={() => onViewRams(quote)} className="btn-ghost text-xs" style={{ height: 36, padding: '0 16px' }}>
                        View RAMS
                      </button>
                    ) : isAdminPlan && onCreateRams ? (
                      <button
                        onClick={() => onCreateRams(quote)}
                        className="btn-ghost text-xs"
                        style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
                      >
                        Create RAMS
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'completed')}
                      className="btn-ghost text-xs"
                      style={{ height: 36, padding: '0 16px', borderColor: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      Complete
                    </button>
                  </>
                )}

                {confirmDeleteId === quote.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(quote.id)}
                      className="btn-ghost text-xs"
                      style={{ height: 36, padding: '0 16px', backgroundColor: 'var(--tq-error-bg)', color: 'var(--tq-error-txt)', borderColor: 'var(--tq-error-bd)' }}
                    >
                      Confirm
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="btn-ghost text-xs" style={{ height: 36, padding: '0 16px' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDeleteId(quote.id)} className="btn-ghost text-xs" style={{ height: 36, padding: '0 16px', color: 'var(--tq-muted)' }}>
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
