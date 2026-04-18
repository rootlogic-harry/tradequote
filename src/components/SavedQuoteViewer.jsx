import React, { useState, useEffect } from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';
import { loadPhotos } from '../utils/userDB.js';

export default function SavedQuoteViewer({ quote, onBack, onEditQuote, currentUserId }) {
  const snapshot = quote?.snapshot || {};
  const [restoredPhotos, setRestoredPhotos] = useState(null);

  // Load photos from server on mount
  useEffect(() => {
    if (!currentUserId || !quote?.id) return;
    loadPhotos(currentUserId, quote.id).then(({ photos, extraPhotos }) => {
      if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
        setRestoredPhotos({ photos, extraPhotos });
      }
    }).catch(() => {});
  }, [currentUserId, quote.id]);

  // Reconstruct the state shape that QuoteOutput expects
  // Note: photos are NOT in SAVE_ALLOWLIST, so snapshot.photos is always undefined.
  // Photos come exclusively from restoredPhotos (loaded from user_photos table).
  const virtualState = {
    step: 5,
    profile: snapshot.profile || {},
    jobDetails: snapshot.jobDetails || {},
    photos: restoredPhotos?.photos || {},
    extraPhotos: restoredPhotos?.extraPhotos?.length ? restoredPhotos.extraPhotos : (snapshot.extraPhotos || []),
    reviewData: snapshot.reviewData || null,
    diffs: snapshot.diffs || [],
    quotePayload: snapshot.quotePayload || null,
    quoteSequence: snapshot.quoteSequence,
    captureMode: snapshot.captureMode || null,
    transcript: snapshot.transcript || null,
    aiRawResponse: snapshot.aiRawResponse,
  };

  return (
    <div>
      {onEditQuote && (
        <div className="mb-4">
          <button
            onClick={() => onEditQuote(virtualState)}
            className="btn-primary"
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
