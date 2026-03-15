/**
 * API Integration Tests for TradeQuote Express Server
 *
 * These tests require a running Postgres database.
 * Set DATABASE_URL env var before running.
 * Run: DATABASE_URL=postgres://... node --experimental-vm-modules node_modules/.bin/jest src/__tests__/api.test.js --runInBand
 */

import { app, pool } from '../../server.js';
import http from 'http';

let server;
let baseUrl;

beforeAll(async () => {
  // Init schema
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value JSONB,
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        client_name TEXT,
        site_address TEXT,
        quote_reference TEXT,
        quote_date TEXT,
        total_amount NUMERIC DEFAULT 0,
        has_rams BOOLEAN DEFAULT FALSE,
        quote_snapshot JSONB,
        rams_snapshot JSONB
      );
      CREATE TABLE IF NOT EXISTS drafts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        data JSONB NOT NULL
      );
    `);
  } finally {
    client.release();
  }

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
  // Clean all tables before each test
  await pool.query('DELETE FROM drafts');
  await pool.query('DELETE FROM jobs');
  await pool.query('DELETE FROM settings');
  await pool.query('DELETE FROM profiles');
  await pool.query('DELETE FROM users');
});

async function api(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
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
});

// --- GDPR ---

describe('GDPR', () => {
  beforeEach(async () => {
    await api('/api/users', { method: 'POST', body: { id: 'mark', name: 'Mark' } });
  });

  test('DELETE /api/users/:id/data removes all user data', async () => {
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'Test' } });
    await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Job') });
    await api('/api/users/mark/drafts', { method: 'PUT', body: makeFakeState('Draft') });

    await api('/api/users/mark/data', { method: 'DELETE' });

    const { data: profile } = await api('/api/users/mark/profile');
    expect(profile).toBeNull();
    const { data: jobs } = await api('/api/users/mark/jobs');
    expect(jobs).toHaveLength(0);
    const { data: draft } = await api('/api/users/mark/drafts');
    expect(draft).toBeNull();
  });

  test('GET /api/users/:id/export returns all data', async () => {
    await api('/api/users/mark/profile', { method: 'PUT', body: { companyName: 'Export' } });
    await api('/api/users/mark/jobs', { method: 'POST', body: makeFakeState('Export Job') });

    const { data } = await api('/api/users/mark/export');
    expect(data.userId).toBe('mark');
    expect(data.exportedAt).toBeDefined();
    expect(data.profile).toHaveLength(1);
    expect(data.jobs).toHaveLength(1);
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
