/**
 * Tests for the Active / Completed / Archive bucketing helpers.
 *
 * The contract under test (2026-07-08 refresh — auto-archive for
 * completed jobs after AUTO_ARCHIVE_DAYS days):
 *
 *   - Active, Completed and Archive are mutually exclusive and total
 *     for every known status × savedAt shape.
 *   - `completed` jobs with `savedAt` within the last 30 days → Completed.
 *   - `completed` jobs older than 30 days → Archive (auto-slide).
 *   - `declined` → always Archive.
 *   - `draft` / `sent` / `accepted` → Active regardless of savedAt.
 *   - Expired = (status === 'sent' AND expiresAt < now) — informational
 *     for the badge; does NOT drive bucketing (Mark's late-authorisation
 *     case).
 *
 * See src/utils/jobLifecycle.js file-header for the design decisions.
 */

import {
  isActiveJob,
  isCompletedJob,
  isArchivedJob,
  isExpired,
  AUTO_ARCHIVE_DAYS,
} from '../utils/jobLifecycle.js';

const NOW = new Date('2026-06-21T12:00:00Z');
const PAST = new Date('2026-06-01T12:00:00Z').toISOString();
const FUTURE = new Date('2026-07-21T12:00:00Z').toISOString();

// Recently-saved timestamp — well within the AUTO_ARCHIVE_DAYS window
// so `completed` jobs land in Completed, not Archive.
const FRESH_SAVED_AT = new Date('2026-06-15T12:00:00Z').toISOString(); // 6 days before NOW

// Stale timestamp — 45 days before NOW, comfortably beyond the 30-day
// threshold so `completed` jobs auto-slide into Archive.
const STALE_SAVED_AT = new Date('2026-05-07T12:00:00Z').toISOString();

const STATUSES = ['draft', 'sent', 'accepted', 'completed', 'declined'];

