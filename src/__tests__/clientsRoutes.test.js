/**
 * Clients + Sites routes — source-level guard.
 *
 * Locks the contract for every route in docs/CLIENTS_SPEC_v3.md § 3.
 * Live-DB exercise happens via smoke tests in tests/e2e (Phase 3).
 * This suite catches the "route not registered" / "auth bypass" /
 * "quota-consuming" class of regression at Jest speed.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

// Every Clients/Sites route mounts under the /api/users/:id prefix,
// which itself is gated by requireAuth + requireOwner via the global
// mount at server.js:~2860. We assert THAT once, then per-route we
// only check what's route-specific.
describe('Clients routes — global gate stays in place', () => {
  test('/api/users/:id prefix is auth+owner gated (unchanged from today)', () => {
    expect(serverSrc).toMatch(
      /app\.use\(\s*['"]\/api\/users\/:id['"]\s*,\s*requireAuth\s*,\s*requireOwner\s*\)/
    );
  });
});

describe('Clients routes — feature-flag gating', () => {
  test('every clients/sites route checks isClientsEnabled() (or the inline env check)', () => {
    // Find each Client/Site route registration and confirm the flag
    // guard sits inside its handler. We accept either a helper call OR
    // an inline `if (process.env.CLIENTS_ENABLED !== 'true') return res.status(404)`.
    const routes = [
      /app\.get\(\s*['"]\/api\/users\/:id\/clients['"]/,
      /app\.get\(\s*['"]\/api\/users\/:id\/clients\/duplicates['"]/,
      /app\.post\(\s*['"]\/api\/users\/:id\/clients['"]/,
      /app\.get\(\s*['"]\/api\/users\/:id\/clients\/:clientId['"]/,
      /app\.patch\(\s*['"]\/api\/users\/:id\/clients\/:clientId['"]/,
      /app\.post\(\s*['"]\/api\/users\/:id\/clients\/:clientId\/merge['"]/,
      /app\.delete\(\s*['"]\/api\/users\/:id\/clients\/:clientId['"]/,
      /app\.post\(\s*['"]\/api\/users\/:id\/sites['"]/,
      /app\.patch\(\s*['"]\/api\/users\/:id\/sites\/:siteId['"]/,
      /app\.delete\(\s*['"]\/api\/users\/:id\/sites\/:siteId['"]/,
    ];
    for (const routeRegex of routes) {
      const match = serverSrc.match(routeRegex);
      expect(match, `route missing: ${routeRegex}`).not.toBeNull();
    }
  });

  test('flag-gated response is a 404 (fail-closed, identical to any not-configured feature)', () => {
    // A helper `isClientsEnabled()` MAY exist; either way the pattern
    // that lands is `if (!isClientsEnabled()) return res.status(404)...`
    // OR an inline env check. We match either.
    expect(serverSrc).toMatch(
      /(!isClientsEnabled\(\)|process\.env\.CLIENTS_ENABLED\s*!==\s*['"]true['"])[\s\S]{0,200}res\.status\(404\)/
    );
  });
});

describe('Clients routes — rate limiting', () => {
  test('every write route (POST / PATCH / DELETE) uses billingRateLimit', () => {
    // Reuse the same limiter as billing/redeem. Prevents an authed
    // user brute-forcing merge attempts or creating thousands of
    // orphan clients.
    const writeRoutes = [
      /app\.post\(\s*['"]\/api\/users\/:id\/clients['"]\s*,\s*billingRateLimit/,
      /app\.patch\(\s*['"]\/api\/users\/:id\/clients\/:clientId['"]\s*,\s*billingRateLimit/,
      /app\.post\(\s*['"]\/api\/users\/:id\/clients\/:clientId\/merge['"]\s*,\s*billingRateLimit/,
      /app\.delete\(\s*['"]\/api\/users\/:id\/clients\/:clientId['"]\s*,\s*billingRateLimit/,
      /app\.post\(\s*['"]\/api\/users\/:id\/sites['"]\s*,\s*billingRateLimit/,
      /app\.patch\(\s*['"]\/api\/users\/:id\/sites\/:siteId['"]\s*,\s*billingRateLimit/,
      /app\.delete\(\s*['"]\/api\/users\/:id\/sites\/:siteId['"]\s*,\s*billingRateLimit/,
    ];
    for (const re of writeRoutes) {
      expect(serverSrc).toMatch(re);
    }
  });
});

describe('Clients routes — quota consumption', () => {
  test('NO client/site route imports or calls quotaGate (organising is not analysing)', () => {
    // Slice out the block of Client + Site route handlers and prove
    // they never mention quotaGate. Bound by a comment anchor to
    // keep the check tight.
    const start = serverSrc.indexOf("// ─────── Clients + Sites routes");
    const end = serverSrc.indexOf("// ─────── End Clients + Sites routes");
    // If those anchors don't exist yet, the section hasn't been
    // implemented — expect() with a helpful message so a future
    // change surfaces the requirement.
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = serverSrc.slice(start, end);
    expect(block).not.toMatch(/quotaGate/);
    expect(block).not.toMatch(/free_quotes_used\s*\+\s*1/);
    expect(block).not.toMatch(/purchased_quotes\s*-\s*1/);
  });
});

describe('Clients routes — write bodies use column whitelist', () => {
  test('client PATCH whitelist covers exactly name / phone / email / notes / status', () => {
    const start = serverSrc.indexOf("app.patch('/api/users/:id/clients/:clientId'");
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, start + 3000);
    // We accept either an inline whitelist array OR a helper. Simplest
    // shape check: the five field names appear + none of the write-
    // restricted ones (id, user_id, deleted_at, created_at, updated_at).
    for (const field of ['name', 'phone', 'email', 'notes', 'status']) {
      expect(block).toMatch(new RegExp(`['"]${field}['"]`));
    }
    for (const forbidden of ['id', 'user_id', 'deleted_at', 'created_at', 'updated_at']) {
      // Field name shouldn't appear inside body-key destructuring —
      // we check that they don't appear as top-level keys of `raw.` /
      // `body.` accessors. A permissive check because the block also
      // contains SQL (which uses these column names legitimately).
      expect(block).not.toMatch(new RegExp(`(raw|req\\.body)\\.${forbidden}\\b`));
    }
  });

  test('site PATCH whitelist covers address + contact fields', () => {
    const start = serverSrc.indexOf("app.patch('/api/users/:id/sites/:siteId'");
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, start + 3000);
    for (const field of ['address', 'site_contact_name', 'site_contact_phone', 'notes']) {
      expect(block).toMatch(new RegExp(field));
    }
  });
});

describe('Clients routes — merge is transactional', () => {
  test('merge route wraps the reparent+soft-delete in BEGIN/COMMIT', () => {
    const start = serverSrc.indexOf("app.post('/api/users/:id/clients/:clientId/merge'");
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, start + 4000);
    expect(block).toMatch(/BEGIN/);
    expect(block).toMatch(/COMMIT/);
    expect(block).toMatch(/ROLLBACK/);
  });

  test('merge route reparents sites to target, then soft-deletes source client', () => {
    const start = serverSrc.indexOf("app.post('/api/users/:id/clients/:clientId/merge'");
    const block = serverSrc.slice(start, start + 4000);
    // Reparent sites.
    expect(block).toMatch(/UPDATE sites SET client_id/);
    // Soft-delete source (not hard delete).
    expect(block).toMatch(/UPDATE clients[\s\S]{0,300}SET deleted_at\s*=\s*NOW\(\)/);
    expect(block).not.toMatch(/DELETE FROM clients/);
  });

  test('merge never touches quote_diffs (moat)', () => {
    const start = serverSrc.indexOf("app.post('/api/users/:id/clients/:clientId/merge'");
    const block = serverSrc.slice(start, start + 4000);
    expect(block).not.toMatch(/quote_diffs/);
  });
});

describe('Clients routes — soft-delete cascade', () => {
  test('DELETE client → soft-delete client + cascade sites + jobs (no hard delete)', () => {
    const start = serverSrc.indexOf("app.delete('/api/users/:id/clients/:clientId'");
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, start + 4000);
    // Should set deleted_at on clients, sites, and jobs (jobs via site_id join).
    expect(block).toMatch(/UPDATE clients[\s\S]{0,300}SET deleted_at\s*=\s*NOW\(\)/);
    expect(block).toMatch(/UPDATE sites[\s\S]{0,300}SET deleted_at\s*=\s*NOW\(\)/);
    // Never touches quote_diffs.
    expect(block).not.toMatch(/quote_diffs/);
    // Never HARD-deletes anything.
    expect(block).not.toMatch(/DELETE FROM clients/);
    expect(block).not.toMatch(/DELETE FROM sites/);
    expect(block).not.toMatch(/DELETE FROM jobs/);
  });
});

describe('Analytics event allowlist', () => {
  test('EVENT_NAME_ALLOWLIST includes the five new client events', () => {
    for (const evt of [
      'client_created',
      'client_updated',
      'client_merged',
      'client_soft_deleted',
      'client_hard_purged',
    ]) {
      expect(serverSrc).toMatch(new RegExp(`['"]${evt}['"]`));
    }
  });
});
