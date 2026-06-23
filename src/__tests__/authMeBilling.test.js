/**
 * /auth/me billing block (2026-06-22).
 *
 * The SPA reads /auth/me on boot to learn who the user is + their
 * feature flags. The quota model adds a `billing` block to the same
 * response so the banner can render the correct variant on the first
 * paint without a second round trip to /api/billing/status.
 *
 * This test exercises `resolveQuotaState` (the pure helper that
 * server.js feeds into the response) across the four meaningful
 * states. The server.js wiring itself is asserted source-level in
 * serverQuotaGate.test.js.
 */
import { resolveQuotaState, FREE_QUOTES_LIMIT } from '../utils/quotaGate.js';

const NOW = new Date('2026-06-22T12:00:00Z');

describe('resolveQuotaState — shape contract for /auth/me billing block', () => {
  test('always returns the four contract fields', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 0, comp_until: null },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result).toHaveProperty('quotaState');
    expect(result).toHaveProperty('hasActiveSubscription');
    expect(result).toHaveProperty('isComped');
    expect(result).toHaveProperty('freeQuotesUsed');
    expect(result).toHaveProperty('freeQuotesLimit');
  });

  test('freeQuotesLimit pinned at FREE_QUOTES_LIMIT (=3) for cold users', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 1 },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.freeQuotesLimit).toBe(FREE_QUOTES_LIMIT);
    expect(result.freeQuotesLimit).toBe(3);
  });

  test('freeQuotesLimit grows for referred users (referrals Phase 1)', () => {
    // Referee at signup: +2 bonus → effective limit is 5.
    const result = resolveQuotaState(
      { free_quotes_used: 0, bonus_free_quotes: 2 },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.freeQuotesLimit).toBe(5);
    expect(result.bonusFreeQuotes).toBe(2);
  });
});

describe('resolveQuotaState — four paths Mark / Paul / new users / locked-out', () => {
  test('Mark (active subscription) → subscribed, no isComped', () => {
    const result = resolveQuotaState(
      {
        free_quotes_used: 0,
        comp_until: null,
        subscription_status: 'active',
      },
      { hasActiveSubscription: true, now: NOW }
    );
    expect(result.quotaState).toBe('subscribed');
    expect(result.hasActiveSubscription).toBe(true);
    expect(result.isComped).toBe(false);
  });

  test('Paul (comped through 2026-12-22) → comped, not subscribed', () => {
    const result = resolveQuotaState(
      {
        free_quotes_used: 1, // doesn't matter; comp wins
        comp_until: '2026-12-22T00:00:00Z',
        subscription_status: null,
      },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('comped');
    expect(result.isComped).toBe(true);
    expect(result.hasActiveSubscription).toBe(false);
  });

  test('Brand-new signup with 0 quotes used → free-remaining', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 0, comp_until: null },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('free-remaining');
    expect(result.freeQuotesUsed).toBe(0);
  });

  test('Mid-tier user with 2 quotes used → still free-remaining', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 2, comp_until: null },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('free-remaining');
    expect(result.freeQuotesUsed).toBe(2);
  });

  test('User who has used all 3 → exhausted', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 3, comp_until: null },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('exhausted');
    expect(result.freeQuotesUsed).toBe(3);
  });

  test('Expired comp falls back to quota (3 still available)', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 0, comp_until: '2020-01-01T00:00:00Z' },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('free-remaining');
    expect(result.isComped).toBe(false);
  });

  test('Expired comp + exhausted quota → exhausted', () => {
    const result = resolveQuotaState(
      { free_quotes_used: 5, comp_until: '2020-01-01T00:00:00Z' },
      { hasActiveSubscription: false, now: NOW }
    );
    expect(result.quotaState).toBe('exhausted');
    expect(result.freeQuotesUsed).toBe(3); // clamped
  });

  test('Subscribed user with comp_until set still reads as subscribed (not comped)', () => {
    // Edge case: a paying customer who also has a comp_until from a
    // historical setup. Subscribed wins — they're paying us.
    const result = resolveQuotaState(
      {
        free_quotes_used: 99,
        comp_until: '2030-01-01T00:00:00Z',
        subscription_status: 'active',
      },
      { hasActiveSubscription: true, now: NOW }
    );
    expect(result.quotaState).toBe('subscribed');
    expect(result.isComped).toBe(false);
  });
});

describe('resolveQuotaState — null safety', () => {
  test('handles null user defensively (treat as exhausted, never silently allow)', () => {
    const result = resolveQuotaState(null, { hasActiveSubscription: false, now: NOW });
    expect(result.quotaState).toBe('exhausted');
    expect(result.freeQuotesUsed).toBe(0);
  });

  test('subscribed=true wins even for null user (Stripe is source of truth)', () => {
    const result = resolveQuotaState(null, { hasActiveSubscription: true, now: NOW });
    expect(result.quotaState).toBe('subscribed');
  });
});
