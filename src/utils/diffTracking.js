export const NUMERIC_FIELD_TYPES = new Set([
  'measurement',
  'material_quantity',
  'material_unit_cost',
  'labour_days',
  'labour_workers',
]);

export function isNumericFieldType(fieldType) {
  return NUMERIC_FIELD_TYPES.has(fieldType);
}

export function calculateEditMagnitude(aiValue, confirmedValue) {
  const ai = parseFloat(aiValue);
  const confirmed = parseFloat(confirmedValue);
  if (isNaN(ai) || isNaN(confirmed)) return null;
  if (ai === 0) return null;
  return (confirmed - ai) / ai;
}

export function buildDiff(fieldType, fieldLabel, aiValue, confirmedValue) {
  const wasEdited = aiValue !== confirmedValue;
  const isNumeric = isNumericFieldType(fieldType);
  const editMagnitude = isNumeric ? calculateEditMagnitude(aiValue, confirmedValue) : null;

  return {
    fieldType,
    fieldLabel,
    aiValue,
    confirmedValue,
    wasEdited,
    editMagnitude: isNumeric && editMagnitude === null ? 0 : editMagnitude,
    createdAt: Date.now(),
  };
}

export function calculateAIAccuracyScore(diffs) {
  const numericDiffs = diffs.filter(d => isNumericFieldType(d.fieldType));
  if (numericDiffs.length === 0) return null;
  const accepted = numericDiffs.filter(d => !d.wasEdited).length;
  return Math.round((accepted / numericDiffs.length) * 1000) / 1000;
}

export function shouldExcludeUser(accuracyScores, threshold = 0.4) {
  if (accuracyScores.length < 3) return false;
  const avg = accuracyScores.reduce((s, v) => s + v, 0) / accuracyScores.length;
  return avg < threshold;
}

export function enrichDiffWithContext(diff, context) {
  return { ...diff, ...context };
}
