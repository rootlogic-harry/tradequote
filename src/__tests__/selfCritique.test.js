import { applyCorrectedValues, CRITIQUE_SYSTEM_PROMPT } from '../../agents/selfCritique.js';

describe('CRITIQUE_SYSTEM_PROMPT — extended checks', () => {
  test('checks the materials/labour boundary explicitly', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/Materials\/labour boundary/i);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/rebuild|rebuilding/);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/dismantle|dismantling/);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/repoint|repointing/);
  });

  test('checks every measurement has a valid confidence', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/Confidence-field hygiene/i);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/null, missing, blank/);
  });

  test('checks stone tonnage falls in the 0.8–1.2 t/sqm range', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/Stone tonnage range/i);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/0\.8.{0,4}1\.2/);
  });

  test('checks each line item arithmetic equals quantity × unitCost', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/Line-item arithmetic/i);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/quantity .{0,3}unitCost/);
  });

  // Paul/Harry 2026-05-18 — Claude was treating mortar as a default
  // material on every quote. The critique should catch a mortar line
  // item that has no justification in the damage description or
  // schedule of works.
  test('flags mortar materials without a documented justification in the analysis', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/mortar/i);
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/dry-laid|dry laid|default.*dry/i);
  });
});

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

  // TRQ-175 — Mortar over-inclusion corrections (eval-review verified 2026-06-20)
  describe('mortar over-inclusion corrections (TRQ-175)', () => {
    test('removes lime mortar line item when severity is high', () => {
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'No mortared bed described', suggestedFix: 'Remove lime mortar', severity: 'high' },
      ];
      const result = applyCorrectedValues(baseAnalysis, corrections);
      const mortar = result.materials.find(m => m.description.toLowerCase().includes('mortar'));
      expect(mortar).toBeUndefined();
      // Stone supply row preserved
      expect(result.materials.find(m => m.description.toLowerCase().includes('stone'))).toBeTruthy();
    });

    test('removes mortar line item when severity is medium', () => {
      const corrections = [
        { field: 'mortar', issue: 'Dry-laid by default', suggestedFix: 'Remove', severity: 'medium' },
      ];
      const result = applyCorrectedValues(baseAnalysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('mortar'))).toBeUndefined();
    });

    test('removes NHL mortar line item', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'NHL 3.5 hydraulic lime', quantity: '2', unit: 'bag', unitCost: 25, totalCost: 50 },
        ],
      };
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'NHL not justified', suggestedFix: 'Remove NHL line', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('nhl'))).toBeUndefined();
      expect(result.materials).toHaveLength(1);
    });

    test('removes mortar & sand line item', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Mortar & sand mix', quantity: '1', unit: 'Item', unitCost: 40, totalCost: 40 },
        ],
      };
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'No justification', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('mortar'))).toBeUndefined();
    });

    test('does not remove anything when severity is low', () => {
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'Possibly unneeded', suggestedFix: 'Consider removal', severity: 'low' },
      ];
      const result = applyCorrectedValues(baseAnalysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('mortar'))).toBeTruthy();
    });

    test('does not touch non-mortar materials', () => {
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'No justification', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(baseAnalysis, corrections);
      const stone = result.materials.find(m => m.description.toLowerCase().includes('stone'));
      expect(stone).toBeTruthy();
      expect(stone.quantity).toBe('2');
      expect(stone.totalCost).toBe(360);
    });

    test('handles missing materials array safely', () => {
      const analysis = { ...baseAnalysis, materials: null };
      const corrections = [
        { field: 'Mortar over-inclusion', issue: 'No justification', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials).toBeNull();
    });
  });

  // TRQ-175 — Materials/labour boundary corrections (eval-review verified 2026-06-20)
  describe('materials/labour boundary corrections (TRQ-175)', () => {
    test('removes a "rebuild" row that leaked into materials when severity is high', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Rebuild wall @ £120/sqm', quantity: '6', unit: 'sqm', unitCost: 120, totalCost: 720 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Rebuild is labour not material', suggestedFix: 'Remove rebuild row', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('rebuild'))).toBeUndefined();
      expect(result.materials).toHaveLength(1);
    });

    test('removes a "dismantle" row from materials', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Dismantling existing wall', quantity: '6', unit: 'sqm', unitCost: 35, totalCost: 210 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Dismantle belongs in labour', suggestedFix: 'Remove', severity: 'medium' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('dismantl'))).toBeUndefined();
    });

    test('removes a "repointing" row from materials', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Repointing mortar joints', quantity: '4', unit: 'sqm', unitCost: 45, totalCost: 180 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Repointing is labour', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('repoint'))).toBeUndefined();
    });

    test('removes a "site clearance" row from materials', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Site clearance', quantity: '1', unit: 'Item', unitCost: 100, totalCost: 100 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Site clearance is labour', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('clearance'))).toBeUndefined();
    });

    test('removes a "making good" row from materials', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Making good after works', quantity: '1', unit: 'Item', unitCost: 60, totalCost: 60 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Making good is labour', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('making good'))).toBeUndefined();
    });

    test('removes a "core consolidation" row from materials', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Core consolidation @ £30/sqm', quantity: '6', unit: 'sqm', unitCost: 30, totalCost: 180 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Core consolidation is labour', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('consolidation'))).toBeUndefined();
    });

    test('does not remove labour-coded rows when severity is low', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Rebuild wall @ £120/sqm', quantity: '6', unit: 'sqm', unitCost: 120, totalCost: 720 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Could be flagged', suggestedFix: 'Consider removal', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials.find(m => m.description.toLowerCase().includes('rebuild'))).toBeTruthy();
    });

    test('removes multiple labour-coded rows in one pass', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Rebuild wall @ £120/sqm', quantity: '6', unit: 'sqm', unitCost: 120, totalCost: 720 },
          { description: 'Dismantling existing courses', quantity: '6', unit: 'sqm', unitCost: 35, totalCost: 210 },
          { description: 'Site clearance', quantity: '1', unit: 'Item', unitCost: 100, totalCost: 100 },
        ],
      };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Multiple labour rows in materials', suggestedFix: 'Remove all', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials).toHaveLength(1);
      expect(result.materials[0].description.toLowerCase()).toContain('stone');
    });

    test('handles missing materials array safely', () => {
      const analysis = { ...baseAnalysis, materials: null };
      const corrections = [
        { field: 'Materials/labour boundary', issue: 'Whatever', suggestedFix: 'Remove', severity: 'high' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials).toBeNull();
    });
  });

  // TRQ-175 — Line-item arithmetic corrections (eval-review verified 2026-06-20)
  describe('line-item arithmetic corrections (TRQ-175)', () => {
    test('recomputes totalCost when quantity × unitCost does not match stored totalCost', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 999 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: '2 × 180 ≠ 999', suggestedFix: 'Recompute to 360', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials[0].totalCost).toBe(360);
    });

    test('fixes arithmetic at any severity level (low)', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Sundries', quantity: '4', unit: 'Item', unitCost: 25, totalCost: 50 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Mismatch', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials[0].totalCost).toBe(100);
    });

    test('leaves correct rows unchanged', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
          { description: 'Lime mortar', quantity: '3', unit: 'Item', unitCost: 90, totalCost: 270 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Check rows', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials[0].totalCost).toBe(360);
      expect(result.materials[1].totalCost).toBe(270);
    });

    test('recomputes multiple rows in one pass', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Replacement stone supply', quantity: '2', unit: 't', unitCost: 180, totalCost: 100 },
          { description: 'Lime mortar', quantity: '3', unit: 'Item', unitCost: 90, totalCost: 500 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Both mismatched', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials[0].totalCost).toBe(360);
      expect(result.materials[1].totalCost).toBe(270);
    });

    test('tolerates floating-point within £0.01', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Sand', quantity: '0.1', unit: 't', unitCost: 30, totalCost: 3.0 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Check', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      // 0.1 * 30 = 3 (within tolerance) so it should stay 3.0
      expect(result.materials[0].totalCost).toBe(3.0);
    });

    test('handles missing materials array safely', () => {
      const analysis = { ...baseAnalysis, materials: null };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Whatever', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      expect(result.materials).toBeNull();
    });

    test('handles non-numeric quantity or unitCost gracefully', () => {
      const analysis = {
        ...baseAnalysis,
        materials: [
          { description: 'Weird row', quantity: 'TBC', unit: 'Item', unitCost: 'TBC', totalCost: 999 },
        ],
      };
      const corrections = [
        { field: 'Line-item arithmetic', issue: 'Mismatch', suggestedFix: 'Recompute', severity: 'low' },
      ];
      const result = applyCorrectedValues(analysis, corrections);
      // Cannot compute, should leave the row alone
      expect(result.materials[0].totalCost).toBe(999);
    });
  });

  // TRQ-175 — aiValue immutability (eval-review verified 2026-06-20)
  test('does not write to any aiValue field across all correction types', () => {
    const analysis = {
      ...baseAnalysis,
      materials: [
        { description: 'Replacement stone supply', aiValue: '2', quantity: '2', unit: 't', unitCost: 180, totalCost: 999 },
        { description: 'Lime mortar', aiValue: '3', quantity: '3', unit: 'Item', unitCost: 90, totalCost: 270 },
        { description: 'Rebuild wall @ £120/sqm', aiValue: '6', quantity: '6', unit: 'sqm', unitCost: 120, totalCost: 720 },
      ],
      labourEstimate: { estimatedDays: 5, aiValue: 5 },
    };
    const corrections = [
      { field: 'Labour days', issue: 'High', suggestedFix: '3', severity: 'high' },
      { field: 'Tonnage', issue: 'Low', suggestedFix: '4', severity: 'high' },
      { field: 'Mortar over-inclusion', issue: 'No justification', suggestedFix: 'Remove', severity: 'high' },
      { field: 'Materials/labour boundary', issue: 'Labour in materials', suggestedFix: 'Remove', severity: 'high' },
      { field: 'Line-item arithmetic', issue: 'Mismatch', suggestedFix: 'Recompute', severity: 'low' },
    ];
    const result = applyCorrectedValues(analysis, corrections);
    // labourEstimate.aiValue must remain
    expect(result.labourEstimate.aiValue).toBe(5);
    // Surviving rows must retain aiValue
    const stone = result.materials.find(m => m.description.toLowerCase().includes('stone'));
    expect(stone.aiValue).toBe('2');
  });
});
