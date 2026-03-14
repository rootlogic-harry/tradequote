const DB_NAME = 'tradequote_saved';
const STORE_NAME = 'quotes';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
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
  await req(tx(db, 'readwrite').put(record));
  db.close();
  return id;
}

export async function listSavedQuotes() {
  const db = await openDB();
  const records = await req(tx(db, 'readonly').getAll());
  db.close();
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getSavedQuote(id) {
  const db = await openDB();
  const record = await req(tx(db, 'readonly').get(id));
  db.close();
  return record;
}

export async function deleteSavedQuote(id) {
  const db = await openDB();
  await req(tx(db, 'readwrite').delete(id));
  db.close();
}
