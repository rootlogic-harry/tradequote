/**
 * portalFollowUp — "needs a nudge" classifier + relative labels +
 * WhatsApp phone normaliser.
 *
 * These helpers decide which quotes surface on Paul's dashboard as
 * "follow up these". Getting the criteria wrong has real cost: a
 * false positive shows a responded quote in the list (annoying, he
 * might double-contact a happy client); a false negative silently
 * drops a quote he'd have chased. So the rules are tested exhaustively.
 */
import {
  needsFollowUp,
  viewedDaysAgo,
  relativeViewedLabel,
  normaliseUkPhoneForWhatsApp,
  FOLLOW_UP_AFTER_DAYS,
} from '../utils/portalFollowUp.js';

const NOW = new Date('2026-04-22T12:00:00Z').getTime();
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();
const daysAhead = (d) => new Date(NOW + d * 24 * 60 * 60 * 1000).toISOString();

const baseJob = {
  clientToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clientTokenExpiresAt: daysAhead(14),
  clientViewedAt: daysAgo(3),
  clientResponse: null,
};

describe('needsFollowUp', () => {
  test('viewed 3 days ago, no response → true', () => {
    expect(needsFollowUp(baseJob, NOW)).toBe(true);
  });

  test('viewed today → false (give them space)', () => {
    expect(needsFollowUp({ ...baseJob, clientViewedAt: hoursAgo(2) }, NOW)).toBe(false);
  });

  test('viewed 1 day ago → false (still within patience window)', () => {
    expect(needsFollowUp({ ...baseJob, clientViewedAt: daysAgo(1) }, NOW)).toBe(false);
  });

  test('viewed exactly at threshold (2 days) → true', () => {
    expect(needsFollowUp({ ...baseJob, clientViewedAt: daysAgo(2) }, NOW)).toBe(true);
  });

  test('never viewed → false (different problem — email probably in spam)', () => {
    expect(needsFollowUp({ ...baseJob, clientViewedAt: null }, NOW)).toBe(false);
  });

  test('accepted → false (no nudge needed, we\'re go)', () => {
    expect(needsFollowUp({ ...baseJob, clientResponse: 'accepted' }, NOW)).toBe(false);
  });

  test('declined → false (quiet per Paul\'s brief — no nudging after a no)', () => {
    expect(needsFollowUp({ ...baseJob, clientResponse: 'declined' }, NOW)).toBe(false);
  });

  test('expired token → false (regenerate-link is the right action, not chase)', () => {
    expect(needsFollowUp({ ...baseJob, clientTokenExpiresAt: daysAgo(1) }, NOW)).toBe(false);
  });

  test('no token yet → false', () => {
    expect(needsFollowUp({ ...baseJob, clientToken: null }, NOW)).toBe(false);
  });

  test('null job is safe', () => {
    expect(needsFollowUp(null, NOW)).toBe(false);
    expect(needsFollowUp(undefined, NOW)).toBe(false);
  });

  test('threshold is tunable via third arg', () => {
    // Paul might want "nudge after 5 days" eventually. Constant is
    // exported, and the function accepts an override.
    expect(needsFollowUp(baseJob, NOW, 5)).toBe(false);
    expect(needsFollowUp(baseJob, NOW, 3)).toBe(true);
  });
});

describe('viewedDaysAgo', () => {
  test('returns whole days, rounded down', () => {
    expect(viewedDaysAgo({ clientViewedAt: hoursAgo(1) }, NOW)).toBe(0);
    expect(viewedDaysAgo({ clientViewedAt: hoursAgo(25) }, NOW)).toBe(1);
    expect(viewedDaysAgo({ clientViewedAt: daysAgo(3) }, NOW)).toBe(3);
  });

  test('returns null when never viewed', () => {
    expect(viewedDaysAgo({}, NOW)).toBeNull();
    expect(viewedDaysAgo(null, NOW)).toBeNull();
  });
});

describe('relativeViewedLabel', () => {
  test.each([
    [0, 'Viewed today'],
    [1, 'Viewed yesterday'],
    [2, 'Viewed 2 days ago'],
    [7, 'Viewed 7 days ago'],
    [30, 'Viewed 30 days ago'],
  ])('%d days ago → "%s"', (d, expected) => {
    expect(relativeViewedLabel({ clientViewedAt: daysAgo(d) }, NOW)).toBe(expected);
  });

  test('returns null for never-viewed jobs', () => {
    expect(relativeViewedLabel({}, NOW)).toBeNull();
  });
});

describe('normaliseUkPhoneForWhatsApp', () => {
  test.each([
    ['07554 040992',     '447554040992',  'UK domestic with space'],
    ['+44 7554 040992',  '447554040992',  '+44 international'],
    ['(07554) 040992',   '447554040992',  'parens'],
    ['07554-040992',     '447554040992',  'dashes'],
    ['+1 555 123 4567',  '15551234567',   'US number — kept as-is'],
  ])('"%s" → "%s" (%s)', (input, expected) => {
    expect(normaliseUkPhoneForWhatsApp(input)).toBe(expected);
  });

  test.each([
    null,
    undefined,
    '',
    'abc',
    '123',        // too short
  ])('rejects invalid input (%p)', (bad) => {
    expect(normaliseUkPhoneForWhatsApp(bad)).toBeNull();
  });
});

describe('FOLLOW_UP_AFTER_DAYS constant', () => {
  test('is 2 days (document the default so a change is a conscious decision)', () => {
    expect(FOLLOW_UP_AFTER_DAYS).toBe(2);
  });
});
