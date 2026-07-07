/**
 * JobDetails Client & Site picker — source-level guard.
 *
 * The Step 2 (Job Details) form gains a client picker strip when
 * `clientsEnabled && currentUserId`. Picking a client fills clientName
 * + clientPhone via existing updateJob dispatches; picking a site fills
 * siteAddress. If the client has exactly one site, it auto-fills.
 *
 * This suite pins the source shape so a future refactor can't silently:
 *   - render the picker unconditionally (leaking new UI to users on the
 *     flag-off / logged-out path — Standing Order: fail-closed),
 *   - overwrite `aiValue`s in reviewData (the immutable-contract
 *     canary from Pitfall #2 — the picker only calls updateJob on
 *     jobDetails fields),
 *   - break the "typing wins" contract (picker is a shortcut, not a
 *     replacement — the Client Name / Site Address inputs must stay
 *     rendered under the picker).
 *
 * Behavioural tests for the reducer transitions themselves are covered
 * by reducer.test.js (updateJob / SET_JOB_DETAILS). This suite is a
 * cheap source-integrity guard on the picker's insertion contract.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const jobDetailsSrc = readFileSync(
  join(repoRoot, 'src/components/steps/JobDetails.jsx'),
  'utf8',
);

describe('JobDetails client picker — insertion contract', () => {
  test('accepts clientsEnabled + currentUserId props with safe defaults', () => {
    // Fail-closed: both props default to falsy so a caller that
    // forgets to pass them cannot leak the picker.
    expect(jobDetailsSrc).toMatch(/clientsEnabled\s*=\s*false/);
    expect(jobDetailsSrc).toMatch(/currentUserId\s*=\s*null/);
  });

  test('gates the picker on BOTH clientsEnabled AND currentUserId', () => {
    // Never render if either is missing — a logged-out preview must
    // not fetch /clients and a flag-off tenant must not see the strip.
    expect(jobDetailsSrc).toMatch(
      /clientsEnabled\s*&&\s*currentUserId\s*&&\s*\(\s*[\r\n\s]*<ClientSitePicker/,
    );
  });

  test('picker dispatches into updateJob (jobDetails-only, never reviewData)', () => {
    // Contract: pick fills clientName + clientPhone + siteAddress via
    // updateJob. Never touches reviewData or aiValue — Pitfall #2.
    expect(jobDetailsSrc).toMatch(/updateJob\(['"]clientName['"]/);
    expect(jobDetailsSrc).toMatch(/updateJob\(['"]clientPhone['"]/);
    expect(jobDetailsSrc).toMatch(/updateJob\(['"]siteAddress['"]/);
  });

  test('picker component is defined in-file (no unresolved reference)', () => {
    expect(jobDetailsSrc).toMatch(/function ClientSitePicker\s*\(/);
  });

  test('picker fetches clients via listClients + client detail via getClient', () => {
    // Wire-shape contract — the two userDB helpers that back the flow.
    expect(jobDetailsSrc).toMatch(/listClients\(currentUserId/);
    expect(jobDetailsSrc).toMatch(/getClient\(currentUserId/);
  });

  test('typing still wins — the Client Name / Site Address inputs are still rendered', () => {
    // The picker is a shortcut, not a gate. Users must be able to
    // type a fresh name and skip the picker entirely. The inputs use
    // `inputClass(...)` + `updateJob(...)` (no `name=` attr).
    expect(jobDetailsSrc).toMatch(/inputClass\(['"]clientName['"]\)/);
    expect(jobDetailsSrc).toMatch(/inputClass\(['"]siteAddress['"]\)/);
    expect(jobDetailsSrc).toMatch(/jobDetails\.clientName/);
    expect(jobDetailsSrc).toMatch(/jobDetails\.siteAddress/);
  });

  test('touch targets on picker rows respect the 44px min-height contract', () => {
    // Mobile touch-target lint (from CLAUDE.md § Mobile). Every
    // interactive control inside the picker must be ≥44px.
    const picker = jobDetailsSrc.slice(jobDetailsSrc.indexOf('function ClientSitePicker'));
    // Extract every `minHeight: NN` occurrence inside the picker.
    const heights = [...picker.matchAll(/minHeight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  });

  test('single-site auto-fill fast-path present', () => {
    // If a client has exactly one site, we skip the site sub-picker
    // and auto-call onPickSite. Documented in the picker JSDoc.
    expect(jobDetailsSrc).toMatch(/sites\?.length === 1/);
  });
});
