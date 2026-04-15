/**
 * Unit tests for userDB.js and userRegistry.js (fetch-based)
 *
 * These tests mock the global fetch to verify correct API calls
 * without requiring a running server.
 */

import { jest } from '@jest/globals';
import {
  getProfile, saveProfile,
  getSetting, setSetting,
  getTheme, setTheme,
  getQuoteSequence, incrementQuoteSequence,
  saveJob, updateJob, listJobs, getJob, deleteJob, updateJobRams,
  saveDraft, loadDraft, clearDraft,
  saveDiffs, updateJobStatus, setRamsNotRequired,
  deleteUserData, exportUserData,
  migrateFromLegacyDB,
  savePhoto, loadPhotos, deletePhotos, deletePhoto, copyPhotos,
} from '../utils/userDB.js';
import {
  bootstrapUsers, listUsers, getUser, addUser, deleteUser,
} from '../utils/userRegistry.js';

// Mock fetch globally
let fetchMock;
beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
  // Suppress localStorage errors in test env
  global.localStorage = { setItem: jest.fn(), removeItem: jest.fn() };
  global.sessionStorage = { removeItem: jest.fn() };
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockResponse(data, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

// --- User Registry ---

describe('userRegistry', () => {
  test('listUsers calls GET /api/users', async () => {
    fetchMock.mockReturnValue(mockResponse([
      { id: 'harry', name: 'Harry' },
      { id: 'mark', name: 'Mark' },
    ]));
    const users = await listUsers();
    expect(fetchMock).toHaveBeenCalledWith('/api/users');
    expect(users).toHaveLength(2);
  });

  test('getUser calls GET /api/users/:id', async () => {
    fetchMock.mockReturnValue(mockResponse({ id: 'mark', name: 'Mark' }));
    const user = await getUser('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark');
    expect(user.name).toBe('Mark');
  });

  test('getUser returns null on 404', async () => {
    fetchMock.mockReturnValue(mockResponse(null, false, 404));
    const user = await getUser('nobody');
    expect(user).toBeNull();
  });

  test('addUser calls POST /api/users', async () => {
    fetchMock.mockReturnValue(mockResponse({ id: 'test', name: 'Test' }));
    await addUser({ id: 'test', name: 'Test' });
    expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({
      method: 'POST',
    }));
  });

  test('deleteUser calls DELETE /api/users/:id', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await deleteUser('test');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/test', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('bootstrapUsers is a no-op', async () => {
    await bootstrapUsers();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- Profile ---

describe('profile', () => {
  test('getProfile calls GET and returns data', async () => {
    const profile = { companyName: 'Test Co', fullName: 'Mark' };
    fetchMock.mockReturnValue(mockResponse(profile));
    const loaded = await getProfile('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/profile');
    expect(loaded).toEqual(profile);
  });

  test('getProfile returns null on failure', async () => {
    fetchMock.mockReturnValue(mockResponse(null, false, 404));
    const loaded = await getProfile('nobody');
    expect(loaded).toBeNull();
  });

  test('saveProfile calls PUT', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await saveProfile('mark', { companyName: 'Test' });
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/profile', expect.objectContaining({
      method: 'PUT',
    }));
  });

  test('saveProfile throws on server error', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'DB error' }, false, 500));
    await expect(saveProfile('mark', { companyName: 'Test' }))
      .rejects.toThrow('DB error');
  });
});

// --- Settings ---

describe('settings', () => {
  test('getSetting calls GET', async () => {
    fetchMock.mockReturnValue(mockResponse('dark'));
    const val = await getSetting('mark', 'theme');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/settings/theme');
    expect(val).toBe('dark');
  });

  test('getSetting returns null when unset', async () => {
    fetchMock.mockReturnValue(mockResponse(null, false));
    const val = await getSetting('mark', 'missing');
    expect(val).toBeNull();
  });

  test('setSetting calls PUT', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await setSetting('mark', 'theme', 'dark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/settings/theme', expect.objectContaining({
      method: 'PUT',
    }));
  });
});

// --- Theme ---

describe('theme', () => {
  test('getTheme calls GET /api/users/:id/theme', async () => {
    fetchMock.mockReturnValue(mockResponse(null));
    const theme = await getTheme('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/theme');
    expect(theme).toBeNull();
  });

  test('setTheme calls PUT and writes to localStorage', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await setTheme('mark', 'dark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/theme', expect.objectContaining({
      method: 'PUT',
    }));
    expect(global.localStorage.setItem).toHaveBeenCalledWith('tq_theme_mark', 'dark');
  });
});

// --- Quote Sequence ---

