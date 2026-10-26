import { isAppAccessAllowed, MARK_USER_ID } from '../utils/appAccess.js';

describe('isAppAccessAllowed', () => {
  test('production allows only Mark', () => {
    expect(isAppAccessAllowed(MARK_USER_ID, 'production')).toBe(true);
    expect(isAppAccessAllowed('markdoyle', 'production')).toBe(true);
    expect(isAppAccessAllowed('paulclough', 'production')).toBe(false);
    expect(isAppAccessAllowed('harry', 'production')).toBe(false);
    expect(isAppAccessAllowed('', 'production')).toBe(false);
    expect(isAppAccessAllowed(null, 'production')).toBe(false);
    expect(isAppAccessAllowed(undefined, 'production')).toBe(false);
  });

  test('non-production does not lock anyone out', () => {
    expect(isAppAccessAllowed('paulclough', 'test')).toBe(true);
    expect(isAppAccessAllowed('paulclough', 'development')).toBe(true);
  });
});
