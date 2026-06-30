/**
 * Lifecycle bug-hunt 2026-06-30 #1 — two-tab quote_reference collision.
 *
 * Two browser tabs open at the same Dashboard each NEW_QUOTE → both
 * increment state.quoteSequence to the same value → both POST with the
 * SAME quote_reference (e.g. "QT-2026-0006"). The 10-min server-side
 * dedup used to return tab A's job ID to tab B, after which tab B's
 * autosave called saveDiffs(userId, A, ...) which DELETE-INSERTed
 * over tab A's just-saved quote_diffs (a Do-Not-Touch moat table).
 *
 * Fix: send per-draft `quoteToken` (UUID from reducer state) with the
 * save POST. Server stores it on `jobs.quote_token` (additive column).
 * Dedup now refuses to return an existing row whose stored token
 * differs from the incoming one — tab B falls through to INSERT a
 * fresh job, leaving tab A's diffs intact.
 *
 * Source-level guards. Live-DB exercise is in api.test.js.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const userDbSrc = readFileSync(join(repoRoot, 'src/utils/userDB.js'), 'utf8');

describe('quote_token column on jobs (additive migration)', () => {
  test('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_token TEXT', () => {
    expect(serverSrc).toMatch(
      /ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_token TEXT/
    );
  });
});

describe('saveJob() sends quoteToken alongside the snapshot body', () => {
  test('top-level quoteToken from state.quoteToken is included in the POST body', () => {
    expect(userDbSrc).toMatch(
      /JSON\.stringify\(\s*\{\s*\.\.\.snapshot\s*,\s*quoteToken:\s*state\.quoteToken\s*\|\|\s*null\s*\}\s*\)/
    );
  });
});

describe('POST /api/users/:id/jobs token-aware dedup', () => {
  test('reads incoming quoteToken with length + alphabet validation', () => {
    expect(serverSrc).toMatch(/req\.body\?\.quoteToken/);
    expect(serverSrc).toMatch(/\/\^\[a-zA-Z0-9-\]\{1,64\}\$\//);
  });

  test('dedup SELECT pulls quote_token alongside id', () => {
    expect(serverSrc).toMatch(/SELECT id, quote_token FROM jobs/);
  });

  test('dedup only returns existing id when tokens match (or either is NULL)', () => {
    expect(serverSrc).toMatch(/const existingToken = existing\[0\]\.quote_token/);
    expect(serverSrc).toMatch(/tokensMatch[\s\S]{0,200}!existingToken \|\| !quoteToken \|\| existingToken === quoteToken/);
  });

  test('logs a warning when tokens differ (collision detected)', () => {
    expect(serverSrc).toMatch(/\[Save\] quote_reference collision/);
  });

  test('INSERT writes quote_token as the 11th value', () => {
    expect(serverSrc).toMatch(
      /INSERT INTO jobs[\s\S]{0,400}quote_token\)\s*VALUES \(\$1,[\s\S]{0,200}\$11\)/
    );
  });
});

describe('Token shape rules', () => {
  test('null or missing quoteToken is accepted (legacy / unauthenticated paths)', () => {
    // The /^[a-zA-Z0-9-]{1,64}$/ test followed by ternary-null pattern
    expect(serverSrc).toMatch(
      /const quoteToken = rawToken && \/\^\[a-zA-Z0-9-\]\{1,64\}\$\/\.test\(rawToken\) \? rawToken : null/
    );
  });
});
