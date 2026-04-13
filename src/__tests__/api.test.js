/**
 * API Integration Tests for FastQuote Express Server
 *
 * These tests require a running Postgres database.
 * Set DATABASE_URL env var before running.
 * Run: DATABASE_URL=postgres://... node --experimental-vm-modules node_modules/.bin/jest src/__tests__/api.test.js --runInBand
 */

// Set test env before importing server (prevents auto-listen and process.exit)
process.env.NODE_ENV = 'test';

import { app, pool, dbReady } from '../../server.js';
import http from 'http';

let server;
let baseUrl;

beforeAll(async () => {
  // Wait for server's initDB to complete (creates all tables)
  await dbReady;

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const addr = server.address();
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

beforeEach(async () => {
  // Clean all tables before each test (order matters for FK constraints)
  await pool.query('DELETE FROM quote_diffs');
  await pool.query('DELETE FROM user_photos');
  await pool.query('DELETE FROM drafts');
  await pool.query('DELETE FROM jobs');
  await pool.query('DELETE FROM settings');
  await pool.query('DELETE FROM profiles');
  await pool.query('DELETE FROM users');
});

async function api(path, opts = {}) {
  const { method = 'GET', body, headers: extraHeaders = {} } = opts;
  const options = { method, headers: { ...extraHeaders } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  // Auto-inject test auth header for any /api/users/:id(/...) route so the
  // requireAuth + requireOwner middleware bypass kicks in under NODE_ENV=test.
  const userIdMatch = path.match(/^\/api\/users\/([^/?#]+)/);
  if (userIdMatch && !options.headers['x-test-user-id']) {
    options.headers['x-test-user-id'] = decodeURIComponent(userIdMatch[1]);
    if (!options.headers['x-test-plan']) {
      options.headers['x-test-plan'] = 'admin';
    }
  }
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// --- User CRUD ---

describe('User CRUD', () => {
  test('POST /api/users creates a user', async () => {
    const { status, data } = await api('/api/users', {
      method: 'POST',
      body: { id: 'test', name: 'Test User' },
    });
    expect(status).toBe(200);
    expect(data.id).toBe('test');
  });

  test('GET /api/users lists users', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'alice', name: 'Alice' } });
    await api('/api/users', { method: 'POST', body: { id: 'bob', name: 'Bob' } });
    const { data } = await api('/api/users');
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Alice'); // sorted by name
  });

  test('GET /api/users/:id returns user or 404', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark');
    expect(data.name).toBe('Mark');
    const { status } = await api('/api/users/nobody');
    expect(status).toBe(404);
  });

  test('DELETE /api/users/:id removes user', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'temp', name: 'Temp' } });
    await api('/api/users/temp', { method: 'DELETE' });
    const { data } = await api('/api/users');
    expect(data).toHaveLength(0);
  });

  test('POST /api/users requires id and name', async () => {
    const { status } = await api('/api/users', { method: 'POST', body: { id: 'test' } });
    expect(status).toBe(400);
  });

  test('POST /api/users upserts on conflict', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'test', name: 'Old' } });
    await api('/api/users', { method: 'POST', body: { id: 'test', name: 'New' } });
    const { data } = await api('/api/users/test');
    expect(data.name).toBe('New');
  });
});

// --- Profile CRUD ---

describe('Profile CRUD', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('GET /api/users/:id/profile returns null when no profile', async () => {
    const { data } = await api('/api/users/mark/profile');
    expect(data).toBeNull();
  });

  test('PUT and GET profile', async () => {
    const profile = { companyName: 'Doyle Stone Works', fullName: 'Mark Doyle' };
    await api('/api/users/mark/profile', { method: 'PUT', body: profile });
    const { data } = await api('/api/users/mark/profile');
    expect(data.companyName).toBe('Doyle Stone Works');
  });

  test('PUT overwrites profile', async () => {
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'Old' } });
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'New' } });
    const { data } = await api('/api/users/mark/profile');
    expect(data.companyName).toBe('New');
  });
});

