/**
 * Build the QuoteDocument state for a client-link PDF from the frozen
 * snapshot. Photos are not stored in the snapshot (they are stripped
 * on save), so the caller passes the job's photo rows. A logo that
 * was stored as the `[photo-stripped]` marker is filled from the
 * tradesman's current profile logo when the caller supplies one.
 */

const STRIPPED = '[photo-stripped]';

function usableImage(value) {
  return typeof value === 'string' && value.length > 5 && value !== STRIPPED;
}

export function buildPortalQuoteState({ snapshot, profile, photoRows, liveLogo } = {}) {
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const frozenProfile = profile && typeof profile === 'object' ? profile : {};
  const snapProfile = snap.profile && typeof snap.profile === 'object' ? snap.profile : {};
  const merged = { ...snapProfile, ...frozenProfile };
  const logo = usableImage(merged.logo)
    ? merged.logo
    : (usableImage(liveLogo) ? liveLogo : null);

  const photos = {};
  const extraPhotos = [];
  for (const row of photoRows || []) {
    if (!row?.data) continue;
    const slot = String(row.slot || '');
    if (slot.startsWith('extra-')) {
      extraPhotos.push({
        data: row.data,
        label: row.label || 'Site photo',
        name: row.name || '',
      });
    } else if (slot) {
      photos[slot] = { data: row.data, name: row.name || '', label: row.label || '' };
    }
  }

  return {
    profile: { ...merged, logo },
    jobDetails: snap.jobDetails || {},
    reviewData: snap.reviewData || {},
    photos,
    extraPhotos,
    quoteMode: snap.quoteMode || 'standard',
    captureMode: snap.captureMode || null,
  };
}
