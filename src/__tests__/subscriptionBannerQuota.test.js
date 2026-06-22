/**
 * Quota-tier banner variants (2026-06-22).
 *
 * The new product surface for the 3-free-quote model. The banner now
 * has four quota-driven states layered on top of the existing
 * Stripe-driven ones:
 *
 *   subscribed     → no banner (paid customer; banner stays quiet)
 *   comped         → no banner (trusted user; comping is a private
 *                    arrangement, the customer-facing UI doesn't tell
 *                    them they're "comped" — that's an internal label)
 *   free-remaining → soft "X of 3 free quotes used" + Subscribe CTA
 *   exhausted      → hard "You've used your 3 free quotes. Subscribe
 *                    to continue." with bigger, primary CTA
 *
 * pickBannerVariant gains a quota-first branch. The legacy Stripe
 * variants (past_due, canceled, trial-ending) still apply because
 * billing complications override quota state — e.g. a past_due
 * customer should see Update Card, not "free quotes" copy.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pickBannerVariant, freeQuotesCopy } from '../utils/trialState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const bannerSrc = readFileSync(join(repoRoot, 'src/components/SubscriptionBanner.jsx'), 'utf8');

describe('pickBannerVariant — quota states', () => {
  test('subscribed quotaState → "none" (paid customer; no banner)', () => {
    expect(
      pickBannerVariant({ configured: true, quotaState: 'subscribed' })
    ).toBe('none');
  });

  test('comped quotaState → "none" (trusted user; never shown as "comped")', () => {
    expect(
      pickBannerVariant({ configured: true, quotaState: 'comped' })
    ).toBe('none');
  });

  test('free-remaining quotaState → "free-remaining" (soft CTA)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
      })
    ).toBe('free-remaining');
  });

  test('exhausted quotaState → "exhausted" (hard lockout)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        quotaState: 'exhausted',
        freeQuotesUsed: 3,
        freeQuotesLimit: 3,
      })
    ).toBe('exhausted');
  });

  test('Stripe past_due overrides free-remaining (Update Card wins over Subscribe)', () => {
    // A user who is paying but whose card failed should see Update
    // Card, not "X free quotes used". The Stripe state is more urgent
    // — they're already a paying customer; we just need their card.
    expect(
      pickBannerVariant({
        configured: true,
        state: 'past_due',
        quotaState: 'free-remaining',
        freeQuotesUsed: 0,
      })
    ).toBe('past-due');
  });

  test('Stripe canceled overrides exhausted (Resubscribe wins)', () => {
    expect(
      pickBannerVariant({
        configured: true,
        state: 'canceled',
        quotaState: 'exhausted',
      })
    ).toBe('canceled');
  });

  test('exhausted wins over legacy trialing/expired state (quota is the new truth)', () => {
    // A pre-existing user whose trial_ends_at is in the past would
    // historically read as state='expired'. Quota model takes over.
    expect(
      pickBannerVariant({
        configured: true,
        state: 'expired',
        quotaState: 'exhausted',
      })
    ).toBe('exhausted');
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

describe('freeQuotesCopy', () => {
  test('singular for 1 quote remaining', () => {
    expect(freeQuotesCopy(2, 3)).toBe('2 of 3 free quotes used');
  });
  test('formats correctly at 0 used', () => {
    expect(freeQuotesCopy(0, 3)).toBe('0 of 3 free quotes used');
  });
  test('formats correctly at limit', () => {
    expect(freeQuotesCopy(3, 3)).toBe('3 of 3 free quotes used');
  });
});

describe('SubscriptionBanner.jsx — quota variants source contract', () => {
  test('renders an "exhausted" variant with its own data-testid', () => {
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-exhausted["']/);
  });

  test('renders a "free-remaining" variant with its own data-testid', () => {
    expect(bannerSrc).toMatch(/testId=["']subscription-banner-free-remaining["']/);
  });

  test('exhausted variant uses the brief\'s exact friendly copy', () => {
    // The brief specifies this copy verbatim — server's 402 body
    // carries the same string. Easy to drift; pin it.
    expect(bannerSrc).toMatch(/You've used your 3 free quotes\. Subscribe to continue\./);
  });

  test('free-remaining variant renders the freeQuotesCopy helper with used/limit', () => {
    // Copy text lives in the helper for testability — the JSX just
    // invokes it. Pin both the helper call and the args so the banner
    // can't quietly stop showing the count.
    expect(bannerSrc).toMatch(/freeQuotesCopy\(status\.freeQuotesUsed/);
    expect(bannerSrc).toMatch(/status\.freeQuotesLimit/);
  });

  test('exhausted variant CTA opens Stripe checkout (hard subscribe path)', () => {
    expect(bannerSrc).toMatch(
      /variant === 'exhausted'[\s\S]*?testId="subscription-banner-exhausted"[\s\S]*?onClick=\{openCheckout\}[\s\S]*?<\/Strip>/
    );
  });

  test('free-remaining variant CTA opens Stripe checkout (soft subscribe path)', () => {
    expect(bannerSrc).toMatch(
      /variant === 'free-remaining'[\s\S]*?testId="subscription-banner-free-remaining"[\s\S]*?onClick=\{openCheckout\}[\s\S]*?<\/Strip>/
    );
  });

  test('subscribed + comped quotaStates render no banner', () => {
    // pickBannerVariant returns 'none' for those, so the JSX should
    // never render a "comped" Strip — there is no testid for it.
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-comped["']/);
    expect(bannerSrc).not.toMatch(/testId=["']subscription-banner-subscribed["']/);
  });
});
