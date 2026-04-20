import { applyMeasurementPlausibilityBounds } from '../utils/aiParser.js';

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
