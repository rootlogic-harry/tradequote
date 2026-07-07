/**
 * Clients + Sites schema — source-level guard.
 *
 * Locks the DDL against server.js so a future refactor can't
 * silently drop a column, forget an index, or accidentally make the
 * FK `ON DELETE CASCADE` (Client deletion is application-controlled;
 * see docs/CLIENTS_SPEC_v3.md § 6 for the moat-safe reason).
 *
 * All migrations are additive — `CREATE TABLE IF NOT EXISTS` and
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

describe('clients table — schema', () => {
  test('CREATE TABLE IF NOT EXISTS clients', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS clients/);
  });

  test('has expected columns', () => {
    // Grab a generous window after the CREATE so we can look at the
    // whole column list at once.
    const start = serverSrc.indexOf('CREATE TABLE IF NOT EXISTS clients');
    const block = serverSrc.slice(start, start + 1400);
    for (const col of [
      /id\s+TEXT PRIMARY KEY DEFAULT gen_random_uuid/,
      /user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
      /name\s+TEXT NOT NULL/,
      /phone\s+TEXT/,
      /email\s+TEXT/,
      /notes\s+TEXT/,
      /status\s+TEXT NOT NULL DEFAULT 'active'/,
      /deleted_at\s+TIMESTAMPTZ/,
      /created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/,
      /updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/,
    ]) {
      expect(block).toMatch(col);
    }
  });

  test('partial index on user_id (excludes soft-deleted rows)', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS clients_user_id_idx[\s\S]{0,200}WHERE deleted_at IS NULL/
    );
  });

  test('partial index on (user_id, status) for filtered list view', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS clients_user_status_idx[\s\S]{0,200}\(user_id, status\)[\s\S]{0,200}WHERE deleted_at IS NULL/
    );
  });

  test('partial index on lower(name) for case-insensitive lookup during placeholder-on-save', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS clients_user_name_idx[\s\S]{0,200}lower\(name\)[\s\S]{0,200}WHERE deleted_at IS NULL/
    );
  });
});

describe('sites table — schema', () => {
  test('CREATE TABLE IF NOT EXISTS sites', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS sites/);
  });

  test('has expected columns', () => {
    const start = serverSrc.indexOf('CREATE TABLE IF NOT EXISTS sites');
    const block = serverSrc.slice(start, start + 1400);
    for (const col of [
      /id\s+TEXT PRIMARY KEY DEFAULT gen_random_uuid/,
      /user_id\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
      // Option A: client_id is a required FK. Deletion is app-controlled,
      // so this FK MUST NOT carry ON DELETE CASCADE.
      /client_id\s+TEXT NOT NULL REFERENCES clients\(id\)/,
      /address\s+TEXT NOT NULL/,
      /site_contact_name\s+TEXT/,
      /site_contact_phone\s+TEXT/,
      /notes\s+TEXT/,
      /deleted_at\s+TIMESTAMPTZ/,
      /created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/,
      /updated_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/,
    ]) {
      expect(block).toMatch(col);
    }
  });

  test('client_id FK is NOT ON DELETE CASCADE (moat-safe deletion is app-controlled)', () => {
    const start = serverSrc.indexOf('CREATE TABLE IF NOT EXISTS sites');
    const block = serverSrc.slice(start, start + 1400);
    // client_id line specifically — the user_id line above IS cascade,
    // that's fine (user delete should cascade to their sites).
    const clientIdLine = block.match(/client_id\s+TEXT NOT NULL REFERENCES clients\(id\)[^,]*/);
    expect(clientIdLine).not.toBeNull();
    expect(clientIdLine[0]).not.toMatch(/ON DELETE CASCADE/);
  });

  test('partial index on client_id (Client detail page rollup query)', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS sites_client_id_idx[\s\S]{0,200}\(client_id\)[\s\S]{0,200}WHERE deleted_at IS NULL/
    );
  });

  test('partial index on user_id', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS sites_user_id_idx[\s\S]{0,200}WHERE deleted_at IS NULL/
    );
  });
});

describe('jobs.site_id — additive column', () => {
  test('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_id (nullable)', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_id TEXT REFERENCES sites\(id\)/
    );
  });

  test('site_id has NO NOT NULL constraint (legacy jobs continue to work)', () => {
    const match = serverSrc.match(
      /ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_id[^;]*/
    );
    expect(match).not.toBeNull();
    expect(match[0]).not.toMatch(/NOT NULL/);
  });

  test('partial index on site_id (excludes NULL for legacy jobs)', () => {
    expect(serverSrc).toMatch(
      /CREATE INDEX IF NOT EXISTS jobs_site_id_idx[\s\S]{0,200}\(site_id\)[\s\S]{0,200}WHERE site_id IS NOT NULL/
    );
  });
});

describe('feature flag — CLIENTS_ENABLED', () => {
  test('isClientsEnabled() helper exists (or inline check on process.env.CLIENTS_ENABLED)', () => {
    // Accept either a helper function OR an inline check. What matters
    // is that the string CLIENTS_ENABLED is referenced somewhere.
    expect(serverSrc).toMatch(/CLIENTS_ENABLED/);
  });

  test('checks for exact "true" string (fail-closed on any other value)', () => {
    // process.env.CLIENTS_ENABLED === 'true' — same pattern as
    // EMAIL_INTEGRATION_ENABLED and VIDEO_ANALYSIS_ENABLED.
    expect(serverSrc).toMatch(
      /process\.env\.CLIENTS_ENABLED\s*===\s*['"]true['"]/
    );
  });
});
