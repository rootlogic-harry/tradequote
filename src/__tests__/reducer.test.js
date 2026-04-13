// Mock sessionStorage before importing reducer
const storage = {};
globalThis.sessionStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = value; },
  removeItem: (key) => { delete storage[key]; },
};

import { reducer, initialState } from '../reducer.js';

describe('reducer', () => {
  function reduce(state, action) {
    return reducer(state || { ...initialState }, action);
  }

  describe('RESTORE_DRAFT', () => {
    test('restores job data from draft', () => {
      const state = {
        ...initialState,
        currentUserId: 'mark',
        profile: { companyName: 'DB Company', fullName: 'Mark', phone: '123', email: 'a@b.c', address: '1 St', dayRate: 400 },
      };
      const draft = {
        step: 4,
        jobDetails: { clientName: 'Client A', siteAddress: '10 Main St', quoteReference: 'QT-2026-0005', quoteDate: '2026-03-20' },
        reviewData: { measurements: [] },
        diffs: [],
        profile: { companyName: 'Old Stale Company', fullName: 'Old Mark' },
      };

      const result = reducer(state, { type: 'RESTORE_DRAFT', draft });

      // Job data restored
      expect(result.step).toBe(4);
      expect(result.jobDetails.clientName).toBe('Client A');

      // Profile NOT overwritten by draft — DB profile preserved
      expect(result.profile.companyName).toBe('DB Company');
      expect(result.profile.fullName).toBe('Mark');
    });

    test('defaults quoteMode to standard when draft has no quoteMode', () => {
      const state = { ...initialState, currentUserId: 'mark' };
      const draft = { step: 3 };

      const result = reducer(state, { type: 'RESTORE_DRAFT', draft });

      expect(result.quoteMode).toBe('standard');
    });

    test('preserves quoteMode from draft when present', () => {
      const state = { ...initialState, currentUserId: 'mark' };
      const draft = { step: 3, quoteMode: 'quick' };

      const result = reducer(state, { type: 'RESTORE_DRAFT', draft });

      expect(result.quoteMode).toBe('quick');
    });

    test('clears transient analysis state', () => {
      const state = { ...initialState, currentUserId: 'mark' };
      const draft = { step: 3, isAnalysing: true, analysisError: 'old error', quotePayload: { fake: true } };

      const result = reducer(state, { type: 'RESTORE_DRAFT', draft });

      expect(result.isAnalysing).toBe(false);
      expect(result.analysisError).toBeNull();
      expect(result.quotePayload).toBeNull();
    });
  });

  describe('SELECT_USER', () => {
    test('sets user and profile from action', () => {
      const state = { ...initialState };
      const profile = { companyName: 'Test Co', fullName: 'Mark', phone: '123', email: 'a@b.c', address: '1 St', dayRate: 400 };

      const result = reducer(state, {
        type: 'SELECT_USER',
        userId: 'mark',
        name: 'Mark',
        profile,
        quoteSequence: 5,
      });

      expect(result.currentUserId).toBe('mark');
      expect(result.currentUser).toEqual({ id: 'mark', name: 'Mark' });
      expect(result.profile.companyName).toBe('Test Co');
      expect(result.quoteSequence).toBe(5);
    });
  });

  describe('SWITCH_USER', () => {
    test('resets state but applies new profile', () => {
      const state = {
        ...initialState,
        currentUserId: 'old-user',
        step: 4,
        reviewData: { measurements: [{ id: '1' }] },
      };
      const profile = { companyName: 'New Co', fullName: 'Paul' };

      const result = reducer(state, {
        type: 'SWITCH_USER',
        userId: 'paul',
        name: 'Paul',
        profile,
      });

      // State reset to initial
      expect(result.step).toBe(1);
      expect(result.reviewData).toBeNull();

      // New user applied
      expect(result.currentUserId).toBe('paul');
      expect(result.profile.companyName).toBe('New Co');
    });
  });

  describe('UPDATE_PROFILE', () => {
    test('merges partial profile updates', () => {
      const state = {
        ...initialState,
        profile: { ...initialState.profile, companyName: 'Old', fullName: 'Mark' },
      };

      const result = reducer(state, {
        type: 'UPDATE_PROFILE',
        updates: { companyName: 'New Company' },
      });

      expect(result.profile.companyName).toBe('New Company');
      expect(result.profile.fullName).toBe('Mark'); // unchanged
    });

    test('showNotesOnQuote defaults to true in initial state', () => {
      expect(initialState.profile.showNotesOnQuote).toBe(true);
    });

    test('can toggle showNotesOnQuote off', () => {
      const state = { ...initialState };

      const result = reducer(state, {
        type: 'UPDATE_PROFILE',
        updates: { showNotesOnQuote: false },
      });

      expect(result.profile.showNotesOnQuote).toBe(false);
    });
  });

  describe('SET_STEP (backward navigation)', () => {
    test('allows going back from step 4 to step 2, preserving reviewData', () => {
      const state = {
        ...initialState,
        step: 4,
        reviewData: { measurements: [{ id: '1', value: '1000', confirmed: true }] },
        jobDetails: { clientName: 'Client', siteAddress: '10 Main St', quoteReference: 'QT-2026-0001', quoteDate: '2026-03-20' },
      };

      const result = reducer(state, { type: 'SET_STEP', step: 2 });

      expect(result.step).toBe(2);
      expect(result.reviewData.measurements).toHaveLength(1);
      expect(result.jobDetails.clientName).toBe('Client');
    });

    test('allows going back from step 5 to step 2, preserving all data', () => {
      const state = {
        ...initialState,
        step: 5,
        quotePayload: { fake: true },
        reviewData: { measurements: [] },
        jobDetails: { clientName: 'Client', siteAddress: '10 Main St', quoteReference: 'QT-2026-0001', quoteDate: '2026-03-20' },
      };

      const result = reducer(state, { type: 'SET_STEP', step: 2 });

      expect(result.step).toBe(2);
      expect(result.reviewData).not.toBeNull();
    });
  });

  describe('RESTORE_PHOTOS', () => {
    test('merges photos into state', () => {
      const state = {
        ...initialState,
        currentUserId: 'mark',
        photos: { overview: null, closeup: null, sideProfile: null, referenceCard: null, access: null },
        extraPhotos: [],
      };

      const result = reducer(state, {
        type: 'RESTORE_PHOTOS',
        photos: { overview: { data: 'data:img1', name: 'ov.jpg' }, closeup: { data: 'data:img2', name: 'cu.jpg' } },
        extraPhotos: [{ data: 'data:img3', name: 'ex.jpg', label: 'Other' }],
      });

      expect(result.photos.overview.data).toBe('data:img1');
      expect(result.photos.closeup.data).toBe('data:img2');
      expect(result.extraPhotos).toHaveLength(1);
      expect(result.extraPhotos[0].data).toBe('data:img3');
    });

    test('preserves existing photos when action has null/undefined', () => {
      const state = {
        ...initialState,
        currentUserId: 'mark',
        photos: { overview: { data: 'existing' }, closeup: null, sideProfile: null, referenceCard: null, access: null },
        extraPhotos: [{ data: 'existing-extra' }],
      };

      const result = reducer(state, {
        type: 'RESTORE_PHOTOS',
        photos: null,
        extraPhotos: null,
      });

      // Should keep existing state when action values are null
      expect(result.photos.overview.data).toBe('existing');
      expect(result.extraPhotos).toHaveLength(1);
    });
  });

  describe('BACK_TO_REVIEW', () => {
    test('goes to step 4 and resets quoteMode to standard', () => {
      const state = { ...initialState, step: 5, quoteMode: 'quick', quotePayload: { fake: true } };

      const result = reducer(state, { type: 'BACK_TO_REVIEW' });

      expect(result.step).toBe(4);
      expect(result.quoteMode).toBe('standard');
      expect(result.quotePayload).toBeNull();
    });
  });

  describe('QUOTE_SAVED', () => {
    test('sets savedJobId and clears error', () => {
      const state = { ...initialState, quoteSaveError: 'old error' };
      const result = reducer(state, { type: 'QUOTE_SAVED', jobId: 'sq-123' });
      expect(result.savedJobId).toBe('sq-123');
      expect(result.quoteSaveError).toBeNull();
    });
  });

  describe('QUOTE_SAVE_FAILED', () => {
    test('sets quoteSaveError', () => {
      const result = reducer(initialState, { type: 'QUOTE_SAVE_FAILED', error: 'Network error' });
      expect(result.quoteSaveError).toBe('Network error');
    });

    test('uses default message when no error provided', () => {
      const result = reducer(initialState, { type: 'QUOTE_SAVE_FAILED' });
      expect(result.quoteSaveError).toContain('Save failed');
    });
  });

  describe('NEW_QUOTE clears save state', () => {
    test('clears savedJobId and quoteSaveError', () => {
      const state = { ...initialState, savedJobId: 'sq-123', quoteSaveError: 'old' };
      const result = reducer(state, { type: 'NEW_QUOTE' });
      expect(result.savedJobId).toBeNull();
      expect(result.quoteSaveError).toBeNull();
    });
  });
});
