/**
 * Lifecycle bug-hunt 2026-06-30 #2 — client portal can drag status
 * backwards from `completed`.
 *
 * If the tradesman regenerates a token after a job is completed,
 * the existing `POST /api/users/:id/jobs/:jobId/client-token` route
 * resets `client_response = NULL` to allow a fresh accept/decline.
 * The `POST /q/:token/respond` UPDATE then writes status as
 * `CASE WHEN $1='accepted' THEN 'accepted' ELSE 'declined' END`,
 * bypassing VALID_TRANSITIONS. Result: a `completed` job could be
 * flipped back to `accepted` or `declined` post-completion.
 *
 * Fix: add `AND status NOT IN ('completed')` to the respond UPDATE
 * so the row no-ops at the SQL level (returns 409 like an expired
 * link), and the terminal state stays terminal.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

describe('/q/:token/respond — terminal-status guard', () => {
  test("respond UPDATE includes AND status NOT IN ('completed')", () => {
    expect(serverSrc).toMatch(/UPDATE jobs[\s\S]{0,1500}AND status NOT IN \('completed'\)/);
  });

  test("409 message acknowledges the completed-job no-op case", () => {
    expect(serverSrc).toMatch(/Response already recorded, link expired, or job already completed/);
  });

  test("the bug-hunt comment cites #2 so future readers know the why", () => {
    expect(serverSrc).toMatch(/Lifecycle bug-hunt 2026-06-30 #2/);
  });
});