describe('quoteSequence', () => {
  test('getQuoteSequence defaults to 1', async () => {
    fetchMock.mockReturnValue(mockResponse(1));
    const seq = await getQuoteSequence('mark');
    expect(seq).toBe(1);
  });

  test('incrementQuoteSequence returns next value', async () => {
    fetchMock.mockReturnValue(mockResponse(2));
    const val = await incrementQuoteSequence('mark');
    expect(val).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/quote-sequence/increment', expect.objectContaining({
      method: 'POST',
    }));
  });
});

// --- Jobs ---

describe('jobs', () => {
  test('saveJob calls POST and returns id', async () => {
    fetchMock.mockReturnValue(mockResponse({ id: 'sq-123' }));
    const id = await saveJob('mark', makeFakeState('Client'));
    expect(id).toBe('sq-123');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs', expect.objectContaining({
      method: 'POST',
    }));
  });

  test('saveJob throws on server error (500)', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Internal error' }, false, 500));
    await expect(saveJob('mark', makeFakeState('Client')))
      .rejects.toThrow('Internal error');
  });

  test('saveJob throws on 413 payload too large', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Request too large' }, false, 413));
    await expect(saveJob('mark', makeFakeState('Client')))
      .rejects.toThrow('Request too large');
  });

  test('saveJob throws when server returns no ID', async () => {
    fetchMock.mockReturnValue(mockResponse({}));
    await expect(saveJob('mark', makeFakeState('Client')))
      .rejects.toThrow('Server returned no job ID');
  });

  test('listJobs calls GET', async () => {
    fetchMock.mockReturnValue(mockResponse([{ id: 'sq-1', clientName: 'A' }]));
    const jobs = await listJobs('mark');
    expect(jobs).toHaveLength(1);
  });

  test('getJob calls GET with jobId', async () => {
    fetchMock.mockReturnValue(mockResponse({ id: 'sq-1', clientName: 'A' }));
    const job = await getJob('mark', 'sq-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1');
    expect(job.clientName).toBe('A');
  });

  test('getJob returns null on failure', async () => {
    fetchMock.mockReturnValue(mockResponse(null, false));
    const job = await getJob('mark', 'missing');
    expect(job).toBeNull();
  });

  test('deleteJob calls DELETE', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await deleteJob('mark', 'sq-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('updateJobRams calls PUT', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await updateJobRams('mark', 'sq-1', { id: 'rams-1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1/rams', expect.objectContaining({
      method: 'PUT',
    }));
  });

  test('updateJobRams throws on 404', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Job nonexistent not found' }, false, 404));
    await expect(updateJobRams('mark', 'nonexistent', {}))
      .rejects.toThrow('Job nonexistent not found');
  });
});

// --- Drafts ---

describe('drafts', () => {
  test('loadDraft calls GET', async () => {
    fetchMock.mockReturnValue(mockResponse(null));
    const draft = await loadDraft('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/drafts');
    expect(draft).toBeNull();
  });

  test('saveDraft calls PUT', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await saveDraft('mark', makeFakeState('Draft'));
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/drafts', expect.objectContaining({
      method: 'PUT',
    }));
  });

  test('saveDraft throws on server error', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Payload too large' }, false, 413));
    await expect(saveDraft('mark', makeFakeState('Draft')))
      .rejects.toThrow('Payload too large');
  });

  test('clearDraft calls DELETE', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await clearDraft('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/drafts', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

// --- GDPR ---

describe('GDPR', () => {
  test('deleteUserData calls API and cleans storage', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await deleteUserData('mark');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/data', expect.objectContaining({
      method: 'DELETE',
    }));
    expect(global.localStorage.removeItem).toHaveBeenCalledWith('tq_theme_mark');
    expect(global.sessionStorage.removeItem).toHaveBeenCalledWith('tq_session_mark');
  });

  test('exportUserData calls GET', async () => {
    const exportData = { userId: 'mark', exportedAt: '2026-03-15', profile: [], jobs: [], drafts: [], settings: [] };
    fetchMock.mockReturnValue(mockResponse(exportData));
    const data = await exportUserData('mark');
    expect(data.userId).toBe('mark');
  });
});

// --- Migration ---

