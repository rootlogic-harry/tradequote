/**
 * Quote-save deduplication + savedJobId preservation (TRQ-137).
 *
 * Paul hit a duplication bug where editing then re-saving a saved quote
 * inserted a fresh `jobs` row every time instead of updating the
 * existing one. Two layers of defence kill it:
 *
 *   1. CLIENT — SavedQuoteViewer's virtualState MUST carry savedJobId
 *      so QuoteOutput's handleSave picks the PUT branch.
 *   2. REDUCER — RESTORE_DRAFT explicitly preserves savedJobId.
 *   3. SERVER — widen the dedup window from 30s to 10 minutes so that
 *      even if a bug ever lets a stale POST through, the server
 *      returns the existing id instead of inserting a duplicate row.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('SavedQuoteViewer.virtualState — carries savedJobId into the editor', () => {
  const src = readFileSync(join(repoRoot, 'src/components/SavedQuoteViewer.jsx'), 'utf8');

  test('virtualState sets savedJobId: quote.id', () => {
    // Without this, RESTORE_DRAFT → state.savedJobId stays null and
    // handleSave in QuoteOutput takes the POST (create) branch instead
    // of the PUT (update) branch — one duplicate row per save.
    expect(src).toMatch(/savedJobId\s*:\s*quote\.id/);
  });
});

describe('reducer — RESTORE_DRAFT explicitly preserves savedJobId', () => {
  test('draft with savedJobId sets state.savedJobId to that value', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const state = { ...initialState, savedJobId: null };
    const next = reducer(state, {
      type: 'RESTORE_DRAFT',
      draft: { step: 4, savedJobId: 'job-abc-123', jobDetails: { clientName: 'X' } },
    });
    expect(next.savedJobId).toBe('job-abc-123');
  });

  test('draft without savedJobId leaves existing value intact (defensive)', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const state = { ...initialState, savedJobId: 'existing-id' };
    const next = reducer(state, {
      type: 'RESTORE_DRAFT',
      draft: { step: 4, jobDetails: { clientName: 'X' } },
    });
    // If the draft has no savedJobId, don't clear what we already had —
    // that would let a pending save fall back to POST.
    expect(next.savedJobId).toBe('existing-id');
  });
});

describe('server — POST /jobs dedup prefers UPDATE on matching ref within window', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
  const postBlock = serverSrc.match(
    /app\.post\(\s*['"`]\/api\/users\/:id\/jobs['"`][\s\S]*?\n\}\)/
  );

  test('dedup window is widened to at least 10 minutes (TRQ-137)', () => {
    expect(postBlock).not.toBeNull();
    // 30s was too short for Paul's real-world cadence — moved to
    // 10 minutes which still stops rapid double-submit but catches
    // a slower edit-regenerate-save cycle.
    expect(postBlock[0]).toMatch(/INTERVAL\s*['"]\s*10\s*minutes?\s*['"]/i);
    expect(postBlock[0]).not.toMatch(/INTERVAL\s*['"]\s*30\s*seconds?\s*['"]/i);
  });

  test('dedup returns the existing id instead of inserting a duplicate', () => {
    expect(postBlock[0]).toMatch(/quote_reference\s*=\s*\$2/);
    // The route's dedup branch must early-return with the existing id
    // (so the client gets the same id back and switches to PUT on the
    // next save, closing the loop).
    expect(postBlock[0]).toMatch(/return\s+res\.json\(\s*\{[^}]*id/);
  });
});
