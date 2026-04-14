import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Mock runAgent before importing feedbackAgent
const mockRunAgent = jest.fn();
jest.unstable_mockModule('../../agents/agentUtils.js', () => ({
  runAgent: mockRunAgent,
}));

// Dynamic import after mock setup
const { runFeedbackAgent, FEEDBACK_SYSTEM_PROMPT } = await import('../../agents/feedbackAgent.js');

// Track all pool.query calls for assertion
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

describe('runFeedbackAgent', () => {
  const baseOpts = {
    userId: 'user1',
    jobId: 'job-abc',
    quoteSnapshot: {
      quotePayload: { totals: { total: 2500 } },
      reviewData: {
        materials: [{ description: 'Stone' }],
        labourEstimate: { estimatedDays: 3, numberOfWorkers: 1 },
        stoneType: 'gritstone',
      },
    },
    completionFeedback: 'under_quoted',
    completionNotes: 'Stone costs were higher than expected',
  };

  test('queries diffs for the job', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // diffs query
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    const diffQuery = pool._calls[0];
    expect(diffQuery.sql).toContain('quote_diffs');
    expect(diffQuery.sql).toContain('job_id');
    expect(diffQuery.params[0]).toBe('job-abc');
  });

  test('passes correct agent type and model to runAgent', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const call = mockRunAgent.mock.calls[0][0];
    expect(call.agentType).toBe('feedback');
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.userId).toBe('user1');
    expect(call.jobId).toBe('job-abc');
  });

  test('includes edited diffs in user content', async () => {
    const pool = mockPool([
      {
        rows: [
          { field_type: 'measurement', field_label: 'Wall height', ai_value: '1200', confirmed_value: '1400', was_edited: true, edit_magnitude: 0.167 },
          { field_type: 'measurement', field_label: 'Wall length', ai_value: '4500', confirmed_value: '4500', was_edited: false, edit_magnitude: 0 },
        ],
        rowCount: 2,
      },
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    const userContent = mockRunAgent.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('Wall height');
    expect(userContent).toContain('1200');
    expect(userContent).toContain('1400');
    expect(userContent).toContain('1 of 2'); // 1 edited of 2 total
  });

  test('includes input summary with feedback and quote total', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    const inputSummary = mockRunAgent.mock.calls[0][0].inputSummary;
    expect(inputSummary.feedback).toBe('under_quoted');
    expect(inputSummary.quoteTotal).toBe(2500);
  });

  test('creates calibration notes when feedback is NOT spot_on', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // diffs query
      { rows: [], rowCount: 1 }, // calibration note insert
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: {
        likelyIssues: [],
        overallAssessment: 'Stone was underpriced',
        severity: 'medium',
        suggestedCalibrations: [
          {
            fieldType: 'material_unit_cost',
            fieldLabel: 'Stone supply',
            note: 'Increase stone supply unit cost by 15%',
            evidence: { feedback: 'under_quoted', quoteTotal: 2500, editedFields: 1 },
          },
        ],
      },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    // Should have 2 queries: diffs + calibration note insert
    expect(pool._calls.length).toBe(2);
    const insertCall = pool._calls[1];
    expect(insertCall.sql).toContain('calibration_notes');
    expect(insertCall.params[0]).toBe('material_unit_cost');
    expect(insertCall.params[1]).toBe('Stone supply');
    expect(insertCall.params[2]).toBe('Increase stone supply unit cost by 15%');
    expect(insertCall.params[3]).toBe('run-1'); // proposed_by
  });

  test('does NOT create calibration notes when feedback is spot_on', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: {
        likelyIssues: [],
        overallAssessment: 'Quote was accurate',
        severity: 'low',
        suggestedCalibrations: [
          { fieldType: 'general', fieldLabel: 'General', note: 'Keep doing this', evidence: {} },
        ],
      },
    });

    await runFeedbackAgent({ pool, ...baseOpts, completionFeedback: 'spot_on' });

    // Only the diffs query — no calibration note insert
    expect(pool._calls.length).toBe(1);
    expect(pool._calls[0].sql).toContain('quote_diffs');
  });

  test('returns default lessons when output is null', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({ runId: 'run-1', output: null });

    const result = await runFeedbackAgent({ pool, ...baseOpts });

    expect(result.lessons.likelyIssues).toEqual([]);
    expect(result.lessons.overallAssessment).toBe('Could not analyse');
    expect(result.lessons.severity).toBe('low');
  });

  test('returns runId from result', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-feedback-42',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    const result = await runFeedbackAgent({ pool, ...baseOpts });
    expect(result.runId).toBe('run-feedback-42');
  });

  test('handles missing quoteSnapshot gracefully', async () => {
    const pool = mockPool([{ rows: [], rowCount: 0 }]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: { likelyIssues: [], overallAssessment: 'OK', severity: 'low', suggestedCalibrations: [] },
    });

    const result = await runFeedbackAgent({
      pool,
      userId: 'user1',
      jobId: 'job-abc',
      quoteSnapshot: null,
      completionFeedback: 'over_quoted',
    });

    expect(result.runId).toBe('run-1');
    const userContent = mockRunAgent.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('£0.00'); // totalAmount defaults to 0
  });

  test('defaults fieldType and fieldLabel when calibration omits them', async () => {
    const pool = mockPool([
      { rows: [], rowCount: 0 }, // diffs
      { rows: [], rowCount: 1 }, // insert
    ]);
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: {
        likelyIssues: [],
        overallAssessment: 'Issues found',
        severity: 'medium',
        suggestedCalibrations: [
          { note: 'Improve accuracy', evidence: {} },
        ],
      },
    });

    await runFeedbackAgent({ pool, ...baseOpts });

    const insertCall = pool._calls[1];
    expect(insertCall.params[0]).toBe('general'); // default fieldType
    expect(insertCall.params[1]).toBe('General'); // default fieldLabel
  });

  test('handles calibration note insert failure gracefully', async () => {
    let callIndex = 0;
    const pool = {
      query: async (sql, params) => {
        callIndex++;
        if (callIndex === 1) return { rows: [], rowCount: 0 }; // diffs
        throw new Error('DB insert failed');
      },
    };
    mockRunAgent.mockResolvedValue({
      runId: 'run-1',
      output: {
        likelyIssues: [],
        overallAssessment: 'Issues',
        severity: 'high',
        suggestedCalibrations: [
          { fieldType: 'labour_days', fieldLabel: 'Days', note: 'Adjust', evidence: {} },
        ],
      },
    });

    // Should not throw — logs warning instead
    const result = await runFeedbackAgent({ pool, ...baseOpts });
    expect(result.runId).toBe('run-1');
  });
});

describe('FEEDBACK_SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof FEEDBACK_SYSTEM_PROMPT).toBe('string');
    expect(FEEDBACK_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('mentions JSON return format', () => {
    expect(FEEDBACK_SYSTEM_PROMPT).toContain('JSON');
  });

  test('includes expected response schema fields', () => {
    expect(FEEDBACK_SYSTEM_PROMPT).toContain('likelyIssues');
    expect(FEEDBACK_SYSTEM_PROMPT).toContain('overallAssessment');
    expect(FEEDBACK_SYSTEM_PROMPT).toContain('severity');
    expect(FEEDBACK_SYSTEM_PROMPT).toContain('suggestedCalibrations');
  });
});
