import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isAppAccessAllowed, canCreateQuotes, MARK_USER_ID, PAUL_USER_ID } from '../utils/appAccess.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');
const dashboardSrc = readFileSync(join(repoRoot, 'src/components/Dashboard.jsx'), 'utf8');

describe('isAppAccessAllowed', () => {
  test('production allows Mark with no time limit', () => {
    expect(isAppAccessAllowed(MARK_USER_ID, 'production', new Date('2026-12-01T00:00:00Z'))).toBe(true);
  });

  test('production allows Paul with no time limit', () => {
    expect(isAppAccessAllowed(PAUL_USER_ID, 'production', new Date('2026-11-09T00:00:00Z'))).toBe(true);
    expect(isAppAccessAllowed('paulclough', 'production', new Date('2027-06-01T00:00:00Z'))).toBe(true);
  });

  test('production refuses everyone else', () => {
    expect(isAppAccessAllowed('harry', 'production')).toBe(false);
    expect(isAppAccessAllowed('', 'production')).toBe(false);
    expect(isAppAccessAllowed(null, 'production')).toBe(false);
    expect(isAppAccessAllowed(undefined, 'production')).toBe(false);
  });

  test('non-production does not lock anyone out', () => {
    expect(isAppAccessAllowed('paulclough', 'test')).toBe(true);
    expect(isAppAccessAllowed('harry', 'development')).toBe(true);
  });
});

describe('canCreateQuotes', () => {
  test('Paul can sign in and create quotes', () => {
    const later = new Date('2026-12-01T12:00:00Z');
    expect(isAppAccessAllowed(PAUL_USER_ID, 'production', later)).toBe(true);
    expect(canCreateQuotes(PAUL_USER_ID, 'production', later)).toBe(true);
  });

  test('Mark can create quotes', () => {
    expect(canCreateQuotes(MARK_USER_ID, 'production')).toBe(true);
  });

  test('the production smoke account can sign in and create quotes', () => {
    expect(isAppAccessAllowed('tq_agent_smoke', 'production')).toBe(true);
    expect(canCreateQuotes('tq_agent_smoke', 'production')).toBe(true);
  });

  test('non-production can create quotes', () => {
    expect(canCreateQuotes(PAUL_USER_ID, 'test')).toBe(true);
  });
});

describe('PDF download stays available when creating quotes is blocked', () => {
  test('the PDF route is not behind requireCanCreateQuotes', () => {
    const start = serverSrc.indexOf("app.post('/api/users/:id/jobs/:jobId/pdf'");
    const block = serverSrc.slice(start, start + 250);
    expect(block).not.toMatch(/requireCanCreateQuotes/);
  });

  test('creating a job and running an analysis are blocked', () => {
    expect(serverSrc).toMatch(/app\.post\('\/api\/users\/:id\/jobs', requireCanCreateQuotes/);
    expect(serverSrc).toMatch(/app\.post\('\/api\/users\/:id\/analyse', aiRateLimitPerIp, aiRateLimit, requireCanCreateQuotes/);
    expect(serverSrc).toMatch(/app\.post\('\/api\/users\/:id\/jobs\/:jobId\/video',\s*\n\s*requireAuth,\s*\n\s*requireCanCreateQuotes/);
  });

  test('opening a saved quote still offers Download PDF and hides re-analyse when quoting is off', () => {
    expect(appSrc).toMatch(/onEditQuote=\{canCreateQuotes \? handleEditQuote : null\}/);
    expect(dashboardSrc).toMatch(/canCreateQuotes && currentDraft/);
  });

  test('startup comps Paul without changing his plan or Stripe fields', () => {
    const idx = serverSrc.indexOf("WHERE id = 'paulclough'");
    expect(idx).toBeGreaterThan(-1);
    const start = serverSrc.lastIndexOf('await client.query', idx);
    const sql = serverSrc.slice(start, idx + 160);
    expect(sql).toMatch(/SET comp_until = TIMESTAMPTZ '2027-12-31 23:59:59\+00'/);
    expect(sql).toMatch(/comp_until IS NULL OR comp_until < TIMESTAMPTZ '2027-12-31 23:59:59\+00'/);
    expect(sql).not.toMatch(/plan/);
    expect(sql).not.toMatch(/subscription_/);
    expect(sql).not.toMatch(/auth_provider/);
  });
});
