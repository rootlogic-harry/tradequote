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

  describe('FREE_QUOTES_LIMIT export', () => {
    test('is 3 — pinned so the rest of the app can import it instead of magic numbers', () => {
      expect(FREE_QUOTES_LIMIT).toBe(3);
    });
  });

  describe('resolveQuotaState — billing payload helper', () => {
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
