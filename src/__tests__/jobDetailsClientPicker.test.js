/**
 * JobDetails Client & Site picker — source-level guard.
 *
 * The Step 2 (Job Details) form gains two native <select> dropdowns
 * above the Client Name field when `clientsEnabled && currentUserId`:
 *
 *   1. Existing Client — always visible if the user has ≥1 client.
 *      Selecting fills clientName + clientPhone via onPickClient.
 *   2. Site — appears once a client is picked. It starts on
 *      "New site address" and does not fill the address. Saved
 *      addresses are listed underneath. Picking one copies it into
 *      the address box, which stays editable.
 *
 * This suite pins the source shape so a future refactor can't silently:
 *   - render the picker unconditionally (leaking new UI to users on the
 *     flag-off / logged-out path — Standing Order: fail-closed),
 *   - overwrite `aiValue`s in reviewData (the immutable-contract
 *     canary from Pitfall #2 — the picker only calls updateJob on
 *     jobDetails fields),
 *   - break the "typing wins" contract (picker is a shortcut, not a
 *     replacement — the Client Name / Site Address inputs must stay
 *     rendered under the picker),
 *   - auto-fill the previous site when a client is picked (Mark,
 *     2026-10-26: a repeat client usually has a new wall).
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

const picker = jobDetailsSrc.slice(
  jobDetailsSrc.indexOf('function ClientSitePicker'),
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

  test('per-quote site contact fields are rendered (name + phone)', () => {
    // Harry's 2026-07-07 UAT: "per quote it should be site contact,
    // quote reference, and site contact". Two new inputs on the form:
    // Site Contact Name + Site Contact Phone.
    expect(jobDetailsSrc).toMatch(/inputClass\(['"]siteContactName['"]\)/);
    expect(jobDetailsSrc).toMatch(/inputClass\(['"]siteContactPhone['"]\)/);
    expect(jobDetailsSrc).toMatch(/jobDetails\.siteContactName/);
    expect(jobDetailsSrc).toMatch(/jobDetails\.siteContactPhone/);
    expect(jobDetailsSrc).toMatch(/Site Contact Name/);
    expect(jobDetailsSrc).toMatch(/Site Contact Phone/);
  });

  test('picker auto-fills site contact from the picked site row', () => {
    // Site rows carry persistent site_contact_name / site_contact_phone
    // (schema at server.js §sites table). Picking a site pre-fills the
    // per-quote fields; user can override for THIS quote without
    // mutating the site row.
    expect(jobDetailsSrc).toMatch(/updateJob\(['"]siteContactName['"]/);
    expect(jobDetailsSrc).toMatch(/updateJob\(['"]siteContactPhone['"]/);
    expect(jobDetailsSrc).toMatch(/site\.siteContactName/);
    expect(jobDetailsSrc).toMatch(/site\.siteContactPhone/);
  });

  test('Client Name / Client Phone hide when an existing client is picked', () => {
    // Harry's 2026-07-07 UAT (2nd interpretation): when an existing
    // client is picked, hide the redundant Client Name + Client Phone
    // inputs — they're already stored on the client record. The Site
    // Contact fields take their place.
    expect(jobDetailsSrc).toMatch(/existingClientPicked/);
    expect(jobDetailsSrc).toMatch(/!existingClientPicked\s*&&\s*\(/);
    // Toggle is set/cleared by onPickClient (null == unpicked).
    expect(jobDetailsSrc).toMatch(/setExistingClientPicked\(true\)/);
    expect(jobDetailsSrc).toMatch(/setExistingClientPicked\(false\)/);
  });

  test('picker signals unpick with onPickClient(null) on placeholder', () => {
    // Without this the parent never learns the user switched back to
    // "— New client —" mode, and the Client Name / Phone inputs stay
    // hidden forever.
    expect(picker).toMatch(/onPickClient\?\.\(null\)/);
  });

  test('client dropdown is a native <select> with the New/Not-listed placeholder', () => {
    // Native <select> — clear "this is a dropdown" affordance. The
    // placeholder must NOT auto-fill anything so a user typing a fresh
    // name is never surprised by injected values.
    expect(picker).toMatch(/<select[\s\S]{0,400}data-testid=["']jobdetails-picker-client["']/);
    expect(picker).toMatch(/— New client \/ not listed —/);
  });

  test('site dropdown is a native <select> — no separate button list', () => {
    // Site picker uses the SAME <select> affordance so the user can
    // both see the auto-selected standard and change it in one control.
    expect(picker).toMatch(/<select[\s\S]{0,400}data-testid=["']jobdetails-picker-site["']/);
  });

  test('picking a client starts on New site address and does not fill a saved site', () => {
    expect(picker).toMatch(/New site address/);
    expect(picker).not.toMatch(/timeline\[0\]\?\.site_id/);
    expect(picker).not.toMatch(/onPickSite\?\.\(standard\)/);
    expect(picker).toMatch(/onPickSite\?\.\(null\)/);
  });

  test('touch targets on picker rows respect the 44px min-height contract', () => {
    // <select className="nq-field"> inherits ≥48px from the .nq-field
    // rule in index.html (touchTargets allow-list treats nq-field as
    // canonical-44px). Confirm the class is applied.
    expect(picker).toMatch(/className=["']nq-field["']/);
  });

  test('hides only when the user has zero clients', () => {
    // Threshold relaxed from <3 to <1 on 2026-07-07 (Harry: "I should
    // be able to select clients I\'ve already worked with"). Under the
    // old threshold users with 1 or 2 clients saw nothing.
    expect(picker).toMatch(/clients\.length === 0/);
    expect(picker).not.toMatch(/clients\.length < 3/);
  });

  test('Site Address stays visible after a client or site is picked', () => {
    // Mark, 2026-10-26: the address is usually different. The box
    // stays so he can type a new one or adjust a saved one. Saving a
    // different address creates another site; it does not overwrite.
    expect(jobDetailsSrc).not.toMatch(/existingSitePicked/);
    expect(jobDetailsSrc).toMatch(/inputClass\(['"]siteAddress['"]\)/);
  });
});
