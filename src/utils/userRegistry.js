const REGISTRY_DB = 'tradequote_registry';
const REGISTRY_VERSION = 1;
const STORE = 'users';

function openRegistry() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REGISTRY_DB, REGISTRY_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
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

export async function listUsers() {
  const db = await openRegistry();
  const store = db.transaction(STORE, 'readonly').objectStore(STORE);
  const users = await req(store.getAll());
  db.close();
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUser(userId) {
  const db = await openRegistry();
  const store = db.transaction(STORE, 'readonly').objectStore(STORE);
  const user = await req(store.get(userId));
  db.close();
  return user || null;
}

export async function addUser(user) {
  const db = await openRegistry();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await req(store.put(user));
  db.close();
}

export async function deleteUser(userId) {
  const db = await openRegistry();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  await req(store.delete(userId));
  db.close();
}

export async function bootstrapUsers() {
  const db = await openRegistry();
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const existing = await req(store.getAll());
  const ids = new Set(existing.map(u => u.id));

  if (!ids.has('mark')) {
    store.put({ id: 'mark', name: 'Mark', createdAt: new Date().toISOString() });
  }
  if (!ids.has('harry')) {
    store.put({ id: 'harry', name: 'Harry', createdAt: new Date().toISOString() });
  }

  await new Promise((resolve, reject) => {
    store.transaction.oncomplete = resolve;
    store.transaction.onerror = () => reject(store.transaction.error);
  });
  db.close();
}
