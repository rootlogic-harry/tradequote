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

export function replaceMeasurementFigure(text, previousValue, nextValue) {
  if (typeof text !== 'string' || !text) return text;
  if (digitsOnly(previousValue) === null || digitsOnly(nextValue) === null) return text;
  if (digitsOnly(previousValue) === digitsOnly(nextValue)) return text;
  let out = text;
  for (const form of spellings(previousValue)) {
    const next = restyle(form, nextValue);
    if (next === form) continue;
    out = out.replace(new RegExp(escapeRegExp(form), 'g'), next);
  }
  return out;
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
