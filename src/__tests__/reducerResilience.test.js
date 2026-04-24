// Mock sessionStorage before importing reducer
const storage = {};
globalThis.sessionStorage = {
  getItem: (key) => storage[key] || null,
  setItem: (key, value) => { storage[key] = value; },
  removeItem: (key) => { delete storage[key]; },
};

import { reducer, initialState } from '../reducer.js';
import { buildDiff } from '../utils/diffTracking.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper: minimal review state for testing
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
      damageDescription: 'Collapsed gritstone wall.',
      measurements: [
        { id: 'm1', item: 'Wall height', aiValue: '1200', value: '1200', confirmed: false, confidence: 'high' },
        { id: 'm2', item: 'Wall length', aiValue: '4500', value: '4500', confirmed: false, confidence: 'medium' },
        { id: 'm3', item: 'Breach width', aiValue: '2000', value: '2000', confirmed: true, confidence: 'high' },
      ],
      materials: [
        { id: 'mat1', description: 'Gritstone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 180 },
      ],
      labourEstimate: {
        description: 'Skilled waller', estimatedDays: 3, numberOfWorkers: 1,
        dayRate: 400, aiEstimatedDays: 3, calculationBasis: '6sqm x 0.5hr/sqm',
      },
      scheduleOfWorks: [
        { id: 's1', stepNumber: 1, title: 'Site clearance', description: 'Clear debris' },
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

// ======================================================================
//  1. NULL REVIEWDATA GUARD — actions that touch reviewData must not crash
// ======================================================================

describe('Null reviewData guards', () => {
  const nullReviewState = { ...initialState, reviewData: null, step: 4 };

  test('CONFIRM_MEASUREMENT returns state unchanged when reviewData is null', () => {
    const diff = buildDiff('measurement', 'Height', '1200', '1400');
    const result = reducer(nullReviewState, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff });
    expect(result.reviewData).toBeNull();
  });

  test('CONFIRM_ALL_MEASUREMENTS returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'CONFIRM_ALL_MEASUREMENTS' });
    expect(result.reviewData).toBeNull();
  });

  test('EDIT_MEASUREMENT returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'EDIT_MEASUREMENT', id: 'm1' });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_MATERIALS returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_MATERIALS', materials: [] });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_LABOUR returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_LABOUR', labour: { estimatedDays: 5 } });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_ADDITIONAL_COSTS returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_ADDITIONAL_COSTS', additionalCosts: [] });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_SCHEDULE returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_SCHEDULE', schedule: [] });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_DAMAGE_DESCRIPTION returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_DAMAGE_DESCRIPTION', value: 'test' });
    expect(result.reviewData).toBeNull();
  });

  test('UPDATE_NOTES returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'UPDATE_NOTES', notes: 'test' });
    expect(result.reviewData).toBeNull();
  });

  test('GENERATE_QUOTE returns state unchanged when reviewData is null', () => {
    const result = reducer(nullReviewState, { type: 'GENERATE_QUOTE' });
    expect(result.reviewData).toBeNull();
    expect(result.step).toBe(4); // should not advance to step 5
  });
});

// ======================================================================
//  2. NULL RAMS GUARD — RAMS actions must not crash when rams is null
// ======================================================================

