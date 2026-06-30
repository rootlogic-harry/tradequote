/**
 * Reducer behavioural-coverage gate.
 *
 * Discipline introduced 2026-06-30 after the SET_VIEW_MODE bug
 * (Harry: "selecting completed still does nothing — why didn't you
 * catch this in testing?"). The bug existed for 4 days because zero
 * tests covered SET_VIEW_MODE; the reducer's stale guard silently
 * swallowed mode='completed' and no shape-checking source-level test
 * could detect it.
 *
 * What this gate enforces:
 *   Every `case 'X':` in src/reducer.js MUST be referenced as
 *   `type: 'X'` (or `type:'X'`) in at least one test file under
 *   src/__tests__/. Adding a new reducer case without at least one
 *   behavioural test fails CI.
 *
 * What it doesn't enforce:
 *   The QUALITY of the test (it could be a one-liner). That's a
 *   judgement call for PR review. The gate is a floor, not a ceiling.
 *
 * Exception list (KNOWN_UNTESTED_CASES): empty by default. If a case
 * is genuinely untestable as a pure-function transition, add it here
 * with a justification — and the cost of doing so is visible in PR
 * review.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const reducerSrc = readFileSync(join(repoRoot, 'src/reducer.js'), 'utf8');
const testDir = __dirname;

// Cases the project has deliberately decided to skip. Empty today —
// every new entry needs a one-line justification + Harry's sign-off.
const KNOWN_UNTESTED_CASES = new Set([
  // example: ['ACTION_NAME', 'reason — keep it short'],
]);

function extractReducerCases(src) {
  const out = new Set();
  const re = /case\s+['"]([A-Z][A-Z0-9_]*)['"]\s*:/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out].sort();
}

function readAllTestFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.test.js')) continue;
    // Skip self — the gate file scans the OTHER tests.
    if (name === 'reducerCoverageGate.test.js') continue;
    files.push(join(dir, name));
  }
  return files;
}

function actionsReferencedInTests(testFiles) {
  const out = new Set();
  for (const f of testFiles) {
    let body;
    try { body = readFileSync(f, 'utf8'); } catch { continue; }
    const re = /type\s*:\s*['"]([A-Z][A-Z0-9_]*)['"]/g;
    let m;
    while ((m = re.exec(body)) !== null) out.add(m[1]);
  }
  return out;
}

describe('Reducer behavioural-coverage gate', () => {
  const reducerCases = extractReducerCases(reducerSrc);
  const testFiles = readAllTestFiles(testDir);
  const tested = actionsReferencedInTests(testFiles);

  test('reducer source parses (sanity)', () => {
    expect(reducerCases.length).toBeGreaterThan(20);
  });

  test('test directory scan picks up files (sanity)', () => {
    expect(testFiles.length).toBeGreaterThan(10);
  });

  test('every reducer case has at least one matching `type:` in some test', () => {
    const uncovered = reducerCases.filter(
      (action) => !tested.has(action) && !KNOWN_UNTESTED_CASES.has(action)
    );
    if (uncovered.length > 0) {
      // Surface the actionable list so the PR author can fix it
      // without re-running grep themselves.
      const msg =
        `${uncovered.length} reducer case(s) lack a behavioural test ` +
        `(no "type: 'X'" reference found in any *.test.js):\n` +
        uncovered.map((a) => `  - ${a}`).join('\n') +
        `\n\nAdd a test in src/__tests__/ that dispatches the action and ` +
        `asserts the resulting state. If a case is genuinely untestable as ` +
        `a pure transition, add it to KNOWN_UNTESTED_CASES with a one-line ` +
        `justification.`;
      throw new Error(msg);
    }
  });

  test('KNOWN_UNTESTED_CASES has no entries that no longer exist in the reducer', () => {
    // Catches stale exemptions — if an action is removed, its
    // KNOWN_UNTESTED_CASES entry should go with it.
    const stale = [...KNOWN_UNTESTED_CASES].filter(
      (action) => !reducerCases.includes(action)
    );
    expect(stale).toEqual([]);
  });
});
