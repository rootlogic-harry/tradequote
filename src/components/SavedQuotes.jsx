import React, { useState, useEffect } from 'react';
import { listJobs, deleteJob } from '../utils/userDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';

const FILTERS = ['All', 'Sent', 'Accepted', 'Draft'];

function StatusBadge({ status }) {
  const styles = {
    SENT: { bg: 'var(--tq-status-sent)', color: 'var(--tq-status-sent-txt)' },
    ACCEPTED: { bg: 'var(--tq-status-acc)', color: 'var(--tq-status-acc-txt)' },
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

export default function SavedQuotes({ onViewQuote, onCreateRams, onViewRams, currentUserId }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeFilter, setActiveFilter] = useState('All');

  useEffect(() => {
    listJobs(currentUserId)
      .then(setQuotes)
      .catch(err => console.error('Failed to load saved quotes:', err))
      .finally(() => setLoading(false));
  }, [currentUserId]);

  const handleDelete = async (id) => {
    try {
      await deleteJob(currentUserId, id);
      setQuotes(prev => prev.filter(q => q.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  // All jobs are "DRAFT" since no status field exists yet
  const getStatus = () => 'DRAFT';

  const filteredQuotes = activeFilter === 'All'
    ? quotes
    : quotes.filter(() => getStatus().toLowerCase() === activeFilter.toLowerCase());

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
          const status = getStatus();

          return (
            <div
              key={quote.id}
              className="flex items-center rounded-lg transition-colors"
              style={{
                backgroundColor: status === 'DRAFT' ? 'var(--tq-card)' : 'var(--tq-card)',
                border: status === 'ACCEPTED' ? '1.5px solid var(--tq-confirmed-bd)' : '1px solid var(--tq-border)',
                borderRadius: 10,
                padding: '16px 20px',
                opacity: status === 'DRAFT' ? 0.9 : 1,
              }}
            >
              {/* Left: name, status, metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--tq-text)' }}>
                    {quote.clientName || 'Unnamed client'}
                  </span>
                  <StatusBadge status={status} />
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--tq-muted)' }}>
                  {quote.quoteReference}
                  {quote.siteAddress ? ` · ${quote.siteAddress}` : ''}
                  {quote.quoteDate ? ` · ${formatDate(quote.quoteDate)}` : ''}
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
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onViewQuote(quote)}
                  className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                  style={{ border: '1px solid var(--tq-border)', color: 'var(--tq-text)' }}
                >
                  View
                </button>
                {hasRams && onViewRams ? (
                  <button
                    onClick={() => onViewRams(quote)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                    style={{ border: '1px solid var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' }}
                  >
                    RAMS
                  </button>
                ) : onCreateRams ? (
                  <button
                    onClick={() => onCreateRams(quote)}
                    className="font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors hidden sm:inline-block"
                    style={{ border: '1px solid var(--tq-accent)', color: 'var(--tq-accent)' }}
                  >
                    RAMS
                  </button>
                ) : null}
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
