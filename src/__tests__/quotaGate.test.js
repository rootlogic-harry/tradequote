/**
 * Quota-based free tier (TRQ-quota) — pure decision function.
 *
 * The product change (2026-06-22): we moved from "1 month free trial"
 * (time-based) to "3 free quotes, then pay" (quota-based). The gate
 * below answers a single question — given a user row plus their
 * Stripe subscription state, are they allowed to consume an AI
 * analysis right now? — without doing any I/O.
 *
 * Three independent callers depend on this function:
 *   1. /api/users/:id/analyse middleware (the hard 402 lockout).
 *   2. /auth/me response (so the client UI can render the right
 *      banner without a second round trip).
 *   3. Any future admin "is user X eligible?" query.
 *
 * The order of evaluation in quotaGate is load-bearing:
 *   - An active subscription always wins (paid customer; don't read
 *     the comp clock or the free-quote counter).
 *   - Then comp_until (Paul, and any other future trusted user).
 *   - Then the 3-free-quote allowance.
 *   - Otherwise: deny, with reason='quota_exhausted'.
 */
import { quotaGate, FREE_QUOTES_LIMIT, resolveQuotaState } from '../utils/quotaGate.js';

describe('quotaGate', () => {
  const baseNow = new Date('2026-06-22T12:00:00Z');

  describe('admin plan bypass (2026-07-07)', () => {
    test('plan=admin → allowed with reason "admin", even with zero of everything', () => {
      const user = { plan: 'admin', free_quotes_used: 0, purchased_quotes: 0 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'admin',
      });
    });

    test('plan=admin wins over quota exhaustion (Harry + Mark unlimited)', () => {
      const user = { plan: 'admin', free_quotes_used: 999, purchased_quotes: 0 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'admin',
      });
    });

    test('plan=admin reports "admin" even when the user has an active Stripe sub', () => {
      // Real scenario 2026-07-07 — Mark's markdoyle account was plan=admin
      // AND subscription_status=active. The UI must key off `admin` so the
      // billing banner never mistakes him for a paying customer.
      const user = { plan: 'admin', free_quotes_used: 0, purchased_quotes: 0 };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'admin',
      });
    });

    test('plan=basic → no admin bypass (regression guard)', () => {
      const user = { plan: 'basic', free_quotes_used: 3, purchased_quotes: 0 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });
  });

  describe('active subscription path', () => {
    test('allows when hasActiveSubscription=true regardless of quota', () => {
      const user = { free_quotes_used: 99, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });

    test('allows even when quota exhausted', () => {
      const user = { free_quotes_used: 3, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });

    test('allows even when comp is expired', () => {
      const user = { free_quotes_used: 10, comp_until: '2020-01-01T00:00:00Z' };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });
  });

  describe('comp path', () => {
    test('allows when comp_until is in the future', () => {
      const future = '2026-12-22T00:00:00Z';
      const user = { free_quotes_used: 99, comp_until: future };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'comped',
      });
    });

    test('does not consult the comp clock when subscription is active', () => {
      const future = '2026-12-22T00:00:00Z';
      const user = { free_quotes_used: 1, comp_until: future };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });

    test('falls through to quota when comp_until is in the past', () => {
      const past = '2026-01-01T00:00:00Z';
      const user = { free_quotes_used: 0, comp_until: past };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('falls through to quota when comp_until is null', () => {
      const user = { free_quotes_used: 1, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('falls through to quota when comp_until is undefined', () => {
      const user = { free_quotes_used: 0 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('comp boundary: now exactly equals comp_until → expired', () => {
      const exact = baseNow.toISOString();
      const user = { free_quotes_used: 3, comp_until: exact };
      // Exhausted because comp is not strictly in the future.
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });
  });

  describe('free-quota path', () => {
    test('allows when free_quotes_used = 0', () => {
      const user = { free_quotes_used: 0, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('allows when free_quotes_used = 2 (third free quote about to be used)', () => {
      const user = { free_quotes_used: 2, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('denies when free_quotes_used = 3 (all three already consumed)', () => {
      const user = { free_quotes_used: 3, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('denies when free_quotes_used exceeds limit (defensive)', () => {
      const user = { free_quotes_used: 99, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('treats null/undefined free_quotes_used as 0', () => {
      expect(
        quotaGate({ free_quotes_used: null }, { hasActiveSubscription: false, now: baseNow })
      ).toEqual({ allowed: true, reason: 'free-remaining' });
      expect(
        quotaGate({}, { hasActiveSubscription: false, now: baseNow })
      ).toEqual({ allowed: true, reason: 'free-remaining' });
    });
  });

  describe('null safety / contract', () => {
    test('null user → denied (defensive — never silently allow)', () => {
      expect(quotaGate(null, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('undefined user → denied', () => {
      expect(quotaGate(undefined, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('defaults `now` to current time when not provided', () => {
      // Just verifies the call is callable without `now` — runtime
      // exact-time assertions live in the boundary tests above.
      const result = quotaGate(
        { free_quotes_used: 0, comp_until: null },
        { hasActiveSubscription: false }
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('bonus_free_quotes (referrals Phase 1)', () => {
    test('allows past the baseline limit when bonus quotes are available', () => {
      // Referred user at signup: 0 used, +2 bonus → 5-quote allowance.
      const user = { free_quotes_used: 3, bonus_free_quotes: 2, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('denies when used reaches the effective limit (baseline + bonus)', () => {
      const user = { free_quotes_used: 5, bonus_free_quotes: 2, comp_until: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('allows exactly at baseline limit when bonus is positive', () => {
      // Used 3 — would be exhausted without bonus. +2 bonus → still has 2 left.
      const user = { free_quotes_used: 3, bonus_free_quotes: 2 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('treats null/undefined bonus as 0 (backwards compat with cold users)', () => {
      const user = { free_quotes_used: 2, bonus_free_quotes: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('negative bonus is clamped to 0 (defensive)', () => {
      const user = { free_quotes_used: 3, bonus_free_quotes: -5 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('subscription still wins over bonus quotes (paid customer)', () => {
      const user = { free_quotes_used: 99, bonus_free_quotes: 10 };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });

    test('comp still wins over bonus quotes (bonus invisible during comp)', () => {
      const user = {
        free_quotes_used: 99,
        bonus_free_quotes: 10,
        comp_until: '2026-12-22T00:00:00Z',
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'comped',
      });
    });
  });

  describe('resolveQuotaState — bonus quotes (referrals Phase 1)', () => {
    test('returns effective limit (baseline + bonus) in freeQuotesLimit', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 1, bonus_free_quotes: 2, comp_until: null },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.freeQuotesLimit).toBe(5);
      expect(result.bonusFreeQuotes).toBe(2);
      expect(result.quotaState).toBe('free-remaining');
      expect(result.freeQuotesUsed).toBe(1);
    });

    test('clamps freeQuotesUsed at the effective limit, not baseline', () => {
      // Used 5 of a 5-quote allowance. Without the bonus-aware clamp the
      // banner would show "3 of 5" (legacy clamp). With bonus we want "5 of 5".
      const result = resolveQuotaState(
        { free_quotes_used: 5, bonus_free_quotes: 2 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.freeQuotesUsed).toBe(5);
      expect(result.freeQuotesLimit).toBe(5);
      expect(result.quotaState).toBe('exhausted');
    });

    test('bonusFreeQuotes defaults to 0 when absent from user row', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 0 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.bonusFreeQuotes).toBe(0);
      expect(result.freeQuotesLimit).toBe(3);
    });
  });

  describe('FREE_QUOTES_LIMIT export', () => {
    test('is 3 — pinned so the rest of the app can import it instead of magic numbers', () => {
      expect(FREE_QUOTES_LIMIT).toBe(3);
    });
  });

  describe('purchased_quotes (pay-as-you-go pack, 2026-06-24)', () => {
    test('allows with purchased-remaining when free is exhausted but pack > 0', () => {
      const user = {
        free_quotes_used: 3,
        bonus_free_quotes: 0,
        purchased_quotes: 5,
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'purchased-remaining',
      });
    });

    test('free quotes spent FIRST — never burns a paid quote while a free one is available', () => {
      // 2 free remaining, 5 paid → reason MUST be free-remaining.
      const user = {
        free_quotes_used: 1,
        bonus_free_quotes: 0,
        purchased_quotes: 5,
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'free-remaining',
      });
    });

    test('free + bonus exhausted, pack > 0 → purchased-remaining', () => {
      // Referee with bonus also burns free+bonus first.
      const user = {
        free_quotes_used: 5,
        bonus_free_quotes: 2,
        purchased_quotes: 3,
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'purchased-remaining',
      });
    });

    test('free exhausted, pack exhausted → quota_exhausted', () => {
      const user = {
        free_quotes_used: 3,
        purchased_quotes: 0,
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('negative purchased_quotes is clamped to 0 (defensive — refund bug couldn\'t grant)', () => {
      const user = { free_quotes_used: 3, purchased_quotes: -5 };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('null/undefined purchased_quotes treated as 0 (backwards compat with cold users)', () => {
      const user = { free_quotes_used: 3, purchased_quotes: null };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: false,
        reason: 'quota_exhausted',
      });
    });

    test('subscription wins over purchased (paid customer never decrements pack)', () => {
      const user = { free_quotes_used: 99, purchased_quotes: 5 };
      expect(quotaGate(user, { hasActiveSubscription: true, now: baseNow })).toEqual({
        allowed: true,
        reason: 'subscribed',
      });
    });

    test('comp wins over purchased (pack accumulates during comp)', () => {
      const user = {
        free_quotes_used: 99,
        purchased_quotes: 5,
        comp_until: '2026-12-22T00:00:00Z',
      };
      expect(quotaGate(user, { hasActiveSubscription: false, now: baseNow })).toEqual({
        allowed: true,
        reason: 'comped',
      });
    });

    test('resolveQuotaState exposes purchasedQuotesRemaining', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 3, purchased_quotes: 4 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.purchasedQuotesRemaining).toBe(4);
      expect(result.quotaState).toBe('purchased-remaining');
    });

    test('resolveQuotaState clamps negative purchasedQuotesRemaining to 0', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 3, purchased_quotes: -7 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.purchasedQuotesRemaining).toBe(0);
      expect(result.quotaState).toBe('exhausted');
    });

    test('resolveQuotaState defaults purchasedQuotesRemaining to 0 when absent', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 0 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.purchasedQuotesRemaining).toBe(0);
    });

    test('quotaState is "free-remaining" when free > 0 even if pack > 0 (display picks total via counter)', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 1, purchased_quotes: 3 },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.quotaState).toBe('free-remaining');
      expect(result.purchasedQuotesRemaining).toBe(3);
      expect(result.freeQuotesUsed).toBe(1);
      expect(result.freeQuotesLimit).toBe(3);
    });
  });

  describe('resolveQuotaState — billing payload helper', () => {
    test('admin — reports quotaState "admin" (bug 2026-07-07)', () => {
      // Downstream SPA (selectCounterState in quotaCounter.js) maps
      // this to 'subscribed' for banner purposes.
      expect(
        resolveQuotaState(
          { plan: 'admin', free_quotes_used: 0, comp_until: null },
          { hasActiveSubscription: false, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'admin',
      });
    });

    test('admin — reports "admin" even when the row has an active Stripe sub', () => {
      // Mark's markdoyle account carried both plan=admin AND
      // subscription_status=active up to 2026-07-07.
      expect(
        resolveQuotaState(
          { plan: 'admin', free_quotes_used: 0, comp_until: null },
          { hasActiveSubscription: true, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'admin',
        hasActiveSubscription: true,
      });
    });

    test('subscribed', () => {
      expect(
        resolveQuotaState(
          { free_quotes_used: 0, comp_until: null },
          { hasActiveSubscription: true, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'subscribed',
        hasActiveSubscription: true,
        isComped: false,
        freeQuotesUsed: 0,
        freeQuotesLimit: 3,
      });
    });

    test('comped', () => {
      expect(
        resolveQuotaState(
          { free_quotes_used: 2, comp_until: '2026-12-22T00:00:00Z' },
          { hasActiveSubscription: false, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'comped',
        hasActiveSubscription: false,
        isComped: true,
        freeQuotesUsed: 2,
        freeQuotesLimit: 3,
      });
    });

    test('free-remaining', () => {
      expect(
        resolveQuotaState(
          { free_quotes_used: 1, comp_until: null },
          { hasActiveSubscription: false, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'free-remaining',
        hasActiveSubscription: false,
        isComped: false,
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
      });
    });

    test('exhausted', () => {
      expect(
        resolveQuotaState(
          { free_quotes_used: 3, comp_until: null },
          { hasActiveSubscription: false, now: baseNow }
        )
      ).toMatchObject({
        quotaState: 'exhausted',
        hasActiveSubscription: false,
        isComped: false,
        freeQuotesUsed: 3,
        freeQuotesLimit: 3,
      });
    });

    test('clamps freeQuotesUsed at the limit for UI display (never shows "4 of 3")', () => {
      const result = resolveQuotaState(
        { free_quotes_used: 5, comp_until: null },
        { hasActiveSubscription: false, now: baseNow }
      );
      expect(result.freeQuotesUsed).toBe(3);
      expect(result.quotaState).toBe('exhausted');
    });
  });
});
