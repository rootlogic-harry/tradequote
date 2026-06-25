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
