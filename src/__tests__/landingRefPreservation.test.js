/**
 * Landing ref-preservation IIFE — source-level guard.
 *
 * Background: ReferralPanel shares URLs of shape
 *   https://fastquote.uk/?ref=CODE
 * Until 2026-06-30 the landing's static template hardcoded /login and
 * /signup anchors, so clicking "Get started" silently dropped the
 * ref. /auth/login's session-stash then saw nothing and the OAuth
 * callback skipped applyReferralAtSignup → zero attribution.
 *
 * The fix lives in `public/landing/landing.js` as a self-running IIFE
 * at the top of the file. It rewrites `a[href="/login"]` and
 * `a[href="/signup"]` to append `?ref=<code>` from the URL.
 *
 * This test is a source-level guard: we assert the script exists and
 * has the right shape. End-to-end behaviour is covered by manual
 * browser testing — JSDOM here would mock too much of the URL API to
 * be useful.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', '..', 'public', 'landing', 'landing.js'),
  'utf8'
);

describe('landing.js — ?ref= preservation on auth CTAs', () => {
  test('contains an IIFE labelled preserveReferralCode', () => {
    expect(SRC).toMatch(/preserveReferralCode/);
    expect(SRC).toMatch(/function preserveReferralCode\s*\(\s*\)/);
  });

  test('reads ?ref= from window.location.search', () => {
    expect(SRC).toMatch(/URLSearchParams\s*\(\s*window\.location\.search\s*\)/);
    expect(SRC).toMatch(/params\.get\(\s*['"]ref['"]\s*\)/);
  });

  test('uppercases + trims the ref before use (mirrors normaliseReferralCode)', () => {
    expect(SRC).toMatch(/\.trim\(\)\.toUpperCase\(\)/);
  });

  test('rejects codes outside the A-Z0-9- alphabet', () => {
    expect(SRC).toMatch(/\/\^\[A-Z0-9-\]\+\$\//);
  });

  test('caps the ref at 64 characters', () => {
    expect(SRC).toMatch(/length\s*>\s*64/);
  });

  test('targets the /login and /signup anchor selectors (both bare and querystringed)', () => {
    expect(SRC).toMatch(/a\[href="\/login"\]/);
    expect(SRC).toMatch(/a\[href="\/signup"\]/);
    expect(SRC).toMatch(/a\[href\^="\/login\?"\]/);
    expect(SRC).toMatch(/a\[href\^="\/signup\?"\]/);
  });

  test('skips anchors that already carry a ref (idempotent)', () => {
    expect(SRC).toMatch(/\/\[\?&\]ref=\//);
  });

  test('encodes the ref before appending', () => {
    expect(SRC).toMatch(/encodeURIComponent/);
  });

  test('best-effort: wrapped in try/catch so a failure cannot break the demo controller', () => {
    expect(SRC).toMatch(/preserveReferralCode[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/m);
  });

  test('the IIFE sits BEFORE the demo-controller IIFE so it runs first on script load', () => {
    const refIdx = SRC.indexOf('preserveReferralCode');
    const demoIdx = SRC.indexOf("var STAGE_DURATIONS");
    expect(refIdx).toBeGreaterThan(-1);
    expect(demoIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeLessThan(demoIdx);
  });
});
