/**
 * TRQ-164 — SubscriptionBanner + trialState tests.
 *
 * Two layers:
 *
 *   1. Pure-helper unit tests on `isTrialEndingSoon` / `dayCopy` /
 *      `pickBannerVariant`. Real imports, real assertions on return
 *      values. These are where the variant-picking logic actually
 *      gets exercised.
 *
 *   2. Source-level regex assertions on `SubscriptionBanner.jsx` to
 *      pin the wiring (every variant has a test ID + the right CTA
 *      route, the fetch effect runs on mount with a 5-min refresh,
 *      errors are swallowed). Jest's `transform: {}` config can't
 *      render JSX, so we lock the contract at the source level
 *      instead — same shape as the other component tests
 *      (analyticsFrontend, clientLinkBlock, etc.).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  isTrialEndingSoon,
  dayCopy,
  pickBannerVariant,
} from '../utils/trialState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const bannerSrc = readFileSync(join(repoRoot, 'src/components/SubscriptionBanner.jsx'), 'utf8');
const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

// ─────────────────── pure helpers ───────────────────

describe('isTrialEndingSoon', () => {
  test('returns false for non-trialing states', () => {
    expect(isTrialEndingSoon({ state: 'active' })).toBe(false);
    expect(isTrialEndingSoon({ state: 'expired' })).toBe(false);
    expect(isTrialEndingSoon({ state: 'past_due' })).toBe(false);
    expect(isTrialEndingSoon({ state: 'canceled' })).toBe(false);
    expect(isTrialEndingSoon({ state: 'unknown' })).toBe(false);
  });

  test('returns false for null / undefined / empty status', () => {
    expect(isTrialEndingSoon(null)).toBe(false);
    expect(isTrialEndingSoon(undefined)).toBe(false);
    expect(isTrialEndingSoon({})).toBe(false);
  });

  test('returns true when trialWillEndAt is within 3 days', () => {
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialEndingSoon({
      state: 'trialing',
      trialWillEndAt: inTwoDays,
      daysOfTrialRemaining: 30,
    })).toBe(true);
  });

  test('returns true at the boundary (just under 3 days out)', () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    expect(isTrialEndingSoon({
      state: 'trialing',
      trialWillEndAt: inThreeDays,
      daysOfTrialRemaining: 3,
    })).toBe(true);
  });

  test('returns false when trialWillEndAt is more than 3 days out AND day count is high', () => {
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialEndingSoon({
      state: 'trialing',
      trialWillEndAt: inTenDays,
      daysOfTrialRemaining: 10,
    })).toBe(false);
  });

  test('falls back to daysOfTrialRemaining when trialWillEndAt is absent', () => {
    expect(isTrialEndingSoon({ state: 'trialing', daysOfTrialRemaining: 2 })).toBe(true);
    expect(isTrialEndingSoon({ state: 'trialing', daysOfTrialRemaining: 0 })).toBe(true);
    expect(isTrialEndingSoon({ state: 'trialing', daysOfTrialRemaining: 10 })).toBe(false);
  });

  test('returns false when trialWillEndAt is in the past (trial already converted)', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isTrialEndingSoon({
      state: 'trialing',
      trialWillEndAt: yesterday,
      daysOfTrialRemaining: 30,
    })).toBe(false);
  });

  test('negative daysOfTrialRemaining does not count as "ending soon"', () => {
    expect(isTrialEndingSoon({ state: 'trialing', daysOfTrialRemaining: -1 })).toBe(false);
  });
});

describe('dayCopy', () => {
  test('singular for 1', () => {
    expect(dayCopy(1)).toBe('1 day');
  });

  test('plural for 0, 2, 30', () => {
    expect(dayCopy(0)).toBe('0 days');
    expect(dayCopy(2)).toBe('2 days');
    expect(dayCopy(30)).toBe('30 days');
  });

  test('handles undefined / null as 0', () => {
    expect(dayCopy(undefined)).toBe('0 days');
    expect(dayCopy(null)).toBe('0 days');
  });
});

describe('pickBannerVariant', () => {
  test('returns "none" for null / not-configured / active / unknown', () => {
    expect(pickBannerVariant(null)).toBe('none');
    expect(pickBannerVariant({ state: 'trialing', configured: false })).toBe('none');
    expect(pickBannerVariant({ state: 'active', configured: true })).toBe('none');
    expect(pickBannerVariant({ state: 'unknown', configured: true })).toBe('none');
  });

  test('returns "past-due" / "canceled" / "expired" for each respective state', () => {
    expect(pickBannerVariant({ state: 'past_due', configured: true })).toBe('past-due');
    expect(pickBannerVariant({ state: 'canceled', configured: true })).toBe('canceled');
    expect(pickBannerVariant({ state: 'expired', configured: true })).toBe('expired');
  });

  test('returns "trial-ending" when trialing AND ending-soon', () => {
    expect(pickBannerVariant({
      state: 'trialing',
      configured: true,
      daysOfTrialRemaining: 2,
    })).toBe('trial-ending');
  });

  test('returns "trial" when trialing but not ending soon', () => {
    expect(pickBannerVariant({
      state: 'trialing',
      configured: true,
      daysOfTrialRemaining: 14,
    })).toBe('trial');
  });

  test('returns "none" for an unrecognised state (defensive)', () => {
    expect(pickBannerVariant({ state: 'something_new', configured: true })).toBe('none');
  });
});

// ─────────────────── component-source contract ───────────────────

describe('SubscriptionBanner.jsx — wiring contract', () => {
  test('imports pure helpers from utils/trialState.js', () => {
    expect(bannerSrc).toMatch(/from\s+['"]\.\.\/utils\/trialState\.js['"]/);
    expect(bannerSrc).toMatch(/pickBannerVariant/);
    expect(bannerSrc).toMatch(/dayCopy/);
  });

  test('fetches /api/billing/status on mount inside a useEffect', () => {
    expect(bannerSrc).toMatch(/useEffect\(/);
    expect(bannerSrc).toMatch(/fetch\(['"]\/api\/billing\/status['"]\)/);
  });

  test('re-fetches the status every 5 minutes', () => {
    expect(bannerSrc).toMatch(/setInterval\([\s\S]{0,200}5 \* 60 \* 1000\)/);
  });

  test('clears the interval on unmount (no leaked timer)', () => {
    expect(bannerSrc).toMatch(/clearInterval\(interval\)/);
  });

  test('respects the `enabled` prop (no fetch when disabled)', () => {
    expect(bannerSrc).toMatch(/if \(!enabled\) return/);
  });

  test('swallows fetch errors silently (no UI break)', () => {
    expect(bannerSrc).toMatch(/catch[\s\S]{0,100}\{[\s\S]{0,100}\}/);
  });

  test('every variant has its own data-testid for visual / e2e selection', () => {
    for (const id of [
      'subscription-banner-past-due',
      'subscription-banner-canceled',
      'subscription-banner-expired',
      'subscription-banner-trial-ending',
      'subscription-banner-trial',
    ]) {
      expect(bannerSrc).toMatch(new RegExp(`testId=["']${id}["']`));
    }
  });

  test('expired, canceled, AND trial-ending CTAs hit /api/billing/checkout', () => {
    // trial-ending uses checkout (not portal) because during the
    // no-card-upfront trial the user has no Stripe customer yet —
    // Portal would 400 with "No subscription on file". Checkout
    // creates the customer + subscription in one go.
    expect(bannerSrc).toMatch(/fetch\(['"]\/api\/billing\/checkout['"]/);
    // Trial-ending Strip block must use openCheckout (matches the
    // whole Strip JSX from variant check to closing /Strip).
    expect(bannerSrc).toMatch(
      /variant === 'trial-ending'[\s\S]*?testId="subscription-banner-trial-ending"[\s\S]*?onClick=\{openCheckout\}[\s\S]*?<\/Strip>/
    );
  });

  test('past_due CTA hits /api/billing/portal (existing customer needs to update card)', () => {
    expect(bannerSrc).toMatch(/fetch\(['"]\/api\/billing\/portal['"]/);
    expect(bannerSrc).toMatch(
      /variant === 'past-due'[\s\S]*?testId="subscription-banner-past-due"[\s\S]*?onClick=\{openPortal\}[\s\S]*?<\/Strip>/
    );
  });

  test('redirects to the returned Stripe URL via window.location.href', () => {
    expect(bannerSrc).toMatch(/window\.location\.href\s*=\s*url/);
  });

  test('busy flag prevents double-click stampede on the CTA', () => {
    expect(bannerSrc).toMatch(/if \(busy\) return/);
    expect(bannerSrc).toMatch(/setBusy\(true\)/);
  });

  test('trial variant copy mentions "Free trial" + remaining days', () => {
    expect(bannerSrc).toMatch(/Free trial:[\s\S]{0,40}remaining/);
  });

  test('trial-ending variant copy mentions "ends in" + Add payment method CTA', () => {
    expect(bannerSrc).toMatch(/Your free trial ends in/);
    expect(bannerSrc).toMatch(/Add payment method/);
  });

  test('expired variant copy mentions the price (so the user knows what they\'re signing up for)', () => {
    expect(bannerSrc).toMatch(/Subscribe[\s\S]{0,40}gbpPerMonth/);
  });
});

// ─────────────────── PR-4 mobile stacking ───────────────────
//
// Mirrors the QuotaCounter pattern (2026-06-25): mobile stacks the
// body + CTA vertically, desktop sits them inline. Pinning these
// classes at the source level so a future refactor can't silently
// regress the mobile layout. See /tmp/mobile-responsive-plan.md
// audit item #4.

describe('SubscriptionBanner.jsx — mobile stacking (PR-4)', () => {
  test('Strip wrapper uses `flex flex-col fq:flex-row` so the body + CTA stack on mobile and sit inline on desktop', () => {
    // Pull out the Strip function definition + className.
    const stripMatch = bannerSrc.match(
      /function\s+Strip\s*\([\s\S]*?className\s*=\s*["']([^"']+)["']/
    );
    expect(stripMatch).not.toBeNull();
    const classes = stripMatch[1];

    // Mobile-first: base class is `flex-col` (no `fq:` prefix).
    expect(classes).toMatch(/\bflex-col\b/);
    // Desktop: `fq:flex-row` flips back to inline at >=900px.
    expect(classes).toMatch(/\bfq:flex-row\b/);
    // Same alignment pattern as QuotaCounter — items-stretch on mobile
    // so the CTA fills the row width; items-center on desktop.
    expect(classes).toMatch(/\bitems-stretch\b/);
    expect(classes).toMatch(/\bfq:items-center\b/);
  });

  test('CTA min-height is 44 (mobile touch-target floor — was 36 pre-PR-4)', () => {
    // The button inside Cta — single source of truth for tap height.
    const ctaButton = bannerSrc.match(
      /function\s+Cta\s*\([\s\S]*?<button[\s\S]*?<\/button>/
    );
    expect(ctaButton).not.toBeNull();
    expect(ctaButton[0]).toMatch(/minHeight\s*:\s*44\b/);
    // And explicitly that the old 36 value is gone.
    expect(ctaButton[0]).not.toMatch(/minHeight\s*:\s*36\b/);
  });

  test('CTA `shrink-0` only applies on desktop (so the CTA can stretch full-width on mobile)', () => {
    const ctaButton = bannerSrc.match(
      /function\s+Cta\s*\([\s\S]*?<button[\s\S]*?<\/button>/
    );
    expect(ctaButton).not.toBeNull();
    // Desktop pins the CTA right via `fq:shrink-0`.
    expect(ctaButton[0]).toMatch(/\bfq:shrink-0\b/);
    // No bare (always-on) `shrink-0` — that would prevent mobile stretch.
    expect(ctaButton[0]).not.toMatch(/(?<!fq:)\bshrink-0\b/);
  });

  test('every Cta call-site carries data-touch-exempt="true" (the inner button is 44px-safe; lint scanner can\'t see through the wrapper)', () => {
    // Count Cta invocations and assert they're all exempted. This
    // keeps the touch-target lint allow-list shrinkage honest — if
    // someone removes the attribute, the lint scanner immediately
    // re-flags the line as a NEW sub-44px violation.
    //
    // The regex grabs the whole `<Cta ...>` opening tag (greedy up to
    // the first `>`); `[^>]*` so we don't run past the tag.
    const ctaInvocations = bannerSrc.match(/<Cta\b[^>]*>/g) || [];
    // Filter to invocations carrying onClick (skip the function-def line
    // `function Cta(...)` which isn't a JSX element — it's the function
    // signature; the regex above already excludes it because `(` not `>`).
    const withOnClick = ctaInvocations.filter(inv => /\bonClick\b/.test(inv));
    expect(withOnClick.length).toBeGreaterThanOrEqual(4);
    for (const inv of withOnClick) {
      expect(inv).toMatch(/data-touch-exempt\s*=\s*["']true["']/);
    }
  });

  test('Body uses `min-w-0` so long copy can shrink inside a flex column without forcing horizontal overflow', () => {
    const bodyMatch = bannerSrc.match(
      /function\s+Body\s*\([\s\S]*?className\s*=\s*["']([^"']+)["']/
    );
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch[1]).toMatch(/\bmin-w-0\b/);
    // flex-1 stays so the text takes the available width on desktop.
    expect(bodyMatch[1]).toMatch(/\bflex-1\b/);
  });
});

// ─────────────────── App.jsx integration ───────────────────

describe('SubscriptionBanner — App.jsx wiring', () => {
  test('App.jsx imports SubscriptionBanner', () => {
    expect(appSrc).toMatch(
      /import\s+SubscriptionBanner\s+from\s+['"]\.\/components\/SubscriptionBanner\.jsx['"]/
    );
  });

  test('SubscriptionBanner is mounted in the App tree', () => {
    expect(appSrc).toMatch(/<SubscriptionBanner\b/);
  });

  test('mounted alongside the other persistent banners (OfflineBanner, SaveErrorBanner)', () => {
    const idx = appSrc.indexOf('<SubscriptionBanner');
    const offlineIdx = appSrc.indexOf('<OfflineBanner');
    const saveErrIdx = appSrc.indexOf('<SaveErrorBanner');
    expect(idx).toBeGreaterThan(-1);
    expect(offlineIdx).toBeGreaterThan(-1);
    expect(saveErrIdx).toBeGreaterThan(-1);
    const closest = Math.min(
      Math.abs(idx - offlineIdx),
      Math.abs(idx - saveErrIdx)
    );
    expect(closest).toBeLessThan(400);
  });
});
