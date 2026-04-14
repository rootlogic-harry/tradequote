import { stripBlobs, buildSaveSnapshot, SAVE_ALLOWLIST } from '../utils/stripBlobs.js';

// --- stripBlobs ---

describe('stripBlobs', () => {
  test('strips base64 data URLs from known photo fields', () => {
    const input = {
      logo: 'data:image/png;base64,' + 'A'.repeat(20000),
      dataUrl: 'data:image/jpeg;base64,' + 'B'.repeat(15000),
      name: 'photo.jpg',
    };
    const result = stripBlobs(input);
    expect(result.logo).toBe('[photo-stripped]');
    expect(result.dataUrl).toBe('[photo-stripped]');
    expect(result.name).toBe('photo.jpg');
  });

  test('strips data URLs nested inside objects', () => {
    const input = {
      photos: {
        overview: { dataUrl: 'data:image/png;base64,' + 'A'.repeat(20000), name: 'wall.jpg' },
        closeup: null,
      },
    };
    const result = stripBlobs(input);
    expect(result.photos.overview.dataUrl).toBe('[photo-stripped]');
    expect(result.photos.overview.name).toBe('wall.jpg');
    expect(result.photos.closeup).toBeNull();
  });

  test('strips data URLs nested inside arrays', () => {
    const input = [
      { data: 'data:image/jpeg;base64,' + 'C'.repeat(12000) },
      { data: 'data:image/jpeg;base64,' + 'D'.repeat(12000) },
    ];
    const result = stripBlobs(input);
    expect(result[0].data).toBe('[photo-stripped]');
    expect(result[1].data).toBe('[photo-stripped]');
  });

  test('strips long data: strings even in unknown keys', () => {
    const longDataUrl = 'data:image/webp;base64,' + 'X'.repeat(15000);
    const input = { unknownField: longDataUrl };
    const result = stripBlobs(input);
    expect(result.unknownField).toBe('[photo-stripped]');
  });

  test('preserves non-blob string values', () => {
    const input = { name: 'John', address: '123 Main St', notes: 'data:short' };
    const result = stripBlobs(input);
    expect(result.name).toBe('John');
    expect(result.address).toBe('123 Main St');
    expect(result.notes).toBe('data:short');
  });

  test('preserves short data: strings under threshold', () => {
    const input = { icon: 'data:image/svg+xml,<svg></svg>' };
    const result = stripBlobs(input);
    expect(result.icon).toBe('data:image/svg+xml,<svg></svg>');
  });

  test('handles null and undefined gracefully', () => {
    expect(stripBlobs(null)).toBeNull();
    expect(stripBlobs(undefined)).toBeUndefined();
  });

  test('handles primitives', () => {
    expect(stripBlobs(42)).toBe(42);
    expect(stripBlobs(true)).toBe(true);
    expect(stripBlobs('hello')).toBe('hello');
  });

  test('strips known field names even if under 10000 chars', () => {
    // logo, dataUrl, data, src fields with data: prefix are always stripped
    const input = { logo: 'data:image/png;base64,short' };
    const result = stripBlobs(input);
    expect(result.logo).toBe('[photo-stripped]');
  });

  test('does not mutate original object', () => {
    const input = { logo: 'data:image/png;base64,' + 'A'.repeat(20000), name: 'test' };
    const copy = JSON.parse(JSON.stringify(input));
    stripBlobs(input);
    expect(input).toEqual(copy);
  });
});

// --- buildSaveSnapshot ---

