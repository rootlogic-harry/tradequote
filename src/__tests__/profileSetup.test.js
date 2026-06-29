/**
 * ProfileSetup — modal sign-out link (TRQ-170).
 *
 * Mobile users reach the profile-edit modal via the BottomNav. Prior to
 * TRQ-170 that modal had no logout affordance, leaving shared-device /
 * lent-to-apprentice users with no way to switch accounts on mobile.
 *
 * Contract this suite locks:
 *   - ProfileSetup exposes an `onLogout` prop.
 *   - When `isModal=true` AND `onLogout` is provided, a "Sign out" link
 *     renders at the bottom of the form and, when clicked, invokes the
 *     handler.
 *   - When `onLogout` is not provided (e.g. the Step 1 onboarding mount)
 *     OR when `isModal` is false (the full-page setup), no link renders.
 *   - The link copy stays inside the banned-vocabulary fence: "Sign out"
 *     and "Log out" are both permitted; nothing else is.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const componentSrc = readFileSync(
  join(repoRoot, 'src/components/steps/ProfileSetup.jsx'),
  'utf8'
);

describe('ProfileSetup — onLogout prop wiring (TRQ-170)', () => {
  test('accepts an onLogout prop in its destructured signature', () => {
    // The component's function-signature line must list onLogout alongside
    // the existing props. Source-level check rather than runtime so the
    // suite stays JSDOM-free.
    expect(componentSrc).toMatch(
      /function\s+ProfileSetup\s*\(\s*\{[^}]*\bonLogout\b[^}]*\}\s*\)/
    );
  });

  test('renders a "Sign out" link inside the isModal branch', () => {
    // The sign-out element must be gated behind both isModal AND onLogout
    // so the full-page Step-1 mount (no onLogout) and any modal mount
    // that intentionally omits the handler still see the legacy markup.
    expect(componentSrc).toMatch(/Sign out/);
    // The gate uses both conditions — i.e. `isModal && onLogout` (order
    // either way). A weaker `{onLogout && …}` would also pass tests but
    // would leak the link onto the Step 1 onboarding screen if someone
    // ever passes onLogout there.
    expect(componentSrc).toMatch(
      /isModal\s*&&\s*onLogout|onLogout\s*&&\s*isModal/
    );
  });

  test('the Sign out element invokes onLogout via onClick', () => {
    // Either a button or anchor — both are fine. What matters is that
    // the click handler points at the prop, not at some internal helper
    // that might forget to call it.
    expect(componentSrc).toMatch(/onClick\s*=\s*\{\s*onLogout\s*\}/);
  });

  test('copy stays within the allowed logout vocabulary', () => {
    // The visibility-rules section of CLAUDE.md bans the AI lexicon but
    // is silent on "Sign out" / "Log out". Pin the choice so a future
    // refactor doesn't drift the copy into something cute and ambiguous
    // ("Bye!" / "Switch user" / etc).
    expect(componentSrc).toMatch(/Sign out|Log out/);
  });
});

describe('App.jsx — passes handleLogout to the profile modal (TRQ-170)', () => {
  const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

  test('handleLogout is defined and redirects to /auth/logout', () => {
    // Sanity: the handler we're wiring up still exists. If someone
    // renames it, this test pins the rename to also update the modal
    // wiring (and Sidebar's onLogout prop).
    expect(appSrc).toMatch(/const\s+handleLogout\s*=/);
    expect(appSrc).toMatch(/['"]\/auth\/logout['"]/);
  });

  test('the profile-modal mount of ProfileSetup passes onLogout={handleLogout}', () => {
    // Find the modal mount — it's the second <ProfileSetup …> in the
    // file (the first is the Step-1 onboarding mount). Both are inside
    // renderStep() / the JSX render tree. We grab the modal mount by
    // looking for the `isModal` prop in the same element.
    const modalMount = appSrc.match(
      /<ProfileSetup\b[^>]*\bisModal\b[\s\S]*?\/>/
    );
    expect(modalMount).not.toBeNull();
    expect(modalMount[0]).toMatch(/onLogout\s*=\s*\{\s*handleLogout\s*\}/);
  });

  test('the Step-1 onboarding mount does NOT pass onLogout (no link on first-run)', () => {
    // First mount is the onboarding flow — a brand-new user has nothing
    // to log out of yet, and showing "Sign out" there would be confusing.
    // The default-no-link behaviour is locked by withholding the prop.
    //
    // The regex tolerates additional props (currentUserId / userName /
    // showToast were added 2026-06-25 to power the relocated
    // ReferralPanel) but pins the absence of `onLogout` and `isModal`.
    const onboardingMount = appSrc.match(
      /<ProfileSetup\b(?![^>]*\bisModal\b)[\s\S]*?onProfileComplete=\{handleProfileComplete\}[\s\S]*?\/>/
    );
    expect(onboardingMount).not.toBeNull();
    expect(onboardingMount[0]).not.toMatch(/onLogout/);
  });
});

// Harry's 2026-06-25 ask: ReferralPanel lives inside ProfileSetup now,
// positioned immediately after the Quote Accent Colour section. These
// assertions pin the placement so a future cleanup doesn't accidentally
// move the panel into the wrong section group.
describe('ProfileSetup — hosts ReferralPanel after the accent section (2026-06-25)', () => {
  test('imports ReferralPanel', () => {
    expect(componentSrc).toMatch(
      /import\s+ReferralPanel\s+from\s+['"][^'"]*ReferralPanel(?:\.jsx)?['"]/
    );
  });

  test('renders <ReferralPanel /> with the documented props', () => {
    expect(componentSrc).toMatch(/<ReferralPanel\b/);
    // Props contract — same shape the component had on the Dashboard so
    // we don't fork its contract during the move.
    expect(componentSrc).toMatch(/currentUserId\s*=\s*\{[^}]+\}/);
    expect(componentSrc).toMatch(/userName\s*=\s*\{[^}]+\}/);
    expect(componentSrc).toMatch(/showToast\s*=\s*\{\s*showToast\s*\}/);
  });

  test('the ReferralPanel sits AFTER the Quote Accent Colour section', () => {
    const accentIdx = componentSrc.indexOf('Quote Accent Colour');
    const panelIdx = componentSrc.indexOf('<ReferralPanel');
    expect(accentIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(accentIdx);
  });

  test('the ReferralPanel sits BEFORE the save bar (so it scrolls naturally above the sticky footer)', () => {
    const panelIdx = componentSrc.indexOf('<ReferralPanel');
    const saveBarIdx = componentSrc.indexOf('Sticky save bar');
    expect(panelIdx).toBeGreaterThan(-1);
    expect(saveBarIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeLessThan(saveBarIdx);
  });

  test('ProfileSetup destructures currentUserId / userName / showToast', () => {
    // The panel needs all three. Source-level check on the function
    // signature so we don't accidentally drop one in a refactor.
    expect(componentSrc).toMatch(
      /function\s+ProfileSetup\s*\(\s*\{[^}]*\bcurrentUserId\b[^}]*\}/
    );
    expect(componentSrc).toMatch(
      /function\s+ProfileSetup\s*\(\s*\{[^}]*\buserName\b[^}]*\}/
    );
    expect(componentSrc).toMatch(
      /function\s+ProfileSetup\s*\(\s*\{[^}]*\bshowToast\b[^}]*\}/
    );
  });
});

describe('App.jsx — wires the ReferralPanel props through to ProfileSetup (2026-06-25)', () => {
  const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

  test('the Step-1 onboarding ProfileSetup mount forwards currentUserId / userName / showToast', () => {
    const onboardingMount = appSrc.match(
      /<ProfileSetup\b(?![^>]*\bisModal\b)[\s\S]*?onProfileComplete=\{handleProfileComplete\}[\s\S]*?\/>/
    );
    expect(onboardingMount).not.toBeNull();
    expect(onboardingMount[0]).toMatch(/currentUserId\s*=\s*\{\s*state\.currentUserId\s*\}/);
    expect(onboardingMount[0]).toMatch(/userName\s*=\s*\{[^}]*state\.currentUser\?\.name[^}]*\}/);
    expect(onboardingMount[0]).toMatch(/showToast\s*=\s*\{\s*showToast\s*\}/);
  });

  test('the profile-modal ProfileSetup mount forwards currentUserId / userName / showToast', () => {
    const modalMount = appSrc.match(
      /<ProfileSetup\b[^>]*\bisModal\b[\s\S]*?\/>/
    );
    expect(modalMount).not.toBeNull();
    expect(modalMount[0]).toMatch(/currentUserId\s*=\s*\{\s*state\.currentUserId\s*\}/);
    expect(modalMount[0]).toMatch(/userName\s*=\s*\{[^}]*state\.currentUser\?\.name[^}]*\}/);
    expect(modalMount[0]).toMatch(/showToast\s*=\s*\{\s*showToast\s*\}/);
  });
});

// ----------------------------------------------------------------------
// Mobile PR-9 (2026-06-29) — ProfileSetup polish (audit items 10, 18 +
// the App.jsx profile-modal close-X follow-up that originally lived in
// PR-2 but didn't make it into #73). Closes:
//   - audit #10: sticky save bar overlaps BottomNav + iOS home indicator
//   - audit #18: accent swatches don't wrap on small phones
//   - logo upload file picker is sub-44px and stylistically off-brand
//   - audit #14: profile-modal close-X is a sub-44px text-2xl glyph
//
// All four are source-level assertions — the suite stays JSDOM-free.
// ----------------------------------------------------------------------
describe('ProfileSetup — sticky save bar respects safe-area + BottomNav (audit #10, PR-9)', () => {
  test('non-modal save bar sits above the 64px BottomNav and respects safe-area-inset-bottom on mobile', () => {
    // Mirrors the ReviewEdit.jsx:511 pattern shipped in TRQ-172. Without
    // this offset the Save button can sit under the iOS home indicator
    // and overlap the BottomNav on iPhone 13. Settings redesign
    // (2026-06-29) consolidates the save bar inside .ps-foot; the
    // sticky-utilities class set still applies in the !isModal branch.
    expect(componentSrc).toMatch(
      /sticky\s+bottom-\[calc\(env\(safe-area-inset-bottom\)\+64px\)\]\s+fq:bottom-0/
    );
  });

  test('modal mount of the save bar uses .ps-foot (the modal scrim already handles scroll containment)', () => {
    // Settings redesign (2026-06-29): the save bar shell is now
    // .ps-foot in index.html, which sets `position: sticky; bottom: 0`
    // + `padding-bottom: env(safe-area-inset-bottom)` for the modal
    // mount. The non-modal Step-1 mount layers the BottomNav-aware
    // sticky offset on top via the conditional Tailwind class. The
    // class ternary keys off isModal:
    //
    //   className={`ps-foot ${isModal ? '' : 'sticky bottom-[…] fq:bottom-0 py-4'}`}
    //
    // Pin both halves so a future refactor can't drop either.
    expect(componentSrc).toMatch(/ps-foot/);
    expect(componentSrc).toMatch(
      /isModal\s*\?\s*['"]['"]\s*:\s*['"]sticky\s+bottom-\[calc\(env\(safe-area-inset-bottom\)\+64px\)\]\s+fq:bottom-0\s+py-4['"]/
    );
  });
});

describe('ProfileSetup — accent swatches wrap on small phones (audit #18, PR-9)', () => {
  test('the swatch row has flex-wrap so 4 swatches do not overflow at 360px', () => {
    // Pre-fix: `flex gap-3` with 4 × 64px swatches = 292px — fits 390px
    // but breaks layout at narrower viewports as soon as any padding
    // is added to the parent. flex-wrap is a no-op on desktop and the
    // wrap kicks in only when the row would actually overflow.
    expect(componentSrc).toMatch(
      /flex\s+flex-wrap\s+gap-3"\s+role="radiogroup"\s+aria-label="Quote accent colour"/
    );
  });
});

describe('ProfileSetup — logo upload is a 44px-tall button-styled label (PR-9)', () => {
  test('the file input is wrapped in a <label> with a canonical 44px touch class', () => {
    // The default <input type="file"> renders a sub-44px native pill
    // that doesn't match the form's other CTAs. The fix wraps it in a
    // <label> styled with .btn-ghost + .touch-44 + minHeight: 44 so the
    // tappable surface is a full button. Source-level assertion pins
    // the structural choice (wrap-in-label) rather than the exact text.
    const logoIdx = componentSrc.indexOf('Company Logo');
    expect(logoIdx).toBeGreaterThan(-1);
    const logoBlock = componentSrc.slice(logoIdx, logoIdx + 1500);
    expect(logoBlock).toMatch(/<label[^>]*\btouch-44\b/);
    expect(logoBlock).toMatch(/minHeight:\s*44/);
    // The label's child is the actual file input, hidden via .sr-only
    // so the styled label is the only visible affordance.
    expect(logoBlock).toMatch(/<input\b[\s\S]{0,200}type="file"[\s\S]{0,400}className="sr-only"/);
  });

  test('the file input keeps onChange={handleLogoUpload} (no behavioural regression)', () => {
    expect(componentSrc).toMatch(
      /<input\b[\s\S]{0,200}type="file"[\s\S]{0,200}onChange=\{handleLogoUpload\}/
    );
  });

  test('the visible label text is one of the locked options (no banned-vocab drift)', () => {
    // Pinned copy: "Upload logo" when no logo, "Change logo" when one
    // exists. Both stay clear of the AI vocabulary fence.
    expect(componentSrc).toMatch(/'Change logo'\s*:\s*'Upload logo'|"Change logo"\s*:\s*"Upload logo"/);
  });
});

// ----------------------------------------------------------------------
// Settings redesign (2026-06-29) — 5-section nav + sticky save bar.
// Source-of-truth spec: /tmp/fastquote-profile-handoff/design_handoff_dashboard/
//
// All assertions are source-level (the rest of the suite is JSDOM-free).
// The redesign restructures the UI ONLY — every field still writes via
// `update(field, value)` → `dispatch('UPDATE_PROFILE', { updates })`, so
// the existing reducer / accent / document-type / hideLabourDays tests
// stay green untouched.
// ----------------------------------------------------------------------
describe('ProfileSetup — Settings redesign (2026-06-29): 5-section shell', () => {
  test('declares all 5 sections in the local SECTIONS array', () => {
    // Single source of truth for the left nav. If a future refactor
    // splits this back into hand-rolled <button> calls the order/labels
    // can drift; pin them here.
    const sectionsBlock = componentSrc.match(
      /const\s+SECTIONS\s*=\s*\[[\s\S]*?\];/
    );
    expect(sectionsBlock).not.toBeNull();
    for (const id of ['business', 'rates', 'trade', 'quote', 'share']) {
      expect(sectionsBlock[0]).toMatch(new RegExp(`id:\\s*['"]${id}['"]`));
    }
    // Labels per spec.
    expect(sectionsBlock[0]).toMatch(/label:\s*['"]Business['"]/);
    expect(sectionsBlock[0]).toMatch(/label:\s*['"]Rates & tax['"]/);
    expect(sectionsBlock[0]).toMatch(/label:\s*['"]Your Trade['"]/);
    expect(sectionsBlock[0]).toMatch(/label:\s*['"]Quote Preferences['"]/);
    expect(sectionsBlock[0]).toMatch(/label:\s*['"]Sharing['"]/);
  });

  test('tracks an activeSection state, defaulting to "business"', () => {
    // Local UI state — not persisted. Default to Business so the most-
    // used identity fields are visible on first paint.
    expect(componentSrc).toMatch(
      /useState\s*\(\s*['"]business['"]\s*\)/
    );
    // The setter is called from the nav onClick — pins the wiring so
    // a future refactor can't lose section switching.
    expect(componentSrc).toMatch(/setActiveSection\s*\(\s*s\.id\s*\)/);
  });

  test('renders one section at a time via renderActiveSection switch', () => {
    expect(componentSrc).toMatch(/function renderActiveSection|renderActiveSection\s*=/);
    expect(componentSrc).toMatch(/case\s+['"]business['"]/);
    expect(componentSrc).toMatch(/case\s+['"]rates['"]/);
    expect(componentSrc).toMatch(/case\s+['"]trade['"]/);
    expect(componentSrc).toMatch(/case\s+['"]quote['"]/);
    expect(componentSrc).toMatch(/case\s+['"]share['"]/);
  });

  test('Your Trade section carries an "Optional" badge', () => {
    // Both in the nav AND the section header per spec — the badge in
    // the nav has the dim limestone background; the header badge sits
    // inline with the section title.
    expect(componentSrc).toMatch(/badge:\s*['"]Optional['"]/);
    expect(componentSrc).toMatch(/<span\s+className="ps-opt-badge">Optional<\/span>/);
  });
});

describe('ProfileSetup — Settings redesign: sticky save bar reachable everywhere', () => {
  test('renders a Cancel button in the modal mount', () => {
    // The Cancel button is gated behind `isModal` so the Step-1
    // onboarding mount stays single-CTA (Save Profile & Continue →).
    // Verify the source contains both the JSX text and the gate.
    expect(componentSrc).toMatch(/isModal\s*&&\s*\(\s*<button[\s\S]*?Cancel/);
  });

  test('save bar lives outside renderActiveSection (so every section reaches it)', () => {
    // The footer is appended AFTER the body grid in the shell — not
    // inside any section's renderer. Source check: the .ps-foot
    // wrapper appears below the </div> that closes .ps-body.
    const footIdx = componentSrc.indexOf('ps-foot');
    const bodyIdx = componentSrc.indexOf('ps-body');
    expect(footIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(footIdx).toBeGreaterThan(bodyIdx);
    // And the .ps-foot wrapper is a sibling of the body (sticky to the
    // shell, not to a section), so it stays visible across switches.
    expect(componentSrc).toMatch(/<div\s+className=\{`ps-foot/);
  });

  test('"Unsaved changes" indicator is gated on a dirty-state check', () => {
    // The indicator should be visible only when the user has edits
    // pending. A JSON-compare against the captured initial snapshot is
    // the simplest correct check; either useMemo or a direct compare
    // is acceptable.
    expect(componentSrc).toMatch(/Unsaved changes/);
    expect(componentSrc).toMatch(/isDirty/);
    expect(componentSrc).toMatch(/initialProfileRef/);
  });
});

describe('ProfileSetup — Settings redesign: required-field markers', () => {
  test('renders the .ps-req asterisk for each required field', () => {
    // Required fields per spec: Your name, Phone, Email, Business
    // Address, Day rate, VAT number (when VAT on). The literal
    // <Req /> JSX should appear at least 6 times.
    const reqMatches = componentSrc.match(/<Req\s*\/>/g) || [];
    expect(reqMatches.length).toBeGreaterThanOrEqual(6);
    // And the underlying span uses .ps-req for the colour token.
    expect(componentSrc).toMatch(/<span\s+className="ps-req"/);
  });
});

describe('ProfileSetup — Settings redesign: VAT off-by-default + conditional VAT-number reveal', () => {
  test('initial profile (in reducer) has vatRegistered=false', async () => {
    // The redesign asserts a contract that the reducer already
    // satisfies — keep this test in lockstep so a future reducer
    // refactor can't quietly flip the default.
    const { reducer, initialState } = await import('../reducer.js');
    const state = reducer(initialState, { type: '@@INIT' });
    expect(state.profile.vatRegistered).toBe(false);
  });

  test('VAT-number field is rendered only when vatRegistered is truthy', () => {
    // Source-level: the {profile.vatRegistered && (...)} guard wraps
    // the VAT-number block. Without this guard the field would always
    // render — exactly the bug the redesign closes.
    expect(componentSrc).toMatch(/\{profile\.vatRegistered\s*&&/);
  });

  test('VAT-number helper text says it is required when VAT is on', () => {
    // Verbatim per spec: "Required when VAT is on so we can show it
    // on your quotes."
    expect(componentSrc).toMatch(
      /Required when VAT is on so we can show it on your quotes\./
    );
  });

  test('toggling VAT off does NOT clear the vatNumber field (preservation contract)', () => {
    // Source-level pin: the redesign deliberately wires the VAT
    // toggle to update('vatRegistered', e.target.checked) ONLY — no
    // accompanying update('vatNumber', '') that would wipe a
    // previously-saved VAT number on every flip. A regression that
    // adds such a call would break the spec's preservation rule.
    //
    // Strategy: there must be exactly ONE call site that writes
    // vatNumber in the file (the user-typed input's onChange + its
    // onBlur companion). Any extra `update('vatNumber', '')` would
    // raise the count.
    expect(componentSrc).toMatch(/update\s*\(\s*['"]vatRegistered['"]\s*,/);
    const vatNumberClearCalls = componentSrc.match(
      /update\s*\(\s*['"]vatNumber['"]\s*,\s*['"]\s*['"]\s*\)/g
    );
    expect(vatNumberClearCalls).toBeNull();
  });
});

describe('ProfileSetup — Settings redesign: Document Type names the document, not the app', () => {
  test('label uses the spec copy verbatim: "What your client\'s document is called"', () => {
    expect(componentSrc).toMatch(
      /What your client(?:&apos;|'|’)s document is called/
    );
  });

  test('helper text contains the literal "The app always says \\"Quote\\"."', () => {
    // The other half of the PR #84/85/86 terminology lockdown. The
    // app chrome is locked to "Quote"; only the client's document
    // title is per-profile. The helper text nails this down so a
    // future copy refresh can't quietly drop it.
    expect(componentSrc).toMatch(
      /The app always says\s+(?:&quot;|")Quote(?:&quot;|")/
    );
  });

  test('both Quote and Estimate options exist in a single .map() over the toggle options', () => {
    // The toggle iterates an inline [{key:'quote'}, {key:'estimate'}]
    // array and wires every option to update('documentType', opt.key).
    // Source-level assertions on the inline option keys + the call
    // pattern keep the toggle wired without pinning the exact
    // .map() literal shape.
    expect(componentSrc).toMatch(/key:\s*['"]quote['"]/);
    expect(componentSrc).toMatch(/key:\s*['"]estimate['"]/);
    expect(componentSrc).toMatch(/update\s*\(\s*['"]documentType['"]\s*,\s*opt\.key/);
  });
});

describe('ProfileSetup — Settings redesign: no stray icon inside form fields', () => {
  // Live-app bug from the design review: "a stray icon sits inside
  // every form input". Our markup contains no <svg> / <span> children
  // inside the input wrapper — the input is the only child of its
  // <div className="field"> ancestor. Source-level regex sanity-check
  // that no input is followed by a sibling <svg> or <span> that would
  // visually appear inside it.
  test('no inline <svg> sits next to an input under a .nq-field-bearing field', () => {
    // The pattern that would indicate a stray icon: <input ... /> on
    // one line, immediately followed by <svg ... /> on the next
    // (inside the same parent div). Search the source for that
    // pattern and assert it's absent.
    const strayPattern = /<input[\s\S]{0,400}?\/>\s*<svg/;
    expect(componentSrc).not.toMatch(strayPattern);
    // Same for a <span> placed as an input sibling (the prototype
    // ruled this out by leaving fields child-less).
    const straySpanPattern = /<input[\s\S]{0,400}?\/>\s*<span\b(?![^>]*\bclassName="ps-req")/;
    // Allow the .ps-req asterisk in labels — it's the only span we
    // intentionally place near inputs (and it lives in the <label>,
    // not as an input sibling). The look-ahead exempts it.
    expect(componentSrc).not.toMatch(straySpanPattern);
  });
});

describe('ProfileSetup — Settings redesign: section labels appear in the source', () => {
  test('Business / Rates & tax / Your Trade / Quote Preferences / Sharing labels all render', () => {
    // Pin the visible labels — drift here would surface as a broken
    // section nav (the labels are also the human-readable nav targets).
    expect(componentSrc).toMatch(/Business/);
    expect(componentSrc).toMatch(/Rates & tax|Rates &amp; tax/);
    expect(componentSrc).toMatch(/Your Trade/);
    expect(componentSrc).toMatch(/Quote Preferences/);
    expect(componentSrc).toMatch(/Sharing/);
  });
});

describe('ProfileSetup — Settings redesign: handleSave preserved (no behavioural regression)', () => {
  test('handleSave still validates via validateProfile then dispatches the right next-step', () => {
    expect(componentSrc).toMatch(/handleSave/);
    expect(componentSrc).toMatch(/validateProfile\(profile\)/);
    // The post-validate branches are unchanged: modal → onClose,
    // onboarding → onProfileComplete, else → SET_STEP to 2.
    expect(componentSrc).toMatch(/onClose\(\)/);
    expect(componentSrc).toMatch(/onProfileComplete\(\)/);
    expect(componentSrc).toMatch(/SET_STEP/);
  });
});

describe('ProfileSetup — profile modal close-X has a 44x44 hit area (audit #14, PR-9, relocated 2026-06-29)', () => {
  // Relocated by the Settings redesign (2026-06-29): the close-X now
  // lives inside ProfileSetup's own .ps-head (so the 5-section nav +
  // sticky save bar all sit in one shell). The 44×44 hit-area + aria-
  // label contract is preserved here; App.jsx no longer renders its
  // own "Edit Profile" header.
  test('the close button uses .ps-head-x AND .touch-44 (both wired to >=44px)', () => {
    // .ps-head-x sets min-width / min-height to 44px in index.html;
    // .touch-44 is the canonical 44px utility. Either alone is enough
    // for the touch-target lint; we pin both for resilience.
    const closeButton = componentSrc.match(
      /<button[\s\S]{0,400}&times;\s*<\/button>/
    );
    expect(closeButton).not.toBeNull();
    expect(closeButton[0]).toMatch(/ps-head-x/);
    expect(closeButton[0]).toMatch(/touch-44/);
  });

  test('the close button has an aria-label for screen readers', () => {
    // A glyph-only button must expose its purpose to assistive tech.
    const closeButton = componentSrc.match(
      /<button[\s\S]{0,400}&times;\s*<\/button>/
    );
    expect(closeButton).not.toBeNull();
    expect(closeButton[0]).toMatch(/aria-label="Close"/);
  });

  test('App.jsx no longer renders its own "Edit Profile" header — ProfileSetup owns the head row', () => {
    // Source-level pin so a future refactor doesn't accidentally
    // reintroduce the duplicate header (which would put two close-X
    // buttons on the screen).
    const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');
    expect(appSrc).not.toMatch(/<h2[^>]*>Edit Profile<\/h2>/);
  });
});
