/**
 * VAT regression test — Paul reported his quotes applying VAT on despite
 * his profile showing "not VAT registered". Root cause investigation:
 * the `profile.vatRegistered` flag was being used with a truthy check
 * (`if (!vatRegistered)`), which treats the string "false" or the
 * number 1 (or any non-boolean truthy value) as if the tradesman were
 * registered. This lock keeps VAT off unless vatRegistered is the
 * literal boolean `true`.
 *
 * The normaliser `normaliseVatRegistered` is the single place in the
 * codebase that decides "is this profile VAT-registered?" — every
 * render path (QuoteDocument, ReviewEdit, QuoteOutput PDF + DOCX) and
 * every calculation path (calculateVAT) reads through it.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  calculateVAT,
  calculateAllTotals,
  normaliseVatRegistered,
} from '../utils/calculations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('normaliseVatRegistered — strict boolean coercion', () => {
  test('returns true for the literal boolean true', () => {
    expect(normaliseVatRegistered(true)).toBe(true);
  });

  test('returns false for the literal boolean false', () => {
    expect(normaliseVatRegistered(false)).toBe(false);
  });

  test('returns false for undefined (new profiles without the flag)', () => {
    expect(normaliseVatRegistered(undefined)).toBe(false);
  });

  test('returns false for null', () => {
    expect(normaliseVatRegistered(null)).toBe(false);
  });

  test('returns false for the string "false" — past cause of the VAT bug', () => {
    // JSON round-trip should preserve booleans, but if a legacy row was
    // ever stored as a string (manual fix, migration artefact, third-
    // party tool) a truthy check would treat "false" as registered.
    expect(normaliseVatRegistered('false')).toBe(false);
  });

  test('returns false for the string "true" — we only trust the boolean', () => {
    // Fail-closed: any non-boolean input is "not registered". The
    // tradesman can re-tick the box to opt in; we never silently promote
    // a suspicious value to true.
    expect(normaliseVatRegistered('true')).toBe(false);
  });

  test('returns false for numbers (0, 1, NaN)', () => {
    expect(normaliseVatRegistered(0)).toBe(false);
    expect(normaliseVatRegistered(1)).toBe(false);
    expect(normaliseVatRegistered(Number.NaN)).toBe(false);
  });

  test('returns false for objects and arrays', () => {
    expect(normaliseVatRegistered({})).toBe(false);
    expect(normaliseVatRegistered([])).toBe(false);
    expect(normaliseVatRegistered({ registered: true })).toBe(false);
  });
});

describe('calculateVAT — only the literal boolean true activates VAT', () => {
  test('vatRegistered=true with a subtotal applies 20%', () => {
    expect(calculateVAT(1000, true)).toBe(200);
  });

  test('vatRegistered=false zeroes VAT', () => {
    expect(calculateVAT(1000, false)).toBe(0);
  });

  test('vatRegistered="true" (string) does NOT apply VAT', () => {
    expect(calculateVAT(1000, 'true')).toBe(0);
  });

  test('vatRegistered="false" (string) does NOT apply VAT', () => {
    expect(calculateVAT(1000, 'false')).toBe(0);
  });

  test('vatRegistered=1 (number) does NOT apply VAT', () => {
    expect(calculateVAT(1000, 1)).toBe(0);
  });

  test('vatRegistered=undefined/null does NOT apply VAT', () => {
    expect(calculateVAT(1000, undefined)).toBe(0);
    expect(calculateVAT(1000, null)).toBe(0);
  });
});

describe('calculateAllTotals — VAT is only applied for a boolean-true profile', () => {
  const materials = [{ totalCost: 500 }];
  const labour = { days: 1, workers: 1, dayRate: 400 };
  const additionalCosts = [];

  test('vatRegistered=true returns vatAmount > 0', () => {
    const t = calculateAllTotals(materials, labour, additionalCosts, true);
    expect(t.vatAmount).toBeGreaterThan(0);
    expect(t.total).toBeGreaterThan(t.subtotal);
  });

  test('vatRegistered="true" (string, corrupted profile) returns vatAmount=0', () => {
    const t = calculateAllTotals(materials, labour, additionalCosts, 'true');
    expect(t.vatAmount).toBe(0);
    expect(t.total).toBe(t.subtotal);
  });

  test('vatRegistered=undefined returns vatAmount=0', () => {
    const t = calculateAllTotals(materials, labour, additionalCosts, undefined);
    expect(t.vatAmount).toBe(0);
    expect(t.total).toBe(t.subtotal);
  });
});

describe('render-time gating — UI components read through the same normaliser', () => {
  // Source-level assertion: any site that toggles VAT UI must go through
  // normaliseVatRegistered or a `=== true` strict check, never a truthy
  // test of profile.vatRegistered. This is what kept Paul's quote
  // silently applying VAT on — the code worked per the happy path (true/
  // false booleans) but crumbled on corrupted inputs.
  const files = [
    'src/components/QuoteDocument.jsx',
    'src/components/steps/ReviewEdit.jsx',
    'src/components/steps/QuoteOutput.jsx',
  ];

  test.each(files)('%s gates every VAT-bearing render on a strict boolean check', (file) => {
    const src = readFileSync(join(repoRoot, file), 'utf8');
    // Find every reference to profile.vatRegistered and verify it is
    // either the arg to normaliseVatRegistered(…) / calculateAllTotals(…)
    // or a strict === true comparison. Relaxed truthy tests
    // (`{profile.vatRegistered && …}`) are the shape of the bug we're
    // killing.
    const lines = src.split('\n');
    const violations = [];
    lines.forEach((line, idx) => {
      if (!/profile\.vatRegistered/.test(line)) return;
      // Allowed forms:
      //   - normaliseVatRegistered(profile.vatRegistered)
      //   - calculateAllTotals(..., profile.vatRegistered)   (normaliser called inside)
      //   - profile.vatRegistered === true
      //   - &&  !!   in a context that's NOT a JSX render gate (e.g. footer VAT-number line)
      // We allow the footer mention ("VAT No: …") because it's guarded
      // by BOTH vatRegistered AND vatNumber and is a cosmetic line.
      const allowed =
        /normaliseVatRegistered\s*\(\s*profile\.vatRegistered/.test(line) ||
        /calculateAllTotals\([^)]*profile\.vatRegistered/.test(line) ||
        /profile\.vatRegistered\s*===\s*true/.test(line) ||
        /profile\.vatRegistered\s*&&\s*profile\.vatNumber/.test(line); // footer line
      if (!allowed) violations.push({ line: idx + 1, text: line.trim() });
    });
    if (violations.length > 0) {
      const detail = violations.map((v) => `  ${v.line}: ${v.text}`).join('\n');
      fail(`Un-gated profile.vatRegistered reads in ${file}:\n${detail}`);
    }
  });
});
