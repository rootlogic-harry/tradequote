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
  await fetch(`/api/users/${userId}/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
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

// --- Blob stripping (TRQ-55) ---

function stripBlobFields(state) {
  const clone = JSON.parse(JSON.stringify(state));
  // Record which photo slots had data before stripping (for restore-time warnings)
  if (clone.photos) {
    const slots = {};
    for (const key of Object.keys(clone.photos)) {
      if (clone.photos[key]) slots[key] = true;
      clone.photos[key] = null;
    }
    if (Object.keys(slots).length > 0) clone._photoSlots = slots;
  }
  if (clone.extraPhotos && clone.extraPhotos.length > 0) {
    clone._extraPhotoCount = clone.extraPhotos.length;
  }
  clone.extraPhotos = [];
  if (clone.profile) {
    clone.profile.logo = null;
  }
  clone.aiRawResponse = null;
  return clone;
}

// --- Jobs ---

export async function saveJob(userId, state) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`/api/users/${userId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripBlobFields(state)),
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

export async function listJobs(userId) {
  const res = await fetch(`/api/users/${userId}/jobs`);
  if (!res.ok) return [];
  return res.json();
}

export async function getJob(userId, id) {
  const res = await fetch(`/api/users/${userId}/jobs/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function deleteJob(userId, id) {
  await fetch(`/api/users/${userId}/jobs/${id}`, { method: 'DELETE' });
}

export async function updateJobRams(userId, jobId, ramsSnapshot) {
  const res = await fetch(`/api/users/${userId}/jobs/${jobId}/rams`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ramsSnapshot),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Failed to update RAMS for job ${jobId}`);
  }
}

export async function setRamsNotRequired(userId, jobId, value) {
  const res = await fetch(`/api/users/${userId}/jobs/${jobId}/rams-not-required`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Failed to update rams-not-required for job ${jobId}`);
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
  const res = await fetch(`/api/users/${userId}/drafts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stripBlobFields(state)),
  });
  if (!res.ok) {
    let msg = `Draft save failed (${res.status})`;
    try { const data = await res.json(); msg = data.error || msg; } catch {}
    throw new Error(msg);
  }
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
