/**
 * Normalise non-deterministic PDF metadata so the same input always
 * produces a byte-identical output (TRQ-168).
 *
 * Chromium's PDF writer always emits:
 *   - /CreationDate (D:YYYYMMDDHHMMSS+ZZ'zz')   — wall-clock at emit
 *   - /ModDate (D:YYYYMMDDHHMMSS+ZZ'zz')        — same
 *   - /ID [<32-hex><32-hex>]                    — random per call (when present)
 *
 * These are the entire source of byte-non-determinism we observed: two
 * back-to-back renders of identical HTML produced identical content
 * except for the seconds digit in the dates. Mark needs identical files
 * for the same quote (otherwise email anti-spam, accounting attachments,
 * and his "is this the version I sent?" sanity check all break).
 *
 * We replace each non-deterministic value with a fixed placeholder of
 * EXACTLY the same byte length. PDFs carry a cross-reference table at
 * the end that points at byte offsets within the file, so any length
 * change would corrupt the document. All three replacements here are
 * length-preserving by construction.
 *
 * Idempotent: applying it twice produces the same result as applying
 * it once (the placeholders themselves match the pattern).
 */

// Fixed epoch we substitute in. Chosen to make tampering obvious in a
// hex dump: '2000-01-01 00:00:00 UTC'. Same width (14 digits + tz) as
// any real Chromium date.
const PLACEHOLDER_DATE = "D:20000101000000+00'00'";

// Length-matched zero string for /ID hex segments (Chromium emits these
// as 32 hex chars per segment when it includes them).
const PLACEHOLDER_ID_SEGMENT = '0'.repeat(32);

/**
 * Returns a new Buffer with /CreationDate, /ModDate, and trailer /ID
 * replaced with deterministic placeholders. Input is left untouched.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Buffer}
 */
export function normalisePdfMetadata(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer)) {
    throw new TypeError('normalisePdfMetadata: pdfBuffer must be a Buffer');
  }
  // PDFs are 8-bit byte streams; binary encoding is the round-trip-safe
  // way to do regex substitution without UTF-8 reinterpretation.
  let s = pdfBuffer.toString('binary');

  // /CreationDate (D:20260619160202+00'00')
  // Replace the value inside the parentheses; keep parentheses + tag.
  s = s.replace(
    /\/CreationDate \(D:[0-9]{14}[+\-Z][0-9]{2}'[0-9]{2}'\)/g,
    `/CreationDate (${PLACEHOLDER_DATE})`
  );
  s = s.replace(
    /\/ModDate \(D:[0-9]{14}[+\-Z][0-9]{2}'[0-9]{2}'\)/g,
    `/ModDate (${PLACEHOLDER_DATE})`
  );

  // Trailer /ID [<hex32><hex32>]. Only normalise the 32-char hex form
  // Chromium uses for the document trailer ID; leave the shorter
  // /ID values inside the structure tree alone (those are sequential
  // node IDs that are already deterministic for a given input).
  s = s.replace(
    /\/ID \[<[0-9A-Fa-f]{32}><[0-9A-Fa-f]{32}>\]/g,
    `/ID [<${PLACEHOLDER_ID_SEGMENT}><${PLACEHOLDER_ID_SEGMENT}>]`
  );

  return Buffer.from(s, 'binary');
}

/**
 * Exposed for tests: the constants chosen for the placeholders.
 */
export const __placeholders = {
  date: PLACEHOLDER_DATE,
  idSegment: PLACEHOLDER_ID_SEGMENT,
};
