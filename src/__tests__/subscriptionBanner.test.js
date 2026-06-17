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
