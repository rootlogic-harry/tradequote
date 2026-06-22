import {
  fieldWeightedAccuracy,
  quoteWeightedAccuracy,
  summariseWeightedAccuracy,
} from '../utils/weightedAccuracy.js';

// ---------------------------------------------------------------------------
// fieldWeightedAccuracy — per-field scoring
// ---------------------------------------------------------------------------

describe('fieldWeightedAccuracy — happy path', () => {
  test('unedited field scores 1.0', () => {
    expect(fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '100' })).toBe(1);
  });

  test('5% edit scores 0.95', () => {
    // ai=100, confirmed=105 -> delta=0.05 -> 1-0.05 = 0.95
    const score = fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '105' });
    expect(score).toBeCloseTo(0.95, 10);
  });

  test('50% edit scores 0.5', () => {
    const score = fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '150' });
    expect(score).toBeCloseTo(0.5, 10);
  });

  test('200% edit (capped) scores 0.0 — does not go negative', () => {
    // ai=100, confirmed=300 -> rawDelta=2.0 -> capped to 1.0 -> score 0
    const score = fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '300' });
    expect(score).toBe(0);
  });

  test('symmetric: negative delta scores the same as positive', () => {
    // ai=100, confirmed=50  -> delta=0.5
    // ai=100, confirmed=150 -> delta=0.5
    const a = fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '50' });
    const b = fieldWeightedAccuracy({ aiValue: '100', confirmedValue: '150' });
    expect(a).toBeCloseTo(b, 10);
  });

  test('extreme outlier capped at 0.0 (not -Inf)', () => {
    const score = fieldWeightedAccuracy({ aiValue: '10', confirmedValue: '10000' });
    expect(score).toBe(0);
  });
});

describe('fieldWeightedAccuracy — boundary conditions', () => {
  test('aiValue=0 with small confirmed (denominator clamp to 1)', () => {
    // ai=0, confirmed=0.3 -> denom=max(0,1)=1 -> delta=0.3 -> score 0.7
    const score = fieldWeightedAccuracy({ aiValue: '0', confirmedValue: '0.3' });
    expect(score).toBeCloseTo(0.7, 10);
  });

  test('aiValue=0 with large confirmed (capped)', () => {
    const score = fieldWeightedAccuracy({ aiValue: '0', confirmedValue: '100' });
    expect(score).toBe(0);
  });

  test('aiValue=0 with confirmed=0 scores 1.0', () => {
    const score = fieldWeightedAccuracy({ aiValue: '0', confirmedValue: '0' });
    expect(score).toBe(1);
  });

  test('negative aiValue uses absolute denominator', () => {
    // ai=-100, confirmed=-105 -> delta=|−105−(−100)|/100=0.05 -> 0.95
    const score = fieldWeightedAccuracy({ aiValue: '-100', confirmedValue: '-105' });
    expect(score).toBeCloseTo(0.95, 10);
  });
});

describe('fieldWeightedAccuracy — skip / null behaviour', () => {
  test('null aiValue returns null (skipped, not penalised)', () => {
    expect(fieldWeightedAccuracy({ aiValue: null, confirmedValue: '100' })).toBe(null);
  });

  test('undefined aiValue returns null', () => {
    expect(fieldWeightedAccuracy({ aiValue: undefined, confirmedValue: '100' })).toBe(null);
  });

  test('missing aiValue key returns null', () => {
    expect(fieldWeightedAccuracy({ confirmedValue: '100' })).toBe(null);
  });

  test('non-numeric aiValue ("TBC") returns null', () => {
    expect(fieldWeightedAccuracy({ aiValue: 'TBC', confirmedValue: '100' })).toBe(null);
  });

  test('empty-string aiValue returns null', () => {
    expect(fieldWeightedAccuracy({ aiValue: '', confirmedValue: '100' })).toBe(null);
  });

  test('null confirmedValue returns null (rare; "see notes")', () => {
    expect(fieldWeightedAccuracy({ aiValue: '100', confirmedValue: null })).toBe(null);
  });

  test('null input itself returns null', () => {
    expect(fieldWeightedAccuracy(null)).toBe(null);
  });

  test('non-object input returns null', () => {
    expect(fieldWeightedAccuracy('not a diff')).toBe(null);
    expect(fieldWeightedAccuracy(42)).toBe(null);
  });
});

