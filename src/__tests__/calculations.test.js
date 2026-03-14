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
