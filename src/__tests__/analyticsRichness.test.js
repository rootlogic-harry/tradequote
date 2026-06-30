/**
 * TRQ-15 — Analytics dashboard becomes richer.
 *
 * Covers four surfaces:
 *   1. Schema       — system_errors + pageviews tables exist with the
 *                     expected columns and indexes.
 *   2. Server       — /api/track endpoint is mounted, rate-limited, and
 *                     drops bots; safeError's system_errors capture is
 *                     wired; the /api/admin/analytics payload exposes
 *                     the new sections.
 *   3. Client       — trackPageview installs + honours DNT; Analytics.jsx
 *                     renders the new sections.
 *   4. Landing      — the inline beacon is present and POSTs /api/track.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const safeErrorSrc = readFileSync(join(repoRoot, 'safeError.js'), 'utf8');
const analyticsSrc = readFileSync(join(repoRoot, 'src/components/Analytics.jsx'), 'utf8');
const trackPageviewSrc = readFileSync(join(repoRoot, 'src/utils/trackPageview.js'), 'utf8');
const mainSrc = readFileSync(join(repoRoot, 'src/main.jsx'), 'utf8');

describe('schema — TRQ-15 new tables', () => {
  test('system_errors table is created with the documented columns', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS system_errors[\s\S]*?id SERIAL PRIMARY KEY/);
    // Required columns for the dashboard.
    for (const col of ['user_id', 'source', 'route', 'status_code', 'message', 'stack', 'user_agent', 'created_at']) {
      expect(serverSrc).toMatch(new RegExp(`system_errors[\\s\\S]*?${col}`));
    }
    // user_id is REFERENCES users(id) but nullable (errors can happen
    // before auth) — make sure it isn't NOT NULL.
    const block = serverSrc.match(/CREATE TABLE IF NOT EXISTS system_errors[\s\S]*?\);/)[0];
    expect(block).toMatch(/user_id TEXT REFERENCES users\(id\)/);
    expect(block).not.toMatch(/user_id TEXT NOT NULL/);
  });

  test('pageviews table is created with the documented columns', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS pageviews[\s\S]*?id SERIAL PRIMARY KEY/);
    for (const col of ['path', 'referrer', 'ua_hash', 'session_id', 'user_id', 'created_at']) {
      expect(serverSrc).toMatch(new RegExp(`pageviews[\\s\\S]*?${col}`));
    }
  });

  test('both new tables have created_at indexes for time-window queries', () => {
    expect(serverSrc).toMatch(/CREATE INDEX IF NOT EXISTS idx_system_errors_created/);
    expect(serverSrc).toMatch(/CREATE INDEX IF NOT EXISTS idx_pageviews_created/);
  });
});

describe('server — safeError captures 5xx to system_errors', () => {
  test('safeError exports setSystemErrorLogger', () => {
    expect(safeErrorSrc).toMatch(/export function setSystemErrorLogger/);
  });

  test('safeError only logs 5xx, not transient infra blips or 4xx', () => {
    expect(safeErrorSrc).toMatch(
      /statusCode\s*>=\s*500\s*&&\s*!isTransientInfrastructureError\(err\)\s*&&\s*systemErrorLogger/
    );
  });

  test('safeError swallows logger failures so they never block the response', () => {
    // try/catch around the logger call.
    expect(safeErrorSrc).toMatch(/try\s*\{\s*systemErrorLogger\(/);
  });

  test('server.js wires setSystemErrorLogger after the DB is ready', () => {
    expect(serverSrc).toMatch(/import\s*\{[^}]*setSystemErrorLogger[^}]*\}\s*from\s*['"]\.\/safeError\.js['"]/);
    expect(serverSrc).toMatch(/setSystemErrorLogger\(logSystemError\)/);
  });

  test('logSystemError truncates message + stack to bounded sizes', () => {
    expect(serverSrc).toMatch(/function logSystemError/);
    expect(serverSrc).toMatch(/\.slice\(0,\s*2000\)/);
    expect(serverSrc).toMatch(/\.slice\(0,\s*8000\)/);
  });

  test('global Express error middleware also persists 5xx to system_errors', () => {
    // The body-parser/uncaught-throw handler must call logSystemError
    // so we don't lose errors that bypass safeError.
    const idx = serverSrc.indexOf("'entity.too.large'");
    expect(idx).toBeGreaterThan(-1);
    const block = serverSrc.slice(idx, idx + 2000);
    expect(block).toMatch(/logSystemError\(req,\s*err,\s*500\)/);
  });
});

describe('server — POST /api/track', () => {
  const start = serverSrc.indexOf("app.post('/api/track'");
  const end = serverSrc.indexOf("// --- Error handler for body-parser", start);
  const block = serverSrc.slice(start, end);

  test('endpoint is mounted', () => {
    expect(start).toBeGreaterThan(-1);
  });

  test('rate-limited (no auth = open endpoint, must be capped)', () => {
    expect(serverSrc).toMatch(/const pageviewRateLimit\s*=\s*rateLimit\(/);
    // The route uses the limiter as middleware.
    expect(block).toMatch(/pageviewRateLimit/);
  });

  test('returns 204 on bad input (silent — never surfaces to client)', () => {
    // No path → 204 not 400.
    expect(block).toMatch(/res\.status\(204\)\.end\(\)/);
    // Catch arm also returns 204 so retries don't compound.
    expect(block).toMatch(/catch[\s\S]*?res\.status\(204\)\.end\(\)/);
  });

  test('rejects bot UAs before the INSERT', () => {
    expect(block).toMatch(/isBotUserAgent\(ua\)/);
    expect(serverSrc).toMatch(/function isBotUserAgent/);
    expect(serverSrc).toMatch(/'bot'/);
    expect(serverSrc).toMatch(/'crawler'/);
  });

  test('hashes user-agent (no raw UA stored)', () => {
    expect(block).toMatch(/crypto\.createHash\(['"]sha256['"]\)/);
    expect(block).toMatch(/ua_hash/);
  });

  test('inserts into pageviews with parameterised SQL (no string concat)', () => {
    expect(block).toMatch(/INSERT INTO pageviews[\s\S]*VALUES\s*\(\$1/);
  });

  test('attaches user_id only when authenticated (anonymous landing stays anon)', () => {
    expect(block).toMatch(/req\.user\?\.id\s*\|\|\s*req\.session\?\.legacyUserId\s*\|\|\s*null/);
  });
});

describe('server — /api/admin/analytics payload (TRQ-15 enrichments)', () => {
  const start = serverSrc.indexOf("app.get('/api/admin/analytics'");
  const end = serverSrc.indexOf("// Approved calibration notes for system prompt", start);
  const block = serverSrc.slice(start, end);

  test('per-user roll-up exposes ramsCount + activeDays + failedAnalyseCalls', () => {
    expect(block).toMatch(/ramsCount/);
    expect(block).toMatch(/activeDays/);
    expect(block).toMatch(/failedAnalyseCalls/);
    // SQL backing those: has_rams filter + COUNT DISTINCT DATE.
    expect(block).toMatch(/has_rams = TRUE/);
    expect(block).toMatch(/COUNT\(DISTINCT DATE\(saved_at\)\)/);
  });

  test('series.quotesPerWeek is computed over a fixed 12-week window', () => {
    expect(block).toMatch(/quotesPerWeek/);
    expect(block).toMatch(/DATE_TRUNC\(['"]week['"],\s*saved_at\)/);
    expect(block).toMatch(/INTERVAL ['"]12 weeks['"]/);
  });

  test('series.failuresPerDay + signupsPerDay + pageviewsPerDay computed for 30d', () => {
    for (const key of ['failuresPerDay', 'signupsPerDay', 'pageviewsPerDay']) {
      expect(block).toMatch(new RegExp(key));
    }
    // pageviewsPerDay reads from the new pageviews table.
    expect(block).toMatch(/FROM pageviews/);
  });

  test('retention metrics computed (newSignups30d / d7Active / d14Active)', () => {
    expect(block).toMatch(/newSignups30d/);
    expect(block).toMatch(/convertedIn7d/);
    expect(block).toMatch(/d7Active/);
    expect(block).toMatch(/d14Active/);
    // Conversion rate divisor must avoid /0.
    expect(block).toMatch(/retention\.newSignups30d > 0/);
  });

  test('errors.{perDay,recent,total30d} sourced from system_errors', () => {
    expect(block).toMatch(/FROM system_errors/);
    expect(block).toMatch(/errors:[\s\S]*perDay/);
    expect(block).toMatch(/errors:[\s\S]*recent/);
    expect(block).toMatch(/total30d/);
  });

  test('all new queries run in the same Promise.all (no extra round-trips)', () => {
    // The Promise.all destructure has to include the new result variables.
    expect(block).toMatch(/quotesPerWeekRes/);
    expect(block).toMatch(/failuresPerDayRes/);
    expect(block).toMatch(/errorsPerDayRes/);
    expect(block).toMatch(/retentionRes/);
  });
});

describe('client — trackPageview utility', () => {
  test('exports installSpaPageviewBeacon + trackPageview', () => {
    expect(trackPageviewSrc).toMatch(/export function installSpaPageviewBeacon/);
    expect(trackPageviewSrc).toMatch(/export function trackPageview/);
  });

  test('honours navigator.doNotTrack', () => {
    expect(trackPageviewSrc).toMatch(/doNotTrack/);
  });

  test('wraps history.pushState + replaceState (one beacon per route change)', () => {
    expect(trackPageviewSrc).toMatch(/pushState/);
    expect(trackPageviewSrc).toMatch(/replaceState/);
    // popstate covers back/forward navigation.
    expect(trackPageviewSrc).toMatch(/popstate/);
  });

  test('uses fetch keepalive so the beacon survives navigation', () => {
    expect(trackPageviewSrc).toMatch(/keepalive:\s*true/);
  });

  test('never throws out of the beacon (defensive try/catch)', () => {
    expect(trackPageviewSrc).toMatch(/try\s*\{[\s\S]*?\}\s*catch/);
  });

  test('install is idempotent (guards against double-install)', () => {
    expect(trackPageviewSrc).toMatch(/installed/);
    expect(trackPageviewSrc).toMatch(/__fq_wrapped/);
  });

  test('main.jsx calls installSpaPageviewBeacon at startup', () => {
    expect(mainSrc).toMatch(/installSpaPageviewBeacon\(\)/);
    expect(mainSrc).toMatch(/from\s+['"]\.\/utils\/trackPageview\.js['"]/);
  });
});

describe('landing — inline beacon in LANDING_PAGE_HTML', () => {
  test('beacon script is present in the landing page HTML template', () => {
    // Anchor near the LANDING_PAGE_HTML template literal. The slice
    // window has to be wide enough to capture the inline beacon, which
    // sits after the (now much richer) JSON-LD @graph block.
    const idx = serverSrc.indexOf('const LANDING_PAGE_HTML');
    expect(idx).toBeGreaterThan(-1);
    const block = serverSrc.slice(idx, idx + 30_000);
    expect(block).toMatch(/POST['"]?[\s\S]{0,500}\/api\/track|fetch\(['"]\/api\/track['"]/);
    expect(block).toMatch(/doNotTrack/);
    expect(block).toMatch(/fq_session_id/);
  });
});

describe('client — Analytics.jsx renders the new sections', () => {
  test('imports useState for the new ErrorsSection filter (already imported)', () => {
    expect(analyticsSrc).toMatch(/import React, \{ useEffect, useState \}/);
  });

  test('per-user table gains RAMS / Active days / Fails columns', () => {
    expect(analyticsSrc).toMatch(/>RAMS</);
    expect(analyticsSrc).toMatch(/>Active days</);
    expect(analyticsSrc).toMatch(/>Fails</);
    expect(analyticsSrc).toMatch(/ramsCount/);
    expect(analyticsSrc).toMatch(/activeDays/);
    expect(analyticsSrc).toMatch(/failedAnalyseCalls/);
  });

  test('renders RetentionSection, ActivitySection, PageviewsSection, ErrorsSection', () => {
    for (const fn of ['RetentionSection', 'ActivitySection', 'PageviewsSection', 'ErrorsSection']) {
      expect(analyticsSrc).toMatch(new RegExp(`function ${fn}\\b`));
      expect(analyticsSrc).toMatch(new RegExp(`<${fn}\\b`));
    }
  });

  test('TimeSeriesSparkline accepts a generic series + optional bars mode', () => {
    expect(analyticsSrc).toMatch(/function TimeSeriesSparkline/);
    expect(analyticsSrc).toMatch(/bars\s*=\s*false/);
  });

  test('errors section table filters by source via pills', () => {
    expect(analyticsSrc).toMatch(/sourceFilter/);
    expect(analyticsSrc).toMatch(/setSourceFilter/);
  });

  test('retention section renders D7/D14 metrics with safe division', () => {
    // The "eligibleUsers > 0" guard prevents /0 NaN in the UI.
    expect(analyticsSrc).toMatch(/retention\.eligibleUsers > 0/);
    expect(analyticsSrc).toMatch(/D7 active/);
    expect(analyticsSrc).toMatch(/D14 active/);
  });
});
