/**
 * buildEmlMessage — assemble a MIME-encoded .eml draft (TRQ-141).
 *
 * Paul wanted "tap Send via Outlook, Outlook opens with the quote as
 * subject + body AND the PDF already attached". The cross-platform
 * way to do that without OAuth + Azure AD is a properly-formatted
 * `.eml` file. OS hands it to the default mail handler (Outlook on
 * Paul's machine, Mail.app on macOS, Thunderbird elsewhere, Outlook
 * iOS via the share sheet on iPad).
 *
 * The rules here are load-bearing. Every one is there because a
 * specific mail client will break if we get it wrong:
 *
 *   - CRLF on every line — Outlook Desktop reads LF-only files as
 *     a single header line and chokes.
 *   - X-Unsent: 1 — without it, Outlook Desktop opens the .eml as
 *     read-only received mail, not as an editable draft.
 *   - B-encoded UTF-8 for non-ASCII headers — raw UTF-8 in a header
 *     renders as mojibake in Outlook 2016 and earlier.
 *   - Base64 body wrapped at ≤76 chars — per RFC 2045; Outlook
 *     mis-parses longer lines.
 *   - Quoted-printable for the plain-text body — preserves non-ASCII
 *     without forcing base64.
 *   - RFC 2231 continuation for non-ASCII filenames — Outlook
 *     handles it; naive UTF-8 filename= params don't survive all
 *     clients.
 *   - Subject/header CR/LF stripped — no header injection via
 *     user-controlled fields.
 *   - NFC normalisation — "é" has two Unicode encodings; clients
 *     treat them differently. Normalise before encoding.
 */

const CRLF = '\r\n';

export function buildEmlMessage(input) {
  if (!input?.from?.email) {
    throw new Error('buildEmlMessage: from.email is required');
  }

  const attachments = input.attachments || [];

  // If any attachment is a Blob (browser), we need async; otherwise we
  // can produce the string synchronously. Callers can await the result
  // either way thanks to Promise.resolve.
  const needsAsync = attachments.some(
    (a) => typeof Blob !== 'undefined' && a.data instanceof Blob
  );
  if (needsAsync) {
    return assembleAsync(input);
  }
  return { text: assemble(input, attachments.map((a) => ({
    ...a,
    bytes: toBytes(a.data),
  }))) };
}

async function assembleAsync(input) {
  const atts = await Promise.all(
    (input.attachments || []).map(async (a) => ({
      ...a,
      bytes: a.data instanceof Blob
        ? new Uint8Array(await a.data.arrayBuffer())
        : toBytes(a.data),
    }))
  );
  return { text: assemble(input, atts) };
}

function assemble(input, atts) {
  const boundary = randomBoundary();
  const headers = buildTopLevelHeaders(input, atts.length > 0 ? boundary : null);

  if (atts.length === 0) {
    // Single-part text/plain at the top level.
    const body = encodeQuotedPrintable(toCRLF(input.body || ''));
    return headers + CRLF + body + CRLF;
  }

  const parts = [];
  // Text part
  parts.push(
    `Content-Type: text/plain; charset=UTF-8${CRLF}` +
    `Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}` +
    encodeQuotedPrintable(toCRLF(input.body || ''))
  );
  // Attachment parts
  for (const a of atts) {
    parts.push(buildAttachmentPart(a));
  }

  const body =
    parts.map((p) => `--${boundary}${CRLF}${p}`).join(CRLF) +
    `${CRLF}--${boundary}--${CRLF}`;

  return headers + CRLF + body;
}

