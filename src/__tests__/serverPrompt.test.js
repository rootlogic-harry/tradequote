import { SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';

describe('Server-side SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('contains measurement methodology', () => {
    expect(SYSTEM_PROMPT).toContain('MEASUREMENT METHODOLOGY');
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

  // TRQ-122: "rubble" reads as disparaging in client-facing quote output
  // ("Replacement sandstone rubble"). Removed from example + specification
  // lines that Claude imitates; replaced with "walling stone".
  test('no "rubble" in material example lines (TRQ-122)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/matched rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/sandstone rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/gritstone rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/rubble course/i);
  });

  test('explicitly tells Claude to prefer "walling stone" over "rubble" (TRQ-122)', () => {
    // A CLIENT-FACING LANGUAGE section names the substitution so Claude
    // doesn't regress from its training-data default of "rubble".
    expect(SYSTEM_PROMPT).toMatch(/CLIENT-FACING LANGUAGE/i);
    expect(SYSTEM_PROMPT).toMatch(/walling stone/i);
  });

  // Measurement accuracy v2: methodology rigor. The prompt drives Claude
  // through an explicit 5-step scale/measure/check loop, recognises Tier A/B/C
  // scale anchors, and respects the new USER-PROVIDED SCALE REFERENCES channel
  // that the UI now sends as part of the text payload.
  describe('measurement methodology rigor', () => {
    test('prompt defines a stepwise measurement methodology', () => {
      expect(SYSTEM_PROMPT).toContain('MEASUREMENT METHODOLOGY');
      expect(SYSTEM_PROMPT).toMatch(/Step 1/);
      expect(SYSTEM_PROMPT).toMatch(/Step 2/);
      expect(SYSTEM_PROMPT).toMatch(/Step 3/);
      expect(SYSTEM_PROMPT).toMatch(/Step 4/);
      expect(SYSTEM_PROMPT).toMatch(/Step 5/);
    });

    test('prompt ranks scale anchors in TIER A / B / C', () => {
      expect(SYSTEM_PROMPT).toMatch(/TIER A/);
      expect(SYSTEM_PROMPT).toMatch(/TIER B/);
      expect(SYSTEM_PROMPT).toMatch(/TIER C/);
    });

    test('prompt teaches Claude to consume USER-PROVIDED SCALE REFERENCES', () => {
      expect(SYSTEM_PROMPT).toMatch(/USER-PROVIDED SCALE REFERENCES/);
    });

    test('prompt names plausibility bounds for typical wall dimensions', () => {
      expect(SYSTEM_PROMPT).toMatch(/Wall height/);
      expect(SYSTEM_PROMPT).toMatch(/Wall thickness/);
      expect(SYSTEM_PROMPT).toMatch(/Breach/);
    });

    test('prompt requires a measurementReasoning field for admin QA', () => {
      expect(SYSTEM_PROMPT).toMatch(/measurementReasoning/);
    });

    test('prompt enforces low confidence when no anchor is available', () => {
      expect(SYSTEM_PROMPT).toMatch(/referenceCardDetected is false AND no USER-PROVIDED SCALE REFERENCES/);
      expect(SYSTEM_PROMPT).toMatch(/set confidence: "low"/);
    });
  });
});
