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

// Mark's ask (2026-06-21 WhatsApp): "What about an archive option?"
// Only declined quotes move out of the main jobs list — Mark's
// follow-up feedback was that expired sends must stay active because
// customers regularly authorise walling jobs months after expiry.
// Source-level checks — full DOM rendering of Dashboard isn't part
// of the test stack (node env, no JSDOM).
describe('Dashboard active/archive tab UI', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('imports the jobLifecycle helpers', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/utils\/jobLifecycle\.js['"]/);
    expect(src).toContain('isActiveJob');
    expect(src).toContain('isArchivedJob');
  });

  it('accepts a viewMode prop with a fail-safe default of "active"', () => {
    // Default must be 'active' so a parent that forgets the prop still
    // renders the main list, not an empty archive view.
    expect(src).toMatch(/viewMode\s*=\s*['"]active['"]/);
  });

  it('renders both Active and Archive tab buttons', () => {
    // Tab labels exist as literal JSX text
    expect(src).toMatch(/>\s*Active\s*</);
    expect(src).toMatch(/>\s*Archive/);
  });

  it('dispatches SET_VIEW_MODE on tab click', () => {
    expect(src).toMatch(/SET_VIEW_MODE.*active/);
    expect(src).toMatch(/SET_VIEW_MODE.*archive/);
  });

  it('hides per-status action buttons in archive view', () => {
    // The action-button block is wrapped in `!isArchiveView && (...)`
    // so archive rows are read-only-ish.
    expect(src).toMatch(/!isArchiveView\s*&&\s*\(/);
  });

  it('count badge is omitted when archive is empty (no "(0)")', () => {
    // Guard pattern: only render the parenthesised count when > 0
    expect(src).toMatch(/archiveCount\s*>\s*0/);
  });

  it('row layout is unchanged in archive view (no new row component)', () => {
    // The same job-row markup renders both buckets — we only filter the
    // list and hide the action buttons. No second renderer.
    const rowMatches = src.match(/className="job-row[^"]*"/g) || [];
    // Dashboard has a follow-up row + the recent-jobs row. Adding a
    // separate archive row would push this above 3.
    expect(rowMatches.length).toBeLessThanOrEqual(3);
  });
});

// Mark's ask (2026-06-21, after archive went live): add a manual
// Decline button to DRAFT + ACCEPTED so the user can move quotes
// to archive without sending or with a post-acceptance pullout.
// SENT already had one — this widens the surface to two more statuses.
describe('Dashboard decline-from-other-statuses', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('DRAFT block now exposes a Decline button (was Mark-Sent only)', () => {
    const draftStart = src.indexOf("status === 'DRAFT'");
    const sentStart = src.indexOf("status === 'SENT'", draftStart + 1);
    expect(draftStart).toBeGreaterThan(-1);
    expect(sentStart).toBeGreaterThan(draftStart);
    const draftBlock = src.slice(draftStart, sentStart);
    expect(draftBlock).toMatch(/openStatusModal\([^)]*,\s*job\.id,\s*['"]declined['"]/);
  });

  it('ACCEPTED block now exposes a Decline button (was Complete/RAMS only)', () => {
    // Anchor on the ACTION block specifically (there are also `status ===
    // 'ACCEPTED'` matches earlier in the file for badge guards).
    const acceptedStart = src.indexOf("status === 'ACCEPTED' && (");
    expect(acceptedStart).toBeGreaterThan(-1);
    const acceptedBlock = src.slice(acceptedStart, acceptedStart + 3000);
    expect(acceptedBlock).toMatch(/openStatusModal\([^)]*,\s*job\.id,\s*['"]declined['"]/);
    // Sanity: Complete button must still be there (don't accidentally remove it)
    expect(acceptedBlock).toMatch(/Complete/);
  });

  it('decline button uses the same error-border styling as the SENT decline', () => {
    // All three decline buttons should share the visual convention so the
    // user reads them as the same action regardless of starting status.
    const declineMatches = src.match(/borderColor:\s*['"]var\(--tq-error-bd\)['"][^}]*color:\s*['"]var\(--tq-error-txt\)['"]/g) || [];
    expect(declineMatches.length).toBeGreaterThanOrEqual(3); // DRAFT + SENT + ACCEPTED
  });
});

describe('Dashboard archive view copy passes the visibility-rules check', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  // Sanity check on the new strings — banned vocabulary list lives in
  // CLAUDE.md / aiTextRemoval.test.js but those don't fire on plain words
  // like "decline" / "expire" so we eyeball-check our own additions.
  it('does not introduce AI/agent/confidence vocabulary', () => {
    // Extract only the new bits we added (rough but useful)
    const archiveBlock = src.slice(src.indexOf('ARCHIVED JOBS'));
    expect(archiveBlock).not.toMatch(/\b(AI|agent|confidence|calibration|model|prompt)\b/i);
  });
});

// Harry's 2026-06-25 ask: ReferralPanel moved off the dashboard
// (quote-management surface) and into ProfileSetup (personal settings,
// next to the accent colour). The positive assertion that the panel
// renders in ProfileSetup lives in referralComponents.test.js — this
// is the negative regression guard.
describe('Dashboard no longer hosts ReferralPanel (2026-06-25)', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('does not import ReferralPanel', () => {
    expect(src).not.toMatch(/import\s+ReferralPanel\s+from/);
  });

  it('does not render <ReferralPanel /> anywhere', () => {
    expect(src).not.toMatch(/<ReferralPanel\b/);
  });
});
