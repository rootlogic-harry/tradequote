import { VALID_STONE_TYPES, VALID_CONFIDENCE_LEVELS } from '../constants.js';

// ─────────────────────────────────────────────────────────────────────
// stripMathFromDescriptions (Paul Clough, 2026-06-30)
//
// Belt-and-braces server-side strip of AI math walkthroughs from
// client-facing schedule-of-works step descriptions. The AI sometimes
// emits things like:
//
//   "Rebuild 50m × 1.2m field wall... (50m × 1.2m = 60m² single face =
//    120m² both faces combined; ~3m²/day/2 wallers = 40 operative-days
//    ÷ 2 = 20 days, reduced to 10 days accounting for prepared
//    foundations and on-site stone)."
//
// PR #97 tried to fix this via prompt guidance ("CLIENT-FACING
// DESCRIPTIONS — NO INTERNAL MATH"). The AI sometimes ignored the
// rule, so we reverted and built this deterministic layer instead:
// prompts are probabilistic, regex is not.
//
// Removes (preserving the rest of the description):
//   - Parenthetical math blocks containing "= …m²" or "= … days" or
//     "operative-days" or "÷"
//   - Standalone "~Nm²/day/N wallers" benchmark fragments
//   - "reduced to N days for [reason]" tails
//   - "accounting for [reason]" justifications appended to figures
//
// Preserves plain labour figures like "Estimated 2 days for 2 operatives"
// — only the working-out math gets stripped. Run as the LAST step in
// normalizeAIResponse so any upstream changes still flow through.
// ─────────────────────────────────────────────────────────────────────

const MATH_PARENS_RE =
  /\s*\([^()]*?(?:=\s*\d|operative-days|÷|m²\/day)[^()]*?\)/g;
const BENCHMARK_FRAGMENT_RE =
  /\s*[~≈]?\d+(?:\.\d+)?\s*m²\/day(?:\/\d+\s*wallers?)?[,;.]?/gi;
const REDUCED_TAIL_RE =
  /[,;]?\s*reduced to \d+(?:\.\d+)?\s*days?\s+(?:for|because of|due to)\s+[^.;]+/gi;
const ACCOUNTING_TAIL_RE =
  /[,;]?\s*accounting for [^.;]+/gi;
const ORPHAN_DIVISION_RE =
  /\s*\d+(?:\.\d+)?\s*operative-days?\s*÷\s*\d+\s*=\s*\d+(?:\.\d+)?\s*days?/gi;

