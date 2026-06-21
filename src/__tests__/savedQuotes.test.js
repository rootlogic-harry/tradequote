/**
 * Tests for the SavedQuotes screen — Active vs Archive view split
 * (Mark's ask, 2026-06-21).
 *
 * Source-level checks. Node test env, no JSDOM, so this mirrors the
 * pattern used in dashboard.test.js / savedQuoteViewer.test.js.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, '../components/SavedQuotes.jsx'),
  'utf8'
);

describe('SavedQuotes active/archive tab UI', () => {
  it('imports the jobLifecycle helpers', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/utils\/jobLifecycle\.js['"]/);
    expect(src).toContain('isActiveJob');
    expect(src).toContain('isArchivedJob');
  });

  it('accepts a viewMode prop with a fail-safe default of "active"', () => {
    expect(src).toMatch(/viewMode\s*=\s*['"]active['"]/);
  });

  it('renders Active and Archive tabs', () => {
    expect(src).toMatch(/>\s*Active\s*</);
    expect(src).toMatch(/>\s*Archive/);
  });

  it('dispatches SET_VIEW_MODE on tab click', () => {
    expect(src).toMatch(/SET_VIEW_MODE.*active/);
    expect(src).toMatch(/SET_VIEW_MODE.*archive/);
  });

  it('hides per-status action buttons in archive view', () => {
    // Each of Mark Sent / Accepted / Declined / Complete is gated on
    // !isArchiveView so archive rows are read-only-ish.
    expect(src).toMatch(/!isArchiveView\s*&&\s*status\s*===\s*['"]DRAFT['"]/);
    expect(src).toMatch(/!isArchiveView\s*&&\s*status\s*===\s*['"]SENT['"]/);
    expect(src).toMatch(/!isArchiveView\s*&&\s*status\s*===\s*['"]ACCEPTED['"]/);
  });

  it('count badge is omitted when archive is empty (no "(0)")', () => {
    expect(src).toMatch(/archiveCount\s*>\s*0/);
  });

  it('drops "Declined" from the status filter pills in active view', () => {
    // Declined jobs live in the archive bucket — exposing a Declined
    // pill inside Active would let users filter to a guaranteed-empty
    // list, which is confusing.
    const filtersMatch = src.match(/ACTIVE_FILTERS\s*=\s*\[([^\]]*)\]/);
    expect(filtersMatch).not.toBeNull();
    expect(filtersMatch[1]).not.toMatch(/Declined/);
    expect(filtersMatch[1]).toMatch(/Accepted/);
  });

  it('archive view does not render the status-filter pills', () => {
    // Pills wrapped in `!isArchiveView && (...)`
    expect(src).toMatch(/!isArchiveView\s*&&\s*\([\s\S]{0,200}ACTIVE_FILTERS/);
  });

  it('has an archive-specific empty-state copy', () => {
    expect(src).toMatch(/No archived/i);
    expect(src).toMatch(/declined/i);
    // Mark's 2026-06-21 feedback: expired sends stay in active,
    // so the archive copy must NOT promise to show them.
    expect(src).not.toMatch(/declined and expired/i);
    expect(src).not.toMatch(/expired .+ will show here/i);
  });

  it('keeps the Delete button available so declined jobs can be pruned', () => {
    // Delete is NOT gated on !isArchiveView — Mark may want to actually
    // remove old declined entries from the database.
    const deleteBlockStart = src.indexOf('Delete');
    expect(deleteBlockStart).toBeGreaterThan(-1);
    // The 200 chars around Delete must not contain `!isArchiveView`
    const context = src.slice(Math.max(0, deleteBlockStart - 200), deleteBlockStart + 50);
    // Find which conditional Delete is under — should be confirmDeleteId, not viewMode
    expect(context).toMatch(/confirmDeleteId/);
  });
});

// Mark's ask (2026-06-21, after archive went live): add a manual
// Decline button to DRAFT + ACCEPTED. SavedQuotes mirrors Dashboard
// so the user gets the same affordance from either surface.
describe('SavedQuotes decline-from-other-statuses', () => {
  it('DRAFT block now exposes a Decline button', () => {
    const draftStart = src.indexOf("status === 'DRAFT'");
    const sentStart = src.indexOf("status === 'SENT'", draftStart + 1);
    expect(draftStart).toBeGreaterThan(-1);
    expect(sentStart).toBeGreaterThan(draftStart);
    const draftBlock = src.slice(draftStart, sentStart);
    expect(draftBlock).toMatch(/openStatusModal\([^)]*,\s*quote\.id,\s*['"]declined['"]/);
  });

  it('ACCEPTED block now exposes a Decline button', () => {
    // Anchor on the ACTION block (there are also earlier `status ===
    // 'ACCEPTED'` matches for border-colour + badge guards).
    const acceptedStart = src.indexOf("status === 'ACCEPTED' && (");
    expect(acceptedStart).toBeGreaterThan(-1);
    const acceptedBlock = src.slice(acceptedStart, acceptedStart + 3000);
    expect(acceptedBlock).toMatch(/openStatusModal\([^)]*,\s*quote\.id,\s*['"]declined['"]/);
    expect(acceptedBlock).toMatch(/Complete/);
  });

  it('decline buttons share the error-border styling across all statuses', () => {
    const declineMatches = src.match(/borderColor:\s*['"]var\(--tq-error-bd\)['"]/g) || [];
    expect(declineMatches.length).toBeGreaterThanOrEqual(3); // DRAFT + SENT + ACCEPTED
  });
});

describe('SavedQuotes archive view copy passes the visibility-rules check', () => {
  it('does not introduce AI/agent/confidence vocabulary in archive copy', () => {
    // Find the archive-empty-state and tab labels block
    const archiveStart = src.indexOf('Active / Archive');
    expect(archiveStart).toBeGreaterThan(-1);
    const archiveBlock = src.slice(archiveStart);
    expect(archiveBlock).not.toMatch(/\b(AI|agent|confidence|calibration|model|prompt)\b/i);
  });
});
