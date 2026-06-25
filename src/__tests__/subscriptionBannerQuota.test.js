/**
 * Quota-tier banner — disjoint state spaces (2026-06-25).
 *
 * The quota-driven banners (`free-remaining`, `exhausted`) moved
 * from SubscriptionBanner into the unified `QuotaCounter` strip per
 * the unified-banner locked spec. SubscriptionBanner is now strictly
 * Stripe-state-only.
 *
 * These tests pin that contract from two angles:
 *
 *   1. `pickBannerVariant` resolves the quota states to `'none'`.
 *      Stripe-driven states (`past_due`, `canceled`, `expired`,
 *      `trialing`, `active`) still resolve normally.
 *   2. SubscriptionBanner.jsx no longer carries `subscription-banner-
 *      exhausted` / `subscription-banner-free-remaining` JSX. The
 *      data-testid grep proves the variants were physically removed.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pickBannerVariant, freeQuotesCopy } from '../utils/trialState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const bannerSrc = readFileSync(join(repoRoot, 'src/components/SubscriptionBanner.jsx'), 'utf8');

describe('pickBannerVariant — quota states resolve to "none" (handled by QuotaCounter)', () => {
  test('subscribed quotaState → "none" (paid customer; no banner)', () => {
    expect(
      pickBannerVariant({ configured: true, quotaState: 'subscribed' })
    ).toBe('none');
  });

  test('comped quotaState → "none" (trusted user; comping never surfaces)', () => {
    expect(
      pickBannerVariant({ configured: true, quotaState: 'comped' })
    ).toBe('none');
  });

  test('free-remaining quotaState → "none" (QuotaCounter owns this state now)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
      })
    ).toBe('none');
  });

  test('exhausted quotaState → "none" (QuotaCounter owns this state now)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        quotaState: 'exhausted',
        freeQuotesUsed: 3,
        freeQuotesLimit: 3,
      })
    ).toBe('none');
  });

  test('purchased-remaining quotaState → "none" (QuotaCounter owns this state now)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        quotaState: 'purchased-remaining',
        purchasedQuotesRemaining: 4,
      })
    ).toBe('none');
  });

  test('Stripe past_due still wins over quota state (Update Card is urgent)', () => {
    // A user who is paying but whose card failed should see Update
    // Card from SubscriptionBanner. The Stripe state is more urgent
    // — they're already a paying customer; we just need their card.
    // This test ensures the Stripe lane stays load-bearing even
    // though the quota lane now resolves to 'none'.
    expect(
      pickBannerVariant({
        configured: true,
        state: 'past_due',
        quotaState: 'free-remaining',
        freeQuotesUsed: 0,
      })
    ).toBe('past-due');
  });

  test('Stripe canceled still wins over quota state (Resubscribe is urgent)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        state: 'canceled',
        quotaState: 'exhausted',
      })
    ).toBe('canceled');
  });

  test('missing quotaState falls back to legacy state mapping', () => {
    expect(pickBannerVariant({ configured: true, state: 'past_due' })).toBe('past-due');
    expect(pickBannerVariant({ configured: true, state: 'canceled' })).toBe('canceled');
    expect(pickBannerVariant({ configured: true, state: 'active' })).toBe('none');
  });

  test('not configured → none even with quota fields', () => {
    expect(
      pickBannerVariant({
        configured: false,
        quotaState: 'exhausted',
      })
    ).toBe('none');
  });
});

describe('freeQuotesCopy (back-compat helper)', () => {
  // The helper stays exported so any stale caller doesn't crash on
  // an undefined import; SubscriptionBanner itself no longer renders
  // this copy.
  test('formats "{used} of {limit} free quotes used"', () => {
    expect(freeQuotesCopy(2, 3)).toBe('2 of 3 free quotes used');
  });
  test('formats correctly at 0 used', () => {
    expect(freeQuotesCopy(0, 3)).toBe('0 of 3 free quotes used');
  });
  test('formats correctly at limit', () => {
    expect(freeQuotesCopy(3, 3)).toBe('3 of 3 free quotes used');
  });
});

describe('SubscriptionBanner.jsx — quota variants removed (2026-06-25)', () => {
  test('no longer renders the "exhausted" variant (moved to QuotaCounter)', () => {
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-exhausted["']/);
  });

  test('no longer renders the "free-remaining" variant (moved to QuotaCounter)', () => {
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-free-remaining["']/);
  });

  test('no longer imports freeQuotesCopy (no quota copy in this component)', () => {
    expect(bannerSrc).not.toMatch(/freeQuotesCopy/);
  });

  test('still renders the Stripe-state variants (past-due, canceled, expired, trial, trial-ending)', () => {
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-past-due["']/);
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-canceled["']/);
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-expired["']/);
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-trial["']/);
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-trial-ending["']/);
  });

  test('no longer carries the "free quotes used" copy template', () => {
    // The "X free quotes used" phrasing was the load-bearing string
    // for the free-remaining variant. Confirms the strip really did
    // move out (the unified QuotaCounter uses "left" / "free quotes
    // left" instead).
    expect(bannerSrc).not.toMatch(/free quotes used/i);
  });

  test('no longer carries the exhausted lockout copy', () => {
    expect(bannerSrc).not.toMatch(/You've used your.*free quotes\. Subscribe to continue/);
  });

  test('subscribed + comped quotaStates still render no banner', () => {
    // Defensive — these never had their own variant.
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-comped["']/);
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-subscribed["']/);
  });
});