describe('migrateFromLegacyDB', () => {
  test('is a no-op returning false', async () => {
    const result = await migrateFromLegacyDB('mark');
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- Photos ---

describe('photos', () => {
  test('savePhoto calls PUT (fire-and-forget)', () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    savePhoto('mark', 'draft', 'overview', { data: 'data:image/jpeg;base64,abc', name: 'photo.jpg' });
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/photos/draft/overview', expect.objectContaining({
      method: 'PUT',
    }));
  });

  test('savePhoto does not throw on failure', () => {
    fetchMock.mockReturnValue(Promise.reject(new Error('Network error')));
    // Should not throw — fire-and-forget
    expect(() => savePhoto('mark', 'draft', 'overview', { data: 'data:abc' })).not.toThrow();
  });

  test('loadPhotos calls GET and parses response', async () => {
    fetchMock.mockReturnValue(mockResponse([
      { slot: 'overview', data: 'data:img1', name: 'ov.jpg', label: null },
      { slot: 'closeup', data: 'data:img2', name: 'cu.jpg', label: null },
      { slot: 'extra-0', data: 'data:img3', name: 'ex.jpg', label: 'Other' },
    ]));
    const result = await loadPhotos('mark', 'draft');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/photos/draft');
    expect(result.photos.overview.data).toBe('data:img1');
    expect(result.photos.closeup.data).toBe('data:img2');
    expect(result.extraPhotos).toHaveLength(1);
    expect(result.extraPhotos[0].data).toBe('data:img3');
  });

  test('loadPhotos returns empty on failure', async () => {
    fetchMock.mockReturnValue(mockResponse(null, false, 500));
    const result = await loadPhotos('mark', 'draft');
    expect(result.photos).toEqual({});
    expect(result.extraPhotos).toEqual([]);
  });

  test('deletePhotos calls DELETE for context', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await deletePhotos('mark', 'draft');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/photos/draft', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('deletePhoto calls DELETE for specific slot', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await deletePhoto('mark', 'draft', 'overview');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/photos/draft/overview', expect.objectContaining({
      method: 'DELETE',
    }));
  });

  test('copyPhotos calls POST with fromContext and toContext', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await copyPhotos('mark', 'draft', 'sq-123');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/photos/copy', expect.objectContaining({
      method: 'POST',
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.fromContext).toBe('draft');
    expect(body.toContext).toBe('sq-123');
  });
});

describe('saveJob with photo copy', () => {
  test('saveJob copies photos after successful save', async () => {
    fetchMock
      .mockReturnValueOnce(mockResponse({ id: 'sq-456' }))  // saveJob POST
      .mockReturnValueOnce(mockResponse({ ok: true }));       // copyPhotos POST
    const id = await saveJob('mark', makeFakeState('Client'));
    expect(id).toBe('sq-456');
    // Second call should be the photo copy
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/users/mark/photos/copy');
  });
});

// --- fetchWithRetry (tested via saveJob/saveDiffs) ---

describe('saveJob (no retry — POST is not retried to prevent duplicates)', () => {
  test('saveJob fails immediately on 500 (no retry)', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Temporary failure' }, false, 500));
    await expect(saveJob('mark', makeFakeState('Fail')))
      .rejects.toThrow('Temporary failure');
    // Only one call — no retries for POST
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('saveJob does not retry on 4xx errors', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Bad request' }, false, 400));
    await expect(saveJob('mark', makeFakeState('NoRetry')))
      .rejects.toThrow('Bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchWithRetry via saveDiffs', () => {
  test('saveDiffs retries on 500 and succeeds on second attempt', async () => {
    fetchMock
      .mockReturnValueOnce(mockResponse({ error: 'Temporary' }, false, 500))
      .mockReturnValueOnce(mockResponse({ ok: true, inserted: 2 }));
    const result = await saveDiffs('mark', 'sq-1', [{ fieldType: 'measurement' }], 0.5);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});

// --- saveDiffs ---

describe('saveDiffs', () => {
  test('calls POST with correct URL and body', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true, inserted: 1 }));
    const diffs = [{ fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1400' }];
    await saveDiffs('mark', 'sq-1', diffs, 0.5);
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1/diffs', expect.objectContaining({
      method: 'POST',
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.diffs).toEqual(diffs);
  });

  test('includes aiAccuracyScore in body', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true, inserted: 0 }));
    await saveDiffs('mark', 'sq-1', [], 0.75);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.aiAccuracyScore).toBe(0.75);
  });

  test('throws on server error', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'DB write failed' }, false, 500));
    await expect(saveDiffs('mark', 'sq-1', [], null))
      .rejects.toThrow('DB write failed');
  }, 30000);

  test('sends empty array when no diffs', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true, inserted: 0 }));
    const result = await saveDiffs('mark', 'sq-1', [], null);
    expect(result.inserted).toBe(0);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.diffs).toEqual([]);
  });
});

// --- updateJobStatus ---

