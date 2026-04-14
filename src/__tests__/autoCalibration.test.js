import { shouldAutoCalibrate } from '../../autoCalibration.js';

describe('shouldAutoCalibrate', () => {
  test('returns true when completed count meets threshold', () => {
    expect(shouldAutoCalibrate(5, 5)).toBe(true);
  });

  test('returns false when completed count is below threshold', () => {
    expect(shouldAutoCalibrate(4, 5)).toBe(false);
  });

  test('returns true when completed count exceeds threshold', () => {
    expect(shouldAutoCalibrate(10, 5)).toBe(true);
  });

  test('default threshold is 5', () => {
    expect(shouldAutoCalibrate(5)).toBe(true);
    expect(shouldAutoCalibrate(4)).toBe(false);
  });

  test('returns false for zero completions', () => {
    expect(shouldAutoCalibrate(0)).toBe(false);
  });
});
