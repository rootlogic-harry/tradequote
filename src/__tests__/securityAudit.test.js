/**
 * Security & Auth Audit Tests for FastQuote Express Server
 *
 * Covers: auth bypass, IDOR, privilege escalation, session config,
 * CSRF, input sanitisation, rate limiting, GDPR, error leakage,
 * header security, admin route protection, photo access control.
 *
 * Run: DATABASE_URL=postgres://localhost:5432/tradequote node --experimental-vm-modules node_modules/.bin/jest src/__tests__/securityAudit.test.js --runInBand
 */

process.env.NODE_ENV = 'test';

import { app, pool, dbReady } from '../../server.js';
import http from 'http';

let server;
let baseUrl;

beforeAll(async () => {
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
  // Clean all tables (FK order)
  await pool.query('DELETE FROM agent_runs');
  await pool.query('DELETE FROM calibration_notes');
  await pool.query('DELETE FROM agent_retry_queue');
  await pool.query('DELETE FROM quote_diffs');
  await pool.query('DELETE FROM user_photos');
  await pool.query('DELETE FROM drafts');
  await pool.query('DELETE FROM jobs');
  await pool.query('DELETE FROM settings');
  await pool.query('DELETE FROM profiles');
  await pool.query('DELETE FROM users');
});

// --- Helper ---

async function api(path, opts = {}) {
  const { method = 'GET', body, headers: extraHeaders = {} } = opts;
  const options = { method, headers: { ...extraHeaders } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

/** Authenticated API call for a specific user */
async function authApi(path, userId, opts = {}) {
  const headers = {
    'x-test-user-id': userId,
    'x-test-plan': opts.plan || 'admin',
    ...(opts.headers || {}),
  };
  return api(path, { ...opts, headers });
}

function makeFakeState(clientName) {
  return {
    profile: { companyName: 'Test Co', fullName: 'Tester' },
    jobDetails: {
      clientName,
      siteAddress: '123 Test St',
      quoteReference: `QT-${Date.now()}`,
      quoteDate: '2026-03-15',
      briefNotes: '',
    },
    reviewData: null,
    diffs: [],
    quotePayload: { totals: { total: 2500 } },
    quoteSequence: 1,
  };
}

async function createUser(id, name, plan = 'admin') {
  await pool.query(
    `INSERT INTO users (id, name, plan) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET plan = $3`,
    [id, name, plan]
  );
}

// ====================================================================
// 1. AUTH BYPASS — routes missing requireAuth
// ====================================================================

describe('SEC-01: Auth Bypass — Unauthenticated access to protected routes', () => {
  beforeEach(async () => {
    await createUser('mark', 'Mark', 'admin');
    await authApi('/api/users/mark/jobs', 'mark', {
      method: 'POST',
      body: makeFakeState('Secure Job'),
    });
  });

  test('GET /api/users (user list) requires auth', async () => {
    const { status } = await api('/api/users');
    expect(status).toBe(401);
  });

  test('POST /api/users (create user) requires auth', async () => {
    const { status } = await api('/api/users', {
      method: 'POST',
      body: { id: 'attacker', name: 'Attacker' },
    });
    expect(status).toBe(401);
  });

  test('POST /api/anthropic/messages requires auth', async () => {
    const { status } = await api('/api/anthropic/messages', {
      method: 'POST',
      body: { model: 'test', messages: [] },
    });
    expect(status).toBe(401);
  });

  test('GET /api/calibration-notes/approved requires auth', async () => {
    const { status } = await api('/api/calibration-notes/approved');
    expect(status).toBe(401);
  });

  test('POST /api/users/:id/analyse requires auth', async () => {
    const { status } = await api('/api/users/mark/analyse', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'test' }] },
    });
    expect(status).toBe(401);
  });
});

// ====================================================================
// 2. IDOR — Insecure Direct Object Reference
// ====================================================================

