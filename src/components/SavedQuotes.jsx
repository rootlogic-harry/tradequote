import React, { useState, useEffect } from 'react';
import { listSavedQuotes, deleteSavedQuote } from '../utils/savedQuotesDB.js';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';

export default function SavedQuotes({ onViewQuote }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    listSavedQuotes()
      .then(setQuotes)
      .catch(err => console.error('Failed to load saved quotes:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id) => {
    try {
      await deleteSavedQuote(id);
      setQuotes(prev => prev.filter(q => q.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete quote:', err);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-20 text-tq-muted">
        Loading saved quotes...
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4 opacity-30">&#128193;</div>
        <h2 className="text-xl font-heading font-bold text-tq-text mb-2">No saved quotes yet</h2>
        <p className="text-tq-muted text-sm">
          Generate a quote and click "Save Quote" to store it here for later.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        Saved Quotes
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        {quotes.length} saved quote{quotes.length !== 1 ? 's' : ''}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quotes.map(quote => (
          <div
            key={quote.id}
            className="bg-tq-surface border border-tq-border rounded-lg p-4 flex flex-col"
          >
            <div className="font-mono text-tq-accent font-bold text-sm mb-1">
              {quote.quoteReference}
            </div>
            <div className="font-heading font-bold text-tq-text mb-0.5">
              {quote.clientName || 'Unnamed client'}
            </div>
            <div className="text-tq-muted text-sm mb-2 truncate">
              {quote.siteAddress || 'No address'}
            </div>
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="text-tq-muted">
                {quote.quoteDate ? formatDate(quote.quoteDate) : '—'}
              </span>
              <span className="font-mono font-bold text-tq-text">
                {formatCurrency(quote.totalAmount)}
              </span>
            </div>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => onViewQuote(quote)}
                className="flex-1 bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
              >
                View
              </button>
              {confirmDeleteId === quote.id ? (
                <>
                  <button
                    onClick={() => handleDelete(quote.id)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="border border-tq-border text-tq-muted hover:text-tq-text font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(quote.id)}
                  className="border border-tq-border text-tq-muted hover:text-red-400 font-heading font-bold uppercase tracking-wide text-xs px-3 py-2 rounded transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
