/**
 * Dashboard Client Portal badges (TRQ-132).
 *
 * Surfaces the portal lifecycle state on each job row: awaiting-view,
 * viewed, or link-expired. (Accepted / declined are already handled by
 * the existing StatusBadge.)
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────
// Server: GET /jobs includes portal lifecycle fields
// ─────────────────────────────────────────────────────────────────────────
describe('GET /api/users/:id/jobs — includes Client Portal lifecycle fields', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('SELECT exposes clientToken, expiry, viewedAt, response', () => {
    // We need the four fields the Dashboard badge logic keys on — but
    // NOT the IP, user-agent, or decline reason (those belong on the
    // admin-only detail route to minimise the payload the client
    // carries around).
    const listBlock = serverSrc.match(
      /app\.get\(\s*['"`]\/api\/users\/:id\/jobs['"`][\s\S]*?\n\}\)/
    );
    expect(listBlock).not.toBeNull();
    const body = listBlock[0];
    expect(body).toMatch(/client_token\s+AS\s+["']clientToken["']/i);
    expect(body).toMatch(/client_token_expires_at\s+AS\s+["']clientTokenExpiresAt["']/i);
    expect(body).toMatch(/client_viewed_at\s+AS\s+["']clientViewedAt["']/i);
    expect(body).toMatch(/client_response\s+AS\s+["']clientResponse["']/i);
  });

  test('list response does NOT leak client_ip / user_agent / decline_reason', () => {
    // Belt-and-braces on the payload size + privacy posture — nothing
    // here is secret per se, but the tradesman's own list view doesn't
    // need the client's IP to decide which badge to show.
    const listBlock = serverSrc.match(
      /app\.get\(\s*['"`]\/api\/users\/:id\/jobs['"`][\s\S]*?\n\}\)/
    );
    expect(listBlock[0]).not.toMatch(/client_ip\s+AS/i);
    expect(listBlock[0]).not.toMatch(/client_user_agent\s+AS/i);
    expect(listBlock[0]).not.toMatch(/client_decline_reason\s+AS/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PortalBadge component behaviour
// ─────────────────────────────────────────────────────────────────────────
describe('PortalBadge — variant resolution for each job state', () => {
  test('no token → null (no badge rendered)', async () => {
    const { resolvePortalBadgeKind } = await import('../utils/portalBadgeKind.js');
    expect(resolvePortalBadgeKind({ clientToken: null })).toBeNull();
    expect(resolvePortalBadgeKind({})).toBeNull();
  });

  test('token + not viewed + not expired → "await"', async () => {
    const { resolvePortalBadgeKind } = await import('../utils/portalBadgeKind.js');
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(resolvePortalBadgeKind({
      clientToken: 'uuid',
      clientTokenExpiresAt: future,
      clientViewedAt: null,
      clientResponse: null,
    })).toBe('await');
  });

  test('token + viewed + no response → "viewed"', async () => {
    const { resolvePortalBadgeKind } = await import('../utils/portalBadgeKind.js');
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(resolvePortalBadgeKind({
      clientToken: 'uuid',
      clientTokenExpiresAt: future,
      clientViewedAt: new Date().toISOString(),
      clientResponse: null,
    })).toBe('viewed');
  });

  test('token + expired + no response → "expired"', async () => {
    const { resolvePortalBadgeKind } = await import('../utils/portalBadgeKind.js');
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(resolvePortalBadgeKind({
      clientToken: 'uuid',
      clientTokenExpiresAt: past,
      clientViewedAt: null,
      clientResponse: null,
    })).toBe('expired');
  });

  test('response accepted → null (StatusBadge handles ACCEPTED)', async () => {
    // Avoid double-stamping the row. Once the client responds, the
    // existing StatusBadge (sent / accepted / declined) does the work.
    const { resolvePortalBadgeKind } = await import('../utils/portalBadgeKind.js');
    expect(resolvePortalBadgeKind({
      clientToken: 'uuid',
      clientResponse: 'accepted',
    })).toBeNull();
    expect(resolvePortalBadgeKind({
      clientToken: 'uuid',
      clientResponse: 'declined',
    })).toBeNull();
  });
});

describe('PortalBadge — rendered markup', () => {
  const src = readFileSync(join(repoRoot, 'src/components/PortalBadge.jsx'), 'utf8');

  test('emits .portal-badge + a variant class', () => {
    expect(src).toMatch(/portal-badge/);
    // Variant class is built from a template literal — look for either
    // the template expression or any of the three variant literals.
    expect(src).toMatch(/portal-badge--\$\{[^}]+\}|portal-badge--(await|viewed|expired)/);
  });

  test('includes the dot span so the pulse animation has a target', () => {
    expect(src).toMatch(/portal-badge-dot/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dashboard wiring
// ─────────────────────────────────────────────────────────────────────────
describe('Dashboard.jsx — renders PortalBadge alongside the existing status badge', () => {
  const src = readFileSync(join(repoRoot, 'src/components/Dashboard.jsx'), 'utf8');

  test('imports PortalBadge', () => {
    expect(src).toMatch(/import\s+PortalBadge\s+from/);
  });

  test('renders <PortalBadge job={…} />', () => {
    expect(src).toMatch(/<PortalBadge[^/]*job=\{/);
  });
});
