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
