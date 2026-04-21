/**
 * buildQuoteFilename — produces a human-readable filename for quote and RAMS
 * exports. Backend identifiers (quoteReference, job numbers) deliberately
 * stay out of the filename — the customer receiving the file should see
 *
 *   "Jordan Fleet - 78 Top Station Road - ST7 3NP.pdf"
 *
 * not an auto-generated code. The quoteReference is still stored in the
 * database and printed on the quote document itself for audit purposes.
 *
 * @param {object} opts
 * @param {string} [opts.clientName] - free-text client name
 * @param {string} [opts.siteAddress] - full comma-delimited site address
 * @returns {string} filename **without** an extension
 */
export function buildQuoteFilename(opts = {}) {
  const { clientName = '', siteAddress = '' } = opts || {};

  const client = sanitise(clientName);
  const property = sanitise(extractProperty(siteAddress));
  const postcode = extractPostcode(siteAddress);

  const parts = [client, property, postcode].filter(Boolean);
  if (parts.length === 0) return 'Quote';
  return parts.join(' - ');
}

// UK postcode regex — covers the standard formats:
//   A9 9AA · A9A 9AA · A99 9AA · AA9 9AA · AA9A 9AA · AA99 9AA
// Space between outward + inward is optional so we accept both
//   "BD23 1JD" and "BD231JD".
const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\b/i;

function extractPostcode(address) {
  if (!address) return '';
  // Iterate matches and take the last one — if the address contains a
  // partial match earlier, the real postcode tends to sit near the end.
  let last = null;
  const re = new RegExp(UK_POSTCODE_RE, 'gi');
  let m;
  while ((m = re.exec(address)) !== null) {
    last = m;
  }
  if (!last) return '';
  // Reconstruct exactly as user typed (minus whitespace normalisation),
  // uppercased. Keep or drop the space based on user's original input.
  const hadSpace = /\s/.test(last[0]);
  const out = (last[1] + (hadSpace ? ' ' : '') + last[2]).toUpperCase();
  return out;
}

function extractProperty(address) {
  if (!address) return '';
  // Drop the postcode from consideration, then take the first comma segment.
  const withoutPostcode = address.replace(UK_POSTCODE_RE, '');
  const first = withoutPostcode.split(',')[0];
  if (!first) return '';
  return first.trim();
}

// Strip filesystem-illegal characters on Windows/macOS and collapse
// whitespace. Keep apostrophes, ampersands, and other natural punctuation.
function sanitise(s) {
  if (!s) return '';
  return String(s)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