describe('buildSaveSnapshot', () => {
  const mockState = {
    profile: { companyName: 'Test Co', logo: 'data:image/png;base64,' + 'A'.repeat(20000) },
    jobDetails: { clientName: 'Client', siteAddress: '123 Main St' },
    reviewData: { measurements: [{ id: '1', item: 'Wall height', value: '1200' }] },
    quotePayload: { totals: { total: 5000 } },
    quoteSequence: 5,
    quoteMode: 'standard',
    diffs: [{ fieldType: 'measurement', fieldLabel: 'Wall height', aiValue: '1000', confirmedValue: '1200' }],
    aiRawResponse: '{"big":"response"}'.repeat(1000),
    photos: { overview: { dataUrl: 'data:image/jpeg;base64,' + 'B'.repeat(20000) } },
    extraPhotos: [{ data: 'data:image/jpeg;base64,' + 'C'.repeat(15000) }],
    step: 5,
    isAnalysing: false,
  };

  test('excludes aiRawResponse from snapshot', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.aiRawResponse).toBeUndefined();
  });

  test('excludes photos and extraPhotos from snapshot', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.photos).toBeUndefined();
    expect(snapshot.extraPhotos).toBeUndefined();
  });

  test('excludes step and isAnalysing from snapshot', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.step).toBeUndefined();
    expect(snapshot.isAnalysing).toBeUndefined();
  });

  test('includes reviewData, quotePayload, jobDetails', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.reviewData).toBeDefined();
    expect(snapshot.quotePayload).toBeDefined();
    expect(snapshot.jobDetails).toBeDefined();
    expect(snapshot.jobDetails.clientName).toBe('Client');
  });

  test('includes diffs', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.diffs).toBeDefined();
    expect(snapshot.diffs.length).toBe(1);
    expect(snapshot.diffs[0].fieldType).toBe('measurement');
  });

  test('strips logo from profile', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(snapshot.profile.logo).toBe('[photo-stripped]');
    expect(snapshot.profile.companyName).toBe('Test Co');
  });

  test('returns valid JSON-serialisable object', () => {
    const snapshot = buildSaveSnapshot(mockState);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(snapshot));
    expect(parsed.profile.companyName).toBe('Test Co');
  });

  test('does not mutate original state', () => {
    const original = JSON.parse(JSON.stringify(mockState));
    buildSaveSnapshot(mockState);
    expect(mockState.aiRawResponse).toBe(original.aiRawResponse);
    expect(mockState.profile.logo).toBe(original.profile.logo);
  });

  test('handles missing optional fields', () => {
    const minState = { profile: {}, jobDetails: {} };
    const snapshot = buildSaveSnapshot(minState);
    expect(snapshot.profile).toEqual({});
    expect(snapshot.reviewData).toBeUndefined();
    expect(snapshot.diffs).toBeUndefined();
  });
});

// --- SAVE_ALLOWLIST ---

describe('SAVE_ALLOWLIST', () => {
  test('is exported and is an array of strings', () => {
    expect(Array.isArray(SAVE_ALLOWLIST)).toBe(true);
    SAVE_ALLOWLIST.forEach(key => expect(typeof key).toBe('string'));
  });

  test('contains required keys', () => {
    const required = ['profile', 'jobDetails', 'reviewData', 'quotePayload', 'quoteSequence', 'quoteMode', 'diffs'];
    for (const key of required) {
      expect(SAVE_ALLOWLIST).toContain(key);
    }
  });

  test('does NOT contain excluded keys', () => {
    const banned = ['aiRawResponse', 'photos', 'extraPhotos', 'step', 'isAnalysing'];
    for (const key of banned) {
      expect(SAVE_ALLOWLIST).not.toContain(key);
    }
  });
});

// --- buildSaveSnapshot with allowlist ---

