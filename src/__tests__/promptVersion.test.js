import { computePromptVersion, SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';

describe('computePromptVersion', () => {
  test('returns an 8-char hex string', () => {
    const version = computePromptVersion('test prompt', 'cal notes');
    expect(version).toMatch(/^[0-9a-f]{8}$/);
  });

  test('is deterministic — same inputs produce same output', () => {
    const v1 = computePromptVersion('prompt A', 'notes A');
    const v2 = computePromptVersion('prompt A', 'notes A');
    expect(v1).toBe(v2);
  });

  test('varies with different prompt input', () => {
    const v1 = computePromptVersion('prompt A', 'notes A');
    const v2 = computePromptVersion('prompt B', 'notes A');
    expect(v1).not.toBe(v2);
  });

  test('varies with different calibration notes', () => {
    const v1 = computePromptVersion('prompt A', 'notes A');
    const v2 = computePromptVersion('prompt A', 'notes B');
    expect(v1).not.toBe(v2);
  });

  test('handles empty calibration notes', () => {
    const version = computePromptVersion('prompt', '');
    expect(version).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('SYSTEM_PROMPT after hardcoded note removal', () => {
  test('does not contain KNOWN CALIBRATION NOTES section', () => {
    expect(SYSTEM_PROMPT).not.toContain('KNOWN CALIBRATION NOTES');
  });

  test('does not contain hardcoded traffic management note', () => {
    expect(SYSTEM_PROMPT).not.toContain('TRAFFIC MANAGEMENT — ROADSIDE JOBS');
  });
});
