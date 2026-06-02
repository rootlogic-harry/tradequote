/**
 * Regression suite comparator — distinguishes "AI noise" from "regression".
 *
 * The comparator is the heart of the suite: it takes one actual output and
 * one ground-truth spec and returns a structured pass/fail with deltas.
 *
 * Design choices being locked down:
 *   - Numeric tolerances are fractional by default (0.15 = ±15%) but can be
 *     overridden absolute (`abs: 0.5`) for fields where % doesn't make
 *     sense (labour days; a quote with 0.5 day diff is meaningful regardless
 *     of the absolute days figure).
 *   - Material composition is "every described item in groundTruth.materials
 *     has a matching substring in the actual output". We DON'T check costs
 *     here — that's covered by the total. Composition catches "AI forgot
 *     to include scaffolding".
 *   - Pass is per-field. A run passes overall if every field passes.
 *   - Missing fields on the actual output count as a failure for that field,
 *     not a crash.
 */
import { compareRun } from '../../regression/lib/compare.js';

describe('compareRun — numeric fields', () => {
  test('passes when actual is within the fractional tolerance', () => {
    const expected = {
      measurements: { 'Wall height': { value: 1200, tolerance: 0.15 } }, // ±15%
    };
    const actual = {
      measurements: { 'Wall height': 1300 }, // +8.3% — within ±15%
    };
    const result = compareRun(actual, expected);
    expect(result.pass).toBe(true);
    expect(result.fields[0]).toMatchObject({
      field: 'measurements.Wall height',
      pass: true,
      actual: 1300,
      expected: 1200,
    });
  });

  test('fails when actual exceeds the fractional tolerance', () => {
    const expected = {
      measurements: { 'Wall height': { value: 1200, tolerance: 0.10 } }, // ±10%
    };
    const actual = {
      measurements: { 'Wall height': 1500 }, // +25%
    };
    const result = compareRun(actual, expected);
    expect(result.pass).toBe(false);
    const field = result.fields.find((f) => f.field === 'measurements.Wall height');
    expect(field.pass).toBe(false);
    expect(field.deltaPercent).toBeCloseTo(0.25, 2);
  });

  test('honours absolute tolerance (labour days)', () => {
    const expected = {
      labour: { estimatedDays: { value: 3, abs: 0.5 } },
    };
    // 3.4 days is within 0.5 of 3 → pass
    expect(compareRun({ labour: { estimatedDays: 3.4 } }, expected).pass).toBe(true);
    // 3.6 days is outside 0.5 of 3 → fail
    expect(compareRun({ labour: { estimatedDays: 3.6 } }, expected).pass).toBe(false);
  });

  test('absolute tolerance dominates fractional when both supplied', () => {
    // A 0.4-day diff on a 1-day baseline is +40% — would fail a 15% frac
    // tolerance. But abs: 0.5 should override it for fields where a small
    // absolute slip is what we actually care about.
    const expected = {
      labour: { estimatedDays: { value: 1, tolerance: 0.15, abs: 0.5 } },
    };
    expect(compareRun({ labour: { estimatedDays: 1.4 } }, expected).pass).toBe(true);
  });

  test('reports the field as failed when actual is missing', () => {
    const expected = {
      measurements: { 'Wall height': { value: 1200, tolerance: 0.15 } },
    };
    const actual = { measurements: {} }; // no Wall height returned
    const result = compareRun(actual, expected);
    expect(result.pass).toBe(false);
    const field = result.fields.find((f) => f.field === 'measurements.Wall height');
    expect(field.pass).toBe(false);
    expect(field.reason).toMatch(/missing/i);
  });
});

describe('compareRun — total + labour aggregate', () => {
  test('total quote within ±10% is the headline check', () => {
    const expected = { totalAmount: { value: 4500, tolerance: 0.10 } };
    expect(compareRun({ totalAmount: 4700 }, expected).pass).toBe(true);
    expect(compareRun({ totalAmount: 5500 }, expected).pass).toBe(false);
  });

  test('multiple fields — overall pass requires every field to pass', () => {
    const expected = {
      totalAmount: { value: 4500, tolerance: 0.10 },
      labour: { estimatedDays: { value: 3, abs: 0.5 } },
    };
    // Total fine, labour off → overall fail
    const result = compareRun(
      { totalAmount: 4500, labour: { estimatedDays: 5 } },
      expected
    );
    expect(result.pass).toBe(false);
    expect(result.fields.filter((f) => f.pass).length).toBe(1);
    expect(result.fields.filter((f) => !f.pass).length).toBe(1);
  });
});