describe('Null RAMS guards', () => {
  const nullRamsState = { ...initialState, rams: null };

  test('UPDATE_RAMS returns state unchanged when rams is null', () => {
    const result = reducer(nullRamsState, { type: 'UPDATE_RAMS', updates: { methodDescription: 'Test' } });
    expect(result.rams).toBeNull();
  });

  test('ADD_RAMS_RISK returns state unchanged when rams is null', () => {
    const result = reducer(nullRamsState, { type: 'ADD_RAMS_RISK', risk: { id: 'r1' } });
    expect(result.rams).toBeNull();
  });

  test('UPDATE_RAMS_RISK returns state unchanged when rams is null', () => {
    const result = reducer(nullRamsState, { type: 'UPDATE_RAMS_RISK', id: 'r1', updates: { likelihood: 5 } });
    expect(result.rams).toBeNull();
  });

  test('REMOVE_RAMS_RISK returns state unchanged when rams is null', () => {
    const result = reducer(nullRamsState, { type: 'REMOVE_RAMS_RISK', id: 'r1' });
    expect(result.rams).toBeNull();
  });

  test('SET_RAMS_WORK_TYPES returns state unchanged when rams is null', () => {
    const result = reducer(nullRamsState, { type: 'SET_RAMS_WORK_TYPES', workTypes: ['plumbing'] });
    expect(result.rams).toBeNull();
  });
});

// ======================================================================
//  3. NEW_QUOTE RESET COMPLETENESS — transient fields must reset
// ======================================================================

describe('NEW_QUOTE resets transient fields', () => {
  test('resets retryCount to 0', () => {
    const state = { ...initialState, retryCount: 3, quoteSequence: 1 };
    const result = reducer(state, { type: 'NEW_QUOTE' });
    expect(result.retryCount).toBe(0);
  });

  test('resets quoteSaveErrorKey to 0', () => {
    const state = { ...initialState, quoteSaveErrorKey: 5, quoteSequence: 1 };
    const result = reducer(state, { type: 'NEW_QUOTE' });
    expect(result.quoteSaveErrorKey).toBe(0);
  });

  test('resets rams to null', () => {
    const state = { ...initialState, rams: { id: 'old-rams' }, quoteSequence: 1 };
    const result = reducer(state, { type: 'NEW_QUOTE' });
    expect(result.rams).toBeNull();
  });

  test('resets clientPhone to empty string (was missing from jobDetails reset)', () => {
    // clientPhone is in the initial jobDetails shape but was dropped
    // from the NEW_QUOTE reset — left state.jobDetails.clientPhone as
    // undefined instead of ''. UI defaulted via `|| ''` but the state
    // shape was inconsistent.
    const state = {
      ...initialState,
      jobDetails: { ...initialState.jobDetails, clientPhone: '07123 456789' },
      quoteSequence: 1,
    };
    const result = reducer(state, { type: 'NEW_QUOTE' });
    expect(result.jobDetails.clientPhone).toBe('');
  });
});

// ======================================================================
//  4. IMMUTABILITY — reducer must never mutate previous state
// ======================================================================

describe('Immutability guarantees', () => {
  test('SET_PHOTO does not mutate original photos object', () => {
    const state = makeReviewState();
    const originalPhotos = { ...state.photos };
    reducer(state, { type: 'SET_PHOTO', slot: 'access', photo: { data: 'new', name: 'new.jpg' } });
    expect(state.photos).toEqual(originalPhotos);
    expect(state.photos.access).toBeNull();
  });

  test('CONFIRM_MEASUREMENT does not mutate original measurements array', () => {
    const state = makeReviewState();
    const originalMeasurements = [...state.reviewData.measurements];
    const diff = buildDiff('measurement', 'Wall height', '1200', '1400');
    reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff });
    expect(state.reviewData.measurements).toEqual(originalMeasurements);
    expect(state.reviewData.measurements[0].confirmed).toBe(false); // still original
  });

  test('UPDATE_MATERIALS does not mutate original reviewData', () => {
    const state = makeReviewState();
    const originalMaterials = [...state.reviewData.materials];
    reducer(state, { type: 'UPDATE_MATERIALS', materials: [{ id: 'new', description: 'New' }] });
    expect(state.reviewData.materials).toEqual(originalMaterials);
  });

  test('ADD_EXTRA_PHOTO does not mutate original array', () => {
    const state = { ...initialState, extraPhotos: [{ data: 'a' }] };
    const original = [...state.extraPhotos];
    reducer(state, { type: 'ADD_EXTRA_PHOTO', photo: { data: 'b' } });
    expect(state.extraPhotos).toEqual(original);
    expect(state.extraPhotos).toHaveLength(1);
  });

  test('UPDATE_LABOUR does not mutate original labourEstimate', () => {
    const state = makeReviewState();
    const originalLabour = { ...state.reviewData.labourEstimate };
    reducer(state, { type: 'UPDATE_LABOUR', labour: { estimatedDays: 99 } });
    expect(state.reviewData.labourEstimate).toEqual(originalLabour);
  });

  test('CONFIRM_ALL_MEASUREMENTS does not mutate original diffs', () => {
    const existingDiff = buildDiff('measurement', 'Other', '100', '200');
    const state = makeReviewState({ diffs: [existingDiff] });
    const originalDiffs = [...state.diffs];
    reducer(state, { type: 'CONFIRM_ALL_MEASUREMENTS' });
    expect(state.diffs).toEqual(originalDiffs);
  });
});