describe('AUTO_ARCHIVE_DAYS', () => {
  test('exports a positive integer', () => {
    expect(Number.isInteger(AUTO_ARCHIVE_DAYS)).toBe(true);
    expect(AUTO_ARCHIVE_DAYS).toBeGreaterThan(0);
  });

  test('is 30 (Harry\'s 2026-07-08 answer)', () => {
    // Locking the value so a silent change surfaces in review; bumping
    // requires updating this test intentionally.
    expect(AUTO_ARCHIVE_DAYS).toBe(30);
  });
});

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
    ['completed', false], // Own tab as of 2026-06-26
    ['declined', false],
  ])('status "%s" without expiry → %s', (status, expected) => {
    expect(isActiveJob({ status }, NOW)).toBe(expected);
  });

  test('sent + future expiry → active', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: FUTURE }, NOW)).toBe(true);
  });

  // Mark's 2026-06-21 feedback: expired sends stay active because
  // customers regularly authorise walling jobs months after expiry.
  test('sent + past expiry → STILL active (Mark: late-authorisation use case)', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('sent + no expiry → active', () => {
    expect(isActiveJob({ status: 'sent' }, NOW)).toBe(true);
  });

  test('accepted + past expiry → still active (Mark uses for invoicing)', () => {
    expect(isActiveJob({ status: 'accepted', expiresAt: PAST }, NOW)).toBe(true);
  });

  test('completed + past expiry → NOT active (lives in Completed / Archive)', () => {
    expect(isActiveJob({ status: 'completed', expiresAt: PAST, savedAt: FRESH_SAVED_AT }, NOW)).toBe(false);
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

  test('savedAt age does not affect active-bucket membership', () => {
    // A very old draft is still Active — auto-archive only applies to
    // completed jobs. If we changed this we'd hide never-finished work.
    expect(isActiveJob({ status: 'draft', savedAt: STALE_SAVED_AT }, NOW)).toBe(true);
    expect(isActiveJob({ status: 'sent', savedAt: STALE_SAVED_AT }, NOW)).toBe(true);
    expect(isActiveJob({ status: 'accepted', savedAt: STALE_SAVED_AT }, NOW)).toBe(true);
  });
});

describe('isCompletedJob (auto-archive threshold)', () => {
  test.each([
    ['draft', false],
    ['sent', false],
    ['accepted', false],
    ['declined', false],
  ])('status "%s" is never Completed', (status) => {
    expect(isCompletedJob({ status, savedAt: FRESH_SAVED_AT }, NOW)).toBe(false);
  });

  test('completed + saved 6 days ago → Completed', () => {
    expect(isCompletedJob({ status: 'completed', savedAt: FRESH_SAVED_AT }, NOW)).toBe(true);
  });

  test('completed + saved 45 days ago → NOT Completed (auto-archived)', () => {
    expect(isCompletedJob({ status: 'completed', savedAt: STALE_SAVED_AT }, NOW)).toBe(false);
  });

  test('completed + missing savedAt → NOT Completed (infinite age)', () => {
    // Better to auto-archive an untimestamped completion than to leave
    // it visible forever — the row is by definition ancient.
    expect(isCompletedJob({ status: 'completed' }, NOW)).toBe(false);
  });

  test('completed at exactly the AUTO_ARCHIVE_DAYS boundary → auto-archived (>=)', () => {
    const boundary = new Date(NOW.getTime() - AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isCompletedJob({ status: 'completed', savedAt: boundary }, NOW)).toBe(false);
  });

  test('completed 1 day before boundary → still Completed', () => {
    const nearBoundary = new Date(NOW.getTime() - (AUTO_ARCHIVE_DAYS - 1) * 24 * 60 * 60 * 1000 + 60_000).toISOString();
    expect(isCompletedJob({ status: 'completed', savedAt: nearBoundary }, NOW)).toBe(true);
  });

  test('completed + garbage savedAt → NOT Completed (safe default = archived)', () => {
    expect(isCompletedJob({ status: 'completed', savedAt: 'not-a-date' }, NOW)).toBe(false);
  });

  test('unknown status is never Completed', () => {
    expect(isCompletedJob({ status: 'invoiced', savedAt: FRESH_SAVED_AT }, NOW)).toBe(false);
  });

  test('null / undefined → false', () => {
    expect(isCompletedJob(null, NOW)).toBe(false);
    expect(isCompletedJob(undefined, NOW)).toBe(false);
  });
});

describe('isArchivedJob (declined + aged-out completed)', () => {
  test('declined → always Archive, regardless of savedAt', () => {
    expect(isArchivedJob({ status: 'declined', savedAt: FRESH_SAVED_AT }, NOW)).toBe(true);
    expect(isArchivedJob({ status: 'declined', savedAt: STALE_SAVED_AT }, NOW)).toBe(true);
    expect(isArchivedJob({ status: 'declined' }, NOW)).toBe(true);
  });

  test('completed + saved 45 days ago → Archive (auto-slide)', () => {
    expect(isArchivedJob({ status: 'completed', savedAt: STALE_SAVED_AT }, NOW)).toBe(true);
  });

  test('completed + saved 6 days ago → NOT archived (still in Completed)', () => {
    expect(isArchivedJob({ status: 'completed', savedAt: FRESH_SAVED_AT }, NOW)).toBe(false);
  });

  test('completed + missing savedAt → Archive (infinite age)', () => {
    expect(isArchivedJob({ status: 'completed' }, NOW)).toBe(true);
  });

  test.each([
    ['draft', false],
    ['sent', false],
    ['accepted', false],
  ])('status "%s" is never Archive (auto-archive only applies to completed)', (status) => {
    expect(isArchivedJob({ status, savedAt: STALE_SAVED_AT }, NOW)).toBe(false);
  });

  // Mark's 2026-06-21 feedback: expired sends are NOT archived —
  // they stay active for the late-authorisation case.
  test('sent + past expiry → NOT archived (Mark: late-authorisation)', () => {
    expect(isArchivedJob({ status: 'sent', expiresAt: PAST }, NOW)).toBe(false);
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
  // If two return true or all three return false for some shape, the
  // dashboard would either double-count or silently drop jobs.
  const savedAtValues = [FRESH_SAVED_AT, STALE_SAVED_AT, undefined];

  test('every known status × every savedAt shape lands in exactly one bucket', () => {
    for (const status of STATUSES) {
      for (const savedAt of savedAtValues) {
        const job = { status, savedAt };
        const active = isActiveJob(job, NOW);
        const completed = isCompletedJob(job, NOW);
        const archived = isArchivedJob(job, NOW);
        const trueCount = [active, completed, archived].filter(Boolean).length;
        expect(trueCount).toBe(1);
      }
    }
  });

  test('missing-status job (defaults to draft) is active, not completed or archived', () => {
    expect(isActiveJob({}, NOW)).toBe(true);
    expect(isCompletedJob({}, NOW)).toBe(false);
    expect(isArchivedJob({}, NOW)).toBe(false);
  });

  test('unknown status defaults to active bucket (safety default)', () => {
    const job = { status: 'invoiced', savedAt: FRESH_SAVED_AT };
    expect(isActiveJob(job, NOW)).toBe(true);
    expect(isCompletedJob(job, NOW)).toBe(false);
    expect(isArchivedJob(job, NOW)).toBe(false);
  });
});

describe('now defaults to current time', () => {
  test('isExpired uses current time when not provided', () => {
    expect(isExpired({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(true);
  });

  test('isActiveJob uses current time when not provided (sent past-expiry still active)', () => {
    expect(isActiveJob({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(true);
  });

  test('isArchivedJob uses current time when not provided (sent past-expiry NOT archived)', () => {
    expect(isArchivedJob({ status: 'sent', expiresAt: '2020-01-01T00:00:00Z' })).toBe(false);
  });

  test('isArchivedJob without explicit now: ancient completed → Archive', () => {
    // Any completed job saved in 2020 is comfortably beyond 30 days.
    expect(isArchivedJob({ status: 'completed', savedAt: '2020-01-01T00:00:00Z' })).toBe(true);
  });
});
