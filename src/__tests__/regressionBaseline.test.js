/**
 * Baseline tracking for the regression suite.
 *
 * A baseline freezes "what passing looked like" for a fixture at a
 * specific prompt version. Subsequent runs load the baseline and the
 * report shows per-fixture and per-field "was X / now Y" deltas, so a
 * drop in pass rate or a mean shift is visible at a glance — not buried
 * in two markdown reports the reader has to diff by eye.
 *
 * Bless is explicit (`--bless`). A baseline change is a conscious
 * "we accept this as the new normal" decision, never silent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildBaselinePayload,
  computeDeltas,
  loadBaseline,
  writeBaseline,
} from '../../regression/lib/baseline.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fq-baseline-'));
}

describe('buildBaselinePayload', () => {
  test('serialises a fixture summary into the persisted baseline shape', () => {
    const summary = {
      totalRuns: 3,
      passRate: 1.0,
      fields: [
        {
          field: 'totalAmount',
          kind: 'numeric',
          mean: 4500,
          stdDev: 120,
          min: 4400,
          max: 4600,
          sampleSize: 3,
          passCount: 3,
          totalRuns: 3,
        },
        {
          field: 'materials.walling stone',
          kind: 'material',
          forbidden: false,
          passCount: 3,
          totalRuns: 3,
        },
      ],
    };
    const payload = buildBaselinePayload({
      fixtureId: 'sample',
      iterations: 3,
      promptVersion: 'abcd1234',
      summary,
    });
    expect(payload.fixtureId).toBe('sample');
    expect(payload.iterations).toBe(3);
    expect(payload.passRate).toBeCloseTo(1.0, 5);
    expect(payload.promptVersion).toBe('abcd1234');
    expect(payload.blessedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
    expect(payload.fieldStats['totalAmount']).toMatchObject({
      mean: 4500,
      stdDev: 120,
      passRate: 1.0,
    });
    expect(payload.fieldStats['materials.walling stone']).toMatchObject({
      passRate: 1.0,
    });
  });

  test('field passRate is computed from passCount / totalRuns', () => {
    const summary = {
      totalRuns: 4,
      passRate: 0.75,
      fields: [
        {
          field: 'totalAmount',
          kind: 'numeric',
          mean: 4500,
          stdDev: 200,
          passCount: 3,
          totalRuns: 4,
        },
      ],
    };
    const payload = buildBaselinePayload({
      fixtureId: 'x',
      iterations: 4,
      promptVersion: 'v1',
      summary,
    });
    expect(payload.fieldStats['totalAmount'].passRate).toBe(0.75);
  });
});

describe('writeBaseline + loadBaseline', () => {
  test('writes a fixture baseline to <dir>/<id>.json and reads it back', () => {
    const dir = tmpDir();
    const summary = {
      totalRuns: 3,
      passRate: 1,
      fields: [
        { field: 'totalAmount', kind: 'numeric', mean: 4500, stdDev: 50, passCount: 3, totalRuns: 3 },
      ],
    };
    const payload = buildBaselinePayload({
      fixtureId: 'kit-1',
      iterations: 3,
      promptVersion: 'aaaa1111',
      summary,
    });
    writeBaseline(dir, payload);
    const filePath = path.join(dir, 'kit-1.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const loaded = loadBaseline(dir, 'kit-1');
    expect(loaded).toEqual(payload);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writeBaseline creates the directory if missing', () => {
    const parent = tmpDir();
    const nestedDir = path.join(parent, 'baselines-nested');
    expect(fs.existsSync(nestedDir)).toBe(false);
    writeBaseline(nestedDir, buildBaselinePayload({
      fixtureId: 'kit-2',
      iterations: 1,
      promptVersion: 'v',
      summary: { totalRuns: 1, passRate: 1, fields: [] },
    }));
    expect(fs.existsSync(path.join(nestedDir, 'kit-2.json'))).toBe(true);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test('writeBaseline overwrites stale fields (re-bless is clean)', () => {
    const dir = tmpDir();
    const first = buildBaselinePayload({
      fixtureId: 'kit-3',
      iterations: 3,
      promptVersion: 'v1',
      summary: {
        totalRuns: 3,
        passRate: 1,
        fields: [
          { field: 'totalAmount', kind: 'numeric', mean: 4500, stdDev: 100, passCount: 3, totalRuns: 3 },
          { field: 'measurements.A', kind: 'numeric', mean: 100, stdDev: 5, passCount: 3, totalRuns: 3 },
        ],
      },
    });
    writeBaseline(dir, first);
    // Re-bless with a DIFFERENT field set; the old measurements.A must
    // not linger in the file.
    const second = buildBaselinePayload({
      fixtureId: 'kit-3',
      iterations: 5,
      promptVersion: 'v2',
      summary: {
        totalRuns: 5,
        passRate: 0.8,
        fields: [
          { field: 'totalAmount', kind: 'numeric', mean: 4600, stdDev: 80, passCount: 4, totalRuns: 5 },
        ],
      },
    });
    writeBaseline(dir, second);
    const loaded = loadBaseline(dir, 'kit-3');
    expect(loaded.promptVersion).toBe('v2');
    expect(loaded.iterations).toBe(5);
    expect(loaded.fieldStats['totalAmount'].mean).toBe(4600);
    expect(loaded.fieldStats['measurements.A']).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('loadBaseline returns null when no baseline exists (do not throw)', () => {
    const dir = tmpDir();
    const loaded = loadBaseline(dir, 'never-blessed');
    expect(loaded).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('computeDeltas', () => {
  test('returns null when no baseline (subsequent code skips delta display)', () => {
    const summary = { totalRuns: 3, passRate: 1, fields: [] };
    expect(computeDeltas(null, summary)).toBeNull();
  });

  test('returns overall + per-field deltas (was X / now Y)', () => {
    const baseline = {
      fixtureId: 'k',
      blessedAt: '2026-06-01T00:00:00Z',
      promptVersion: 'v1',
      iterations: 3,
      passRate: 1.0,
      fieldStats: {
        totalAmount: { mean: 4500, stdDev: 100, passRate: 1.0 },
        'materials.stone': { passRate: 1.0 },
      },
    };
    const summary = {
      totalRuns: 3,
      passRate: 0.667,
      fields: [
        { field: 'totalAmount', kind: 'numeric', mean: 4800, stdDev: 250, passCount: 2, totalRuns: 3 },
        { field: 'materials.stone', kind: 'material', passCount: 3, totalRuns: 3 },
      ],
    };
    const deltas = computeDeltas(baseline, summary);
    expect(deltas.overall).toEqual({ was: 1.0, now: 0.667 });
    expect(deltas.fields['totalAmount']).toMatchObject({
      wasMean: 4500,
      nowMean: 4800,
      wasPassRate: 1.0,
      nowPassRate: 2 / 3,
    });
    expect(deltas.fields['materials.stone']).toMatchObject({
      wasPassRate: 1.0,
      nowPassRate: 1.0,
    });
  });

  test('fields not in baseline are reported without "was" values (new fields)', () => {
    const baseline = {
      fixtureId: 'k',
      iterations: 3,
      passRate: 1.0,
      fieldStats: {
        totalAmount: { mean: 4500, stdDev: 0, passRate: 1.0 },
      },
    };
    const summary = {
      totalRuns: 3,
      passRate: 1.0,
      fields: [
        { field: 'totalAmount', kind: 'numeric', mean: 4500, stdDev: 0, passCount: 3, totalRuns: 3 },
        { field: 'measurements.NewField', kind: 'numeric', mean: 100, stdDev: 1, passCount: 3, totalRuns: 3 },
      ],
    };
    const deltas = computeDeltas(baseline, summary);
    expect(deltas.fields['measurements.NewField']).toMatchObject({
      wasMean: null,
      wasPassRate: null,
      nowMean: 100,
      nowPassRate: 1.0,
    });
  });

  test('exposes promptVersionMismatch when baseline prompt differs from current run', () => {
    // Item 6: the report shows a warning when the baseline was blessed
    // under a different prompt. Deltas are still computed but the
    // viewer is told they may not be directly comparable.
    const baseline = {
      fixtureId: 'k',
      iterations: 3,
      passRate: 1.0,
      promptVersion: 'aaaaaaaa',
      fieldStats: {},
    };
    const summary = { totalRuns: 3, passRate: 1.0, fields: [] };
    const deltasMismatch = computeDeltas(baseline, summary, { currentPromptVersion: 'bbbbbbbb' });
    expect(deltasMismatch.promptVersionMismatch).toEqual({
      baseline: 'aaaaaaaa',
      current: 'bbbbbbbb',
    });
    const deltasMatch = computeDeltas(baseline, summary, { currentPromptVersion: 'aaaaaaaa' });
    expect(deltasMatch.promptVersionMismatch).toBeNull();
  });
});
