/**
 * Tests for the Active / Archive bucketing helpers.
 *
 * The contract under test:
 *   - Active and Archive are mutually exclusive and total for every known
 *     status value.
 *   - Completed STAYS in Active (Mark uses it for invoicing).
 *   - Expired = (status === 'sent' AND expiresAt < now).
 *   - Sent with no expiresAt is treated as active (we don't synthesise
 *     expiry).
 *   - Accepted with a past expiresAt stays active — expiry only affects
 *     un-responded sends.
 */

import { isActiveJob, isArchivedJob, isExpired } from '../utils/jobLifecycle.js';

const NOW = new Date('2026-06-21T12:00:00Z');
const PAST = new Date('2026-06-01T12:00:00Z').toISOString();
const FUTURE = new Date('2026-07-21T12:00:00Z').toISOString();

const STATUSES = ['draft', 'sent', 'accepted', 'completed', 'declined'];

describe('isExpired', () => {
  test('sent + past expiry → true', () => {
    expect(isExpired({ status: 'sent', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('sent + future expiry → false', () => {
    expect(isExpired({ status: 'sent', expiresAt: FUTURE }, NOW)).toBe(false);
  });

  test('sent + no expiry → false (do not synthesise)', () => {
    expect(isExpired({ status: 'sent' }, NOW)).toBe(false);
  });

  test('accepted + past expiry → false (expiry only affects sent)', () => {
    expect(isExpired({ status: 'accepted', expiresAt: PAST }, NOW)).toBe(false);
  });

  test('draft + past expiry → false', () => {
    expect(isExpired({ status: 'draft', expiresAt: PAST }, NOW)).toBe(false);
  });

  test('declined + past expiry → false', () => {
    expect(isExpired({ status: 'declined', expiresAt: PAST }, NOW)).toBe(false);
  });

  test('null / undefined / non-object → false', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
    expect(isExpired('not a job', NOW)).toBe(false);
  });

  test('garbage expiresAt → false (does not crash)', () => {
    expect(isExpired({ status: 'sent', expiresAt: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('isActiveJob', () => {
  test.each([
    ['draft', true],
    ['sent', true],
    ['accepted', true],
    ['completed', true],
    ['declined', false],
  ])('status "%s" without expiry → %s', (status, expected) => {
    expect(isActiveJob({ status }, NOW)).toBe(expected);
  });

  test('sent + future expiry → active', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: FUTURE }, NOW)).toBe(true);
  });

  test('sent + past expiry → NOT active (archive)', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: PAST }, NOW)).toBe(false);
  });

  test('sent + no expiry → active', () => {
    expect(isActiveJob({ status: 'sent' }, NOW)).toBe(true);
  });

  test('accepted + past expiry → still active (Mark uses for invoicing)', () => {
    expect(isActiveJob({ status: 'accepted', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('completed + past expiry → still active', () => {
    expect(isActiveJob({ status: 'completed', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('missing status defaults to draft → active', () => {
    expect(isActiveJob({}, NOW)).toBe(true);
  });

  test('unknown status defaults to active so future statuses do not disappear', () => {
    expect(isActiveJob({ status: 'invoiced' }, NOW)).toBe(true);
  });

  test('null / undefined → false (safe)', () => {
    expect(isActiveJob(null, NOW)).toBe(false);
    expect(isActiveJob(undefined, NOW)).toBe(false);
  });
});

describe('isArchivedJob', () => {
  test.each([
    ['draft', false],
    ['sent', false],
    ['accepted', false],
    ['completed', false],
    ['declined', true],
  ])('status "%s" without expiry → %s', (status, expected) => {
    expect(isArchivedJob({ status }, NOW)).toBe(expected);
  });

  test('sent + past expiry → archived', () => {
    expect(isArchivedJob({ status: 'sent', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('sent + future expiry → NOT archived', () => {
    expect(isArchivedJob({ status: 'sent', expiresAt: FUTURE }, NOW)).toBe(false);
  });

  test('sent + no expiry → NOT archived', () => {
    expect(isArchivedJob({ status: 'sent' }, NOW)).toBe(false);
  });

  test('declined + past expiry → archived (declined dominates)', () => {
    expect(isArchivedJob({ status: 'declined', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('accepted + past expiry → NOT archived', () => {
    expect(isArchivedJob({ status: 'accepted', expiresAt: PAST }, NOW)).toBe(false);
  });

  test('null / undefined → false', () => {
    expect(isArchivedJob(null, NOW)).toBe(false);
    expect(isArchivedJob(undefined, NOW)).toBe(false);
  });
});

describe('mutually exclusive + total invariant', () => {
  // The whole point of the split: every job lands in exactly one bucket.
  // If both return true or both return false for some shape, the dashboard
  // would either double-count or silently drop jobs.
  const sample = (status, expiresAt) => ({ status, expiresAt });
  const expiries = [undefined, PAST, FUTURE];

  test('every known status × every expiry shape lands in exactly one bucket', () => {
    for (const status of STATUSES) {
      for (const expiresAt of expiries) {
        const job = sample(status, expiresAt);
        const active = isActiveJob(job, NOW);
        const archived = isArchivedJob(job, NOW);
        // XOR: exactly one must be true
        expect(active || archived).toBe(true);
        expect(active && archived).toBe(false);
      }
    }
  });

  test('missing-status job (defaults to draft) is active, not archived', () => {
    expect(isActiveJob({}, NOW)).toBe(true);
    expect(isArchivedJob({}, NOW)).toBe(false);
  });
});

describe('now defaults to current time', () => {
  test('isExpired uses current time when not provided', () => {
    // Past expiry should still expire without explicit `now`
    expect(isExpired({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(true);
  });

  test('isActiveJob uses current time when not provided', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(false);
  });

  test('isArchivedJob uses current time when not provided', () => {
    expect(isArchivedJob({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(true);
  });
});