export function stripMathFromDescription(description) {
  if (typeof description !== 'string' || !description) return description;
  return description
    .replace(MATH_PARENS_RE, '')
    .replace(BENCHMARK_FRAGMENT_RE, '')
    .replace(REDUCED_TAIL_RE, '')
    .replace(ACCOUNTING_TAIL_RE, '')
    .replace(ORPHAN_DIVISION_RE, '')
    // Collapse double-spaces + space-before-punct that the strips can produce
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    // Tidy trailing whitespace + dangling ". ."
    .replace(/\.\s*\.\s*/g, '. ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────
// stripFillerPhrases (Mark, 2026-07-14)
//
// Deterministic strip of low-information filler phrases the model
// keeps generating even when the prompt tells it not to. Mark's
// specific complaint: "as specified by tradesman" appearing a few
// times per quote. Manual edits don't teach the model (there's no
// fine-tuning loop) — so we handle it in code, same pattern as the
// math strip above ("prompts are probabilistic, regex is not").
//
// Covers the common shapes the model has produced in Mark's quotes:
//   "(as specified by tradesman)"
//   "(as specified by the tradesman)"
//   "…, as specified by tradesman."
//   "…—as directed by the tradesman"
//   "as per tradesman's specification"
//   "as noted by builder"
//
// Also covers legacy variants (trader / waller / contractor) and the
// verb spectrum (specified / directed / noted / advised / instructed /
// requested). Not exhaustive — we can add more as they surface.
//
// Preserves the surrounding sentence. Runs AFTER stripMathFromDescription
// so the trailing whitespace/punct tidy applies once at the end.
// ─────────────────────────────────────────────────────────────────────

const FILLER_VERBS = 'specified|directed|noted|advised|instructed|requested|per|described';
const FILLER_NOUNS = 'tradesman|trader|builder|waller|contractor';

// Parenthetical shape: `(as specified by tradesman)` — strip the whole
// pair of parens including the phrase, plus any leading whitespace.
const FILLER_PARENS_RE = new RegExp(
  `\\s*\\(\\s*(?:as|to be)\\s+(?:${FILLER_VERBS})(?:\\s+by)?\\s+(?:the\\s+)?(?:${FILLER_NOUNS})['’]?s?(?:\\s+(?:specification|spec|instructions?|direction))?\\s*\\)`,
  'gi',
);

// Mid-sentence shape (connector on BOTH sides): `The wall, as specified
// by tradesman, will be rebuilt.` The replacer keeps the leading
// connector so grammar survives: "The wall, will be rebuilt." Cleanup
// pass then trims the trailing comma-before-word.
const FILLER_INLINE_MID_RE = new RegExp(
  `([,;—–\\-])\\s*\\bas\\s+(?:${FILLER_VERBS})\\s+by\\s+(?:the\\s+)?(?:${FILLER_NOUNS})\\b\\s*[,;—–\\-]`,
  'gi',
);

// End-of-clause shape (leading connector, terminating punctuation NOT
// in the char class): `Rebuild to 1.2m height, as specified by
// tradesman.` Strip the whole leading connector + phrase.
const FILLER_INLINE_END_RE = new RegExp(
  `[\\s,;—–\\-]*\\bas\\s+(?:${FILLER_VERBS})\\s+by\\s+(?:the\\s+)?(?:${FILLER_NOUNS})\\b`,
  'gi',
);

// "as per tradesman's specification" and similar possessive shapes
// that use "per" instead of "by".
const FILLER_PER_POSSESSIVE_RE = new RegExp(
  `[\\s,;—–\\-]*\\bas\\s+per\\s+(?:the\\s+)?(?:${FILLER_NOUNS})['’]?s?\\s+(?:specification|spec|instructions?|direction)`,
  'gi',
);

export function stripFillerPhrases(description) {
  if (typeof description !== 'string' || !description) return description;
  return description
    .replace(FILLER_PARENS_RE, '')
    // Mid-sentence must run BEFORE end-of-clause — otherwise the
    // end-of-clause regex would greedy-match the same substring first
    // and leave a dangling trailing comma.
    .replace(FILLER_INLINE_MID_RE, ' ')
    .replace(FILLER_INLINE_END_RE, '')
    .replace(FILLER_PER_POSSESSIVE_RE, '')
    // Same cleanup as stripMathFromDescription — collapse double
    // spaces, remove space-before-punct, normalise dangling periods.
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\.\s*\.\s*/g, '. ')
    .trim();
}

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

  // damageDescription: strip filler phrases (Mark, 2026-07-14).
  // The math strip is deliberately NOT applied here — damage descriptions
  // don't contain math walkthroughs in the observed cases, and running
  // the math regexes on a long narrative paragraph risks a spurious
  // parenthetical clip.
  if (data.damageDescription) {
    data.damageDescription = stripFillerPhrases(data.damageDescription);
  }

  // Schedule of works: add id + strip any AI math walkthrough from the
  // client-facing description (Paul Clough bug, 2026-06-30). See
  // stripMathFromDescription above for the regex contract. Also strip
  // "as specified by tradesman" filler phrases (Mark, 2026-07-14) —
  // same deterministic pattern, different set of phrases.
  data.scheduleOfWorks = data.scheduleOfWorks.map((s, i) => ({
    ...s,
    id: `sow-${i}`,
    description: stripFillerPhrases(stripMathFromDescription(s.description)),
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
