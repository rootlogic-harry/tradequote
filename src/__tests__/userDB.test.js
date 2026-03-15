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
  saveJob, listJobs, getJob, deleteJob, updateJobRams,
  saveDraft, loadDraft, clearDraft,
  deleteUserData, exportUserData,
  migrateFromLegacyDB,
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
