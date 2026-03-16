import React, { useState, useEffect } from 'react';
import { listJobs, deleteJob } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';

const FILTERS = ['All', 'Draft', 'Sent', 'Accepted', 'Declined'];

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

function daysUntilExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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

export default function SavedQuotes({ onViewQuote, onCreateRams, onViewRams, currentUserId, recentJobs = [], dispatch }) {
  const [localQuotes, setLocalQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeFilter, setActiveFilter] = useState('All');

  // Use recentJobs from reducer if available, otherwise fetch locally
  const quotes = recentJobs.length > 0 ? recentJobs : localQuotes;

  useEffect(() => {
    if (recentJobs.length > 0) {
      setLoading(false);
      return;
    }
    listJobs(currentUserId)
      .then(setLocalQuotes)
      .catch(err => console.error('Failed to load saved quotes:', err))
      .finally(() => setLoading(false));
  }, [currentUserId, recentJobs.length]);

  const handleDelete = async (id) => {
    try {
      await deleteJob(currentUserId, id);
      setLocalQuotes(prev => prev.filter(q => q.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  const getStatus = (job) => (job.status || 'draft').toUpperCase();

  const filteredQuotes = activeFilter === 'All'
    ? quotes
    : quotes.filter(q => getStatus(q) === activeFilter.toUpperCase());

  const openStatusModal = (e, jobId, targetStatus) => {
    e.stopPropagation();
    if (dispatch) dispatch({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  if (loading) {
    return (
      <div className="text-center py-20" style={{ color: 'var(--tq-muted)' }}>
        Loading saved jobs...
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

      {/* Filter tabs */}
      <div
        className="inline-flex rounded-lg overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)' }}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className="px-4 py-2 text-xs font-heading font-bold uppercase tracking-wide transition-colors"
            style={{
              backgroundColor: activeFilter === f ? 'var(--tq-surface)' : 'transparent',
              color: activeFilter === f ? 'var(--tq-text)' : 'var(--tq-muted)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Job rows */}
      <div className="space-y-2">
        {filteredQuotes.map(quote => {
          const hasRams = quote.hasRams || !!quote.ramsSnapshot;
          const status = getStatus(quote);
          const borderLeft = status === 'ACCEPTED'
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
                  {status === 'SENT' && <ExpiryBadge expiresAt={quote.expiresAt} />}
                  {status === 'ACCEPTED' && <RamsBadge hasRams={hasRams} />}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                  {quote.quoteReference}
                  {quote.siteAddress ? ` \u00b7 ${quote.siteAddress}` : ''}
                  {quote.quoteDate ? ` \u00b7 ${formatDate(quote.quoteDate)}` : ''}
                </div>
              </div>

              {/* Middle: amount */}
              <div
                className="mx-4 shrink-0 hidden sm:block"
                style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 500, color: 'var(--tq-text)' }}
              >
                {formatCurrency(quote.totalAmount)}
              </div>

              {/* Right: action buttons */}
              <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => onViewQuote(quote)}
                  className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                  style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-text)' }}
                >
                  View
                </button>

                {status === 'DRAFT' && (
                  <button
                    onClick={(e) => openStatusModal(e, quote.id, 'sent')}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                    style={{ backgroundColor: 'var(--tq-accent)', color: '#ffffff' }}
                  >
                    Mark Sent
                  </button>
                )}

                {status === 'SENT' && (
                  <>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'accepted')}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                      style={{ border: '1.5px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      {'\u2713'} Accepted
                    </button>
                    <button
                      onClick={(e) => openStatusModal(e, quote.id, 'declined')}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                      style={{ border: '1.5px solid var(--tq-error-bd)', color: 'var(--tq-error-txt)' }}
                    >
                      {'\u2717'} Declined
                    </button>
                  </>
                )}

                {status === 'ACCEPTED' && (
                  hasRams && onViewRams ? (
                    <button
                      onClick={() => onViewRams(quote)}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                      style={{ border: '1px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                    >
                      View RAMS
                    </button>
                  ) : onCreateRams ? (
                    <button
                      onClick={() => onCreateRams(quote)}
                      className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                      style={{ border: '1px solid var(--tq-accent)', color: 'var(--tq-accent)' }}
                    >
                      Create RAMS
                    </button>
                  ) : null
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
