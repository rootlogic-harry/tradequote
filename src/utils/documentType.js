/**
 * Document-type helper — Quote ↔ Estimate (TRQ-134).
 *
 * Paul wants the customer-facing document to read "Estimate"; Mark wants
 * "Quote". Stored per-tradesman as `profile.documentType`.
 *
 * The helper is the ONLY place in the codebase that decides which term
 * to render. Every customer-facing surface (QuoteDocument, ReviewEdit,
 * QuoteOutput, portalRenderer, ClientLinkBlock, …) reads through it so
 * flipping the toggle changes the entire surface in one flick.
 *
 * Fail-closed: any value that isn't one of DOCUMENT_TYPES falls back to
 * "quote". The server-side whitelist on PUT /profile also rejects
 * anything else with 400 — this default is belt-and-braces for legacy
 * rows or a corrupted cache.
 */

export const DOCUMENT_TYPES = ['quote', 'estimate'];

const TERMS = {
  quote:    { title: 'Quote',    upper: 'QUOTE',    lower: 'quote' },
  estimate: { title: 'Estimate', upper: 'ESTIMATE', lower: 'estimate' },
};

export function documentTerm(profile) {
  const raw = profile && typeof profile.documentType === 'string' ? profile.documentType : 'quote';
  return TERMS[raw] || TERMS.quote;
}