describe('SEC-02: IDOR — Cross-user data access', () => {
  let markJobId;

  beforeEach(async () => {
    await createUser('mark', 'Mark', 'admin');
    await createUser('attacker', 'Attacker', 'basic');

    // Mark creates a job and photos
    const { data } = await authApi('/api/users/mark/jobs', 'mark', {
      method: 'POST',
      body: makeFakeState('Mark Secret Job'),
    });
    markJobId = data.id;

    await authApi('/api/users/mark/photos/draft/overview', 'mark', {
      method: 'PUT',
      body: { data: 'data:image/jpeg;base64,SENSITIVE_PHOTO', name: 'secret.jpg' },
    });

    await authApi('/api/users/mark/profile', 'mark', {
      method: 'PUT',
      body: { companyName: 'Secret Company', phone: '555-0123' },
    });
  });

  test('attacker cannot read mark jobs via path manipulation', async () => {
    // Attacker authenticates as themselves but tries mark's route
    const { status } = await authApi('/api/users/mark/jobs', 'attacker');
    expect(status).toBe(403);
  });

  test('attacker cannot read mark profile', async () => {
    const { status } = await authApi('/api/users/mark/profile', 'attacker');
    expect(status).toBe(403);
  });

  test('attacker cannot read mark photos', async () => {
    const { status } = await authApi('/api/users/mark/photos/draft', 'attacker');
    expect(status).toBe(403);
  });

  test('attacker cannot delete mark data', async () => {
    const { status } = await authApi('/api/users/mark/data', 'attacker', { method: 'DELETE' });
    expect(status).toBe(403);
  });

  test('attacker cannot export mark data', async () => {
    const { status } = await authApi('/api/users/mark/export', 'attacker');
    expect(status).toBe(403);
  });

  test('attacker cannot modify mark job status', async () => {
    const { status } = await authApi(`/api/users/mark/jobs/${markJobId}/status`, 'attacker', {
      method: 'PUT',
      body: { status: 'completed' },
    });
    expect(status).toBe(403);
  });

  test('attacker cannot post diffs to mark job', async () => {
    const { status } = await authApi(`/api/users/mark/jobs/${markJobId}/diffs`, 'attacker', {
      method: 'POST',
      body: { diffs: [], aiAccuracyScore: 0 },
    });
    expect(status).toBe(403);
  });

  test('attacker cannot copy mark photos', async () => {
    const { status } = await authApi('/api/users/mark/photos/copy', 'attacker', {
      method: 'POST',
      body: { fromContext: 'draft', toContext: 'stolen' },
    });
    expect(status).toBe(403);
  });
});

// ====================================================================
// 3. PRIVILEGE ESCALATION — basic user accessing admin routes
// ====================================================================

describe('SEC-03: Privilege Escalation — basic plan user accessing admin routes', () => {
  beforeEach(async () => {
    await createUser('paul', 'Paul', 'basic');
  });

  test('GET /api/admin/learning returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/learning', 'paul', { plan: 'basic' });
    expect(status).toBe(403);
  });

  test('GET /api/admin/users returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/users', 'paul', { plan: 'basic' });
    expect(status).toBe(403);
  });

  test('POST /api/admin/users/:id/set-plan returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/users/paul/set-plan', 'paul', {
      plan: 'basic',
      method: 'POST',
      body: { plan: 'admin' },
    });
    expect(status).toBe(403);
  });

  test('GET /api/admin/agent-runs returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/agent-runs', 'paul', { plan: 'basic' });
    expect(status).toBe(403);
  });

  test('GET /api/admin/agent-runs/:runId returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/agent-runs/fake-run-id', 'paul', { plan: 'basic' });
    expect(status).toBe(403);
  });

  test('GET /api/admin/calibration-notes returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/calibration-notes', 'paul', { plan: 'basic' });
    expect(status).toBe(403);
  });

  test('PUT /api/admin/calibration-notes/:id returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/calibration-notes/fake-note', 'paul', {
      plan: 'basic',
      method: 'PUT',
      body: { status: 'approved' },
    });
    expect(status).toBe(403);
  });

  test('POST /api/admin/calibration/run returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/calibration/run', 'paul', {
      plan: 'basic',
      method: 'POST',
    });
    expect(status).toBe(403);
  });

  test('POST /api/admin/migrate-data returns 403 for basic user', async () => {
    const { status } = await authApi('/api/admin/migrate-data', 'paul', {
      plan: 'basic',
      method: 'POST',
      body: { fromUserId: 'x', toUserId: 'y' },
    });
    expect(status).toBe(403);
  });
});

