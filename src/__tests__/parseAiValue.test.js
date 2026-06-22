/**
 * parseAiValue — robust numeric parser tests.
 *
 * Covers the shapes that appear in production `quote_diffs.ai_value`
 * as of 2026-06-22, plus safety paths (null, undefined, empty, garbage).
 */

import { parseAiValue } from '../utils/parseAiValue.js';

describe('parseAiValue — measurement strings', () => {
  test('parses "2,000mm" as 2000 (the calibration-investigation bug case)', () => {
    expect(parseAiValue('2,000mm')).toBe(2000);
  });

  test('parses "3100mm" as 3100 (no comma)', () => {
    expect(parseAiValue('3100mm')).toBe(3100);
  });

  test('parses "3,100mm" as 3100 (comma + suffix)', () => {
    expect(parseAiValue('3,100mm')).toBe(3100);
  });

  test('parses "1.5m" as 1.5 (decimal + metre suffix)', () => {
    expect(parseAiValue('1.5m')).toBe(1.5);
  });

  test('parses "850 mm" as 850 (space between number and unit)', () => {
    expect(parseAiValue('850 mm')).toBe(850);
  });
});

describe('parseAiValue — currency strings', () => {
  test('parses "£415" as 415', () => {
    expect(parseAiValue('£415')).toBe(415);
  });

  test('parses "£1,250" as 1250 (thousand-separator comma)', () => {
    expect(parseAiValue('£1,250')).toBe(1250);
  });

  test('parses "£ 80" as 80 (space after currency symbol)', () => {
    expect(parseAiValue('£ 80')).toBe(80);
  });

  test('parses "$125" as 125', () => {
    expect(parseAiValue('$125')).toBe(125);
  });

  test('parses "€95.50" as 95.5 (Euro + decimal)', () => {
    expect(parseAiValue('€95.50')).toBe(95.5);
  });
});

describe('parseAiValue — quantity / weight strings', () => {
  test('parses "3.5t" as 3.5 (tonnes)', () => {
    expect(parseAiValue('3.5t')).toBe(3.5);
  });

  test('parses "1.2 tonnes" as 1.2', () => {
    expect(parseAiValue('1.2 tonnes')).toBe(1.2);
  });

  test('parses "25kg" as 25', () => {
    expect(parseAiValue('25kg')).toBe(25);
  });

  test('parses "8 days" as 8 (labour days field)', () => {
    expect(parseAiValue('8 days')).toBe(8);
  });

  test('parses "5sqm" as 5 (area suffix)', () => {
    expect(parseAiValue('5sqm')).toBe(5);
  });
});

describe('parseAiValue — plain numeric strings', () => {
  test('parses "4500" as 4500', () => {
    expect(parseAiValue('4500')).toBe(4500);
  });

  test('parses "4,500" as 4500 (comma, no suffix)', () => {
    expect(parseAiValue('4,500')).toBe(4500);
  });

  test('parses "0" as 0', () => {
    expect(parseAiValue('0')).toBe(0);
  });

  test('parses negative numbers', () => {
    expect(parseAiValue('-150')).toBe(-150);
  });

  test('parses decimal values', () => {
    expect(parseAiValue('3.14')).toBe(3.14);
  });
});

describe('parseAiValue — safety / null paths', () => {
  test('returns null for null input', () => {
    expect(parseAiValue(null)).toBe(null);
  });

  test('returns null for undefined input', () => {
    expect(parseAiValue(undefined)).toBe(null);
  });

  test('returns null for empty string', () => {
    expect(parseAiValue('')).toBe(null);
  });

  test('returns null for whitespace-only string', () => {
    expect(parseAiValue('   ')).toBe(null);
  });

  test('returns null for non-numeric string', () => {
    expect(parseAiValue('Stone supply')).toBe(null);
  });

  test('returns null for "n/a"', () => {
    expect(parseAiValue('n/a')).toBe(null);
  });

  test('returns null for "TBC"', () => {
    expect(parseAiValue('TBC')).toBe(null);
  });

  test('returns null for boolean inputs', () => {
    expect(parseAiValue(true)).toBe(null);
    expect(parseAiValue(false)).toBe(null);
  });

  test('returns null for object input', () => {
    expect(parseAiValue({ value: 100 })).toBe(null);
  });

  test('returns null for array input', () => {
    expect(parseAiValue([100])).toBe(null);
  });
});

describe('parseAiValue — finite numeric inputs pass through', () => {
  test('passes through finite numbers (defensive against future writers)', () => {
    expect(parseAiValue(100)).toBe(100);
    expect(parseAiValue(3.14)).toBe(3.14);
    expect(parseAiValue(0)).toBe(0);
    expect(parseAiValue(-50)).toBe(-50);
  });

  test('returns null for NaN', () => {
    expect(parseAiValue(NaN)).toBe(null);
  });

  test('returns null for Infinity / -Infinity', () => {
    expect(parseAiValue(Infinity)).toBe(null);
    expect(parseAiValue(-Infinity)).toBe(null);
  });
});

describe('parseAiValue — investigation bug regression', () => {
  // Locks in the specific bug from the 2026-06-22 calibration
  // investigation: parseFloat('2,000mm') returned 2, then
  // (3100 - 2) / 2 = 1549 (i.e. 154,900%), poisoning the bias chart.
  // With parseAiValue, both sides parse correctly and the magnitude
  // is the real ~55% delta.
  test('regression: parseFloat-style truncation does not happen', () => {
    const ai = parseAiValue('2,000mm');
    const confirmed = parseAiValue('3,100mm');
    expect(ai).toBe(2000);
    expect(confirmed).toBe(3100);
    const magnitude = (confirmed - ai) / ai;
    // ~55% — well below the corrupted 154,900%
    expect(magnitude).toBeGreaterThan(0.5);
    expect(magnitude).toBeLessThan(0.6);
  });

  test('regression: confirmed without comma but with suffix still parses', () => {
    // The investigation noted some confirmed values were stored as
    // "3100mm" (no comma) and some as "3,100mm" (with comma). Both
    // must parse identically.
    expect(parseAiValue('3100mm')).toBe(parseAiValue('3,100mm'));
  });
});
