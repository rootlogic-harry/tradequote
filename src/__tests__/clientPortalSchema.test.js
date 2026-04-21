/**
 * Schema & route-presence tests for the Client Portal foundation (TRQ-124).
 *
 * These read server.js as source and assert the SQL migrations + route
 * registrations exist. Mirrors the pattern in dbIndexes.test.js and
 * saveAllowlistServer.test.js — avoids the cost of booting Express.
 *
 * Security claims this file protects:
 *   - Client portal columns are additive only (CREATE TABLE never altered)
 *   - Partial index on client_token to speed the GET /q/:token lookup
 *   - Token generation route is mounted under the owner-scoped prefix
 *     (app.use('/api/users/:id', requireAuth, requireOwner, …))
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('Client Portal schema — additive columns on jobs', () => {
  const cols = [
    ['client_token', 'TEXT UNIQUE'],
    ['client_token_expires_at', 'TIMESTAMPTZ'],
    ['client_snapshot', 'JSONB'],
    ['client_snapshot_profile', 'JSONB'],
    ['client_viewed_at', 'TIMESTAMPTZ'],
    ['client_response', 'TEXT'],
    ['client_response_at', 'TIMESTAMPTZ'],
    ['client_decline_reason', 'TEXT'],
    ['client_ip', 'TEXT'],
    ['client_user_agent', 'TEXT'],
  ];

  test.each(cols)('has ALTER TABLE jobs ADD COLUMN IF NOT EXISTS %s %s', (col, type) => {
    const pattern = new RegExp(
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ${col}\\s+${type.replace(/ /g, '\\s+')}`,
      'i'
    );
    expect(serverSource).toMatch(pattern);
  });
});

describe('Client Portal indexes', () => {
  test('has partial index on jobs(client_token) WHERE client_token IS NOT NULL', () => {
    // Partial index keeps it small — only rows with an active portal link
    // are indexed. Speeds up GET /q/:token lookups without bloating writes
    // on every draft.
    expect(serverSource).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_jobs_client_token ON jobs\(client_token\)\s+WHERE client_token IS NOT NULL/
    );
  });
});

describe('Client Portal token routes are mounted', () => {
  test('POST /api/users/:id/jobs/:jobId/client-token route is registered', () => {
    expect(serverSource).toMatch(
      /app\.post\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/client-token['"`]/
    );
  });

  test('GET /api/users/:id/jobs/:jobId/client-status route is registered', () => {
    expect(serverSource).toMatch(
      /app\.get\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/client-status['"`]/
    );
  });

  test('routes live under the owner-scoped prefix (inherit requireAuth + requireOwner)', () => {
    // The existing `app.use('/api/users/:id', requireAuth, requireOwner)`
    // guard is the single source of ownership enforcement for per-user
    // routes. Any new per-user client-portal route must sit under this
    // prefix so it cannot be reached without the guards.
    expect(serverSource).toMatch(
      /app\.use\(\s*['"`]\/api\/users\/:id['"`]\s*,\s*requireAuth\s*,\s*requireOwner/
    );
    // And our new routes are children of that prefix.
    expect(serverSource).toMatch(/['"`]\/api\/users\/:id\/jobs\/:jobId\/client-token['"`]/);
    expect(serverSource).toMatch(/['"`]\/api\/users\/:id\/jobs\/:jobId\/client-status['"`]/);
  });

  test('token generator uses crypto.randomUUID (not Math.random, not timestamps)', () => {
    // Hard requirement — if a future refactor replaces this with anything
    // guessable, the client portal's security model collapses.
    //
    // server.js goes through the audited helper in src/utils/clientToken.js.
    // Accept either the helper import + call, or a direct crypto.randomUUID
    // use — both are safe; anything else is not.
    const usesHelper =
      /import\s*\{[\s\S]*generateClientToken[\s\S]*\}\s*from\s*['"`]\.\/src\/utils\/clientToken\.js['"`]/.test(
        serverSource
      ) && /generateClientToken\(\)/.test(serverSource);
    const usesDirectUUID = /crypto\.randomUUID\(\)/.test(serverSource);
    expect(usesHelper || usesDirectUUID).toBe(true);
    // Scope the Math.random ban to the client-token route body only —
    // elsewhere in server.js it's used for non-security IDs (e.g. user
    // id suffixes, saved-job IDs) which is fine.
    const tokenRouteMatch = serverSource.match(
      /app\.post\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/client-token['"`][\s\S]*?\n\}\)/
    );
    expect(tokenRouteMatch).not.toBeNull();
    const routeCode = tokenRouteMatch[0]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(routeCode).not.toMatch(/Math\.random\s*\(/);
    expect(routeCode).not.toMatch(/Date\.now\(\)\s*\.toString/);
  });
});

describe('Client Portal token generation — freezes snapshot + profile', () => {
  test('token UPDATE sets both client_snapshot AND client_snapshot_profile', () => {
    // The frozen-view contract: once a token is generated, neither the
    // live quote_snapshot nor the live profile can change what the client
    // sees. If this UPDATE ever writes only one of the two, it's a bug.
    const tokenRouteMatch = serverSource.match(
      /app\.post\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/client-token['"`][\s\S]*?\n\}\)/
    );
    expect(tokenRouteMatch).not.toBeNull();
    const routeBody = tokenRouteMatch[0];
    expect(routeBody).toMatch(/client_snapshot\s*=/);
    expect(routeBody).toMatch(/client_snapshot_profile\s*=/);
  });

  test('regenerating a token resets all response + audit fields to NULL', () => {
    // Security: regenerating must not leave stale response metadata that
    // could leak across a wrong-recipient recovery (e.g. the old client
    // accepted; the tradesman regenerates to send to the right client —
    // the new link must start clean).
    const tokenRouteMatch = serverSource.match(
      /app\.post\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/client-token['"`][\s\S]*?\n\}\)/
    );
    const routeBody = tokenRouteMatch[0];
    for (const field of [
      'client_viewed_at',
      'client_response',
      'client_response_at',
      'client_decline_reason',
      'client_ip',
      'client_user_agent',
    ]) {
      expect(routeBody).toMatch(new RegExp(`${field}\\s*=\\s*NULL`));
    }
  });
});
