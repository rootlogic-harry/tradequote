const DB_NAME = 'tradequote_saved';
const STORE_NAME = 'quotes';
const DRAFTS_STORE_NAME = 'drafts';
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DRAFTS_STORE_NAME)) {
        db.createObjectStore(DRAFTS_STORE_NAME, { keyPath: 'id' });
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

export async function saveQuote(state) {
  const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { profile, jobDetails, photos, extraPhotos, reviewData, diffs, quotePayload, quoteSequence, aiRawResponse } = state;

  const totals = quotePayload?.totals;

  const record = {
    id,
    savedAt: new Date().toISOString(),
    clientName: jobDetails.clientName || '',
    siteAddress: jobDetails.siteAddress || '',
    quoteReference: jobDetails.quoteReference || '',
    quoteDate: jobDetails.quoteDate || '',
    totalAmount: totals?.total ?? 0,
    snapshot: {
      profile,
      jobDetails,
      photos,
      extraPhotos,
      reviewData,
      diffs,
      quotePayload,
      quoteSequence,
      aiRawResponse,
    },
  };

  const db = await openDB();
  await req(tx(db, STORE_NAME, 'readwrite').put(record));
  db.close();
  return id;
}

export async function listSavedQuotes() {
  const db = await openDB();
  const records = await req(tx(db, STORE_NAME, 'readonly').getAll());
  db.close();
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedQuote(id) {
  const db = await openDB();
  const record = await req(tx(db, STORE_NAME, 'readonly').get(id));
  db.close();
  return record;
}

export async function deleteSavedQuote(id) {
  const db = await openDB();
  await req(tx(db, STORE_NAME, 'readwrite').delete(id));
  db.close();
}

// Draft persistence
const DRAFT_KEY = 'current_draft';

export async function saveDraft(state) {
  const { step, profile, jobDetails, photos, extraPhotos, reviewData, diffs, quoteSequence, aiRawResponse } = state;
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
