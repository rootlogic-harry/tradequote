/**
 * Tests for quote duplication prevention (Bug 2) and Step-5 save retry
 * (TRQ-165).
 *
 * Original bug: Mark reported quotes appearing 2-3x. Root cause was that
 * fetchWithRetry was retrying POST /jobs without server-side dedup, so a
 * 5xx-then-success retry pattern created duplicate rows. Fix at the time
 * was to revert saveJob to plain `fetch` (no retry).
 *
 * That left a different bug: a single transient 5xx during the Step-5
 * save burned the only attempt and the user saw "Save failed". TRQ-137
 * added a 10-minute (user_id, quote_reference) dedup window on the
 * POST route, which makes retry safe — a duplicate POST returns the
 * existing id rather than creating a new row. So saveJob is now back
 * on fetchWithRetry, defended by BOTH the dedup window AND this test
 * that asserts the dedup window is still in place.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('saveJob retries on transient errors (relies on server dedup)', () => {
  const src = readFileSync(
    join(__dirname, '../utils/userDB.js'), 'utf8'
  );

  it('saveJob calls fetchWithRetry (safe because of server-side dedup window)', () => {
    const saveJobStart = src.indexOf('export async function saveJob(');
    const saveJobEnd = src.indexOf('\nexport', saveJobStart + 1);
    const saveJobBody = src.slice(saveJobStart, saveJobEnd);
    expect(saveJobBody).toContain('fetchWithRetry');
    expect(saveJobBody).toContain("method: 'POST'");
  });

  it('fetchWithRetry retries up to 3 times on 5xx', () => {
    expect(src).toMatch(/maxRetries\s*=\s*3/);
  });
});

describe('QuoteOutput manual save uses updateJob when job exists', () => {
  const src = readFileSync(
    join(__dirname, '../components/steps/QuoteOutput.jsx'), 'utf8'
  );

  it('imports updateJob from userDB', () => {
    expect(src).toMatch(/import\s*\{[^}]*updateJob/);
  });

  it('handleSave checks for existing savedJobId before choosing save vs update', () => {
    // handleSave should check savedJobId and call updateJob for existing jobs
    const handleSaveStart = src.indexOf('handleSave');
    const handleSaveBlock = src.slice(handleSaveStart, handleSaveStart + 800);
    const checksJobId = (
      handleSaveBlock.includes('savedJobId') ||
      handleSaveBlock.includes('state.savedJobId')
    );
    expect(checksJobId).toBe(true);
  });
});

describe('auto-save dependency array safety', () => {
  const src = readFileSync(
    join(__dirname, '../App.jsx'), 'utf8'
  );

  it('auto-save effect dependency array does not include savedJobId', () => {
    // Find the auto-save useEffect
    const autoSaveStart = src.indexOf('Auto-save job + diffs');
    expect(autoSaveStart).toBeGreaterThan(-1);
    const autoSaveBlock = src.slice(autoSaveStart, autoSaveStart + 2500);
    // Extract the dependency array — on its own line like }, [state.step, ...]);
    const depArrayMatch = autoSaveBlock.match(/\},\s*\[([^\]]+)\]\);/);
    expect(depArrayMatch).not.toBeNull();
    if (depArrayMatch) {
      const deps = depArrayMatch[1];
      expect(deps).not.toContain('state.savedJobId');
    }
  });
});

describe('draft is not cleared until Step-5 save succeeds (TRQ-165)', () => {
  const src = readFileSync(
    join(__dirname, '../App.jsx'), 'utf8'
  );

  it('clearDraft is gated on savedJobId at Step 5, not just step transition', () => {
    // Find the autosave-draft useEffect (the one with the 5s debounce
    // and clearDraft) and confirm Step-5 clearDraft requires savedJobId.
    const start = src.indexOf('Auto-save draft');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('// Auto-save job + diffs', start);
    const block = src.slice(start, end);

    // Step 5 must require savedJobId before clearing.
    expect(block).toMatch(/state\.step === 5\s*&&\s*state\.savedJobId/);
    // Step < 2 still clears (out of editing path is fine to drop).
    expect(block).toMatch(/state\.step\s*<\s*2/);
    // Crucially: NO bare "step > 4" branch that clears unconditionally.
    expect(block).not.toMatch(/state\.step\s*>\s*4[^&]*\n[\s\S]{0,200}clearDraft/);
  });
});

describe('server-side job dedup', () => {
  const serverSrc = readFileSync(
    join(__dirname, '../../server.js'), 'utf8'
  );

  it('POST /api/users/:id/jobs checks for recent duplicate before INSERT', () => {
    const jobPostStart = serverSrc.indexOf("app.post('/api/users/:id/jobs'");
    expect(jobPostStart).toBeGreaterThan(-1);
    const jobPostBlock = serverSrc.slice(jobPostStart, jobPostStart + 1500);
    const hasDedup = (
      jobPostBlock.includes('quote_reference') &&
      (jobPostBlock.includes('30') || jobPostBlock.includes('dedup') || jobPostBlock.includes('existing'))
    );
    expect(hasDedup).toBe(true);
  });
});
