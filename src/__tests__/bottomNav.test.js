/**
 * BottomNav — iOS safe-area inset + quota-exhausted disabled state.
 *
 * Mobile PR-1 (2026-06-26). Closes audit items 1 and 16 from
 * /tmp/mobile-responsive-plan.md.
 *
 * 1. The bottom nav is a fixed 64px bar. On iPhone X+ (which is
 *    everything Mark/Paul carry) the home indicator sits in the
 *    bottom safe area and overlaps the nav labels. The fix is to
 *    grow both `height` and `paddingBottom` by
 *    `env(safe-area-inset-bottom)`.
 *
 * 2. When the user has burned their free quota AND has no purchased
 *    pack AND isn't subscribed/comped, the `+ New` icon stays full-
 *    colour and tappable today — they tap it and discover the
 *    lockout only after pressing it. The fix is a visual greyed-out
 *    + `aria-disabled="true"` treatment, BUT keep the click handler
 *    wired so tapping still routes them to the quota-exhausted
 *    lockout screen (where the Subscribe / Buy pack UI lives).
 *
 * All assertions are source-level (mirrors the pattern in
 * componentCrashSafety.test.js) — no JSDOM render needed.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

function readSrc(relativePath) {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

// ─── 1. Safe-area inset on the BottomNav itself ───

describe('BottomNav — iOS safe-area inset', () => {
  const src = readSrc('components/BottomNav.jsx');

  test('height uses env(safe-area-inset-bottom) so labels clear the iOS home indicator', () => {
    // The fixed 64px bar must grow to include the safe area at the
    // bottom of the viewport, otherwise the home indicator overlaps
    // the bottom row of labels on iPhone X+.
    const hasSafeAreaHeight = /height:\s*['"]calc\(\s*64px\s*\+\s*env\(safe-area-inset-bottom\)\s*\)['"]/.test(src);
    expect(hasSafeAreaHeight).toBe(true);
  });

  test('paddingBottom uses env(safe-area-inset-bottom)', () => {
    // Padding pushes the icon/label row up off the home indicator —
    // without it the icons would render *inside* the new extra height
    // and still be obscured.
    const hasSafeAreaPadding = /paddingBottom:\s*['"]env\(safe-area-inset-bottom\)['"]/.test(src);
    expect(hasSafeAreaPadding).toBe(true);
  });
});

// ─── 2. App.jsx main-content offset grows to match ───

describe('App.jsx main content — offset matches BottomNav growth', () => {
  const src = readSrc('App.jsx');

  test('main pb offset grows by env(safe-area-inset-bottom)', () => {
    // App.jsx had `pb-16` (= 64px) to clear the BottomNav. With the
    // nav now taller by the safe-area inset, the main pb must grow
    // too or the last few px of content sit behind the nav.
    const hasSafeAreaPb =
      /pb-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/.test(src);
    expect(hasSafeAreaPb).toBe(true);
  });
});

// ─── 3. BottomNav accepts isQuotaExhausted, defaults to false ───

describe('BottomNav — isQuotaExhausted prop', () => {
  const src = readSrc('components/BottomNav.jsx');

  test('accepts isQuotaExhausted prop with default false (Pitfall #1 safe default)', () => {
    // Defensive default: if a future caller forgets the prop, the
    // `+ New` button behaves as normal (not disabled) — which is
    // the correct permissive default for non-quota-aware contexts.
    const hasDefault = /isQuotaExhausted\s*=\s*false/.test(src);
    expect(hasDefault).toBe(true);
  });
});

// ─── 4. `+ New` greyed + aria-disabled when locked out ───

describe('BottomNav — `+ New` quota-locked visual + aria treatment', () => {
  const src = readSrc('components/BottomNav.jsx');

  test('renders aria-disabled on the `+ New` button when quota exhausted', () => {
    // Screen readers + automation tools need to know the button is
    // gated. We don't use the native `disabled` attribute because
    // we deliberately want the click to still route to the lockout
    // screen (see next test).
    const hasAriaDisabled = /aria-disabled=\{[^}]*key\s*===\s*['"]new['"][^}]*isQuotaExhausted[^}]*\}/.test(src)
      || /aria-disabled=\{[^}]*isQuotaExhausted[^}]*key\s*===\s*['"]new['"][^}]*\}/.test(src)
      || /aria-disabled=\{\s*isLocked\s*\}/.test(src)
      || /aria-disabled=\{\s*disabled\s*\}/.test(src);
    expect(hasAriaDisabled).toBe(true);
  });

  test('greys out the `+ New` button visually when quota exhausted (opacity + cursor)', () => {
    // The visual signal MUST be applied — not-allowed cursor +
    // dimmed appearance. We accept either an inline style or a
    // tailwind class equivalent, and either an explicit literal
    // or a ternary that resolves to one when locked.
    const hasNotAllowed = /['"]not-allowed['"]/.test(src)
      || /cursor-not-allowed/.test(src);
    expect(hasNotAllowed).toBe(true);

    const hasDimming = /opacity:\s*(?:isLocked\s*\?\s*)?0?\.[0-9]+/.test(src)
      || /opacity-[0-9]{2}/.test(src);
    expect(hasDimming).toBe(true);
  });
});

// ─── 5. Tapping `+ New` while exhausted STILL routes to lockout ───

describe('BottomNav — `+ New` click handler stays wired when exhausted', () => {
  const src = readSrc('components/BottomNav.jsx');

  test('does NOT use the native `disabled` attribute on the button', () => {
    // Native `disabled` would swallow the click entirely — but we
    // want the tap to still route into the lockout screen so the
    // user gets the Subscribe / Buy pack UI. Visual greyed + aria
    // only, no `disabled={…}`.
    //
    // Allow `disabled={false}` (literal hardcoded false) just in
    // case future maintainers explicitly opt out, but otherwise
    // reject any `disabled=` attribute on a button. The regex uses
    // a negative lookbehind to skip `aria-disabled=` (which is
    // exactly what we DO want).
    const buttonBlock = src.match(/<button[\s\S]*?>/g) || [];
    buttonBlock.forEach(tag => {
      // Reject any disabled attribute that is NOT literally false
      // and is NOT preceded by `aria-` (which is the allowed form).
      const badDisabled = /(?<!aria-)\bdisabled=\{[^}]*\}/.test(tag)
        && !/(?<!aria-)\bdisabled=\{\s*false\s*\}/.test(tag);
      expect(badDisabled).toBe(false);
    });
  });

  test('onClick handler is invoked regardless of quota state', () => {
    // The action lambda must NOT be short-circuited inside BottomNav
    // when `isQuotaExhausted` is true. The lockout routing happens
    // upstream in App.jsx's handleStartNewQuote. We assert that the
    // onClick prop on the `new` button stays a direct call to
    // `action` — no inline `if (isQuotaExhausted) return` guard.
    expect(/onClick=\{action\}/.test(src)).toBe(true);
  });
});

// ─── 6. App.jsx wires isQuotaExhausted into BottomNav ───

describe('App.jsx — passes isQuotaExhausted into BottomNav', () => {
  const src = readSrc('App.jsx');

  test('isQuotaExhausted derived from billing.quotaState is forwarded to BottomNav', () => {
    // Two existing handlers in App.jsx already derive
    //   const isQuotaExhausted = billing?.quotaState === 'exhausted'
    // We need the BottomNav element to carry that flag too.
    const bottomNavBlock = src.match(/<BottomNav[\s\S]*?\/>/);
    expect(bottomNavBlock).not.toBeNull();
    expect(/isQuotaExhausted=\{isQuotaExhausted\}/.test(bottomNavBlock[0])).toBe(true);
  });
});

// ─── 7. Defensive — BottomNav doesn't blow up with undefined props ───

describe('BottomNav — defensive default on isQuotaExhausted', () => {
  const src = readSrc('components/BottomNav.jsx');

  test('signature also keeps existing isAdminPlan default (regression guard)', () => {
    // Make sure we didn't accidentally remove the existing default.
    expect(/isAdminPlan\s*=\s*false/.test(src)).toBe(true);
  });

  test('default false means undefined === false at runtime (no crash)', () => {
    // Static assertion: the default param syntax `isQuotaExhausted = false`
    // means React will treat an omitted prop as `false` — verified
    // by the test in section 3 above. This test exists to document
    // the contract for future maintainers.
    const hasDefault = /isQuotaExhausted\s*=\s*false/.test(src);
    expect(hasDefault).toBe(true);
  });
});
