/**
 * Helpers that keep generated .docx packages valid for Microsoft Word.
 *
 * Word is far stricter than Pages / Google Docs / LibreOffice: a structurally
 * invalid package raises "Word found unreadable content … Do you want to
 * recover the contents?". Two defects triggered it in production
 * (2026-09-20, Mark) and both are prevented here:
 *
 *  1. docx v9 requires `type` ("jpg" | "png" | "gif" | "bmp") on every
 *     ImageRun. Omitted, it does not throw — the picture is written as
 *     word/media/<hash>.undefined with no content type registered.
 *     decodeImageDataUrl() detects the real type from the image's magic
 *     bytes (never from the data-URL MIME, which can lie).
 *  2. XML 1.0 forbids most control characters. One stray vertical tab from
 *     dictation or a PDF paste makes document.xml malformed.
 *     sanitizeXmlText() strips them before text reaches TextRun.
 *
 * Pure and dependency-free (runs in the browser bundle).
 */

/**
 * Detect a raster type docx can embed from its leading bytes.
 * @param {Uint8Array} bytes
 * @returns {'jpg'|'png'|'gif'|'bmp'|null} null = not embeddable (webp, unknown…)
 */
export function detectImageType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return null;
}

/**
 * Decode a base64 image data URL into bytes + the type docx needs.
 * Throws (callers already catch per-image and skip it with a warning) when the
 * input is malformed or the format cannot be embedded — skipping one picture
 * is always better than shipping a document Word refuses to open cleanly.
 *
 * @param {string} dataUrl e.g. "data:image/jpeg;base64,/9j/4AAQ…"
 * @returns {{ data: Uint8Array, type: 'jpg'|'png'|'gif'|'bmp' }}
 */
export function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.includes(',')) {
    throw new Error('Invalid image data URL');
  }
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!b64) throw new Error('Invalid image data URL: empty payload');
  const bin = atob(b64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const type = detectImageType(data);
  if (!type) throw new Error('Unsupported image format for Word export');
  return { data, type };
}

/**
 * Remove characters that are illegal in XML 1.0 from a string destined for a
 * TextRun. Keeps \t \n \r, all normal Unicode and valid surrogate pairs;
 * drops C0 controls, lone surrogates and U+FFFE / U+FFFF.
 */
export function sanitizeXmlText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    // lone high surrogate (not followed by a low) or lone low (not preceded by a high)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
