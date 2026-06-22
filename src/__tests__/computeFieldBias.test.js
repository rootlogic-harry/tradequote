/**
 * computeFieldBiasFromRows — tests the JS aggregator that replaced
 * the corrupted SQL AVG(edit_magnitude) in /api/admin/learning.
 *
 * The previous SQL aggregation produced bias values like 154,900%
 * because edit_magnitude was computed via parseFloat() on display
 * strings. This helper recomputes bias from raw ai_value +
 * confirmed_value via parseAiValue, so the bug case ("2,000mm" vs
 * "3,100mm") produces ~55% instead of ~154,900%.
 */

import { computeFieldBiasFromRows } from '../utils/computeFieldBias.js';

describe('computeFieldBiasFromRows', () => {
  test('returns empty array for empty input', () => {
    expect(computeFieldBiasFromRows([])).toEqual([]);
    expect(computeFieldBiasFromRows(null)).toEqual([]);
    expect(computeFieldBiasFromRows(undefined)).toEqual([]);
  });

  test('buckets rows by (field_type, field_label)', () => {
    const out = computeFieldBiasFromRows([
      { field_type: 'measurement', field_label: 'Wall height', ai_value: '2000mm', confirmed_value: '2000mm', was_edited: false },
      { field_type: 'measurement', field_label: 'Wall height', ai_value: '1500mm', confirmed_value: '1500mm', was_edited: false },
      { field_type: 'measurement', field_label: 'Wall length', ai_value: '4000mm', confirmed_value: '4000mm', was_edited: false },
    ]);

    const wallHeight = out.find(r => r.field_label === 'Wall height');
    const wallLength = out.find(r => r.field_label === 'Wall length');
    expect(wallHeight.total).toBe(2);
    expect(wallLength.total).toBe(1);
  });

  test('computes editRatePct from was_edited flags', () => {
    const out = computeFieldBiasFromRows([
      { field_type: 'labour_days', field_label: 'Estimated Days', ai_value: '5', confirmed_value: '5', was_edited: false },
      { field_type: 'labour_days', field_label: 'Estimated Days', ai_value: '5', confirmed_value: '7', was_edited: true },
      { field_type: 'labour_days', field_label: 'Estimated Days', ai_value: '8', confirmed_value: '6', was_edited: true },
      { field_type: 'labour_days', field_label: 'Estimated Days', ai_value: '4', confirmed_value: '4', was_edited: false },
    ]);

    expect(out[0].total).toBe(4);
    expect(out[0].editRatePct).toBe(50.0); // 2 of 4 edited
  });

  test('regression: "2,000mm" vs "3,100mm" produces ~55% bias, not 154,900%', () => {
    // The 2026-06-22 calibration investigation bug case. parseFloat()
    // on these strings returned 2 and 3, so the old edit_magnitude
    // was 0.5 (50%) — wait, actually parseFloat("3,100mm") returns 3
    // because of the comma. So magnitudes were inconsistent. With
    // parseAiValue both strings parse cleanly to 2000 and 3100, and
    // the magnitude is (3100 - 2000) / 2000 = 0.55.
    const out = computeFieldBiasFromRows([
      {
        field_type: 'measurement',
        field_label: 'Wall height',
        ai_value: '2,000mm',
        confirmed_value: '3,100mm',
        was_edited: true,
      },
    ]);

    expect(out[0].avgBiasPct).toBeGreaterThan(50);
    expect(out[0].avgBiasPct).toBeLessThan(60);
    // The crucial property: NOT in the thousands-of-percent range
    // that contaminated the old chart.
    expect(out[0].avgBiasPct).toBeLessThan(100);
  });

  test('avgErrorPct is the average of absolute magnitudes', () => {
    // Two rows, biases +50% and -50% — net bias is 0%, but error
    // (the unsigned magnitude) is 50%. This distinction matters for
    // calibration: a field that flip-flops doesn't have a calibration
    // problem in the "always over" or "always under" sense, but it
    // does have a precision problem.
    const out = computeFieldBiasFromRows([
      { field_type: 'material_unit_cost', field_label: 'Stone', ai_value: '100', confirmed_value: '150', was_edited: true },
      { field_type: 'material_unit_cost', field_label: 'Stone', ai_value: '100', confirmed_value: '50', was_edited: true },
    ]);

    expect(out[0].avgBiasPct).toBe(0); // (50% + -50%) / 2
    expect(out[0].avgErrorPct).toBe(50); // (50% + 50%) / 2
  });

  test('rows with unparseable ai_value are excluded from bias but counted in total', () => {
    // Real data has values like "TBC" or "n/a". Those shouldn't poison
    // bias averages but should still count toward total / edit rate.
    const out = computeFieldBiasFromRows([
      { field_type: 'material_unit_cost', field_label: 'Stone', ai_value: '100', confirmed_value: '120', was_edited: true },
      { field_type: 'material_unit_cost', field_label: 'Stone', ai_value: 'TBC', confirmed_value: '50', was_edited: true },
      { field_type: 'material_unit_cost', field_label: 'Stone', ai_value: '100', confirmed_value: '100', was_edited: false },
    ]);

    expect(out[0].total).toBe(3); // all three counted
    expect(out[0].editRatePct).toBeCloseTo(66.7, 1); // 2/3 edited
    // Bias averages only the rows with numeric data on BOTH sides:
    // row 1 (+20%) and row 3 (0%) → 10% average. Row 2 ("TBC") is
    // excluded from the bias bucket entirely.
    expect(out[0].avgBiasPct).toBe(10);
  });

  test('rows with ai_value = 0 are skipped (no divide-by-zero)', () => {
    const out = computeFieldBiasFromRows([
      { field_type: 'labour_days', field_label: 'Days', ai_value: '0', confirmed_value: '5', was_edited: true },
      { field_type: 'labour_days', field_label: 'Days', ai_value: '5', confirmed_value: '5', was_edited: false },
    ]);

    expect(out[0].total).toBe(2);
    // Only the 2nd row contributes (zero bias).
    expect(out[0].avgBiasPct).toBe(0);
    expect(Number.isFinite(out[0].avgBiasPct)).toBe(true);
  });

  test('output is sorted by editRatePct DESC (matches old SQL ORDER BY)', () => {
    const out = computeFieldBiasFromRows([
      { field_type: 'measurement', field_label: 'A', ai_value: '5', confirmed_value: '5', was_edited: false },
      { field_type: 'measurement', field_label: 'B', ai_value: '5', confirmed_value: '6', was_edited: true },
      { field_type: 'measurement', field_label: 'B', ai_value: '5', confirmed_value: '7', was_edited: true },
      { field_type: 'measurement', field_label: 'C', ai_value: '5', confirmed_value: '6', was_edited: true },
      { field_type: 'measurement', field_label: 'C', ai_value: '5', confirmed_value: '5', was_edited: false },
    ]);

    // B: 100% edit rate; C: 50%; A: 0% — order DESC.
    expect(out.map(r => r.field_label)).toEqual(['B', 'C', 'A']);
  });

  test('output shape matches what LearningDashboard expects', () => {
    const out = computeFieldBiasFromRows([
      { field_type: 'labour_days', field_label: 'Days', ai_value: '5', confirmed_value: '6', was_edited: true },
    ]);

    expect(out[0]).toHaveProperty('field_type');
    expect(out[0]).toHaveProperty('field_label');
    expect(out[0]).toHaveProperty('total');
    expect(out[0]).toHaveProperty('editRatePct');
    expect(out[0]).toHaveProperty('avgBiasPct');
    expect(out[0]).toHaveProperty('avgErrorPct');
    // All numeric fields are actual numbers, not strings.
    expect(typeof out[0].total).toBe('number');
    expect(typeof out[0].editRatePct).toBe('number');
    expect(typeof out[0].avgBiasPct).toBe('number');
    expect(typeof out[0].avgErrorPct).toBe('number');
  });
});
