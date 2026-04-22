/**
 * Tests for SavedQuoteViewer crash resilience (Bug 1)
 *
 * Mark reported "Something went wrong" when viewing most past quotes.
 * Root cause: null/undefined snapshot and photos crashing on destructure.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SavedQuoteViewer crash resilience', () => {
  const src = readFileSync(
    join(__dirname, '../components/SavedQuoteViewer.jsx'), 'utf8'
  );

  it('handles null/undefined snapshot without crashing (uses optional chaining or fallback)', () => {
    // The destructure `const { snapshot } = quote` crashes if quote.snapshot is undefined
    // and then snapshot.profile is accessed. Must use safe access.
    const hasNullSafe = (
      src.includes('quote?.snapshot') ||
      src.includes('snapshot || {}') ||
      src.includes("snapshot || {}")
    );
    expect(hasNullSafe).toBe(true);
  });

  it('defaults photos to empty object when snapshot.photos is undefined', () => {
    // snapshot.photos is always undefined (not in SAVE_ALLOWLIST)
    // virtualState.photos must not be `undefined` — that crashes QuoteOutput
    // The photos line in virtualState must have a fallback
    expect(
      src.includes('?? {}') ||
      src.includes('|| {}') ||
      // Or it builds photos purely from restoredPhotos without snapshot.photos
      (src.includes('restoredPhotos') && !src.includes('snapshot.photos'))
    ).toBe(true);
  });

  // buildSaveSnapshot replaces profile.logo with "[photo-stripped]" to keep the
  // saved snapshot lean. Previously the viewer passed that string straight to
  // <img src> which rendered a broken-image icon with alt="Logo".
  it('rehydrates the logo from the live profile when the snapshot has [photo-stripped]', () => {
    expect(src).toMatch(/getProfile/);
    expect(src).toMatch(/\[photo-stripped\]/);
  });

  it('falls back to null (not [photo-stripped]) when no logo is available', () => {
    // The virtualState.profile.logo must end in `|| null` so the
    // <img> guard `{profile.logo && ...}` doesn't render a broken
    // image when the live logo isn't loaded yet. TRQ-138 threaded the
    // live profile through here so the chain is now
    // baseProfile.logo || restoredLogo || null — the terminal null
    // is the safety net.
    expect(src).toMatch(/logo:[^,\n]*\|\|\s*null/);
  });

  // QuoteOutput's `selectedPhotoIndices` state initializes once via `new Set(allPhotos.map(...))`.
  // If photos arrive async (SavedQuoteViewer → loadPhotos useEffect), the initializer
  // already ran with an empty `allPhotos`, so every photo stays de-selected (0/N).
  // The fix keys QuoteOutput on the loaded photo count so React remounts it once
  // photos arrive, letting the initializer see the real count.
  it('remounts QuoteOutput via a key once restoredPhotos arrive, so photo selection is correct', () => {
    expect(src).toMatch(/key=\{restoredPhotos/);
    expect(src).toMatch(/photos-pending/);
  });
});

describe('QuoteOutput photos safety', () => {
  const src = readFileSync(
    join(__dirname, '../components/steps/QuoteOutput.jsx'), 'utf8'
  );

  it('defaults photos in destructuring to prevent crash on undefined', () => {
    // `const { photos } = state` with photos.overview crashes when photos is undefined
    // Must have `photos = {}` default in destructuring
    expect(src).toMatch(/photos\s*=\s*\{\}/);
  });

  it('does not crash when photos is an empty object (photo slot access is guarded)', () => {
    // All photo slot access (photos.overview, photos.closeup, etc.) must be guarded
    // with `if (photos.overview)` not `photos.overview.data` unguarded
    const lines = src.split('\n');
    const photoAccessLines = lines.filter(l =>
      (l.includes('photos.overview') ||
       l.includes('photos.closeup') ||
       l.includes('photos.sideProfile') ||
       l.includes('photos.referenceCard') ||
       l.includes('photos.access')) &&
      !l.trim().startsWith('//') &&
      !l.trim().startsWith('*')
    );
    // Each should be inside an if() guard or use optional chaining
    for (const line of photoAccessLines) {
      const isGuarded = (
        line.trim().startsWith('if (') ||
        line.includes('?.') ||
        line.includes('&& ')
      );
      expect(isGuarded).toBe(true);
    }
  });
});