describe('buildSaveSnapshot with allowlist', () => {
  const fullState = {
    profile: { companyName: 'Test Co' },
    jobDetails: { clientName: 'Client' },
    reviewData: { measurements: [] },
    quotePayload: { totals: {} },
    quoteSequence: 5,
    quoteMode: 'standard',
    diffs: [],
    // These should be excluded:
    aiRawResponse: 'big response',
    photos: { overview: null },
    extraPhotos: [],
    step: 5,
    isAnalysing: false,
    unknownFutureKey: 'should be excluded',
  };

  test('only includes keys from SAVE_ALLOWLIST', () => {
    const snapshot = buildSaveSnapshot(fullState);
    const keys = Object.keys(snapshot);
    for (const key of keys) {
      expect(SAVE_ALLOWLIST).toContain(key);
    }
  });

  test('unknown keys added to state are excluded', () => {
    const snapshot = buildSaveSnapshot(fullState);
    expect(snapshot.unknownFutureKey).toBeUndefined();
    expect(snapshot.aiRawResponse).toBeUndefined();
  });

  test('deep-clones values (mutating original does not affect snapshot)', () => {
    const state = {
      profile: { companyName: 'Original' },
      jobDetails: { clientName: 'Client' },
      reviewData: { measurements: [{ id: '1', value: '100' }] },
      quotePayload: null,
      quoteSequence: 1,
      quoteMode: 'standard',
      diffs: [],
    };
    const snapshot = buildSaveSnapshot(state);
    state.reviewData.measurements[0].value = '999';
    expect(snapshot.reviewData.measurements[0].value).toBe('100');
  });

  test('payload size under 200KB for realistic quote', () => {
    const realisticState = {
      profile: { companyName: 'Stone & Walling Ltd', fullName: 'Mark Doyle', phone: '01onal234', email: 'mark@stone.com', address: '123 Main St, Yorkshire', dayRate: 400 },
      jobDetails: { clientName: 'John Smith', siteAddress: '45 Manor Road, Leeds', quoteReference: 'QT-2026-0042', quoteDate: '2026-03-15', briefNotes: 'Collapsed section near gate' },
      reviewData: {
        measurements: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, item: `Measurement ${i}`, value: `${1000 + i * 100}`, aiValue: `${1000 + i * 100}`, confirmed: true })),
        materials: Array.from({ length: 8 }, (_, i) => ({ id: `mat${i}`, description: `Material ${i}`, quantity: i + 1, unit: 'm²', unitCost: 100 + i * 50, totalCost: (i + 1) * (100 + i * 50) })),
        labourEstimate: { estimatedDays: 5, numberOfWorkers: 2, dayRate: 400 },
        scheduleOfWorks: Array.from({ length: 8 }, (_, i) => ({ stepNumber: i + 1, title: `Step ${i + 1}`, description: `Description for step ${i + 1} of the works.` })),
        damageDescription: 'Collapsed section approximately 4m long, 1.2m high. Gritstone construction with lime mortar joints.',
      },
      quotePayload: { totals: { materialsSubtotal: 5000, labourTotal: 4000, additionalCostsTotal: 500, subtotal: 9500, vatAmount: 1900, total: 11400 } },
      quoteSequence: 42,
      quoteMode: 'standard',
      diffs: Array.from({ length: 10 }, (_, i) => ({ fieldType: 'measurement', fieldLabel: `Measurement ${i}`, aiValue: `${1000 + i * 100}`, confirmedValue: `${1000 + i * 100}`, wasEdited: false, editMagnitude: 0 })),
    };
    const snapshot = buildSaveSnapshot(realisticState);
    const size = new Blob([JSON.stringify(snapshot)]).size;
    expect(size).toBeLessThan(200 * 1024);
  });
});

// --- Save error state (reducer) ---

describe('Save error state', () => {
  // Mock sessionStorage for reducer
  const storage = {};
  const origSS = globalThis.sessionStorage;
  beforeAll(() => {
    globalThis.sessionStorage = {
      getItem: (key) => storage[key] || null,
      setItem: (key, value) => { storage[key] = value; },
      removeItem: (key) => { delete storage[key]; },
    };
  });
  afterAll(() => {
    globalThis.sessionStorage = origSS;
  });

  let reducer, initialState;
  beforeAll(async () => {
    const mod = await import('../reducer.js');
    reducer = mod.reducer;
    initialState = mod.initialState;
  });

  test('reducer sets quoteSaveError on QUOTE_SAVE_FAILED action', () => {
    const state = { ...initialState };
    const newState = reducer(state, { type: 'QUOTE_SAVE_FAILED', error: 'Network error' });
    expect(newState.quoteSaveError).toBe('Network error');
  });

  test('reducer clears quoteSaveError on QUOTE_SAVED action', () => {
    const state = { ...initialState, quoteSaveError: 'Previous error' };
    const newState = reducer(state, { type: 'QUOTE_SAVED', jobId: 'job-123' });
    expect(newState.quoteSaveError).toBeNull();
  });
});
