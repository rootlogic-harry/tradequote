const DB_NAME = 'tradequote_saved';
const STORE_NAME = 'quotes';
const DRAFTS_STORE_NAME = 'drafts';
const JOBS_STORE_NAME = 'jobs';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        db.createObjectStore(DRAFTS_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(JOBS_STORE_NAME)) {
        db.createObjectStore(JOBS_STORE_NAME, { keyPath: 'id' });
      }

      // Migrate existing quotes to jobs store (v2 → v3)
      if (event.oldVersion < 3 && db.objectStoreNames.contains(STORE_NAME)) {
        const tx = request.transaction;
        const quotesStore = tx.objectStore(STORE_NAME);
        const jobsStore = tx.objectStore(JOBS_STORE_NAME);
        const getAllReq = quotesStore.getAll();
        getAllReq.onsuccess = () => {
          const quotes = getAllReq.result || [];
          quotes.forEach(q => {
            jobsStore.put({
              id: q.id,
              savedAt: q.savedAt,
              clientName: q.clientName,
              siteAddress: q.siteAddress,
              quoteReference: q.quoteReference,
              quoteDate: q.quoteDate,
              totalAmount: q.totalAmount,
              hasRams: false,
              quoteSnapshot: q.snapshot,
              ramsSnapshot: null,
            });
          });
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function req(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

// --- Legacy quote functions (delegate to jobs store) ---

export async function saveQuote(state) {
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
    // Legacy compat — SavedQuoteViewer reads .snapshot
    snapshot: quoteSnapshot,
  };

  const db = await openDB();
  // Write to both stores for backward compat
  const transaction = db.transaction([JOBS_STORE_NAME, STORE_NAME], 'readwrite');
  transaction.objectStore(JOBS_STORE_NAME).put(record);
  transaction.objectStore(STORE_NAME).put({
    id,
    savedAt: record.savedAt,
    clientName: record.clientName,
    siteAddress: record.siteAddress,
    quoteReference: record.quoteReference,
    quoteDate: record.quoteDate,
    totalAmount: record.totalAmount,
    snapshot: quoteSnapshot,
  });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return id;
}

export async function listSavedQuotes() {
  const db = await openDB();
  // Prefer jobs store
  const records = await req(tx(db, JOBS_STORE_NAME, 'readonly').getAll());
  db.close();
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedQuote(id) {
  const db = await openDB();
  let record = await req(tx(db, JOBS_STORE_NAME, 'readonly').get(id));
  if (!record) {
    // Fallback to legacy store
    record = await req(tx(db, STORE_NAME, 'readonly').get(id));
  }
  db.close();
  // Ensure snapshot compat
  if (record && !record.snapshot && record.quoteSnapshot) {
    record.snapshot = record.quoteSnapshot;
  }
  return record;
}

export async function deleteSavedQuote(id) {
  const db = await openDB();
  const transaction = db.transaction([JOBS_STORE_NAME, STORE_NAME], 'readwrite');
  transaction.objectStore(JOBS_STORE_NAME).delete(id);
  transaction.objectStore(STORE_NAME).delete(id);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

// --- Jobs store functions ---

export async function saveJob(state) {
  return saveQuote(state);
}

export async function listJobs() {
  return listSavedQuotes();
}

export async function getJob(id) {
  return getSavedQuote(id);
}

export async function deleteJob(id) {
  return deleteSavedQuote(id);
}

export async function updateJobRams(jobId, ramsSnapshot) {
  const db = await openDB();
  const record = await req(tx(db, JOBS_STORE_NAME, 'readonly').get(jobId));
  if (!record) {
    db.close();
    throw new Error(`Job ${jobId} not found`);
  }
  record.ramsSnapshot = ramsSnapshot;
  record.hasRams = !!ramsSnapshot;
  await req(tx(db, JOBS_STORE_NAME, 'readwrite').put(record));
  db.close();
}

// --- Draft persistence ---
const DRAFT_KEY = 'current_draft';

export async function saveDraft(state) {
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
  const db = await openDB();
  await req(tx(db, DRAFTS_STORE_NAME, 'readwrite').put(record));
  db.close();
}

export async function loadDraft() {
  const db = await openDB();
  const record = await req(tx(db, DRAFTS_STORE_NAME, 'readonly').get(DRAFT_KEY));
  db.close();
  return record || null;
}

export async function clearDraft() {
  const db = await openDB();
  await req(tx(db, DRAFTS_STORE_NAME, 'readwrite').delete(DRAFT_KEY));
  db.close();
}
