/**
 * Analytics frontend wiring (TRQ-175).
 *
 * Source-level guards on the dashboard plumbing so a future refactor
 * can't drop:
 *   - the admin-only nav entry
 *   - the App.jsx render gate
 *   - the data fetch / range param
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidebarSrc = readFileSync(join(__dirname, '../components/Sidebar.jsx'), 'utf8');
const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
const analyticsSrc = readFileSync(join(__dirname, '../components/Analytics.jsx'), 'utf8');

describe('Sidebar — Analytics nav entry', () => {
  test('Analytics is only added to navItems when isAdminPlan is true', () => {
    expect(sidebarSrc).toMatch(
      /isAdminPlan\s*&&\s*onGoToAnalytics[\s\S]*\{\s*key:\s*'analytics'/
    );
  });

  test('isActive recognises analytics view', () => {
    expect(sidebarSrc).toMatch(/key === 'analytics' && currentView === 'analytics'/);
  });

  test('TrendIcon is defined for the Analytics nav row', () => {
    expect(sidebarSrc).toMatch(/function TrendIcon/);
  });
});

describe('App.jsx — Analytics view wiring', () => {
  test('imports the Analytics component', () => {
    expect(appSrc).toMatch(/import\s+Analytics\s+from\s+['"]\.\/components\/Analytics\.jsx['"]/);
  });

  test('renderContent gates Analytics on admin (admin-only view)', () => {
    expect(appSrc).toMatch(
      /currentView === 'analytics'[\s\S]*&&[\s\S]*isAdmin[\s\S]*<Analytics/
    );
  });

  test('Sidebar receives onGoToAnalytics prop wired to setCurrentView("analytics")', () => {
    expect(appSrc).toMatch(/onGoToAnalytics=\{\(\)\s*=>\s*setCurrentView\(['"]analytics['"]\)\}/);
  });
});

describe('Analytics.jsx — data fetch + UI sections', () => {
  test('fetches /api/admin/analytics with range query param', () => {
    // Analytics Phase 1 (2026-06-29) — URL is now built via
    // URLSearchParams to carry range + excludeInternal cleanly, so
    // we match the endpoint path AND the presence of the range
    // param rather than a literal `?range=`.
    expect(analyticsSrc).toMatch(/['"`]\/api\/admin\/analytics/);
    expect(analyticsSrc).toMatch(/range/);
    expect(analyticsSrc).toMatch(/URLSearchParams|\?range=/);
  });

  test('range selector includes 24h / 7d / 30d / all', () => {
    expect(analyticsSrc).toMatch(/'24h'/);
    expect(analyticsSrc).toMatch(/'7d'/);
    expect(analyticsSrc).toMatch(/'30d'/);
    expect(analyticsSrc).toMatch(/'all'/);
  });

  test('renders the required sections', () => {
    expect(analyticsSrc).toMatch(/Per-user spend/);
    expect(analyticsSrc).toMatch(/Top quotes by token spend/);
    expect(analyticsSrc).toMatch(/Spend by model/);
    expect(analyticsSrc).toMatch(/Reliability/);
    expect(analyticsSrc).toMatch(/Client portal engagement/);
  });

  test('exposes the pricing-as-of date so admins know freshness', () => {
    expect(analyticsSrc).toMatch(/pricesLastReviewed/);
  });

  test('handles fetch error with an inline banner (does not crash)', () => {
    expect(analyticsSrc).toMatch(/ErrorBanner/);
    expect(analyticsSrc).toMatch(/setError/);
  });
});

// Ad-attribution PR 2 (2026-08-04, docs/AD_TEST). The dashboard
// surface for cost-per-paying-signup on the £100 Meta ad test.
describe('Analytics.jsx — Signups by source section', () => {
  test('SourceSummarySection component is defined + rendered above PerUserSection', () => {
    expect(analyticsSrc).toMatch(/function SourceSummarySection\(\{ signupsBySource \}\)/);
    // Mount order matters — the funnel summary should read first,
    // then the per-user detail. Guard the ordering.
    const summaryIdx = analyticsSrc.indexOf('<SourceSummarySection');
    const perUserIdx = analyticsSrc.indexOf('<PerUserSection');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(perUserIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeLessThan(perUserIdx);
  });

  test('SourceSummarySection consumes data.signupsBySource from the API', () => {
    expect(analyticsSrc).toMatch(
      /<SourceSummarySection\s+signupsBySource=\{data\.signupsBySource\}/,
    );
  });

  test('renders the four-column contract: Source | Signups | Activated | Paying', () => {
    // The order matters — the summary reads left-to-right as a
    // funnel (arrived → tried → paid). Swapping columns silently
    // breaks the mental model even if the numbers are right.
    const start = analyticsSrc.indexOf('function SourceSummarySection');
    const end = analyticsSrc.indexOf('\nfunction ', start + 1);
    const body = analyticsSrc.slice(start, end);
    expect(body).toMatch(/>Source</);
    expect(body).toMatch(/>Signups</);
    expect(body).toMatch(/>Activated</);
    expect(body).toMatch(/>Paying</);
    // Ordering check — Source header appears before Signups appears
    // before Activated appears before Paying.
    const sourceIdx = body.indexOf('>Source<');
    const signupsIdx = body.indexOf('>Signups<');
    const activatedIdx = body.indexOf('>Activated<');
    const payingIdx = body.indexOf('>Paying<');
    expect(sourceIdx).toBeLessThan(signupsIdx);
    expect(signupsIdx).toBeLessThan(activatedIdx);
    expect(activatedIdx).toBeLessThan(payingIdx);
  });

  test('empty state renders when no signups tracked yet', () => {
    // First-week-after-deploy state — no attribution rows exist yet.
    // Better to say "No signups tracked yet" than render an empty
    // 4-column shell.
    expect(analyticsSrc).toMatch(/No signups tracked yet/);
  });

  test('data-testid hook exists on the table so smoke tests can select it', () => {
    expect(analyticsSrc).toMatch(/data-testid=["']source-summary-table["']/);
  });
});

describe('Analytics.jsx — PerUserSection surfaces the source column', () => {
  test('Source column header sits between Plan and Last login', () => {
    // Grouping the identity-adjacent columns (User / Plan / Source)
    // on the left keeps the scan pattern intact. Numerics stay
    // right-aligned as before.
    const start = analyticsSrc.indexOf('function PerUserSection');
    const end = analyticsSrc.indexOf('\nfunction ', start + 1);
    const body = analyticsSrc.slice(start, end);
    const planIdx = body.indexOf('>Plan<');
    const sourceIdx = body.indexOf('>Source<');
    const lastLoginIdx = body.indexOf('>Last login<');
    expect(planIdx).toBeGreaterThan(-1);
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(lastLoginIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(lastLoginIdx);
  });

  test('NULL signupSource renders as "direct" (matches summary bucket)', () => {
    // The "direct" fallback string MUST match the string used by
    // the server's COALESCE in signupsBySourceQuery — otherwise the
    // per-user row's source doesn't join back to any row in the
    // summary. Grep-check for the exact literal.
    const start = analyticsSrc.indexOf('function PerUserSection');
    const end = analyticsSrc.indexOf('\nfunction ', start + 1);
    const body = analyticsSrc.slice(start, end);
    expect(body).toMatch(/u\.signupSource\s*\|\|\s*['"]direct['"]/);
  });
});
