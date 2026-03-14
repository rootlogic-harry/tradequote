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

  // Materials: add id, aiUnitCost, aiTotalCost, default unit
  data.materials = data.materials.map((m, i) => ({
    ...m,
    id: `mat-${i}`,
    unit: m.unit || 'Item',
    aiUnitCost: m.unitCost,
    aiTotalCost: m.totalCost,
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
