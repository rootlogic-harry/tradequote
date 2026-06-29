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
