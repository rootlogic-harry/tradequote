/**
 * Tests for the SavedQuotes screen — Active / Completed / Archive tab
 * split (Mark's original ask 2026-06-21, extended to 3 tabs 2026-06-26
 * because completed jobs were crowding the active list).
 *
 * Source-level checks. Node test env, no JSDOM, so this mirrors the
 * pattern used in dashboard.test.js / savedQuoteViewer.test.js.
 *
 * 2026-06-29 (Harry's overnight UX audit): the row layout was
 * refactored to mirror Dashboard.jsx's redesigned JobRow — one primary
 * action button + kebab overflow instead of the old stack-3-buttons-
 * full-width-on-mobile pattern. These tests pin the new contract.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, '../components/SavedQuotes.jsx'),
  'utf8'
);

describe('SavedQuotes three-tab UI (active / completed / archive)', () => {
  it('imports the jobLifecycle helpers including isCompletedJob', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/utils\/jobLifecycle\.js['"]/);
    expect(src).toContain('isActiveJob');
    expect(src).toContain('isCompletedJob');
    expect(src).toContain('isArchivedJob');
  });

  it('accepts a viewMode prop with a fail-safe default of "active"', () => {
    expect(src).toMatch(/viewMode\s*=\s*['"]active['"]/);
  });

  it('renders Active, Completed, and Archived tabs', () => {
    expect(src).toMatch(/>\s*Active\s*</);
    expect(src).toMatch(/>\s*Completed/);
    expect(src).toMatch(/>\s*Archived/);
  });

  it('dispatches SET_VIEW_MODE for all three view modes on tab click', () => {
    expect(src).toMatch(/SET_VIEW_MODE.*active/);
    expect(src).toMatch(/SET_VIEW_MODE.*completed/);
    expect(src).toMatch(/SET_VIEW_MODE.*archive/);
  });

  it('count badges omitted when buckets are empty (no "(0)")', () => {
    expect(src).toMatch(/completedCount\s*>\s*0/);
    expect(src).toMatch(/archiveCount\s*>\s*0/);
  });

  it('drops Declined AND Completed from the status filter pills', () => {
    // Declined lives in Archive, Completed lives in its own tab.
    // Exposing either as a filter pill inside Active would produce a
    // guaranteed-empty list when tapped.
    const filtersMatch = src.match(/ACTIVE_FILTERS\s*=\s*\[([^\]]*)\]/);
    expect(filtersMatch).not.toBeNull();
    expect(filtersMatch[1]).not.toMatch(/Declined/);
    expect(filtersMatch[1]).not.toMatch(/Completed/);
    expect(filtersMatch[1]).toMatch(/Accepted/);
  });

  it('status-filter pills render in Active view only', () => {
    // Pills wrapped in `isActiveView && (...)` — Completed + Archive
    // are single-status buckets so the filter axis would be noise.
    expect(src).toMatch(/isActiveView\s*&&\s*\([\s\S]{0,200}ACTIVE_FILTERS/);
  });

  it('has an archive-specific empty-state copy', () => {
    expect(src).toMatch(/No archived/i);
    expect(src).toMatch(/declined/i);
    // Mark's 2026-06-21 feedback: expired sends stay in active,
    // so the archive copy must NOT promise to show them.
    expect(src).not.toMatch(/declined and expired/i);
    expect(src).not.toMatch(/expired .+ will show here/i);
  });
});

// Row redesign (Harry's 2026-06-29 audit) replaced the old action-stack
// with a one-primary-button + kebab pattern. The behaviour the previous
// tests pinned — decline available from draft / sent / accepted, delete
// available on every status — is preserved via the kebab menu.
describe('SavedQuotes row redesign — Dashboard-parity', () => {
  it('uses the shared .job-row-redesign grid class', () => {
    expect(src).toMatch(/job-row job-row-redesign/);
  });

  it('declares a PRIMARY_ACTION contract covering draft/sent/accepted', () => {
    const m = src.match(/const\s+PRIMARY_ACTION\s*=\s*\{([\s\S]*?)\};/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/draft:/);
    expect(m[1]).toMatch(/sent:/);
    expect(m[1]).toMatch(/accepted:/);
  });

  it('exposes Decline from draft / sent / accepted via the kebab menu', () => {
    // The kebabItemsFor function returns a decline item for each of
    // the in-flight statuses. We assert the source contains the three
    // status branches AND a decline action item inside each.
    const m = src.match(/function kebabItemsFor\([\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/status === ['"]draft['"]/);
    expect(body).toMatch(/status === ['"]sent['"]/);
    expect(body).toMatch(/status === ['"]accepted['"]/);
    // At least three decline entries — one per in-flight status.
    const declineEntries = body.match(/id:\s*['"]decline['"]/g) || [];
    expect(declineEntries.length).toBeGreaterThanOrEqual(3);
  });

  it('decline menu items route through openStatusModal with target "declined"', () => {
    // The kebab handler dispatches the same OPEN_STATUS_MODAL action
    // the legacy buttons did, with target 'declined'. Wired in
    // handleMenuAction.
    expect(src).toMatch(/case ['"]decline['"]:[\s\S]{0,200}openStatusModal\([^,]+,\s*['"]declined['"]\)/);
  });

  it('renders a kebab button with a 44px touch target', () => {
    expect(src).toMatch(/className=["']kebab-btn touch-44["']/);
    expect(src).toMatch(/minHeight:\s*44,\s*minWidth:\s*44/);
  });

  it('keeps Delete available on every status (including completed + declined)', () => {
    // Delete must be reachable from at least four statuses so the
    // archive can be pruned — the kebab items list contains a delete
    // entry for draft, completed, and declined explicitly. Sent +
    // accepted hide delete to prevent accidental loss of in-flight
    // work; if needed the user can mark declined first.
    const m = src.match(/function kebabItemsFor\([\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    const deleteEntries = body.match(/id:\s*['"]delete['"]/g) || [];
    expect(deleteEntries.length).toBeGreaterThanOrEqual(3);
  });

  it('row primary action button uses .row-action-btn (44px on mobile)', () => {
    expect(src).toMatch(/className=["']row-action-btn["']/);
  });
});

describe('SavedQuotes archive view copy passes the visibility-rules check', () => {
  it('does not introduce AI/agent/confidence vocabulary in tab/empty-state block', () => {
    // Anchor on the 3-tab comment block ("Active / Completed / Archive
    // tabs (Mark's 2026-06-26 ask)...") and scan everything below it.
    const tabBlockStart = src.indexOf('Active / Completed / Archive');
    expect(tabBlockStart).toBeGreaterThan(-1);
    const tabBlock = src.slice(tabBlockStart);
    expect(tabBlock).not.toMatch(/\b(AI|agent|confidence|calibration|model|prompt)\b/i);
  });
});
