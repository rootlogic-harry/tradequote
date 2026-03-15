export async function listUsers() {
  const res = await fetch('/api/users');
  if (!res.ok) return [];
  return res.json();
}

export async function getUser(userId) {
  const res = await fetch(`/api/users/${userId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function addUser(user) {
  await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
}

export async function deleteUser(userId) {
  await fetch(`/api/users/${userId}`, { method: 'DELETE' });
}

export async function bootstrapUsers() {
  // Server handles bootstrap on startup — no-op client-side
}