describe('fieldWeightedAccuracy — formatted strings via parseAiValue', () => {
  test('string "2,000mm" parsed correctly', () => {
    // ai=2000, confirmed=2100 -> delta=0.05 -> 0.95
    const score = fieldWeightedAccuracy({ aiValue: '2,000mm', confirmedValue: '2,100mm' });
    expect(score).toBeCloseTo(0.95, 10);
  });

  test('string "£415" with currency symbol parsed', () => {
    // ai=415, confirmed=125 -> delta=(415-125)/415=0.6988 -> score 0.3012
    const score = fieldWeightedAccuracy({ aiValue: '£415', confirmedValue: '£125' });
    expect(score).toBeCloseTo(1 - 290 / 415, 10);
  });

  test('mixed string + numeric input', () => {
    // ai="3.5t" -> 3.5; confirmed=4 -> delta=0.5/3.5
    const score = fieldWeightedAccuracy({ aiValue: '3.5t', confirmedValue: '4' });
    expect(score).toBeCloseTo(1 - 0.5 / 3.5, 10);
  });

  test('numeric (not string) inputs work too', () => {
    const score = fieldWeightedAccuracy({ aiValue: 100, confirmedValue: 105 });
    expect(score).toBeCloseTo(0.95, 10);
  });
});

// ---------------------------------------------------------------------------
// quoteWeightedAccuracy — per-quote aggregation
// ---------------------------------------------------------------------------