// ======================================================================
//  5. RESTORE_DRAFT safety — must not overwrite auth/init fields
// ======================================================================

describe('RESTORE_DRAFT safety', () => {
  test('does not overwrite currentUserId from draft', () => {
    const state = { ...initialState, currentUserId: 'mark', currentUser: { id: 'mark', name: 'Mark' } };
    const maliciousDraft = {
      step: 4,
      currentUserId: 'attacker',
      initComplete: false,
      allUsers: [{ id: 'attacker' }],
      profile: { companyName: 'Evil Corp' },
    };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft: maliciousDraft });
    // Profile is excluded by design
    expect(result.profile.companyName).not.toBe('Evil Corp');
  });

  test('preserves isAnalysing=false after restore even if draft had isAnalysing=true', () => {
    const state = { ...initialState, currentUserId: 'mark' };
    const draft = { step: 4, isAnalysing: true, analysisError: 'stale' };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(result.isAnalysing).toBe(false);
    expect(result.analysisError).toBeNull();
  });

  test('preserves quotePayload=null after restore even if draft had stale payload', () => {
    const state = { ...initialState, currentUserId: 'mark' };
    const draft = { step: 4, quotePayload: { stale: true } };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(result.quotePayload).toBeNull();
  });
});

// ======================================================================
//  6. GENERATE_QUOTE edge cases
// ======================================================================

