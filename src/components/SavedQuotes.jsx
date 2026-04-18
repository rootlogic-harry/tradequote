import React, { useState, useEffect } from 'react';
import { listJobs, deleteJob, deletePhotos } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';
import { StatusBadge, ExpiryBadge, RamsBadge, VideoBadge } from './badges.jsx';

const FILTERS = ['All', 'Draft', 'Sent', 'Accepted', 'Completed', 'Declined'];

export default function SavedQuotes({ onViewQuote, onCreateRams, onViewRams, currentUserId, recentJobs = [], dispatch, isAdminPlan = false, showToast }) {
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
          className="bg-tq-accent text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4 opacity-30">&#128193;</div>
        <h2 className="text-xl font-heading font-bold mb-2" style={{ color: 'var(--tq-text)' }}>No saved jobs yet</h2>
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
          Generate a quote and click "Save Quote" to store it here for later.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h2
          className="mb-1"
          style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 28, color: 'var(--tq-text)' }}
        >
          Saved jobs
        </h2>
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
          {quotes.length} saved job{quotes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Search and filter row */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 sm:max-w-xs">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by client, reference, or address..."
            className="w-full rounded-lg px-4 py-2 pl-9 text-sm"
            style={{
              backgroundColor: 'var(--tq-card)',
              border: '1px solid var(--tq-border)',
              color: 'var(--tq-text)',
              fontFamily: 'IBM Plex Sans, sans-serif',
              minHeight: 40,
            }}
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

        {/* Filter tabs */}
        <div
          className="flex flex-wrap rounded-lg overflow-hidden self-start"
          style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)' }}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className="px-4 py-3 text-xs font-heading font-bold uppercase tracking-wide transition-colors whitespace-nowrap"
              style={{
                backgroundColor: activeFilter === f ? 'var(--tq-surface)' : 'transparent',
                color: activeFilter === f ? 'var(--tq-text)' : 'var(--tq-muted)',
                minHeight: 44,
              }}
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
              className="flex items-center rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--tq-card)',
                border: '1px solid var(--tq-border)',
                borderLeft,
                borderRadius: 10,
                padding: '16px 20px',
                cursor: 'pointer',
              }}
              onClick={() => onViewQuote(quote)}
            >
              {/* Left: name, status, metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--tq-text)' }}>
                    {quote.clientName || 'Unnamed client'}
                  </span>
                  <StatusBadge status={status} />
                  <VideoBadge captureMode={quote.snapshot?.captureMode} />
                  {status === 'SENT' && <ExpiryBadge expiresAt={quote.expiresAt} />}
                  {status === 'ACCEPTED' && <RamsBadge hasRams={hasRams} />}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                  {quote.quoteReference}
                  {quote.siteAddress ? ` \u00b7 ${quote.siteAddress}` : ''}
                  {quote.quoteDate ? ` \u00b7 ${formatDate(quote.quoteDate)}` : ''}
                  <span className="sm:hidden"> \u00b7 {formatCurrency(quote.totalAmount)}</span>
                </div>
              </div>

              {/* Middle: amount (desktop) */}
              <div
                className="mx-4 shrink-0 hidden sm:block"
                style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 500, color: 'var(--tq-text)' }}
              >
                {formatCurrency(quote.totalAmount)}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
                {status === 'DRAFT' && (
                  <button
                    onClick={(e) => openStatusModal(e, quote.id, 'sent')}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                    style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
                  >
                    Mark Sent
                  </button>
                )}

                {status === 'SENT' && (
                  <>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'accepted')}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                      style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      {'\u2713'} Accepted
                    </button>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                      style={{ border: '1.5px solid var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'\u2717'} Declined
                    </button>
                  </>
                )}

                {status === 'ACCEPTED' && (
                  <>
                    {isAdminPlan && hasRams && onViewRams ? (
                      <button
                        onClick={() => onViewRams(quote)}
                        className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                        style={{ border: '1px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                      >
                        View RAMS
                      </button>
                    ) : isAdminPlan && onCreateRams ? (
                      <button
                        onClick={() => onCreateRams(quote)}
                        className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                        style={{ border: '1px solid var(--tq-accent)', color: 'var(--tq-accent)' }}
                      >
                        Create RAMS
                      </button>
                    ) : null}
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'completed')}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                      style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      Complete
                    </button>
                  </>
                )}

                {confirmDeleteId === quote.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(quote.id)}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                      style={{ backgroundColor: 'var(--tq-error-bg)', color: 'var(--tq-error-txt)', border: '1px solid var(--tq-error-bd)' }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                      style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-muted)' }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(quote.id)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                    style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-muted)' }}
                  >
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
