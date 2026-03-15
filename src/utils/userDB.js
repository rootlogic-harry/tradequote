const DB_PREFIX = 'tradequote_v2_';
const DB_VERSION = 1;

function dbName(userId) {
  return DB_PREFIX + userId;
}

function openUserDB(userId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName(userId), DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

// --- Profile ---

export async function getProfile(userId) {
  const db = await openUserDB(userId);
  const store = db.transaction('profile', 'readonly').objectStore('profile');
  const record = await req(store.get('main'));
  db.close();
  return record?.data || null;
}

export async function saveProfile(userId, profile) {
  const db = await openUserDB(userId);
  const store = db.transaction('profile', 'readwrite').objectStore('profile');
  await req(store.put({ id: 'main', data: profile }));
  db.close();
}

// --- Settings ---

export async function getSetting(userId, key) {
  const db = await openUserDB(userId);
  const store = db.transaction('settings', 'readonly').objectStore('settings');
  const record = await req(store.get(key));
  db.close();
  return record?.value ?? null;
}

export async function setSetting(userId, key, value) {
  const db = await openUserDB(userId);
  const store = db.transaction('settings', 'readwrite').objectStore('settings');
  await req(store.put({ key, value }));
  db.close();
}

// --- Theme ---

export async function getTheme(userId) {
  return getSetting(userId, 'theme');
}

export async function setTheme(userId, theme) {
  await setSetting(userId, 'theme', theme);
  try {
    localStorage.setItem('tq_theme_' + userId, theme);
  } catch { /* ignore */ }
}

// --- Quote Sequence ---

export async function getQuoteSequence(userId) {
  const val = await getSetting(userId, 'quoteSequence');
  return val || 1;
}

export async function incrementQuoteSequence(userId) {
  const current = await getQuoteSequence(userId);
  const next = current + 1;
  await setSetting(userId, 'quoteSequence', next);
  return next;
}

// --- Jobs ---

export async function saveJob(userId, state) {
  const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { profile, jobDetails, photos, extraPhotos, reviewData, diffs, quotePayload, quoteSequence, aiRawResponse } = state;

  const totals = quotePayload?.totals;

  const quoteSnapshot = {
    profile,
    jobDetails,
    photos,
    extraPhotos,
    reviewData,
    diffs,
    quotePayload,
    quoteSequence,
    aiRawResponse,
  };

  const record = {
    id,
    savedAt: new Date().toISOString(),
    clientName: jobDetails.clientName || '',
    siteAddress: jobDetails.siteAddress || '',
    quoteReference: jobDetails.quoteReference || '',
    quoteDate: jobDetails.quoteDate || '',
    totalAmount: totals?.total ?? 0,
    hasRams: false,
    quoteSnapshot,
    ramsSnapshot: null,
    snapshot: quoteSnapshot,
  };

  const db = await openUserDB(userId);
  const store = db.transaction('jobs', 'readwrite').objectStore('jobs');
  await req(store.put(record));
  db.close();
  return id;
}

export async function listJobs(userId) {
  const db = await openUserDB(userId);
  const store = db.transaction('jobs', 'readonly').objectStore('jobs');
  const records = await req(store.getAll());
  db.close();
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getJob(userId, id) {
  const db = await openUserDB(userId);
  const store = db.transaction('jobs', 'readonly').objectStore('jobs');
  const record = await req(store.get(id));
  db.close();
  if (record && !record.snapshot && record.quoteSnapshot) {
    record.snapshot = record.quoteSnapshot;
  }
  return record || null;
}

export async function deleteJob(userId, id) {
  const db = await openUserDB(userId);
  const store = db.transaction('jobs', 'readwrite').objectStore('jobs');
  await req(store.delete(id));
  db.close();
}

export async function updateJobRams(userId, jobId, ramsSnapshot) {
  const db = await openUserDB(userId);
  const store = db.transaction('jobs', 'readwrite').objectStore('jobs');
  const record = await req(store.get(jobId));
  if (!record) {
    db.close();
    throw new Error(`Job ${jobId} not found`);
  }
  record.ramsSnapshot = ramsSnapshot;
  record.hasRams = !!ramsSnapshot;
  await req(store.put(record));
  db.close();
}

// --- Drafts ---

const DRAFT_KEY = 'current_draft';

export async function saveDraft(userId, state) {
  const { step, profile, jobDetails, photos, extraPhotos, reviewData, diffs, quoteSequence, aiRawResponse, rams } = state;
  const record = {
    id: DRAFT_KEY,
    savedAt: new Date().toISOString(),
    step,
    profile,
    jobDetails,
    photos,
    extraPhotos,
    reviewData,
    diffs,
    quoteSequence,
    aiRawResponse,
    rams,
  };
  const db = await openUserDB(userId);
  const store = db.transaction('drafts', 'readwrite').objectStore('drafts');
  await req(store.put(record));
  db.close();
}

export async function loadDraft(userId) {
  const db = await openUserDB(userId);
  const store = db.transaction('drafts', 'readonly').objectStore('drafts');
  const record = await req(store.get(DRAFT_KEY));
  db.close();
  return record || null;
}

export async function clearDraft(userId) {
  const db = await openUserDB(userId);
  const store = db.transaction('drafts', 'readwrite').objectStore('drafts');
  await req(store.delete(DRAFT_KEY));
  db.close();
}

// --- GDPR ---

export async function deleteUserData(userId) {
  // Remove localStorage keys
  try {
    localStorage.removeItem('tq_theme_' + userId);
  } catch { /* ignore */ }
  try {
    sessionStorage.removeItem('tq_session_' + userId);
  } catch { /* ignore */ }

  // Delete the entire user database
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName(userId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function exportUserData(userId) {
  const db = await openUserDB(userId);

  const getAll = (storeName) => {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    return req(store.getAll());
  };

  const [profile, settings, jobs, drafts] = await Promise.all([
    getAll('profile'),
    getAll('settings'),
    getAll('jobs'),
    getAll('drafts'),
  ]);

  db.close();

  return {
    userId,
    exportedAt: new Date().toISOString(),
    profile,
    settings,
    jobs,
    drafts,
  };
}

// --- Migration from legacy DB ---

export async function migrateFromLegacyDB(userId) {
  // Check if already migrated (flag stored in registry via settings)
  const migrated = await getSetting(userId, 'legacyMigrated');
  if (migrated) return false;

  // Open legacy DB
  const legacyDB = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tradequote_saved', 3);
    request.onupgradeneeded = () => {
      // Don't create stores if they don't exist — we're just reading
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // Read legacy jobs
  let legacyJobs = [];
  if (legacyDB.objectStoreNames.contains('jobs')) {
    const store = legacyDB.transaction('jobs', 'readonly').objectStore('jobs');
    legacyJobs = await req(store.getAll());
  }

  // Read legacy drafts
  let legacyDrafts = [];
  if (legacyDB.objectStoreNames.contains('drafts')) {
    const store = legacyDB.transaction('drafts', 'readonly').objectStore('drafts');
    legacyDrafts = await req(store.getAll());
  }

  legacyDB.close();

  // Write to user's DB
  const userDB = await openUserDB(userId);

  if (legacyJobs.length > 0) {
    const tx = userDB.transaction('jobs', 'readwrite');
    const store = tx.objectStore('jobs');
    for (const job of legacyJobs) {
      store.put(job);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  if (legacyDrafts.length > 0) {
    const tx = userDB.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    for (const draft of legacyDrafts) {
      store.put(draft);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  userDB.close();

  // Mark migration complete
  await setSetting(userId, 'legacyMigrated', true);
  return true;
}