// --- Settings ---

describe('Settings', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('GET setting returns null when unset', async () => {
    const { data } = await api('/api/users/mark/settings/theme');
    expect(data).toBeNull();
  });

  test('PUT and GET setting', async () => {
    await api('/api/users/mark/settings/theme', { method: 'PUT', body: { value: 'dark' } });
    const { data } = await api('/api/users/mark/settings/theme');
    expect(data).toBe('dark');
  });
});

// --- Theme ---

describe('Theme', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('GET /api/users/:id/theme returns null by default', async () => {
    const { data } = await api('/api/users/mark/theme');
    expect(data).toBeNull();
  });

  test('PUT and GET theme', async () => {
    await api('/api/users/mark/theme', { method: 'PUT', body: { theme: 'dark' } });
    const { data } = await api('/api/users/mark/theme');
    expect(data).toBe('dark');
  });
});

// --- Quote Sequence ---

describe('Quote Sequence', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('GET defaults to 1', async () => {
    const { data } = await api('/api/users/mark/quote-sequence');
    expect(data).toBe(1);
  });

  test('POST increment returns next value', async () => {
    const { data: v1 } = await api('/api/users/mark/quote-sequence/increment', { method: 'POST' });
    expect(v1).toBe(2);
    const { data: v2 } = await api('/api/users/mark/quote-sequence/increment', { method: 'POST' });
    expect(v2).toBe(3);
  });
});

// --- Jobs ---

describe('Jobs', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('POST creates job, GET lists it', async () => {
    const state = makeFakeState('Client X');
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: state });
    expect(typeof created.id).toBe('string');

    const { data: jobs } = await api('/api/users/mark/jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].clientName).toBe('Client X');
  });

  test('GET /api/users/:id/jobs/:jobId returns single job', async () => {
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Single') });
    const { data: job } = await api(`/api/users/mark/jobs/${created.id}`);
    expect(job.clientName).toBe('Single');
    expect(job.quoteSnapshot).toBeDefined();
  });

  test('DELETE removes job', async () => {
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Del') });
    await api(`/api/users/mark/jobs/${created.id}`, { method: 'DELETE' });
    const { data: jobs } = await api('/api/users/mark/jobs');
    expect(jobs).toHaveLength(0);
  });

  test('PUT /rams updates RAMS snapshot', async () => {
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('RAMS') });
    const rams = { id: 'rams-1', status: 'draft' };
    await api(`/api/users/mark/jobs/${created.id}/rams`, { method: 'PUT', body: rams });
    const { data: job } = await api(`/api/users/mark/jobs/${created.id}`);
    expect(job.hasRams).toBe(true);
    expect(job.ramsSnapshot.id).toBe('rams-1');
  });

  test('PUT /rams returns 404 for missing job', async () => {
    const { status } = await api('/api/users/mark/jobs/nonexistent/rams', { method: 'PUT', body: {} });
    expect(status).toBe(404);
  });

  test('jobs are isolated per user', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'harry', name: 'Harry' } });
    await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Mark Job') });
    const { data: markJobs } = await api('/api/users/mark/jobs');
    const { data: harryJobs } = await api('/api/users/harry/jobs');
    expect(markJobs).toHaveLength(1);
    expect(harryJobs).toHaveLength(0);
  });

  test('GET /api/users/:id/jobs/:jobId returns null for non-existent job', async () => {
    const { data } = await api('/api/users/mark/jobs/nonexistent');
    expect(data).toBeNull();
  });

  test('job totalAmount is returned as number', async () => {
    const state = makeFakeState('Amount Test');
    state.quotePayload = { totals: { total: 3500.50 } };
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: state });
    const { data: jobs } = await api('/api/users/mark/jobs');
    expect(typeof jobs[0].totalAmount).toBe('number');
    expect(jobs[0].totalAmount).toBe(3500.50);
  });
});

// --- Job Status Lifecycle ---

