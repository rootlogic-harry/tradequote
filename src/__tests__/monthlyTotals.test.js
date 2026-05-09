import { isThisMonth, isThisYear, buildMonthlyTotals } from '../utils/monthlyTotals.js';

const NOW = new Date('2026-05-09T12:00:00Z');

// Fixtures use mid-day UTC so they land in the intended calendar day
// across reasonable timezones (UK BST shifts UTC-midnight into the next day).
describe('isThisMonth', () => {
  test('true for a date in the same calendar month and year', () => {
    expect(isThisMonth('2026-05-01T12:00:00Z', NOW)).toBe(true);
    expect(isThisMonth('2026-05-31T12:00:00Z', NOW)).toBe(true);
  });

  test('false for the previous month', () => {
    expect(isThisMonth('2026-04-15T12:00:00Z', NOW)).toBe(false);
  });

  test('false for same month in a different year', () => {
    expect(isThisMonth('2025-05-15T12:00:00Z', NOW)).toBe(false);
  });

  test('false for null / undefined / empty', () => {
    expect(isThisMonth(null, NOW)).toBe(false);
    expect(isThisMonth(undefined, NOW)).toBe(false);
    expect(isThisMonth('', NOW)).toBe(false);
  });
});

describe('isThisYear', () => {
  test('true for any date in the same year', () => {
    expect(isThisYear('2026-01-15T12:00:00Z', NOW)).toBe(true);
    expect(isThisYear('2026-12-15T12:00:00Z', NOW)).toBe(true);
  });

  test('false for a date in the prior year', () => {
    expect(isThisYear('2025-12-15T12:00:00Z', NOW)).toBe(false);
    expect(isThisYear('2027-01-15T12:00:00Z', NOW)).toBe(false);
  });

  test('false for falsy input', () => {
    expect(isThisYear(null, NOW)).toBe(false);
  });
});

describe('buildMonthlyTotals', () => {
  test('returns 12 entries even when no jobs exist', () => {
    const result = buildMonthlyTotals([], NOW);
    expect(result).toHaveLength(12);
    expect(result.every(m => m.total === 0 && m.count === 0)).toBe(true);
    expect(result.map(m => m.label)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
  });

  test('sums totalAmount into the correct calendar month', () => {
    const jobs = [
      { savedAt: '2026-01-15T12:00:00Z', totalAmount: 1000 },
      { savedAt: '2026-01-20T12:00:00Z', totalAmount: 500 },
      { savedAt: '2026-05-01T12:00:00Z', totalAmount: 2000 },
    ];
    const result = buildMonthlyTotals(jobs, NOW);
    expect(result[0]).toMatchObject({ label: 'Jan', total: 1500, count: 2 });
    expect(result[4]).toMatchObject({ label: 'May', total: 2000, count: 1 });
    expect(result[1]).toMatchObject({ label: 'Feb', total: 0, count: 0 });
  });

  test('ignores jobs from a different year', () => {
    const jobs = [
      { savedAt: '2025-05-15T12:00:00Z', totalAmount: 9999 },
      { savedAt: '2026-05-15T12:00:00Z', totalAmount: 100 },
    ];
    const result = buildMonthlyTotals(jobs, NOW);
    expect(result[4]).toMatchObject({ total: 100, count: 1 });
  });

  test('treats missing totalAmount as zero (still increments count)', () => {
    const jobs = [
      { savedAt: '2026-03-10T12:00:00Z' },
      { savedAt: '2026-03-12T12:00:00Z', totalAmount: null },
    ];
    const result = buildMonthlyTotals(jobs, NOW);
    expect(result[2]).toMatchObject({ total: 0, count: 2 });
  });

  test('skips jobs with no savedAt', () => {
    const jobs = [{ totalAmount: 100 }, { savedAt: null, totalAmount: 50 }];
    const result = buildMonthlyTotals(jobs, NOW);
    expect(result.every(m => m.total === 0 && m.count === 0)).toBe(true);
  });
});