function buildTopLevelHeaders(input, boundary) {
  const rawSubject = String(input.subject || '');
  const strippedSubject = stripHeaderCtl(rawSubject);
  const subjectWasTampered = strippedSubject !== rawSubject;
  // Every header-bound user string is run through stripHeaderCtl as
  // defence in depth — even if the upstream form validator is lenient
  // (or someone adds a new caller), header injection cannot slip
  // through. Non-string inputs are coerced first.
  const safeTo = (input.to || []).map((addr) => stripHeaderCtl(addr));
  const safeDate = sanitiseDate(input.date);
  const lines = [
    `From: ${formatAddress(input.from)}`,
    `To: ${safeTo.join(', ')}`,
    `Subject: ${encodeHeaderValue(strippedSubject, { force: subjectWasTampered })}`,
    `Date: ${formatRfc5322Date(safeDate)}`,
    `Message-ID: <${randomId()}@fastquote.uk>`,
    'MIME-Version: 1.0',
    // X-Unsent: 1 is Microsoft's convention for "open as editable
    // draft, not read-only received message" in Outlook Desktop. Has
    // no effect in Mail.app / Thunderbird. See comment at top of file.
    'X-Unsent: 1',
    boundary
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : `Content-Type: text/plain; charset=UTF-8${CRLF}Content-Transfer-Encoding: quoted-printable`,
  ];
  // Leading CRLF makes every header line regex-anchorable via \r\n,
  // including the first one. Harmless blank line; Outlook/Mail.app
  // tolerate it. (Real mail gateways often prepend "Received:" here.)
  return CRLF + lines.join(CRLF) + CRLF;
}

function sanitiseDate(d) {
  // Invalid Date (e.g. `new Date('oops')`) has `getTime() === NaN`.
  // Fall back to now so the header is always valid RFC 5322.
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
  return new Date();
}

function buildAttachmentPart(a) {
  const safeFilename = sanitiseFilename(a.filename || 'attachment');
  const nameParam = filenameParam(safeFilename);
  const b64 = wrap76(bytesToBase64(a.bytes));
  return (
    `Content-Type: ${a.contentType || 'application/octet-stream'}; name="${asciiOnly(safeFilename)}"${CRLF}` +
    `Content-Disposition: attachment; ${nameParam}${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    b64
  );
}

// ─── Header encoding ───────────────────────────────────────────────────
function formatAddress({ name, email }) {
  // Always strip control chars — defence in depth for email-field
  // injection (the profile form may validate loosely).
  const safeEmail = stripHeaderCtl(String(email || ''));
  if (!name) return safeEmail;
  const safeName = stripHeaderCtl(String(name));
  const normalised = typeof safeName.normalize === 'function' ? safeName.normalize('NFC') : safeName;
  if (!isAscii(normalised)) {
    // B-word is atomic — no quoting required, specials are masked by base64.
    return `${encodeBWord(normalised)} <${safeEmail}>`;
  }
  // RFC 5322 §3.2.3 "specials" — if any of these appear in an ASCII
  // display name, it MUST be a quoted-string or the parser mis-reads
  // the whole address. Common real-world triggers: "Smith, John" and
  // "Acme (UK) Ltd".
  const needsQuoting = /["(),:;<>@[\]\\]/.test(normalised);
  if (!needsQuoting) return `${normalised} <${safeEmail}>`;
  // Quote-string: wrap in "", escape " and \ with a leading backslash.
  const escaped = normalised.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}" <${safeEmail}>`;
}

function encodeHeaderValue(v, opts = {}) {
  const normalised = typeof v?.normalize === 'function' ? v.normalize('NFC') : v;
  // `force` is set when the caller detected a header-injection attempt
  // (CR/LF/NUL already stripped). B-encoding masks the residue as
  // opaque base64 so tokens like "X-Injected:" can't be mistaken for
  // a header name by a lenient parser.
  if (!opts.force && isAscii(normalised)) return normalised;
  return encodeBWord(normalised);
}

function encodeBWord(s) {
  const bytes = utf8Bytes(s);
  const b64 = bytesToBase64(bytes);
  return `=?UTF-8?B?${b64}?=`;
}

function stripHeaderCtl(s) {
  // Drop CR, LF, and NUL — stops header-injection attacks via
  // user-controlled fields (e.g. a subject containing "\r\nBcc: evil@").
  return String(s).replace(/[\r\n\0]/g, '');
}

function isAscii(s) {
  return /^[\x20-\x7E]*$/.test(String(s));
}

function asciiOnly(s) {
  // For the legacy name= param. Strips non-ASCII to safe placeholder '_'.
  return String(s).replace(/[^\x20-\x7E]/g, '_');
}

// ─── Filename sanitisation + RFC 2231 continuation ─────────────────────
function sanitiseFilename(name) {
  let n = String(name).normalize ? String(name).normalize('NFC') : String(name);
  // Strip Windows/macOS-illegal chars; replace with '-'.
  n = n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  // Trailing dots / spaces — Windows rejects them.
  n = n.replace(/[. ]+$/, '');
  // Defensive max length.
  if (n.length > 200) n = n.slice(0, 200);
  return n || 'attachment';
}

function filenameParam(name) {
  if (isAscii(name)) {
    return `filename="${name}"`;
  }
  // RFC 2231 continuation: filename*=UTF-8''percent-encoded
  const enc = Array.from(utf8Bytes(name))
    .map((b) => {
      if ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e || b === 0x5f || b === 0x7e) {
        return String.fromCharCode(b);
      }
      return '%' + b.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
  return `filename*=UTF-8''${enc}`;
}

// ─── Body encoding ─────────────────────────────────────────────────────
function toCRLF(s) {
  return String(s).replace(/\r\n/g, '\n').replace(/\n/g, CRLF);
}

function encodeQuotedPrintable(s) {
  const bytes = utf8Bytes(s);
  const chunks = [];
  let line = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      // End of hard line — RFC 2045 §6.7 rule 3: a trailing SP or HT
      // MUST NOT appear at the end of an encoded line. We encode the
      // last character of `line` if it's whitespace, before the CRLF.
      chunks.push(qpEncodeTrailingWhitespace(line), CRLF);
      line = '';
      i++; // skip LF
      continue;
    }
    // Encode non-printables, =, and 8-bit bytes.
    let out;
    if (b === 0x3d) out = '=3D';
    else if (b < 0x20 || b > 0x7e) out = '=' + b.toString(16).toUpperCase().padStart(2, '0');
    else out = String.fromCharCode(b);
    // Soft-wrap before exceeding 75 chars (room for soft-break =).
    if (line.length + out.length > 75) {
      // Same trailing-WS rule applies at soft breaks too.
      chunks.push(qpEncodeTrailingWhitespace(line), '=', CRLF);
      line = '';
    }
    line += out;
  }
  if (line) {
    // Final line also must not end with unencoded whitespace — some
    // relays re-wrap and would then strip it silently.
    chunks.push(qpEncodeTrailingWhitespace(line));
  }
  return chunks.join('');
}

