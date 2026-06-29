import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('Database indexes', () => {
  test('has index on jobs(user_id)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)');
  });

  test('has index on jobs(status)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)');
  });

  test('has composite index on jobs(user_id, saved_at DESC) for the saved-quotes list', () => {
    // Without this, the Dashboard list query (ORDER BY saved_at DESC per user)
    // does a seq-scan + sort on the whole jobs table — slow once we have a
    // few hundred quotes per user.
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_jobs_user_saved_at ON jobs(user_id, saved_at DESC)');
  });

  test('has index on calibration_notes(status)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_calibration_notes_status ON calibration_notes(status)');
  });

  test('has composite index on users(auth_provider, auth_provider_id)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider, auth_provider_id)');
  });

  // 2026-06-29 — from the auth spec. Prevents the bug-shape behind
  // Pitfall #17: same human signs up twice (e.g. Google + a future
  // email flow, or two Google accounts with case-variant aliases) →
  // duplicate user rows + duplicate Stripe customers + billing splits.
  // Partial WHERE excludes legacy session-switcher rows that predate
  // the email column (e.g. 'mark', 'harry' from bootstrap inserts).
  test('has case-insensitive partial unique index on users(lower(email))', () => {
    expect(serverSource).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique\s+ON users\s*\(\s*lower\(email\)\s*\)\s+WHERE email IS NOT NULL/
    );
  });
});
