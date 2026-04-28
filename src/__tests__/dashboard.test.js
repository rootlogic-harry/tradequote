/**
 * Tests for Dashboard Needs Attention section (Bug 3)
 *
 * Mark reported site address missing from "Needs Attention" cards.
 * Recent Jobs shows it but Needs Attention did not.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Dashboard Needs Attention shows site address', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('Needs Attention section references siteAddress', () => {
    const needsAttentionStart = src.indexOf('Needs Attention');
    const recentJobsStart = src.indexOf('RECENT JOBS');
    expect(needsAttentionStart).toBeGreaterThan(-1);
    expect(recentJobsStart).toBeGreaterThan(needsAttentionStart);

    const needsAttentionBlock = src.slice(needsAttentionStart, recentJobsStart);
    expect(needsAttentionBlock).toContain('siteAddress');
  });

  it('displays siteAddress with a fallback or conditional render', () => {
    const needsAttentionStart = src.indexOf('Needs Attention');
    const recentJobsStart = src.indexOf('RECENT JOBS');
    const block = src.slice(needsAttentionStart, recentJobsStart);

    const hasSiteAddressRender = (
      block.includes('job.siteAddress') &&
      (block.includes('&&') || block.includes('?'))
    );
    expect(hasSiteAddressRender).toBe(true);
  });
});

// TRQ-163: Paul saw an "Untitled" draft banner on the dashboard after
// his analysis errored — clientName had been reset to '' by a stray
// NEW_QUOTE while step stayed at 2. The banner used to render whenever
// step ∈ [2,4]; now it requires at least one of clientName/siteAddress
// to be non-blank so the dashboard doesn't surface phantom drafts.
describe('Dashboard currentDraft prop guards empty content', () => {
  const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');

  it('currentDraft requires clientName or siteAddress to be non-blank', () => {
    const idx = appSrc.indexOf('currentDraft={');
    expect(idx).toBeGreaterThan(-1);
    const block = appSrc.slice(idx, idx + 400);
    // Both fields appear in the guard, AND .trim() is used so a single
    // space doesn't qualify.
    expect(block).toMatch(/jobDetails\?\.\s*clientName\?\.\s*trim\(\)/);
    expect(block).toMatch(/jobDetails\?\.\s*siteAddress\?\.\s*trim\(\)/);
  });
});
