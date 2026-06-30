/**
 * Behavioural reducer tests — backfill (2026-06-30).
 *
 * Context: the SET_VIEW_MODE bug (Harry, 2026-06-30) shipped because
 * the reducer's guard was hardcoded to ['active', 'archive'] and the
 * 'completed' tab dispatch was silently swallowed. The bug existed
 * for FOUR DAYS (since Mark's 2026-06-26 three-tab split) and didn't
 * trigger CI because zero tests covered SET_VIEW_MODE at all.
 *
 * Lesson: source-level shape tests don't catch behavioural regressions
 * in pure-function reducers. For every state transition the reducer
 * handles, there must be at least one test that:
 *   1. Constructs a representative state
 *   2. Dispatches the action
 *   3. Asserts the resulting state shape
 *
 * This file backfills the three reducer cases that had ZERO test
 * references in src/__tests__/ as of 2026-06-30, plus extends the
 * 'completed' SET_VIEW_MODE assertion in savedQuotesViewMode.test.js
 * with cross-state-transition checks.
 *
 * The companion coverage gate at reducerCoverageGate.test.js ensures
 * future reducer cases can't ship without at least one matching test.
 */
import { reducer, initialState } from '../reducer.js';

describe('ANALYSIS_QUOTA_EXHAUSTED', () => {
  test('sets quotaLockout from action payload + stops the analyse spinner', () => {
    const state = {
      ...initialState,
      isAnalysing: true,
      analysisError: 'previous error',
      videoProgress: { stage: 'analysing', progress: 50, message: 'x' },
      uploadProgress: { percent: 80 },
    };
    const result = reducer(state, {
      type: 'ANALYSIS_QUOTA_EXHAUSTED',
      message: "You've used your 3 free quotes. Subscribe to continue.",
      freeQuotesUsed: 3,
      freeQuotesLimit: 3,
    });
    expect(result.quotaLockout).toEqual({
      message: "You've used your 3 free quotes. Subscribe to continue.",
      freeQuotesUsed: 3,
      freeQuotesLimit: 3,
    });
    expect(result.isAnalysing).toBe(false);
    expect(result.analysisError).toBeNull();
    expect(result.videoProgress).toBeNull();
    expect(result.uploadProgress).toBeNull();
  });

  test('does NOT touch quote data when 402 fires (no half-saved analysis)', () => {
    const state = {
      ...initialState,
      reviewData: { measurements: [{ id: 'm1', value: '1200' }] },
      quotePayload: { totals: { total: 5000 } },
      diffs: [{ fieldType: 'measurement' }],
    };
    const result = reducer(state, { type: 'ANALYSIS_QUOTA_EXHAUSTED' });
    expect(result.reviewData).toEqual(state.reviewData);
    expect(result.quotePayload).toEqual(state.quotePayload);
    expect(result.diffs).toEqual(state.diffs);
  });
});

describe('CLEAR_QUOTA_LOCKOUT', () => {
  test('nulls quotaLockout', () => {
    const state = {
      ...initialState,
      quotaLockout: { message: 'x', freeQuotesUsed: 3, freeQuotesLimit: 3 },
    };
    const result = reducer(state, { type: 'CLEAR_QUOTA_LOCKOUT' });
    expect(result.quotaLockout).toBeNull();
  });

  test('is a no-op when there is no lockout to clear', () => {
    const state = { ...initialState, quotaLockout: null };
    const result = reducer(state, { type: 'CLEAR_QUOTA_LOCKOUT' });
    expect(result.quotaLockout).toBeNull();
    // Other state is preserved.
    expect(result.step).toBe(state.step);
    expect(result.profile).toBe(state.profile);
  });
});

describe('UPLOAD_PROGRESS', () => {
  test('records the upload progress payload verbatim', () => {
    const payload = { percent: 42, loaded: 1024, total: 2048, speed: 512, eta: 4 };
    const result = reducer(initialState, { type: 'UPLOAD_PROGRESS', payload });
    expect(result.uploadProgress).toEqual(payload);
  });

  test('null payload clears the upload progress', () => {
    const state = { ...initialState, uploadProgress: { percent: 50 } };
    const result = reducer(state, { type: 'UPLOAD_PROGRESS', payload: null });
    expect(result.uploadProgress).toBeNull();
  });

  test('does not touch other transient fields (videoProgress, isAnalysing)', () => {
    const state = {
      ...initialState,
      videoProgress: { stage: 'analysing', progress: 50, message: 'x' },
      isAnalysing: true,
    };
    const result = reducer(state, { type: 'UPLOAD_PROGRESS', payload: { percent: 99 } });
    expect(result.videoProgress).toEqual(state.videoProgress);
    expect(result.isAnalysing).toBe(true);
  });
});

describe('VIDEO_PROGRESS', () => {
  test('records the video progress payload verbatim', () => {
    const payload = { stage: 'analysing', progress: 50, message: 'Analysing footage...' };
    const result = reducer(initialState, { type: 'VIDEO_PROGRESS', payload });
    expect(result.videoProgress).toEqual(payload);
  });

  test('handles each documented stage (matches AIAnalysis.jsx VIDEO_LOADING_STAGES)', () => {
    const stages = ['processing', 'analysing', 'reviewing', 'complete'];
    for (const stage of stages) {
      const result = reducer(initialState, {
        type: 'VIDEO_PROGRESS',
        payload: { stage, progress: 50, message: stage },
      });
      expect(result.videoProgress.stage).toBe(stage);
    }
  });

  test('null payload clears the video progress', () => {
    const state = { ...initialState, videoProgress: { stage: 'analysing', progress: 50 } };
    const result = reducer(state, { type: 'VIDEO_PROGRESS', payload: null });
    expect(result.videoProgress).toBeNull();
  });

  test('does not touch uploadProgress', () => {
    const state = { ...initialState, uploadProgress: { percent: 80 } };
    const result = reducer(state, {
      type: 'VIDEO_PROGRESS',
      payload: { stage: 'reviewing', progress: 75 },
    });
    expect(result.uploadProgress).toEqual({ percent: 80 });
  });
});
