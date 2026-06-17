import { jest, describe, test, expect } from '@jest/globals';
import {
  buildRetryEntry,
  calculateNextRetryAt,
  isRetryable,
  reapOrphanedRuns,
  processRetryQueue,
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

describe('reapOrphanedRuns (TRQ-163)', () => {
  // The reaper is a single UPDATE statement. Tests verify the SQL
  // shape — what columns it touches, what predicate it uses, what
  // marker it writes. The actual DB-level behaviour is covered by
  // hand during the TRQ-140-style verification SQL; here we lock
  // down the contract so a future "small refactor" can't silently
  // change which rows get swept.

  function mockPool(updateRowCount = 0) {
    return {
      calls: [],
      async query(sql, params) {
        this.calls.push({ sql, params });
        return { rowCount: updateRowCount };
      },
    };
  }

  test('runs an UPDATE on agent_runs', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].sql).toMatch(/UPDATE agent_runs/);
  });

  test('only touches rows with status = \'running\'', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    expect(pool.calls[0].sql).toMatch(/WHERE status = 'running'/);
  });

  test('sets the row to status = \'failed\' (NEVER \'completed\')', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    // Orphaned runs failed silently — they're failures, not successes.
    // The wrong choice here would silently inflate the success rate.
    expect(pool.calls[0].sql).toMatch(/SET status = 'failed'/);
    expect(pool.calls[0].sql).not.toMatch(/SET status = 'completed'/);
  });

  test('appends the reaper marker to the error column (does not overwrite)', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    // COALESCE so a partial error from a try-block that DID fire is
    // preserved; the reaper just notes WHY this row was finalised.
    expect(pool.calls[0].sql).toMatch(/COALESCE\(error,\s*''\)\s*\|\|/);
    // The marker itself goes in via a $1 parameter.
    expect(pool.calls[0].params[0]).toMatch(/reaper/);
  });

  test('default threshold is 60 minutes', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    expect(pool.calls[0].params[1]).toBe('60');
    expect(pool.calls[0].params[0]).toMatch(/age > 60m/);
  });

  test('custom staleAfterMinutes propagates to SQL params + marker', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool, { staleAfterMinutes: 15 });
    expect(pool.calls[0].params[1]).toBe('15');
    expect(pool.calls[0].params[0]).toMatch(/age > 15m/);
  });

  test('custom marker overrides the default', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool, { marker: '[custom-test-marker]' });
    expect(pool.calls[0].params[0]).toBe(' [custom-test-marker]');
  });

  test('returns the rowCount the query reports (0 when nothing to reap)', async () => {
    const pool = mockPool(0);
    const n = await reapOrphanedRuns(pool);
    expect(n).toBe(0);
  });

  test('returns the rowCount the query reports (non-zero when something is reaped)', async () => {
    const pool = mockPool(5);
    const n = await reapOrphanedRuns(pool);
    expect(n).toBe(5);
  });

  test('age predicate uses NOW() so the test passes regardless of time', async () => {
    const pool = mockPool(0);
    await reapOrphanedRuns(pool);
    // The interval comparison is in the WHERE clause — we don't
    // pin "1 hour" because the value can be tuned via the option,
    // but we DO pin that we're using NOW() (server time) and a
    // dynamic interval.
    expect(pool.calls[0].sql).toMatch(/created_at < NOW\(\) - \(\$2 \|\| ' minutes'\)::interval/);
  });
});

describe('processRetryQueue invokes the reaper (TRQ-163)', () => {
  function mockPoolWithEmptyQueue() {
    return {
      calls: [],
      async query(sql, params) {
        this.calls.push({ sql, params });
        // For the SELECT, return no rows. For UPDATE, return rowCount 0.
        if (/^SELECT/i.test(sql.trim())) return { rows: [] };
        return { rowCount: 0 };
      },
    };
  }

  test('calls reapOrphanedRuns before the SELECT FROM agent_retry_queue', async () => {
    const pool = mockPoolWithEmptyQueue();
    await processRetryQueue(pool, {});
    expect(pool.calls.length).toBeGreaterThanOrEqual(2);
    // The first call should be the UPDATE on agent_runs (reaper).
    expect(pool.calls[0].sql).toMatch(/UPDATE agent_runs/);
    // The second call should be the SELECT from agent_retry_queue.
    expect(pool.calls[1].sql).toMatch(/SELECT \* FROM agent_retry_queue/);
  });

  test('reaper failure does NOT prevent retry processing', async () => {
    // If the reaper throws (e.g. transient DB hiccup), the existing
    // retry loop must still get a chance. Otherwise a failing reaper
    // takes the whole retry pipeline down with it.
    const pool = {
      calls: [],
      async query(sql, params) {
        this.calls.push({ sql, params });
        if (/UPDATE agent_runs/.test(sql)) {
          throw new Error('simulated reaper DB error');
        }
        if (/^SELECT/i.test(sql.trim())) return { rows: [] };
        return { rowCount: 0 };
      },
    };
    // Suppress the expected console.warn so the test output stays clean.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(processRetryQueue(pool, {})).resolves.not.toThrow();
      // Reaper attempt + retry SELECT both happened.
      expect(pool.calls.filter((c) => /UPDATE agent_runs/.test(c.sql))).toHaveLength(1);
      expect(pool.calls.filter((c) => /SELECT \* FROM agent_retry_queue/.test(c.sql))).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