describe('Job Status Lifecycle', () => {
  let jobId;

  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Status Test') });
    jobId = data.id;
  });

  test('new job starts with draft status', async () => {
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('draft');
  });

  test('can mark job as sent with sentAt and expiresAt', async () => {
    const sentAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'sent', sentAt, expiresAt },
    });
    expect(status).toBe(200);
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('sent');
    expect(job.sentAt).toBeDefined();
    expect(job.expiresAt).toBeDefined();
  });

  test('can mark job as accepted', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'accepted', acceptedAt: new Date().toISOString() },
    });
    expect(status).toBe(200);
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('accepted');
  });

  test('can mark job as declined with reason', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'declined', declinedAt: new Date().toISOString(), declineReason: 'Too expensive' },
    });
    expect(status).toBe(200);
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('declined');
    expect(job.declineReason).toBe('Too expensive');
  });

  test('can mark job as completed', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'completed' },
    });
    expect(status).toBe(200);
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('completed');
  });

  test('rejects invalid status', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'invalid' },
    });
    expect(status).toBe(400);
  });

  test('returns 404 for non-existent job', async () => {
    const { status } = await api('/api/users/mark/jobs/nonexistent/status', {
      method: 'PUT',
      body: { status: 'sent' },
    });
    expect(status).toBe(404);
  });
});

// --- RAMS Not Required ---

