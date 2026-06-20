/**
 * Regression-suite comparator.
 *
 * compareRun(actual, expected)  — one run vs ground truth → pass/fail + per-field
 * summariseRuns(runs, expected) — N runs vs ground truth → mean / std / pass count
 *
 * Pure functions. No I/O. Used by the runner CLI and unit-tested directly.
 *
 * Field-spec shape:
 *   { value: N, tolerance: 0.15 }       — within ±15% of N
 *   { value: N, abs: 0.5 }              — within ±0.5 of N (absolute)
 *   { value: N, tolerance: 0.15, abs: 0.5 } — absolute wins
 *   { description: 'string' }           — material substring match (any matching row)
 *   { description: 'string', forbidden: true } — must NOT appear
 */

// ────── numeric field ──────

function compareNumericField(fieldPath, expectedSpec, actualValue) {
  const exp = expectedSpec.value;
  if (typeof actualValue !== 'number' || !Number.isFinite(actualValue)) {
    return {
      field: fieldPath,
      pass: false,
      actual: actualValue,
      expected: exp,
      reason: 'missing or non-numeric in actual',
    };
  }
  const delta = actualValue - exp;
  const absDelta = Math.abs(delta);
  // Absolute tolerance wins when supplied — it's used precisely BECAUSE
  // fractional doesn't make sense for fields like labour days.
  const usingAbsolute = typeof expectedSpec.abs === 'number';
  const tolerance = usingAbsolute
    ? expectedSpec.abs
    : Math.abs(exp) * (expectedSpec.tolerance ?? 0.15);
  const pass = absDelta <= tolerance;
  const deltaPercent = exp !== 0 ? absDelta / Math.abs(exp) : null;
  return {
    field: fieldPath,
    pass,
    actual: actualValue,
    expected: exp,
    delta,
    deltaPercent,
    tolerance,
    toleranceMode: usingAbsolute ? 'absolute' : 'fractional',
  };
}

// ────── material composition ──────

// Token-ise a description: lowercase, split on any non-word character.
// "walling stone" → ['walling', 'stone']
// "Limestone dust 25kg" → ['limestone', 'dust', '25kg']
// "Walling-stone supply, 1 tonne" → ['walling', 'stone', 'supply', '1', 'tonne']
//
// Non-word characters (\W) act as boundaries — hyphens, slashes, commas,
// whitespace all split. This is intentionally aggressive: it stops the
// matcher from treating "limestone" and "stone" as the same word, which
// the previous substring matcher did.
function tokenise(s) {
  return String(s || '').toLowerCase().split(/\W+/).filter(Boolean);
}

// A material description "matches" a spec when every token of the spec
// appears as a standalone token in the description. Multi-word specs
// ("walling stone") require ALL of their tokens in the actual.
//
// Tradeoff vs the previous includes() match: tighter matching means
// future fixtures must write expected substrings more carefully (a
// fixture asking for "stone" will no longer match "limestone"). The
// upside is forbidden specs ("mortar", "scaffold") no longer fire on
// unrelated compounds like "mortarboard" or "scaffolding-grade timber"
// — false-forbidden-matches were the larger CI-noise risk because
// they fail the run for the wrong reason.
function descriptionMatchesSpec(actualDescription, specDescription) {
  const wantTokens = tokenise(specDescription);
  if (wantTokens.length === 0) return false;
  const haveTokens = new Set(tokenise(actualDescription));
  return wantTokens.every((t) => haveTokens.has(t));
}

function compareMaterialField(materialSpec, actualMaterials) {
  const found = (actualMaterials || []).some((m) =>
    descriptionMatchesSpec(m?.description, materialSpec.description)
  );
  if (materialSpec.forbidden) {
    return {
      field: `materials.${materialSpec.description}`,
      pass: !found,
      forbidden: true,
      reason: found ? 'forbidden material present in actual' : null,
    };
  }
  return {
    field: `materials.${materialSpec.description}`,
    pass: found,
    reason: found ? null : 'missing — not present in actual materials',
  };
}

// ────── per-run comparator ──────

export function compareRun(actual, expected) {
  const fields = [];

  // Top-level scalars (e.g. totalAmount)
  if (expected.totalAmount) {
    fields.push(compareNumericField('totalAmount', expected.totalAmount, actual?.totalAmount));
  }

  // Measurements — flat object of name → spec
  if (expected.measurements && typeof expected.measurements === 'object') {
    for (const [name, spec] of Object.entries(expected.measurements)) {
      fields.push(
        compareNumericField(
          `measurements.${name}`,
          spec,
          actual?.measurements?.[name]
        )
      );
    }
  }

  // Labour — object of sub-key → spec
  if (expected.labour && typeof expected.labour === 'object') {
    for (const [name, spec] of Object.entries(expected.labour)) {
      fields.push(
        compareNumericField(`labour.${name}`, spec, actual?.labour?.[name])
      );
    }
  }

  // Material composition
  if (Array.isArray(expected.materials)) {
    for (const spec of expected.materials) {
      fields.push(compareMaterialField(spec, actual?.materials));
    }
  }

  const pass = fields.every((f) => f.pass);
  return { pass, fields };
}

// ────── cross-run summariser ──────

function mean(xs) {
  if (xs.length === 0) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stdDev(xs, mu) {
  if (xs.length === 0) return null;
  const variance = xs.reduce((s, v) => s + (v - mu) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

// Extract the raw numeric value for a given field from a run object.
// Returns null if missing — caller filters those out before mean/std.
function extractNumeric(run, fieldPath) {
  const parts = fieldPath.split('.');
  let cur = run;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

export function summariseRuns(runs, expected) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { fields: [], totalRuns: 0, passRate: 0 };
  }

  const perRun = runs.map((r) => compareRun(r, expected));

  // Collect every field path the expected spec defines.
  const fieldPaths = [];
  if (expected.totalAmount) fieldPaths.push({ path: 'totalAmount', kind: 'numeric' });
  for (const name of Object.keys(expected.measurements || {})) {
    fieldPaths.push({ path: `measurements.${name}`, kind: 'numeric' });
  }
  for (const name of Object.keys(expected.labour || {})) {
    fieldPaths.push({ path: `labour.${name}`, kind: 'numeric' });
  }
  for (const spec of expected.materials || []) {
    fieldPaths.push({
      path: `materials.${spec.description}`,
      kind: 'material',
      forbidden: !!spec.forbidden,
    });
  }

  const fields = fieldPaths.map((f) => {
    if (f.kind === 'numeric') {
      const values = runs.map((r) => extractNumeric(r, f.path)).filter((v) => v != null);
      const mu = mean(values);
      const sd = mu != null ? stdDev(values, mu) : null;
      const passCount = perRun.reduce((n, p) => {
        const fr = p.fields.find((x) => x.field === f.path);
        return n + (fr && fr.pass ? 1 : 0);
      }, 0);
      return {
        field: f.path,
        kind: 'numeric',
        mean: mu,
        stdDev: sd,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        sampleSize: values.length,
        passCount,
        totalRuns: runs.length,
      };
    }
    // material composition — just pass count
    const passCount = perRun.reduce((n, p) => {
      const fr = p.fields.find((x) => x.field === f.path);
      return n + (fr && fr.pass ? 1 : 0);
    }, 0);
    return {
      field: f.path,
      kind: 'material',
      forbidden: f.forbidden,
      passCount,
      totalRuns: runs.length,
    };
  });

  const overallPasses = perRun.filter((p) => p.pass).length;
  return {
    totalRuns: runs.length,
    passRate: overallPasses / runs.length,
    fields,
    perRun,
  };
}