describe('updateJobStatus', () => {
  test('calls PUT with correct URL and body', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await updateJobStatus('mark', 'sq-1', 'sent');
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1/status', expect.objectContaining({
      method: 'PUT',
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.status).toBe('sent');
  });

  test('passes meta fields (sentAt, expiresAt)', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    const sentAt = '2026-04-10T12:00:00.000Z';
    const expiresAt = '2026-05-10T12:00:00.000Z';
    await updateJobStatus('mark', 'sq-1', 'sent', { sentAt, expiresAt });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sentAt).toBe(sentAt);
    expect(body.expiresAt).toBe(expiresAt);
  });

  test('passes completionFeedback in meta', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await updateJobStatus('mark', 'sq-1', 'completed', { completionFeedback: 'Great job' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.status).toBe('completed');
    expect(body.completionFeedback).toBe('Great job');
  });

  test('throws on server error with message', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Update failed' }, false, 500));
    await expect(updateJobStatus('mark', 'sq-1', 'sent'))
      .rejects.toThrow('Update failed');
  });

  test('throws on 404', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Job sq-missing not found' }, false, 404));
    await expect(updateJobStatus('mark', 'sq-missing', 'sent'))
      .rejects.toThrow('Job sq-missing not found');
  });
});

// --- setRamsNotRequired ---

describe('setRamsNotRequired', () => {
  test('calls PUT with correct body', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await setRamsNotRequired('mark', 'sq-1', true);
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-1/rams-not-required', expect.objectContaining({
      method: 'PUT',
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.value).toBe(true);
  });

  test('throws on 404', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Job not found' }, false, 404));
    await expect(setRamsNotRequired('mark', 'sq-missing', true))
      .rejects.toThrow('Job not found');
  });
});

// --- saveJob photo copy failure resilience ---

describe('saveJob photo copy failure', () => {
  test('copyPhotos failure does not break job save', async () => {
    fetchMock
      .mockReturnValueOnce(mockResponse({ id: 'sq-789' }))                   // saveJob POST — success
      .mockReturnValueOnce(Promise.reject(new Error('Copy failed')));          // copyPhotos — fails
    const id = await saveJob('mark', makeFakeState('CopyFail'));
    // Job still saved successfully despite copy failure
    expect(id).toBe('sq-789');
  });
});

// --- updateJob ---

describe('updateJob', () => {
  test('calls PUT with correct URL and snapshot body', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    await updateJob('mark', 'sq-123', makeFakeState('Updated'));
    expect(fetchMock).toHaveBeenCalledWith('/api/users/mark/jobs/sq-123', expect.objectContaining({
      method: 'PUT',
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.jobDetails.clientName).toBe('Updated');
  });

  test('throws on server error (500)', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Update failed' }, false, 500));
    await expect(updateJob('mark', 'sq-123', makeFakeState('Fail')))
      .rejects.toThrow('Update failed');
  }, 30000);

  test('throws on 404 (job not found)', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Job not found' }, false, 404));
    await expect(updateJob('mark', 'nonexistent', makeFakeState('Missing')))
      .rejects.toThrow('Job not found');
  });

  test('retries on 500 and succeeds on second attempt', async () => {
    fetchMock
      .mockReturnValueOnce(mockResponse({ error: 'Temporary' }, false, 500))
      .mockReturnValueOnce(mockResponse({ ok: true }));
    const result = await updateJob('mark', 'sq-123', makeFakeState('Retry'));
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);

  test('does not retry on 4xx errors', async () => {
    fetchMock.mockReturnValue(mockResponse({ error: 'Bad request' }, false, 400));
    await expect(updateJob('mark', 'sq-123', makeFakeState('NoRetry')))
      .rejects.toThrow('Bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('strips photo blobs via buildSaveSnapshot', async () => {
    fetchMock.mockReturnValue(mockResponse({ ok: true }));
    const state = makeFakeState('BlobStrip');
    state.photos = { overview: { data: 'data:image/jpeg;base64,hugepayload' }, closeup: null };
    await updateJob('mark', 'sq-123', state);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // buildSaveSnapshot strips photo data
    expect(body.photos).toBeUndefined();
  });
});

// --- Helpers ---

function makeFakeState(clientName) {
  return {
    profile: { companyName: 'Test Co', fullName: 'Tester' },
    jobDetails: {
      clientName,
      siteAddress: '123 Test St',
      quoteReference: 'QT-2026-0001',
      quoteDate: '2026-03-15',
      briefNotes: '',
    },
    photos: { overview: null, closeup: null, sideProfile: null, referenceCard: null, access: null },
    extraPhotos: [],
    reviewData: null,
    diffs: [],
    quotePayload: null,
    quoteSequence: 1,
    aiRawResponse: null,
    rams: null,
  };
}
