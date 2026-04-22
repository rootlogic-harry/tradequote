/**
 * Client Portal access on the saved-quote view (TRQ-139).
 *
 * Paul asked to be able to grab the portal link from an already-saved
 * quote without having to click Edit & Re-generate. ClientLinkBlock's
 * actions (Copy + Regenerate) are owner-scoped and safe to expose on
 * the read-only viewer.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('QuoteOutput — ClientLinkBlock is visible in read-only mode too', () => {
  const src = readFileSync(join(repoRoot, 'src/components/steps/QuoteOutput.jsx'), 'utf8');

  test('ClientLinkBlock is rendered when the quote has a savedJobId, regardless of isReadOnly', () => {
    // The old gate was `!isReadOnly && savedJobId`. New gate is just
    // `savedJobId` — portal management (view/copy/regenerate) is safe
    // in both read-only and editable modes.
    const block = src.match(/<ClientLinkBlock[\s\S]*?\/>/);
    expect(block).not.toBeNull();
    // Verify the wrapping conditional doesn't require !isReadOnly.
    const context = src.match(/\{[^{}]{0,80}<ClientLinkBlock/);
    expect(context).not.toBeNull();
    expect(context[0]).not.toMatch(/!isReadOnly\s*&&/);
  });
});

describe('SavedQuoteViewer — virtualState passes currentUserId for portal calls', () => {
  const src = readFileSync(join(repoRoot, 'src/components/SavedQuoteViewer.jsx'), 'utf8');

  test('virtualState carries currentUserId so ClientLinkBlock can reach the owner-scoped endpoints', () => {
    // ClientLinkBlock reads state.currentUserId to POST /client-token
    // and GET /client-status. Without it on virtualState, the calls
    // fail silently with a 401 from the owner middleware.
    const block = src.match(/virtualState\s*=\s*\{[\s\S]*?\};/);
    expect(block).not.toBeNull();
    // Accept either the shorthand `currentUserId,` or the explicit
    // `currentUserId: currentUserId,`.
    expect(block[0]).toMatch(/(^|[\s,{])currentUserId\s*[:,}]/m);
  });
});
