// Mock sessionStorage before importing reducer
const storage = {};
globalThis.sessionStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = value; },
  removeItem: (key) => { delete storage[key]; },
};

import { reducer, initialState } from '../reducer.js';
import { buildDiff } from '../utils/diffTracking.js';
import { WORK_STAGES_TEMPLATES } from '../data/ramsTemplates.js';
import { DEFAULT_RISK_ASSESSMENTS, COMMON_PPE, COMPANY_DEFAULTS } from '../data/ramsDefaults.js';

describe('reducer', () => {
  function reduce(state, action) {
    return reducer(state || { ...initialState }, action);
  }

  // Helper: returns a state at step 4 with populated reviewData
  function makeReviewState(overrides = {}) {
    return {
      ...initialState,
      currentUserId: 'mark',
      step: 4,
      profile: {
        companyName: 'Test Co', fullName: 'Mark', phone: '123',
        email: 'a@b.c', address: '1 St', dayRate: 400,
        vatRegistered: false, vatNumber: '', accreditations: 'DSWA',
        showNotesOnQuote: true, logo: null,
      },
      jobDetails: {
        clientName: 'Client A', siteAddress: '10 Main St',
        quoteReference: 'QT-2026-0001', quoteDate: '2026-03-20',
        briefNotes: '',
      },
      photos: {
        overview: { data: 'data:img1', name: 'ov.jpg' },
        closeup: { data: 'data:img2', name: 'cu.jpg' },
        sideProfile: null,
        referenceCard: { data: 'data:img3', name: 'ref.jpg' },
        access: null,
      },
      extraPhotos: [],
      reviewData: {
        referenceCardDetected: true,
        stoneType: 'gritstone',
        damageDescription: 'A collapsed section of gritstone wall.',
        measurements: [
          { id: 'm1', item: 'Wall height', aiValue: '1200', value: '1200', confirmed: false, confidence: 'high' },
          { id: 'm2', item: 'Wall length', aiValue: '4500', value: '4500', confirmed: false, confidence: 'medium' },
          { id: 'm3', item: 'Breach width', aiValue: '2000', value: '2000', confirmed: true, confidence: 'high' },
        ],
        materials: [
          { id: 'mat1', description: 'Gritstone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 180 },
          { id: 'mat2', description: 'Lime mortar', quantity: '1', unit: 'Item', unitCost: 90, totalCost: 90, aiUnitCost: 85 },
        ],
        labourEstimate: {
          description: 'Skilled waller', estimatedDays: 3, numberOfWorkers: 1,
          dayRate: 400, aiEstimatedDays: 3, calculationBasis: '6 sq m x 0.5hr/sq m',
        },
        scheduleOfWorks: [
          { id: 's1', stepNumber: 1, title: 'Site clearance', description: 'Clear debris' },
          { id: 's2', stepNumber: 2, title: 'Rebuild', description: 'Rebuild wall' },
        ],
        additionalCosts: [{ label: 'Travel', amount: 50 }],
        siteConditions: { accessDifficulty: 'normal', foundationCondition: 'sound' },
        notes: 'Standard terms apply.',
      },
      aiRawResponse: '{"raw":"response"}',
      diffs: [],
      ...overrides,
    };
  }

  // ---- Existing tests ----

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

  // ---- NEW tests: Phase 4 coverage ----

  describe('UPDATE_JOB_DETAILS', () => {
    test('merges partial updates into jobDetails', () => {
      const state = { ...initialState };
      const result = reducer(state, {
        type: 'UPDATE_JOB_DETAILS',
        updates: { clientName: 'Client B', siteAddress: '20 Oak Lane' },
      });
      expect(result.jobDetails.clientName).toBe('Client B');
      expect(result.jobDetails.siteAddress).toBe('20 Oak Lane');
    });

    test('preserves other jobDetails fields', () => {
      const state = {
        ...initialState,
        jobDetails: { ...initialState.jobDetails, clientName: 'Original', briefNotes: 'Important note' },
      };
      const result = reducer(state, {
        type: 'UPDATE_JOB_DETAILS',
        updates: { clientName: 'Updated' },
      });
      expect(result.jobDetails.clientName).toBe('Updated');
      expect(result.jobDetails.briefNotes).toBe('Important note');
    });
  });

  describe('SET_PHOTO', () => {
    test('sets a photo in the specified slot', () => {
      const photo = { data: 'data:img-overview', name: 'wall.jpg' };
      const result = reduce(null, { type: 'SET_PHOTO', slot: 'overview', photo });
      expect(result.photos.overview).toEqual(photo);
    });

    test('replaces an existing photo', () => {
      const state = {
        ...initialState,
        photos: { ...initialState.photos, overview: { data: 'old', name: 'old.jpg' } },
      };
      const newPhoto = { data: 'data:new', name: 'new.jpg' };
      const result = reducer(state, { type: 'SET_PHOTO', slot: 'overview', photo: newPhoto });
      expect(result.photos.overview).toEqual(newPhoto);
    });

    test('does not affect other slots', () => {
      const state = {
        ...initialState,
        photos: { ...initialState.photos, closeup: { data: 'existing', name: 'cu.jpg' } },
      };
      const result = reducer(state, { type: 'SET_PHOTO', slot: 'overview', photo: { data: 'data:ov', name: 'ov.jpg' } });
      expect(result.photos.closeup.data).toBe('existing');
      expect(result.photos.overview.data).toBe('data:ov');
    });
  });

  describe('ADD_EXTRA_PHOTO', () => {
    test('appends to extraPhotos array', () => {
      const result = reduce(null, { type: 'ADD_EXTRA_PHOTO', photo: { data: 'data:ex1', name: 'ex.jpg', label: 'Other' } });
      expect(result.extraPhotos).toHaveLength(1);
      expect(result.extraPhotos[0].data).toBe('data:ex1');
    });

    test('preserves existing extra photos', () => {
      const state = { ...initialState, extraPhotos: [{ data: 'data:existing', name: 'ex0.jpg' }] };
      const result = reducer(state, { type: 'ADD_EXTRA_PHOTO', photo: { data: 'data:ex1', name: 'ex1.jpg' } });
      expect(result.extraPhotos).toHaveLength(2);
      expect(result.extraPhotos[0].data).toBe('data:existing');
      expect(result.extraPhotos[1].data).toBe('data:ex1');
    });
  });

  describe('REMOVE_EXTRA_PHOTO', () => {
    test('removes photo by index', () => {
      const state = {
        ...initialState,
        extraPhotos: [
          { data: 'data:a', name: 'a.jpg' },
          { data: 'data:b', name: 'b.jpg' },
          { data: 'data:c', name: 'c.jpg' },
        ],
      };
      const result = reducer(state, { type: 'REMOVE_EXTRA_PHOTO', index: 1 });
      expect(result.extraPhotos).toHaveLength(2);
      expect(result.extraPhotos[0].data).toBe('data:a');
      expect(result.extraPhotos[1].data).toBe('data:c');
    });

    test('handles single-element array', () => {
      const state = { ...initialState, extraPhotos: [{ data: 'data:only', name: 'only.jpg' }] };
      const result = reducer(state, { type: 'REMOVE_EXTRA_PHOTO', index: 0 });
      expect(result.extraPhotos).toHaveLength(0);
    });
  });

  describe('ANALYSIS_START', () => {
    test('sets isAnalysing true and step to 3', () => {
      const state = { ...initialState, step: 2 };
      const result = reducer(state, { type: 'ANALYSIS_START' });
      expect(result.isAnalysing).toBe(true);
      expect(result.step).toBe(3);
    });

    test('clears previous analysis error', () => {
      const state = { ...initialState, analysisError: 'old error', step: 2 };
      const result = reducer(state, { type: 'ANALYSIS_START' });
      expect(result.analysisError).toBeNull();
      expect(result.isAnalysing).toBe(true);
    });
  });

  describe('ANALYSIS_SUCCESS (standard mode)', () => {
    test('sets step to 4, stores reviewData, clears isAnalysing', () => {
      const state = { ...initialState, isAnalysing: true, step: 3, quoteMode: 'standard' };
      const normalised = {
        measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: false }],
        materials: [],
        labourEstimate: { estimatedDays: 2 },
        scheduleOfWorks: [],
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{"raw":true}' });
      expect(result.step).toBe(4);
      expect(result.isAnalysing).toBe(false);
      expect(result.reviewData).toEqual(normalised);
      expect(result.aiRawResponse).toBe('{"raw":true}');
    });

    test('measurements remain unconfirmed in standard mode', () => {
      const state = { ...initialState, isAnalysing: true, step: 3, quoteMode: 'standard' };
      const normalised = {
        measurements: [
          { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: false },
          { id: 'm2', item: 'Length', aiValue: '4500', value: '4500', confirmed: false },
        ],
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '' });
      expect(result.reviewData.measurements.every(m => m.confirmed === false)).toBe(true);
    });

    test('does not build quotePayload in standard mode', () => {
      const state = { ...initialState, isAnalysing: true, step: 3, quoteMode: 'standard' };
      const normalised = { measurements: [], materials: [], labourEstimate: {} };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '' });
      expect(result.quotePayload).toBeNull();
    });
  });

  describe('ANALYSIS_SUCCESS (quick mode)', () => {
    test('sets step to 5 and auto-confirms all measurements', () => {
      const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
      const normalised = {
        referenceCardDetected: true,
        stoneType: 'gritstone',
        damageDescription: 'Test',
        measurements: [
          { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: false },
          { id: 'm2', item: 'Length', aiValue: '4500', value: '4500', confirmed: false },
        ],
        materials: [{ id: 'mat1', description: 'Stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 180 }],
        labourEstimate: { estimatedDays: 3, numberOfWorkers: 1, dayRate: 400, aiEstimatedDays: 3 },
        scheduleOfWorks: [{ id: 's1', stepNumber: 1, title: 'Clear', description: 'Clear site' }],
        siteConditions: { accessDifficulty: 'normal' },
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{}' });
      expect(result.step).toBe(5);
      expect(result.reviewData.measurements.every(m => m.confirmed)).toBe(true);
    });

    test('builds quotePayload in quick mode', () => {
      const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
      const normalised = {
        referenceCardDetected: true,
        stoneType: 'gritstone',
        damageDescription: 'Test',
        measurements: [
          { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: false },
        ],
        materials: [{ id: 'mat1', description: 'Stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 180 }],
        labourEstimate: { estimatedDays: 3, numberOfWorkers: 1, dayRate: 400, aiEstimatedDays: 3 },
        scheduleOfWorks: [],
        siteConditions: {},
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{}' });
      expect(result.quotePayload).not.toBeNull();
      expect(result.quotePayload.totals).toBeDefined();
    });

    test('builds diffs for measurements and labour in quick mode', () => {
      const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
      const normalised = {
        referenceCardDetected: true,
        stoneType: 'gritstone',
        measurements: [
          { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: false },
        ],
        materials: [],
        labourEstimate: { estimatedDays: 3, numberOfWorkers: 1, dayRate: 400, aiEstimatedDays: 3 },
        scheduleOfWorks: [],
        siteConditions: {},
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{}' });
      expect(result.diffs.length).toBeGreaterThan(0);
      // Should have measurement diff
      const mDiff = result.diffs.find(d => d.fieldType === 'measurement');
      expect(mDiff).toBeDefined();
      // Should have labour diff
      const lDiff = result.diffs.find(d => d.fieldType === 'labour_days');
      expect(lDiff).toBeDefined();
    });

    test('isAnalysing set to false in quick mode', () => {
      const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
      const normalised = {
        measurements: [],
        materials: [],
        labourEstimate: { estimatedDays: 2, numberOfWorkers: 1, dayRate: 400 },
        scheduleOfWorks: [],
        siteConditions: {},
      };
      const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '' });
      expect(result.isAnalysing).toBe(false);
    });
  });

  describe('ANALYSIS_CANCEL', () => {
    test('goes to step 2 and clears isAnalysing', () => {
      const state = { ...initialState, isAnalysing: true, step: 3 };
      const result = reducer(state, { type: 'ANALYSIS_CANCEL' });
      expect(result.step).toBe(2);
      expect(result.isAnalysing).toBe(false);
    });

    test('clears analysisError', () => {
      const state = { ...initialState, isAnalysing: true, analysisError: 'some error', step: 3 };
      const result = reducer(state, { type: 'ANALYSIS_CANCEL' });
      expect(result.analysisError).toBeNull();
    });
  });

  describe('ANALYSIS_ERROR', () => {
    test('sets error and clears isAnalysing', () => {
      const state = { ...initialState, isAnalysing: true, step: 3 };
      const result = reducer(state, { type: 'ANALYSIS_ERROR', error: 'API failed' });
      expect(result.analysisError).toBe('API failed');
      expect(result.isAnalysing).toBe(false);
    });

    test('preserves step on error', () => {
      const state = { ...initialState, isAnalysing: true, step: 3 };
      const result = reducer(state, { type: 'ANALYSIS_ERROR', error: 'Timeout' });
      expect(result.step).toBe(3);
    });
  });

  describe('RETRY_ANALYSIS', () => {
    test('increments retryCount and sets isAnalysing', () => {
      const state = { ...initialState, retryCount: 0, isAnalysing: false };
      const result = reducer(state, { type: 'RETRY_ANALYSIS' });
      expect(result.retryCount).toBe(1);
      expect(result.isAnalysing).toBe(true);
    });

    test('clears analysisError on retry', () => {
      const state = { ...initialState, retryCount: 1, analysisError: 'old error' };
      const result = reducer(state, { type: 'RETRY_ANALYSIS' });
      expect(result.retryCount).toBe(2);
      expect(result.analysisError).toBeNull();
    });
  });

  describe('CONFIRM_MEASUREMENT', () => {
    test('marks measurement as confirmed with new value', () => {
      const state = makeReviewState();
      const diff = buildDiff('measurement', 'Wall height', '1200', '1400');
      const result = reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff });
      const m = result.reviewData.measurements.find(m => m.id === 'm1');
      expect(m.confirmed).toBe(true);
      expect(m.value).toBe('1400');
    });

    test('adds diff to diffs array', () => {
      const state = makeReviewState();
      const diff = buildDiff('measurement', 'Wall height', '1200', '1400');
      const result = reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff });
      expect(result.diffs).toHaveLength(1);
      expect(result.diffs[0].fieldLabel).toBe('Wall height');
    });

    test('deduplicates diffs by fieldType+fieldLabel', () => {
      const existingDiff = buildDiff('measurement', 'Wall height', '1200', '1300');
      const state = makeReviewState({ diffs: [existingDiff] });
      const newDiff = buildDiff('measurement', 'Wall height', '1200', '1400');
      const result = reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff: newDiff });
      // Should have exactly 1 diff for Wall height, not 2
      const heightDiffs = result.diffs.filter(d => d.fieldLabel === 'Wall height');
      expect(heightDiffs).toHaveLength(1);
      expect(heightDiffs[0].confirmedValue).toBe('1400');
    });
  });

  describe('CONFIRM_ALL_MEASUREMENTS', () => {
    test('confirms all unconfirmed measurements', () => {
      const state = makeReviewState();
      // m1 and m2 are unconfirmed, m3 is already confirmed
      const result = reducer(state, { type: 'CONFIRM_ALL_MEASUREMENTS' });
      expect(result.reviewData.measurements.every(m => m.confirmed)).toBe(true);
    });

    test('builds diffs for each newly confirmed measurement', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'CONFIRM_ALL_MEASUREMENTS' });
      // m1 and m2 were unconfirmed — should get 2 new diffs
      expect(result.diffs).toHaveLength(2);
      expect(result.diffs.map(d => d.fieldLabel).sort()).toEqual(['Wall height', 'Wall length']);
    });

    test('skips already confirmed measurements in diffs', () => {
      // All measurements already confirmed
      const state = makeReviewState({
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [
            { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true },
          ],
        },
      });
      const result = reducer(state, { type: 'CONFIRM_ALL_MEASUREMENTS' });
      expect(result.diffs).toHaveLength(0);
    });
  });

  describe('EDIT_MEASUREMENT', () => {
    test('sets confirmed to false for the specified measurement', () => {
      const state = makeReviewState();
      // m3 is already confirmed
      const result = reducer(state, { type: 'EDIT_MEASUREMENT', id: 'm3' });
      const m = result.reviewData.measurements.find(m => m.id === 'm3');
      expect(m.confirmed).toBe(false);
    });

    test('does not affect other measurements', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'EDIT_MEASUREMENT', id: 'm3' });
      const m1 = result.reviewData.measurements.find(m => m.id === 'm1');
      expect(m1.confirmed).toBe(false); // was already false
    });
  });

  describe('UPDATE_MATERIALS', () => {
    test('replaces materials array', () => {
      const state = makeReviewState();
      const newMaterials = [{ id: 'mat-new', description: 'Sandstone', quantity: '5', unit: 't', unitCost: 200, totalCost: 1000 }];
      const result = reducer(state, { type: 'UPDATE_MATERIALS', materials: newMaterials });
      expect(result.reviewData.materials).toHaveLength(1);
      expect(result.reviewData.materials[0].description).toBe('Sandstone');
    });
  });

  describe('UPDATE_LABOUR', () => {
    test('merges labour updates', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'UPDATE_LABOUR', labour: { estimatedDays: 5 } });
      expect(result.reviewData.labourEstimate.estimatedDays).toBe(5);
      expect(result.reviewData.labourEstimate.numberOfWorkers).toBe(1); // preserved
    });

    test('can update multiple labour fields at once', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'UPDATE_LABOUR', labour: { estimatedDays: 4, numberOfWorkers: 2 } });
      expect(result.reviewData.labourEstimate.estimatedDays).toBe(4);
      expect(result.reviewData.labourEstimate.numberOfWorkers).toBe(2);
    });
  });

  describe('UPDATE_ADDITIONAL_COSTS', () => {
    test('replaces additionalCosts', () => {
      const state = makeReviewState();
      const costs = [{ label: 'Accommodation', amount: 200 }];
      const result = reducer(state, { type: 'UPDATE_ADDITIONAL_COSTS', additionalCosts: costs });
      expect(result.reviewData.additionalCosts).toHaveLength(1);
      expect(result.reviewData.additionalCosts[0].label).toBe('Accommodation');
    });
  });

  describe('UPDATE_SCHEDULE', () => {
    test('replaces scheduleOfWorks', () => {
      const state = makeReviewState();
      const schedule = [{ id: 'new-s1', stepNumber: 1, title: 'New step', description: 'Do thing' }];
      const result = reducer(state, { type: 'UPDATE_SCHEDULE', schedule });
      expect(result.reviewData.scheduleOfWorks).toHaveLength(1);
      expect(result.reviewData.scheduleOfWorks[0].title).toBe('New step');
    });
  });

  describe('UPDATE_DAMAGE_DESCRIPTION', () => {
    test('updates damageDescription', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'UPDATE_DAMAGE_DESCRIPTION', value: 'Severe structural damage' });
      expect(result.reviewData.damageDescription).toBe('Severe structural damage');
    });
  });

  describe('UPDATE_NOTES', () => {
    test('updates notes', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'UPDATE_NOTES', notes: 'Custom terms here.' });
      expect(result.reviewData.notes).toBe('Custom terms here.');
    });
  });

  describe('GENERATE_QUOTE', () => {
    test('sets step to 5 and builds quotePayload', () => {
      // Need all measurements confirmed
      const state = makeReviewState({
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [
            { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true },
          ],
        },
      });
      const result = reducer(state, { type: 'GENERATE_QUOTE' });
      expect(result.step).toBe(5);
      expect(result.quotePayload).not.toBeNull();
      expect(result.quotePayload.profile).toBeDefined();
      expect(result.quotePayload.totals).toBeDefined();
    });

    test('generates labour diff when aiEstimatedDays is present', () => {
      const state = makeReviewState({
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        },
      });
      const result = reducer(state, { type: 'GENERATE_QUOTE' });
      const labourDiff = result.diffs.find(d => d.fieldType === 'labour_days');
      expect(labourDiff).toBeDefined();
      expect(labourDiff.fieldLabel).toBe('Estimated Days');
    });

    test('generates material diffs when aiUnitCost is present', () => {
      const state = makeReviewState({
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        },
      });
      const result = reducer(state, { type: 'GENERATE_QUOTE' });
      const materialDiffs = result.diffs.filter(d => d.fieldType === 'material_unit_cost');
      // 2 materials in makeReviewState, both with aiUnitCost
      expect(materialDiffs).toHaveLength(2);
    });

    test('deduplicates existing labour/material diffs', () => {
      const existingLabourDiff = buildDiff('labour_days', 'Estimated Days', 3, 4);
      const state = makeReviewState({
        diffs: [existingLabourDiff],
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        },
      });
      const result = reducer(state, { type: 'GENERATE_QUOTE' });
      const labourDiffs = result.diffs.filter(d => d.fieldType === 'labour_days');
      expect(labourDiffs).toHaveLength(1); // deduplicated, not 2
    });

    test('includes aiRawResponse in quotePayload', () => {
      const state = makeReviewState({
        reviewData: {
          ...makeReviewState().reviewData,
          measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        },
      });
      const result = reducer(state, { type: 'GENERATE_QUOTE' });
      expect(result.quotePayload.quote.aiRawResponse).toBe('{"raw":"response"}');
    });
  });

  describe('NEW_QUOTE extended', () => {
    test('increments quoteSequence', () => {
      const state = { ...initialState, quoteSequence: 3 };
      const result = reducer(state, { type: 'NEW_QUOTE' });
      expect(result.quoteSequence).toBe(4);
    });

    test('preserves profile', () => {
      const state = {
        ...initialState,
        profile: { ...initialState.profile, companyName: 'Doyle Stone', fullName: 'Mark' },
        quoteSequence: 1,
      };
      const result = reducer(state, { type: 'NEW_QUOTE' });
      expect(result.profile.companyName).toBe('Doyle Stone');
    });

    test('applies mode from action', () => {
      const state = { ...initialState, quoteSequence: 1 };
      const result = reducer(state, { type: 'NEW_QUOTE', mode: 'quick' });
      expect(result.quoteMode).toBe('quick');
    });

    test('defaults to standard mode when no mode provided', () => {
      const state = { ...initialState, quoteSequence: 1, quoteMode: 'quick' };
      const result = reducer(state, { type: 'NEW_QUOTE' });
      expect(result.quoteMode).toBe('standard');
    });
  });

  describe('CREATE_RAMS', () => {
    test('creates RAMS with populated data from state', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'CREATE_RAMS' });
      expect(result.rams).not.toBeNull();
      expect(result.rams.id).toMatch(/^rams-/);
      expect(result.rams.status).toBe('draft');
    });

    test('populates company and client from state', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'CREATE_RAMS' });
      expect(result.rams.company).toBe('Test Co');
      expect(result.rams.client).toBe('Client A');
      expect(result.rams.foreman).toBe('Mark');
      expect(result.rams.siteAddress).toBe('10 Main St');
    });

    test('includes photos from state and default risk assessments', () => {
      const state = makeReviewState();
      const result = reducer(state, { type: 'CREATE_RAMS' });
      // overview + closeup (referenceCard not included in RAMS photos)
      expect(result.rams.photos.length).toBe(2);
      // Default risk assessments
      expect(result.rams.riskAssessments.length).toBe(DEFAULT_RISK_ASSESSMENTS.length);
      // Default PPE
      const defaultPpe = COMMON_PPE.filter(p => p.defaultSelected).map(p => p.id);
      expect(result.rams.ppeRequirements).toEqual(defaultPpe);
    });
  });

  describe('UPDATE_RAMS', () => {
    test('merges updates into RAMS', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'UPDATE_RAMS', updates: { methodDescription: 'Rebuild using reclaimed stone' } });
      expect(result.rams.methodDescription).toBe('Rebuild using reclaimed stone');
    });

    test('preserves other RAMS fields', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      const origId = result.rams.id;
      result = reducer(result, { type: 'UPDATE_RAMS', updates: { commencementDate: '2026-04-15' } });
      expect(result.rams.id).toBe(origId);
      expect(result.rams.commencementDate).toBe('2026-04-15');
    });
  });

  describe('SET_RAMS_WORK_TYPES', () => {
    test('sets work types and generates stages from templates', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'SET_RAMS_WORK_TYPES', workTypes: ['plumbing'] });
      expect(result.rams.workTypes).toEqual(['plumbing']);
      expect(result.rams.workStages.length).toBe(WORK_STAGES_TEMPLATES.plumbing.length);
      expect(result.rams.workStages[0].type).toBe('plumbing');
    });

    test('handles multiple work types', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'SET_RAMS_WORK_TYPES', workTypes: ['plumbing', 'electrical'] });
      expect(result.rams.workTypes).toEqual(['plumbing', 'electrical']);
      const expectedStages = WORK_STAGES_TEMPLATES.plumbing.length + WORK_STAGES_TEMPLATES.electrical.length;
      expect(result.rams.workStages.length).toBe(expectedStages);
    });
  });

  describe('ADD_RAMS_RISK', () => {
    test('adds a risk assessment', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      const origCount = result.rams.riskAssessments.length;
      const newRisk = { id: 'custom-1', task: 'Custom task', hazardDescription: 'Custom hazard', likelihood: 3, consequence: 3, riskRating: 9 };
      result = reducer(result, { type: 'ADD_RAMS_RISK', risk: newRisk });
      expect(result.rams.riskAssessments.length).toBe(origCount + 1);
      expect(result.rams.riskAssessments[result.rams.riskAssessments.length - 1].id).toBe('custom-1');
    });
  });

  describe('UPDATE_RAMS_RISK', () => {
    test('updates risk assessment and recalculates rating', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      // Update default-1 (likelihood=2, consequence=2, rating=4) to likelihood=4
      result = reducer(result, { type: 'UPDATE_RAMS_RISK', id: 'default-1', updates: { likelihood: 4 } });
      const updated = result.rams.riskAssessments.find(r => r.id === 'default-1');
      expect(updated.likelihood).toBe(4);
      expect(updated.riskRating).toBe(4 * 2); // 4 * consequence(2) = 8
    });

    test('does not affect other risk assessments', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'UPDATE_RAMS_RISK', id: 'default-1', updates: { likelihood: 5 } });
      const other = result.rams.riskAssessments.find(r => r.id === 'default-2');
      expect(other.likelihood).toBe(3); // unchanged
    });
  });

  describe('REMOVE_RAMS_RISK', () => {
    test('removes risk by id', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      const origCount = result.rams.riskAssessments.length;
      result = reducer(result, { type: 'REMOVE_RAMS_RISK', id: 'default-1' });
      expect(result.rams.riskAssessments.length).toBe(origCount - 1);
      expect(result.rams.riskAssessments.find(r => r.id === 'default-1')).toBeUndefined();
    });

    test('preserves other risks', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'REMOVE_RAMS_RISK', id: 'default-1' });
      expect(result.rams.riskAssessments.find(r => r.id === 'default-2')).toBeDefined();
    });
  });

  describe('CLEAR_RAMS / RESTORE_RAMS', () => {
    test('CLEAR_RAMS sets rams to null', () => {
      const state = makeReviewState();
      let result = reducer(state, { type: 'CREATE_RAMS' });
      result = reducer(result, { type: 'CLEAR_RAMS' });
      expect(result.rams).toBeNull();
    });

    test('RESTORE_RAMS sets rams from action', () => {
      const savedRams = { id: 'rams-saved', status: 'complete', workTypes: ['plumbing'] };
      const result = reducer(initialState, { type: 'RESTORE_RAMS', rams: savedRams });
      expect(result.rams).toEqual(savedRams);
    });
  });

  describe('OPEN_STATUS_MODAL / CLOSE_STATUS_MODAL', () => {
    test('OPEN_STATUS_MODAL sets modal state', () => {
      const result = reduce(null, { type: 'OPEN_STATUS_MODAL', jobId: 'sq-1', targetStatus: 'sent' });
      expect(result.statusModal.open).toBe(true);
      expect(result.statusModal.jobId).toBe('sq-1');
      expect(result.statusModal.targetStatus).toBe('sent');
    });

    test('CLOSE_STATUS_MODAL clears modal state', () => {
      const state = { ...initialState, statusModal: { open: true, jobId: 'sq-1', targetStatus: 'sent' } };
      const result = reducer(state, { type: 'CLOSE_STATUS_MODAL' });
      expect(result.statusModal.open).toBe(false);
      expect(result.statusModal.jobId).toBeNull();
      expect(result.statusModal.targetStatus).toBeNull();
    });
  });

  describe('JOBS_UPDATED', () => {
    test('sets recentJobs', () => {
      const jobs = [{ id: 'sq-1', clientName: 'A' }, { id: 'sq-2', clientName: 'B' }];
      const result = reduce(null, { type: 'JOBS_UPDATED', jobs });
      expect(result.recentJobs).toHaveLength(2);
      expect(result.recentJobs[0].clientName).toBe('A');
    });
  });

  describe('DELETE_JOB', () => {
    test('removes job by id', () => {
      const state = {
        ...initialState,
        recentJobs: [{ id: 'sq-1', clientName: 'A' }, { id: 'sq-2', clientName: 'B' }],
      };
      const result = reducer(state, { type: 'DELETE_JOB', id: 'sq-1' });
      expect(result.recentJobs).toHaveLength(1);
      expect(result.recentJobs[0].id).toBe('sq-2');
    });

    test('preserves other jobs', () => {
      const state = {
        ...initialState,
        recentJobs: [{ id: 'sq-1' }, { id: 'sq-2' }, { id: 'sq-3' }],
      };
      const result = reducer(state, { type: 'DELETE_JOB', id: 'sq-2' });
      expect(result.recentJobs.map(j => j.id)).toEqual(['sq-1', 'sq-3']);
    });
  });

  describe('INIT_COMPLETE', () => {
    test('sets initComplete and populates user when user provided', () => {
      const user = { id: 'mark', name: 'Mark', email: 'mark@test.com', plan: 'admin' };
      const result = reduce(null, { type: 'INIT_COMPLETE', user });
      expect(result.initComplete).toBe(true);
      expect(result.currentUserId).toBe('mark');
      expect(result.currentUser).toEqual(user);
      expect(result.allUsers).toEqual([user]);
    });

    test('sets initComplete without user when user is null', () => {
      const result = reduce(null, { type: 'INIT_COMPLETE', user: null });
      expect(result.initComplete).toBe(true);
      expect(result.currentUserId).toBeNull();
    });
  });

  describe('default case', () => {
    test('unknown action returns state unchanged', () => {
      const state = { ...initialState, step: 3 };
      const result = reducer(state, { type: 'UNKNOWN_ACTION' });
      expect(result.step).toBe(3);
    });
  });
});
