/**
 * SavedQuoteViewer uses live profile for tradesman's own view (TRQ-138).
 *
 * Frozen snapshot contract still holds for the client portal (/q/:token
 * reads `client_snapshot_profile`). But the TRADESMAN re-opening their
 * own saved quote wants to see their current brand — accent, document
 * type, logo, company name — so profile changes apply immediately to
 * every saved quote's preview.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('SavedQuoteViewer — live profile for tradesman preview', () => {
  const src = readFileSync(join(repoRoot, 'src/components/SavedQuoteViewer.jsx'), 'utf8');

  test('accepts a liveProfile prop', () => {
    // App.jsx passes state.profile so the viewer can render with the
    // tradesman's current branding.
    expect(src).toMatch(/function\s+SavedQuoteViewer\s*\([\s\S]*?liveProfile[\s\S]*?\)/);
  });

  test('virtualState.profile is sourced from liveProfile (fallback to snapshot)', () => {
    // Either the virtualState block itself references liveProfile, or
    // a helper ("baseProfile" or similar) immediately above it does.
    // The full file must show liveProfile taking priority over
    // snapshotProfile.
    expect(src).toMatch(/liveProfile\s*\|\|\s*snapshotProfile/);
  });
});

describe('App.jsx — passes state.profile into SavedQuoteViewer', () => {
  const src = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

  test('SavedQuoteViewer render includes liveProfile={state.profile}', () => {
    expect(src).toMatch(/<SavedQuoteViewer[\s\S]*?liveProfile\s*=\s*\{state\.profile\}/);
  });
});

describe('portalRenderer — still reads snapshot (customer-facing frozen contract)', () => {
  const src = readFileSync(join(repoRoot, 'portalRenderer.js'), 'utf8');

  test('renderClientPortal uses client_snapshot_profile', () => {
    // Confirm the portal hasn't accidentally switched to a live profile
    // — the client must always see the version that was sent to them.
    expect(src).toMatch(/client_snapshot_profile/);
  });
});
