/**
 * When a tradesman corrects a measurement, the schedule of works and
 * the damage description were written against the earlier figure.
 * Replace that figure in the narrative so the two stay in step.
 *
 * Only spellings of the previous value are replaced (4500, 4,500,
 * 4,500mm, 4500 mm). The replacement keeps the comma and unit the
 * sentence already used. Values with fewer than three digits are
 * left alone — "8" and "20" show up in too many other sentences.
 */

function digitsOnly(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function spellings(raw) {
  const n = digitsOnly(raw);
  if (n === null) return [];
  const plain = String(Math.abs(n));
  if (plain.length < 3) return [];
  const comma = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const bodies = comma === plain ? [plain] : [comma, plain];
  const forms = [];
  for (const body of bodies) {
    forms.push(`${body} mm`);
    forms.push(`${body}mm`);
    forms.push(body);
  }
  return forms.sort((a, b) => b.length - a.length);
}

function restyle(matchedForm, nextRaw) {
  const n = digitsOnly(nextRaw);
  if (n === null) return matchedForm;
  const plain = String(Math.abs(n));
  const body = matchedForm.includes(',')
    ? plain.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : plain;
  if (matchedForm.includes(' mm')) return `${body} mm`;
  if (/mm/i.test(matchedForm)) return `${body}mm`;
  return body;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCommittableMeasurement(raw) {
  const n = digitsOnly(raw);
  if (n === null) return false;
  return String(Math.abs(n)).length >= 3;
}

function leaveMatchAlone(text, offset) {
  const before = text.slice(Math.max(0, offset - 64), offset);
  // A price is not a measurement. "£1,200" must survive a 1,200mm edit.
  if (/£\s*$/.test(before)) return true;
  // Through-stone spacing is a method sentence, not the wall size.
  // Stop at the previous full stop so a later "600mm thick wall" in
  // the next sentence still updates.
  const clause = before.split(/[.!?]/).pop() || '';
  if (/through\s*stones?\b/i.test(clause)) return true;
  return false;
}

export function replaceMeasurementFigure(text, previousValue, nextValue) {
  if (typeof text !== 'string' || !text) return text;
  const prev = digitsOnly(previousValue);
  const next = digitsOnly(nextValue);
  if (prev === null || next === null || prev === next) return text;
  // A half-typed figure ("4,") must not rewrite the schedule. The
  // old spelling stays until a full length is committed.
  if (!isCommittableMeasurement(nextValue)) return text;
  const forms = spellings(previousValue);
  if (forms.length === 0) return text;
  const pattern = forms.map(escapeRegExp).join('|');
  // Digit boundaries stop 1,200mm matching inside 11,200mm, and stop
  // the replacement itself being matched again (500 → 1500 → 11500).
  const re = new RegExp(`(?<!\\d)(?:${pattern})(?!\\d)`, 'g');
  return text.replace(re, (match, offset) => {
    if (leaveMatchAlone(text, offset)) return match;
    const styled = restyle(match, nextValue);
    return styled === match ? match : styled;
  });
}

export function syncMeasurementNarrative(reviewData, { previousValue, nextValue } = {}) {
  if (!reviewData) return reviewData;
  const rewrite = (text) => replaceMeasurementFigure(text, previousValue, nextValue);
  const schedule = Array.isArray(reviewData.scheduleOfWorks)
    ? reviewData.scheduleOfWorks.map((step) => ({
      ...step,
      title: rewrite(step?.title),
      description: rewrite(step?.description),
    }))
    : reviewData.scheduleOfWorks;
  return {
    ...reviewData,
    damageDescription: rewrite(reviewData.damageDescription),
    scheduleOfWorks: schedule,
  };
}
