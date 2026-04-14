import { createAgentRun, completeAgentRun, failAgentRun } from '../../agents/agentUtils.js';

// Mock pool factory — returns a mock pg Pool with configurable query results
function mockPool(queryResults = {}) {
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      // Return configured result or default
      if (queryResults.returning) return queryResults.returning;
      return { rows: [{ id: 'run-abc123' }], rowCount: 1 };
    },
    _calls: calls,
  };
}

describe('createAgentRun', () => {
  test('inserts a running agent_run and returns the id', async () => {
    const pool = mockPool({ returning: { rows: [{ id: 'run-xyz' }] } });
    const id = await createAgentRun(pool, {
      userId: 'user1',
      jobId: 'job1',
      agentType: 'self_critique',
      inputSummary: { materialsCount: 3 },
    });
    expect(id).toBe('run-xyz');
    expect(pool._calls).toHaveLength(1);
    const call = pool._calls[0];
    expect(call.sql).toContain('INSERT INTO agent_runs');
    expect(call.sql).toContain("'running'");
    expect(call.params[0]).toBe('user1');
    expect(call.params[1]).toBe('job1');
    expect(call.params[2]).toBe('self_critique');
    expect(JSON.parse(call.params[3])).toEqual({ materialsCount: 3 });
  });

  test('handles null userId and jobId', async () => {
    const pool = mockPool();
    await createAgentRun(pool, { agentType: 'calibration' });
    const call = pool._calls[0];
    expect(call.params[0]).toBeNull();
    expect(call.params[1]).toBeNull();
    expect(call.params[2]).toBe('calibration');
  });

  test('handles null inputSummary', async () => {
    const pool = mockPool();
    await createAgentRun(pool, { userId: 'u1', agentType: 'feedback', inputSummary: null });
    const call = pool._calls[0];
    expect(call.params[3]).toBeNull();
  });

  test('serializes inputSummary to JSON', async () => {
    const pool = mockPool();
    const summary = { feedback: 'under_quoted', quoteTotal: 2500.50 };
    await createAgentRun(pool, { userId: 'u1', agentType: 'feedback', inputSummary: summary });
    const call = pool._calls[0];
    expect(JSON.parse(call.params[3])).toEqual(summary);
  });
});

describe('completeAgentRun', () => {
  test('updates agent_run with completed status and output', async () => {
    const pool = mockPool();
    await completeAgentRun(pool, 'run-1', {
      output: { corrections: [], notes: 'All good', confidence: 1.0 },
      model: 'claude-haiku-4-5-20251001',
      promptTokens: 1500,
      completionTokens: 300,
      durationMs: 2500,
    });
    expect(pool._calls).toHaveLength(1);
    const call = pool._calls[0];
    expect(call.sql).toContain("status = 'completed'");
    expect(call.sql).toContain('output_summary');
    expect(JSON.parse(call.params[0])).toEqual({ corrections: [], notes: 'All good', confidence: 1.0 });
    expect(call.params[1]).toBe('claude-haiku-4-5-20251001');
    expect(call.params[2]).toBe(1500);
    expect(call.params[3]).toBe(300);
    expect(call.params[4]).toBe(2500);
    expect(call.params[5]).toBe('run-1');
  });

  test('handles null output', async () => {
    const pool = mockPool();
    await completeAgentRun(pool, 'run-2', { output: null, model: null });
    const call = pool._calls[0];
    expect(call.params[0]).toBeNull();
    expect(call.params[1]).toBeNull();
  });

  test('handles null optional fields', async () => {
    const pool = mockPool();
    await completeAgentRun(pool, 'run-3', {});
    const call = pool._calls[0];
    expect(call.params[0]).toBeNull(); // output
    expect(call.params[1]).toBeNull(); // model
    expect(call.params[2]).toBeNull(); // promptTokens
    expect(call.params[3]).toBeNull(); // completionTokens
    expect(call.params[4]).toBeNull(); // durationMs
  });
});

describe('failAgentRun', () => {
  test('updates agent_run with failed status and error', async () => {
    const pool = mockPool();
    await failAgentRun(pool, 'run-4', 'API timeout', 5000);
    expect(pool._calls).toHaveLength(1);
    const call = pool._calls[0];
    expect(call.sql).toContain("status = 'failed'");
    expect(call.params[0]).toBe('API timeout');
    expect(call.params[1]).toBe(5000);
    expect(call.params[2]).toBe('run-4');
  });

  test('handles null durationMs', async () => {
    const pool = mockPool();
    await failAgentRun(pool, 'run-5', 'Network error');
    const call = pool._calls[0];
    expect(call.params[1]).toBeNull();
  });

  test('handles empty error message', async () => {
    const pool = mockPool();
    await failAgentRun(pool, 'run-6', '', 100);
    const call = pool._calls[0];
    expect(call.params[0]).toBe('');
  });
});
