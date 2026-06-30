import React, { useState, useEffect } from 'react';
import QuoteOutput from './steps/QuoteOutput.jsx';
import EditDetailsModal from './EditDetailsModal.jsx';
import { loadPhotos, getProfile } from '../utils/userDB.js';

export default function SavedQuoteViewer({ quote, onBack, onEditQuote, currentUserId, liveProfile, showToast }) {
  const snapshot = quote?.snapshot || {};
  const [restoredPhotos, setRestoredPhotos] = useState(null);
  const [restoredLogo, setRestoredLogo] = useState(null);
  // Local overlay so the user sees their edits land without a Dashboard
  // round-trip. The PATCH result is the canonical post-edit jobDetails;
  // we merge it over the snapshot's read-only copy for display.
  const [editedDetails, setEditedDetails] = useState(null);
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);

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
  // TRQ-138: The tradesman's preview uses the LIVE profile (branding,
  // accent, documentType, logo, contact details) so updates apply
  // retroactively to every saved quote's preview. The client portal
  // (/q/:token) still reads client_snapshot_profile — that frozen
  // record is untouched. We fall back to the snapshot profile if the
  // live one isn't passed in (legacy caller or ad-hoc test).
  const baseProfile = liveProfile || snapshotProfile;
  const virtualState = {
    step: 5,
    profile: profileLogoIsStripped
      ? { ...baseProfile, logo: baseProfile.logo || restoredLogo || null }
      : baseProfile,
    jobDetails: editedDetails
      ? { ...(snapshot.jobDetails || {}), ...editedDetails }
      : (snapshot.jobDetails || {}),
    photos: restoredPhotos?.photos || {},
    extraPhotos: restoredPhotos?.extraPhotos?.length ? restoredPhotos.extraPhotos : (snapshot.extraPhotos || []),
    reviewData: snapshot.reviewData || null,
    diffs: snapshot.diffs || [],
    quotePayload: snapshot.quotePayload || null,
    quoteSequence: snapshot.quoteSequence,
    captureMode: snapshot.captureMode || null,
    transcript: snapshot.transcript || null,
    aiRawResponse: snapshot.aiRawResponse,
    // TRQ-137: carry the DB row id into the editor so Edit & Re-generate
    // → Save runs the PUT (update) branch instead of POSTing a brand
    // new row. Without this, every re-save of a saved quote creates a
    // duplicate jobs row — the bug Paul reported with five identical
    // QT-2026-0002 rows in his dashboard.
    savedJobId: quote.id,
    // TRQ-139: ClientLinkBlock uses state.currentUserId to hit the
    // owner-scoped /client-token + /client-status routes. Without it
    // on virtualState, a read-only saved-quote viewer can't reach
    // the portal management surface.
    currentUserId,
  };

  return (
    <div>
      {/* Two-button row (2026-06-30, Paul's request).
          - Edit details: metadata-only PATCH, no re-analyse. Safe.
          - Re-analyse and edit quote: the old "Edit & Re-generate"
            path, renamed for clarity. */}
      {(onEditQuote || currentUserId) && (
        <div
          className="mb-4 flex flex-col fq:flex-row gap-2"
          data-testid="saved-quote-action-row"
        >
          {currentUserId && (
            <button
              type="button"
              onClick={() => setEditDetailsOpen(true)}
              className="btn-primary w-full fq:w-auto"
              style={{ minHeight: 44, padding: '0 18px' }}
              data-testid="saved-quote-edit-details"
            >
              Edit details
            </button>
          )}
          {onEditQuote && (
            <button
              type="button"
              onClick={() => onEditQuote(virtualState)}
              className="btn-ghost w-full fq:w-auto"
              style={{ minHeight: 44, padding: '0 18px' }}
              data-testid="saved-quote-reanalyse"
            >
              Re-analyse and edit quote
            </button>
          )}
        </div>
      )}
      {/* Remount when restored photos arrive so QuoteOutput's photo-selection
          state initializer (`new Set(allPhotos.map(...))`) sees the loaded
          photos instead of an empty array. Without this, the initial render
          captures `allPhotos = []` and every photo stays de-selected (0/N). */}
      <QuoteOutput
        key={restoredPhotos
          ? `photos-${Object.keys(restoredPhotos.photos).length}-${restoredPhotos.extraPhotos.length}`
          : 'photos-pending'}
        state={virtualState}
        dispatch={() => {}}
        onBack={onBack}
        isReadOnly
      />
      <EditDetailsModal
        open={editDetailsOpen}
        onClose={() => setEditDetailsOpen(false)}
        userId={currentUserId}
        jobId={quote?.id}
        initialDetails={virtualState.jobDetails}
        hasClientToken={!!quote?.clientToken}
        onSaved={(nextDetails) => setEditedDetails(nextDetails)}
        showToast={showToast}
      />
    </div>
  );
}
