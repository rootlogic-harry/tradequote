import {
  parseAIResponse,
  validateAIResponse,
  normalizeAIResponse,
} from '../utils/aiParser.js';

// --- Shared test fixtures ---

const validAIResponse = {
  referenceCardDetected: true,
  referenceCardNote: 'Reference card visible in photo 4',
  stoneType: 'gritstone',
  damageDescription: 'A 4.5m section of double-faced dry stone wall has collapsed.',
  measurements: [
    { item: 'Breach length', valueMm: 4500, displayValue: '4,500mm', confidence: 'high', note: null },
    { item: 'Wall height', valueMm: 1400, displayValue: '1,400mm', confidence: 'medium', note: 'Estimated from adjacent standing section' },
  ],
  scheduleOfWorks: [
    { stepNumber: 1, title: 'Site clearance', description: 'Clear scattered stone and vegetation from the breach area.' },
    { stepNumber: 2, title: 'Foundation preparation', description: 'Expose and inspect existing foundation course.' },
  ],
  materials: [
    { description: 'Walling stone (gritstone)', quantity: '6 tonnes', unitCost: 85, totalCost: 510 },
    { description: 'Through stones', quantity: '8 No.', unitCost: 12, totalCost: 96 },
  ],
  labourEstimate: {
    description: '2 experienced wallers for 3 days',
    estimatedDays: 3,
    numberOfWorkers: 2,
    calculationBasis: '6.3 sq m × 1.5 hrs/sq m / 8hr day ≈ 3 days for 2 wallers',
  },
  siteConditions: {
    accessDifficulty: 'normal',
    accessNote: null,
    foundationCondition: 'sound',
    foundationNote: null,
    adjacentStructureRisk: false,
    adjacentStructureNote: null,
  },
  additionalNotes: 'Standing sections either side appear stable.',
};

// --- parseAIResponse ---

describe('parseAIResponse', () => {
  test('parses clean JSON string', () => {
    const result = parseAIResponse(JSON.stringify(validAIResponse));
    expect(result).toEqual(validAIResponse);
  });

  test('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(validAIResponse) + '\n```';
    const result = parseAIResponse(raw);
    expect(result).toEqual(validAIResponse);
  });

  test('parses JSON wrapped in plain ``` fences', () => {
    const raw = '```\n' + JSON.stringify(validAIResponse) + '\n```';
    const result = parseAIResponse(raw);
    expect(result).toEqual(validAIResponse);
  });

  test('parses JSON with preamble text before it', () => {
    const raw = 'Here is my analysis:\n\n' + JSON.stringify(validAIResponse);
    const result = parseAIResponse(raw);
    expect(result).toEqual(validAIResponse);
  });

  test('returns null for malformed JSON', () => {
    expect(parseAIResponse('{ invalid json')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseAIResponse('')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(parseAIResponse(null)).toBeNull();
  });

  test('returns null for truncated JSON', () => {
    const truncated = JSON.stringify(validAIResponse).slice(0, 50);
    expect(parseAIResponse(truncated)).toBeNull();
  });
});

// --- validateAIResponse ---

describe('validateAIResponse', () => {
  test('validates a complete valid response', () => {
    const result = validateAIResponse(validAIResponse);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when referenceCardDetected is missing', () => {
    const input = { ...validAIResponse };
    delete input.referenceCardDetected;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('referenceCardDetected'));
  });

  test('fails when stoneType is missing', () => {
    const input = { ...validAIResponse };
    delete input.stoneType;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails for invalid stoneType', () => {
    const input = { ...validAIResponse, stoneType: 'marble' };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('stoneType'));
  });

  test('fails when damageDescription is missing', () => {
    const input = { ...validAIResponse };
    delete input.damageDescription;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when measurements is empty', () => {
    const input = { ...validAIResponse, measurements: [] };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('measurements'));
  });

  test('fails when measurements is missing', () => {
    const input = { ...validAIResponse };
    delete input.measurements;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when scheduleOfWorks is empty', () => {
    const input = { ...validAIResponse, scheduleOfWorks: [] };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when scheduleOfWorks is missing', () => {
    const input = { ...validAIResponse };
    delete input.scheduleOfWorks;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when materials is missing', () => {
    const input = { ...validAIResponse };
    delete input.materials;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when labourEstimate is missing', () => {
    const input = { ...validAIResponse };
    delete input.labourEstimate;
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when estimatedDays is zero', () => {
    const input = { ...validAIResponse, labourEstimate: { ...validAIResponse.labourEstimate, estimatedDays: 0 } };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('estimatedDays'));
  });

  test('fails when estimatedDays is negative', () => {
    const input = { ...validAIResponse, labourEstimate: { ...validAIResponse.labourEstimate, estimatedDays: -1 } };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails when estimatedDays is missing', () => {
    const labour = { ...validAIResponse.labourEstimate };
    delete labour.estimatedDays;
    const input = { ...validAIResponse, labourEstimate: labour };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
  });

  test('fails for invalid measurement confidence', () => {
    const input = {
      ...validAIResponse,
      measurements: [
        { item: 'Test', valueMm: 100, displayValue: '100mm', confidence: 'very_high', note: null },
      ],
    };
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('confidence'));
  });

  test('returns valid:false for null input', () => {
    const result = validateAIResponse(null);
    expect(result.valid).toBe(false);
  });

  test('accumulates multiple errors', () => {
    const input = {};
    const result = validateAIResponse(input);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});

