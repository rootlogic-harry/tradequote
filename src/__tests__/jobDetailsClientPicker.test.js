/**
 * JobDetails Client & Site picker — source-level guard.
 *
 * The Step 2 (Job Details) form gains two native <select> dropdowns
 * above the Client Name field when `clientsEnabled && currentUserId`:
 *
 *   1. Existing Client — always visible if the user has ≥1 client.
 *      Selecting fills clientName + clientPhone via onPickClient.
 *   2. Site — appears once a client is picked, pre-selects the
 *      "standard" (most-recent-job's site or first) and fills
 *      siteAddress via onPickSite. User can change to another site.
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
 *   - lose the "standard site" auto-select (Harry's 2026-07-07 UAT
 *     ask: "if I select a client, the site should populate by default
 *     as the standard, with the option to change").
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

  test('standard site is pre-selected from timeline (most recent job)', () => {
    // "if I select a client, the site should populate by default as
    // the standard" — Harry, 2026-07-07 UAT.
    // The picker reads timeline[0].site_id and falls back to the first
    // site in the list.
    expect(picker).toMatch(/timeline\[0\]\?\.site_id/);
    expect(picker).toMatch(/siteList\[0\]/);
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

  test('Site Address textarea hides when a site is picked', () => {
    // Harry's 2026-07-07 UAT: "if you select the site - you shouldn't
    // be able to amend the site address". The picker already fully
    // identifies the site; a free-text Site Address input would let
    // the user silently diverge from the client record.
    expect(jobDetailsSrc).toMatch(/existingSitePicked/);
    expect(jobDetailsSrc).toMatch(/!existingSitePicked\s*&&\s*\(/);
    // Toggle wiring: picker's onPickSite → true, unpick → false.
    expect(jobDetailsSrc).toMatch(/setExistingSitePicked\(true\)/);
    expect(jobDetailsSrc).toMatch(/setExistingSitePicked\(false\)/);
  });
});
