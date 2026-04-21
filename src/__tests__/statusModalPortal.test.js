/**
 * StatusModal admin portal section (TRQ-133).
 *
 * Admins get a "Client Portal" audit section inside the existing
 * StatusModal when the job has a client_token. Basic users never see
 * this surface — it's part of the admin operating layer (design law).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────
// Server: detail route widening + admin gating for IP/UA
// ─────────────────────────────────────────────────────────────────────────
describe('GET /api/users/:id/jobs/:jobId — portal fields + admin-only IP/UA', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
  const detailBlock = serverSrc.match(
    /app\.get\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId['"`][\s\S]*?\n\}\)/
  );

  test('SELECT exposes the happy-path portal fields to all owners', () => {
    expect(detailBlock).not.toBeNull();
    const body = detailBlock[0];
    // Owner can always see their own job's portal status. No PII here.
    expect(body).toMatch(/client_token\s+AS\s+["']clientToken["']/i);
    expect(body).toMatch(/client_token_expires_at\s+AS\s+["']clientTokenExpiresAt["']/i);
    expect(body).toMatch(/client_viewed_at\s+AS\s+["']clientViewedAt["']/i);
    expect(body).toMatch(/client_response\s+AS\s+["']clientResponse["']/i);
    expect(body).toMatch(/client_response_at\s+AS\s+["']clientResponseAt["']/i);
    expect(body).toMatch(/client_decline_reason\s+AS\s+["']clientDeclineReason["']/i);
  });

  test('IP + user-agent are stripped unless the caller is on the admin plan', () => {
    // IP / user-agent can be used for soft fingerprinting of the
    // tradesman's clients. Keep them admin-visible only — same rule
    // that applies to every other admin operating-layer field (diffs,
    // agent runs, calibration notes).
    expect(detailBlock).not.toBeNull();
    const body = detailBlock[0];
    // Either a conditional DELETE on client_ip/client_user_agent for
    // non-admins, or the SELECT is plan-aware. Either is fine as long
    // as a non-admin caller cannot see these fields.
    const hasGate =
      /isAdminPlan|req\.user\?\.plan\s*===\s*['"]admin['"]|plan\s*!==\s*['"]admin['"]/i.test(body) &&
      /client_ip|client_user_agent/i.test(body);
    expect(hasGate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// StatusModal portal section — admin-only, gated on job.clientToken
// ─────────────────────────────────────────────────────────────────────────
describe('StatusModal.jsx — admin-only portal section', () => {
  const src = readFileSync(join(repoRoot, 'src/components/StatusModal.jsx'), 'utf8');

  test('imports the Client Portal helpers', () => {
    // Copy + Regenerate live here, so we need the same helpers the
    // Step-5 block uses (TRQ-131).
    expect(src).toMatch(/generateClientToken/);
  });

  test('portal section is gated on both isAdminPlan AND a job.clientToken', () => {
    // Basic users: never see it (design law).
    // Admins without a token: nothing to show.
    expect(src).toMatch(/isAdminPlan[\s\S]{0,100}clientToken|clientToken[\s\S]{0,100}isAdminPlan/);
  });

  test('renders the viewed audit trail (IP + when)', () => {
    // Admin-visible audit: when the client opened the link, from which
    // IP. Decline reason shows up below when present.
    expect(src).toMatch(/Viewed/);
    expect(src).toMatch(/clientIp|client_ip/);
  });

  test('has a Copy link button that writes to the clipboard', () => {
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
  });

  test('has a Regenerate action gated by a confirm dialog', () => {
    // Same design law as TRQ-131 — never silently invalidate a link
    // the tradesman already shared.
    expect(src).toMatch(/window\.confirm\(|showRegenerateConfirm/);
    expect(src).toMatch(/generateClientToken\(/);
  });
});
