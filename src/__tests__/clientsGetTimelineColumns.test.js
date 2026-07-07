/**
 * GET /clients/:clientId timeline SELECT — column-existence guard.
 *
 * PR #123 introduced a timeline SELECT that referenced `j.completed_at`.
 * That column does not exist on the `jobs` table — completion is
 * signalled by `status = 'completed'` alone. Every ClientDetail open
 * 500'd from PR #123 launch until Harry's 2026-07-07 UAT surfaced it
 * ("getting an error when i select a client").
 *
 * This suite scans the timeline SELECT and asserts every `j.<column>`
 * reference maps to a real column on the `jobs` table (from either the
 * CREATE TABLE or an ALTER TABLE ADD COLUMN in server.js).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

/** Grab the block starting at GET /clients/:clientId up to the next route. */
function getClientRouteBlock() {
  const start = serverSrc.indexOf(
    "app.get('/api/users/:id/clients/:clientId'",
  );
  if (start === -1) return '';
  const rest = serverSrc.slice(start);
  const next = rest.slice(1).search(/\napp\.(?:get|post|put|patch|delete|use)\(/);
  return rest.slice(0, next > 0 ? next + 1 : 6000);
}

/** Collect the set of column names declared on the `jobs` table. */
function collectJobsColumns() {
  const cols = new Set();
  const createStart = serverSrc.indexOf('CREATE TABLE IF NOT EXISTS jobs (');
  if (createStart !== -1) {
    // Paren-count from the opening `(` to find the matching close.
    // Naive `.indexOf(')')` stops at `REFERENCES users(id)` etc.
    const openIdx = serverSrc.indexOf('(', createStart);
    let depth = 0;
    let end = openIdx;
    for (let i = openIdx; i < serverSrc.length; i++) {
      const ch = serverSrc[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = serverSrc.slice(openIdx + 1, end);
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s+/i);
      if (m) cols.add(m[1].toLowerCase());
    }
  }
  const alterRe = /ALTER TABLE jobs ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = alterRe.exec(serverSrc)) !== null) {
    cols.add(m[1].toLowerCase());
  }
  return cols;
}

describe('GET /clients/:clientId timeline — column existence', () => {
  const block = getClientRouteBlock();
  const jobsCols = collectJobsColumns();

  test('block is found (sanity)', () => {
    expect(block.length).toBeGreaterThan(500);
    expect(jobsCols.size).toBeGreaterThan(10);
  });

  test('does NOT reference j.completed_at (the 2026-07-07 regression)', () => {
    // Load-bearing: this is THE column that caused the 500. If a future
    // PR reintroduces it — either add the column to the schema OR use
    // status='completed' — this test fails.
    expect(block).not.toMatch(/\bj\.completed_at\b/);
  });

  test('every j.<column> reference in the timeline SELECT exists on jobs', () => {
    const referenced = new Set();
    const re = /\bj\.([a-z_][a-z0-9_]*)\b/gi;
    let m;
    while ((m = re.exec(block)) !== null) {
      referenced.add(m[1].toLowerCase());
    }
    const missing = [...referenced].filter((c) => !jobsCols.has(c));
    expect(missing).toEqual([]);
  });
});
