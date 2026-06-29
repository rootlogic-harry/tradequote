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
// Extended 2026-06-26 to 3 tabs (Active / Completed / Archive) because
// completed jobs were piling up in the active list.
// Source-level checks — full DOM rendering of Dashboard isn't part
// of the test stack (node env, no JSDOM).
describe('Dashboard three-tab UI (active / completed / archive)', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('imports the jobLifecycle helpers including isCompletedJob', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/utils\/jobLifecycle\.js['"]/);
    expect(src).toContain('isActiveJob');
    expect(src).toContain('isCompletedJob');
    expect(src).toContain('isArchivedJob');
  });

  it('accepts a viewMode prop with a fail-safe default of "active"', () => {
    // Default must be 'active' so a parent that forgets the prop still
    // renders the main list, not an empty archive/completed view.
    expect(src).toMatch(/viewMode\s*=\s*['"]active['"]/);
  });

  it('renders Active, Completed, and Archived tab buttons', () => {
    // Tab labels exist as literal JSX text
    expect(src).toMatch(/>\s*Active\s*</);
    expect(src).toMatch(/>\s*Completed/);
    expect(src).toMatch(/>\s*Archived/);
  });

  it('dispatches SET_VIEW_MODE for all three view modes on tab click', () => {
    expect(src).toMatch(/SET_VIEW_MODE.*active/);
    expect(src).toMatch(/SET_VIEW_MODE.*completed/);
    expect(src).toMatch(/SET_VIEW_MODE.*archive/);
  });

  it('hides per-status action buttons in archive view', () => {
    // The action-button block is wrapped in `!isArchiveView && (...)`
    // so archive rows are read-only-ish. Completed view naturally renders
    // no per-status actions because no row there matches DRAFT/SENT/ACCEPTED.
    expect(src).toMatch(/!isArchiveView\s*&&\s*\(/);
  });

  it('count badges omitted when buckets are empty (no "(0)")', () => {
    // Guard pattern: only render the parenthesised count when > 0
    expect(src).toMatch(/completedCount\s*>\s*0/);
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

// PR-8 (2026-06-29): Dashboard mobile polish per /tmp/mobile-responsive-plan.md
// audit items #8, #9, #19, #20, #22, plus Q3 (hide QUICK QUOTE on mobile).
// These are source-level scans because the test stack is node-only — no
// JSDOM rendering of Dashboard.
describe('Dashboard mobile action rows + stats polish (PR-8)', () => {
  const src = readFileSync(
    join(__dirname, '../components/Dashboard.jsx'), 'utf8'
  );

  it('header CTA row wraps on small screens (audit #8)', () => {
    // The header row holding QUICK + NEW QUOTE must allow wrap so the
    // two buttons don't overflow the column on 360px Androids.
    expect(src).toMatch(/flex flex-wrap gap-2 shrink-0/);
  });

  it('hides QUICK QUOTE on mobile, keeps it on desktop (Q3)', () => {
    // QUICK is admin-only / mobile-clutter per Harry's 2026-06-26 approval.
    // Render with `hidden fq:inline-flex` (or equivalent) so basic mobile
    // users see only `+ NEW QUOTE` in the header.
    const quickButtonRegion = src.match(
      /onStartQuickQuote[\s\S]{0,300}?<\/button>/
    );
    expect(quickButtonRegion).toBeTruthy();
    expect(quickButtonRegion[0]).toMatch(/hidden fq:inline-flex/);
  });

  it('per-row status action buttons use .row-action-btn (audit #9)', () => {
    // Previously inline `style={{ height: 36, padding: '0 16px' }}` —
    // bypassed the global .row-action-btn mobile rule (44px full-width).
    // After PR-8, no inline `height: 36` lives in Dashboard's per-row
    // action block (the FollowUpRow phone/WhatsApp buttons are out of
    // scope for this PR and live elsewhere in the file).
    const recentJobsStart = src.indexOf('RECENT JOBS');
    expect(recentJobsStart).toBeGreaterThan(-1);
    const tail = src.slice(recentJobsStart);
    // Every per-status action button uses row-action-btn class.
    expect(tail).toMatch(/className="row-action-btn"/);
    // None of the per-status action buttons re-introduce inline 36px height.
    const actionBlock = tail.slice(0, tail.indexOf('</div>\n            );') > 0 ? tail.indexOf('</div>\n            );') : tail.length);
    expect(actionBlock).not.toMatch(/height: 36[^0-9]/);
  });

  it('stats strip renders both full + compact currency forms (audit #19)', () => {
    // Two spans per money cell — full (default) and compact (<360px).
    expect(src).toMatch(/stat-value-full/);
    expect(src).toMatch(/stat-value-compact/);
    expect(src).toMatch(/formatCurrencyCompact/);
    // Each money stat (This month / This year / Accepted) emits both
    // forms — at least 3 occurrences each.
    const fullMatches = src.match(/stat-value-full/g) || [];
    const compactMatches = src.match(/stat-value-compact/g) || [];
    expect(fullMatches.length).toBeGreaterThanOrEqual(3);
    expect(compactMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('monthly breakdown reflows to 2 columns on small phones (audit #20)', () => {
    // Was `grid-cols-3 fq:grid-cols-6`; PR-8 drops to `grid-cols-2`
    // on phones so cells don't squash the £ value into the Jan/Feb label.
    expect(src).toMatch(/grid grid-cols-2 fq:grid-cols-6/);
    // Belt-and-braces: the old 3-col layout is gone for the monthly grid.
    expect(src).not.toMatch(/grid-cols-3 fq:grid-cols-6/);
  });
});

describe('formatCurrencyCompact (PR-8 helper for stats strip)', () => {
  // Test-load the helper directly. It's a pure function with no
  // React / DOM dependencies.
  const path = join(__dirname, '../utils/formatCurrencyCompact.js');
  const helperSrc = readFileSync(path, 'utf8');

  it('helper file exports formatCurrencyCompact', () => {
    expect(helperSrc).toMatch(/export\s+function\s+formatCurrencyCompact/);
  });

  // Behavioural tests run via dynamic import so we don't have to add
  // it to a separate test stub.
  it('produces sensible abbreviated forms', async () => {
    const { formatCurrencyCompact } = await import('../utils/formatCurrencyCompact.js');
    expect(formatCurrencyCompact(0)).toBe('£0');
    expect(formatCurrencyCompact(850)).toBe('£850');
    expect(formatCurrencyCompact(1234)).toBe('£1.2k');
    expect(formatCurrencyCompact(12500)).toBe('£12.5k');
    expect(formatCurrencyCompact(1_200_000)).toBe('£1.2M');
    expect(formatCurrencyCompact(12_500_000)).toBe('£12.5M');
    // Trailing .0 trimmed (£1M, not £1.0M).
    expect(formatCurrencyCompact(1_000_000)).toBe('£1M');
    expect(formatCurrencyCompact(1_000)).toBe('£1k');
    // Negative amounts keep the leading minus.
    expect(formatCurrencyCompact(-1500)).toBe('-£1.5k');
    // Non-finite inputs fall back to £0 (defensive).
    expect(formatCurrencyCompact(NaN)).toBe('£0');
    expect(formatCurrencyCompact(undefined)).toBe('£0');
  });
});

describe('ReferralPanel mobile button balance (PR-8 / audit #22)', () => {
  const src = readFileSync(
    join(__dirname, '../components/ReferralPanel.jsx'), 'utf8'
  );

  it('Copy + Share buttons are full-width on mobile, auto on desktop', () => {
    // Both buttons get `w-full fq:w-auto` so they fill the column under
    // the (also full-width) code box and don't look unbalanced on phones.
    const copyButton = src.match(/onClick=\{handleCopyCode\}[\s\S]{0,200}?<\/button>/);
    const shareButton = src.match(/onClick=\{handleShare\}[\s\S]{0,300}?<\/button>/);
    expect(copyButton).toBeTruthy();
    expect(shareButton).toBeTruthy();
    expect(copyButton[0]).toMatch(/w-full fq:w-auto/);
    expect(shareButton[0]).toMatch(/w-full fq:w-auto/);
  });

  it('both buttons meet the 44px touch-target rule on mobile', () => {
    // The previous fixed `height: 40` was below the 44px CLAUDE.md rule —
    // PR-8 bumps to minHeight: 44 (44px on every viewport).
    const matches = src.match(/minHeight:\s*44/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
