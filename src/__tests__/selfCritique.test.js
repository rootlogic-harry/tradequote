import { applyCorrectedValues } from '../../agents/selfCritique.js';

describe('applyCorrectedValues', () => {
  const baseAnalysis = {
    stoneType: 'gritstone',
    damageDescription: 'Collapsed section of wall',
    measurements: [
      { item: 'Wall height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high' },
      { item: 'Wall length', valueMm: 4500, displayValue: '4,500mm', confidence: 'medium' },
    ],
    materials: [
      { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
      { description: 'Lime mortar', quantity: '3', unit: 'Item', unitCost: 90, totalCost: 270 },
    ],
    labourEstimate: {
      estimatedDays: 5,
      numberOfWorkers: 1,
      calculationBasis: '6 sqm x 0.5hr/sqm',
    },
    scheduleOfWorks: [
      { stepNumber: 1, title: 'Site clearance', description: 'Clear debris' },
    ],
  };

  test('returns original analysis when corrections is null', () => {
    const result = applyCorrectedValues(baseAnalysis, null);
    expect(result).toEqual(baseAnalysis);
  });

  test('returns original analysis when corrections is empty array', () => {
    const result = applyCorrectedValues(baseAnalysis, []);
    expect(result).toEqual(baseAnalysis);
  });

  test('returns original analysis when corrections is undefined', () => {
    const result = applyCorrectedValues(baseAnalysis, undefined);
    expect(result).toEqual(baseAnalysis);
  });

  test('does not mutate the original analysis', () => {
    const original = JSON.parse(JSON.stringify(baseAnalysis));
    const corrections = [
      { field: 'Labour days', issue: 'Too high', suggestedFix: '3', severity: 'high' },
    ];
    applyCorrectedValues(baseAnalysis, corrections);
    expect(baseAnalysis).toEqual(original);
  });

  // Labour days corrections
  test('corrects labour days when field contains "labour" and "day"', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Overestimated', suggestedFix: '3', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(3);
  });

  test('corrects labour days with mixed case field name', () => {
    const corrections = [
      { field: 'labour_days estimation', issue: 'Too high', suggestedFix: '2.5', severity: 'medium' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(2.5);
  });

  test('corrects labour days with "Estimated Days" field name', () => {
    const corrections = [
      { field: 'Estimated Days for Labour', issue: 'Unrealistic', suggestedFix: '4', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(4);
  });

  test('ignores labour correction when suggestedFix is not a number', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Overestimated', suggestedFix: 'reduce by half', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(5); // unchanged
  });

  test('ignores labour correction when suggestedFix is zero', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Wrong', suggestedFix: '0', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(5); // unchanged
  });

  test('ignores labour correction when suggestedFix is negative', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Wrong', suggestedFix: '-3', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(5); // unchanged
  });

  test('ignores labour correction when labourEstimate is missing', () => {
    const analysis = { ...baseAnalysis, labourEstimate: undefined };
    const corrections = [
      { field: 'Labour days', issue: 'Wrong', suggestedFix: '3', severity: 'high' },
    ];
    const result = applyCorrectedValues(analysis, corrections);
    expect(result.labourEstimate).toBeUndefined();
  });

  test('ignores labour correction when suggestedFix is null', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Wrong', suggestedFix: null, severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(5);
  });

  // Tonnage / stone supply corrections
  test('corrects stone tonnage when field contains "tonnage"', () => {
    const corrections = [
      { field: 'Tonnage', issue: 'Too low', suggestedFix: '4 tonnes', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    const stoneItem = result.materials.find(m => m.description.toLowerCase().includes('stone') && m.unit.toLowerCase() === 't');
    expect(stoneItem.quantity).toBe('4');
    expect(stoneItem.totalCost).toBe(4 * 180);
  });

  test('corrects stone tonnage when field contains "stone supply"', () => {
    const corrections = [
      { field: 'Stone supply quantity', issue: 'Underestimated', suggestedFix: '3.5', severity: 'medium' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    const stoneItem = result.materials.find(m => m.description.toLowerCase().includes('stone'));
    expect(stoneItem.quantity).toBe('3.5');
    expect(stoneItem.totalCost).toBe(3.5 * 180);
  });

  test('ignores tonnage correction when no matching material exists', () => {
    const analysis = {
      ...baseAnalysis,
      materials: [
        { description: 'Lime mortar', quantity: '3', unit: 'Item', unitCost: 90, totalCost: 270 },
      ],
    };
    const corrections = [
      { field: 'Tonnage', issue: 'Wrong', suggestedFix: '5 tonnes', severity: 'high' },
    ];
    const result = applyCorrectedValues(analysis, corrections);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].totalCost).toBe(270); // unchanged
  });

  test('ignores tonnage correction when suggestedFix has no number', () => {
    const corrections = [
      { field: 'Tonnage', issue: 'Too low', suggestedFix: 'increase significantly', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    const stoneItem = result.materials.find(m => m.description.toLowerCase().includes('stone'));
    expect(stoneItem.quantity).toBe('2'); // unchanged
  });

  test('ignores tonnage correction when materials array is null', () => {
    const analysis = { ...baseAnalysis, materials: null };
    const corrections = [
      { field: 'Tonnage', issue: 'Wrong', suggestedFix: '5', severity: 'high' },
    ];
    // Should not throw
    const result = applyCorrectedValues(analysis, corrections);
    expect(result.materials).toBeNull();
  });

  test('recalculates totalCost based on unitCost when tonnage is corrected', () => {
    const analysis = {
      ...baseAnalysis,
      materials: [
        { description: 'Replacement stone', quantity: '2', unit: 't', unitCost: 200, totalCost: 400 },
      ],
    };
    const corrections = [
      { field: 'Tonnage', issue: 'Too low', suggestedFix: '6', severity: 'high' },
    ];
    const result = applyCorrectedValues(analysis, corrections);
    expect(result.materials[0].quantity).toBe('6');
    expect(result.materials[0].totalCost).toBe(6 * 200);
  });

  test('handles unitCost of 0 when recalculating totalCost', () => {
    const analysis = {
      ...baseAnalysis,
      materials: [
        { description: 'Stone supply', quantity: '2', unit: 't', unitCost: 0, totalCost: 0 },
      ],
    };
    const corrections = [
      { field: 'Tonnage', issue: 'Adjust', suggestedFix: '5', severity: 'high' },
    ];
    const result = applyCorrectedValues(analysis, corrections);
    expect(result.materials[0].quantity).toBe('5');
    expect(result.materials[0].totalCost).toBe(0);
  });

  // Multiple corrections
  test('applies multiple corrections at once', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Too high', suggestedFix: '3', severity: 'high' },
      { field: 'Tonnage', issue: 'Too low', suggestedFix: '4', severity: 'medium' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.labourEstimate.estimatedDays).toBe(3);
    const stoneItem = result.materials.find(m => m.description.toLowerCase().includes('stone'));
    expect(stoneItem.quantity).toBe('4');
  });

  // Field matching edge cases
  test('ignores corrections with null field', () => {
    const corrections = [
      { field: null, issue: 'Something', suggestedFix: '3', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result).toEqual(JSON.parse(JSON.stringify(baseAnalysis)));
  });

  test('ignores corrections with undefined field', () => {
    const corrections = [
      { issue: 'Something', suggestedFix: '3', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result).toEqual(JSON.parse(JSON.stringify(baseAnalysis)));
  });

  test('preserves unrelated fields (stoneType, measurements, schedule)', () => {
    const corrections = [
      { field: 'Labour days', issue: 'Adjust', suggestedFix: '2', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    expect(result.stoneType).toBe('gritstone');
    expect(result.measurements).toHaveLength(2);
    expect(result.scheduleOfWorks).toHaveLength(1);
    expect(result.damageDescription).toBe('Collapsed section of wall');
  });

  test('does not affect non-stone materials when correcting tonnage', () => {
    const corrections = [
      { field: 'Tonnage', issue: 'Adjust', suggestedFix: '4', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    const mortar = result.materials.find(m => m.description === 'Lime mortar');
    expect(mortar.quantity).toBe('3');
    expect(mortar.totalCost).toBe(270);
  });

  test('extracts number from suggestedFix with surrounding text', () => {
    const corrections = [
      { field: 'Tonnage', issue: 'Wrong', suggestedFix: 'Should be approximately 3.5 tonnes for this wall', severity: 'high' },
    ];
    const result = applyCorrectedValues(baseAnalysis, corrections);
    const stoneItem = result.materials.find(m => m.description.toLowerCase().includes('stone'));
    expect(stoneItem.quantity).toBe('3.5');
  });
});
