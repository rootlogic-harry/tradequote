import {
  calculateMaterialsSubtotal,
  calculateLabourTotal,
  calculateAdditionalCostsTotal,
  calculateSubtotal,
  calculateVAT,
  calculateTotal,
  calculateAllTotals,
} from '../utils/calculations.js';

describe('calculateMaterialsSubtotal', () => {
  test('returns 0 for empty array', () => {
    expect(calculateMaterialsSubtotal([])).toBe(0);
  });

  test('sums a single material', () => {
    expect(calculateMaterialsSubtotal([{ totalCost: 250 }])).toBe(250);
  });

  test('sums multiple materials', () => {
    const materials = [
      { totalCost: 250 },
      { totalCost: 180.50 },
      { totalCost: 75 },
    ];
    expect(calculateMaterialsSubtotal(materials)).toBe(505.50);
  });

  test('treats missing totalCost as 0', () => {
    const materials = [{ totalCost: 100 }, { description: 'no cost' }];
    expect(calculateMaterialsSubtotal(materials)).toBe(100);
  });

  test('treats null totalCost as 0', () => {
    const materials = [{ totalCost: 100 }, { totalCost: null }];
    expect(calculateMaterialsSubtotal(materials)).toBe(100);
  });
});

describe('calculateLabourTotal', () => {
  test('calculates days × workers × dayRate', () => {
    expect(calculateLabourTotal(3, 2, 400)).toBe(2400);
  });

  test('returns 0 when days is 0', () => {
    expect(calculateLabourTotal(0, 2, 400)).toBe(0);
  });

  test('returns 0 when workers is 0', () => {
    expect(calculateLabourTotal(3, 0, 400)).toBe(0);
  });

  test('returns 0 when dayRate is 0', () => {
    expect(calculateLabourTotal(3, 2, 0)).toBe(0);
  });

  test('handles decimal days and rates', () => {
    expect(calculateLabourTotal(2.5, 1, 350)).toBe(875);
  });
});

describe('calculateAdditionalCostsTotal', () => {
  test('returns 0 for empty array', () => {
    expect(calculateAdditionalCostsTotal([])).toBe(0);
  });

  test('sums amounts correctly', () => {
    const costs = [{ amount: 50 }, { amount: 120 }, { amount: 30.50 }];
    expect(calculateAdditionalCostsTotal(costs)).toBe(200.50);
  });

  test('treats missing amount as 0', () => {
    const costs = [{ amount: 100 }, { label: 'Travel' }];
    expect(calculateAdditionalCostsTotal(costs)).toBe(100);
  });
});

describe('calculateSubtotal', () => {
  test('sums all three components', () => {
    expect(calculateSubtotal(500, 2400, 150)).toBe(3050);
  });

  test('handles all zeros', () => {
    expect(calculateSubtotal(0, 0, 0)).toBe(0);
  });
});

describe('calculateVAT', () => {
  test('returns 20% when VAT registered', () => {
    expect(calculateVAT(1000, true)).toBe(200);
  });

  test('returns 0 when not VAT registered', () => {
    expect(calculateVAT(1000, false)).toBe(0);
  });

  test('returns 0 on zero subtotal even if registered', () => {
    expect(calculateVAT(0, true)).toBe(0);
  });

  test('rounds to 2 decimal places', () => {
    // 333.33 * 0.2 = 66.666 → 66.67
    expect(calculateVAT(333.33, true)).toBe(66.67);
  });
});

describe('calculateTotal', () => {
  test('adds subtotal and VAT', () => {
    expect(calculateTotal(3050, 610)).toBe(3660);
  });

  test('works with zero VAT', () => {
    expect(calculateTotal(3050, 0)).toBe(3050);
  });
});

describe('calculateAllTotals', () => {
  const materials = [{ totalCost: 500 }, { totalCost: 300 }];
  const labour = { days: 3, workers: 2, dayRate: 400 };
  const additionalCosts = [{ amount: 150 }];

  test('VAT-registered path', () => {
    const result = calculateAllTotals(materials, labour, additionalCosts, true);
    expect(result.materialsSubtotal).toBe(800);
    expect(result.labourTotal).toBe(2400);
    expect(result.additionalCostsTotal).toBe(150);
    expect(result.subtotal).toBe(3350);
    expect(result.vatAmount).toBe(670);
    expect(result.total).toBe(4020);
  });

  test('non-VAT-registered path', () => {
    const result = calculateAllTotals(materials, labour, additionalCosts, false);
    expect(result.materialsSubtotal).toBe(800);
    expect(result.labourTotal).toBe(2400);
    expect(result.additionalCostsTotal).toBe(150);
    expect(result.subtotal).toBe(3350);
    expect(result.vatAmount).toBe(0);
    expect(result.total).toBe(3350);
  });
});

// Hardening: silent NaN propagation + floating-point sum drift were
// occasionally producing "£NaN" labour and per-row totals that did not
// match the displayed subtotal to the penny.
describe('calculations hardening', () => {
  test('calculateLabourTotal returns 0 when dayRate is undefined (no NaN leak)', () => {
    expect(calculateLabourTotal(2, 1, undefined)).toBe(0);
    expect(calculateLabourTotal(2, undefined, 400)).toBe(0);
    expect(calculateLabourTotal(undefined, 1, 400)).toBe(0);
  });

  test('calculateLabourTotal returns 0 for NaN inputs', () => {
    expect(calculateLabourTotal(NaN, 1, 400)).toBe(0);
    expect(calculateLabourTotal(2, NaN, 400)).toBe(0);
    expect(calculateLabourTotal(2, 1, NaN)).toBe(0);
  });

  test('calculateLabourTotal returns 0 for null inputs', () => {
    expect(calculateLabourTotal(null, null, null)).toBe(0);
  });

  test('calculateMaterialsSubtotal sums to exact penny across many fractional rows', () => {
    // Three rows that each round-display to £100.00 but FP-sum to 299.91
    // would mismatch the displayed total before integer-pence rounding.
    const materials = [
      { totalCost: 99.96 },
      { totalCost: 99.97 },
      { totalCost: 99.98 },
    ];
    expect(calculateMaterialsSubtotal(materials)).toBe(299.91);
  });

  test('calculateMaterialsSubtotal handles 0.1 + 0.2 floating-point classic', () => {
    // 0.1 + 0.2 in raw float = 0.30000000000000004
    const materials = [{ totalCost: 0.1 }, { totalCost: 0.2 }];
    expect(calculateMaterialsSubtotal(materials)).toBe(0.3);
  });

  test('calculateAdditionalCostsTotal floors negative amounts at 0', () => {
    // A user typing "-100" by mistake (or a regression letting negatives
    // through validation) must not silently understate the quote.
    const costs = [{ amount: 100 }, { amount: -50 }];
    expect(calculateAdditionalCostsTotal(costs)).toBe(100);
  });

  test('full pipeline survives missing dayRate without leaking NaN', () => {
    const labourMissing = { days: 2, workers: 1, dayRate: undefined };
    const result = calculateAllTotals([{ totalCost: 100 }], labourMissing, [], false);
    expect(Number.isFinite(result.labourTotal)).toBe(true);
    expect(Number.isFinite(result.subtotal)).toBe(true);
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.labourTotal).toBe(0);
    expect(result.subtotal).toBe(100);
  });
});
