import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock runAgent before importing calibrationAgent
const mockRunAgent = jest.fn();
jest.unstable_mockModule('../../agents/agentUtils.js', () => ({
  runAgent: mockRunAgent,
}));

const { runCalibrationAgent, CALIBRATION_SYSTEM_PROMPT } = await import('../../agents/calibrationAgent.js');

function mockPool(queryResponses = []) {
  const calls = [];
  let callIndex = 0;
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      const response = queryResponses[callIndex] || { rows: [], rowCount: 0 };
      callIndex++;
      return response;
    },
    _calls: calls,
  };
}

beforeEach(() => {
  mockRunAgent.mockReset();
});

describe('runCalibrationAgent', () => {
  test('queries field bias, feedback runs, and approved notes', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // field bias
      { rows: [], rowCount: 0 }, // feedback runs
      { rows: [], rowCount: 0 }, // approved notes
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'No data' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    expect(pool._calls.length).toBeGreaterThanOrEqual(3);
    expect(pool._calls[0].sql).toContain('quote_diffs');
    expect(pool._calls[0].sql).toContain('edit_magnitude');
    expect(pool._calls[1].sql).toContain('agent_runs');
    expect(pool._calls[1].sql).toContain("agent_type = 'feedback'");
    expect(pool._calls[2].sql).toContain('calibration_notes');
    expect(pool._calls[2].sql).toContain("status = 'approved'");
  });

  test('passes correct agent type and model to runAgent', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'Nothing to propose' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const call = mockRunAgent.mock.calls[0][0];
    expect(call.agentType).toBe('calibration');
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.userId).toBe('admin1');
    expect(call.jobId).toBeNull();
  });

  test('includes field bias data in user content when available', async () => {
    const pool = mockPool([
      {
        rows: [
          { field_type: 'measurement', field_label: 'Wall height', total: '12', edit_rate_pct: '58.3', avg_bias_pct: '15.2', avg_error_pct: '15.2' },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'OK' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    const userContent = mockRunAgent.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('Wall height');
    expect(userContent).toContain('58.3%');
    expect(userContent).toContain('sample size 12');
  });

  test('includes feedback lessons in user content', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      {
        rows: [
          { output_summary: { overallAssessment: 'Stone was underpriced', severity: 'high' }, created_at: '2026-04-01' },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'OK' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    const userContent = mockRunAgent.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('Stone was underpriced');
    expect(userContent).toContain('severity: high');
  });

  test('includes approved notes in user content to avoid re-proposing', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      {
        rows: [
          { field_type: 'labour_days', field_label: 'Estimated Days', note: 'Add 20% buffer for gritstone jobs' },
        ],
        rowCount: 1,
      },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'OK' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    const userContent = mockRunAgent.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('Add 20% buffer for gritstone jobs');
    expect(userContent).toContain('Do NOT re-propose');
  });

  test('includes input summary with counts', async () => {
    const pool = mockPool([
      { rows: [{ a: 1 }, { a: 2 }], rowCount: 2 }, // 2 fields above threshold
      { rows: [{ a: 1 }], rowCount: 1 }, // 1 feedback lesson
      { rows: [{ a: 1 }, { a: 2 }, { a: 3 }], rowCount: 3 }, // 3 approved notes
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'OK' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    const inputSummary = mockRunAgent.mock.calls[0][0].inputSummary;
    expect(inputSummary.fieldsAboveThreshold).toBe(2);
    expect(inputSummary.feedbackLessonsCount).toBe(1);
    expect(inputSummary.approvedNotesCount).toBe(3);
  });

  test('inserts proposed calibration notes into database', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // field bias
      { rows: [], rowCount: 0 }, // feedback runs
      { rows: [], rowCount: 0 }, // approved notes
      { rows: [], rowCount: 1 }, // insert 1
      { rows: [], rowCount: 1 }, // insert 2
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: {
        proposed: [
          { fieldType: 'measurement', fieldLabel: 'Wall height', note: 'Add 10% to wall height estimates', evidence: { sampleSize: 12, avgBias: 15.2, editRate: 58.3, direction: 'under' } },
          { fieldType: 'labour_days', fieldLabel: 'Estimated Days', note: 'Increase by 1 day for gritstone', evidence: { sampleSize: 8, avgBias: 20, editRate: 62.5, direction: 'under' } },
        ],
        summary: 'Two adjustments recommended',
      },
    });

    const result = await runCalibrationAgent({ pool, userId: 'admin1' });

    // 3 initial queries + 2 inserts
    expect(pool._calls.length).toBe(5);

    const insert1 = pool._calls[3];
    expect(insert1.sql).toContain('INSERT INTO calibration_notes');
    expect(insert1.params[0]).toBe('measurement');
    expect(insert1.params[1]).toBe('Wall height');
    expect(insert1.params[2]).toBe('Add 10% to wall height estimates');
    expect(insert1.params[3]).toBe('run-cal-1');
    expect(JSON.parse(insert1.params[4])).toEqual({ sampleSize: 12, avgBias: 15.2, editRate: 58.3, direction: 'under' });

    const insert2 = pool._calls[4];
    expect(insert2.params[0]).toBe('labour_days');

    expect(result.proposals.summary).toBe('Two adjustments recommended');
  });

  test('returns default proposals when output is null', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockRunAgent.mockResolvedValue({ runId: 'run-cal-1', output: null });

    const result = await runCalibrationAgent({ pool, userId: 'admin1' });

    expect(result.proposals.proposed).toEqual([]);
    expect(result.proposals.summary).toBe('Calibration analysis could not be parsed');
  });

  test('does not insert notes when proposed array is empty', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: { proposed: [], summary: 'No adjustments needed' },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    // Only the 3 initial queries — no inserts
    expect(pool._calls.length).toBe(3);
  });

  test('defaults fieldType and fieldLabel when proposal omits them', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 1 },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: {
        proposed: [{ note: 'General improvement note' }],
        summary: 'Minor tweak',
      },
    });

    await runCalibrationAgent({ pool, userId: 'admin1' });

    const insertCall = pool._calls[3];
    expect(insertCall.params[0]).toBe('general');
    expect(insertCall.params[1]).toBe('General');
  });

  test('handles note insert failure gracefully', async () => {
    let callIndex = 0;
    const pool = {
      query: async (sql) => {
        callIndex++;
        if (callIndex <= 3) return { rows: [], rowCount: 0 };
        throw new Error('DB write failed');
      },
      _calls: [],
    };
    mockRunAgent.mockResolvedValue({
      runId: 'run-cal-1',
      output: {
        proposed: [{ fieldType: 'general', fieldLabel: 'General', note: 'Test', evidence: {} }],
        summary: 'Test',
      },
    });

    // Should not throw
    const result = await runCalibrationAgent({ pool, userId: 'admin1' });
    expect(result.runId).toBe('run-cal-1');
  });
});

describe('CALIBRATION_SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof CALIBRATION_SYSTEM_PROMPT).toBe('string');
    expect(CALIBRATION_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('mentions JSON return format', () => {
    expect(CALIBRATION_SYSTEM_PROMPT).toContain('JSON');
  });

  test('includes expected response schema fields', () => {
    expect(CALIBRATION_SYSTEM_PROMPT).toContain('proposed');
    expect(CALIBRATION_SYSTEM_PROMPT).toContain('fieldType');
    expect(CALIBRATION_SYSTEM_PROMPT).toContain('summary');
    expect(CALIBRATION_SYSTEM_PROMPT).toContain('evidence');
  });
});
