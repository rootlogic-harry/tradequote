/**
 * PATCH /api/users/:id/jobs/:jobId/details — source-level contract guard.
 *
 * Paul Clough's metadata-edit route (2026-06-30). The key invariants:
 *   - Whitelisted body keys only. quotePayload / reviewData / diffs
 *     are NOT touchable here.
 *   - Length caps applied server-side so a malformed paste can't
 *     bloat the snapshot column.
 *   - SELECT … FOR UPDATE then UPDATE wraps the read-modify-write
 *     so two concurrent edits don't race over the JSONB blob.
 *   - Denormalised columns (client_name, site_address, quote_date)
 *     stay in lockstep with the JSONB jobDetails.
 *   - Analytics event quote_details_edited fires on success only.
 *
 * Live-DB exercise is in api.test.js; this suite locks the wire
 * contract against the server.js source so regressions are caught
 * in fast CI.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const userDbSrc = readFileSync(join(repoRoot, 'src/utils/userDB.js'), 'utf8');

describe('PATCH route registration', () => {
  test('mounted with billingRateLimit (same shape as other money-adjacent endpoints)', () => {
    expect(serverSrc).toMatch(
      /app\.patch\(\s*['"]\/api\/users\/:id\/jobs\/:jobId\/details['"]\s*,\s*billingRateLimit\s*,/
    );
  });

  test('cites Paul Clough\'s feedback so the why is preserved in comments', () => {
    expect(serverSrc).toMatch(/Paul Clough's real-user feedback/);
  });
});

describe('PATCH body whitelist + length caps', () => {
  const ROUTE_START = "app.patch('/api/users/:id/jobs/:jobId/details'";
  const block = (() => {
    const start = serverSrc.indexOf(ROUTE_START);
    if (start === -1) return '';
    // Stop at the next `app.<verb>(` registration.
    const rest = serverSrc.slice(start);
    const next = rest.search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
    return rest.slice(0, next > 0 ? next : 4000);
  })();

  test('only reads the five whitelisted keys from req.body', () => {
    for (const key of ['clientName', 'siteAddress', 'clientPhone', 'quoteDate', 'briefNotes']) {
      expect(block).toMatch(new RegExp(`raw\\.${key}`));
    }
    // Negative — must NOT read keys that would let the caller mutate
    // numbers, diffs, status, etc.
    expect(block).not.toMatch(/raw\.reviewData/);
    expect(block).not.toMatch(/raw\.quotePayload/);
    expect(block).not.toMatch(/raw\.diffs/);
    expect(block).not.toMatch(/raw\.status/);
    expect(block).not.toMatch(/raw\.quoteReference/);
  });

  test('applies a length cap to every accepted field', () => {
    expect(block).toMatch(/clamp\(raw\.clientName,\s*200\)/);
    expect(block).toMatch(/clamp\(raw\.siteAddress,\s*300\)/);
    expect(block).toMatch(/clamp\(raw\.clientPhone,\s*40\)/);
    expect(block).toMatch(/clamp\(raw\.quoteDate,\s*24\)/);
    expect(block).toMatch(/clamp\(raw\.briefNotes,\s*2000\)/);
  });

  test('400s when no editable fields are supplied (no silent no-op)', () => {
    expect(block).toMatch(/No editable fields supplied/);
  });
});

describe('PATCH atomicity + snapshot integrity', () => {
  // Extract the whole handler by finding the next `app.<verb>(`
  // boundary (2026-07-07, PR #124). Was a hardcoded +4000 which
  // fitted the pre-Clients handler; the propagation block pushed
  // it past that ceiling.
  const block = (() => {
    const start = serverSrc.indexOf("app.patch('/api/users/:id/jobs/:jobId/details'");
    if (start === -1) return '';
    const rest = serverSrc.slice(start);
    const next = rest.search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
    return rest.slice(0, next > 0 ? next : 8000);
  })();

  test('SELECT current snapshot with FOR UPDATE before the rewrite', () => {
    // 2026-07-07 (PR #124): Clients feature extended the SELECT list
    // to include site_id so the PATCH can propagate to sites/clients
    // rows when the flag is on. The core "get quote_snapshot under a
    // row lock" contract is unchanged.
    expect(block).toMatch(/SELECT quote_snapshot[\s\S]{0,80}FROM jobs[\s\S]{0,40}WHERE id = \$1 AND user_id = \$2 FOR UPDATE/);
  });

  test('merges jobDetails over previous values (no other snapshot key touched)', () => {
    expect(block).toMatch(/const newDetails = \{\s*\.\.\.prevDetails,\s*\.\.\.fieldsToPatch\s*\}/);
    expect(block).toMatch(/const newSnapshot = \{\s*\.\.\.snapshot,\s*jobDetails: newDetails\s*\}/);
  });

  test('UPDATE keeps denormalised columns in lockstep with the JSONB', () => {
    expect(block).toMatch(/UPDATE jobs[\s\S]{0,800}client_name\s*=\s*\$2/);
    expect(block).toMatch(/site_address\s*=\s*\$3/);
    expect(block).toMatch(/quote_date\s*=\s*\$4/);
    expect(block).toMatch(/saved_at\s*=\s*NOW\(\)/);
  });

  test('does NOT touch reviewData / quotePayload / diffs / status / quote_reference', () => {
    expect(block).not.toMatch(/reviewData\s*=/);
    expect(block).not.toMatch(/quotePayload\s*=/);
    expect(block).not.toMatch(/status\s*=/);
    expect(block).not.toMatch(/quote_reference\s*=/);
    expect(block).not.toMatch(/quote_diffs/);
  });

  test('404 when the job is not owned by the caller', () => {
    expect(block).toMatch(/Job not found/);
  });
});

describe('Analytics + audit', () => {
  test('quote_details_edited is on the EVENT_NAME_ALLOWLIST', () => {
    expect(serverSrc).toMatch(/['"]quote_details_edited['"]/);
  });

  test('fires the event only via the success path (best-effort)', () => {
    // Same next-app-verb boundary extraction as the atomicity block
    // above (2026-07-07, PR #124): the pre-Clients +4000 was too
    // small once the Site/Client propagation block landed.
    const block = (() => {
      const start = serverSrc.indexOf("app.patch('/api/users/:id/jobs/:jobId/details'");
      if (start === -1) return '';
      const rest = serverSrc.slice(start);
      const next = rest.search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
      return rest.slice(0, next > 0 ? next : 8000);
    })();
    expect(block).toMatch(/recordEvent\(\s*['"]quote_details_edited['"]/);
    expect(block).toMatch(/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  });

  test('logs the edited keys server-side for a future "address changed" audit query', () => {
    expect(serverSrc).toMatch(/\[Quote\] details edited: user=/);
  });
});

describe('Client helper userDB.patchJobDetails()', () => {
  test('exports a fetch wrapper that PATCHes /details', () => {
    expect(userDbSrc).toMatch(/export async function patchJobDetails/);
    expect(userDbSrc).toMatch(/method:\s*['"]PATCH['"]/);
    expect(userDbSrc).toMatch(/\/api\/users\/\$\{userId\}\/jobs\/\$\{jobId\}\/details/);
  });
});
