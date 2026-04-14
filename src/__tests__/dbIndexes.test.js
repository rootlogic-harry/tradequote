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

  test('has index on calibration_notes(status)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_calibration_notes_status ON calibration_notes(status)');
  });

  test('has composite index on users(auth_provider, auth_provider_id)', () => {
    expect(serverSource).toContain('CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider, auth_provider_id)');
  });
});
