/**
 * stripMathFromDescription — server-side belt-and-braces strip of AI
 * math walkthroughs from client-facing schedule-of-works step
 * descriptions.
 *
 * Origin: Paul Clough flagged 2026-06-30 that quotes contained
 * "(50m × 1.2m = 60m² single face = 120m² both faces combined;
 *  ~3m²/day/2 wallers = 40 operative-days ÷ 2 = 20 days, reduced to
 *  10 days accounting for prepared foundations and on-site stone)"
 * inline in his client-facing scope of works.
 *
 * The fixtures here are the EXACT shapes the AI emits in the wild.
 * Adding new failing cases? Paste them in verbatim — these tests are
 * the regression contract.
 */
import { stripMathFromDescription } from '../utils/aiParser.js';

describe('stripMathFromDescription', () => {
  // ── Paul Clough's actual quote, 2026-06-30 ──────────────────────
  test("strips Paul's main-wall math walkthrough", () => {
    const input = "Hearting packed tightly to each course, and batter profile of 1:6 per face. Cope stones to be set dry-laid with tight joints. Estimated 10 days for 2 operatives (50m × 1.2m = 60m² single face = 120m² both faces combined; ~3m²/day/2 wallers = 40 operative-days ÷ 2 = 20 days, reduced to 10 days accounting for prepared foundations and on-site stone).";
    const out = stripMathFromDescription(input);
    expect(out).toContain('Hearting packed tightly');
    expect(out).toContain('batter profile of 1:6 per face');
    expect(out).toContain('Cope stones to be set dry-laid');
    expect(out).toContain('Estimated 10 days for 2 operatives');
    expect(out).not.toContain('50m × 1.2m');
    expect(out).not.toContain('60m²');
    expect(out).not.toContain('120m²');
    expect(out).not.toContain('both faces combined');
    expect(out).not.toContain('3m²/day');
    expect(out).not.toContain('operative-days');
    expect(out).not.toContain('÷');
    expect(out).not.toContain('reduced to');
    expect(out).not.toContain('accounting for');
  });

  test("strips the bell-curve section math (9m × 1.2m variant)", () => {
    const input = "Form cheek end with selected gritstone quoins and tie into existing field wall abutment. Estimated 2 days for 2 operatives (9m × 1.2m = 10.8m² single face = 21.6m² both faces; ~3m²/day/2 wallers = 7.2 operative-days ÷ 2 = 3.6 days, reduced to 2 days for continuity).";
    const out = stripMathFromDescription(input);
    expect(out).toContain('Form cheek end with selected gritstone quoins');
    expect(out).toContain('Estimated 2 days for 2 operatives');
    expect(out).not.toContain('10.8m²');
    expect(out).not.toContain('21.6m²');
    expect(out).not.toContain('7.2 operative-days');
    expect(out).not.toContain('reduced to 2 days for continuity');
  });

  // ── Edge cases ──────────────────────────────────────────────────
  test('preserves plain labour figures (the safe sentence we want to keep)', () => {
    const input = 'Rebuild 12 linear metres of dry stone wall. Estimated 5 days for 2 operatives.';
    const out = stripMathFromDescription(input);
    expect(out).toBe('Rebuild 12 linear metres of dry stone wall. Estimated 5 days for 2 operatives.');
  });

  test('preserves dimensions in the descriptive sentence', () => {
    const input = 'Rebuild 50m of field wall at 1.2m height using matched sandstone reclaimed from the existing wall.';
    const out = stripMathFromDescription(input);
    expect(out).toBe('Rebuild 50m of field wall at 1.2m height using matched sandstone reclaimed from the existing wall.');
  });

  test('preserves single-line plain m² mentions outside parens', () => {
    // "60m² rebuild area" in normal prose should survive — only
    // PARENTHETICAL math with "=" or "÷" gets stripped.
    const input = 'A 60m² rebuild area using gritstone. Estimated 8 days for 2 operatives.';
    const out = stripMathFromDescription(input);
    expect(out).toContain('60m² rebuild area');
    expect(out).toContain('Estimated 8 days for 2 operatives');
  });

  test('idempotent — running twice produces same result', () => {
    const input = "Estimated 2 days for 2 operatives (9m × 1.2m = 10.8m² single face = 21.6m² both faces; ~3m²/day/2 wallers = 7.2 operative-days ÷ 2 = 3.6 days, reduced to 2 days for continuity).";
    const once = stripMathFromDescription(input);
    const twice = stripMathFromDescription(once);
    expect(twice).toBe(once);
  });

  test('handles null / undefined / empty without crashing', () => {
    expect(stripMathFromDescription(null)).toBe(null);
    expect(stripMathFromDescription(undefined)).toBe(undefined);
    expect(stripMathFromDescription('')).toBe('');
  });

  test('handles non-string input gracefully', () => {
    expect(stripMathFromDescription(42)).toBe(42);
    expect(stripMathFromDescription({})).toEqual({});
  });

  test('handles two consecutive math blocks (multi-formula AI output)', () => {
    const input = "Rebuild section. Estimated 3 days (12m × 1m = 12m² × 2 = 24m² combined). Includes 6 operative-days ÷ 2 = 3 days arithmetic.";
    const out = stripMathFromDescription(input);
    expect(out).not.toContain('×');
    expect(out).not.toContain('÷');
    expect(out).not.toContain('= 12m²');
    expect(out).not.toContain('= 24m²');
    expect(out).toContain('Rebuild section');
    expect(out).toContain('Estimated 3 days');
  });

  test('preserves a description with NO math (no-op)', () => {
    const input = 'Form cheek end with selected gritstone quoins and tie into existing field wall abutment. Cope stones to be set dry-laid with tight joints.';
    const out = stripMathFromDescription(input);
    expect(out).toBe(input);
  });

  test('collapses double spaces left by the strip', () => {
    const input = 'Build wall  (10m × 1m = 10m²)  cleanly.';
    const out = stripMathFromDescription(input);
    expect(out).not.toMatch(/\s{2,}/);
  });

  test('tidies space-before-punctuation produced by the strip', () => {
    const input = 'Build wall (10m × 1m = 10m²), then point.';
    const out = stripMathFromDescription(input);
    expect(out).toBe('Build wall, then point.');
  });
});
