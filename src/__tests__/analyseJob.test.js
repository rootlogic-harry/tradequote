import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { runAnalysis } from '../utils/analyseJob.js';

// ---- helpers ----

function makePhotos(slotKeys = ['overview']) {
  const photos = {};
  for (const key of slotKeys) {
    photos[key] = { data: `data:image/jpeg;base64,FAKE_${key}` };
  }
  return photos;
}

const VALID_AI_JSON = {
  referenceCardDetected: true,
  referenceCardNote: 'Detected in overview',
  stoneType: 'gritstone',
  damageDescription: '1 — Wall section\nCollapsed 3m section.',
  measurements: [{ item: 'Height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high', note: null }],
  scheduleOfWorks: [{ stepNumber: 1, title: 'Clear site', description: 'Clear debris over 6m²' }],
  materials: [{ description: 'Replacement stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 }],
  labourEstimate: { description: 'Rebuild', estimatedDays: 3, numberOfWorkers: 2, calculationBasis: '6 sqm / 3 sqm/day = 2 days' },
  siteConditions: { accessDifficulty: 'normal', accessNote: null, foundationCondition: 'sound', foundationNote: null, adjacentStructureRisk: false, adjacentStructureNote: null },
  additionalNotes: 'None',
};

function mockFetchOk(responseBody) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => responseBody,
  });
}

function mockFetchError(status, body) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
  });
}

function trackDispatch() {
  const calls = [];
  return {
    fn: (action) => calls.push(action),
    calls,
  };
}

// ---- setup ----

let origFetch;

beforeEach(() => {
  origFetch = globalThis.fetch;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = origFetch;
});

const baseArgs = () => ({
  photos: makePhotos(['overview', 'closeup']),
  extraPhotos: [],
  jobDetails: { siteAddress: '10 Main St', briefNotes: 'Collapsed section', quoteReference: 'QT-001', quoteDate: '2026-04-01' },
  profile: { dayRate: 400 },
  abortRef: { current: null },
  userId: 'mark',
});

// ---- tests ----

describe('runAnalysis', () => {
  test('builds correct image content from photos', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const content = body.messages[0].content;

    // Should have text label + image for overview, then closeup, then site address text
    expect(content[0]).toEqual({ type: 'text', text: '--- Photo: Overview ---' });
    expect(content[1].type).toBe('image');
    expect(content[1].source.data).toBe('FAKE_overview');
    expect(content[2]).toEqual({ type: 'text', text: '--- Photo: Close-up ---' });
    expect(content[3].type).toBe('image');
    expect(content[3].source.data).toBe('FAKE_closeup');
  });

  test('uses /api/users/:id/analyse when userId provided', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/users/mark/analyse');
  });

  test('falls back to /api/anthropic/messages when no userId', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
    });

    const args = baseArgs();
    args.userId = undefined;
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/anthropic/messages');
  });

  test('dispatches ANALYSIS_SUCCESS with normalised data', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
      critiqueNotes: 'Some notes',
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    const action = dispatched.calls[0];
    expect(action.type).toBe('ANALYSIS_SUCCESS');
    expect(action.rawResponse).toBe(JSON.stringify(VALID_AI_JSON));
    expect(action.normalised.stoneType).toBe('gritstone');
    expect(action.normalised.referenceCardDetected).toBe(true);
    expect(action.normalised.labourEstimate.dayRate).toBe(400);
    expect(action.critiqueNotes).toBe('Some notes');
  });

  test('dispatches ANALYSIS_ERROR on 529 (overloaded)', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchError(529, { error: { type: 'overloaded_error', message: 'Overloaded' } });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    expect(dispatched.calls[0].type).toBe('ANALYSIS_ERROR');
    expect(dispatched.calls[0].error).toContain('overloaded');
  });

  test('dispatches ANALYSIS_ERROR on 429 (rate limited)', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchError(429, { error: { type: 'rate_limit_error', message: 'Rate limited' } });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    expect(dispatched.calls[0].type).toBe('ANALYSIS_ERROR');
    expect(dispatched.calls[0].error).toContain('Rate limit');
  });

  test('dispatches ANALYSIS_ERROR on timeout (AbortError)', async () => {
    const dispatched = trackDispatch();
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    globalThis.fetch = jest.fn().mockRejectedValue(abortError);

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    expect(dispatched.calls[0].type).toBe('ANALYSIS_ERROR');
    expect(dispatched.calls[0].error).toContain('timed out');
  });

  test('dispatches ANALYSIS_ERROR on network failure (TypeError)', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    expect(dispatched.calls[0].type).toBe('ANALYSIS_ERROR');
    expect(dispatched.calls[0].error).toContain('Network error');
  });

  test('handles malformed JSON response', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: 'not valid json {{{' }],
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls).toHaveLength(1);
    expect(dispatched.calls[0].type).toBe('ANALYSIS_ERROR');
    expect(dispatched.calls[0].error).toContain('unreadable');
  });

  test('passes critiqueNotes through from response', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
      critiqueNotes: 'Check tonnage calculation',
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    expect(dispatched.calls[0].critiqueNotes).toBe('Check tonnage calculation');
  });

  test('includes site address and brief notes in user content', async () => {
    const dispatched = trackDispatch();
    globalThis.fetch = mockFetchOk({
      content: [{ text: JSON.stringify(VALID_AI_JSON) }],
    });

    const args = baseArgs();
    args.dispatch = dispatched.fn;
    await runAnalysis(args);

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    const content = body.messages[0].content;
    const lastText = content[content.length - 1];
    expect(lastText.text).toContain('10 Main St');
    expect(lastText.text).toContain('Collapsed section');
  });
});
