/**
 * Reporter sharpening:
 *   - Item 3: collapsible <details> block with raw model output for runs
 *     that contain ANY failed field. PII redacted before render.
 *   - Item 4: per-field pass-rate column alongside the existing pass-count.
 *   - Item 6: prompt-version stamp in the header. Warning line when the
 *     fixture's baseline was blessed under a different prompt.
 *   - Item 2: baseline deltas — overall "was/now" pass rate and per-field
 *     "was/now" lines.
 *
 * The reporter is pure: pass it a structured input, get a markdown string.
 * No I/O, no Date.now (caller supplies `generatedAt`).
 */
import { renderReport } from '../../regression/lib/reporter.js';
import { redactRaw } from '../../regression/lib/reporter.js';

function makeFixture(overrides = {}) {
  return {
    fixture: { id: 'kit', name: 'Kit fixture' },
    summary: {
      totalRuns: 3,
      passRate: 1,
      fields: [
        {
          field: 'totalAmount',
          kind: 'numeric',
          mean: 4500,
          stdDev: 100,
          min: 4400,
          max: 4600,
          passCount: 3,
          totalRuns: 3,
        },
      ],
      perRun: [
        { pass: true, fields: [{ field: 'totalAmount', pass: true }] },
        { pass: true, fields: [{ field: 'totalAmount', pass: true }] },
        { pass: true, fields: [{ field: 'totalAmount', pass: true }] },
      ],
    },
    ...overrides,
  };
}

function baseInput(reports) {
  return {
    generatedAt: '2026-06-20T10:00:00Z',
    baseUrl: 'http://localhost:3000',
    iterations: 3,
    fixtureReports: reports,
  };
}

describe('renderReport — per-field pass rate (item 4)', () => {
  test('includes a pass-rate column alongside the existing pass-count column', () => {
    const md = renderReport(baseInput([
      makeFixture({
        summary: {
          totalRuns: 4,
          passRate: 0.75,
          fields: [
            {
              field: 'totalAmount',
              kind: 'numeric',
              mean: 4500,
              stdDev: 200,
              min: 4200,
              max: 4900,
              passCount: 3,
              totalRuns: 4,
            },
          ],
          perRun: [],
        },
      }),
    ]));
    // Header must include the new column
    expect(md).toMatch(/Pass rate/);
    // The body row shows 3/4 AND 75% — both for the same field
    expect(md).toMatch(/3 \/ 4/);
    expect(md).toMatch(/75\.0%/);
  });

  test('mean + stdDev remain visible (existing contract)', () => {
    const md = renderReport(baseInput([
      makeFixture({
        summary: {
          totalRuns: 3,
          passRate: 1,
          fields: [
            {
              field: 'totalAmount',
              kind: 'numeric',
              mean: 4500,
              stdDev: 100,
              min: 4400,
              max: 4600,
              passCount: 3,
              totalRuns: 3,
            },
          ],
          perRun: [],
        },
      }),
    ]));
    expect(md).toMatch(/Mean/);
    expect(md).toMatch(/Std dev/);
    expect(md).toMatch(/4,500/);
    expect(md).toMatch(/100/);
  });
});

describe('renderReport — prompt version stamp (item 6)', () => {
  test('shows prompt version in the header when supplied', () => {
    const md = renderReport({
      ...baseInput([makeFixture()]),
      promptVersion: 'abcd1234',
    });
    expect(md).toMatch(/Prompt version\*?\*?:\s*`abcd1234`/);
  });

  test('omits the line when not supplied (back-compat)', () => {
    const md = renderReport(baseInput([makeFixture()]));
    expect(md).not.toMatch(/Prompt version/);
  });

  test('emits a warning line when a fixture\'s baseline used a different prompt', () => {
    const fixtureWithMismatch = makeFixture({
      deltas: {
        overall: { was: 1.0, now: 1.0 },
        fields: {},
        promptVersionMismatch: { baseline: 'aaaa1111', current: 'bbbb2222' },
      },
    });
    const md = renderReport({
      ...baseInput([fixtureWithMismatch]),
      promptVersion: 'bbbb2222',
    });
    expect(md).toMatch(/baseline was prompt/i);
    expect(md).toMatch(/aaaa1111/);
    expect(md).toMatch(/bbbb2222/);
    expect(md).toMatch(/deltas may not be comparable/i);
  });
});

