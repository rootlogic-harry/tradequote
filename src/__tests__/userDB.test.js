import 'fake-indexeddb/auto';
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

// Reset IndexedDB between tests
beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    indexedDB.deleteDatabase(db.name);
  }
});

// --- User Registry ---

describe('userRegistry', () => {
  test('bootstrapUsers creates mark and harry', async () => {
    await bootstrapUsers();
    const users = await listUsers();
    expect(users).toHaveLength(2);
    expect(users.map(u => u.id).sort()).toEqual(['harry', 'mark']);
  });

  test('bootstrapUsers is idempotent', async () => {
    await bootstrapUsers();
    await bootstrapUsers();
    const users = await listUsers();
    expect(users).toHaveLength(2);
  });

  test('getUser returns user or null', async () => {
    await bootstrapUsers();
    const mark = await getUser('mark');
    expect(mark.name).toBe('Mark');
    const nobody = await getUser('nobody');
    expect(nobody).toBeNull();
  });

  test('addUser and deleteUser', async () => {
    await addUser({ id: 'test', name: 'Test', createdAt: new Date().toISOString() });
    let users = await listUsers();
    expect(users).toHaveLength(1);
    await deleteUser('test');
    users = await listUsers();
    expect(users).toHaveLength(0);
  });

  test('listUsers returns sorted by name', async () => {
    await addUser({ id: 'z', name: 'Zara', createdAt: new Date().toISOString() });
    await addUser({ id: 'a', name: 'Alice', createdAt: new Date().toISOString() });
    const users = await listUsers();
    expect(users[0].name).toBe('Alice');
    expect(users[1].name).toBe('Zara');
  });
});

// --- User Isolation ---

describe('user isolation', () => {
  test('jobs saved for user A are not visible to user B', async () => {
    const state = makeFakeState('Client A');
    await saveJob('alice', state);
    const aliceJobs = await listJobs('alice');
    const bobJobs = await listJobs('bob');
    expect(aliceJobs).toHaveLength(1);
    expect(bobJobs).toHaveLength(0);
  });

  test('drafts are isolated per user', async () => {
    const state = makeFakeState('Draft A');
    await saveDraft('alice', state);
    const aliceDraft = await loadDraft('alice');
    const bobDraft = await loadDraft('bob');
    expect(aliceDraft).not.toBeNull();
    expect(bobDraft).toBeNull();
  });
});

// --- Profile CRUD ---

describe('profile', () => {
  test('save and get profile', async () => {
    const profile = { companyName: 'Test Co', fullName: 'Mark' };
    await saveProfile('mark', profile);
    const loaded = await getProfile('mark');
    expect(loaded).toEqual(profile);
  });

  test('getProfile returns null when no profile saved', async () => {
    const loaded = await getProfile('nobody');
    expect(loaded).toBeNull();
  });

  test('saveProfile overwrites previous', async () => {
    await saveProfile('mark', { companyName: 'Old' });
    await saveProfile('mark', { companyName: 'New' });
    const loaded = await getProfile('mark');
    expect(loaded.companyName).toBe('New');
  });
});

// --- Jobs ---

describe('jobs', () => {
  test('save, list, get, delete job', async () => {
    const state = makeFakeState('Client X');
    const id = await saveJob('mark', state);
    expect(typeof id).toBe('string');

    const jobs = await listJobs('mark');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].clientName).toBe('Client X');

    const job = await getJob('mark', id);
    expect(job.clientName).toBe('Client X');
    expect(job.quoteSnapshot).toBeDefined();

    await deleteJob('mark', id);
    const after = await listJobs('mark');
    expect(after).toHaveLength(0);
  });

  test('listJobs returns most recent first', async () => {
    await saveJob('mark', makeFakeState('First'));
    // Small delay to ensure different savedAt
    await new Promise(r => setTimeout(r, 10));
    await saveJob('mark', makeFakeState('Second'));
    const jobs = await listJobs('mark');
    expect(jobs[0].clientName).toBe('Second');
    expect(jobs[1].clientName).toBe('First');
  });

  test('updateJobRams links RAMS to job', async () => {
    const id = await saveJob('mark', makeFakeState('Test'));
    const rams = { id: 'rams-1', status: 'draft' };
    await updateJobRams('mark', id, rams);
    const job = await getJob('mark', id);
    expect(job.hasRams).toBe(true);
    expect(job.ramsSnapshot).toEqual(rams);
  });

  test('updateJobRams throws for missing job', async () => {
    await expect(updateJobRams('mark', 'nonexistent', {}))
      .rejects.toThrow('Job nonexistent not found');
  });

  test('getJob returns null for missing job', async () => {
    const job = await getJob('mark', 'nonexistent');
    expect(job).toBeNull();
  });
});