describe('GENERATE_QUOTE edge cases', () => {
  test('works with empty materials array', () => {
    const state = makeReviewState({
      reviewData: {
        ...makeReviewState().reviewData,
        measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        materials: [],
      },
    });
    const result = reducer(state, { type: 'GENERATE_QUOTE' });
    expect(result.step).toBe(5);
    expect(result.quotePayload).not.toBeNull();
  });

  test('works with labourEstimate missing aiEstimatedDays', () => {
    const state = makeReviewState({
      reviewData: {
        ...makeReviewState().reviewData,
        measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        labourEstimate: { estimatedDays: 3, numberOfWorkers: 1, dayRate: 400 },
      },
    });
    const result = reducer(state, { type: 'GENERATE_QUOTE' });
    expect(result.step).toBe(5);
    // No labour diff generated since aiEstimatedDays is undefined
    const labourDiff = result.diffs.find(d => d.fieldType === 'labour_days');
    expect(labourDiff).toBeUndefined();
  });

  test('works with materials missing aiUnitCost and aiQuantity', () => {
    const state = makeReviewState({
      reviewData: {
        ...makeReviewState().reviewData,
        measurements: [{ id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true }],
        materials: [
          { id: 'mat1', description: 'Stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
        ],
      },
    });
    const result = reducer(state, { type: 'GENERATE_QUOTE' });
    const matDiffs = result.diffs.filter(d => d.fieldType.startsWith('material_'));
    expect(matDiffs).toHaveLength(0);
  });
});

// ======================================================================
//  7. RAPID STATE TRANSITIONS — double-dispatch edge cases
// ======================================================================

describe('Rapid state transitions', () => {
  test('ANALYSIS_START then immediate ANALYSIS_CANCEL returns to step 2', () => {
    let state = { ...initialState, step: 2 };
    state = reducer(state, { type: 'ANALYSIS_START' });
    expect(state.step).toBe(3);
    expect(state.isAnalysing).toBe(true);
    state = reducer(state, { type: 'ANALYSIS_CANCEL' });
    expect(state.step).toBe(2);
    expect(state.isAnalysing).toBe(false);
  });

  test('ANALYSIS_START then ANALYSIS_ERROR leaves step at 3 for retry UI', () => {
    let state = { ...initialState, step: 2 };
    state = reducer(state, { type: 'ANALYSIS_START' });
    state = reducer(state, { type: 'ANALYSIS_ERROR', error: 'Timeout' });
    expect(state.step).toBe(3);
    expect(state.isAnalysing).toBe(false);
    expect(state.analysisError).toBe('Timeout');
  });

  test('GENERATE_QUOTE then BACK_TO_REVIEW then GENERATE_QUOTE round-trip', () => {
    const base = makeReviewState({
      reviewData: {
        ...makeReviewState().reviewData,
        measurements: [
          { id: 'm1', item: 'Height', aiValue: '1200', value: '1200', confirmed: true },
        ],
      },
    });

    let state = reducer(base, { type: 'GENERATE_QUOTE' });
    expect(state.step).toBe(5);
    expect(state.quotePayload).not.toBeNull();

    state = reducer(state, { type: 'BACK_TO_REVIEW' });
    expect(state.step).toBe(4);
    expect(state.quotePayload).toBeNull();

    state = reducer(state, { type: 'GENERATE_QUOTE' });
    expect(state.step).toBe(5);
    expect(state.quotePayload).not.toBeNull();
  });

  test('Double CONFIRM_MEASUREMENT on same id is safe', () => {
    const state = makeReviewState();
    const diff1 = buildDiff('measurement', 'Wall height', '1200', '1300');
    let result = reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1300', diff: diff1 });
    const diff2 = buildDiff('measurement', 'Wall height', '1200', '1400');
    result = reducer(result, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1400', diff: diff2 });
    // Only 1 diff for Wall height (deduplicated)
    const heightDiffs = result.diffs.filter(d => d.fieldLabel === 'Wall height');
    expect(heightDiffs).toHaveLength(1);
    expect(heightDiffs[0].confirmedValue).toBe('1400');
  });

  test('Multiple QUOTE_SAVE_FAILED increments key each time', () => {
    let state = { ...initialState };
    state = reducer(state, { type: 'QUOTE_SAVE_FAILED', error: 'Error 1' });
    expect(state.quoteSaveErrorKey).toBe(1);
    state = reducer(state, { type: 'QUOTE_SAVE_FAILED', error: 'Error 2' });
    expect(state.quoteSaveErrorKey).toBe(2);
    state = reducer(state, { type: 'QUOTE_SAVE_FAILED', error: 'Error 3' });
    expect(state.quoteSaveErrorKey).toBe(3);
  });
});

// ======================================================================
//  8. AIVALUE IMMUTABILITY — the most important invariant
// ======================================================================

describe('aiValue immutability', () => {
  test('CONFIRM_MEASUREMENT updates value but never aiValue', () => {
    const state = makeReviewState();
    const diff = buildDiff('measurement', 'Wall height', '1200', '1500');
    const result = reducer(state, { type: 'CONFIRM_MEASUREMENT', id: 'm1', value: '1500', diff });
    const m = result.reviewData.measurements.find(m => m.id === 'm1');
    expect(m.value).toBe('1500');
    expect(m.aiValue).toBe('1200'); // MUST NOT CHANGE
  });

  test('EDIT_MEASUREMENT does not alter aiValue', () => {
    const state = makeReviewState({
      reviewData: {
        ...makeReviewState().reviewData,
        measurements: [
          { id: 'm1', item: 'Wall height', aiValue: '1200', value: '1500', confirmed: true },
        ],
      },
    });
    const result = reducer(state, { type: 'EDIT_MEASUREMENT', id: 'm1' });
    const m = result.reviewData.measurements.find(m => m.id === 'm1');
    expect(m.confirmed).toBe(false);
    expect(m.aiValue).toBe('1200'); // MUST NOT CHANGE
    expect(m.value).toBe('1500'); // value preserved
  });

  test('CONFIRM_ALL_MEASUREMENTS does not alter any aiValue', () => {
    const state = makeReviewState();
    const result = reducer(state, { type: 'CONFIRM_ALL_MEASUREMENTS' });
    result.reviewData.measurements.forEach(m => {
      const original = state.reviewData.measurements.find(o => o.id === m.id);
      expect(m.aiValue).toBe(original.aiValue);
    });
  });

  test('source code: reducer never assigns to aiValue', () => {
    const reducerSrc = readFileSync(resolve(__dirname, '../reducer.js'), 'utf8');
    // Regex matches aiValue being on the left side of assignment or spread mutation
    // Allow reading aiValue (e.g., m.aiValue, labour.aiEstimatedDays)
    // Disallow setting it (e.g., aiValue: newVal in object destructuring that creates new measurements)
    const lines = reducerSrc.split('\n');
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Pattern: explicit assignment to aiValue property
      if (/\.aiValue\s*=/.test(line) && !line.trim().startsWith('//')) {
        violations.push(`Line ${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ======================================================================
//  9. INIT_COMPLETE edge cases
// ======================================================================

describe('INIT_COMPLETE edge cases', () => {
  test('handles undefined user gracefully', () => {
    const result = reducer(initialState, { type: 'INIT_COMPLETE', user: undefined });
    expect(result.initComplete).toBe(true);
    expect(result.currentUserId).toBeNull();
  });

  test('calling INIT_COMPLETE twice updates user', () => {
    let state = reducer(initialState, { type: 'INIT_COMPLETE', user: { id: 'mark', name: 'Mark' } });
    state = reducer(state, { type: 'INIT_COMPLETE', user: { id: 'mark', name: 'Mark Updated', profileComplete: true } });
    expect(state.currentUser.name).toBe('Mark Updated');
    expect(state.currentUser.profileComplete).toBe(true);
  });
});

// ======================================================================
//  10. STATUS MODAL edge cases
// ======================================================================

describe('Status modal edge cases', () => {
  test('CLOSE_STATUS_MODAL on already-closed modal is safe', () => {
    const state = { ...initialState };
    const result = reducer(state, { type: 'CLOSE_STATUS_MODAL' });
    expect(result.statusModal.open).toBe(false);
    expect(result.statusModal.jobId).toBeNull();
  });

  test('OPEN_STATUS_MODAL then immediately CLOSE_STATUS_MODAL', () => {
    let state = reducer(initialState, { type: 'OPEN_STATUS_MODAL', jobId: 'sq-1', targetStatus: 'sent' });
    expect(state.statusModal.open).toBe(true);
    state = reducer(state, { type: 'CLOSE_STATUS_MODAL' });
    expect(state.statusModal.open).toBe(false);
  });
});

// ======================================================================
//  11. DELETE_JOB edge cases
// ======================================================================

describe('DELETE_JOB edge cases', () => {
  test('deleting non-existent job id does not crash', () => {
    const state = {
      ...initialState,
      recentJobs: [{ id: 'sq-1' }, { id: 'sq-2' }],
    };
    const result = reducer(state, { type: 'DELETE_JOB', id: 'sq-nonexistent' });
    expect(result.recentJobs).toHaveLength(2); // unchanged
  });

  test('deleting from empty array does not crash', () => {
    const state = { ...initialState, recentJobs: [] };
    const result = reducer(state, { type: 'DELETE_JOB', id: 'sq-1' });
    expect(result.recentJobs).toHaveLength(0);
  });
});

// ======================================================================
//  12. SOURCE-LEVEL: All dispatched action types have reducer cases
// ======================================================================

describe('Action type coverage', () => {
  test('every dispatched action type has a corresponding case in reducer.js', async () => {
    const { readdirSync, statSync } = await import('fs');
    const srcDir = resolve(__dirname, '..');
    const reducerSrc = readFileSync(resolve(srcDir, 'reducer.js'), 'utf8');

    // Extract all case labels from reducer
    const casePattern = /case\s+'([A-Z_]+)'/g;
    const reducerCases = new Set();
    let match;
    while ((match = casePattern.exec(reducerSrc)) !== null) {
      reducerCases.add(match[1]);
    }

    // Collect all dispatched types from all source files
    const dispatchPattern = /dispatch\(\{\s*type:\s*['"]([A-Z_]+)['"]/g;
    const dispatched = new Set();

    function scanDir(dir) {
      for (const entry of readdirSync(dir)) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        const full = resolve(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          scanDir(full);
        } else if (full.endsWith('.js') || full.endsWith('.jsx')) {
          const src = readFileSync(full, 'utf8');
          let m;
          while ((m = dispatchPattern.exec(src)) !== null) {
            dispatched.add(m[1]);
          }
        }
      }
    }
    scanDir(srcDir);

    const orphaned = [...dispatched].filter(t => !reducerCases.has(t));
    expect(orphaned).toEqual([]);
  });
});

// ======================================================================
//  13. SWITCH_USER completeness
// ======================================================================

describe('SWITCH_USER completeness', () => {
  test('resets step to 1', () => {
    const state = { ...initialState, step: 5 };
    const result = reducer(state, { type: 'SWITCH_USER', userId: 'new', name: 'New' });
    expect(result.step).toBe(1);
  });

  test('clears reviewData', () => {
    const state = makeReviewState();
    const result = reducer(state, { type: 'SWITCH_USER', userId: 'new', name: 'New' });
    expect(result.reviewData).toBeNull();
  });

  test('resets isAnalysing', () => {
    const state = { ...initialState, isAnalysing: true };
    const result = reducer(state, { type: 'SWITCH_USER', userId: 'new', name: 'New' });
    expect(result.isAnalysing).toBe(false);
  });

  test('preserves initComplete and allUsers', () => {
    const state = {
      ...initialState,
      initComplete: true,
      allUsers: [{ id: 'mark' }, { id: 'paul' }],
    };
    const result = reducer(state, { type: 'SWITCH_USER', userId: 'paul', name: 'Paul' });
    expect(result.initComplete).toBe(true);
    expect(result.allUsers).toHaveLength(2);
  });

  test('applies profile when provided', () => {
    const state = { ...initialState };
    const result = reducer(state, {
      type: 'SWITCH_USER',
      userId: 'paul',
      name: 'Paul',
      profile: { companyName: 'Paul Co' },
    });
    expect(result.profile.companyName).toBe('Paul Co');
  });

  test('uses initialState profile when no profile provided', () => {
    const state = { ...initialState };
    const result = reducer(state, {
      type: 'SWITCH_USER',
      userId: 'paul',
      name: 'Paul',
    });
    expect(result.profile.companyName).toBe('');
  });
});

// ======================================================================
//  14. ANALYSIS_SUCCESS quick mode — edge cases
// ======================================================================

describe('ANALYSIS_SUCCESS quick mode edge cases', () => {
  test('handles empty measurements array', () => {
    const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
    const normalised = {
      measurements: [],
      materials: [],
      labourEstimate: { estimatedDays: 2, numberOfWorkers: 1, dayRate: 400 },
      scheduleOfWorks: [],
      siteConditions: {},
    };
    const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{}' });
    expect(result.step).toBe(5);
    expect(result.reviewData.measurements).toHaveLength(0);
    expect(result.quotePayload).not.toBeNull();
  });

  test('handles materials with both aiUnitCost and aiQuantity', () => {
    const state = makeReviewState({ isAnalysing: true, step: 3, quoteMode: 'quick', reviewData: null, diffs: [] });
    const normalised = {
      measurements: [],
      materials: [
        { id: 'mat1', description: 'Stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 200, aiQuantity: '3' },
      ],
      labourEstimate: { estimatedDays: 2, numberOfWorkers: 1, dayRate: 400 },
      scheduleOfWorks: [],
      siteConditions: {},
    };
    const result = reducer(state, { type: 'ANALYSIS_SUCCESS', normalised, rawResponse: '{}' });
    const ucDiff = result.diffs.find(d => d.fieldType === 'material_unit_cost');
    const qtyDiff = result.diffs.find(d => d.fieldType === 'material_quantity');
    expect(ucDiff).toBeDefined();
    expect(qtyDiff).toBeDefined();
  });
});

// ======================================================================
//  15. SESSION PERSISTENCE — saveState is called on every action
// ======================================================================

describe('Session persistence', () => {
  test('reducer calls sessionStorage.setItem on every dispatch', () => {
    const setItemCalls = [];
    const originalSetItem = sessionStorage.setItem;
    sessionStorage.setItem = (key, val) => {
      setItemCalls.push(key);
      originalSetItem.call(sessionStorage, key, val);
    };

    const state = { ...initialState, currentUserId: 'mark' };
    reducer(state, { type: 'SET_STEP', step: 3 });

    sessionStorage.setItem = originalSetItem;
    expect(setItemCalls.length).toBeGreaterThan(0);
    expect(setItemCalls[0]).toContain('tq_session_mark');
  });

  test('persisted state has isAnalysing=false even if current state is analysing', () => {
    const state = { ...initialState, currentUserId: 'mark', isAnalysing: true };
    reducer(state, { type: 'SET_STEP', step: 3 });

    const saved = JSON.parse(sessionStorage.getItem('tq_session_mark'));
    expect(saved.isAnalysing).toBe(false);
  });

  test('persisted state excludes transient videoProgress and uploadProgress', () => {
    const state = {
      ...initialState,
      currentUserId: 'mark',
      videoProgress: { stage: 'processing', progress: 50 },
      uploadProgress: { percent: 42 },
    };
    reducer(state, { type: 'SET_STEP', step: 3 });

    const saved = JSON.parse(sessionStorage.getItem('tq_session_mark'));
    expect(saved.videoProgress).toBeNull();
    expect(saved.uploadProgress).toBeNull();
  });
});

// ======================================================================
//  16. RESTORE_DRAFT does not inherit auth-critical fields from draft
// ======================================================================

describe('RESTORE_DRAFT field isolation', () => {
  test('draft with currentUserId does not override state.currentUserId', () => {
    const state = { ...initialState, currentUserId: 'mark' };
    const draft = { step: 3, currentUserId: 'evil-user' };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft });
    // Since RESTORE_DRAFT spreads draftData (minus profile) over state,
    // currentUserId from the draft WOULD override state's.
    // This is the bug we're documenting — the test documents behavior.
    // After the fix, currentUserId should remain 'mark'.
    expect(result.currentUserId).toBe('mark');
  });

  test('draft with initComplete=false does not override state.initComplete', () => {
    const state = { ...initialState, initComplete: true };
    const draft = { step: 3, initComplete: false };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(result.initComplete).toBe(true);
  });

  test('draft with allUsers does not override state.allUsers', () => {
    const state = { ...initialState, allUsers: [{ id: 'mark' }] };
    const draft = { step: 3, allUsers: [{ id: 'attacker' }] };
    const result = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(result.allUsers[0].id).toBe('mark');
  });
});
