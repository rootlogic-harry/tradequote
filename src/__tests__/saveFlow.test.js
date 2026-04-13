import { stripBlobs, buildSaveSnapshot } from '../utils/stripBlobs.js';

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
