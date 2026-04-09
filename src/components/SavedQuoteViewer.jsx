import React, { useState, useEffect } from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';
import { loadPhotos } from '../utils/userDB.js';

export default function SavedQuoteViewer({ quote, onBack, onEditQuote, currentUserId }) {
  const { snapshot } = quote;
  const [restoredPhotos, setRestoredPhotos] = useState(null);

  // Load photos from server on mount
  useEffect(() => {
    if (!currentUserId || !quote.id) return;
    loadPhotos(currentUserId, quote.id).then(({ photos, extraPhotos }) => {
      if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
        setRestoredPhotos({ photos, extraPhotos });
      }
    }).catch(() => {});
  }, [currentUserId, quote.id]);

  // Reconstruct the state shape that QuoteOutput expects
  const virtualState = {
    step: 5,
    profile: snapshot.profile,
    jobDetails: snapshot.jobDetails,
    photos: restoredPhotos ? { ...snapshot.photos, ...restoredPhotos.photos } : snapshot.photos,
    extraPhotos: restoredPhotos?.extraPhotos?.length ? restoredPhotos.extraPhotos : (snapshot.extraPhotos || []),
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
