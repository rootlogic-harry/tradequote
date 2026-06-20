/**
 * CLI helpers — split out of run.js so they can be unit-tested directly
 * without spawning the whole runner. run.js is the integration point; the
 * pure bits (argument parsing, exit-code decision) live here.
 *
 * The exit-code rules are subtle enough that they deserve their own
 * tests — see src/__tests__/regressionRun.test.js. In particular, the
 * --strict flag does NOT fail when ALL fixtures are skipped, because
 * the "no fixtures yet" passive state is a legitimate intermediate
 * step before TRQ-173 lands real fixtures. Strict only fires once at
 * least one fixture is runnable, because that's when silent skips
 * become a regression risk.
 */

const HELP = `Usage: node regression/run.js [options]

  --iterations N              Iterations per fixture (default 3)
  --base-url URL              FastQuote endpoint (default http://localhost:3000)
  --user-id ID                User to impersonate via x-test-user-id (default markdoyle)
  --fixture ID                Run only the named fixture
  --no-write                  Don't write a report file (stdout only)

  --strict                    Treat skipped fixtures as failures when at least
                              one fixture is runnable. (Env: REGRESSION_STRICT=1)
                              Default-off: today's "no fixtures yet" state stays
                              green. Once fixtures land, this catches the
                              "some skipped, some runnable" regression.
  --require-min-fixtures N    Exit non-zero if fewer than N runnable fixtures
                              exist (default 0 = no minimum).
  --bless                     Write per-fixture baselines to regression/baselines/.
                              A baseline change is a conscious accept-the-new-normal
                              decision — never silent.
`;

export function parseArgs(argv, env = process.env) {
  const out = {
    iterations: 3,
    baseUrl: env.FASTQUOTE_BASE_URL || 'http://localhost:3000',
    testUserId: env.FASTQUOTE_TEST_USER || 'markdoyle',
    fixtureId: null,
    write: true,
    strict: env.REGRESSION_STRICT === '1',
    requireMinFixtures: 0,
    bless: false,
    helpRequested: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations') out.iterations = Number(argv[++i]);
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--user-id') out.testUserId = argv[++i];
    else if (a === '--fixture') out.fixtureId = argv[++i];
    else if (a === '--no-write') out.write = false;
    else if (a === '--strict') out.strict = true;
    else if (a === '--bless') out.bless = true;
    else if (a === '--require-min-fixtures') {
      const v = argv[++i];
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--require-min-fixtures expects a non-negative integer, got: ${v}`);
      }
      out.requireMinFixtures = n;
    } else if (a === '--help' || a === '-h') {
      out.helpRequested = true;
    }
  }
  return out;
}

export function helpText() {
  return HELP;
}

/**
 * Collapse fixture reports + flags into an exit code.
 *
 *  0  → suite passed (or was legitimately inert)
 *  1+ → at least one fixture failed, errored, was skipped under strict,
 *       or the runnable-fixture floor was not met.
 *
 * --strict means "any skip is a failure" — the CLI just honours what
 * it's asked. The decision of WHEN to pass --strict lives in CI
 * (see .github/workflows/regression.yml): the workflow only flips it
 * on once at least one real fixture is committed. That keeps today's
 * "no fixtures yet" state exit-0-green in CI without making the flag
 * itself smart about runnable counts.
 */
export function decideExitCode(fixtureReports, opts) {
  const strict = !!opts?.strict;
  const minFixtures = Number(opts?.requireMinFixtures) || 0;

  const runnable = fixtureReports.filter((r) => !r.skipped);
  const skipped = fixtureReports.filter((r) => r.skipped);

  // Floor check applies regardless of strict.
  if (runnable.length < minFixtures) return 1;

  // Strict: any skip is a failure. The CLI doesn't try to be clever
  // about "if all skipped, who cares" — that policy lives in CI.
  if (strict && skipped.length > 0) return 1;

  // No runnable fixtures + non-strict → preserve the "wired but inert"
  // passive state. This is today's default behaviour.
  if (runnable.length === 0) return 0;

  // Existing behaviour: any errored fixture, or any pass-rate < 1, fails.
  const allPassed = runnable.every((r) => r.summary?.passRate === 1 && !r.error);
  return allPassed ? 0 : 1;
}
