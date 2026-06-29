/**
 * Tests for the Dashboard redesign (2026-06-29).
 *
 * Source of truth:
 *   /tmp/fastquote-dashboard-handoff/design_handoff_dashboard/
 *     FastQuote Dashboard Redesign.html
 *     FastQuote Dashboard Spec.md
 *
 * These are source-level assertions — the test stack is node-only with
 * no JSDOM rendering, so we read the JSX as text and grep for the
 * load-bearing structural pieces. The behavioural follow-up lives in
 * the wider regression harness.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, '../components/Dashboard.jsx'), 'utf8');
const sidebarSrc = readFileSync(join(__dirname, '../components/Sidebar.jsx'), 'utf8');
const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');

// ─── Stats strip (money-first) ────────────────────────────────────────
describe('Dashboard money-first stats strip', () => {
  it('renders Won this year + Awaiting reply + Open pipeline + Win rate', () => {
    expect(dashboardSrc).toMatch(/Won this year/);
    expect(dashboardSrc).toMatch(/Awaiting reply/);
    expect(dashboardSrc).toMatch(/Open pipeline/);
    expect(dashboardSrc).toMatch(/Win rate/);
  });

  it('does NOT render the old This-month / This-year / Accepted strip', () => {
    // The old strip used "This month" / "This year" / "Accepted" labels
    // in stat-label divs. Spot-check the labels disappeared. (Awaiting
    // is the only label shared between old and new — and the new copy
    // is "Awaiting reply", not the bare "Awaiting".)
    expect(dashboardSrc).not.toMatch(/<div className="stat-label">This month<\/div>/);
    expect(dashboardSrc).not.toMatch(/<div className="stat-label">This year<\/div>/);
    expect(dashboardSrc).not.toMatch(/<div className="stat-label">Accepted<\/div>/);
  });

  it('Awaiting reply has a Chase-these link that filters to sent', () => {
    expect(dashboardSrc).toMatch(/Chase these/);
    // The link sets the filter to 'sent'.
    expect(dashboardSrc).toMatch(/setFilter\(['"]sent['"]\)/);
  });

  it('Awaiting cell carries the warn-tint accent (`stat-cell warn`)', () => {
    expect(dashboardSrc).toMatch(/stat-cell warn/);
  });

  it('Won cell carries the accent-tint (green) class (`stat-cell accent`)', () => {
    expect(dashboardSrc).toMatch(/stat-cell accent/);
  });
});

// ─── Filter pills ─────────────────────────────────────────────────────
describe('Dashboard filter pills (6 pills with counts)', () => {
  it('renders all six filter pills: All / Drafts / Sent / Accepted / Done / Declined', () => {
    expect(dashboardSrc).toMatch(/['"]all['"],\s*['"]All['"]/);
    expect(dashboardSrc).toMatch(/['"]draft['"],\s*['"]Drafts['"]/);
    expect(dashboardSrc).toMatch(/['"]sent['"],\s*['"]Sent['"]/);
    expect(dashboardSrc).toMatch(/['"]accepted['"],\s*['"]Accepted['"]/);
    expect(dashboardSrc).toMatch(/['"]completed['"],\s*['"]Done['"]/);
    expect(dashboardSrc).toMatch(/['"]declined['"],\s*['"]Declined['"]/);
  });

  it('each pill renders a count badge (counts[key])', () => {
    expect(dashboardSrc).toMatch(/counts\[key\]/);
  });
});

// ─── Filter pill wiring (2026-06-29 regression — Harry, live prod) ────
// Source-level regex tests previously passed while the behaviour
// silently regressed. The behavioural assertions now live in
// `dashboardFilter.test.js` (pure helper). These tests pin the WIRING
// between the Dashboard component and the helper so a stale closure /
// missing dep array / hard-coded handler cannot regress unnoticed.
describe('Dashboard filter pill wiring (regression: pills did not actually filter)', () => {
  it('imports the pure helper from utils/dashboardFilter.js', () => {
    expect(dashboardSrc).toMatch(
      /import\s*\{[^}]*filterAndLimitJobs[^}]*computeFilterCounts[^}]*\}\s*from\s*['"]\.\.\/utils\/dashboardFilter\.js['"]/
    );
  });

  it('visibleJobs is computed by filterAndLimitJobs(jobs, filter, 10)', () => {
    // The helper is the single source of truth for the filter — the
    // mechanical bug class (slice-before-filter / stale closure) is now
    // owned by the helper's unit tests.
    expect(dashboardSrc).toMatch(/filterAndLimitJobs\(jobs,\s*filter,\s*10\)/);
  });

  it('useMemo for visibleJobs depends on both `jobs` AND `filter`', () => {
    // The useMemo dep array must contain `filter` — without it, the
    // memo would return its first-render result forever and the pills
    // would visually flip but the list wouldn't change.
    const visibleStart = dashboardSrc.indexOf('const visibleJobs = useMemo');
    expect(visibleStart).toBeGreaterThan(-1);
    const visibleEnd = dashboardSrc.indexOf(';', visibleStart);
    const visibleBlock = dashboardSrc.slice(visibleStart, visibleEnd);
    expect(visibleBlock).toMatch(/\[\s*jobs\s*,\s*filter\s*\]/);
  });

  it('pill counts are computed by computeFilterCounts(jobs)', () => {
    expect(dashboardSrc).toMatch(/computeFilterCounts\(jobs\)/);
  });

  it('the pill onClick fires setFilter with the pill key', () => {
    // Belt-and-braces: an `onClick` that doesn't call setFilter would
    // mean the pill visually flips (aria-selected updates) but the
    // `filter` state never moves — the bug Harry described.
    expect(dashboardSrc).toMatch(/onClick=\{\(\)\s*=>\s*setFilter\(key\)\}/);
  });

  it('aria-selected mirrors the filter state (filter === key)', () => {
    expect(dashboardSrc).toMatch(/aria-selected=\{filter\s*===\s*key\}/);
  });

  it('the "Chase these" link in the Awaiting cell still snaps the filter to sent', () => {
    expect(dashboardSrc).toMatch(/setFilter\(['"]sent['"]\)/);
  });
});

// ─── 3-tab parent REMOVED from Dashboard (kept on SavedQuotes) ────────
describe('Dashboard no longer renders the 3-tab parent (active/completed/archive)', () => {
  it('does not dispatch SET_VIEW_MODE from Dashboard', () => {
    expect(dashboardSrc).not.toMatch(/SET_VIEW_MODE/);
  });

  it('does not import jobLifecycle helpers in Dashboard', () => {
    expect(dashboardSrc).not.toMatch(/from\s+['"]\.\.\/utils\/jobLifecycle\.js['"]/);
  });

  it('does not render Active / Completed / Archived tab buttons', () => {
    // Belt-and-braces: the role="tab" markup for the 3-way switch is gone.
    // (Note: the filter pills below ARE role="tab" inside a Filter quotes
    // group — that's a different control with role="tab" + aria-label.)
    expect(dashboardSrc).not.toMatch(/Job list view/);
  });
});

// ─── FollowUpSection removed ──────────────────────────────────────────
describe('Dashboard no longer renders FollowUpSection', () => {
  it('does not import portalFollowUp helpers', () => {
    expect(dashboardSrc).not.toMatch(/portalFollowUp/);
  });

  it('does not render <FollowUpSection /> anywhere', () => {
    expect(dashboardSrc).not.toMatch(/<FollowUpSection\b/);
  });
});

// ─── Flagged-row amber bar ────────────────────────────────────────────
describe('Dashboard flagged-row amber bar surfaces urgency inline', () => {
  it('uses an isFlaggedRow helper to compute attention status', () => {
    expect(dashboardSrc).toMatch(/isFlaggedRow/);
  });

  it('applies a `flagged` class to rows needing action', () => {
    expect(dashboardSrc).toMatch(/flagged\s*\?\s*['"]\s+flagged['"]/);
  });

  it('flags sent quotes with sentDays >= 2', () => {
    // Function should treat ≥2 days since sentAt as flagged.
    expect(dashboardSrc).toMatch(/d\s*>=\s*2/);
  });

  it('flags accepted jobs missing RAMS', () => {
    expect(dashboardSrc).toMatch(/hasRams\s*\|\|\s*!!job\.ramsSnapshot/);
  });

  it('shows a "RAMS needed" or "No reply" badge under flagged rows', () => {
    expect(dashboardSrc).toMatch(/RAMS needed/);
    expect(dashboardSrc).toMatch(/No reply/);
  });
});

// ─── One primary action per row + kebab overflow menu ─────────────────
describe('Dashboard rows: one primary action that advances status + kebab menu', () => {
  it('defines a PRIMARY_ACTION map (draft → sent, sent → accepted, accepted → completed)', () => {
    expect(dashboardSrc).toMatch(/PRIMARY_ACTION/);
    expect(dashboardSrc).toMatch(/draft.*Send.*sent/s);
    expect(dashboardSrc).toMatch(/sent.*Mark accepted.*accepted/s);
    expect(dashboardSrc).toMatch(/accepted.*Mark complete.*completed/s);
  });

  it('primary button uses stopPropagation so it does not open the row', () => {
    expect(dashboardSrc).toMatch(/e\.stopPropagation\(\);\s*onAdvance/);
  });

  it('renders a KebabMenu component with contextual items per status', () => {
    expect(dashboardSrc).toMatch(/KebabMenu/);
    // Status-specific overflow items
    expect(dashboardSrc).toMatch(/Edit quote/);
    expect(dashboardSrc).toMatch(/Resend link/);
    expect(dashboardSrc).toMatch(/Mark declined/);
    expect(dashboardSrc).toMatch(/Re-open/);
  });

  it('kebab wrap stops row-open propagation', () => {
    expect(dashboardSrc).toMatch(/kebab-menu-wrap/);
    expect(dashboardSrc).toMatch(/onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
  });

  it('mark declined routes through the existing status modal', () => {
    expect(dashboardSrc).toMatch(/openStatusModal\(job\.id,\s*['"]declined['"]\)/);
  });

  it('row click opens the quote (onViewJob)', () => {
    expect(dashboardSrc).toMatch(/onViewJob\?\.\(job\)/);
  });
});

// ─── Terminology lockdown — app chrome says "Quote" ───────────────────
describe('Dashboard terminology lockdown: app chrome says "Quote"', () => {
  it('does not use documentTerm() for nav/buttons/headings on Dashboard', () => {
    // Dashboard.jsx no longer imports documentTerm — it's irrelevant
    // to the app chrome. (QuoteDocument still uses it for the rendered
    // document title — separate file, separate concern.)
    expect(dashboardSrc).not.toMatch(/from\s+['"]\.\.\/utils\/documentType\.js['"]/);
  });

  it('header CTAs say literal "View all quotes" + "NEW QUOTE"', () => {
    expect(dashboardSrc).toMatch(/View all quotes/);
    expect(dashboardSrc).toMatch(/\+\s*NEW QUOTE/);
  });

  it('section heading says RECENT QUOTES', () => {
    expect(dashboardSrc).toMatch(/RECENT QUOTES/);
  });
});

// ─── Sidebar: nav items locked to Quote + rail-quota chip ─────────────
describe('Sidebar terminology lockdown + rail-quota chip', () => {
  it('Sidebar nav items use literal "New quote" / "My quotes"', () => {
    expect(sidebarSrc).toMatch(/label:\s*['"]New quote['"]/);
    expect(sidebarSrc).toMatch(/label:\s*['"]My quotes['"]/);
  });

  it('Sidebar no longer imports documentTerm', () => {
    expect(sidebarSrc).not.toMatch(/from\s+['"]\.\.\/utils\/documentType\.js['"]/);
  });

  it('Sidebar renders a RailQuotaChip component', () => {
    expect(sidebarSrc).toMatch(/RailQuotaChip/);
  });

  it('RailQuotaChip hides itself when subscribed or comped', () => {
    expect(sidebarSrc).toMatch(/quotaState === ['"]subscribed['"]/);
    expect(sidebarSrc).toMatch(/quotaState === ['"]comped['"]/);
  });

  it('RailQuotaChip applies `.low` styling when remaining quota ≤ 2', () => {
    expect(sidebarSrc).toMatch(/remaining\s*<=\s*2/);
  });

  it('RailQuotaChip Top up button hits the buy-quote-pack endpoint', () => {
    expect(sidebarSrc).toMatch(/api\/billing\/buy-quote-pack/);
  });

  it('Sidebar accepts a billing prop', () => {
    expect(sidebarSrc).toMatch(/billing\s*=\s*null/);
  });
});

// ─── App.jsx wires the rail chip; QuotaCounter banner removed ─────────
describe('App.jsx wires the rail-quota chip + QuotaCounter banner removed app-wide', () => {
  it('forwards billing to Sidebar', () => {
    expect(appSrc).toMatch(/billing=\{billing\}/);
  });

  // 2026-06-29 (later): QuotaCounter was suppressed on Dashboard in
  // PR #84; Harry's follow-up removed it from Step pages + SavedQuotes
  // too. The rail chip (Sidebar) is the single quota surface on
  // desktop. The 402 lockout modal still fires at the actionable
  // moment when quota is exhausted.
  it('QuotaCounter banner is NOT mounted anywhere in App.jsx', () => {
    expect(appSrc).not.toMatch(/<QuotaCounter\b/);
  });

  it('QuotaCounter import is removed from App.jsx', () => {
    expect(appSrc).not.toMatch(/import\s+QuotaCounter\s+from/);
  });

  it('App.jsx imports incrementQuoteSequence (reference-bug fix)', () => {
    expect(appSrc).toMatch(/incrementQuoteSequence/);
  });

  it('incrementQuoteSequence is called after a successful first saveJob', () => {
    // The fix lives in the auto-save effect — the SPA was bumping the
    // sequence locally on NEW_QUOTE but never persisting it, so every
    // session started from the original value. Persist via the
    // existing /quote-sequence/increment endpoint after first save.
    const idx = appSrc.indexOf('jobId = await saveJob');
    expect(idx).toBeGreaterThan(-1);
    const block = appSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/incrementQuoteSequence\(state\.currentUserId\)/);
  });
});

// ─── Annotation pins / banner / toggle / demo toasts NOT shipped ──────
describe('Dashboard does NOT ship the review-only prototype artifacts', () => {
  it('no Pin component', () => {
    expect(dashboardSrc).not.toMatch(/function\s+Pin\b/);
    expect(dashboardSrc).not.toMatch(/<Pin\b/);
  });

  it('no annotation banner', () => {
    expect(dashboardSrc).not.toMatch(/anno-banner/);
    expect(dashboardSrc).not.toMatch(/Annotated view/);
  });

  it('no .controls / .anno-pin / .anno-pop classes', () => {
    expect(dashboardSrc).not.toMatch(/anno-pin/);
    expect(dashboardSrc).not.toMatch(/anno-pop/);
  });

  it('no toast-on-every-action stand-in', () => {
    // The prototype used flash() / setToast() for every action.
    // The real dashboard wires state transitions instead.
    expect(dashboardSrc).not.toMatch(/setToast\(/);
  });
});

// ─── 2026-06-29 (later) — RAMS + Duplicate removed from kebab ────────
describe('Dashboard kebab no longer offers Duplicate or Create RAMS', () => {
  it('the kebabItemsFor switch does not include Duplicate', () => {
    // Anchor on the helper definition. PR #84 had
    // { id: 'duplicate', label: 'Duplicate' } in multiple branches;
    // Harry's 2026-06-29 follow-up removed all of them because the
    // action had no real wiring (routed to onViewJob — a placeholder).
    const helperStart = dashboardSrc.indexOf('function kebabItemsFor');
    const helperEnd = dashboardSrc.indexOf('function KebabMenu', helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = dashboardSrc.slice(helperStart, helperEnd);
    expect(helperBody).not.toMatch(/Duplicate/);
    expect(helperBody).not.toMatch(/['"]duplicate['"]/);
  });

  it('the kebabItemsFor switch does not include Create/View RAMS', () => {
    const helperStart = dashboardSrc.indexOf('function kebabItemsFor');
    const helperEnd = dashboardSrc.indexOf('function KebabMenu', helperStart);
    const helperBody = dashboardSrc.slice(helperStart, helperEnd);
    expect(helperBody).not.toMatch(/Create RAMS/);
    expect(helperBody).not.toMatch(/View RAMS/);
    expect(helperBody).not.toMatch(/['"]create-rams['"]/);
    expect(helperBody).not.toMatch(/['"]view-rams['"]/);
  });

  it('the kebab button is suppressed entirely for completed quotes (no items)', () => {
    // Empty items list ⇒ no kebab rendered. JobRow checks
    // kebabItemsFor(status).length > 0 before rendering the button.
    expect(dashboardSrc).toMatch(/kebabItemsFor\(status\)\.length\s*>\s*0/);
  });
});

// ─── 2026-06-29 kebab UX follow-up ───────────────────────────────────
describe('Dashboard kebab — Re-open routes to draft (not sent)', () => {
  it("declined → 'reopen' opens the status modal with target='draft'", () => {
    // 2026-06-29: server VALID_TRANSITIONS widened to allow
    // declined → draft so the waller can edit the quote before
    // re-sending. The "Re-open" kebab targets 'draft' accordingly.
    expect(dashboardSrc).toMatch(
      /case ['"]reopen['"][\s\S]{0,500}openStatusModal\(job\.id,\s*['"]draft['"]\)/
    );
  });
});

describe('Dashboard kebab — Delete inline two-tap confirm', () => {
  it('KebabMenu tracks a deleteArmed state', () => {
    expect(dashboardSrc).toMatch(/setDeleteArmed/);
  });

  it('the Delete button shows "Tap again to confirm" once armed', () => {
    expect(dashboardSrc).toMatch(/Tap again to confirm/);
  });

  it("the danger button gains an 'armed' className when arming", () => {
    expect(dashboardSrc).toMatch(/it\.id === ['"]delete['"]\s*&&\s*deleteArmed\s*\?\s*['"]armed['"]/);
  });
});

describe('Dashboard kebab — Resend link copies to clipboard', () => {
  it("'resend' action delegates to onResendLink prop", () => {
    expect(dashboardSrc).toMatch(/case ['"]resend['"][\s\S]{0,500}onResendLink\(job\)/);
  });
});

describe('App.jsx wires Resend/Delete kebab callbacks', () => {
  const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');

  it('imports getClientStatus, generateClientToken, deleteJob from userDB', () => {
    expect(appSrc).toMatch(/getClientStatus/);
    expect(appSrc).toMatch(/generateClientToken/);
    expect(appSrc).toMatch(/\bdeleteJob\b/);
  });

  it('handleResendLink copies to clipboard + toasts on success', () => {
    expect(appSrc).toMatch(/handleResendLink/);
    expect(appSrc).toMatch(/clipboard\.writeText/);
    expect(appSrc).toMatch(/Link copied/);
  });

  it('handleDeleteJob calls deleteJob + refreshes the list', () => {
    expect(appSrc).toMatch(/handleDeleteJob/);
    expect(appSrc).toMatch(/await deleteJob\(state\.currentUserId,/);
  });

  it('Dashboard is passed onResendLink, onDeleteJob, showToast', () => {
    const dashStart = appSrc.indexOf('<Dashboard');
    const dashEnd = appSrc.indexOf('/>', dashStart);
    const block = appSrc.slice(dashStart, dashEnd);
    expect(block).toContain('onResendLink={handleResendLink}');
    expect(block).toContain('onDeleteJob={handleDeleteJob}');
    expect(block).toContain('showToast={showToast}');
  });
});

describe('StatusModal supports draft target (Re-open from declined)', () => {
  const modalSrc = readFileSync(join(__dirname, '../components/StatusModal.jsx'), 'utf8');

  it("'draft' is a recognised targetStatus in handleConfirm", () => {
    expect(modalSrc).toMatch(/targetStatus === ['"]draft['"]/);
  });

  it("draft variant clears declinedAt + declineReason in the meta payload", () => {
    expect(modalSrc).toMatch(/onConfirm\(jobId,\s*['"]draft['"][\s\S]{0,200}declinedAt:\s*null/);
  });

  it("draft variant has a 'Re-open quote' header config", () => {
    expect(modalSrc).toMatch(/Re-open quote/);
  });
});

// ─── Visibility-rules sanity ──────────────────────────────────────────
describe('Dashboard redesign passes the basic-user visibility check', () => {
  it('does not introduce banned vocabulary (AI/agent/confidence/calibration/model/prompt)', () => {
    // Strip comments from the source before scanning — comments are
    // not user-visible. Block /* */ comments first, then // lines.
    const stripped = dashboardSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\b(AI|agent|confidence|calibration|model|prompt|LLM|Claude|Sonnet)\b/i);
  });
});
