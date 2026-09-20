/**
 * Damage-description normalisation — the single source of truth shared by the
 * on-screen quote / PDF (QuoteDocument) and the Word export (exportDocx).
 *
 * The plain-prose rules (#152, 2026-09-18) originally lived inline in
 * QuoteDocument only. Word kept emitting the old bold "1 — Component" headers
 * and, because prose went into one TextRun, lost its paragraph breaks
 * (2026-09-20). Sharing one function keeps every output in step.
 *
 * Pure and dependency-free.
 */

/**
 * @param {string} text raw damageDescription
 * @returns {string} prose with legacy numbered headers removed, em dashes
 *   turned into commas, blank lines collapsed, trimmed
 */
export function normaliseDescription(text) {
  if (!text) return '';
  return String(text)
    .replace(/^\d+\s*[—–-]\s*.+$/gm, '')   // legacy numbered header lines ("1 — Component")
    // Em dash → comma. Swallow only spaces/tabs around it (never a newline, or
    // paragraph structure would collapse) so "wall — a" reads "wall, a", not "wall , a".
    .replace(/[ \t]*—[ \t]*/g, ', ')
    .replace(/[ \t]+$/gm, '')               // no trailing spaces left before a newline
    .replace(/\n{3,}/g, '\n\n')             // collapse excess blank lines
    .trim();
}

/**
 * @param {string} text raw damageDescription
 * @returns {string[]} paragraphs (blank-line separated). A single "\n" inside a
 *   paragraph is preserved — renderers show it as a line break.
 */
export function descriptionParagraphs(text) {
  const normalised = normaliseDescription(text);
  if (!normalised) return [];
  return normalised.split('\n\n').map((p) => p.trim()).filter(Boolean);
}
