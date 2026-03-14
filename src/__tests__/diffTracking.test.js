import {
  NUMERIC_FIELD_TYPES,
  isNumericFieldType,
  calculateEditMagnitude,
  buildDiff,
  calculateAIAccuracyScore,
  shouldExcludeUser,
  enrichDiffWithContext,
} from '../utils/diffTracking.js';

describe('isNumericFieldType', () => {
  test('returns true for measurement', () => {
    expect(isNumericFieldType('measurement')).toBe(true);
  });

  test('returns true for material_quantity', () => {
    expect(isNumericFieldType('material_quantity')).toBe(true);
  });

  test('returns true for material_unit_cost', () => {
    expect(isNumericFieldType('material_unit_cost')).toBe(true);
  });

  test('returns true for labour_days', () => {
    expect(isNumericFieldType('labour_days')).toBe(true);
  });

  test('returns true for labour_workers', () => {
    expect(isNumericFieldType('labour_workers')).toBe(true);
  });

  test('returns false for text types', () => {
    expect(isNumericFieldType('damage_description')).toBe(false);
  });

  test('returns false for unknown types', () => {
    expect(isNumericFieldType('random')).toBe(false);
  });
});

describe('calculateEditMagnitude', () => {
  test('positive magnitude when AI underestimated', () => {
    // (5400 - 4500) / 4500 = 0.2
    expect(calculateEditMagnitude('4500', '5400')).toBeCloseTo(0.2);
  });

  test('negative magnitude when AI overestimated', () => {
    // (3600 - 4500) / 4500 = -0.2
    expect(calculateEditMagnitude('4500', '3600')).toBeCloseTo(-0.2);
  });

  test('returns 0 when values are equal', () => {
    expect(calculateEditMagnitude('4500', '4500')).toBe(0);
  });

  test('returns null when aiValue is 0 (division by zero)', () => {
    expect(calculateEditMagnitude('0', '100')).toBeNull();
  });

  test('returns null for non-numeric aiValue', () => {
    expect(calculateEditMagnitude('abc', '100')).toBeNull();
  });

  test('returns null for non-numeric confirmedValue', () => {
    expect(calculateEditMagnitude('100', 'xyz')).toBeNull();
  });
});

describe('buildDiff', () => {
  test('accepted numeric field: wasEdited=false, magnitude=0', () => {
    const diff = buildDiff('measurement', 'Wall length', '4500', '4500');
    expect(diff.fieldType).toBe('measurement');
    expect(diff.fieldLabel).toBe('Wall length');
    expect(diff.aiValue).toBe('4500');
    expect(diff.confirmedValue).toBe('4500');
    expect(diff.wasEdited).toBe(false);
    expect(diff.editMagnitude).toBe(0);
    expect(typeof diff.createdAt).toBe('number');
  });

  test('edited numeric field: wasEdited=true, magnitude calculated', () => {
    const diff = buildDiff('measurement', 'Wall length', '4500', '5400');
    expect(diff.wasEdited).toBe(true);
    expect(diff.editMagnitude).toBeCloseTo(0.2);
  });

  test('text field: magnitude is null even when edited', () => {
    const diff = buildDiff('damage_description', 'Damage', 'old text', 'new text');
    expect(diff.wasEdited).toBe(true);
    expect(diff.editMagnitude).toBeNull();
  });

  test('text field: magnitude is null even when accepted', () => {
    const diff = buildDiff('damage_description', 'Damage', 'same text', 'same text');
    expect(diff.wasEdited).toBe(false);
    expect(diff.editMagnitude).toBeNull();
  });

  test('aiValue and confirmedValue are stored independently', () => {
    const diff = buildDiff('measurement', 'Height', '1400', '1600');
    expect(diff.aiValue).toBe('1400');
    expect(diff.confirmedValue).toBe('1600');
    // Changing one does not affect the other (strings are immutable primitives)
  });

  test('createdAt is a recent timestamp', () => {
    const before = Date.now();
    const diff = buildDiff('measurement', 'Test', '100', '100');
    const after = Date.now();
    expect(diff.createdAt).toBeGreaterThanOrEqual(before);
    expect(diff.createdAt).toBeLessThanOrEqual(after);
  });
});

