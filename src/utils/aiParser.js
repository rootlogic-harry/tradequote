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

// Per-item-type bounds layered on top of the global fallback. Sourced from the
// systemPrompt's plausibility section so the prompt and the post-processing
// stay in lockstep. The 19m wall height Paul saw (Paul, 2026-05-13) passed
// the global 100m ceiling easily; per-item bounds catch it.
//
// We match the item field case-insensitively by substring. The wall- and
// breach-specific keys take precedence over the generic 'height' / 'length'
// keys so "Wall length 5m" is bounded by the WALL_LENGTH range, not by a
// generic length range. If no key matches, we fall back to the global bounds.
//
// Each tuple is [min, max] in millimetres. Walls "rare up to 3500mm on
// estate boundaries" — anything beyond that is the model misreading scale.
const PER_ITEM_BOUNDS = [
  // Most-specific keys first — these are checked left-to-right.
  { keys: ['wall height', 'height of wall', 'height of the wall'], min: 300, max: 3500 },
  { keys: ['wall thickness', 'wall width', 'thickness of wall', 'wall base'], min: 200, max: 1500 },
  { keys: ['wall length', 'length of wall', 'total wall length', 'length of the wall'], min: 300, max: 100000 },
  { keys: ['breach', 'gap', 'collapse', 'collapsed section', 'missing section'], min: 200, max: 50000 },
  { keys: ['course', 'course depth', 'course height', 'coursing'], min: 50, max: 400 },
  { keys: ['cope', 'coping', 'cope stone'], min: 80, max: 400 },
  { keys: ['through stone', 'through-stone', 'throughstone'], min: 200, max: 1200 },
];

/**
 * Resolve the [min, max] bounds applicable to a given measurement item name.
 * Case-insensitive substring match against PER_ITEM_BOUNDS; falls back to the
 * global MIN/MAX when nothing matches.
 */
export function boundsForItem(itemName) {
  if (typeof itemName !== 'string' || !itemName.trim()) {
    return { min: MEASUREMENT_MIN_MM, max: MEASUREMENT_MAX_MM };
  }
  const lowered = itemName.toLowerCase();
  for (const entry of PER_ITEM_BOUNDS) {
    if (entry.keys.some((k) => lowered.includes(k))) {
      return { min: entry.min, max: entry.max };
    }
  }
  return { min: MEASUREMENT_MIN_MM, max: MEASUREMENT_MAX_MM };
}

/**
 * Applies a confidence floor to measurements based on available scale anchors
 * and plausibility bounds. Pure function — returns a new object.
 *
 * Why this exists: Claude sets per-measurement confidence itself but tends to
 * over-mark "medium" when it should be "low". Three inputs drive the floor:
 *  1. referenceCardDetected — authoritative scale if true.
 *  2. scaleReferences — user-supplied scale anchors in briefNotes-like text
 *     ("the gate is 1.2m wide"). A non-empty string is treated as a valid anchor.
 *  3. valueMm — if outside the per-item-type bounds (falling back to the
 *     global MIN/MAX when the item name is unknown), always force low.
 *     Paul saw a re-run produce "19m high" wall — the global ceiling missed it;
 *     per-item bounds catch it (wall height ≤ 3500mm).
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
    const { min, max } = boundsForItem(m.item);
    const implausible = value == null || value < min || value > max;

    // Force low if either:
    //   - no scale anchor available at all (everything is a guess)
    //   - the value itself is out of plausible bounds for its item type
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