// --- normalizeAIResponse ---

describe('normalizeAIResponse', () => {
  test('sets confirmed=false on all measurements', () => {
    const result = normalizeAIResponse(validAIResponse);
    result.measurements.forEach(m => {
      expect(m.confirmed).toBe(false);
    });
  });

  test('sets aiValue equal to displayValue on measurements', () => {
    const result = normalizeAIResponse(validAIResponse);
    expect(result.measurements[0].aiValue).toBe('4,500mm');
    expect(result.measurements[1].aiValue).toBe('1,400mm');
  });

  test('sets value equal to aiValue initially', () => {
    const result = normalizeAIResponse(validAIResponse);
    result.measurements.forEach(m => {
      expect(m.value).toBe(m.aiValue);
    });
  });

  test('assigns unique ids to measurements', () => {
    const result = normalizeAIResponse(validAIResponse);
    const ids = result.measurements.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('assigns unique ids to materials', () => {
    const result = normalizeAIResponse(validAIResponse);
    const ids = result.materials.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('assigns unique ids to scheduleOfWorks', () => {
    const result = normalizeAIResponse(validAIResponse);
    const ids = result.scheduleOfWorks.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('does not mutate the original parsed object', () => {
    const original = JSON.parse(JSON.stringify(validAIResponse));
    normalizeAIResponse(validAIResponse);
    expect(validAIResponse).toEqual(original);
  });

  test('sets aiUnitCost and aiTotalCost on materials', () => {
    const result = normalizeAIResponse(validAIResponse);
    expect(result.materials[0].aiUnitCost).toBe(85);
    expect(result.materials[0].aiTotalCost).toBe(510);
  });

  test('defaults unit to "Item" when not provided by AI', () => {
    const result = normalizeAIResponse(validAIResponse);
    result.materials.forEach(m => {
      expect(m.unit).toBe('Item');
    });
  });

  test('preserves unit when provided by AI', () => {
    const input = {
      ...validAIResponse,
      materials: [
        { description: 'Dismantling', quantity: '1.2', unit: 'm²', unitCost: 220, totalCost: 264 },
        { description: 'Replacement stone', quantity: '0.35', unit: 't', unitCost: 185, totalCost: 64.75 },
      ],
    };
    const result = normalizeAIResponse(input);
    expect(result.materials[0].unit).toBe('m²');
    expect(result.materials[1].unit).toBe('t');
  });

  test('sets aiEstimatedDays on labourEstimate', () => {
    const result = normalizeAIResponse(validAIResponse);
    expect(result.labourEstimate.aiEstimatedDays).toBe(3);
  });

  test('defaults siteConditions when missing', () => {
    const input = { ...validAIResponse };
    delete input.siteConditions;
    const result = normalizeAIResponse(input);
    expect(result.siteConditions.accessDifficulty).toBe('normal');
    expect(result.siteConditions.foundationCondition).toBe('sound');
    expect(result.siteConditions.adjacentStructureRisk).toBe(false);
  });

  test('preserves existing siteConditions when present', () => {
    const input = {
      ...validAIResponse,
      siteConditions: {
        ...validAIResponse.siteConditions,
        accessDifficulty: 'difficult',
        accessNote: 'Steep hillside access',
      },
    };
    const result = normalizeAIResponse(input);
    expect(result.siteConditions.accessDifficulty).toBe('difficult');
    expect(result.siteConditions.accessNote).toBe('Steep hillside access');
  });

  test('sets aiQuantity on materials from quantity field', () => {
    const result = normalizeAIResponse(validAIResponse);
    expect(result.materials[0].aiQuantity).toBe('6 tonnes');
    expect(result.materials[1].aiQuantity).toBe('8 No.');
  });
});
