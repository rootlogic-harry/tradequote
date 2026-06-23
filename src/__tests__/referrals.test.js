/**
 * Referrals Phase 1 (2026-06-23) — pure helpers.
 *
 * Covers the bits of the referrals feature that don't touch I/O:
 * code generation, code normalisation, and redemption-validity
 * decisions. The server-side glue (lazy code creation, redemption
 * endpoint, first-analysis reward trigger) is tested via the route
 * contract suite — these are the pure decisions underneath.
 */
import {
  generateReferralCode,
  normaliseReferralCode,
  validateRedemption,
  REFERRAL_REFEREE_BONUS,
  REFERRAL_REFERRER_REWARD,
} from '../utils/referrals.js';

describe('generateReferralCode', () => {
  const stubRand = () => 'X';

  test('produces <PREFIX>-XXXX shape from a name seed', () => {
    const code = generateReferralCode('Mark Doyle', stubRand);
    expect(code).toBe('MARKDO-XXXX');
  });

  test('strips non-alphanumerics and uppercases', () => {
    const code = generateReferralCode("Paul O'Connor", stubRand);
    expect(code).toBe('PAULOC-XXXX');
  });

  test('truncates long names to 6 chars', () => {
    const code = generateReferralCode('Bartholomew', stubRand);
    expect(code).toBe('BARTHO-XXXX');
  });

  test('falls back to USER when seed has no alphanumerics', () => {
    expect(generateReferralCode('!!!', stubRand)).toBe('USER-XXXX');
    expect(generateReferralCode('', stubRand)).toBe('USER-XXXX');
    expect(generateReferralCode(null, stubRand)).toBe('USER-XXXX');
    expect(generateReferralCode(undefined, stubRand)).toBe('USER-XXXX');
  });

  test('uses a safe alphabet (no 0/O, 1/I, L confusables) by default', () => {
    // Run a few generations — the suffix should never contain
    // confusable characters.
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode('Tester');
      const suffix = code.split('-')[1];
      expect(suffix).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
  });

  test('suffix is always exactly 4 chars', () => {
    for (let i = 0; i < 10; i++) {
      const code = generateReferralCode('Anyone');
      expect(code.split('-')[1].length).toBe(4);
    }
  });
});

describe('normaliseReferralCode', () => {
  test('uppercases and trims', () => {
    expect(normaliseReferralCode('  pauljuly  ')).toBe('PAULJULY');
    expect(normaliseReferralCode('mark-X9k1')).toBe('MARK-X9K1');
  });

  test('returns null for empty / whitespace input', () => {
    expect(normaliseReferralCode('')).toBeNull();
    expect(normaliseReferralCode('   ')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(normaliseReferralCode(null)).toBeNull();
    expect(normaliseReferralCode(undefined)).toBeNull();
    expect(normaliseReferralCode(123)).toBeNull();
    expect(normaliseReferralCode({})).toBeNull();
  });

  test('rejects malformed codes (special characters)', () => {
    expect(normaliseReferralCode('PAUL JULY')).toBeNull();   // space
    expect(normaliseReferralCode('PAUL@JULY')).toBeNull();   // at
    expect(normaliseReferralCode('PAUL_JULY')).toBeNull();   // underscore
    expect(normaliseReferralCode("'; DROP TABLE")).toBeNull();
  });

  test('rejects overlong codes (hard cap)', () => {
    const long = 'A'.repeat(65);
    expect(normaliseReferralCode(long)).toBeNull();
  });

  test('accepts codes at the cap length', () => {
    const max = 'A'.repeat(64);
    expect(normaliseReferralCode(max)).toBe(max);
  });
});

describe('validateRedemption', () => {
  test('valid — code belongs to a different user', () => {
    const codeRow = { code: 'PAULJULY', user_id: 'paulclough' };
    expect(validateRedemption({ codeRow, userId: 'newuser' })).toEqual({
      valid: true,
      referrerUserId: 'paulclough',
    });
  });

  test('unknown — code row not found (gracefully falls through)', () => {
    expect(validateRedemption({ codeRow: null, userId: 'newuser' })).toEqual({
      valid: false,
      reason: 'unknown',
    });
    expect(validateRedemption({ codeRow: undefined, userId: 'newuser' })).toEqual({
      valid: false,
      reason: 'unknown',
    });
  });

  test('self — code belongs to the redeeming user', () => {
    const codeRow = { code: 'PAULJULY', user_id: 'paulclough' };
    expect(validateRedemption({ codeRow, userId: 'paulclough' })).toEqual({
      valid: false,
      reason: 'self',
    });
  });
});

describe('referral bonus constants', () => {
  test('referee gets +2 at signup (locked spec)', () => {
    expect(REFERRAL_REFEREE_BONUS).toBe(2);
  });

  test('referrer gets +2 per successful referral (locked spec)', () => {
    expect(REFERRAL_REFERRER_REWARD).toBe(2);
  });
});
