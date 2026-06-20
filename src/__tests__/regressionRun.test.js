/**
 * run.js CLI surface — argument parsing for the new sharpening flags.
 *
 * The CLI itself is exercised end-to-end by the harness's own smoke
 * tests, but parseArgs is small enough to lock down directly. This is
 * the bit that changes default-vs-strict behaviour, so it's worth
 * separate tests.
 *
 * Item 1 flags:
 *   --strict                       — flips skipped fixtures into hard failure
 *   --require-min-fixtures N       — non-zero exit if < N runnable fixtures
 *
 * Item 2 flag:
 *   --bless                        — write per-fixture baseline JSON
 *
 * Env variable equivalents:
 *   REGRESSION_STRICT=1            — same as --strict
 */
import { parseArgs, decideExitCode } from '../../regression/lib/cli.js';

describe('parseArgs — strict + min-fixtures + bless flags', () => {
  test('default values when no flags', () => {
    const out = parseArgs(['node', 'run.js'], {});
    expect(out.strict).toBe(false);
    expect(out.requireMinFixtures).toBe(0);
    expect(out.bless).toBe(false);
    expect(out.iterations).toBe(3);
    expect(out.write).toBe(true);
  });

  test('--strict sets strict=true', () => {
    const out = parseArgs(['node', 'run.js', '--strict'], {});
    expect(out.strict).toBe(true);
  });

  test('REGRESSION_STRICT=1 env sets strict=true even without flag', () => {
    const out = parseArgs(['node', 'run.js'], { REGRESSION_STRICT: '1' });
    expect(out.strict).toBe(true);
  });

  test('REGRESSION_STRICT=0 or unset leaves strict=false', () => {
    expect(parseArgs(['node', 'run.js'], { REGRESSION_STRICT: '0' }).strict).toBe(false);
    expect(parseArgs(['node', 'run.js'], {}).strict).toBe(false);
  });

  test('--require-min-fixtures N sets the threshold', () => {
    const out = parseArgs(['node', 'run.js', '--require-min-fixtures', '2'], {});
    expect(out.requireMinFixtures).toBe(2);
  });

  test('--require-min-fixtures rejects non-integer values', () => {
    expect(() =>
      parseArgs(['node', 'run.js', '--require-min-fixtures', 'abc'], {})
    ).toThrow(/require-min-fixtures/i);
  });

  test('--bless sets bless=true', () => {
    const out = parseArgs(['node', 'run.js', '--bless'], {});
    expect(out.bless).toBe(true);
  });

  test('--no-write is preserved (existing flag)', () => {
    const out = parseArgs(['node', 'run.js', '--no-write'], {});
    expect(out.write).toBe(false);
  });
});

describe('decideExitCode — encodes the pass/fail rules in one place', () => {
  // The runner accumulates a list of per-fixture results, then decideExitCode
  // collapses them into 0 or non-zero. This is the heart of "strict means
  // skip-becomes-failure" so it gets dedicated tests.

  const skipped = (id) => ({ fixture: { id }, skipped: true, skipReason: 'no photos' });
  const passed = (id) => ({
    fixture: { id },
    skipped: false,
    summary: { passRate: 1, totalRuns: 3, fields: [] },
    error: null,
  });
  const partial = (id) => ({
    fixture: { id },
    skipped: false,
    summary: { passRate: 0.5, totalRuns: 2, fields: [] },
    error: null,
  });
  const errored = (id) => ({
    fixture: { id },
    skipped: false,
    summary: { passRate: 0, totalRuns: 0, fields: [] },
    error: '3/3 iterations failed',
  });

  test('no fixtures at all + non-strict → exit 0 (passive state preserved)', () => {
    expect(decideExitCode([], { strict: false, requireMinFixtures: 0 })).toBe(0);
  });

  test('all fixtures skipped + non-strict → exit 0 (today\'s main behaviour)', () => {
    expect(decideExitCode([skipped('a'), skipped('b')], { strict: false, requireMinFixtures: 0 })).toBe(0);
  });

  test('all passing + non-strict → exit 0', () => {
    expect(decideExitCode([passed('a'), passed('b')], { strict: false, requireMinFixtures: 0 })).toBe(0);
  });

  test('any errored fixture → non-zero exit', () => {
    expect(decideExitCode([passed('a'), errored('b')], { strict: false, requireMinFixtures: 0 })).not.toBe(0);
  });

  test('partial pass-rate → non-zero exit', () => {
    expect(decideExitCode([passed('a'), partial('b')], { strict: false, requireMinFixtures: 0 })).not.toBe(0);
  });

  test('STRICT: a single skipped fixture is a failure when at least one fixture is runnable', () => {
    // The "some fixtures runnable, some skipped" state — exactly the
    // regression risk that today's main silently swallows.
    expect(decideExitCode([passed('a'), skipped('b')], { strict: true, requireMinFixtures: 0 })).not.toBe(0);
  });

  test('STRICT: ALL skipped → also fails (the CLI just honours --strict; CI decides when to pass it)', () => {
    // Per the brief acceptance criterion: `npm run regression -- --strict`
    // against today's main (sample fixture unrunnable, no others) becomes
    // a hard failure. The CLI does not try to be clever about runnable
    // counts — the workflow file is responsible for only flipping --strict
    // on once at least one real fixture is committed.
    expect(decideExitCode([skipped('a'), skipped('b')], { strict: true, requireMinFixtures: 0 })).not.toBe(0);
  });

  test('STRICT: no fixtures at all → still exit 0 (nothing to fail on)', () => {
    expect(decideExitCode([], { strict: true, requireMinFixtures: 0 })).toBe(0);
  });

  test('--require-min-fixtures: too few runnable fixtures → non-zero exit', () => {
    // Today there are 0 runnable. require-min-fixtures=1 forces a failure
    // because we're saying "I expect at least one runnable fixture to
    // exist". Useful once fixtures land and we want CI to fail if someone
    // accidentally moves the photos directory.
    expect(decideExitCode([], { strict: false, requireMinFixtures: 1 })).not.toBe(0);
    expect(decideExitCode([skipped('a')], { strict: false, requireMinFixtures: 1 })).not.toBe(0);
  });

  test('--require-min-fixtures threshold met → exit 0', () => {
    expect(decideExitCode([passed('a')], { strict: false, requireMinFixtures: 1 })).toBe(0);
    expect(decideExitCode([passed('a'), passed('b')], { strict: false, requireMinFixtures: 2 })).toBe(0);
  });
});
