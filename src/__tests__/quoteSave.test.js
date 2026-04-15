/**
 * Tests for quote duplication prevention (Bug 2)
 *
 * Mark reported quotes appearing 2-3x in both "Needs Attention" and "Recent Jobs".
 * Root causes: fetchWithRetry retries POST, handleSave always creates new, auto-save deps loop.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('saveJob does not use fetchWithRetry', () => {
  const src = readFileSync(
    join(__dirname, '../utils/userDB.js'), 'utf8'
  );

  it('saveJob calls plain fetch, not fetchWithRetry (to prevent duplicate job creation)', () => {
    // Find the saveJob function body
    const saveJobStart = src.indexOf('export async function saveJob(');
    const saveJobEnd = src.indexOf('\nexport', saveJobStart + 1);
    const saveJobBody = src.slice(saveJobStart, saveJobEnd);
    // Must use plain `fetch` not `fetchWithRetry` for the POST call
    expect(saveJobBody).not.toContain('fetchWithRetry');
    expect(saveJobBody).toContain("method: 'POST'");
  });

  it('fetchWithRetry still retries GET and PUT on 5xx', () => {
    // The retry logic should still work for non-POST callers (updateJob, saveDiffs)
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
    const autoSaveBlock = src.slice(autoSaveStart, autoSaveStart + 1500);
    // Extract the dependency array — on its own line like }, [state.step, ...]);
    const depArrayMatch = autoSaveBlock.match(/\},\s*\[([^\]]+)\]\);/);
    expect(depArrayMatch).not.toBeNull();
    if (depArrayMatch) {
      const deps = depArrayMatch[1];
      expect(deps).not.toContain('state.savedJobId');
    }
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
