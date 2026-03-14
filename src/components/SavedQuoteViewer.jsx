import React from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';

export default function SavedQuoteViewer({ quote, onBack }) {
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
    <QuoteOutput
      state={virtualState}
      dispatch={() => {}}
      onBack={onBack}
      isReadOnly
    />
  );
}