// --- Drafts ---

describe('drafts', () => {
  test('save, load, clear draft', async () => {
    const state = makeFakeState('Draft Client');
    await saveDraft('mark', state);
    const draft = await loadDraft('mark');
    expect(draft).not.toBeNull();
    expect(draft.jobDetails.clientName).toBe('Draft Client');

    await clearDraft('mark');
    const cleared = await loadDraft('mark');
    expect(cleared).toBeNull();
  });

  test('loadDraft returns null when no draft', async () => {
    const draft = await loadDraft('mark');
    expect(draft).toBeNull();
  });
});

// --- Quote Sequence ---

describe('quoteSequence', () => {
  test('getQuoteSequence defaults to 1', async () => {
    const seq = await getQuoteSequence('mark');
    expect(seq).toBe(1);
  });

  test('incrementQuoteSequence returns incremented value', async () => {
    const val = await incrementQuoteSequence('mark');
    expect(val).toBe(2);
    const val2 = await incrementQuoteSequence('mark');
    expect(val2).toBe(3);
    const current = await getQuoteSequence('mark');
    expect(current).toBe(3);
  });
});

// --- Theme ---

describe('theme', () => {
  test('getTheme returns null by default', async () => {
    const theme = await getTheme('mark');
    expect(theme).toBeNull();
  });

  test('setTheme and getTheme', async () => {
    await setTheme('mark', 'dark');
    const theme = await getTheme('mark');
    expect(theme).toBe('dark');
  });
});

// --- GDPR ---

describe('deleteUserData', () => {
  test('removes database entirely', async () => {
    await saveProfile('mark', { companyName: 'Test' });
    await saveJob('mark', makeFakeState('Job'));
    await deleteUserData('mark');

    // After deletion, opening DB should give empty stores
    const profile = await getProfile('mark');
    expect(profile).toBeNull();
    const jobs = await listJobs('mark');
    expect(jobs).toHaveLength(0);
  });
});

describe('exportUserData', () => {
  test('exports all data as JSON', async () => {
    await saveProfile('mark', { companyName: 'Export Co' });
    await saveJob('mark', makeFakeState('Export Job'));
    await saveDraft('mark', makeFakeState('Export Draft'));
    await setSetting('mark', 'theme', 'dark');

    const data = await exportUserData('mark');
    expect(data.userId).toBe('mark');
    expect(data.exportedAt).toBeDefined();
    expect(data.profile).toHaveLength(1);
    expect(data.jobs).toHaveLength(1);
    expect(data.drafts).toHaveLength(1);
    expect(data.settings).toHaveLength(1);
  });
});

// --- Migration ---

describe('migrateFromLegacyDB', () => {
  test('migrates jobs and drafts from legacy DB', async () => {
    // Set up legacy DB
    await setupLegacyDB([
      { id: 'job-1', clientName: 'Legacy Client', savedAt: new Date().toISOString() },
    ], [
      { id: 'current_draft', jobDetails: { clientName: 'Legacy Draft' }, savedAt: new Date().toISOString() },
    ]);

    const migrated = await migrateFromLegacyDB('mark');
    expect(migrated).toBe(true);

    const jobs = await listJobs('mark');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].clientName).toBe('Legacy Client');

    const draft = await loadDraft('mark');
    expect(draft).not.toBeNull();
  });

  test('migration is idempotent', async () => {
    await setupLegacyDB([
      { id: 'job-1', clientName: 'Legacy', savedAt: new Date().toISOString() },
    ], []);

    await migrateFromLegacyDB('mark');
    const secondRun = await migrateFromLegacyDB('mark');
    expect(secondRun).toBe(false);
  });
});

// --- Helpers ---

function makeFakeState(clientName) {
  return {
    step: 2,
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

function setupLegacyDB(jobs, drafts) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tradequote_saved', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('quotes')) {
        db.createObjectStore('quotes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['jobs', 'drafts'], 'readwrite');
      const jobsStore = tx.objectStore('jobs');
      const draftsStore = tx.objectStore('drafts');
      for (const job of jobs) jobsStore.put(job);
      for (const draft of drafts) draftsStore.put(draft);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}