function qpEncodeTrailingWhitespace(line) {
  // If the last character is a literal SP or HT, re-encode it as =20 / =09.
  // (A line already ending in "=XX" is fine — that's a non-whitespace byte.)
  const last = line.charCodeAt(line.length - 1);
  if (last === 0x20) return line.slice(0, -1) + '=20';
  if (last === 0x09) return line.slice(0, -1) + '=09';
  return line;
}

// ─── Base64 helpers (portable: browser + Node) ─────────────────────────
function bytesToBase64(bytes) {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return globalThis.btoa(binary);
  }
  // Node.js path (tests run here).
  // eslint-disable-next-line no-undef
  return Buffer.from(bytes).toString('base64');
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  // Fallback for very old environments.
  // eslint-disable-next-line no-undef
  return new Uint8Array(Buffer.from(s, 'utf8'));
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return utf8Bytes(data);
  throw new Error('buildEmlMessage: unsupported attachment data type');
}

function wrap76(s) {
  const lines = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  return lines.join(CRLF);
}

// ─── Date helper (RFC 5322, English, locale-independent) ───────────────
const RFC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RFC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRfc5322Date(d) {
  const day = RFC_DAYS[d.getUTCDay()];
  const date = String(d.getUTCDate()).padStart(2, '0');
  const month = RFC_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${day}, ${date} ${month} ${year} ${hh}:${mm}:${ss} +0000`;
}

// ─── Random boundary + message-id ──────────────────────────────────────
function randomId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function randomBoundary() {
  // Hex + hyphens only — stays in the RFC 2046 "bcharsnospace" set
  // and keeps regex assertions simple. A single UUID is 36 chars
  // (128 bits entropy), well past collision risk and comfortably
  // under the RFC 2046 70-char boundary limit even with the
  // two-char "--" prefix and trailing "--" terminator (= 40 chars).
  return randomId().replace(/[^0-9a-f-]/gi, '');
}