describe('compareRun — material composition', () => {
  test('passes when every required material description appears in the actual output', () => {
    const expected = {
      materials: [
        { description: 'walling stone' },
        { description: 'scaffolding' },
      ],
    };
    const actual = {
      materials: [
        { description: 'Matched gritstone walling stone' },
        { description: 'Mobile scaffolding hire' },
        { description: 'Waste disposal' },
      ],
    };
    expect(compareRun(actual, expected).pass).toBe(true);
  });

  test('fails when a required material is missing (e.g. AI forgot scaffolding)', () => {
    const expected = {
      materials: [
        { description: 'walling stone' },
        { description: 'scaffolding' },
      ],
    };
    const actual = {
      materials: [{ description: 'Matched gritstone walling stone' }],
    };
    const result = compareRun(actual, expected);
    expect(result.pass).toBe(false);
    const missing = result.fields.find((f) => f.field === 'materials.scaffolding');
    expect(missing.pass).toBe(false);
    expect(missing.reason).toMatch(/missing/i);
  });

  test('case-insensitive substring match (so "Walling Stone" matches "walling stone")', () => {
    const expected = { materials: [{ description: 'walling stone' }] };
    const actual = { materials: [{ description: 'Walling Stone Supply' }] };
    expect(compareRun(actual, expected).pass).toBe(true);
  });

  test('extra materials in actual do not cause a fail — only missing ones do', () => {
    // The AI is allowed to suggest items beyond the ground-truth set;
    // it's only flagged when something required is missing.
    const expected = { materials: [{ description: 'walling stone' }] };
    const actual = {
      materials: [
        { description: 'walling stone' },
        { description: 'unexpected extra material' },
      ],
    };
    expect(compareRun(actual, expected).pass).toBe(true);
  });

  test('flags forbidden materials when the fixture marks them excluded', () => {
    // For dry-laid jobs, the ground truth can specify forbidden materials
    // (e.g. lime mortar should never appear). Same shape as required, with
    // `forbidden: true`.
    const expected = {
      materials: [
        { description: 'walling stone' },
        { description: 'lime mortar', forbidden: true },
      ],
    };
    const actualWithMortar = {
      materials: [
        { description: 'walling stone' },
        { description: 'NHL 3.5 lime mortar' }, // shouldn't be there
      ],
    };
    const result = compareRun(actualWithMortar, expected);
    expect(result.pass).toBe(false);
    const forbidden = result.fields.find(
      (f) => f.field === 'materials.lime mortar' && f.forbidden
    );
    expect(forbidden.pass).toBe(false);
    expect(forbidden.reason).toMatch(/forbidden/i);
  });
});

describe('compareRun — stats across multiple runs', () => {
  // For a full regression run we execute N iterations and want the
  // aggregate distribution, not just one pass/fail.
  test('summariseRuns returns mean, std, pass count per field', async () => {
    const { summariseRuns } = await import('../../regression/lib/compare.js');
    const runs = [
      { totalAmount: 4400, labour: { estimatedDays: 3 } },
      { totalAmount: 4600, labour: { estimatedDays: 3 } },
      { totalAmount: 4500, labour: { estimatedDays: 3.5 } },
    ];
    const expected = {
      totalAmount: { value: 4500, tolerance: 0.10 },
      labour: { estimatedDays: { value: 3, abs: 0.5 } },
    };
    const summary = summariseRuns(runs, expected);
    expect(summary.fields[0].field).toBe('totalAmount');
    expect(summary.fields[0].mean).toBeCloseTo(4500, 0);
    expect(summary.fields[0].stdDev).toBeGreaterThan(0);
    expect(summary.fields[0].passCount).toBe(3); // all three runs within ±10%
    expect(summary.fields[0].totalRuns).toBe(3);
  });

  test('summariseRuns handles a missing field across some runs without crashing', async () => {
    const { summariseRuns } = await import('../../regression/lib/compare.js');
    const runs = [
      { totalAmount: 4400, labour: { estimatedDays: 3 } },
      { totalAmount: 4500 }, // labour missing
    ];
    const expected = {
      totalAmount: { value: 4500, tolerance: 0.10 },
      labour: { estimatedDays: { value: 3, abs: 0.5 } },
    };
    expect(() => summariseRuns(runs, expected)).not.toThrow();
    const summary = summariseRuns(runs, expected);
    const labour = summary.fields.find((f) => f.field === 'labour.estimatedDays');
    expect(labour.passCount).toBe(1); // only one run had labour, and it passed
  });
});
