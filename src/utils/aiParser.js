import { VALID_STONE_TYPES, VALID_CONFIDENCE_LEVELS } from '../constants.js';

export function parseAIResponse(raw) {
  if (raw == null || raw === '') return null;

  let text = raw;

  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Find first { to last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export function validateAIResponse(parsed) {
  const errors = [];

  if (parsed == null || typeof parsed !== 'object') {
    return { valid: false, errors: ['Input is null or not an object'] };
  }

  if (typeof parsed.referenceCardDetected !== 'boolean') {
    errors.push('Missing or invalid referenceCardDetected (must be boolean)');
  }

  if (!parsed.stoneType) {
    errors.push('Missing stoneType');
  } else if (!VALID_STONE_TYPES.includes(parsed.stoneType)) {
    errors.push(`Invalid stoneType: "${parsed.stoneType}". Must be one of: ${VALID_STONE_TYPES.join(', ')}`);
  }

  if (!parsed.damageDescription) {
    errors.push('Missing damageDescription');
  }

  if (!Array.isArray(parsed.measurements)) {
    errors.push('Missing measurements array');
  } else if (parsed.measurements.length === 0) {
    errors.push('measurements array must not be empty');
  } else {
    parsed.measurements.forEach((m, i) => {
      if (m.confidence && !VALID_CONFIDENCE_LEVELS.includes(m.confidence)) {
        errors.push(`Invalid confidence "${m.confidence}" on measurement ${i}`);
      }
    });
  }

  if (!Array.isArray(parsed.scheduleOfWorks)) {
    errors.push('Missing scheduleOfWorks array');
  } else if (parsed.scheduleOfWorks.length === 0) {
    errors.push('scheduleOfWorks array must not be empty');
  }

  if (!Array.isArray(parsed.materials)) {
    errors.push('Missing materials array');
  }

  if (!parsed.labourEstimate) {
    errors.push('Missing labourEstimate');
  } else {
    const days = parsed.labourEstimate.estimatedDays;
    if (days == null || days <= 0) {
      errors.push('estimatedDays must be a positive number');
    }
  }

  return { valid: errors.length === 0, errors };
}

// Plausibility bounds for dry stone walling measurements, in millimetres.
// Values outside these bounds are almost always AI misreads (e.g. interpreting
// a 1200mm wall as 12000mm, or a perspective-foreshortened distance as huge).
// We don't *reject* outliers — walls genuinely vary — but we force confidence
// to "low" so the tradesman is prompted to verify on site.
const MEASUREMENT_MIN_MM = 10;       // below this is implausible (near-zero)
const MEASUREMENT_MAX_MM = 100000;   // 100m — any site measurement beyond this is almost certainly wrong

/**
 * Applies a confidence floor to measurements based on available scale anchors
 * and plausibility bounds. Pure function — returns a new object.
 *
 * Why this exists: Claude sets per-measurement confidence itself but tends to
 * over-mark "medium" when it should be "low". Three inputs drive the floor:
 *  1. referenceCardDetected — authoritative scale if true.
 *  2. scaleReferences — user-supplied scale anchors in briefNotes-like text
 *     ("the gate is 1.2m wide"). A non-empty string is treated as a valid anchor.
 *  3. valueMm — if outside [MIN, MAX], always force low (Claude has misread).
 *
 * @param {object} parsed - the normalized AI response
 * @param {object} context - { scaleReferences?: string }
 * @returns {object} a new parsed object with confidence potentially lowered
 */
export function applyMeasurementPlausibilityBounds(parsed, context = {}) {
  if (!parsed || !Array.isArray(parsed.measurements)) {
    return parsed;
  }

  const refCard = parsed.referenceCardDetected === true;
  const userScale = typeof context.scaleReferences === 'string'
    && context.scaleReferences.trim().length > 0;
  const hasScaleAnchor = refCard || userScale;

  const adjusted = parsed.measurements.map((m) => {
    const value = typeof m.valueMm === 'number' ? m.valueMm : null;
    const implausible = value == null
      || value < MEASUREMENT_MIN_MM
      || value > MEASUREMENT_MAX_MM;

    // Force low if either:
    //   - no scale anchor available at all (everything is a guess)
    //   - the value itself is out of plausible bounds
    if (!hasScaleAnchor || implausible) {
      return { ...m, confidence: 'low' };
    }
    return { ...m };
  });

  return { ...parsed, measurements: adjusted };
}

export function normalizeAIResponse(parsed) {
  // Deep clone to avoid mutation
  const data = JSON.parse(JSON.stringify(parsed));

  // Measurements: add id, aiValue, value, confirmed
  data.measurements = data.measurements.map((m, i) => ({
    ...m,
    id: `m-${i}`,
    aiValue: m.displayValue,
    value: m.displayValue,
    confirmed: false,
  }));

  // Materials: add id, aiUnitCost, aiTotalCost, aiQuantity, default unit
  data.materials = data.materials.map((m, i) => ({
    ...m,
    id: `mat-${i}`,
    unit: m.unit || 'Item',
    aiUnitCost: m.unitCost,
    aiTotalCost: m.totalCost,
    aiQuantity: m.quantity,
  }));

  // Schedule of works: add id
  data.scheduleOfWorks = data.scheduleOfWorks.map((s, i) => ({
    ...s,
    id: `sow-${i}`,
  }));

  // Labour: add aiEstimatedDays
  data.labourEstimate = {
    ...data.labourEstimate,
    aiEstimatedDays: data.labourEstimate.estimatedDays,
  };

  // Default siteConditions
  if (!data.siteConditions) {
    data.siteConditions = {
      accessDifficulty: 'normal',
      accessNote: null,
      foundationCondition: 'sound',
      foundationNote: null,
      adjacentStructureRisk: false,
      adjacentStructureNote: null,
    };
  }

  return data;
}