describe('quoteWeightedAccuracy', () => {
  test('mean of multiple scoreable diffs', () => {
    const diffs = [
      { aiValue: '100', confirmedValue: '100' }, // 1.0
      { aiValue: '100', confirmedValue: '150' }, // 0.5
      { aiValue: '100', confirmedValue: '105' }, // 0.95
    ];
    // mean = (1.0 + 0.5 + 0.95) / 3 = 0.8166...
    expect(quoteWeightedAccuracy(diffs)).toBeCloseTo(2.45 / 3, 10);
  });

  test('null diffs (un-scoreable) are skipped, not averaged-in as zero', () => {
    const diffs = [
      { aiValue: '100', confirmedValue: '100' }, // 1.0
      { aiValue: null, confirmedValue: '100' },  // skipped
      { aiValue: 'TBC', confirmedValue: '100' }, // skipped
      { aiValue: '100', confirmedValue: '150' }, // 0.5
    ];
    // mean of scoreable = (1.0 + 0.5) / 2 = 0.75
    expect(quoteWeightedAccuracy(diffs)).toBeCloseTo(0.75, 10);
  });

  test('empty diffs array returns null (NOT 0 — meaningfully different)', () => {
    expect(quoteWeightedAccuracy([])).toBe(null);
  });

  test('all-unscoreable diffs return null', () => {
    const diffs = [
      { aiValue: null, confirmedValue: '100' },
      { aiValue: 'TBC', confirmedValue: '100' },
    ];
    expect(quoteWeightedAccuracy(diffs)).toBe(null);
  });

  test('non-array input returns null', () => {
    expect(quoteWeightedAccuracy(null)).toBe(null);
    expect(quoteWeightedAccuracy(undefined)).toBe(null);
    expect(quoteWeightedAccuracy('not an array')).toBe(null);
  });

  test('single perfect diff returns 1.0', () => {
    expect(quoteWeightedAccuracy([{ aiValue: '50', confirmedValue: '50' }])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// summariseWeightedAccuracy — across-quotes distribution
// ---------------------------------------------------------------------------

describe('summariseWeightedAccuracy', () => {
  test('empty quote list returns count=0 and null stats', () => {
    const r = summariseWeightedAccuracy([]);
    expect(r).toEqual({ count: 0, mean: null, p50: null, p90: null });
  });

  test('non-array input returns count=0 and null stats', () => {
    expect(summariseWeightedAccuracy(null)).toEqual({ count: 0, mean: null, p50: null, p90: null });
  });

  test('all-empty quotes return count=0 and null stats', () => {
    const r = summariseWeightedAccuracy([[], [], []]);
    expect(r).toEqual({ count: 0, mean: null, p50: null, p90: null });
  });

  test('mean / p50 / p90 stats correct on a known distribution', () => {
    // Build 10 quotes with per-quote scores: 0.1, 0.2, ..., 1.0
    const quotes = [];
    for (let i = 1; i <= 10; i++) {
      // ai=100, confirmed chosen so quote-score = i/10
      // single-diff quote -> score = 1 - delta = i/10, so delta = 1 - i/10
      // confirmed = ai * (1 - delta) ... actually we want |delta|, so
      // confirmed = ai + ai * (1 - i/10). Easier: hand-craft per quote.
      const target = i / 10;
      // delta = 1 - target -> confirmed = 100 + 100*(1-target)
      const confirmed = 100 + 100 * (1 - target);
      quotes.push([{ aiValue: '100', confirmedValue: String(confirmed) }]);
    }

    const r = summariseWeightedAccuracy(quotes);
    expect(r.count).toBe(10);
    // mean of [0.1..1.0] = 0.55
    expect(r.mean).toBeCloseTo(0.55, 10);
    // p50 of sorted [0.1..1.0] linear-interpolated = (0.5 + 0.6)/2 = 0.55
    expect(r.p50).toBeCloseTo(0.55, 10);
    // p90 of sorted [0.1..1.0] linear-interpolated at idx=8.1 -> 0.9 + 0.1*0.1 = 0.91
    expect(r.p90).toBeCloseTo(0.91, 10);
  });

  test('single-quote distribution: mean=p50=p90', () => {
    const quotes = [[{ aiValue: '100', confirmedValue: '120' }]]; // 0.8
    const r = summariseWeightedAccuracy(quotes);
    expect(r.count).toBe(1);
    expect(r.mean).toBeCloseTo(0.8, 10);
    expect(r.p50).toBeCloseTo(0.8, 10);
    expect(r.p90).toBeCloseTo(0.8, 10);
  });

  test('mix of scoreable + unscoreable quotes: count reflects only scoreable', () => {
    const quotes = [
      [{ aiValue: '100', confirmedValue: '100' }],            // 1.0
      [{ aiValue: null, confirmedValue: '100' }],             // unscoreable -> null
      [{ aiValue: '100', confirmedValue: '50' }],             // 0.5
    ];
    const r = summariseWeightedAccuracy(quotes);
    expect(r.count).toBe(2);
    expect(r.mean).toBeCloseTo(0.75, 10);
  });

  test('does not mutate input arrays', () => {
    const q1 = [{ aiValue: '100', confirmedValue: '50' }];
    const q2 = [{ aiValue: '100', confirmedValue: '100' }];
    const quotes = [q1, q2];
    const before = JSON.stringify(quotes);
    summariseWeightedAccuracy(quotes);
    expect(JSON.stringify(quotes)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: comparability with edit-presence metric
// ---------------------------------------------------------------------------

describe('weighted vs edit-presence comparability', () => {
  test('all unedited -> both metrics agree at 1.0', () => {
    const diffs = [
      { aiValue: '100', confirmedValue: '100' },
      { aiValue: '50', confirmedValue: '50' },
      { aiValue: '2000', confirmedValue: '2000' },
    ];
    expect(quoteWeightedAccuracy(diffs)).toBe(1);
    // Edit-presence would also be 1.0 here (zero edits).
  });

  test('all >100% edits -> both metrics agree at 0.0', () => {
    const diffs = [
      { aiValue: '100', confirmedValue: '500' },
      { aiValue: '50', confirmedValue: '1000' },
    ];
    expect(quoteWeightedAccuracy(diffs)).toBe(0);
    // Edit-presence would also be 0 (all edited).
  });

  test('small edits (5%) differentiate the metrics — weighted is forgiving', () => {
    const diffs = [
      { aiValue: '100', confirmedValue: '105' }, // 5% edit
      { aiValue: '100', confirmedValue: '105' },
      { aiValue: '100', confirmedValue: '105' },
    ];
    // Weighted: 0.95
    expect(quoteWeightedAccuracy(diffs)).toBeCloseTo(0.95, 10);
    // Edit-presence would score this as 0.0 (every field "edited").
    // This is exactly the trajectory the new metric is meant to reveal.
  });
});