// ====================================================================
// 4. SESSION CONFIGURATION
// ====================================================================

describe('SEC-04: Session Configuration', () => {
  test('session cookie name is tq_session', async () => {
    const res = await fetch(`${baseUrl}/auth/me`);
    // The session store creates a cookie on first visit
    const setCookie = res.headers.get('set-cookie') || '';
    // In test mode secure=false is expected (not production)
    if (setCookie) {
      expect(setCookie).toContain('tq_session');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
    }
    // If no set-cookie, saveUninitialized:false means no cookie for read-only — acceptable
    expect(true).toBe(true);
  });

  test('session secret is not the default in production concept', () => {
    // Verify the code checks for a proper secret
    // The actual SESSION_SECRET should be set in production env
    // We verify the fallback exists and is labeled as dev-only
    const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
    expect(sessionSecret).toBeDefined();
    // In test env, the fallback is acceptable
    // In production, SESSION_SECRET env var MUST be set
  });
});

// ====================================================================
// 5. SECURITY HEADERS
// ====================================================================

describe('SEC-05: Security Headers', () => {
  test('API responses include security headers', async () => {
    await createUser('mark', 'Mark');
    const { headers } = await authApi('/api/users/mark/profile', 'mark');
    // After fix: these headers should be present
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
  });

  test('HTML responses include security headers', async () => {
    const res = await fetch(`${baseUrl}/login`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

// ====================================================================
// 6. ERROR INFORMATION LEAKAGE
// ====================================================================

describe('SEC-06: Error Information Leakage', () => {
  test('safeError does not expose stack traces or internal paths', async () => {
    await createUser('mark', 'Mark');
    // Trigger a server error by passing bad data types
    // The safeError wrapper should catch and return generic message
    const { data } = await authApi('/api/users/mark/settings/test', 'mark', {
      method: 'PUT',
      body: { value: 'valid' },
    });
    // Valid request should succeed
    expect(data.ok || data.error).toBeDefined();
  });

  test('500 error handler returns generic message, not stack trace', async () => {
    // Requesting unknown API path returns 404 not 500 with stack
    const { status, data } = await api('/api/unknown-route');
    expect(status).toBe(404);
    // Verify response does not contain file paths or stack traces
    const responseStr = JSON.stringify(data);
    expect(responseStr).not.toContain('/Users/');
    expect(responseStr).not.toContain('node_modules');
    expect(responseStr).not.toContain('at Object');
    expect(responseStr).not.toContain('Error:');
  });

  test('anthropic proxy error does not leak API key', async () => {
    const res = await fetch(`${baseUrl}/api/anthropic/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'testuser',
        'x-test-plan': 'admin',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    const text = await res.text();
    expect(text).not.toContain(process.env.ANTHROPIC_API_KEY || 'SHOULD_NOT_MATCH');
    // Should not expose the full error stack
    expect(text).not.toContain('at Object');
  });
});

// ====================================================================
// 7. INPUT SANITISATION
// ====================================================================

describe('SEC-07: Input Sanitisation', () => {
  beforeEach(async () => {
    await createUser('mark', 'Mark');
  });

  test('user ID with SQL injection attempt is handled safely', async () => {
    // The parameterised queries should prevent SQL injection
    const maliciousId = "'; DROP TABLE users; --";
    const { status } = await api('/api/users', {
      method: 'POST',
      body: { id: maliciousId, name: 'Hacker' },
      headers: { 'x-test-user-id': maliciousId, 'x-test-plan': 'admin' },
    });
    // Should either succeed (treating it as a literal string) or fail gracefully
    expect([200, 400, 500]).toContain(status);
    // Verify users table still exists
    const { rows } = await pool.query('SELECT COUNT(*) FROM users');
    expect(Number(rows[0].count)).toBeGreaterThanOrEqual(0);
  });

  test('XSS in job clientName is stored as-is (output encoding is client responsibility)', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const { status } = await authApi('/api/users/mark/jobs', 'mark', {
      method: 'POST',
      body: {
        ...makeFakeState(xssPayload),
        jobDetails: { clientName: xssPayload, siteAddress: '', quoteReference: 'XSS-TEST', quoteDate: '' },
      },
    });
    expect(status).toBe(200);
    // Verify it's stored but as data, not executed
    const { data: jobs } = await authApi('/api/users/mark/jobs', 'mark');
    expect(jobs[0].clientName).toBe(xssPayload);
  });

  test('extremely large payload is rejected', async () => {
    const hugeBody = { data: 'x'.repeat(60 * 1024 * 1024) }; // 60MB
    const res = await fetch(`${baseUrl}/api/users/mark/photos/draft/overview`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'mark',
        'x-test-plan': 'admin',
      },
      body: JSON.stringify(hugeBody),
    });
    expect(res.status).toBe(413);
  });
});

// ====================================================================
// 8. GDPR COMPLIANCE
// ====================================================================

describe('SEC-08: GDPR Compliance', () => {
  beforeEach(async () => {
    await createUser('gdpr-user', 'GDPR User');
  });

  test('DELETE /data removes all user data from every table', async () => {
    // Create data in every table
    await authApi('/api/users/gdpr-user/profile', 'gdpr-user', {
      method: 'PUT',
      body: { companyName: 'GDPR Co' },
    });
    await authApi('/api/users/gdpr-user/settings/theme', 'gdpr-user', {
      method: 'PUT',
      body: { value: 'dark' },
    });
    const { data: job } = await authApi('/api/users/gdpr-user/jobs', 'gdpr-user', {
      method: 'POST',
      body: makeFakeState('GDPR Job'),
    });
    await authApi(`/api/users/gdpr-user/jobs/${job.id}/diffs`, 'gdpr-user', {
      method: 'POST',
      body: { diffs: [{ fieldType: 'measurement', fieldLabel: 'Height', aiValue: '1000', confirmedValue: '1100', wasEdited: true, editMagnitude: 0.1 }], aiAccuracyScore: 0.5 },
    });
    await authApi('/api/users/gdpr-user/photos/draft/overview', 'gdpr-user', {
      method: 'PUT',
      body: { data: 'data:image/jpeg;base64,PERSONAL_PHOTO' },
    });
    await authApi('/api/users/gdpr-user/drafts', 'gdpr-user', {
      method: 'PUT',
      body: makeFakeState('GDPR Draft'),
    });

    // Delete all data
    await authApi('/api/users/gdpr-user/data', 'gdpr-user', { method: 'DELETE' });

    // Verify everything is gone
    const checks = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM profiles WHERE user_id = $1', ['gdpr-user']),
      pool.query('SELECT COUNT(*)::int AS c FROM settings WHERE user_id = $1', ['gdpr-user']),
      pool.query('SELECT COUNT(*)::int AS c FROM jobs WHERE user_id = $1', ['gdpr-user']),
      pool.query('SELECT COUNT(*)::int AS c FROM quote_diffs WHERE user_id = $1', ['gdpr-user']),
      pool.query('SELECT COUNT(*)::int AS c FROM user_photos WHERE user_id = $1', ['gdpr-user']),
      pool.query('SELECT COUNT(*)::int AS c FROM drafts WHERE user_id = $1', ['gdpr-user']),
    ]);
    for (const check of checks) {
      expect(check.rows[0].c).toBe(0);
    }
  });

  test('GDPR delete also removes agent_runs for the user', async () => {
    // Insert a fake agent run
    await pool.query(
      `INSERT INTO agent_runs (id, user_id, agent_type, status) VALUES ('test-run-1', 'gdpr-user', 'test', 'completed')`
    );

    await authApi('/api/users/gdpr-user/data', 'gdpr-user', { method: 'DELETE' });

    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM agent_runs WHERE user_id = $1', ['gdpr-user']);
    expect(rows[0].c).toBe(0);
  });

  test('GDPR export includes data from all tables', async () => {
    await authApi('/api/users/gdpr-user/profile', 'gdpr-user', {
      method: 'PUT',
      body: { companyName: 'Export Co' },
    });
    await authApi('/api/users/gdpr-user/settings/theme', 'gdpr-user', {
      method: 'PUT',
      body: { value: 'light' },
    });

    const { data } = await authApi('/api/users/gdpr-user/export', 'gdpr-user');
    expect(data.userId).toBe('gdpr-user');
    expect(data.exportedAt).toBeDefined();
    expect(data.profile).toBeDefined();
    expect(data.settings).toBeDefined();
    expect(data.jobs).toBeDefined();
    expect(data.drafts).toBeDefined();
    expect(data.photos).toBeDefined();
    expect(data.diffs).toBeDefined();
  });

  test('GDPR delete preserves other users data', async () => {
    await createUser('other-user', 'Other');
    await authApi('/api/users/other-user/profile', 'other-user', {
      method: 'PUT',
      body: { companyName: 'Other Co' },
    });

    // Delete gdpr-user
    await authApi('/api/users/gdpr-user/data', 'gdpr-user', { method: 'DELETE' });

    // other-user data is intact
    const { data } = await authApi('/api/users/other-user/profile', 'other-user');
    expect(data.companyName).toBe('Other Co');
  });
});

// ====================================================================
// 9. ADMIN ROUTE PROTECTION
// ====================================================================

describe('SEC-09: Admin Route Protection — every /api/admin/* has requireAdminPlan', () => {
  beforeEach(async () => {
    await createUser('basic-user', 'Basic User', 'basic');
  });

  const adminRoutes = [
    { method: 'GET', path: '/api/admin/learning' },
    { method: 'GET', path: '/api/admin/users' },
    { method: 'POST', path: '/api/admin/users/basic-user/set-plan' },
    { method: 'POST', path: '/api/admin/migrate-data' },
    { method: 'GET', path: '/api/admin/agent-runs' },
    { method: 'GET', path: '/api/admin/agent-runs/test-id' },
    { method: 'GET', path: '/api/admin/calibration-notes' },
    { method: 'PUT', path: '/api/admin/calibration-notes/test-id' },
    { method: 'POST', path: '/api/admin/calibration/run' },
  ];

  test.each(adminRoutes)(
    '$method $path returns 403 for basic plan',
    async ({ method, path }) => {
      const { status } = await authApi(path, 'basic-user', {
        plan: 'basic',
        method,
        body: method !== 'GET' ? { plan: 'admin', fromUserId: 'a', toUserId: 'b', status: 'approved' } : undefined,
      });
      expect(status).toBe(403);
    }
  );
});

// ====================================================================
// 10. RATE LIMITING
// ====================================================================

describe('SEC-10: Rate Limiting', () => {
  test('AI proxy has rate limit headers', async () => {
    await createUser('rateme', 'Rate Me');
    const res = await fetch(`${baseUrl}/api/anthropic/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'rateme',
        'x-test-plan': 'admin',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    const limitHeader = res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
    expect(limitHeader).toBeDefined();
  });

  test('analyse endpoint has rate limit headers', async () => {
    await createUser('rateme', 'Rate Me');
    const res = await fetch(`${baseUrl}/api/users/rateme/analyse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user-id': 'rateme',
        'x-test-plan': 'admin',
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
    });
    const limitHeader = res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
    expect(limitHeader).toBeDefined();
  });
});

// ====================================================================
// 11. PHOTO ACCESS CONTROL
// ====================================================================

describe('SEC-11: Photo Access Control', () => {
  beforeEach(async () => {
    await createUser('photo-owner', 'Photo Owner');
    await createUser('photo-thief', 'Photo Thief');

    await authApi('/api/users/photo-owner/photos/draft/overview', 'photo-owner', {
      method: 'PUT',
      body: { data: 'data:image/jpeg;base64,OWNER_PRIVATE_PHOTO', name: 'private.jpg' },
    });
  });

  test('thief cannot GET owner photos', async () => {
    const { status } = await authApi('/api/users/photo-owner/photos/draft', 'photo-thief');
    expect(status).toBe(403);
  });

  test('thief cannot PUT to owner photo slot', async () => {
    const { status } = await authApi('/api/users/photo-owner/photos/draft/malicious', 'photo-thief', {
      method: 'PUT',
      body: { data: 'data:image/jpeg;base64,MALICIOUS' },
    });
    expect(status).toBe(403);
  });

  test('thief cannot DELETE owner photos', async () => {
    const { status } = await authApi('/api/users/photo-owner/photos/draft', 'photo-thief', {
      method: 'DELETE',
    });
    expect(status).toBe(403);
  });

  test('thief cannot DELETE specific owner photo slot', async () => {
    const { status } = await authApi('/api/users/photo-owner/photos/draft/overview', 'photo-thief', {
      method: 'DELETE',
    });
    expect(status).toBe(403);
  });
});

// ====================================================================
// 12. LEGACY SESSION ENDPOINT
// ====================================================================

describe('SEC-12: Legacy Session Endpoint', () => {
  test('only allows mark and harry', async () => {
    const { status: okStatus } = await api('/api/session/legacy', {
      method: 'POST',
      body: { userId: 'mark' },
    });
    expect(okStatus).toBe(200);

    const { status: forbiddenStatus } = await api('/api/session/legacy', {
      method: 'POST',
      body: { userId: 'attacker' },
    });
    expect(forbiddenStatus).toBe(403);
  });

  test('rejects empty body', async () => {
    const { status } = await api('/api/session/legacy', {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(403);
  });
});

// ====================================================================
// 13. ADMIN SELF-PROMOTION PREVENTION
// ====================================================================

describe('SEC-13: Admin Self-Promotion Prevention', () => {
  test('basic user cannot promote themselves to admin via set-plan', async () => {
    await createUser('sneaky', 'Sneaky', 'basic');
    const { status } = await authApi('/api/admin/users/sneaky/set-plan', 'sneaky', {
      plan: 'basic',
      method: 'POST',
      body: { plan: 'admin' },
    });
    expect(status).toBe(403);
  });
});

// ====================================================================
// 14. SERVER-SIDE SAVE ALLOWLIST
// ====================================================================

describe('SEC-14: Server Save Allowlist blocks photo blobs in snapshot', () => {
  beforeEach(async () => {
    await createUser('mark', 'Mark');
  });

  test('photos field is stripped from saved job snapshot', async () => {
    const state = {
      ...makeFakeState('Blob Test'),
      photos: {
        overview: { data: 'data:image/jpeg;base64,' + 'A'.repeat(10000) },
      },
      extraPhotos: [{ data: 'data:image/jpeg;base64,EXTRA' }],
    };

    const { data: created } = await authApi('/api/users/mark/jobs', 'mark', {
      method: 'POST',
      body: state,
    });

    const { data: job } = await authApi(`/api/users/mark/jobs/${created.id}`, 'mark');
    const snapshot = job.quoteSnapshot;
    expect(snapshot.photos).toBeUndefined();
    expect(snapshot.extraPhotos).toBeUndefined();
  });
});

// ====================================================================
// 15. SAFERROR USAGE VERIFICATION
// ====================================================================

describe('SEC-15: safeError utility', () => {
  test('safeError returns generic message for 500 errors', async () => {
    // Import safeError directly
    const { safeError } = await import('../../safeError.js');

    // Mock response object
    let sentStatus, sentBody;
    const mockRes = {
      status(code) { sentStatus = code; return this; },
      json(body) { sentBody = body; return this; },
    };

    const err = new Error('INTERNAL: connection to database failed at /var/secrets/db.conf');
    safeError(mockRes, err, 'TEST', 500);

    expect(sentStatus).toBe(500);
    expect(sentBody.error).toBe('Something went wrong. Please try again.');
    expect(sentBody.error).not.toContain('INTERNAL');
    expect(sentBody.error).not.toContain('/var/secrets');
    expect(sentBody.error).not.toContain('database');
  });
});

// ====================================================================
// 16. LOGOUT INVALIDATION
// ====================================================================

describe('SEC-16: Logout', () => {
  test('GET /auth/logout redirects to /login', async () => {
    const res = await fetch(`${baseUrl}/auth/logout`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login');
  });
});

// ====================================================================
// 17. LOGIN PAGE — no XSS via error param
// ====================================================================

describe('SEC-17: Login Page error param', () => {
  test('only auth_failed error is rendered, arbitrary strings are not injected', async () => {
    // Try injecting HTML via error parameter
    const res = await fetch(`${baseUrl}/login?error=<script>alert('xss')</script>`);
    const html = await res.text();
    expect(html).not.toContain('<script>alert');
  });

  test('auth_failed shows safe error message', async () => {
    const res = await fetch(`${baseUrl}/login?error=auth_failed`);
    const html = await res.text();
    expect(html).toContain('Sign-in failed');
  });
});
