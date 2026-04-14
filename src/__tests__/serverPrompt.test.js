import { SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';

describe('Server-side SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('contains measurement instructions', () => {
    expect(SYSTEM_PROMPT).toContain('MEASUREMENT INSTRUCTIONS');
  });

  test('contains domain knowledge section', () => {
    expect(SYSTEM_PROMPT).toContain('DOMAIN KNOWLEDGE');
  });

  test('contains JSON schema', () => {
    expect(SYSTEM_PROMPT).toContain('"referenceCardDetected"');
    expect(SYSTEM_PROMPT).toContain('"measurements"');
    expect(SYSTEM_PROMPT).toContain('"labourEstimate"');
  });

  test('contains materials vs labour distinction', () => {
    expect(SYSTEM_PROMPT).toContain('MATERIALS vs LABOUR DISTINCTION');
  });
});
