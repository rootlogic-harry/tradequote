import React from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';

export default function SavedQuoteViewer({ quote, onBack, onEditQuote }) {
  const { snapshot } = quote;

  // Reconstruct the state shape that QuoteOutput expects
  const virtualState = {
    step: 5,
    profile: snapshot.profile,
    jobDetails: snapshot.jobDetails,
    photos: snapshot.photos,
    extraPhotos: snapshot.extraPhotos || [],
    reviewData: snapshot.reviewData,
    diffs: snapshot.diffs || [],
    quotePayload: snapshot.quotePayload,
    quoteSequence: snapshot.quoteSequence,
    aiRawResponse: snapshot.aiRawResponse,
  };

  return (
    <div>
      {onEditQuote && (
        <div className="mb-4">
          <button
            onClick={() => onEditQuote(virtualState)}
            className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
          >
            Edit &amp; Re-generate
          </button>
        </div>
      )}
      <QuoteOutput
        state={virtualState}
        dispatch={() => {}}
        onBack={onBack}
        isReadOnly
      />
    </div>
  );
}
