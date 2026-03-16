// --- Profile ---

export async function getProfile(userId) {
  const res = await fetch(`/api/users/${userId}/profile`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveProfile(userId, profile) {
  await fetch(`/api/users/${userId}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
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

// --- Jobs ---

export async function saveJob(userId, state) {
  const res = await fetch(`/api/users/${userId}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  const data = await res.json();
  return data.id;
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
  await fetch(`/api/users/${userId}/drafts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

export async function loadDraft(userId) {
  const res = await fetch(`/api/users/${userId}/drafts`);
  if (!res.ok) return null;
  return res.json();
}

export async function clearDraft(userId) {
  await fetch(`/api/users/${userId}/drafts`, { method: 'DELETE' });
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
