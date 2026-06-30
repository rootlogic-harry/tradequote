/**
 * Prompt-version persistence — server-side stamp on job save.
 *
 * Bug fix (2026-06-22 calibration investigation):
 * Every job row in production had `prompt_version = NULL` because the
 * server read `req.body.promptVersion` but the client never sent it.
 * Without this column populated, calibration's effect on accuracy is
 * unmeasurable per-job.
 *
 * Fix: stamp `prompt_version` server-side at job-save time using the
 * same `computePromptVersion(SYSTEM_PROMPT, augmentedPrompt)` helper
 * the /analyse endpoints use. The format must match the photo-path
 * /analyse augmentation so analyse-time and save-time hashes align.
 *
 * Tests below are source-level scans (no DB required) plus a unit
 * test of the prompt-version computation pulled from systemPrompt.js.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computePromptVersion, SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('prompt_version persistence on job save', () => {
  test('server defines a computeCurrentPromptVersion helper', () => {
    // The helper consolidates the SYSTEM_PROMPT + calibration_notes
    // hashing logic the /analyse routes use, so save can reuse it.
    expect(serverSource).toContain('async function computeCurrentPromptVersion');
  });

  test('helper queries approved calibration notes', () => {
    const helperStart = serverSource.indexOf('async function computeCurrentPromptVersion');
    const helperEnd = serverSource.indexOf('async function logAdminAction');
    const helperBody = serverSource.slice(helperStart, helperEnd);

    expect(helperBody).toContain('calibration_notes');
    expect(helperBody).toContain("status = 'approved'");
    expect(helperBody).toContain('ORDER BY approved_at ASC');
  });

  test('helper calls computePromptVersion with the SYSTEM_PROMPT + notes section', () => {
    const helperStart = serverSource.indexOf('async function computeCurrentPromptVersion');
    const helperEnd = serverSource.indexOf('async function logAdminAction');
    const helperBody = serverSource.slice(helperStart, helperEnd);

    expect(helperBody).toContain('computePromptVersion(SYSTEM_PROMPT');
    expect(helperBody).toContain('DYNAMIC CALIBRATION NOTES');
  });

  test('helper returns null on DB failure rather than throwing', () => {
    // A failing prompt_version compute must not break job save.
    const helperStart = serverSource.indexOf('async function computeCurrentPromptVersion');
    const helperEnd = serverSource.indexOf('async function logAdminAction');
    const helperBody = serverSource.slice(helperStart, helperEnd);

    expect(helperBody).toContain('try {');
    expect(helperBody).toContain('catch');
    expect(helperBody).toContain('return null');
  });

  test('POST /api/users/:id/jobs stamps prompt_version server-side', () => {
    // Locate the POST handler body. The handler runs the insert with
    // prompt_version as one of the column values; before the fix it
    // read only req.body.promptVersion (client-supplied) which was
    // always undefined. After the fix it falls back to the helper.
    const routeStart = serverSource.indexOf("app.post('/api/users/:id/jobs',");
    const routeEnd = serverSource.indexOf("app.put('/api/users/:id/jobs/:jobId',");
    const routeBody = serverSource.slice(routeStart, routeEnd);

    expect(routeBody).toContain('prompt_version');
    expect(routeBody).toContain('computeCurrentPromptVersion()');
  });

  test('POST /api/users/:id/jobs still accepts client-supplied promptVersion for forward-compat', () => {
    // The fix uses `req.body.promptVersion || await computeCurrent…`
    // — if the client ever does start sending it, that wins. Today
    // the client never sends it, so the helper fills the gap.
    const routeStart = serverSource.indexOf("app.post('/api/users/:id/jobs',");
    const routeEnd = serverSource.indexOf("app.put('/api/users/:id/jobs/:jobId',");
    const routeBody = serverSource.slice(routeStart, routeEnd);

    expect(routeBody).toContain('req.body.promptVersion');
  });

  test('INSERT statement binds prompt_version as a parameter', () => {
    // Belt-and-braces: confirm the INSERT references prompt_version
    // as a column AND the values list includes the computed value.
    // Lifecycle bug-hunt 2026-06-30 #1 appended `quoteToken` after
    // promptVersion in the params list — relaxed the closing-bracket
    // assertion so a future addition doesn't break this guard.
    const routeStart = serverSource.indexOf("app.post('/api/users/:id/jobs',");
    const routeEnd = serverSource.indexOf("app.put('/api/users/:id/jobs/:jobId',");
    const routeBody = serverSource.slice(routeStart, routeEnd);

    expect(routeBody).toMatch(/INSERT INTO jobs[^;]*prompt_version/);
    expect(routeBody).toMatch(/promptVersion,/);
  });

  test('photo path /analyse still computes prompt_version (unchanged)', () => {
    // The fix must not regress the existing /analyse path — the
    // response still surfaces promptVersion so a future client wiring
    // can pass it through.
    expect(serverSource).toMatch(/computePromptVersion\(SYSTEM_PROMPT/);
    // Both photo (/analyse) and video paths still ship promptVersion
    // in the response body.
    const occurrences = serverSource.match(/promptVersion,/g) || [];
    // At minimum: photo /analyse return body, video /video return
    // body, AND the new save-path INSERT parameter list.
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  test('computePromptVersion is deterministic — required for cross-save attribution', () => {
    // The helper persists this hash; recomputing it later must yield
    // the same string for the same SYSTEM_PROMPT + notes input.
    const v1 = computePromptVersion(SYSTEM_PROMPT, 'note A');
    const v2 = computePromptVersion(SYSTEM_PROMPT, 'note A');
    expect(v1).toBe(v2);
    expect(v1).toMatch(/^[0-9a-f]{8}$/);
  });

  test('computePromptVersion changes when calibration notes change', () => {
    // If the calibration agent approves a new note between analyse
    // and save, the save-time hash will differ — that's acceptable.
    // Critical property: the hash MUST vary so we can detect drift.
    const v1 = computePromptVersion(SYSTEM_PROMPT, '1. [foo/bar] one note');
    const v2 = computePromptVersion(SYSTEM_PROMPT, '1. [foo/bar] one note\n2. [baz/qux] another');
    expect(v1).not.toBe(v2);
  });
});
