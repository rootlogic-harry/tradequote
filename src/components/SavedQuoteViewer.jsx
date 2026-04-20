import React, { useState, useEffect } from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';
import { loadPhotos, getProfile } from '../utils/userDB.js';

export default function SavedQuoteViewer({ quote, onBack, onEditQuote, currentUserId }) {
  const snapshot = quote?.snapshot || {};
  const [restoredPhotos, setRestoredPhotos] = useState(null);
  const [restoredLogo, setRestoredLogo] = useState(null);

  // Load photos from server on mount
  useEffect(() => {
    if (!currentUserId || !quote?.id) return;
    loadPhotos(currentUserId, quote.id).then(({ photos, extraPhotos }) => {
      if (Object.keys(photos).length > 0 || extraPhotos.length > 0) {
        setRestoredPhotos({ photos, extraPhotos });
      }
    }).catch(() => {});
  }, [currentUserId, quote.id]);

  // Rehydrate the user's logo from their live profile. buildSaveSnapshot replaces
  // profile.logo with the string "[photo-stripped]" to keep snapshots lean, which
  // otherwise renders as a broken <img> when the saved quote is re-opened.
  useEffect(() => {
    if (!currentUserId) return;
    const snapshotLogo = snapshot.profile?.logo;
    const stripped = !snapshotLogo || snapshotLogo === '[photo-stripped]';
    if (!stripped) return;
    getProfile(currentUserId).then((p) => {
      if (p?.logo) setRestoredLogo(p.logo);
    }).catch(() => {});
  }, [currentUserId, snapshot.profile?.logo]);

  // Reconstruct the state shape that QuoteOutput expects
  // Note: photos are NOT in SAVE_ALLOWLIST, so snapshot.photos is always undefined.
  // Photos come exclusively from restoredPhotos (loaded from user_photos table).
  const snapshotProfile = snapshot.profile || {};
  const profileLogoIsStripped =
    !snapshotProfile.logo || snapshotProfile.logo === '[photo-stripped]';
  const virtualState = {
    step: 5,
    profile: profileLogoIsStripped
      ? { ...snapshotProfile, logo: restoredLogo || null }
      : snapshotProfile,
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