describe('calculateAIAccuracyScore', () => {
  test('returns null for empty diffs array', () => {
    expect(calculateAIAccuracyScore([])).toBeNull();
  });

  test('returns 1.0 when all numeric diffs accepted', () => {
    const diffs = [
      { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 },
      { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBe(1.0);
  });

  test('returns 0.0 when all numeric diffs edited', () => {
    const diffs = [
      { fieldType: 'measurement', wasEdited: true, editMagnitude: 0.2 },
      { fieldType: 'measurement', wasEdited: true, editMagnitude: -0.1 },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBe(0.0);
  });

  test('returns correct mixed score rounded to 3dp', () => {
    // 2 accepted, 1 edited → 2/3 = 0.667
    const diffs = [
      { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 },
      { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 },
      { fieldType: 'measurement', wasEdited: true, editMagnitude: 0.1 },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBe(0.667);
  });

  test('returns null when only text field diffs exist', () => {
    const diffs = [
      { fieldType: 'damage_description', wasEdited: true, editMagnitude: null },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBeNull();
  });

  test('excludes text fields from calculation', () => {
    const diffs = [
      { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 },
      { fieldType: 'damage_description', wasEdited: true, editMagnitude: null },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBe(1.0);
  });
});

describe('shouldExcludeUser', () => {
  test('returns true when average below threshold', () => {
    expect(shouldExcludeUser([0.1, 0.2, 0.3])).toBe(true);
  });

  test('returns false when average above threshold', () => {
    expect(shouldExcludeUser([0.8, 0.9, 0.7])).toBe(false);
  });

  test('returns false with fewer than 3 scores', () => {
    expect(shouldExcludeUser([0.1, 0.2])).toBe(false);
  });

  test('respects custom threshold', () => {
    expect(shouldExcludeUser([0.5, 0.5, 0.5], 0.6)).toBe(true);
    expect(shouldExcludeUser([0.5, 0.5, 0.5], 0.4)).toBe(false);
  });
});

describe('enrichDiffWithContext', () => {
  const baseDiff = {
    fieldType: 'measurement',
    fieldLabel: 'Wall length',
    aiValue: '4500',
    confirmedValue: '4500',
    wasEdited: false,
    editMagnitude: 0,
    createdAt: 1700000000000,
  };

  const context = {
    referenceCardUsed: true,
    stoneType: 'gritstone',
    wallHeightMm: 1400,
    wallLengthMm: 4500,
    terrainGradientDeg: 5,
  };

  test('does not mutate the original diff', () => {
    const original = { ...baseDiff };
    enrichDiffWithContext(baseDiff, context);
    expect(baseDiff).toEqual(original);
  });

  test('returns a new object with context merged', () => {
    const result = enrichDiffWithContext(baseDiff, context);
    expect(result.referenceCardUsed).toBe(true);
    expect(result.stoneType).toBe('gritstone');
    expect(result.wallHeightMm).toBe(1400);
  });

  test('preserves all original diff fields', () => {
    const result = enrichDiffWithContext(baseDiff, context);
    expect(result.fieldType).toBe('measurement');
    expect(result.fieldLabel).toBe('Wall length');
    expect(result.aiValue).toBe('4500');
    expect(result.confirmedValue).toBe('4500');
    expect(result.wasEdited).toBe(false);
    expect(result.editMagnitude).toBe(0);
    expect(result.createdAt).toBe(1700000000000);
  });

  test('handles partial context', () => {
    const result = enrichDiffWithContext(baseDiff, { stoneType: 'limestone' });
    expect(result.stoneType).toBe('limestone');
    expect(result.referenceCardUsed).toBeUndefined();
  });
});
