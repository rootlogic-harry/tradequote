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

  // TRQ-79: when two walls are adjacent, the analysis was sometimes taking in
  // the wrong wall (e.g. measuring the intact neighbour instead of the
  // collapsed one, or combining both into a single measurement set). The
  // prompt needs explicit guidance on identifying the subject wall.
  test('instructs the analyser to pick the subject wall when multiple are visible (TRQ-79)', () => {
    // Look for the dedicated section header + key behavioural rules
    expect(SYSTEM_PROMPT).toMatch(/MULTIPLE WALLS|multiple walls/i);
    // Must defer to the user's briefNotes for disambiguation
    expect(SYSTEM_PROMPT).toMatch(/briefNotes/);
    // Must not combine measurements across walls
    expect(SYSTEM_PROMPT).toMatch(/do not combine|Do NOT combine/i);
  });
});
