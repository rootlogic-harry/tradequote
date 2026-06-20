/**
 * Baseline tracking for the regression suite.
 *
 * A baseline freezes "what passing looked like" for a fixture at a
 * specific prompt version. Subsequent runs load the baseline and surface
 * "was X / now Y" deltas in the markdown report — so a drop in pass rate
 * or a mean shift is visible at a glance, not buried in two reports the
 * reader has to diff by eye.
 *
 * Bless is explicit (`run.js --bless`). A baseline update is a conscious
 * "we accept this as the new normal" decision; nothing here ever rewrites
 * a baseline silently.
 *
 * File layout:
 *   regression/baselines/<fixture-id>.json
 *
 * On-disk shape (see buildBaselinePayload):
 *   {
 *     fixtureId, blessedAt, promptVersion, iterations, passRate,
 *     fieldStats: { "<field-path>": { mean, stdDev, passRate } }
 *   }
 *
 * Pure-ish: writeBaseline / loadBaseline do I/O; buildBaselinePayload
 * and computeDeltas are pure and unit-tested directly.
 */
import fs from 'node:fs';
import path from 'node:path';

// ────── pure builders ──────

export function buildBaselinePayload({ fixtureId, iterations, promptVersion, summary }) {
  const fieldStats = {};
  for (const f of summary?.fields || []) {
    const passRate = f.totalRuns ? f.passCount / f.totalRuns : 0;
    if (f.kind === 'numeric') {
      fieldStats[f.field] = {
        mean: f.mean ?? null,
        stdDev: f.stdDev ?? null,
        passRate,
      };
    } else {
      // material — no mean/stdDev, just pass rate
      fieldStats[f.field] = { passRate };
    }
  }
  return {
    fixtureId,
    blessedAt: new Date().toISOString(),
    promptVersion: promptVersion || null,
    iterations,
    passRate: summary?.passRate ?? 0,
    fieldStats,
  };
}

// `currentPromptVersion` is optional — when supplied the result
// includes a `promptVersionMismatch` block if the baseline's prompt
// version differs from the current run's. The reporter uses that to
// emit a "deltas may not be comparable" warning line.
export function computeDeltas(baseline, summary, opts = {}) {
  if (!baseline) return null;
  const fields = {};
  for (const f of summary?.fields || []) {
    const wasStat = baseline.fieldStats?.[f.field] || null;
    const nowPassRate = f.totalRuns ? f.passCount / f.totalRuns : 0;
    fields[f.field] = {
      wasMean: wasStat?.mean ?? null,
      wasStdDev: wasStat?.stdDev ?? null,
      wasPassRate: wasStat?.passRate ?? null,
      nowMean: f.kind === 'numeric' ? (f.mean ?? null) : null,
      nowStdDev: f.kind === 'numeric' ? (f.stdDev ?? null) : null,
      nowPassRate,
      kind: f.kind,
    };
  }
  const out = {
    overall: { was: baseline.passRate ?? 0, now: summary?.passRate ?? 0 },
    fields,
    promptVersionMismatch: null,
  };
  const current = opts.currentPromptVersion;
  if (
    current != null &&
    baseline.promptVersion != null &&
    baseline.promptVersion !== current
  ) {
    out.promptVersionMismatch = {
      baseline: baseline.promptVersion,
      current,
    };
  }
  return out;
}

// ────── disk I/O ──────

export function writeBaseline(dir, payload) {
  if (!payload?.fixtureId) {
    throw new Error('writeBaseline: payload.fixtureId is required');
  }
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${payload.fixtureId}.json`);
  // Overwrite cleanly — the file is replaced wholesale so stale fields
  // from a previous bless do not linger.
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

export function loadBaseline(dir, fixtureId) {
  const filePath = path.join(dir, `${fixtureId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // A corrupt baseline shouldn't crash the suite — treat as missing
    // and let the run continue (the report will show current values
    // without deltas).
    return null;
  }
}
