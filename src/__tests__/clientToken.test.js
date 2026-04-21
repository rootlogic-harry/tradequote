/**
 * Unit tests for the client-portal token helper.
 *
 * Security rules baked into these tests — they must not be weakened:
 *   1. Tokens are UUID v4 from crypto.randomUUID (128-bit entropy).
 *      Timestamp-derived or Math.random-derived tokens fail immediately.
 *   2. Expiry is 30 days from generation time. Clients only have access
 *      for that window.
 *   3. Expiry check must fail-closed: malformed / missing values are
 *      treated as expired.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  generateClientToken,
  computeClientTokenExpiry,
  isClientTokenExpired,
  CLIENT_TOKEN_TTL_DAYS,
} from '../utils/clientToken.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helperSource = readFileSync(join(__dirname, '../utils/clientToken.js'), 'utf8');

// RFC 4122 v4 pattern: the 13th hex digit is "4" and the 17th is
// one of [8, 9, a, b] (the variant bits).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateClientToken', () => {
  it('returns a valid UUID v4 string', () => {
    const token = generateClientToken();
    expect(typeof token).toBe('string');
    expect(token).toMatch(UUID_V4);
  });

  it('uses crypto.randomUUID under the hood (never Math.random, never timestamps)', () => {
    // Source-level guard: brute-force resistance depends on the token
    // being a cryptographically strong UUID v4. A future refactor that
    // swaps to Math.random or a timestamp-derived scheme must fail this
    // test before it can be merged.
    // Strip comments before scanning so doc references to the banned
    // APIs (e.g. "never Math.random") don't trip the guard.
    const codeOnly = helperSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly).toMatch(/crypto\.randomUUID\(\)/);
    expect(codeOnly).not.toMatch(/Math\.random\s*\(/);
    expect(codeOnly).not.toMatch(/Date\.now\(\)\s*\.toString/);
  });

  it('produces a unique token each call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateClientToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('computeClientTokenExpiry', () => {
  it('exposes the TTL as 30 days', () => {
    expect(CLIENT_TOKEN_TTL_DAYS).toBe(30);
  });

  it('returns a Date 30 days after "now"', () => {
    const now = new Date('2026-04-21T12:00:00Z');
    const expiry = computeClientTokenExpiry(now);
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.toISOString()).toBe('2026-05-21T12:00:00.000Z');
  });

  it('defaults to the current time when no argument is given', () => {
    const before = Date.now();
    const expiry = computeClientTokenExpiry();
    const after = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs - 10);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + thirtyDaysMs + 10);
  });
});

describe('isClientTokenExpired', () => {
  const now = new Date('2026-04-21T12:00:00Z');

  it('returns false for a future expiry', () => {
    const future = new Date(now.getTime() + 60 * 1000);
    expect(isClientTokenExpired(future, now)).toBe(false);
  });

  it('returns true for a past expiry', () => {
    const past = new Date(now.getTime() - 60 * 1000);
    expect(isClientTokenExpired(past, now)).toBe(true);
  });

  it('treats equality as expired (fail-closed)', () => {
    expect(isClientTokenExpired(now, now)).toBe(true);
  });

  it('treats null / undefined as expired (fail-closed)', () => {
    expect(isClientTokenExpired(null, now)).toBe(true);
    expect(isClientTokenExpired(undefined, now)).toBe(true);
  });

  it('treats unparseable strings as expired (fail-closed)', () => {
    expect(isClientTokenExpired('not a date', now)).toBe(true);
  });

  it('accepts an ISO string as input', () => {
    const future = new Date(now.getTime() + 60 * 1000).toISOString();
    expect(isClientTokenExpired(future, now)).toBe(false);
  });
});
