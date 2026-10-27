import { isAppAccessAllowed, canCreateQuotes, MARK_USER_ID, PAUL_USER_ID, PAUL_ACCESS_UNTIL } from '../utils/appAccess.js';

describe('isAppAccessAllowed', () => {
  test('production allows Mark with no time limit', () => {
    expect(isAppAccessAllowed(MARK_USER_ID, 'production', new Date('2026-12-01T00:00:00Z'))).toBe(true);
  });

  test('production allows Paul only before Sunday 1 November 2026, 6pm UK', () => {
    const before = new Date('2026-11-01T17:59:00.000Z');
    const atExpiry = new Date(PAUL_ACCESS_UNTIL);
    expect(isAppAccessAllowed(PAUL_USER_ID, 'production', before)).toBe(true);
    expect(isAppAccessAllowed(PAUL_USER_ID, 'production', atExpiry)).toBe(false);
    expect(isAppAccessAllowed('paulclough', 'production', new Date('2026-11-02T00:00:00Z'))).toBe(false);
  });

  test('production refuses everyone else', () => {
    expect(isAppAccessAllowed('harry', 'production')).toBe(false);
    expect(isAppAccessAllowed('', 'production')).toBe(false);
    expect(isAppAccessAllowed(null, 'production')).toBe(false);
    expect(isAppAccessAllowed(undefined, 'production')).toBe(false);
  });

  test('non-production does not lock anyone out', () => {
    expect(isAppAccessAllowed('paulclough', 'test')).toBe(true);
    expect(isAppAccessAllowed('harry', 'development')).toBe(true);
  });
});

describe('canCreateQuotes', () => {
  test('Paul can sign in but cannot create quotes', () => {
    const during = new Date('2026-10-28T12:00:00Z');
    expect(isAppAccessAllowed(PAUL_USER_ID, 'production', during)).toBe(true);
    expect(canCreateQuotes(PAUL_USER_ID, 'production', during)).toBe(false);
  });

  test('Mark can create quotes', () => {
    expect(canCreateQuotes(MARK_USER_ID, 'production')).toBe(true);
  });

  test('non-production can create quotes', () => {
    expect(canCreateQuotes(PAUL_USER_ID, 'test')).toBe(true);
  });
});