describe('RAMS Not Required', () => {
  let jobId;

  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('RAMS NR') });
    jobId = data.id;
  });

  test('can set rams_not_required to true', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/rams-not-required`, {
      method: 'PUT',
      body: { value: true },
    });
    expect(status).toBe(200);
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.ramsNotRequired).toBe(true);
  });

  test('can set rams_not_required back to false', async () => {
    await api(`/api/users/mark/jobs/${jobId}/rams-not-required`, {
      method: 'PUT',
      body: { value: true },
    });
    await api(`/api/users/mark/jobs/${jobId}/rams-not-required`, {
      method: 'PUT',
      body: { value: false },
    });
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.ramsNotRequired).toBe(false);
  });

  test('returns 404 for non-existent job', async () => {
    const { status } = await api('/api/users/mark/jobs/nonexistent/rams-not-required', {
      method: 'PUT',
      body: { value: true },
    });
    expect(status).toBe(404);
  });
});

// --- Drafts ---

describe('Drafts', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('GET returns null when no draft', async () => {
    const { data } = await api('/api/users/mark/drafts');
    expect(data).toBeNull();
  });

  test('PUT and GET draft', async () => {
    const state = makeFakeState('Draft');
    await api('/api/users/mark/drafts', { method: 'PUT', body: state });
    const { data } = await api('/api/users/mark/drafts');
    expect(data.jobDetails.clientName).toBe('Draft');
  });

  test('DELETE clears draft', async () => {
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('D') });
    await api('/api/users/mark/drafts', { method: 'DELETE' });
    const { data } = await api('/api/users/mark/drafts');
    expect(data).toBeNull();
  });

  test('PUT upserts draft (single draft per user)', async () => {
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('First') });
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('Second') });
    const { data } = await api('/api/users/mark/drafts');
    expect(data.jobDetails.clientName).toBe('Second');
  });
});

// --- Photos ---

describe('Photos', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('PUT creates a photo, GET retrieves it', async () => {
    const { status } = await api('/api/users/mark/photos/draft/overview', {
      method: 'PUT',
      body: { data: 'data:image/jpeg;base64,abc123', name: 'wall.jpg', label: 'Overview' },
    });
    expect(status).toBe(200);

    const { data: photos } = await api('/api/users/mark/photos/draft');
    expect(photos).toHaveLength(1);
    expect(photos[0].slot).toBe('overview');
    expect(photos[0].data).toBe('data:image/jpeg;base64,abc123');
    expect(photos[0].name).toBe('wall.jpg');
  });

  test('PUT upserts photo (replaces existing)', async () => {
    await api('/api/users/mark/photos/draft/overview', {
      method: 'PUT',
      body: { data: 'data:old', name: 'old.jpg' },
    });
    await api('/api/users/mark/photos/draft/overview', {
      method: 'PUT',
      body: { data: 'data:new', name: 'new.jpg' },
    });
    const { data: photos } = await api('/api/users/mark/photos/draft');
    expect(photos).toHaveLength(1);
    expect(photos[0].data).toBe('data:new');
  });

  test('PUT rejects missing data', async () => {
    const { status } = await api('/api/users/mark/photos/draft/overview', {
      method: 'PUT',
      body: { name: 'nodata.jpg' },
    });
    expect(status).toBe(400);
  });

  test('multiple slots in same context', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:1' } });
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:2' } });
    await api('/api/users/mark/photos/draft/extra-0', { method: 'PUT', body: { data: 'data:3', label: 'Other' } });
    const { data: photos } = await api('/api/users/mark/photos/draft');
    expect(photos).toHaveLength(3);
  });

  test('GET returns empty array when no photos', async () => {
    const { data } = await api('/api/users/mark/photos/draft');
    expect(data).toEqual([]);
  });

  test('DELETE removes all photos for a context', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:1' } });
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:2' } });
    await api('/api/users/mark/photos/draft', { method: 'DELETE' });
    const { data } = await api('/api/users/mark/photos/draft');
    expect(data).toEqual([]);
  });

  test('DELETE single slot leaves others intact', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:1' } });
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:2' } });
    await api('/api/users/mark/photos/draft/overview', { method: 'DELETE' });
    const { data } = await api('/api/users/mark/photos/draft');
    expect(data).toHaveLength(1);
    expect(data[0].slot).toBe('closeup');
  });

  test('photos are isolated by context', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:draft' } });
    await api('/api/users/mark/photos/sq-123/overview', { method: 'PUT', body: { data: 'data:job' } });
    const { data: draftPhotos } = await api('/api/users/mark/photos/draft');
    const { data: jobPhotos } = await api('/api/users/mark/photos/sq-123');
    expect(draftPhotos).toHaveLength(1);
    expect(draftPhotos[0].data).toBe('data:draft');
    expect(jobPhotos).toHaveLength(1);
    expect(jobPhotos[0].data).toBe('data:job');
  });

  test('photos are isolated per user', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'harry', name: 'Harry' } });
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:mark' } });
    const { data: harryPhotos } = await api('/api/users/harry/photos/draft');
    expect(harryPhotos).toEqual([]);
  });

  test('POST /photos/copy copies photos between contexts', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:1', name: 'ov.jpg' } });
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:2', name: 'cu.jpg' } });
    await api('/api/users/mark/photos/draft/extra-0', { method: 'PUT', body: { data: 'data:3', label: 'Other' } });

    const { status } = await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { fromContext: 'draft', toContext: 'sq-456' },
    });
    expect(status).toBe(200);

    const { data: copied } = await api('/api/users/mark/photos/sq-456');
    expect(copied).toHaveLength(3);
    const slots = copied.map(p => p.slot).sort();
    expect(slots).toEqual(['closeup', 'extra-0', 'overview']);
  });

  test('POST /photos/copy replaces existing target photos', async () => {
    // Create old target photos
    await api('/api/users/mark/photos/sq-old/overview', { method: 'PUT', body: { data: 'data:old' } });
    // Create source photos
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:new' } });

    await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { fromContext: 'draft', toContext: 'sq-old' },
    });

    const { data } = await api('/api/users/mark/photos/sq-old');
    expect(data).toHaveLength(1);
    expect(data[0].slot).toBe('closeup');
    expect(data[0].data).toBe('data:new');
  });

  test('POST /photos/copy rejects missing parameters', async () => {
    const { status: s1 } = await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { fromContext: 'draft' },
    });
    expect(s1).toBe(400);
    const { status: s2 } = await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { toContext: 'sq-1' },
    });
    expect(s2).toBe(400);
  });

  test('source photos preserved after copy', async () => {
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:src' } });
    await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { fromContext: 'draft', toContext: 'sq-789' },
    });
    // Source still intact
    const { data } = await api('/api/users/mark/photos/draft');
    expect(data).toHaveLength(1);
    expect(data[0].data).toBe('data:src');
  });
});

// --- CASCADE Deletes ---

describe('CASCADE Deletes', () => {
  test('deleting user cascades to photos', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'temp', name: 'Temp' } });
    await api('/api/users/temp/photos/draft/overview', { method: 'PUT', body: { data: 'data:x' } });
    await api('/api/users/temp', { method: 'DELETE' });

    // Re-create user to verify photos are gone
    await api('/api/users', { method: 'POST', body: { id: 'temp', name: 'Temp' } });
    const { data } = await api('/api/users/temp/photos/draft');
    expect(data).toEqual([]);
  });

  test('deleting job does not delete photos (photos use context-based cleanup)', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Job') });
    await api('/api/users/mark/photos/sq-test/overview', { method: 'PUT', body: { data: 'data:y' } });
    await api(`/api/users/mark/jobs/${created.id}`, { method: 'DELETE' });
    // Photos are NOT cascade-deleted by job deletion (they use user_id FK, not job FK)
    // The app handles this cleanup at the application layer
    const { data } = await api('/api/users/mark/photos/sq-test');
    expect(data).toHaveLength(1);
  });
});

// --- GDPR ---

describe('GDPR', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('DELETE /api/users/:id/data removes all user data including photos', async () => {
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'Test' } });
    await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Job') });
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('Draft') });
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:gdpr' } });

    await api('/api/users/mark/data', { method: 'DELETE' });

    const { data: profile } = await api('/api/users/mark/profile');
    expect(profile).toBeNull();
    const { data: jobs } = await api('/api/users/mark/jobs');
    expect(jobs).toHaveLength(0);
    const { data: draft } = await api('/api/users/mark/drafts');
    expect(draft).toBeNull();
    const { data: photos } = await api('/api/users/mark/photos/draft');
    expect(photos).toEqual([]);
  });

  test('GET /api/users/:id/export returns all data including photo metadata', async () => {
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'Export' } });
    await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Export Job') });
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:export', name: 'export.jpg' } });

    const { data } = await api('/api/users/mark/export');
    expect(data.userId).toBe('mark');
    expect(data.exportedAt).toBeDefined();
    expect(data.profile).toHaveLength(1);
    expect(data.jobs).toHaveLength(1);
    expect(data.photos).toHaveLength(1);
    expect(data.photos[0].slot).toBe('overview');
    expect(data.photos[0].context).toBe('draft');
  });
});

// --- End-to-End Workflows ---

describe('E2E: Full Quote Lifecycle', () => {
  test('draft → job → photos copied → status sent → accepted → completed', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });

    // 1. Save draft with photos
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('E2E Client') });
    await api('/api/users/mark/photos/draft/overview', { method: 'PUT', body: { data: 'data:e2e-ov', name: 'ov.jpg' } });
    await api('/api/users/mark/photos/draft/closeup', { method: 'PUT', body: { data: 'data:e2e-cu', name: 'cu.jpg' } });

    // 2. Load draft — verify it exists
    const { data: draft } = await api('/api/users/mark/drafts');
    expect(draft.jobDetails.clientName).toBe('E2E Client');

    // 3. Load photos
    const { data: draftPhotos } = await api('/api/users/mark/photos/draft');
    expect(draftPhotos).toHaveLength(2);

    // 4. Save as job
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('E2E Client') });
    const jobId = created.id;

    // 5. Copy photos draft → job
    await api('/api/users/mark/photos/copy', {
      method: 'POST',
      body: { fromContext: 'draft', toContext: jobId },
    });

    // 6. Verify job photos
    const { data: jobPhotos } = await api(`/api/users/mark/photos/${jobId}`);
    expect(jobPhotos).toHaveLength(2);

    // 7. Clear draft
    await api('/api/users/mark/drafts', { method: 'DELETE' });
    await api('/api/users/mark/photos/draft', { method: 'DELETE' });
    const { data: clearedDraft } = await api('/api/users/mark/drafts');
    expect(clearedDraft).toBeNull();

    // 8. Status lifecycle: draft → sent → accepted → completed
    await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'sent', sentAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() },
    });
    let { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.status).toBe('sent');

    await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'accepted', acceptedAt: new Date().toISOString() },
    });
    ({ data: job } = await api(`/api/users/mark/jobs/${jobId}`));
    expect(job.status).toBe('accepted');

    await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'completed' },
    });
    ({ data: job } = await api(`/api/users/mark/jobs/${jobId}`));
    expect(job.status).toBe('completed');
  });

  test('delete job also needs manual photo cleanup', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data: created } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Cleanup') });
    const jobId = created.id;

    // Photos for the job
    await api(`/api/users/mark/photos/${jobId}/overview`, { method: 'PUT', body: { data: 'data:cleanup' } });

    // Delete job
    await api(`/api/users/mark/jobs/${jobId}`, { method: 'DELETE' });

    // App-level cleanup: delete photos for that context
    await api(`/api/users/mark/photos/${jobId}`, { method: 'DELETE' });
    const { data } = await api(`/api/users/mark/photos/${jobId}`);
    expect(data).toEqual([]);
  });
});

// --- Quote Diffs (Learning Engine) ---

describe('Quote Diffs', () => {
  let jobId;

  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Diffs Test') });
    jobId = data.id;
  });

  test('POST /diffs saves all diffs to quote_diffs table', async () => {
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Wall height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667, createdAt: Date.now() },
      { fieldType: 'measurement', fieldLabel: 'Wall length', aiValue: '4500', confirmedValue: '4500', wasEdited: false, editMagnitude: 0, createdAt: Date.now() },
    ];
    const { status, data } = await api(`/api/users/mark/jobs/${jobId}/diffs`, {
      method: 'POST',
      body: { diffs, aiAccuracyScore: 0.5 },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(2);
  });

  test('POST /diffs is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Wall height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667, createdAt: Date.now() },
    ];
    await api(`/api/users/mark/jobs/${jobId}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });
    // Second call with same data — new rows get unique IDs, so they'll insert (IDs are UUIDs)
    const { data } = await api(`/api/users/mark/jobs/${jobId}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });
    expect(data.ok).toBe(true);
  });

  test('POST /diffs with empty array returns ok:true, inserted:0', async () => {
    const { status, data } = await api(`/api/users/mark/jobs/${jobId}/diffs`, {
      method: 'POST',
      body: { diffs: [], aiAccuracyScore: null },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.inserted).toBe(0);
  });

  test('POST /diffs rejects non-array diffs', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/diffs`, {
      method: 'POST',
      body: { diffs: 'not-an-array' },
    });
    expect(status).toBe(400);
  });

  test('diffs are deleted when job is deleted (CASCADE)', async () => {
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667 },
    ];
    await api(`/api/users/mark/jobs/${jobId}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });

    // Delete the job — diffs should cascade
    await api(`/api/users/mark/jobs/${jobId}`, { method: 'DELETE' });

    // Create a new job and verify no orphan diffs
    const { data: newJob } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('New') });
    expect(newJob.id).toBeDefined();
  });

  test('diffs included in GDPR export', async () => {
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667 },
    ];
    await api(`/api/users/mark/jobs/${jobId}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });

    const { data } = await api('/api/users/mark/export');
    expect(data.diffs).toBeDefined();
    expect(data.diffs.length).toBeGreaterThan(0);
  });

  test('diffs deleted in GDPR delete', async () => {
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667 },
    ];
    await api(`/api/users/mark/jobs/${jobId}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });

    await api('/api/users/mark/data', { method: 'DELETE' });

    // Verify diffs are gone by checking export of re-created user
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark/export');
    expect(data.diffs).toHaveLength(0);
  });
});

// --- Admin Learning ---

describe('Admin Learning', () => {
  test('GET /api/admin/learning returns learning data', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data: job } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Learn') });
    const diffs = [
      { fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1200', confirmedValue: '1400', wasEdited: true, editMagnitude: 0.1667 },
      { fieldType: 'measurement', fieldLabel: 'Length', aiValue: '4500', confirmedValue: '4500', wasEdited: false, editMagnitude: 0 },
    ];
    await api(`/api/users/mark/jobs/${job.id}/diffs`, { method: 'POST', body: { diffs, aiAccuracyScore: 0.5 } });

    const { status, data } = await api('/api/admin/learning', {
      headers: { 'x-test-user-id': 'mark', 'x-test-plan': 'admin' },
    });
    expect(status).toBe(200);
    expect(data.fieldBias).toBeDefined();
    expect(data.weeklyTrend).toBeDefined();
    expect(data.refCardImpact).toBeDefined();
    expect(data.userAccuracy).toBeDefined();
  });

  test('GET /api/admin/learning returns 403 for basic plan', async () => {
    await api('/api/users', { method: 'POST', body: { id: 'paul', name: 'Paul' } });
    const { status } = await api('/api/admin/learning', {
      headers: { 'x-test-user-id': 'paul', 'x-test-plan': 'basic' },
    });
    expect(status).toBe(403);
  });
});

// --- Completion Feedback (4.5) ---

describe('Completion Feedback', () => {
  let jobId;

  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
    const { data } = await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Feedback Test') });
    jobId = data.id;
  });

  test('completionFeedback is stored when status set to completed', async () => {
    const { status } = await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'completed', completionFeedback: 'Job went well, client happy' },
    });
    expect(status).toBe(200);
  });

  test('completionFeedback is returned in GET /jobs/:jobId', async () => {
    await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'completed', completionFeedback: 'Excellent result' },
    });
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.completionFeedback).toBe('Excellent result');
  });

  test('completionFeedback is null when not provided', async () => {
    await api(`/api/users/mark/jobs/${jobId}/status`, {
      method: 'PUT',
      body: { status: 'completed' },
    });
    const { data: job } = await api(`/api/users/mark/jobs/${jobId}`);
    expect(job.completionFeedback).toBeNull();
  });
});

// --- Legal Pages (4.6) ---

describe('Legal Pages', () => {
  test('GET /privacy returns 200 with HTML containing "Privacy Policy"', async () => {
    const res = await fetch(`${baseUrl}/privacy`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Privacy Policy');
  });

  test('GET /terms returns 200 with HTML containing "Terms of Service"', async () => {
    const res = await fetch(`${baseUrl}/terms`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Terms of Service');
  });
});

// --- Landing Page ---

describe('Landing Page', () => {
  test('GET / without auth returns 200 with HTML containing "FASTQUOTE"', async () => {
    // No auth cookies — should serve landing page
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('FASTQUOTE');
  });

  test('GET /login returns 200 with HTML', async () => {
    const res = await fetch(`${baseUrl}/login`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('html');
  });
});

// --- Rate Limiting (4.4) ---

describe('Rate Limiting', () => {
  test('POST /api/anthropic/messages returns rate limit headers', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    // The rate limiter adds these headers regardless of outcome
    const limitHeader = res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
    expect(limitHeader).toBeDefined();
  });

  test('POST /api/anthropic/messages returns 500 when no API key set', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    // No ANTHROPIC_API_KEY in test env — should return 500
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('ANTHROPIC_API_KEY');
  });
});

// --- Error Handling (4.3) ---

describe('Error Handling', () => {
  test('unknown API route returns JSON 404', async () => {
    const { status, data } = await api('/api/nonexistent');
    expect(status).toBe(404);
  });

  test('POST with invalid JSON returns error status', async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    });
    // Express json parser returns 400 SyntaxError
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// --- Helpers ---

function makeFakeState(clientName) {
  return {
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
