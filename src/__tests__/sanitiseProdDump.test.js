/**
 * TRQ-153 prep — guards for the prod-dump sanitiser script + runbook.
 *
 * The sanitiser is what makes staging safe to exist. A regression
 * here doubles the GDPR surface (real customer data sitting in two
 * environments). These tests assert the script's structural promises
 * + a behavioural test on a synthetic dump fixture.
 *
 * What's covered:
 *   1. Script refuses to run without SANITISER_SALT (no default).
 *   2. Script never connects to a database.
 *   3. Every PII-bearing table has a sanitisation rule.
 *   4. Behavioural: sanitiser actually scrubs the documented columns
 *      when fed a synthetic pg_dump fragment.
 *   5. Runbook documents the Harry-only setup + isolation requirement.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptSrc = readFileSync(join(repoRoot, 'scripts/sanitise-prod-dump.js'), 'utf8');
const runbook = readFileSync(join(repoRoot, 'docs/STAGING.md'), 'utf8');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');

describe('TRQ-153 — sanitiser script structural guards', () => {
  test('refuses to run without SANITISER_SALT env var', () => {
    expect(scriptSrc).toMatch(/SANITISER_SALT[\s\S]{0,200}required/i);
    expect(scriptSrc).toMatch(/process\.exit\(2\)/);
  });

  test('never connects to a database (no pg / no @aws-sdk import)', () => {
    // The whole safety story is "script only reads stdin and writes
    // stdout". If a future refactor adds a DB client, this fails.
    expect(scriptSrc).not.toMatch(/from\s+['"]pg['"]/);
    expect(scriptSrc).not.toMatch(/import\s+pg\s+from/);
    expect(scriptSrc).not.toMatch(/@aws-sdk/);
  });

  test('uses deterministic salted hash (same name → same fake across runs)', () => {
    expect(scriptSrc).toMatch(/createHash\(['"]sha256['"]\)/);
    expect(scriptSrc).toMatch(/SALT \+ ':'/);
  });

  test('stream-based (createInterface + line-by-line, no buffer-the-whole-file)', () => {
    expect(scriptSrc).toMatch(/createInterface/);
    expect(scriptSrc).toMatch(/rl\.on\(['"]line['"]/);
    expect(scriptSrc).not.toMatch(/readFileSync\(\s*['"]?\/dev\/stdin/);
  });
});

describe('TRQ-153 — sanitisation rules cover every PII-bearing table', () => {
  // Source of truth: CREATE TABLE statements in server.js. If a new
  // PII-bearing table lands and isn't added to SANITISE_RULES, this
  // test will fail when the table list grows.
  const piiTables = [
    'users', 'profiles', 'jobs', 'drafts',
    'user_photos', 'system_errors', 'pageviews', 'admin_audit',
    'dictation_runs',
  ];

  test.each(piiTables)('SANITISE_RULES has an entry for %s', (table) => {
    expect(scriptSrc).toMatch(new RegExp(`${table}:\\s*\\{`));
  });

  test('users rule scrubs name + email + avatar_url + auth_provider_id', () => {
    const idx = scriptSrc.indexOf('users: {');
    const block = scriptSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/FAKE_USER_NAMES/);
    expect(block).toMatch(/FAKE_USER_EMAILS/);
    expect(block).toMatch(/avatar_url/);
    expect(block).toMatch(/auth_provider_id/);
  });

  test('jobs rule nullifies client_ip + client_user_agent', () => {
    const idx = scriptSrc.indexOf('jobs: {');
    const block = scriptSrc.slice(idx, idx + 2000);
    // The audit-only IP / UA columns should be set to \N (the NULL
    // marker in pg_dump COPY format), not just hashed.
    expect(block).toMatch(/client_ip[\s\S]{0,80}\\\\N/);
    expect(block).toMatch(/client_user_agent[\s\S]{0,80}\\\\N/);
  });

  test('jobs rule scrubs all four JSONB snapshot columns', () => {
    const idx = scriptSrc.indexOf('jobs: {');
    const block = scriptSrc.slice(idx, idx + 2000);
    for (const col of ['quote_snapshot', 'rams_snapshot', 'client_snapshot', 'client_snapshot_profile']) {
      expect(block).toMatch(new RegExp(col));
    }
  });

  test('user_photos rule replaces real base64 with a placeholder PNG', () => {
    expect(scriptSrc).toMatch(/STAGING_PLACEHOLDER_PNG/);
    expect(scriptSrc).toMatch(/data:image\/png;base64/);
  });

  test('JSONB PII keys are all scrubbed: clientName, siteAddress, email, phone, vatNumber, tradingAddress, logo', () => {
    expect(scriptSrc).toMatch(/"clientName":/);
    expect(scriptSrc).toMatch(/"siteAddress":/);
    expect(scriptSrc).toMatch(/"clientEmail":/);
    expect(scriptSrc).toMatch(/"clientPhone":/);
    expect(scriptSrc).toMatch(/"companyName":/);
    expect(scriptSrc).toMatch(/"phone":/);
    expect(scriptSrc).toMatch(/"email":/);
    expect(scriptSrc).toMatch(/"vatNumber":/);
    expect(scriptSrc).toMatch(/"tradingAddress":/);
    expect(scriptSrc).toMatch(/"logo":/);
  });
});

describe('TRQ-153 — non-PII tables intentionally pass through', () => {
  // These tables hold no PII directly — only measurements, tokens,
  // metadata. They MUST pass through unchanged so the moat preserves
  // its learning value in staging.
  const passthroughTables = ['quote_diffs', 'agent_runs', 'calibration_notes',
                              'agent_retry_queue', 'session', 'settings'];

  test('runbook explicitly names these as pass-through', () => {
    for (const t of passthroughTables) {
      expect(runbook).toMatch(new RegExp(t));
    }
  });

  test('SANITISE_RULES does NOT have an entry for quote_diffs / agent_runs / calibration_notes', () => {
    // If a future change accidentally adds a rule for these the
    // moat copy in staging will be quietly corrupted. Hard guard.
    expect(scriptSrc).not.toMatch(/^\s*quote_diffs:\s*\{/m);
    expect(scriptSrc).not.toMatch(/^\s*agent_runs:\s*\{/m);
    expect(scriptSrc).not.toMatch(/^\s*calibration_notes:\s*\{/m);
  });
});

describe('TRQ-153 — sanitiser behavioural test against synthetic dump', () => {
  // Synthetic pg_dump fragment with one row in users + one row in jobs.
  // Feed it through the script and confirm the output:
  //   1. Replaces the real name/email with a deterministic fake.
  //   2. NULLs client_ip + client_user_agent.
  //   3. Scrubs clientName inside the JSONB quote_snapshot.
  //   4. Same SALT → same fake.

  const synthetic = [
    '-- comment',
    'COPY public.users (id, name, email, avatar_url, auth_provider_id) FROM stdin;',
    'realuser123\tJane Doe\tjane@real-company.com\thttps://lh3.googleusercontent.com/abc\t9876543210',
    '\\.',
    'COPY public.jobs (id, user_id, client_name, site_address, client_ip, client_user_agent, quote_snapshot) FROM stdin;',
    'job001\trealuser123\tBob Homeowner\t42 Real Street, RealTown\t203.0.113.5\tMozilla/5.0 (real)\t{"clientName":"Bob Homeowner","siteAddress":"42 Real Street","total":1500}',
    '\\.',
    'SELECT 1;',
  ].join('\n');

  function runSanitiser(salt = 'test-salt-xyz') {
    const proc = spawnSync(
      'node',
      [join(repoRoot, 'scripts/sanitise-prod-dump.js')],
      {
        input: synthetic,
        env: { ...process.env, SANITISER_SALT: salt },
        encoding: 'utf8',
        timeout: 5000,
      }
    );
    return { stdout: proc.stdout, stderr: proc.stderr, status: proc.status };
  }

  test('exits 2 without SANITISER_SALT', () => {
    const proc = spawnSync(
      'node',
      [join(repoRoot, 'scripts/sanitise-prod-dump.js')],
      { input: 'irrelevant', env: { ...process.env, SANITISER_SALT: '' }, encoding: 'utf8', timeout: 5000 }
    );
    expect(proc.status).toBe(2);
  });

  test('real name is replaced with a "Demo Trader N" fake', () => {
    const { stdout, status } = runSanitiser();
    expect(status).toBe(0);
    expect(stdout).not.toContain('Jane Doe');
    expect(stdout).toMatch(/Demo Trader \d+/);
  });

  test('real email is replaced with @staging.fastquote.invalid', () => {
    const { stdout } = runSanitiser();
    expect(stdout).not.toContain('jane@real-company.com');
    expect(stdout).toMatch(/demo-trader-\d+@staging\.fastquote\.invalid/);
  });

  test('client_ip and client_user_agent are NULLed (\\N marker)', () => {
    const { stdout } = runSanitiser();
    expect(stdout).not.toContain('203.0.113.5');
    expect(stdout).not.toContain('Mozilla/5.0 (real)');
  });

  test('clientName inside JSONB quote_snapshot is replaced', () => {
    const { stdout } = runSanitiser();
    expect(stdout).not.toContain('"clientName":"Bob Homeowner"');
    expect(stdout).toMatch(/"clientName":"Test Client [A-Z]"/);
  });

  test('siteAddress inside JSONB is replaced', () => {
    const { stdout } = runSanitiser();
    expect(stdout).toMatch(/"siteAddress":"Sample Address Lane \d+/);
  });

  test('numeric / structural fields pass through (total: 1500 preserved)', () => {
    const { stdout } = runSanitiser();
    expect(stdout).toMatch(/"total":1500/);
  });

  test('same SALT → same fakes (deterministic)', () => {
    const run1 = runSanitiser('deterministic-salt');
    const run2 = runSanitiser('deterministic-salt');
    expect(run1.stdout).toBe(run2.stdout);
  });

  test('different SALT → different fakes', () => {
    const run1 = runSanitiser('salt-a');
    const run2 = runSanitiser('salt-b');
    // Not identical (at least one fake mapping differs).
    expect(run1.stdout).not.toBe(run2.stdout);
  });

  test('pass-through lines (comments, SQL) are preserved verbatim', () => {
    const { stdout } = runSanitiser();
    expect(stdout).toContain('-- comment');
    expect(stdout).toContain('SELECT 1;');
  });

  test('stats logged to stderr (not stdout, which is the sanitised SQL stream)', () => {
    const { stdout, stderr } = runSanitiser();
    expect(stderr).toMatch(/transformed \d+ rows/);
    expect(stdout).not.toMatch(/sanitise-prod-dump: ok/);
  });
});

describe('TRQ-153 — STAGING.md runbook', () => {
  test('flags the Harry-only setup steps', () => {
    expect(runbook).toMatch(/Harry-only setup/i);
    expect(runbook).toMatch(/Railway dashboard/);
  });

  test('hard rule: staging cannot reach prod DB', () => {
    expect(runbook).toMatch(/nothing in staging can reach the prod DB/i);
  });

  test('Stripe live-mode never goes in staging', () => {
    expect(runbook).toMatch(/sk_live_|live key/);
    expect(runbook).toMatch(/test mode only|test keys|sk_test_/);
  });

  test('promote-to-prod flow is documented', () => {
    expect(runbook).toMatch(/Promote-to-prod/);
    expect(runbook).toMatch(/Validate on staging/);
  });

  test('lists which changes MUST go through staging vs which can skip', () => {
    expect(runbook).toMatch(/MUST go through staging/);
    expect(runbook).toMatch(/Routine changes that can skip staging/);
  });

  test('refresh cadence documented (monthly)', () => {
    expect(runbook).toMatch(/monthly/i);
  });

  test('honestly says what this PR does NOT ship', () => {
    expect(runbook).toMatch(/What's NOT in this PR/);
    expect(runbook).toMatch(/Harry-only/);
  });
});

describe('TRQ-153 — schema-tracking: all CREATE TABLEs are accounted for', () => {
  const declaredTables = Array.from(
    serverJs.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)
  ).map((m) => m[1]);

  test('every prod table is either sanitised or explicitly passed through', () => {
    // The whole point of this guard: a future TRQ that adds a new
    // PII-bearing table without updating the sanitiser is silently
    // dangerous. This test fails until the table is either added
    // to SANITISE_RULES or named in STAGING.md as pass-through.
    for (const t of declaredTables) {
      const hasRule = scriptSrc.includes(`${t}: {`);
      const isDocumented = runbook.includes(t);
      // Either the sanitiser handles it, or the runbook explicitly
      // says it passes through. Both is fine too.
      expect(hasRule || isDocumented).toBe(true);
    }
  });
});

describe('TRQ-153 — 2026-06-18 staging-seed regressions (quoted COPY + JSONB whitespace + free-text)', () => {
  // These tests pin the four bugs that surfaced when the sanitiser
  // was first run against a real pg_dump v18 backup. Each one let
  // real customer PII through.

  function runSanitiserOn(input, salt = 'test-salt-xyz') {
    const proc = spawnSync(
      'node',
      [join(repoRoot, 'scripts/sanitise-prod-dump.js')],
      { input, env: { ...process.env, SANITISER_SALT: salt }, encoding: 'utf8', timeout: 5000 }
    );
    return { stdout: proc.stdout, stderr: proc.stderr, status: proc.status };
  }

  test('Regression 1: pg_dump v18-style quoted COPY identifiers are detected', () => {
    // pg_dump (v17+ default) emits:
    //   COPY "public"."users" ("id", "name", "email", ...) FROM stdin;
    // pg_dump (earlier default) emitted:
    //   COPY public.users (id, name, email, ...) FROM stdin;
    // The original regex only matched the unquoted form, so the
    // sanitiser silently passed quoted blocks through unchanged.
    const quoted = [
      'COPY "public"."users" ("id", "name", "email", "avatar_url", "auth_provider_id") FROM stdin;',
      'realuser\tJane Real\tjane@real.example\t\\N\t\\N',
      '\\.',
    ].join('\n');
    const { stdout, status } = runSanitiserOn(quoted);
    expect(status).toBe(0);
    expect(stdout).not.toContain('Jane Real');
    expect(stdout).not.toContain('jane@real.example');
    expect(stdout).toMatch(/Demo Trader \d+/);
  });

  test('Regression 2: JSONB scrub matches keys with whitespace around the colon', () => {
    // Postgres-stored JSONB usually has `"k":"v"` (no space), but
    // JSON inserted via pretty-printed JSON.stringify has `"k": "v"`.
    // The original regexes only matched the no-space form.
    const withSpace = [
      'COPY "public"."profiles" ("user_id", "data") FROM stdin;',
      'u1\t{"email": "leaky@real.com", "phone": "07986 123456", "fullName": "Real Person"}',
      '\\.',
    ].join('\n');
    const { stdout } = runSanitiserOn(withSpace);
    expect(stdout).not.toContain('leaky@real.com');
    expect(stdout).not.toContain('Real Person');
    // Phone field has a space — the structured replacer should zero
    // it (we don't expect the literal "07986 123456" to survive).
    expect(stdout).not.toContain('07986 123456');
  });

  test('Regression 3: RAMS / nested-profile fields are scrubbed (company, contactName, foreman, fullName, contactNumber, supervisor)', () => {
    // jobs.rams_snapshot uses different JSON keys than the quote
    // snapshot — company / contactName / foreman / contactNumber —
    // and the previous version of the sanitiser missed all of them.
    // fullName showed up via drafts.data too because drafts used
    // scrubJsonbPii (no fullName) instead of scrubProfileJsonb.
    const rams = [
      'COPY "public"."jobs" ("id", "user_id", "client_name", "site_address", "client_ip", "client_user_agent", "client_decline_reason", "quote_snapshot", "rams_snapshot", "client_snapshot", "client_snapshot_profile") FROM stdin;',
      'j1\tu1\treal client\treal addr\t\\N\t\\N\t\\N\t{"profile":{"fullName":"Mark Real"}}\t{"company":"Real Walling Co","contactName":"Mark Real","foreman":"Mark Real","supervisor":"Mark Real","contactNumber":"07700900111"}\t\\N\t\\N',
      '\\.',
    ].join('\n');
    const { stdout } = runSanitiserOn(rams);
    expect(stdout).not.toContain('Mark Real');
    expect(stdout).not.toContain('Real Walling Co');
    expect(stdout).not.toContain('07700900111');
  });

  test('Regression 4a: free-text email leak is redacted anywhere in JSONB', () => {
    // Users sometimes type their full contact card into notes /
    // quotePayload fields that aren\'t keyed off a known JSON
    // property. A catch-all regex sweep is the only way to catch
    // these.
    const freeText = [
      'COPY "public"."jobs" ("id", "user_id", "client_name", "site_address", "client_ip", "client_user_agent", "client_decline_reason", "quote_snapshot", "rams_snapshot", "client_snapshot", "client_snapshot_profile") FROM stdin;',
      'j1\tu1\treal\treal\t\\N\t\\N\t\\N\t{"notes":"call me at MARK@DRYSTONEWALLING.NET or 07986 661828 for the deposit"}\t\\N\t\\N\t\\N',
      '\\.',
    ].join('\n');
    const { stdout } = runSanitiserOn(freeText);
    expect(stdout).not.toContain('MARK@DRYSTONEWALLING.NET');
    expect(stdout).not.toContain('07986 661828');
    expect(stdout).toMatch(/\[redacted-email\]/);
    expect(stdout).toMatch(/\[redacted-phone\]/);
  });

  test('Regression 4b: phone redaction does NOT bite into long float values', () => {
    // The first version of the catch-all matched 07XXX_XXXXXX
    // anywhere — which included digit substrings inside floats like
    // `"editMagnitude": -0.8076923076923077`. That broke the JSONB
    // ("Expected , or } but found [") and dropped 59 jobs on the
    // first staging seed. The (?<!\d) ... (?!\d) lookarounds fix it.
    const withFloats = [
      'COPY "public"."quote_diffs" ("id", "user_id", "job_id", "ai_value", "confirmed_value", "metadata") FROM stdin;',
      'd1\tu1\tj1\t13.5\t12.0\t{"wallHeightMm": 1500, "wallLengthMm": 1, "editMagnitude": -0.8076923076923077, "confirmedValue": 25}',
      '\\.',
    ].join('\n');
    const { stdout } = runSanitiserOn(withFloats);
    // The full float survives intact.
    expect(stdout).toContain('-0.8076923076923077');
    expect(stdout).not.toContain('[redacted-phone]');
  });

  test('Regression 4c: emails inside word-like contexts are still redacted (boundary too tight is also bad)', () => {
    // The (?<!\w) and (?!\w) guards must not be so tight that real
    // emails get missed. Surrounding whitespace / quotes / pipes are
    // the common cases.
    const variants = [
      'COPY "public"."jobs" ("id", "user_id", "client_name", "site_address", "client_ip", "client_user_agent", "client_decline_reason", "quote_snapshot", "rams_snapshot", "client_snapshot", "client_snapshot_profile") FROM stdin;',
      'j1\tu1\treal\treal\t\\N\t\\N\t\\N\t{"a":"x foo@bar.com y","b":"|baz@qux.co.uk|","c":"\\"name@example.com\\""}\t\\N\t\\N\t\\N',
      '\\.',
    ].join('\n');
    const { stdout } = runSanitiserOn(variants);
    expect(stdout).not.toContain('foo@bar.com');
    expect(stdout).not.toContain('baz@qux.co.uk');
    expect(stdout).not.toContain('name@example.com');
  });
});
