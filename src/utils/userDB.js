import { buildSaveSnapshot } from './stripBlobs.js';

// --- fetchWithRetry ---

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  let lastResponse;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status < 500) return response; // don't retry 4xx
      lastResponse = response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  // Return the last 5xx response so callers can read the error body
  if (lastResponse) return lastResponse;
  throw lastError;
}

// --- Profile ---

export async function getProfile(userId) {
  const res = await fetch(`/api/users/${userId}/profile`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveProfile(userId, profile) {
  const res = await fetch(`/api/users/${userId}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    let msg = `Profile save failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

// --- Settings ---

export async function getSetting(userId, key) {
  const res = await fetch(`/api/users/${userId}/settings/${key}`);
  if (!res.ok) return null;
  return res.json();
}

export async function setSetting(userId, key, value) {
  const res = await fetch(`/api/users/${userId}/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    let msg = `Setting save failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

// --- Theme ---

export async function getTheme(userId) {
  const res = await fetch(`/api/users/${userId}/theme`);
  if (!res.ok) return null;
  return res.json();
}

export async function setTheme(userId, theme) {
  await fetch(`/api/users/${userId}/theme`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  });
  // Also write to localStorage for anti-flash on page load
  try {
    localStorage.setItem('tq_theme_' + userId, theme);
  } catch { /* ignore */ }
}

// --- Quote Sequence ---

export async function getQuoteSequence(userId) {
  const res = await fetch(`/api/users/${userId}/quote-sequence`);
  if (!res.ok) return 1;
  const val = await res.json();
  return val || 1;
}

export async function incrementQuoteSequence(userId) {
  const res = await fetch(`/api/users/${userId}/quote-sequence/increment`, {
    method: 'POST',
  });
  if (!res.ok) return 1;
  return res.json();
}

// --- Jobs ---

export async function saveJob(userId, state) {
  const snapshot = buildSaveSnapshot(state);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    // No retry for POST — retrying a create request risks duplicate jobs
    const res = await fetch(`/api/users/${userId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = `Save failed (${res.status})`;
      try { const data = await res.json(); msg = data.error || msg; } catch {}
      throw new Error(msg);
    }
    const data = await res.json();
    if (!data.id) throw new Error('Server returned no job ID');
    // Copy draft photos to the new job context (server-side, no re-upload)
    try { await copyPhotos(userId, 'draft', data.id); } catch {}
    return data.id;
  } finally {
    clearTimeout(timeout);
  }
}

export async function updateJob(userId, jobId, state) {
  const snapshot = buildSaveSnapshot(state);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetchWithRetry(`/api/users/${userId}/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = `Job update failed (${res.status})`;
      try { const data = await res.json(); msg = data.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Typed error for session-lost scenarios. Thrown by listJobs / other
 * authenticated helpers when the server says 401. Callers that reach the
 * UI can check `err instanceof SessionExpiredError` and redirect to
 * `/login?error=session_expired` instead of silently showing an empty
 * screen — the bug that lost Paul's first quote.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export async function listJobs(userId) {
  const res = await fetch(`/api/users/${userId}/jobs`);
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok) {
    let msg = `listJobs failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function getJob(userId, id) {
  const res = await fetch(`/api/users/${userId}/jobs/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function deleteJob(userId, id) {
  const res = await fetch(`/api/users/${userId}/jobs/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    let msg = `Delete failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

export async function updateJobRams(userId, jobId, ramsSnapshot) {
  const res = await fetch(`/api/users/${userId}/jobs/${jobId}/rams`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ramsSnapshot),
  });
  if (!res.ok) {
    let msg = `Failed to update RAMS for job ${jobId}`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

export async function setRamsNotRequired(userId, jobId, value) {
  const res = await fetch(`/api/users/${userId}/jobs/${jobId}/rams-not-required`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    let msg = `Failed to update rams-not-required for job ${jobId}`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

export async function updateJobStatus(userId, jobId, status, meta = {}) {
  const res = await fetch(`/api/users/${userId}/jobs/${jobId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...meta }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Failed to update status for job ${jobId}`);
  }
}

// --- Drafts ---

export async function saveDraft(userId, state) {
  const snapshot = buildSaveSnapshot(state);
  const res = await fetch(`/api/users/${userId}/drafts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) {
    let msg = `Draft save failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
}

// --- Diffs ---

export async function saveDiffs(userId, jobId, diffs, aiAccuracyScore) {
  const res = await fetchWithRetry(`/api/users/${userId}/jobs/${jobId}/diffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diffs, aiAccuracyScore }),
  });
  if (!res.ok) {
    let msg = `Diffs save failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function loadDraft(userId) {
  const res = await fetch(`/api/users/${userId}/drafts`);
  if (!res.ok) return null;
  return res.json();
}

export async function clearDraft(userId) {
  await fetch(`/api/users/${userId}/drafts`, { method: 'DELETE' });
}

// --- Photos ---

export function savePhoto(userId, context, slot, photo) {
  // Fire-and-forget: warn on failure but don't throw
  fetch(`/api/users/${userId}/photos/${context}/${slot}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: photo.data, label: photo.label || null, name: photo.name || null }),
  }).catch((err) => console.warn('Photo upload failed:', err.message));
}

export async function loadPhotos(userId, context) {
  try {
    const res = await fetch(`/api/users/${userId}/photos/${context}`);
    if (!res.ok) return { photos: {}, extraPhotos: [] };
    const rows = await res.json();
    const photos = {};
    const extraPhotos = [];
    for (const row of rows) {
      if (row.slot.startsWith('extra-')) {
        extraPhotos.push({ data: row.data, name: row.name || '', label: row.label || 'Other' });
      } else {
        photos[row.slot] = { data: row.data, name: row.name || '' };
      }
    }
    return { photos, extraPhotos };
  } catch {
    return { photos: {}, extraPhotos: [] };
  }
}

export async function deletePhotos(userId, context) {
  await fetch(`/api/users/${userId}/photos/${context}`, { method: 'DELETE' });
}

export async function deletePhoto(userId, context, slot) {
  await fetch(`/api/users/${userId}/photos/${context}/${slot}`, { method: 'DELETE' });
}

export async function copyPhotos(userId, fromContext, toContext) {
  await fetch(`/api/users/${userId}/photos/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromContext, toContext }),
  });
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

  await fetch(`/api/users/${userId}/data`, { method: 'DELETE' });
}

export async function exportUserData(userId) {
  const res = await fetch(`/api/users/${userId}/export`);
  if (!res.ok) return null;
  return res.json();
}

// --- Migration from legacy DB ---

export async function migrateFromLegacyDB(userId) {
  // No-op — legacy IndexedDB migration not needed with server-side Postgres
  return false;
}