describe('renderReport — baseline deltas (item 2)', () => {
  test('shows overall "was X / now Y" per fixture when deltas supplied', () => {
    const fixtureWithDeltas = makeFixture({
      summary: {
        totalRuns: 5,
        passRate: 0.8,
        fields: [
          {
            field: 'totalAmount',
            kind: 'numeric',
            mean: 4800,
            stdDev: 200,
            min: 4500,
            max: 5100,
            passCount: 4,
            totalRuns: 5,
          },
        ],
        perRun: [],
      },
      deltas: {
        overall: { was: 0.95, now: 0.8 },
        fields: {
          totalAmount: { wasMean: 4500, nowMean: 4800, wasPassRate: 1.0, nowPassRate: 0.8 },
        },
        promptVersionMismatch: null,
      },
    });
    const md = renderReport(baseInput([fixtureWithDeltas]));
    // Overall fixture-level delta
    expect(md).toMatch(/was 95\.0% \/ now 80\.0%/);
    // Per-field delta (mean) — existing reporter formats numerics with 1dp
    expect(md).toMatch(/4,500\.0 → 4,800\.0/);
    // Per-field delta (passRate)
    expect(md).toMatch(/100\.0% → 80\.0%/);
  });

  test('shows current values without delta when no baseline exists for that fixture', () => {
    const md = renderReport(baseInput([makeFixture({ deltas: null })]));
    // Mean and passRate present; no delta arrow or "was/now" text on the line
    expect(md).toMatch(/4,500/);
    expect(md).not.toMatch(/was \d+/);
  });
});

describe('renderReport — raw model output on failure (item 3)', () => {
  test('emits a collapsible <details> block for each failed iteration', () => {
    const fixtureWithFailures = {
      fixture: { id: 'kit', name: 'Kit' },
      summary: {
        totalRuns: 2,
        passRate: 0.5,
        fields: [
          {
            field: 'totalAmount',
            kind: 'numeric',
            mean: 3500,
            stdDev: 100,
            min: 3400,
            max: 3600,
            passCount: 1,
            totalRuns: 2,
          },
        ],
        perRun: [
          {
            pass: false,
            fields: [{ field: 'totalAmount', pass: false, actual: 3400, expected: 4500 }],
            raw: { totalAmount: 3400, measurements: [{ item: 'Wall height', valueMm: 1100 }] },
          },
          {
            pass: true,
            fields: [{ field: 'totalAmount', pass: true, actual: 4500, expected: 4500 }],
            raw: { totalAmount: 4500 },
          },
        ],
      },
    };
    const md = renderReport(baseInput([fixtureWithFailures]));
    expect(md).toMatch(/<details>/);
    expect(md).toMatch(/Raw model output/i);
    // Only the failed iteration's raw output appears (the passing one
    // is suppressed to keep the report compact).
    expect(md).toMatch(/"valueMm": 1100/);
    // The passing iteration's raw is NOT rendered
    expect(md.match(/<details>/g).length).toBe(1);
  });

  test('successful fixtures get no <details> blocks', () => {
    const md = renderReport(baseInput([makeFixture()]));
    expect(md).not.toMatch(/<details>/);
    expect(md).not.toMatch(/Raw model output/i);
  });

  test('omits <details> blocks entirely when no perRun is attached (back-compat)', () => {
    const fx = makeFixture({
      summary: {
        totalRuns: 3,
        passRate: 1,
        fields: [],
        // No perRun array — old call sites that didn't attach raw shouldn't crash
      },
    });
    expect(() => renderReport(baseInput([fx]))).not.toThrow();
    const md = renderReport(baseInput([fx]));
    expect(md).not.toMatch(/<details>/);
  });
});

describe('redactRaw — PII scrub before render (item 3)', () => {
  test('redacts email addresses and UK mobile phone patterns', () => {
    const raw = {
      notes: 'Contact mark@drystonewalling.net or 07986 661828 for site access',
      measurements: [{ item: 'Wall height', valueMm: 1200 }],
    };
    const json = redactRaw(raw);
    expect(json).not.toMatch(/mark@drystonewalling/);
    expect(json).not.toMatch(/07986 ?661828/);
    expect(json).toMatch(/\[redacted-email\]/);
    expect(json).toMatch(/\[redacted-phone\]/);
    // Numbers that look like phones but live inside numeric fields are safe
    // because they're not in the email/phone shape (the redactor operates
    // on the JSON-stringified text, and 1200 doesn't match the UK mobile
    // pattern).
    expect(json).toMatch(/1200/);
  });

  test('handles raw values that are not plain objects', () => {
    expect(() => redactRaw(null)).not.toThrow();
    expect(() => redactRaw(undefined)).not.toThrow();
    expect(redactRaw('plain text mark@x.com')).toMatch(/\[redacted-email\]/);
  });
});
