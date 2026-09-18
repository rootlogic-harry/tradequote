/**
 * Source-level guards for the admin analytics endpoint (TRQ-174).
 *
 * The endpoint is the single feed for the Analytics dashboard. These
 * assertions catch regressions that would silently break a section of
 * the UI (e.g. a future refactor that drops the per-quote roll-up or
 * forgets requireAdminPlan).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('admin analytics endpoint guards', () => {
  // Locate the route block once.
  const start = serverSrc.indexOf("app.get('/api/admin/analytics'");
  const end = serverSrc.indexOf("// Approved calibration notes for system prompt", start);
  const block = serverSrc.slice(start, end);

  test('endpoint exists and is admin-gated', () => {
    expect(start).toBeGreaterThan(-1);
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/api\/admin\/analytics['"][\s\S]*requireAuth[\s\S]*requireAdminPlan/
    );
  });

  test('range param is validated against an allowlist', () => {
    expect(block).toMatch(/\['24h',\s*'7d',\s*'30d',\s*'all'\]\.includes/);
  });

  test('response cached server-side to avoid hammering DB on refresh', () => {
    expect(block).toMatch(/analyticsCache/);
    expect(block).toMatch(/ANALYTICS_CACHE_MS/);
  });

  test('returns required top-level sections', () => {
    expect(block).toMatch(/users:/);
    expect(block).toMatch(/quotes:/);
    expect(block).toMatch(/perUser/);
    expect(block).toMatch(/perQuote/);
    expect(block).toMatch(/spend:/);
    expect(block).toMatch(/reliability:/);
    expect(block).toMatch(/portal:/);
  });

  test('runs the per-section queries in parallel via Promise.all', () => {
    expect(block).toMatch(/Promise\.all\(\[/);
  });

  test('joins agent_runs with jobs for per-quote spend', () => {
    expect(block).toMatch(/agent_runs[\s\S]*LEFT JOIN jobs/);
  });

  test('estimated cost in GBP uses tokensToGbp helper (not inlined)', () => {
    expect(block).toMatch(/tokensToGbp\(/);
    expect(block).toMatch(/whisperBytesToGbp\(/);
  });

  test('exposes pricing assumptions to the dashboard so admins know freshness', () => {
    expect(block).toMatch(/getPriceMap\(\)/);
  });

  test('NEVER interpolates user input into the SQL interval expression', () => {
    // The interval comes from a hard-coded map (24h/7d/30d/all). Any
    // future refactor that interpolates req.query directly would be
    // SQL injection. This assertion documents the invariant.
    expect(block).toMatch(/rangeToInterval/);
    expect(block).not.toMatch(/req\.query\.range[^a-zA-Z]+\s*\+|`\$\{req\.query\.range\}`/);
  });

  test('dormant-user count uses 14-day cutoff', () => {
    expect(block).toMatch(/14/);
    expect(block).toMatch(/dormant/);
  });

  // TRQ-176: pre-TRQ-173 agent_runs rows have model IS NULL.
  // jsonb_object_agg throws on NULL keys → entire endpoint 500'd.
  // Regression guard: the by_model aggregation must coalesce the
  // model column to a placeholder before aggregating.
  test('jsonb_object_agg coerces NULL model to a placeholder key', () => {
    expect(block).toMatch(/jsonb_object_agg\(COALESCE\(model,\s*['"]unknown['"]\)/);
  });

  test('analyse_calls counts only agent_type=analyse rows (not all agents)', () => {
    expect(block).toMatch(/COUNT\(\*\)\s*FILTER\s*\(WHERE\s+agent_type\s*=\s*['"]analyse['"]\)/);
  });

  test('catch block logs the SQL error code so Railway is grep-able', () => {
    expect(block).toMatch(/console\.error\(`?\[Analytics\]/);
  });

  // Ad-attribution PR 2 (2026-08-04, docs/AD_TEST). The dashboard
  // funnel that makes the £100 Meta ad test measurable.
  describe('signupsBySource — ad-attribution funnel query', () => {
    test('per-user SELECT projects the three UTM columns', () => {
      // These flow through the SPA table so a future refactor that
      // silently drops them would break the Source column on the
      // per-user table + the paying signal on the summary.
      expect(block).toMatch(/u\.signup_source AS ["']signupSource["']/);
      expect(block).toMatch(/u\.signup_campaign AS ["']signupCampaign["']/);
      expect(block).toMatch(/u\.signup_medium AS ["']signupMedium["']/);
    });

    test('per-user SELECT projects the two "paying" signals', () => {
      // subscription_status = Stripe truth. purchased_quotes captures
      // the £9.99 pack path. Either > 0 = paying (evaluated in JS
      // below since it needs a null-coalesce for older rows).
      expect(block).toMatch(/u\.subscription_status AS ["']subscriptionStatus["']/);
      expect(block).toMatch(/COALESCE\(u\.purchased_quotes,\s*0\)\s+AS\s+["']purchasedQuotes["']/);
    });

    test('isPaying is computed in the JS shaper (not left to the client)', () => {
      // The client renders the paying column but shouldn't re-derive
      // the truth predicate — that risks drift between the per-user
      // "isPaying" flag and the "paying" count in the summary.
      expect(block).toMatch(/isPaying\s*=\s*u\.subscriptionStatus === ['"]active['"]/);
      expect(block).toMatch(/Number\(u\.purchasedQuotes\)\s*\|\|\s*0\)\s*>\s*0/);
    });

    test('signupsBySource query buckets NULL source as "direct"', () => {
      // The whole point of a summary row for "direct" is that
      // organic / word-of-mouth signups are the counterfactual —
      // without a direct baseline the ad-source rows are unreadable.
      expect(block).toMatch(/signupsBySourceQuery = pool\.query/);
      expect(block).toMatch(/COALESCE\(u\.signup_source,\s*['"]direct['"]\)\s+AS\s+["']source["']/);
    });

    test('signupsBySource query uses events.quote_analysed for "activated"', () => {
      // The events table is server-side + ad-blocker-resistant, so
      // it's the right funnel signal. Using a jobs-side probe here
      // would miss the ad-blocker-affected users that fire events
      // but never see the /api/event beacon.
      expect(block).toMatch(
        /FROM events e[\s\S]*?e\.event_name = ['"]quote_analysed['"]/,
      );
    });

    test('signupsBySource "paying" column matches the per-user predicate', () => {
      // Same OR-of-two-signals used by isPaying above. Drift between
      // the summary column and the per-user isPaying flag would show
      // as summary.paying !== count(perUser.isPaying) for the same
      // source — a Mark-facing bug that's silent unless asserted.
      expect(block).toMatch(
        /u\.subscription_status = ['"]active['"][\s\S]*?COALESCE\(u\.purchased_quotes,\s*0\)\s*>\s*0/,
      );
    });

    test('payload exposes signupsBySource array (shape guarded)', () => {
      expect(block).toMatch(/signupsBySource:\s*signupsBySourceRes\.rows\.map/);
      // Row shape: { source, signups, activated, paying } — all
      // Number()-coerced so the client can render without extra guards.
      expect(block).toMatch(/source:\s*r\.source/);
      expect(block).toMatch(/signups:\s*Number\(r\.signups\)/);
      expect(block).toMatch(/activated:\s*Number\(r\.activated\)/);
      expect(block).toMatch(/paying:\s*Number\(r\.paying\)/);
    });

    test('signupsBySourceQuery hits Promise.all (parallel with siblings)', () => {
      // Serialising this query would push the round-trip past the
      // cache-friendly single-request budget. Guard it lives inside
      // Promise.all with the other section queries.
      expect(block).toMatch(/Promise\.all\(\[[\s\S]*?signupsBySourceQuery[\s\S]*?\]\)/);
    });
  });
});
