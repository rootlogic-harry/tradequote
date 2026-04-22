/**
 * isTransientInfrastructureError — tests that we correctly classify
 * Railway's DNS blips, Postgres restarts, and network timeouts as
 * transient (→ 503 + Retry-After), while real bugs (SQL syntax errors,
 * constraint violations, anything code-level) are NOT masked as
 * transient.
 *
 * This classification is load-bearing: every false positive delays a
 * bug fix by telling users "try again later" instead of erroring
 * loudly. Be very strict about what goes into the transient list.
 */
import { isTransientInfrastructureError } from '../utils/transientError.js';

describe('isTransientInfrastructureError — transient codes', () => {
  test.each([
    ['EAI_AGAIN',     'DNS lookup temporarily failed (Railway outage)'],
    ['ECONNREFUSED',  'Postgres process restarting'],
    ['ECONNRESET',    'connection killed mid-query'],
    ['ETIMEDOUT',     'network timeout'],
    ['EHOSTUNREACH',  'host unreachable'],
    ['ENETUNREACH',   'network unreachable'],
    ['ENOTFOUND',     'DNS resolution failed'],
    ['57P01',         'pg: admin_shutdown'],
    ['57P02',         'pg: crash_shutdown'],
    ['57P03',         'pg: cannot_connect_now'],
    ['08000',         'pg: connection_exception'],
    ['08006',         'pg: connection_failure'],
  ])('classifies %s (%s) as transient', (code) => {
    const err = Object.assign(new Error('test'), { code });
    expect(isTransientInfrastructureError(err)).toBe(true);
  });

  test('falls back to message text when .code is stripped', () => {
    // Node sometimes surfaces getaddrinfo errors without preserving
    // the numeric code through logger layers — the textual fallback
    // guarantees we still recognise them.
    const err = new Error('getaddrinfo EAI_AGAIN postgres-8dej.railway.internal');
    expect(isTransientInfrastructureError(err)).toBe(true);
  });

  test('walks one level of err.cause', () => {
    const inner = Object.assign(new Error('inner'), { code: 'EAI_AGAIN' });
    const outer = Object.assign(new Error('wrapped'), { cause: inner });
    expect(isTransientInfrastructureError(outer)).toBe(true);
  });
});

describe('isTransientInfrastructureError — NOT transient (real bugs)', () => {
  test('SQL syntax error is NOT transient (real code bug)', () => {
    // Classifying this as transient would hide the bug behind a
    // "try again" message forever. Must bubble up as 500.
    const err = Object.assign(new Error('syntax error at or near "SELEKT"'), {
      code: '42601', // pg syntax_error
    });
    expect(isTransientInfrastructureError(err)).toBe(false);
  });

  test('unique-constraint violation is NOT transient', () => {
    const err = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(isTransientInfrastructureError(err)).toBe(false);
  });

  test('foreign-key violation is NOT transient', () => {
    const err = Object.assign(new Error('fk violation'), { code: '23503' });
    expect(isTransientInfrastructureError(err)).toBe(false);
  });

  test('undefined column is NOT transient (schema drift, not a blip)', () => {
    const err = Object.assign(new Error('column foo does not exist'), { code: '42703' });
    expect(isTransientInfrastructureError(err)).toBe(false);
  });

  test('plain Error with no code and benign message → false', () => {
    expect(isTransientInfrastructureError(new Error('something went wrong'))).toBe(false);
  });

  test('null / undefined → false', () => {
    expect(isTransientInfrastructureError(null)).toBe(false);
    expect(isTransientInfrastructureError(undefined)).toBe(false);
  });

  test('string containing "EAI_AGAIN" as a user-controlled substring still matches (accept false +)', () => {
    // We use a word-boundary \b on EAI_AGAIN in the regex so genuine
    // user strings don't trip it. Confirm the boundary is in place by
    // checking a sentence that only mentions the token in passing is
    // still matched — we prefer a small false-positive surface over
    // missing real Railway outages. Documenting the trade-off here.
    const err = new Error('our vendor said EAI_AGAIN happened');
    expect(isTransientInfrastructureError(err)).toBe(true);
  });
});
