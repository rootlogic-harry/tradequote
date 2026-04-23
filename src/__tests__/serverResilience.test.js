/**
 * Server Resilience Tests
 *
 * Tests for bugs, race conditions, missing validation, and reliability
 * issues found during QA audit of server.js.
 *
 * Source-level scan tests do NOT require a database.
 * Integration tests (if added) would follow api.test.js patterns.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');

// === Source-level scan tests ===

describe('Race condition protections', () => {
  test('quote sequence increment is atomic (no read-then-write)', () => {
    // The old pattern was: SELECT value ... then INSERT/UPDATE with computed value.
    // This is vulnerable to TOCTOU race conditions.
    // The fix uses INSERT ... ON CONFLICT DO UPDATE SET value = (settings.value::int) + 1
    // in a single statement, which is atomic within Postgres.
    const incrementRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/quote-sequence/increment'"),
      serverSource.indexOf("'/api/users/:id/quote-sequence/increment'") + 600
    );

    // Should NOT have a separate SELECT then INSERT pattern
    const hasSelectThenInsert = incrementRoute.includes("SELECT value FROM settings") &&
      incrementRoute.includes("const next = current + 1");
    expect(hasSelectThenInsert).toBe(false);

    // Should have atomic UPDATE ... RETURNING pattern
    expect(incrementRoute).toContain('RETURNING value');
  });
});

describe('Status transition validation', () => {
  test('server validates status transitions with VALID_TRANSITIONS map', () => {
    expect(serverSource).toContain('VALID_TRANSITIONS');
    expect(serverSource).toContain("completed: []");
  });

  test('completed is a terminal state (no transitions out)', () => {
    const match = serverSource.match(/completed:\s*\[(.*?)\]/);
    expect(match).toBeTruthy();
    expect(match[1].trim()).toBe(''); // empty array — no transitions out
  });

  test('declined can transition to sent (re-send declined quote)', () => {
    const match = serverSource.match(/declined:\s*\[(.*?)\]/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain("'sent'");
  });

  test('accepted can only transition to completed', () => {
    const match = serverSource.match(/accepted:\s*\[(.*?)\]/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain("'completed'");
    // Should NOT contain 'sent', 'declined', or 'draft'
    expect(match[1]).not.toContain("'sent'");
    expect(match[1]).not.toContain("'declined'");
    expect(match[1]).not.toContain("'draft'");
  });
});

describe('Transaction safety', () => {
  test('photo copy uses transaction (BEGIN/COMMIT/ROLLBACK)', () => {
    // Find the photo copy route handler
    const copyStart = serverSource.indexOf("'/api/users/:id/photos/copy'");
    const copyEnd = serverSource.indexOf("// --- GDPR Routes ---");
    const copyRoute = serverSource.slice(copyStart, copyEnd);

    expect(copyRoute).toContain('BEGIN');
    expect(copyRoute).toContain('COMMIT');
    expect(copyRoute).toContain('ROLLBACK');
    expect(copyRoute).toContain('client.release()');
  });

  test('GDPR data delete uses transaction (BEGIN/COMMIT/ROLLBACK)', () => {
    // Find the GDPR delete route
    const gdprStart = serverSource.indexOf("'/api/users/:id/data'");
    const gdprEnd = serverSource.indexOf("'/api/users/:id/export'");
    const gdprRoute = serverSource.slice(gdprStart, gdprEnd);

    expect(gdprRoute).toContain('BEGIN');
    expect(gdprRoute).toContain('COMMIT');
    expect(gdprRoute).toContain('ROLLBACK');
    expect(gdprRoute).toContain('client.release()');
  });

  test('diffs route uses transaction', () => {
    const diffsStart = serverSource.indexOf("'/api/users/:id/jobs/:jobId/diffs'");
    const diffsEnd = serverSource.indexOf("// --- Admin Learning Dashboard");
    const diffsRoute = serverSource.slice(diffsStart, diffsEnd);

    expect(diffsRoute).toContain('BEGIN');
    expect(diffsRoute).toContain('COMMIT');
    expect(diffsRoute).toContain('ROLLBACK');
    expect(diffsRoute).toContain('client.release()');
  });

  test('admin migrate-data uses transaction', () => {
    const migrateStart = serverSource.indexOf("'/api/admin/migrate-data'");
    const migrateEnd = serverSource.indexOf("// --- Draft Routes ---");
    const migrateRoute = serverSource.slice(migrateStart, migrateEnd);

    expect(migrateRoute).toContain('BEGIN');
    expect(migrateRoute).toContain('COMMIT');
    expect(migrateRoute).toContain('ROLLBACK');
    expect(migrateRoute).toContain('client.release()');
  });
});

describe('safeError usage consistency', () => {
  test('analyse route uses safeError (not inline error messages)', () => {
    // Find the analyse route
    const analyseStart = serverSource.indexOf("'/api/users/:id/analyse'");
    const analyseEnd = serverSource.indexOf("// --- Error handler for body-parser");
    const analyseRoute = serverSource.slice(analyseStart, analyseEnd);

    // Should use safeError in the outer catch block
    expect(analyseRoute).toContain('safeError(res, err');

    // Should NOT have the old pattern of leaking error details to client
    expect(analyseRoute).not.toContain('Analysis error:');
    // Should NOT use res.status(502).json with err.message (the old bug)
    expect(analyseRoute).not.toMatch(/res\.status\(502\)\.json.*err\.message/);
  });

  test('route-level catch blocks use safeError (not bare res.status(500))', () => {
    // Route-level error handlers should use safeError, not bare res.status(500).json
    // Inner catch blocks (for logging/retrying) are allowed to use console.warn/error
    const routeSection = serverSource.slice(
      serverSource.indexOf('// --- User Registry Routes ---'),
      serverSource.indexOf('// --- Error handler for body-parser')
    );

    // Should NOT contain res.status(500).json with inline error messages
    // (safeError returns generic messages for 500s)
    expect(routeSection).not.toMatch(/res\.status\(500\)\.json\(\s*\{\s*error:\s*`/);
    expect(routeSection).not.toMatch(/res\.status\(500\)\.json\(\s*\{\s*error:\s*err\.message/);

    // safeError should be used multiple times (at least 15 routes use it)
    const safeErrorCount = (routeSection.match(/safeError\(res,/g) || []).length;
    expect(safeErrorCount).toBeGreaterThanOrEqual(15);
  });
});

describe('SQL injection prevention', () => {
  test('calibration note approval does not use string interpolation in SQL', () => {
    const calNoteSection = serverSource.slice(
      serverSource.indexOf("'/api/admin/calibration-notes/:noteId'"),
      serverSource.indexOf("'/api/admin/calibration-notes/:noteId'") + 600
    );

    // Should NOT contain ${...} inside a SQL query string
    // The old code had: approved_at = ${status === 'approved' ? 'NOW()' : 'NULL'}
    expect(calNoteSection).not.toMatch(/`[^`]*\$\{[^}]*status[^}]*\}[^`]*`/);

    // Should use parameterized query ($3 or $4 etc.)
    expect(calNoteSection).toContain('approved_at = $3');
  });

  test('all SQL queries use parameterized values (no string interpolation for user input)', () => {
    // Find all pool.query and client.query calls
    const queries = serverSource.match(/(?:pool|client)\.query\(\s*`[\s\S]*?`/g) || [];
    for (const query of queries) {
      // Check that no ${req.params...} or ${req.body...} or ${req.query...} appears
      expect(query).not.toMatch(/\$\{req\.(params|body|query)/);
    }
  });
});

describe('Input validation', () => {
  test('status update route validates req.body is not null', () => {
    const statusRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/jobs/:jobId/status'"),
      serverSource.indexOf("'/api/users/:id/jobs/:jobId/status'") + 400
    );

    expect(statusRoute).toContain("req.body");
    // Should have a body check before destructuring
    expect(statusRoute).toMatch(/req\.body.*typeof.*object|!req\.body/);
  });

  test('settings PUT validates req.body', () => {
    // Find the PUT route specifically (second occurrence of the settings path)
    const firstOccurrence = serverSource.indexOf("'/api/users/:id/settings/:key'");
    const putSettingsStart = serverSource.indexOf("app.put('/api/users/:id/settings/:key'", firstOccurrence);
    const settingsRoute = serverSource.slice(putSettingsStart, putSettingsStart + 500);

    // Should check body exists
    expect(settingsRoute).toContain('Request body is required');
  });

  test('diff fields are validated (fieldType, fieldLabel, aiValue, confirmedValue)', () => {
    const diffsRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/jobs/:jobId/diffs'"),
      serverSource.indexOf("'/api/users/:id/jobs/:jobId/diffs'") + 1500
    );

    expect(diffsRoute).toContain('fieldType');
    expect(diffsRoute).toContain('fieldLabel');
    expect(diffsRoute).toContain('aiValue');
    expect(diffsRoute).toContain('confirmedValue');
    expect(diffsRoute).toContain("Each diff must have");
  });

  test('POST /api/users validates body with null guard', () => {
    const usersRoute = serverSource.slice(
      serverSource.indexOf("app.post('/api/users'"),
      serverSource.indexOf("app.post('/api/users'") + 300
    );

    // Should destructure with fallback: req.body || {}
    expect(usersRoute).toContain('req.body || {}');
  });

  test('photo PUT requires data field', () => {
    const photoRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/photos/:context/:slot'"),
      serverSource.indexOf("'/api/users/:id/photos/:context/:slot'") + 300
    );

    expect(photoRoute).toContain("'data is required'");
  });

  test('photo copy requires fromContext and toContext', () => {
    const copyRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/photos/copy'"),
      serverSource.indexOf("'/api/users/:id/photos/copy'") + 300
    );

    expect(copyRoute).toContain("'fromContext and toContext required'");
  });
});

describe('Auth middleware coverage', () => {
  test('all /api/users/:id routes pass through requireAuth + requireOwner', () => {
    // The middleware app.use('/api/users/:id', requireAuth, requireOwner) should exist
    expect(serverSource).toContain(
      "app.use('/api/users/:id', requireAuth, requireOwner)"
    );
  });

  test('GET /api/users list route requires auth', () => {
    expect(serverSource).toMatch(/app\.get\('\/api\/users',\s*requireAuth/);
  });

  test('POST /api/users create route requires auth', () => {
    expect(serverSource).toMatch(/app\.post\('\/api\/users',\s*requireAuth/);
  });

  test('all admin routes require requireAuth and requireAdminPlan', () => {
    const adminRoutes = serverSource.match(/app\.(get|post|put|delete)\('\/api\/admin\/[^']+'/g) || [];
    expect(adminRoutes.length).toBeGreaterThan(0);

    for (const route of adminRoutes) {
      // Find the full route registration line
      const routeIdx = serverSource.indexOf(route);
      const routeLine = serverSource.slice(routeIdx, routeIdx + 200);
      expect(routeLine).toContain('requireAuth');
      expect(routeLine).toContain('requireAdminPlan');
    }
  });

  test('requireAuth test bypass is double-gated (sec-audit H-2)', () => {
    // Hardened: the bypass header is ignored unless BOTH
    // NODE_ENV !== 'production' AND ENABLE_TEST_AUTH=1. This protects
    // against an accidental NODE_ENV=test in production enabling
    // arbitrary user impersonation via the x-test-user-id header.
    const authFn = serverSource.slice(
      serverSource.indexOf('function requireAuth'),
      serverSource.indexOf('function requireOwner')
    );
    expect(authFn).toContain('TEST_AUTH_ENABLED');
    expect(authFn).toContain('x-test-user-id');
    // The constant must require the production check + the explicit
    // env var.
    expect(serverSource).toMatch(
      /TEST_AUTH_ENABLED\s*=[\s\S]*?NODE_ENV\s*!==\s*['"]production['"][\s\S]*?ENABLE_TEST_AUTH/
    );
  });

  test('Anthropic proxy requires auth', () => {
    expect(serverSource).toMatch(/\/api\/anthropic\/messages'.*requireAuth/);
  });
});

describe('Error handling completeness', () => {
  test('session destroy logs errors', () => {
    expect(serverSource).toContain('Session destroy error');
  });

  test('global error handler exists for body-parser errors', () => {
    expect(serverSource).toContain("entity.too.large");
    expect(serverSource).toContain("413");
  });

  test('multer error handler returns 413 for LIMIT_FILE_SIZE', () => {
    expect(serverSource).toMatch(/MulterError/);
    expect(serverSource).toMatch(/LIMIT_FILE_SIZE/);
    expect(serverSource).toMatch(/File too large/);
  });

  test('Anthropic proxy handles timeout', () => {
    expect(serverSource).toContain("proxyReq.on('timeout'");
    expect(serverSource).toContain('Request timed out');
  });

  test('SPA fallback returns 404 for unknown API routes', () => {
    const spaFallback = serverSource.slice(
      serverSource.indexOf("app.get('/{*path}'"),
      serverSource.indexOf("app.get('/{*path}'") + 300
    );
    expect(spaFallback).toContain("startsWith('/api')");
    expect(spaFallback).toContain('404');
  });
});

describe('Resource cleanup', () => {
  test('all pool.connect() calls have matching client.release() in finally blocks', () => {
    // Count pool.connect() calls
    const connects = (serverSource.match(/pool\.connect\(\)/g) || []).length;
    // Count client.release() calls
    const releases = (serverSource.match(/client\.release\(\)/g) || []).length;
    // Every connect should have a matching release
    expect(releases).toBeGreaterThanOrEqual(connects);
  });

  test('all transactions have ROLLBACK in catch blocks', () => {
    // Find all BEGIN statements
    const beginCount = (serverSource.match(/client\.query\('BEGIN'\)/g) || []).length;
    // Find all COMMIT statements
    const commitCount = (serverSource.match(/client\.query\('COMMIT'\)/g) || []).length;
    // Find all ROLLBACK statements
    const rollbackCount = (serverSource.match(/client\.query\('ROLLBACK'\)/g) || []).length;

    // Every BEGIN should have a matching COMMIT and ROLLBACK
    expect(commitCount).toBe(beginCount);
    expect(rollbackCount).toBeGreaterThanOrEqual(beginCount);
  });
});

describe('Security hardening', () => {
  test('security headers middleware exists', () => {
    expect(serverSource).toContain('X-Content-Type-Options');
    expect(serverSource).toContain('X-Frame-Options');
    expect(serverSource).toContain('Referrer-Policy');
    expect(serverSource).toContain('Permissions-Policy');
  });

  test('Express body parser has a size limit', () => {
    expect(serverSource).toMatch(/express\.json\(\s*\{[^}]*limit/);
  });

  test('session cookie is httpOnly', () => {
    expect(serverSource).toContain('httpOnly: true');
  });

  test('session cookie is secure in production (sec-audit L-1)', () => {
    // Hardened: now uses secure: 'auto' which resolves to true under
    // HTTPS. Previously NODE_ENV-conditional, which silently disabled
    // Secure if the env var was wrong.
    expect(serverSource).toContain("secure: 'auto'");
  });

  test('session cookie has sameSite', () => {
    expect(serverSource).toContain("sameSite: 'lax'");
  });

  test('rate limiter is applied to AI endpoints', () => {
    expect(serverSource).toContain("aiRateLimit");
    // Both AI endpoints should reference aiRateLimit in their route registration
    // The anthropic route may also have requireAuth before aiRateLimit
    expect(serverSource).toMatch(/\/api\/anthropic\/messages'.*aiRateLimit/);
    expect(serverSource).toMatch(/\/api\/users\/:id\/analyse'.*aiRateLimit/);
  });

  test('trust proxy is configured for Railway', () => {
    expect(serverSource).toContain("app.set('trust proxy', 1)");
  });
});

describe('Data integrity', () => {
  test('job save uses pickAllowedKeys to strip photos/blobs', () => {
    // Both POST and PUT job routes should use pickAllowedKeys
    const postJobStart = serverSource.indexOf("app.post('/api/users/:id/jobs'");
    const putJobStart = serverSource.indexOf("app.put('/api/users/:id/jobs/:jobId'");

    const postJob = serverSource.slice(postJobStart, postJobStart + 600);
    const putJob = serverSource.slice(putJobStart, putJobStart + 600);

    expect(postJob).toContain('pickAllowedKeys');
    expect(putJob).toContain('pickAllowedKeys');
  });

  test('job dedup uses a 10-minute window (widened from 30s in TRQ-137)', () => {
    expect(serverSource).toContain("INTERVAL '10 minutes'");
  });

  test('quote_diffs uses transactional DELETE + INSERT for idempotent replacement', () => {
    const diffsRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/jobs/:jobId/diffs'"),
      serverSource.indexOf("// --- Admin Learning Dashboard")
    );

    expect(diffsRoute).toContain('DELETE FROM quote_diffs WHERE job_id');
    expect(diffsRoute).toContain('INSERT INTO quote_diffs');
    expect(diffsRoute).toContain('BEGIN');
    expect(diffsRoute).toContain('COMMIT');
  });
});

describe('Edge case handling', () => {
  test('legacy session endpoint validates userId against whitelist', () => {
    expect(serverSource).toContain("LEGACY_USERS");
    expect(serverSource).toContain("LEGACY_USERS.includes(userId)");
  });

  test('admin set-plan validates plan against whitelist', () => {
    const setPlanRoute = serverSource.slice(
      serverSource.indexOf("'/api/admin/users/:id/set-plan'"),
      serverSource.indexOf("'/api/admin/users/:id/set-plan'") + 400
    );

    expect(setPlanRoute).toContain("['admin', 'basic']");
  });

  test('calibration note status validates against whitelist', () => {
    const calNoteRoute = serverSource.slice(
      serverSource.indexOf("'/api/admin/calibration-notes/:noteId'"),
      serverSource.indexOf("'/api/admin/calibration-notes/:noteId'") + 400
    );

    expect(calNoteRoute).toContain("['approved', 'rejected']");
  });

  test('photo copy body has null guard', () => {
    const copyRoute = serverSource.slice(
      serverSource.indexOf("'/api/users/:id/photos/copy'"),
      serverSource.indexOf("'/api/users/:id/photos/copy'") + 200
    );

    expect(copyRoute).toContain('req.body || {}');
  });
});
