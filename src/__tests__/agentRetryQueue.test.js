import { jest, describe, test, expect } from '@jest/globals';
import {
  buildRetryEntry,
  calculateNextRetryAt,
  isRetryable,
} from '../../agents/retryQueue.js';

describe('buildRetryEntry', () => {
  test('creates correct defaults', () => {
    const entry = buildRetryEntry('feedback', { jobId: 'j1' }, 'timeout');
    expect(entry.agentType).toBe('feedback');
    expect(entry.payload).toEqual({ jobId: 'j1' });
    expect(entry.lastError).toBe('timeout');
    expect(entry.attempts).toBe(0);
    expect(entry.maxAttempts).toBe(3);
  });

  test('allows custom maxAttempts', () => {
    const entry = buildRetryEntry('calibration', {}, 'err', 5);
    expect(entry.maxAttempts).toBe(5);
  });
});

describe('calculateNextRetryAt', () => {
  test('uses exponential backoff: 2^attempts * 60s', () => {
    // attempts=0 → 60s, attempts=1 → 120s, attempts=2 → 240s
    const base = new Date('2026-01-01T00:00:00Z');
    const next0 = calculateNextRetryAt(0, base);
    expect(next0.getTime() - base.getTime()).toBe(60 * 1000);

    const next1 = calculateNextRetryAt(1, base);
    expect(next1.getTime() - base.getTime()).toBe(120 * 1000);

    const next2 = calculateNextRetryAt(2, base);
    expect(next2.getTime() - base.getTime()).toBe(240 * 1000);
  });

  test('defaults to now as base time', () => {
    const before = Date.now();
    const next = calculateNextRetryAt(0);
    const after = Date.now();
    // Should be ~60s from now
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 60 * 1000);
    expect(next.getTime()).toBeLessThanOrEqual(after + 60 * 1000);
  });
});

describe('isRetryable', () => {
  test('returns true when attempts < maxAttempts', () => {
    expect(isRetryable({ attempts: 0, maxAttempts: 3 })).toBe(true);
    expect(isRetryable({ attempts: 2, maxAttempts: 3 })).toBe(true);
  });

  test('returns false when attempts >= maxAttempts', () => {
    expect(isRetryable({ attempts: 3, maxAttempts: 3 })).toBe(false);
    expect(isRetryable({ attempts: 5, maxAttempts: 3 })).toBe(false);
  });
});
