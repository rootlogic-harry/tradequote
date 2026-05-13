import { applyMeasurementPlausibilityBounds, boundsForItem } from '../utils/aiParser.js';

// The AI model self-grades measurement confidence but tends to be optimistic.
// This helper enforces a floor: when we know we can't trust the scale (no
// reference card, no user-provided scale reference, or implausible values)
// we downgrade confidence to "low" so the tradesman actually reviews the row.
describe('applyMeasurementPlausibilityBounds', () => {
  const base = {
    referenceCardDetected: true,
    measurements: [
      { item: 'Wall height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high' },
      { item: 'Breach length', valueMm: 4500, displayValue: '4,500mm', confidence: 'medium' },
    ],
  };

  it('returns a new object, does not mutate input', () => {
    const input = JSON.parse(JSON.stringify(base));
    const out = applyMeasurementPlausibilityBounds(input, { scaleReferences: '' });
    expect(out).not.toBe(input);
    expect(input.measurements[0].confidence).toBe('high');
  });

  it('keeps confidence as-is when reference card is detected and values are plausible', () => {
    const out = applyMeasurementPlausibilityBounds(base, { scaleReferences: '' });
    expect(out.measurements[0].confidence).toBe('high');
    expect(out.measurements[1].confidence).toBe('medium');
  });

  it('forces confidence to "low" when no reference card and no user scale references', () => {
    const noCard = { ...base, referenceCardDetected: false };
    const out = applyMeasurementPlausibilityBounds(noCard, { scaleReferences: '' });
    expect(out.measurements.every(m => m.confidence === 'low')).toBe(true);
  });

  it('keeps medium/high confidence when no card but user provided scale references', () => {
    const noCard = { ...base, referenceCardDetected: false };
    const out = applyMeasurementPlausibilityBounds(noCard, {
      scaleReferences: 'The gate on the left is 1.2m wide',
    });
    // User gave us a real scale anchor — respect Claude's per-measurement confidence
    expect(out.measurements[0].confidence).toBe('high');
    expect(out.measurements[1].confidence).toBe('medium');
  });

  it('forces a single implausibly large measurement to "low"', () => {
    const huge = {
      ...base,
      measurements: [
        { item: 'Wall height', valueMm: 150000, displayValue: '150,000mm', confidence: 'high' },
        { item: 'Breach length', valueMm: 4500, displayValue: '4,500mm', confidence: 'medium' },
      ],
    };
    const out = applyMeasurementPlausibilityBounds(huge, { scaleReferences: '' });
    expect(out.measurements[0].confidence).toBe('low');
    expect(out.measurements[1].confidence).toBe('medium');
  });

  it('forces a zero-or-missing measurement to "low"', () => {
    const zero = {
      ...base,
      measurements: [
        { item: 'Wall height', valueMm: 0, displayValue: '0mm', confidence: 'high' },
        { item: 'Breach length', valueMm: null, displayValue: null, confidence: 'high' },
      ],
    };
    const out = applyMeasurementPlausibilityBounds(zero, { scaleReferences: '' });
    expect(out.measurements[0].confidence).toBe('low');
    expect(out.measurements[1].confidence).toBe('low');
  });

  it('forces a suspiciously tiny measurement (<10mm) to "low"', () => {
    const tiny = {
      ...base,
      measurements: [
        { item: 'Wall height', valueMm: 5, displayValue: '5mm', confidence: 'high' },
      ],
    };
    const out = applyMeasurementPlausibilityBounds(tiny, { scaleReferences: '' });
    expect(out.measurements[0].confidence).toBe('low');
  });

  it('is null-safe when measurements array is missing', () => {
    expect(() => applyMeasurementPlausibilityBounds({ referenceCardDetected: true }, {}))
      .not.toThrow();
  });

  it('preserves aiValue immutability — only touches confidence', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: false,
        measurements: [
          { item: 'Wall height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high', aiValue: '1,200mm' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].aiValue).toBe('1,200mm');
    expect(out.measurements[0].displayValue).toBe('1,200mm');
    expect(out.measurements[0].confidence).toBe('low');
  });
});

// Per-item bounds — Paul's re-run produced a wall height of 19m (19000mm),
// which the global 100m ceiling passed straight through. Item-specific
// bounds (wall height 300–3500mm) now catch this regardless of scale anchor.
describe('boundsForItem', () => {
  test('wall height capped at 3500mm', () => {
    expect(boundsForItem('Wall height')).toEqual({ min: 300, max: 3500 });
    expect(boundsForItem('Height of wall')).toEqual({ min: 300, max: 3500 });
    expect(boundsForItem('wall height (overall)')).toEqual({ min: 300, max: 3500 });
  });

  test('wall thickness capped at 1500mm', () => {
    expect(boundsForItem('Wall thickness')).toEqual({ min: 200, max: 1500 });
    expect(boundsForItem('Wall base width')).toEqual({ min: 200, max: 1500 });
  });

  test('breach / gap / collapse share the same 50m ceiling', () => {
    expect(boundsForItem('Breach length')).toEqual({ min: 200, max: 50000 });
    expect(boundsForItem('Collapsed section')).toEqual({ min: 200, max: 50000 });
    expect(boundsForItem('Gap in wall')).toEqual({ min: 200, max: 50000 });
  });

  test('course depth tight to 50–400mm', () => {
    expect(boundsForItem('Course depth')).toEqual({ min: 50, max: 400 });
    expect(boundsForItem('Stone course')).toEqual({ min: 50, max: 400 });
  });

  test('cope / coping in the 80–400mm range', () => {
    expect(boundsForItem('Cope stones')).toEqual({ min: 80, max: 400 });
    expect(boundsForItem('Coping height')).toEqual({ min: 80, max: 400 });
  });

  test('through stones in the 200–1200mm range', () => {
    expect(boundsForItem('Through stone spacing')).toEqual({ min: 200, max: 1200 });
    expect(boundsForItem('Through-stone interval')).toEqual({ min: 200, max: 1200 });
  });

  test('falls back to the global 10–100000mm range for unknown items', () => {
    expect(boundsForItem('Foundation depth')).toEqual({ min: 10, max: 100000 });
    expect(boundsForItem('Some weird custom field')).toEqual({ min: 10, max: 100000 });
    expect(boundsForItem('')).toEqual({ min: 10, max: 100000 });
    expect(boundsForItem(null)).toEqual({ min: 10, max: 100000 });
    expect(boundsForItem(undefined)).toEqual({ min: 10, max: 100000 });
  });
});

describe('applyMeasurementPlausibilityBounds — per-item bounds', () => {
  // The 19m wall scenario Paul reported. Even with a scale anchor present,
  // a wall height of 19000mm must be forced to "low" — the model has clearly
  // misread the photo and the tradesman needs to verify on site before this
  // figure drives a £10k+ quote difference.
  test('forces low when wall height exceeds 3500mm even with a scale anchor', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Wall height', valueMm: 19000, displayValue: '19,000mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });

  test('forces low when wall thickness exceeds 1500mm', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Wall thickness', valueMm: 3000, displayValue: '3,000mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });

  test('forces low when course depth exceeds 400mm', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Course depth', valueMm: 600, displayValue: '600mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });

  test('preserves high confidence for wall height in the normal range', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Wall height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('high');
  });

  test('preserves high confidence for a 30m breach length (within breach bounds)', () => {
    // Breach can legitimately span tens of metres on an estate boundary.
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Breach length', valueMm: 30000, displayValue: '30,000mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('high');
  });

  test('forces low when breach length exceeds 50m (clearly a misread)', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'Breach length', valueMm: 75000, displayValue: '75,000mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });
});
