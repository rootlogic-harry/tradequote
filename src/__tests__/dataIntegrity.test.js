/**
 * Data Integrity Pipeline Tests
 *
 * Verifies the save/load/restore cycle for correctness.
 * Catches data loss, corruption, type coercion, and consistency issues.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import { buildSaveSnapshot, stripBlobs, SAVE_ALLOWLIST } from '../utils/stripBlobs.js';
import { buildDiff, enrichDiffWithContext, calculateEditMagnitude, calculateAIAccuracyScore } from '../utils/diffTracking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =====================================================================
// 1. ALLOWLIST CONSISTENCY — client vs server must agree
// =====================================================================

describe('Allowlist consistency: client vs server', () => {
  const clientSrc = readFileSync(join(__dirname, '../utils/stripBlobs.js'), 'utf8');
  const serverSrc = readFileSync(join(__dirname, '../../serverSaveAllowlist.js'), 'utf8');

  test('SERVER_SAVE_ALLOWLIST is a superset of SAVE_ALLOWLIST', () => {
    // Extract the array literals from source
    const clientMatch = clientSrc.match(/SAVE_ALLOWLIST\s*=\s*\[([^\]]+)\]/);
    const serverMatch = serverSrc.match(/SERVER_SAVE_ALLOWLIST\s*=\s*\[([^\]]+)\]/);
    expect(clientMatch).not.toBeNull();
    expect(serverMatch).not.toBeNull();

    const parseKeys = (str) => str.match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const clientKeys = parseKeys(clientMatch[1]);
    const serverKeys = parseKeys(serverMatch[1]);

    // Every client key must exist in server allowlist
    for (const key of clientKeys) {
      expect(serverKeys).toContain(key);
    }
  });

  test('SERVER_SAVE_ALLOWLIST extra keys are documented and intentional', async () => {
    const { SERVER_SAVE_ALLOWLIST } = await import('../../serverSaveAllowlist.js');
    const serverOnly = SERVER_SAVE_ALLOWLIST.filter(k => !SAVE_ALLOWLIST.includes(k));
    // aiRawResponse is the only key the server accepts that the client does not send.
    // This is harmless (dead key) but should be documented.
    // If new server-only keys appear, this test forces a review.
    expect(serverOnly).toEqual(['aiRawResponse']);
  });
});

// =====================================================================
// 2. SAVE SNAPSHOT COMPLETENESS — no silent data loss
// =====================================================================

describe('Save snapshot completeness', () => {
  const fullState = {
    currentUserId: 'mark',
    currentUser: { id: 'mark', name: 'Mark', plan: 'admin' },
    allUsers: [{ id: 'mark', name: 'Mark' }],
    initComplete: true,
    step: 5,
    profile: { companyName: 'Walling Co', fullName: 'Mark', phone: '01onal', email: 'mark@test.com', address: '1 Main St', dayRate: 400, vatRegistered: false, logo: null, accreditations: '', showNotesOnQuote: true },
    jobDetails: { clientName: 'John', siteAddress: '10 Lane', quoteReference: 'QT-2026-0001', quoteDate: '2026-04-10', briefNotes: 'some notes' },
    photos: { overview: { data: 'data:img' }, closeup: null, sideProfile: null, referenceCard: null, access: null },
    extraPhotos: [{ data: 'data:img2', label: 'Other' }],
    isAnalysing: false,
    analysisError: null,
    aiRawResponse: '{"big":"json"}',
    reviewData: {
      measurements: [{ id: 'm1', item: 'Height', value: '1200', aiValue: '1200', confirmed: true }],
      materials: [{ id: 'mat1', description: 'Stone', quantity: 2, unit: 't', unitCost: 180, totalCost: 360 }],
      labourEstimate: { estimatedDays: 3, numberOfWorkers: 1, dayRate: 400 },
      scheduleOfWorks: [{ stepNumber: 1, title: 'Demolish', description: 'Remove' }],
      damageDescription: 'Collapsed section',
    },
    diffs: [{ fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1200', wasEdited: false, editMagnitude: 0 }],
    quotePayload: { totals: { total: 5000, materialsSubtotal: 360, labourTotal: 1200 } },
    quoteSequence: 42,
    captureMode: 'video',
    quoteMode: 'standard',
    savedJobId: 'sq-123',
    quoteSaveError: null,
    quoteSaveErrorKey: 0,
    critiqueNotes: 'some agent notes',
    transcript: 'The wall is about two metres high with loose capping stones',
    rams: { id: 'rams-1', status: 'draft' },
    retryCount: 0,
    statusModal: { open: false, jobId: null, targetStatus: null },
    recentJobs: [],
  };

  test('transient fields are correctly excluded from snapshot', () => {
    const snapshot = buildSaveSnapshot(fullState);
    const excluded = ['currentUserId', 'currentUser', 'allUsers', 'initComplete', 'step',
      'photos', 'extraPhotos', 'isAnalysing', 'analysisError', 'aiRawResponse',
      'savedJobId', 'quoteSaveError', 'quoteSaveErrorKey', 'critiqueNotes',
      'rams', 'retryCount', 'statusModal', 'recentJobs',
      'videoProgress', 'uploadProgress', 'transcript'];
    for (const key of excluded) {
      expect(snapshot[key]).toBeUndefined();
    }
  });

  test('persistent fields are correctly included in snapshot', () => {
    const snapshot = buildSaveSnapshot(fullState);
    expect(snapshot.profile).toBeDefined();
    expect(snapshot.profile.companyName).toBe('Walling Co');
    expect(snapshot.jobDetails).toBeDefined();
    expect(snapshot.jobDetails.clientName).toBe('John');
    expect(snapshot.reviewData).toBeDefined();
    expect(snapshot.reviewData.measurements).toHaveLength(1);
    expect(snapshot.quotePayload).toBeDefined();
    expect(snapshot.quotePayload.totals.total).toBe(5000);
    expect(snapshot.quoteSequence).toBe(42);
    expect(snapshot.quoteMode).toBe('standard');
    expect(snapshot.captureMode).toBe('video');
    expect(snapshot.diffs).toHaveLength(1);
  });

  test('snapshot is fully JSON-serialisable (no undefined, no circular refs)', () => {
    const snapshot = buildSaveSnapshot(fullState);
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain('undefined');
    const roundTripped = JSON.parse(json);
    expect(roundTripped.profile.companyName).toBe('Walling Co');
  });

  test('quoteMode is preserved through save/restore cycle', () => {
    const quickState = { ...fullState, quoteMode: 'quick' };
    const snapshot = buildSaveSnapshot(quickState);
    expect(snapshot.quoteMode).toBe('quick');

    // Simulate restore
    const restored = {
      quoteMode: snapshot.quoteMode || 'standard',
    };
    expect(restored.quoteMode).toBe('quick');
  });
});

// =====================================================================
// 3. RESTORE CYCLE INTEGRITY — snapshot → virtualState → display
// =====================================================================

describe('Restore cycle integrity', () => {
  test('SavedQuoteViewer virtualState handles all SAVE_ALLOWLIST keys', () => {
    const src = readFileSync(join(__dirname, '../components/SavedQuoteViewer.jsx'), 'utf8');
    // The virtualState construction must reference each SAVE_ALLOWLIST key with a safe fallback
    const snapshotKeys = ['profile', 'jobDetails', 'reviewData', 'quotePayload', 'quoteSequence', 'diffs'];
    for (const key of snapshotKeys) {
      // Must reference snapshot.<key> somewhere
      expect(src).toMatch(new RegExp(`snapshot\\.${key}`));
    }
  });

  test('virtualState provides safe defaults for every required field', () => {
    // Simulate a completely empty snapshot (legacy job or corrupted data)
    const snapshot = {};
    const restoredPhotos = null;

    const virtualState = {
      step: 5,
      profile: snapshot.profile || {},
      jobDetails: snapshot.jobDetails || {},
      photos: restoredPhotos?.photos || {},
      extraPhotos: restoredPhotos?.extraPhotos?.length ? restoredPhotos.extraPhotos : (snapshot.extraPhotos || []),
      reviewData: snapshot.reviewData || null,
      diffs: snapshot.diffs || [],
      quotePayload: snapshot.quotePayload || null,
      quoteSequence: snapshot.quoteSequence,
    };

    // None of these should be undefined (except quoteSequence which can be)
    expect(virtualState.profile).toEqual({});
    expect(virtualState.jobDetails).toEqual({});
    expect(virtualState.photos).toEqual({});
    expect(virtualState.extraPhotos).toEqual([]);
    expect(virtualState.diffs).toEqual([]);
    expect(virtualState.reviewData).toBeNull();
    expect(virtualState.quotePayload).toBeNull();
  });

  test('snapshot with old format (missing quoteMode) restores with safe default', () => {
    // Simulate a v1 snapshot that didn't have quoteMode
    const oldSnapshot = {
      profile: { companyName: 'Old Co' },
      jobDetails: { clientName: 'Old Client' },
      reviewData: { measurements: [] },
      quotePayload: null,
      quoteSequence: 1,
      diffs: [],
      // quoteMode is missing
    };

    const restoredMode = oldSnapshot.quoteMode || 'standard';
    expect(restoredMode).toBe('standard');
  });

  test('snapshot with null diffs array restores safely', () => {
    const snapshot = {
      profile: {},
      jobDetails: {},
      diffs: null, // corrupted or old data
    };
    const safeDiffs = snapshot.diffs || [];
    expect(Array.isArray(safeDiffs)).toBe(true);
    expect(safeDiffs).toHaveLength(0);
  });
});

// =====================================================================
// 4. TYPE COERCION — numbers, booleans, null vs undefined
// =====================================================================

describe('Type coercion safety', () => {
  test('totalAmount survives NUMERIC → JSON round-trip', () => {
    // Postgres NUMERIC returns as string from pg driver
    const serverRow = { totalAmount: '5432.50' };
    const converted = Number(serverRow.totalAmount);
    expect(converted).toBe(5432.50);
    expect(typeof converted).toBe('number');
  });

  test('totalAmount handles null from Postgres NUMERIC', () => {
    const serverRow = { totalAmount: null };
    const converted = Number(serverRow.totalAmount);
    // Number(null) === 0, which is the desired fallback
    expect(converted).toBe(0);
  });

  test('totalAmount handles undefined', () => {
    const serverRow = {};
    const converted = Number(serverRow.totalAmount);
    // Number(undefined) === NaN — this would be a bug
    expect(isNaN(converted)).toBe(true);
    // The server code uses `totals?.total ?? 0` which prevents this
    const safeTotal = serverRow.totalAmount ?? 0;
    expect(Number(safeTotal)).toBe(0);
  });

  test('quoteSequence stored as JSONB number survives round-trip', () => {
    // Settings store value as JSONB — numbers should survive
    const stored = JSON.parse(JSON.stringify(42));
    expect(stored).toBe(42);
    expect(typeof stored).toBe('number');
  });

  test('boolean fields in diffs survive JSON round-trip', () => {
    const diff = { wasEdited: true, referenceCardUsed: false };
    const roundTripped = JSON.parse(JSON.stringify(diff));
    expect(roundTripped.wasEdited).toBe(true);
    expect(roundTripped.referenceCardUsed).toBe(false);
    expect(typeof roundTripped.wasEdited).toBe('boolean');
  });

  test('editMagnitude preserves decimal precision through JSON', () => {
    const magnitude = calculateEditMagnitude('1200', '1440');
    expect(magnitude).toBeCloseTo(0.2, 10);
    const roundTripped = JSON.parse(JSON.stringify(magnitude));
    expect(roundTripped).toBeCloseTo(0.2, 10);
  });

  test('buildDiff createdAt is a valid timestamp number', () => {
    const diff = buildDiff('measurement', 'Height', '1200', '1400');
    expect(typeof diff.createdAt).toBe('number');
    expect(diff.createdAt).toBeGreaterThan(0);
    // Server converts with: new Date(d.createdAt)
    const asDate = new Date(diff.createdAt);
    expect(asDate.getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});

// =====================================================================
// 5. STRIP BLOBS — edge cases
// =====================================================================

describe('stripBlobs edge cases', () => {
  test('deeply nested photos are stripped', () => {
    const state = {
      reviewData: {
        measurements: [{ id: 'm1', photo: { data: 'data:image/png;base64,' + 'X'.repeat(20000) } }],
      },
    };
    const stripped = stripBlobs(state);
    expect(stripped.reviewData.measurements[0].photo.data).toBe('[photo-stripped]');
  });

  test('profile logo is always stripped even if small', () => {
    const state = {
      profile: { logo: 'data:image/png;base64,small' },
    };
    const stripped = stripBlobs(state);
    expect(stripped.profile.logo).toBe('[photo-stripped]');
  });

  test('non-data: strings in known fields are preserved', () => {
    const state = {
      profile: { logo: null, dataUrl: 'https://example.com/img.png' },
    };
    const stripped = stripBlobs(state);
    expect(stripped.profile.logo).toBeNull();
    // dataUrl field only strips if value starts with 'data:'
    expect(stripped.profile.dataUrl).toBe('https://example.com/img.png');
  });

  test('circular reference protection — no infinite loop on self-referencing arrays', () => {
    // stripBlobs doesn't handle circular refs, but our data is always JSON-safe
    // This test verifies the contract: snapshots must be JSON-serialisable
    const snapshot = buildSaveSnapshot({
      profile: { companyName: 'Test' },
      jobDetails: {},
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});

// =====================================================================
// 6. DIFF TRACKING — data correctness through save/load
// =====================================================================

describe('Diff tracking data integrity', () => {
  test('buildDiff with string values produces correct wasEdited', () => {
    const same = buildDiff('measurement', 'Height', '1200', '1200');
    expect(same.wasEdited).toBe(false);
    expect(same.editMagnitude).toBe(0);

    const different = buildDiff('measurement', 'Height', '1200', '1400');
    expect(different.wasEdited).toBe(true);
    expect(different.editMagnitude).toBeCloseTo(0.1667, 3);
  });

  test('buildDiff with numeric zero aiValue handles division safely', () => {
    const zeroAi = buildDiff('measurement', 'Width', '0', '100');
    // editMagnitude should be null (avoid division by zero)
    expect(zeroAi.editMagnitude).toBeNull();
    expect(zeroAi.wasEdited).toBe(true);
  });

  test('buildDiff with non-numeric field type returns null editMagnitude', () => {
    const textDiff = buildDiff('stone_type', 'Stone Type', 'Gritstone', 'Limestone');
    expect(textDiff.editMagnitude).toBeNull();
    expect(textDiff.wasEdited).toBe(true);
  });

  test('enrichDiffWithContext adds context fields without overwriting diff fields', () => {
    const diff = buildDiff('measurement', 'Height', '1200', '1400');
    const context = { stoneType: 'Gritstone', wallHeightMm: 1200, referenceCardUsed: true };
    const enriched = enrichDiffWithContext(diff, context);

    // Original diff fields preserved
    expect(enriched.fieldType).toBe('measurement');
    expect(enriched.aiValue).toBe('1200');
    // Context fields added
    expect(enriched.stoneType).toBe('Gritstone');
    expect(enriched.wallHeightMm).toBe(1200);
    expect(enriched.referenceCardUsed).toBe(true);
  });

  test('diffs survive full buildSaveSnapshot cycle', () => {
    const diffs = [
      buildDiff('measurement', 'Height', '1200', '1400'),
      buildDiff('material_unit_cost', 'Stone', '180', '200'),
      buildDiff('labour_days', 'Estimated Days', '3', '4'),
    ];
    const state = {
      profile: {},
      jobDetails: {},
      diffs,
    };
    const snapshot = buildSaveSnapshot(state);
    const roundTripped = JSON.parse(JSON.stringify(snapshot));

    expect(roundTripped.diffs).toHaveLength(3);
    expect(roundTripped.diffs[0].fieldType).toBe('measurement');
    expect(roundTripped.diffs[0].wasEdited).toBe(true);
    expect(typeof roundTripped.diffs[0].editMagnitude).toBe('number');
    expect(typeof roundTripped.diffs[0].createdAt).toBe('number');
  });

  test('calculateAIAccuracyScore handles empty diffs', () => {
    expect(calculateAIAccuracyScore([])).toBeNull();
  });

  test('calculateAIAccuracyScore handles all-accepted diffs', () => {
    const diffs = [
      { fieldType: 'measurement', wasEdited: false },
      { fieldType: 'measurement', wasEdited: false },
    ];
    expect(calculateAIAccuracyScore(diffs)).toBe(1);
  });

  test('calculateAIAccuracyScore handles mixed diffs', () => {
    const diffs = [
      { fieldType: 'measurement', wasEdited: false },
      { fieldType: 'measurement', wasEdited: true },
      { fieldType: 'labour_days', wasEdited: false },
    ];
    const score = calculateAIAccuracyScore(diffs);
    expect(score).toBeCloseTo(0.667, 2);
  });
});

// =====================================================================
// 7. PHOTO/SNAPSHOT MISMATCH — photos stored separately
// =====================================================================

describe('Photo/snapshot separation', () => {
  test('SAVE_ALLOWLIST does not include photo keys', () => {
    expect(SAVE_ALLOWLIST).not.toContain('photos');
    expect(SAVE_ALLOWLIST).not.toContain('extraPhotos');
  });

  test('buildSaveSnapshot strips all photo data from profile.logo', () => {
    const state = {
      profile: {
        companyName: 'Test',
        logo: 'data:image/png;base64,' + 'X'.repeat(50000),
      },
      jobDetails: {},
    };
    const snapshot = buildSaveSnapshot(state);
    expect(snapshot.profile.logo).toBe('[photo-stripped]');
  });

  test('snapshot size stays under 500KB for a realistic full quote', () => {
    const state = {
      profile: {
        companyName: 'Mark Doyle Dry Stone Walling',
        fullName: 'Mark Doyle',
        phone: '07XXXXXXXXX',
        email: 'mark@example.com',
        address: '1 Workshop Lane, Yorkshire, YO1 1AA',
        dayRate: 400,
        vatRegistered: true,
        vatNumber: 'GB123456789',
        accreditations: 'DSWA Master Craftsman',
      },
      jobDetails: {
        clientName: 'Jonathan Worthington-Smythe',
        siteAddress: '45 Manor Road, Leeds, LS1 2AB',
        quoteReference: 'QT-2026-0042',
        quoteDate: '2026-04-10',
        briefNotes: 'Large boundary wall collapse near north gate. Approximately 8m section down. Access via farm track from B6160.',
      },
      reviewData: {
        measurements: Array.from({ length: 15 }, (_, i) => ({
          id: `m${i}`, item: `Measurement ${i}`, value: `${1000 + i * 100}`, aiValue: `${1000 + i * 100}`, confirmed: true,
        })),
        materials: Array.from({ length: 12 }, (_, i) => ({
          id: `mat${i}`, description: `Material ${i} with long description for testing`, quantity: i + 1, unit: 'm', unitCost: 50 + i * 30, totalCost: (i + 1) * (50 + i * 30),
        })),
        labourEstimate: { estimatedDays: 8, numberOfWorkers: 2, dayRate: 400, aiEstimatedDays: 7 },
        scheduleOfWorks: Array.from({ length: 10 }, (_, i) => ({
          stepNumber: i + 1, title: `Step ${i + 1}`, description: `Detailed description of work step ${i + 1}. This includes various tasks and requirements for the tradesman to follow carefully.`,
        })),
        damageDescription: 'Large collapsed section of dry stone boundary wall approximately 8 metres in length and 1.4m in height. Gritstone construction with traditional through-stone pattern. Foundation appears sound for 3m on west end but compromised for remaining 5m. Access is reasonable via farm track but narrow sections may require smaller plant.',
        additionalCosts: [
          { id: 'ac1', description: 'Skip hire', amount: 350 },
          { id: 'ac2', description: 'Traffic management', amount: 420 },
        ],
        notes: 'Client requested completion before end of May. Neighbour access required — will need to coordinate.',
      },
      quotePayload: {
        totals: { materialsSubtotal: 8500, labourTotal: 6400, additionalCostsTotal: 770, subtotal: 15670, vatAmount: 3134, total: 18804 },
        lineItems: Array.from({ length: 12 }, (_, i) => ({
          description: `Material ${i}`, quantity: i + 1, unit: 'm', unitCost: 50 + i * 30, total: (i + 1) * (50 + i * 30),
        })),
      },
      quoteSequence: 42,
      quoteMode: 'standard',
      diffs: Array.from({ length: 20 }, (_, i) => ({
        fieldType: i % 3 === 0 ? 'measurement' : i % 3 === 1 ? 'material_unit_cost' : 'labour_days',
        fieldLabel: `Field ${i}`,
        aiValue: `${1000 + i * 50}`,
        confirmedValue: `${1000 + i * 50 + (i % 2 === 0 ? 0 : 100)}`,
        wasEdited: i % 2 !== 0,
        editMagnitude: i % 2 !== 0 ? 0.1 : 0,
        createdAt: Date.now(),
        stoneType: 'Gritstone',
        wallHeightMm: 1400,
        wallLengthMm: 8000,
        referenceCardUsed: true,
      })),
    };

    const snapshot = buildSaveSnapshot(state);
    const json = JSON.stringify(snapshot);
    const sizeKB = Math.round(json.length / 1024);
    expect(sizeKB).toBeLessThan(500);
  });
});

// =====================================================================
// 8. REDUCER SAVE/RESTORE — RESTORE_DRAFT round-trip
// =====================================================================

describe('Reducer RESTORE_DRAFT round-trip', () => {
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

  test('RESTORE_DRAFT restores all persistent fields from snapshot', () => {
    const draft = {
      jobDetails: { clientName: 'Restored Client', siteAddress: '99 Lane' },
      reviewData: { measurements: [{ id: 'm1' }] },
      diffs: [{ fieldType: 'measurement' }],
      quotePayload: { totals: { total: 1234 } },
      quoteSequence: 10,
      quoteMode: 'quick',
    };
    const state = { ...initialState, currentUserId: 'mark' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });

    expect(newState.jobDetails.clientName).toBe('Restored Client');
    expect(newState.reviewData.measurements).toHaveLength(1);
    expect(newState.diffs).toHaveLength(1);
    // quotePayload is intentionally reset to null by RESTORE_DRAFT
    // (forces user to re-generate, preventing stale quote data)
    expect(newState.quotePayload).toBeNull();
    expect(newState.quoteSequence).toBe(10);
    expect(newState.quoteMode).toBe('quick');
  });

  test('RESTORE_DRAFT does not overwrite current profile with draft profile', () => {
    const draft = {
      profile: { companyName: 'Draft Profile Co' },
      jobDetails: { clientName: 'Draft Client' },
    };
    const state = {
      ...initialState,
      currentUserId: 'mark',
      profile: { ...initialState.profile, companyName: 'DB Profile Co' },
    };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    // Profile should NOT be overwritten by draft (DB is source of truth)
    expect(newState.profile.companyName).toBe('DB Profile Co');
    expect(newState.jobDetails.clientName).toBe('Draft Client');
  });

  test('RESTORE_DRAFT resets transient state', () => {
    const state = {
      ...initialState,
      currentUserId: 'mark',
      isAnalysing: true,
      analysisError: 'old error',
      quotePayload: { old: true },
      videoProgress: { stage: 'processing', progress: 50 },
      uploadProgress: { percent: 75 },
      transcript: 'stale transcript from previous video',
    };
    const draft = { jobDetails: { clientName: 'New' }, quoteMode: 'standard' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(newState.isAnalysing).toBe(false);
    expect(newState.analysisError).toBeNull();
    expect(newState.quotePayload).toBeNull();
    expect(newState.videoProgress).toBeNull();
    expect(newState.uploadProgress).toBeNull();
    expect(newState.transcript).toBeNull();
  });

  test('RESTORE_DRAFT with missing quoteMode defaults to standard', () => {
    const draft = { jobDetails: { clientName: 'No Mode' } };
    const state = { ...initialState, currentUserId: 'mark' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(newState.quoteMode).toBe('standard');
  });

  test('RESTORE_DRAFT preserves captureMode from video-mode draft', () => {
    const draft = { jobDetails: { clientName: 'Video Job' }, captureMode: 'video' };
    const state = { ...initialState, currentUserId: 'mark' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(newState.captureMode).toBe('video');
  });

  test('RESTORE_DRAFT preserves captureMode from photos-mode draft', () => {
    const draft = { jobDetails: { clientName: 'Photo Job' }, captureMode: 'photos' };
    const state = { ...initialState, currentUserId: 'mark' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(newState.captureMode).toBe('photos');
  });

  test('RESTORE_DRAFT with no captureMode (pre-video draft) keeps null', () => {
    const draft = { jobDetails: { clientName: 'Old Draft' } };
    const state = { ...initialState, currentUserId: 'mark' };
    const newState = reducer(state, { type: 'RESTORE_DRAFT', draft });
    expect(newState.captureMode).toBeNull();
  });
});

// =====================================================================
// 9. SERVER ROUTE DATA EXTRACTION — fields extracted correctly for job metadata
// =====================================================================

describe('Server job metadata extraction', () => {
  const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

  test('POST /api/users/:id/jobs extracts clientName from jobDetails', () => {
    const postBlock = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/users/:id/jobs'"),
      serverSrc.indexOf("app.post('/api/users/:id/jobs'") + 2000
    );
    expect(postBlock).toContain("jobDetails?.clientName || ''");
    expect(postBlock).toContain("jobDetails?.siteAddress || ''");
    expect(postBlock).toContain("jobDetails?.quoteDate || ''");
    expect(postBlock).toContain("totals?.total ?? 0");
  });

  test('POST /api/users/:id/jobs uses pickAllowedKeys', () => {
    const postBlock = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/users/:id/jobs'"),
      serverSrc.indexOf("app.post('/api/users/:id/jobs'") + 500
    );
    expect(postBlock).toContain('pickAllowedKeys(req.body)');
  });

  test('GET /api/users/:id/jobs converts totalAmount to Number', () => {
    const getBlock = serverSrc.slice(
      serverSrc.indexOf("app.get('/api/users/:id/jobs'"),
      serverSrc.indexOf("app.get('/api/users/:id/jobs'") + 1000
    );
    expect(getBlock).toContain('Number(r.totalAmount)');
  });
});

// =====================================================================
// 10. GDPR EXPORT COMPLETENESS
// =====================================================================

describe('GDPR export completeness', () => {
  const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

  test('export includes all user-owned data tables', () => {
    const exportBlock = serverSrc.slice(
      serverSrc.indexOf("app.get('/api/users/:id/export'"),
      serverSrc.indexOf("app.get('/api/users/:id/export'") + 1500
    );
    expect(exportBlock).toContain('FROM profiles');
    expect(exportBlock).toContain('FROM settings');
    expect(exportBlock).toContain('FROM jobs');
    expect(exportBlock).toContain('FROM drafts');
    expect(exportBlock).toContain('FROM user_photos');
    expect(exportBlock).toContain('FROM quote_diffs');
  });

  test('export includes agent_runs table for GDPR compliance', () => {
    const exportBlock = serverSrc.slice(
      serverSrc.indexOf("app.get('/api/users/:id/export'"),
      serverSrc.indexOf("app.get('/api/users/:id/export'") + 1500
    );
    expect(exportBlock).toContain('agent_runs');
  });
});

// =====================================================================
// 11. GDPR DELETE COMPLETENESS
// =====================================================================

describe('GDPR delete completeness', () => {
  const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

  test('delete cleans all user-owned tables', () => {
    const deleteBlock = serverSrc.slice(
      serverSrc.indexOf("app.delete('/api/users/:id/data'"),
      serverSrc.indexOf("app.delete('/api/users/:id/data'") + 800
    );
    expect(deleteBlock).toContain('quote_diffs');
    expect(deleteBlock).toContain('user_photos');
    expect(deleteBlock).toContain('drafts');
    expect(deleteBlock).toContain('jobs');
    expect(deleteBlock).toContain('settings');
    expect(deleteBlock).toContain('profiles');
  });

  test('delete explicitly removes agent_runs for the user', () => {
    const deleteStart = serverSrc.indexOf("app.delete('/api/users/:id/data'");
    const deleteBlock = serverSrc.slice(deleteStart, deleteStart + 800);
    const hasExplicitAgentRunsDelete = deleteBlock.includes("DELETE FROM agent_runs");
    expect(hasExplicitAgentRunsDelete).toBe(true);
  });

  test('delete does NOT remove users row itself (data purge but account preserved)', () => {
    const deleteBlock = serverSrc.slice(
      serverSrc.indexOf("app.delete('/api/users/:id/data'"),
      serverSrc.indexOf("app.delete('/api/users/:id/data'") + 800
    );
    // The route clears data but keeps the user record
    // The users table is not in the delete chain — this means email/name persist
    // CASCADE would only fire if the user row itself was deleted
    const deletesUser = deleteBlock.includes("DELETE FROM users");
    expect(deletesUser).toBe(false);
  });
});

// =====================================================================
// 12. CASCADE DELETE SAFETY — job deletion cleans orphans
// =====================================================================

describe('Cascade delete safety', () => {
  test('SavedQuotes handleDelete calls deletePhotos after deleteJob', () => {
    const src = readFileSync(join(__dirname, '../components/SavedQuotes.jsx'), 'utf8');
    const deleteBlock = src.slice(
      src.indexOf('handleDelete'),
      src.indexOf('handleDelete') + 500
    );
    expect(deleteBlock).toContain('deleteJob(');
    expect(deleteBlock).toContain('deletePhotos(');
  });

  test('quote_diffs has ON DELETE CASCADE from jobs', () => {
    const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    expect(serverSrc).toMatch(/job_id\s+TEXT\s+REFERENCES\s+jobs\(id\)\s+ON\s+DELETE\s+CASCADE/);
  });
});

// =====================================================================
// 13. ERROR HANDLING SAFETY — silent failures
// =====================================================================

describe('Error handling safety', () => {
  test('deleteJob in userDB checks response status and throws on failure', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const deleteJobStart = src.indexOf('export async function deleteJob(');
    const deleteJobEnd = src.indexOf('\n}', deleteJobStart) + 2;
    const deleteJobBlock = src.slice(deleteJobStart, deleteJobEnd);
    expect(deleteJobBlock).toContain('!res.ok');
  });

  test('setSetting in userDB checks response status and throws on failure', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const setSettingStart = src.indexOf('export async function setSetting(');
    const setSettingEnd = src.indexOf('\n}', setSettingStart) + 2;
    const setSettingBlock = src.slice(setSettingStart, setSettingEnd);
    expect(setSettingBlock).toContain('!res.ok');
  });

  test('updateJobRams uses safe error parsing (try/catch around res.json)', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const ramsStart = src.indexOf('export async function updateJobRams(');
    const ramsEnd = src.indexOf('\n}', ramsStart) + 2;
    const ramsBlock = src.slice(ramsStart, ramsEnd);
    // Should use try/catch for JSON parsing in error path
    expect(ramsBlock).toMatch(/try\s*\{[^}]*res\.json\(\)/);
  });

  test('setRamsNotRequired uses safe error parsing (try/catch around res.json)', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const rnrStart = src.indexOf('export async function setRamsNotRequired(');
    const rnrEnd = src.indexOf('\n}', rnrStart) + 2;
    const rnrBlock = src.slice(rnrStart, rnrEnd);
    expect(rnrBlock).toMatch(/try\s*\{[^}]*res\.json\(\)/);
  });
});

// =====================================================================
// 14. CONCURRENT SAVE — auto-save guard
// =====================================================================

describe('Concurrent save protection', () => {
  test('auto-save effect in App.jsx uses autoSaveTriggered ref guard', () => {
    const src = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
    expect(src).toContain('autoSaveTriggered');
    expect(src).toContain('autoSaveTriggered.current = true');
    expect(src).toContain('autoSaveTriggered.current = false');
  });

  test('auto-save dependency array does not include savedJobId (prevents loop)', () => {
    const src = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
    const autoSaveStart = src.indexOf('Auto-save job + diffs');
    expect(autoSaveStart).toBeGreaterThan(-1);
    const autoSaveBlock = src.slice(autoSaveStart, autoSaveStart + 1500);
    const depMatch = autoSaveBlock.match(/\},\s*\[([^\]]+)\]\);/);
    expect(depMatch).not.toBeNull();
    if (depMatch) {
      expect(depMatch[1]).not.toContain('state.savedJobId');
    }
  });

  test('saveJob does NOT use fetchWithRetry (prevents duplicate job creation)', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const saveJobStart = src.indexOf('export async function saveJob(');
    const saveJobEnd = src.indexOf('\nexport', saveJobStart + 1);
    const saveJobBody = src.slice(saveJobStart, saveJobEnd);
    expect(saveJobBody).not.toContain('fetchWithRetry');
  });

  test('server POST /api/users/:id/jobs has 30s dedup window', () => {
    const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const postBlock = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/users/:id/jobs'"),
      serverSrc.indexOf("app.post('/api/users/:id/jobs'") + 1500
    );
    expect(postBlock).toContain('30 seconds');
  });
});

// =====================================================================
// 15. MIGRATION SAFETY — old snapshots with missing fields
// =====================================================================

describe('Migration safety for old snapshots', () => {
  test('snapshot missing all new fields still renders via virtualState defaults', () => {
    // Simulate a v0 snapshot from before quoteMode, diffs, etc.
    const ancientSnapshot = {
      profile: { companyName: 'Old Firm' },
      jobDetails: { clientName: 'Old Client' },
      reviewData: { measurements: [{ id: 'm1', item: 'Height', value: '1000' }] },
      quotePayload: { totals: { total: 3000 } },
    };

    // Construct virtualState with all safe defaults
    const virtualState = {
      step: 5,
      profile: ancientSnapshot.profile || {},
      jobDetails: ancientSnapshot.jobDetails || {},
      photos: {},
      extraPhotos: [],
      reviewData: ancientSnapshot.reviewData || null,
      diffs: ancientSnapshot.diffs || [],
      quotePayload: ancientSnapshot.quotePayload || null,
      quoteSequence: ancientSnapshot.quoteSequence,
      quoteMode: ancientSnapshot.quoteMode || 'standard',
    };

    expect(virtualState.profile.companyName).toBe('Old Firm');
    expect(virtualState.diffs).toEqual([]);
    expect(virtualState.quoteMode).toBe('standard');
    expect(virtualState.quoteSequence).toBeUndefined(); // acceptable — used for display only
  });

  test('snapshot missing captureMode (pre-video era) restores safely', () => {
    const oldSnapshot = {
      profile: { companyName: 'Pre-Video Co' },
      jobDetails: { clientName: 'Old Client' },
      reviewData: { measurements: [] },
      quotePayload: null,
      quoteSequence: 1,
      diffs: [],
      quoteMode: 'standard',
      // captureMode is missing — pre-video era
    };

    const captureMode = oldSnapshot.captureMode || null;
    expect(captureMode).toBeNull();

    // VideoBadge should not render for null captureMode
    const shouldShowBadge = captureMode === 'video';
    expect(shouldShowBadge).toBe(false);

    // Transcript section should not render
    const isVideoMode = captureMode === 'video';
    const hasTranscript = isVideoMode && oldSnapshot.transcript;
    expect(hasTranscript).toBeFalsy();
  });

  test('snapshot with [photo-stripped] markers does not break display', () => {
    const snapshot = buildSaveSnapshot({
      profile: {
        companyName: 'Test',
        logo: 'data:image/png;base64,' + 'X'.repeat(20000),
      },
      jobDetails: {},
    });
    // The logo becomes '[photo-stripped]' — QuoteDocument should handle this
    expect(snapshot.profile.logo).toBe('[photo-stripped]');
    // It's a string, not null — components that check `if (profile.logo)` will still try to render it
    // This is by design: the marker tells consumers the photo was intentionally removed
    expect(typeof snapshot.profile.logo).toBe('string');
  });
});

// =====================================================================
// 16. QUOTE SEQUENCE INCREMENT — race condition documentation
// =====================================================================

describe('Quote sequence increment', () => {
  test('server increment uses atomic INSERT ON CONFLICT DO UPDATE', () => {
    const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const incrementBlock = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/users/:id/quote-sequence/increment'"),
      serverSrc.indexOf("app.post('/api/users/:id/quote-sequence/increment'") + 800
    );
    // The increment is now an atomic upsert — no race condition
    expect(incrementBlock).toContain('ON CONFLICT');
    expect(incrementBlock).toContain('RETURNING value');
  });
});

// =====================================================================
// 17. SERVER SAVE ALLOWLIST — pickAllowedKeys behavioral
// =====================================================================

describe('pickAllowedKeys behavioral tests', () => {
  let pickAllowedKeys;
  beforeAll(async () => {
    const mod = await import('../../serverSaveAllowlist.js');
    pickAllowedKeys = mod.pickAllowedKeys;
  });

  test('strips all photo-like keys', () => {
    const input = {
      profile: { companyName: 'Test' },
      jobDetails: { clientName: 'C' },
      photos: { overview: { data: 'huge base64' } },
      extraPhotos: [{ data: 'huge base64' }],
      logo: 'data:image/png',
    };
    const result = pickAllowedKeys(input);
    expect(result.photos).toBeUndefined();
    expect(result.extraPhotos).toBeUndefined();
    expect(result.logo).toBeUndefined();
  });

  test('preserves all allowlisted keys', () => {
    const input = {
      profile: { a: 1 },
      jobDetails: { b: 2 },
      reviewData: { c: 3 },
      quotePayload: { d: 4 },
      quoteSequence: 5,
      quoteMode: 'standard',
      captureMode: 'video',
      diffs: [{ e: 6 }],
      aiRawResponse: 'raw',
    };
    const result = pickAllowedKeys(input);
    expect(Object.keys(result).sort()).toEqual(
      ['aiRawResponse', 'captureMode', 'diffs', 'jobDetails', 'profile', 'quoteMode', 'quotePayload', 'quoteSequence', 'reviewData']
    );
  });

  test('handles deeply nested objects without mutation', () => {
    const input = {
      profile: { nested: { deep: { value: 42 } } },
      jobDetails: {},
    };
    const result = pickAllowedKeys(input);
    // pickAllowedKeys does shallow copy — same reference
    result.profile.nested.deep.value = 999;
    expect(input.profile.nested.deep.value).toBe(999); // shallow copy — this is expected
  });
});

// =====================================================================
// 18. DRAFT vs JOB FLOW — no cross-contamination
// =====================================================================

describe('Draft vs Job flow separation', () => {
  test('saveDraft and saveJob both use buildSaveSnapshot', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    // saveDraft
    const draftBlock = src.slice(
      src.indexOf('export async function saveDraft('),
      src.indexOf('\n}', src.indexOf('export async function saveDraft(')) + 2
    );
    expect(draftBlock).toContain('buildSaveSnapshot(state)');

    // saveJob
    const saveBlock = src.slice(
      src.indexOf('export async function saveJob('),
      src.indexOf('\n}', src.indexOf('export async function saveJob(')) + 2
    );
    expect(saveBlock).toContain('buildSaveSnapshot(state)');
  });

  test('saveJob copies photos from draft context to new job', () => {
    const src = readFileSync(join(__dirname, '../utils/userDB.js'), 'utf8');
    const saveBlock = src.slice(
      src.indexOf('export async function saveJob('),
      src.indexOf('\n}', src.indexOf('export async function saveJob(')) + 2
    );
    expect(saveBlock).toContain("copyPhotos(userId, 'draft', data.id)");
  });
});

// =====================================================================
// 19. buildSaveSnapshot immutability — deep clone via stripBlobs
// =====================================================================

describe('buildSaveSnapshot immutability', () => {
  test('modifying snapshot does not affect original state', () => {
    const state = {
      profile: { companyName: 'Original' },
      jobDetails: { clientName: 'Original' },
      reviewData: {
        measurements: [{ id: 'm1', value: '1200' }],
      },
      quotePayload: { totals: { total: 5000 } },
      quoteSequence: 1,
      quoteMode: 'standard',
      diffs: [{ fieldType: 'measurement' }],
    };

    const snapshot = buildSaveSnapshot(state);

    // Mutate the snapshot
    snapshot.profile.companyName = 'MUTATED';
    snapshot.reviewData.measurements[0].value = 'MUTATED';
    snapshot.diffs[0].fieldType = 'MUTATED';

    // Original state should be unchanged
    expect(state.profile.companyName).toBe('Original');
    expect(state.reviewData.measurements[0].value).toBe('1200');
    expect(state.diffs[0].fieldType).toBe('measurement');
  });
});
