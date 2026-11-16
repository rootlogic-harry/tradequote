/**
 * A measurement the tradesman deleted, recorded for the learning loop.
 *
 * Numeric measurement diffs say "this length was wrong". A removal says
 * "this measurement should not have been suggested". It is stored as its
 * own field type so it does not move the numeric accuracy score, and the
 * original aiValue is copied onto the diff — never overwritten.
 *
 * confirmed_value is the sentinel below. quote_diffs.confirmed_value is
 * NOT NULL, so the sentinel has to be a real string.
 */
import { buildDiff } from './diffTracking.js';

export const MEASUREMENT_REMOVED = 'measurement_removed';
export const MEASUREMENT_REMOVED_VALUE = '[removed]';

const MAX_LABELS = 20;
const MAX_LABEL_CHARS = 80;

export function buildMeasurementRemovalDiff(fieldLabel, aiValue) {
  const label = String(fieldLabel || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS) || 'Measurement';
  const suggested = aiValue == null ? '' : String(aiValue);
  return buildDiff(MEASUREMENT_REMOVED, label, suggested, MEASUREMENT_REMOVED_VALUE);
}

/**
 * Prompt section appended per tradesman at analyse time. Empty when they
 * have not deleted anything, so a new account's prompt is unchanged.
 * Labels only — never site addresses or other job text.
 */
export function formatRemovedMeasurementSection(labels) {
  const clean = [];
  const seen = new Set();
  for (const raw of labels || []) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(label);
    if (clean.length >= MAX_LABELS) break;
  }
  if (clean.length === 0) return '';
  const lines = clean.map((label, i) => `${i + 1}. ${label}`);
  return [
    'REMOVED MEASUREMENTS — this tradesman deleted these suggestions from earlier quotes. Do not emit them again.',
    'Do not rename one into a near-duplicate (a second area figure, or the size of the scale reference itself, such as a reference card or an A4 sheet).',
    ...lines,
  ].join('\n');
}

export function appendRemovedMeasurementSection(prompt, labels) {
  const section = formatRemovedMeasurementSection(labels);
  if (!section) return prompt;
  return `${prompt}\n\n${section}`;
}
