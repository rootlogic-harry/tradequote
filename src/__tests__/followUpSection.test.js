/**
 * Dashboard redesign (2026-06-29): the standalone "Needs follow-up"
 * section was REMOVED. Urgency is now surfaced inline on flagged rows
 * (amber bar + flag badge) inside the single Recent Jobs list.
 *
 * Source-of-truth spec:
 *   /tmp/fastquote-dashboard-handoff/design_handoff_dashboard/
 *     FastQuote Dashboard Spec.md
 *   §"One table — attention merged in" — the separate "Needs Attention" /
 *   "Needs you today" panel is gone; rows that need action get an amber
 *   bar and a flag in the same list.
 *
 * This file is the regression guard for that removal. The richer flagged-
 * row + filter-pill assertions live in dashboard.test.js.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(
  join(__dirname, '..', 'components', 'Dashboard.jsx'),
  'utf-8'
);

describe('Dashboard — separate "Needs follow-up" section is GONE (redesign 2026-06-29)', () => {
  test('Dashboard no longer renders a FollowUpSection component', () => {
    expect(dashboardSrc).not.toMatch(/<FollowUpSection\b/);
    expect(dashboardSrc).not.toMatch(/function\s+FollowUpSection\b/);
  });

  test('Dashboard no longer renders a FollowUpRow component', () => {
    expect(dashboardSrc).not.toMatch(/<FollowUpRow\b/);
    expect(dashboardSrc).not.toMatch(/function\s+FollowUpRow\b/);
  });

  test('Dashboard does not import portalFollowUp helpers', () => {
    expect(dashboardSrc).not.toMatch(/needsFollowUp/);
    expect(dashboardSrc).not.toMatch(/relativeViewedLabel/);
    expect(dashboardSrc).not.toMatch(/normaliseUkPhoneForWhatsApp/);
  });

  test('Urgency now lives inline on rows via isFlaggedRow (the merged-attention rule)', () => {
    expect(dashboardSrc).toMatch(/isFlaggedRow/);
  });
});
