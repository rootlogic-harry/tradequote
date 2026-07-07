/**
 * Edit-details PATCH extension — source-level guard.
 *
 * Paul's PR #111 shipped `PATCH /api/users/:id/jobs/:jobId/details`.
 * With Clients live (CLIENTS_ENABLED=true), that route MUST also
 * update the Client + Site rows so the CURRENT truth doesn't drift
 * from the quote-snapshot HISTORICAL truth.
 *
 * When the flag is OFF, the route MUST behave exactly as today — no
 * Client/Site touches, PATCH is byte-identical to its pre-Clients
 * shape (protects rollback lever 1).
 *
 * See docs/CLIENTS_SPEC_v3.md § 3 (routes) + § 5 (address propagation).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

const ROUTE_ANCHOR = "app.patch('/api/users/:id/jobs/:jobId/details'";
const routeBlock = (() => {
  const start = serverSrc.indexOf(ROUTE_ANCHOR);
  if (start === -1) return '';
  const rest = serverSrc.slice(start);
  const next = rest.search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
  return rest.slice(0, next > 0 ? next : 5000);
})();

describe('PATCH /jobs/:id/details — pre-existing shape preserved', () => {
  test('still whitelist-patches the same five fields', () => {
    for (const field of ['clientName', 'siteAddress', 'clientPhone', 'quoteDate', 'briefNotes']) {
      expect(routeBlock).toMatch(new RegExp(`raw\\.${field}`));
    }
  });

  test('still 404s on missing job (auth + ownership boundary unchanged)', () => {
    expect(routeBlock).toMatch(/Job not found/);
  });
});

describe('PATCH /jobs/:id/details — flag OFF, no Client/Site touches (rollback safety)', () => {
  test('the Client/Site UPDATE queries are gated by isClientsEnabled() (or the inline env check)', () => {
    // When the flag is off, the route must only touch quote_snapshot
    // and the denormalised columns — same as pre-Clients.
    expect(routeBlock).toMatch(
      /(isClientsEnabled\(\)|process\.env\.CLIENTS_ENABLED\s*===\s*['"]true['"])/
    );
  });
});

describe('PATCH /jobs/:id/details — flag ON, Client + Site rows updated', () => {
  test('when siteAddress in body → UPDATE sites SET address ...', () => {
    // The extension MUST propagate the address to sites.address when
    // the job carries a site_id. Not conditional on match — this is
    // the "Site row = CURRENT truth" invariant.
    expect(routeBlock).toMatch(/UPDATE sites\s+SET address/);
  });

  test('when clientName in body → UPDATE clients SET name ...', () => {
    expect(routeBlock).toMatch(/UPDATE clients\s+SET name/);
  });

  test('when clientPhone in body → UPDATE clients SET phone ...', () => {
    expect(routeBlock).toMatch(/UPDATE clients\s+SET[\s\S]{0,120}phone/);
  });

  test('scopes Site update to THIS job\'s site (via jobs.site_id lookup)', () => {
    // Never `WHERE 1=1` or address-based matching. Always via site_id.
    expect(routeBlock).toMatch(/site_id/);
    // The Site UPDATE should key off the site id we just looked up
    // from the job row.
    expect(routeBlock).toMatch(/UPDATE sites[\s\S]{0,300}WHERE id\s*=/);
  });

  test('scopes Client update to THIS site\'s client (via sites.client_id lookup)', () => {
    expect(routeBlock).toMatch(/client_id/);
    expect(routeBlock).toMatch(/UPDATE clients[\s\S]{0,300}WHERE id\s*=/);
  });

  test('all four writes (snapshot + site + client + audit) share a transaction', () => {
    // The route uses BEGIN/COMMIT so a mid-flight failure doesn't
    // leave the snapshot updated but the Site row stale.
    expect(routeBlock).toMatch(/BEGIN/);
    expect(routeBlock).toMatch(/COMMIT/);
    expect(routeBlock).toMatch(/ROLLBACK/);
  });
});

describe('PATCH /jobs/:id/details — historical/completed jobs at same site keep frozen copies', () => {
  test('does NOT loop over other jobs.quote_snapshot at the same site', () => {
    // Only the CURRENT job's snapshot is updated. Other jobs at the
    // same site retain their frozen historical copy — that's
    // deliberate per spec § 0 (HISTORICAL truth).
    // We check: the route updates quote_snapshot exactly ONCE (via
    // the existing pre-Clients path), NOT via a loop.
    const snapshotUpdates = (routeBlock.match(/UPDATE jobs\s+SET[\s\S]{0,200}quote_snapshot/g) || []).length;
    expect(snapshotUpdates).toBe(1);
  });
});
