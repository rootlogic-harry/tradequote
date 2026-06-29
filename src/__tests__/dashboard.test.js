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

// ─── App.jsx wires the rail chip and hides QuotaCounter on Dashboard ──
describe('App.jsx wires the rail-quota chip + hides QuotaCounter on Dashboard', () => {
  it('forwards billing to Sidebar', () => {
    expect(appSrc).toMatch(/billing=\{billing\}/);
  });

  it('QuotaCounter is suppressed when currentView === "dashboard"', () => {
    expect(appSrc).toMatch(/currentView !== ['"]dashboard['"][^<]*<QuotaCounter/);
  });

  it('QuotaCounter is still mounted on other views (Step pages, SavedQuotes)', () => {
    // The suppression guard implies the component is otherwise present.
    expect(appSrc).toMatch(/<QuotaCounter billing=/);
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
