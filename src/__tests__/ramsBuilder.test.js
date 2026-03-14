import {
  calculateRiskRating,
  getRiskLevel,
  calculateRamsCompletion,
  generateRamsId,
} from '../utils/ramsBuilder.js';

describe('calculateRiskRating', () => {
  test('returns product of likelihood and consequence', () => {
    expect(calculateRiskRating(3, 4)).toBe(12);
  });

  test('returns 1 for minimum values', () => {
    expect(calculateRiskRating(1, 1)).toBe(1);
  });

  test('returns 25 for maximum values', () => {
    expect(calculateRiskRating(5, 5)).toBe(25);
  });

  test('returns 0 when likelihood is 0', () => {
    expect(calculateRiskRating(0, 3)).toBe(0);
  });

  test('returns 0 when consequence is 0', () => {
    expect(calculateRiskRating(4, 0)).toBe(0);
  });
});

describe('getRiskLevel', () => {
  test('returns Low for rating 1', () => {
    const result = getRiskLevel(1);
    expect(result.label).toBe('Low');
    expect(result.color).toBe('#4ade80');
  });

  test('returns Low for rating 6', () => {
    expect(getRiskLevel(6).label).toBe('Low');
  });

  test('returns Medium for rating 7', () => {
    expect(getRiskLevel(7).label).toBe('Medium');
    expect(getRiskLevel(7).color).toBe('#fbbf24');
  });

  test('returns Medium for rating 12', () => {
    expect(getRiskLevel(12).label).toBe('Medium');
  });

  test('returns High for rating 13', () => {
    expect(getRiskLevel(13).label).toBe('High');
    expect(getRiskLevel(13).color).toBe('#fb923c');
  });

  test('returns High for rating 19', () => {
    expect(getRiskLevel(19).label).toBe('High');
  });

  test('returns Extreme for rating 20', () => {
    expect(getRiskLevel(20).label).toBe('Extreme');
    expect(getRiskLevel(20).color).toBe('#f87171');
  });

  test('returns Extreme for rating 25', () => {
    expect(getRiskLevel(25).label).toBe('Extreme');
  });

  test('returns Low for rating 0', () => {
    expect(getRiskLevel(0).label).toBe('Low');
  });
});

describe('calculateRamsCompletion', () => {
  test('returns 0 for null rams', () => {
    expect(calculateRamsCompletion(null)).toBe(0);
  });

  test('returns 0 for empty rams object', () => {
    expect(calculateRamsCompletion({})).toBe(0);
  });

  test('returns partial completion for some fields filled', () => {
    const rams = {
      siteAddress: '123 Test St',
      company: 'Test Co',
      workTypes: ['plumbing'],
      riskAssessments: [{ id: '1' }],
    };
    const result = calculateRamsCompletion(rams);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  test('returns 100 for fully populated rams', () => {
    const rams = {
      siteAddress: '123 Test St',
      company: 'Test Co',
      client: 'Client A',
      foreman: 'John',
      commencementDate: '2026-04-01',
      projectedCompletionDate: '2026-05-01',
      workTypes: ['plumbing'],
      workStages: ['Stage 1'],
      riskAssessments: [{ id: '1' }],
      ppeRequirements: ['Hard Hat'],
      contactName: 'Jane',
      contactNumber: '07700 900000',
      workplaceAccess: 'Via main road',
      workplaceLighting: 'Adequate',
      wasteManagement: 'Skip on site',
    };
    expect(calculateRamsCompletion(rams)).toBe(100);
  });

  test('returns integer between 0 and 100', () => {
    const rams = {
      siteAddress: '123 Test St',
      workTypes: ['plumbing'],
    };
    const result = calculateRamsCompletion(rams);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

describe('generateRamsId', () => {
  test('returns a non-empty string', () => {
    const id = generateRamsId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns unique IDs on consecutive calls', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRamsId());
    }
    expect(ids.size).toBe(100);
  });

  test('starts with rams- prefix', () => {
    expect(generateRamsId()).toMatch(/^rams-/);
  });
});
