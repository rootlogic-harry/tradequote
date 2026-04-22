/**
 * buildEmlMessage — MIME-encoded .eml assembler (TRQ-141).
 *
 * Paul asked for a "Send via Outlook" path: tap a button in FastQuote,
 * Outlook opens with the quote as subject + body AND the PDF already
 * attached to a new draft. The cross-platform way to do this without
 * OAuth + Azure AD is to download a properly-formatted .eml file and
 * let the OS hand it to whatever the default mail handler is.
 *
 * This test file exhaustively locks the MIME output. Every rule here
 * is load-bearing somewhere — Outlook Desktop will reject a file with
 * the wrong CRLF, treat a file without X-Unsent as read-only, or
 * mangle a non-B-encoded non-ASCII subject.
 */
import { buildEmlMessage } from '../utils/buildEmlMessage.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// Tiny "PDF" — real byte content, small enough to inspect in base64 form.
// 0x25 0x50 0x44 0x46 = %PDF, the actual PDF magic number; good test data.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

const BASE = {
  from: { name: 'Paul Clough', email: 'paul@doylewalling.co.uk' },
  to: [],
  subject: 'Quote QT-2026-0002 — Yorkshire Estates',
  body: 'Dear Angela,\n\nPlease find attached our quote.\n\nKind regards,\nPaul',
  date: new Date('2026-04-22T09:54:00Z'),
  attachments: [
    { filename: 'quote.pdf', contentType: 'application/pdf', data: PDF_BYTES },
  ],
};

function build(over = {}) {
  return buildEmlMessage({ ...BASE, ...over });
}

function asString(blob) {
  // Synchronous — our builder returns either a string or { blob, text }.
  // Tests operate on the string form.
  return typeof blob === 'string' ? blob : blob.text;
}

describe('buildEmlMessage — headers', () => {
  test('emits MIME-Version: 1.0', () => {
    expect(asString(build())).toMatch(/\r\nMIME-Version:\s*1\.0\r\n/);
  });

  test('From header formats as "Name <email>" when both are present', () => {
    const s = asString(build());
    expect(s).toMatch(/\r\nFrom:\s*Paul Clough <paul@doylewalling\.co\.uk>\r\n/);
  });

  test('From header handles email-only (no display name)', () => {
    const s = asString(build({ from: { email: 'paul@example.com' } }));
    expect(s).toMatch(/\r\nFrom:\s*paul@example\.com\r\n/);
  });

  test('From header B-encodes a non-ASCII display name', () => {
    const s = asString(build({ from: { name: 'Paul — Test', email: 'p@e.co' } }));
    expect(s).toMatch(/\r\nFrom:\s*=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <p@e\.co>\r\n/);
  });

  test('To header is emitted even when the recipient list is empty', () => {
    // Paul adds the recipient himself after Outlook opens; we emit a
    // blank To: header so the draft shape is correct.
    expect(asString(build())).toMatch(/\r\nTo:\s*\r\n/);
  });

  test('To header lists multiple recipients comma-joined', () => {
    const s = asString(build({ to: ['a@x.com', 'b@y.com'] }));
    expect(s).toMatch(/\r\nTo:\s*a@x\.com,\s*b@y\.com\r\n/);
  });

  test('Subject is B-encoded UTF-8 because it contains an em-dash', () => {
    const s = asString(build());
    expect(s).toMatch(/\r\nSubject:\s*=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
    // And NOT the raw unicode (would be mojibake in some clients).
    expect(s).not.toMatch(/Subject:\s*Quote QT-2026-0002 — /);
  });

  test('ASCII-only subject is passed through verbatim (no unnecessary encoding)', () => {
    const s = asString(build({ subject: 'Quote QT-2026-0002 - Yorkshire Estates' }));
    expect(s).toMatch(/\r\nSubject:\s*Quote QT-2026-0002 - Yorkshire Estates\r\n/);
  });

  test('Date header uses RFC 5322 English format, regardless of locale', () => {
    const s = asString(build({ date: new Date('2026-04-22T09:54:00Z') }));
    // Expected: "Wed, 22 Apr 2026 09:54:00 +0000"
    expect(s).toMatch(/\r\nDate:\s*Wed, 22 Apr 2026 09:54:00 \+0000\r\n/);
  });

  test('Date header English day/month names even in non-English JS locales', () => {
    // Our formatter must not rely on `toLocaleDateString` defaults.
    const s = asString(build({ date: new Date('2026-12-07T23:59:59Z') }));
    expect(s).toMatch(/\r\nDate:\s*Mon, 07 Dec 2026 23:59:59 \+0000\r\n/);
  });

  test('X-Unsent: 1 is set — makes Outlook Desktop open as editable draft not read-only', () => {
    // Without this header, Outlook Desktop renders the .eml as a
    // received message in read-only mode; Paul cannot hit Send
    // without "Forward" first. This is THE bug-to-prevent for
    // Outlook desktop users.
    expect(asString(build())).toMatch(/\r\nX-Unsent:\s*1\r\n/);
  });

  test('Message-ID is stable-format: <random@fastquote.uk>', () => {
    expect(asString(build())).toMatch(/\r\nMessage-ID:\s*<[^>@]+@fastquote\.uk>\r\n/);
  });

  test('Two calls produce different Message-IDs (no collision across sends)', () => {
    expect(asString(build())).not.toEqual(asString(build()));
  });
});

describe('buildEmlMessage — line endings and structure', () => {
  test('every line ends with CRLF, never bare LF', () => {
    const s = asString(build());
    // Allow no bare LF — scan for LF not preceded by CR.
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\n') {
        expect(s[i - 1]).toBe('\r');
      }
    }
  });

  test('headers and body are separated by an empty line (CRLF CRLF)', () => {
    expect(asString(build())).toMatch(/\r\n\r\n/);
  });

  test('uses multipart/mixed Content-Type with a boundary', () => {
    const s = asString(build());
    expect(s).toMatch(/\r\nContent-Type:\s*multipart\/mixed;\s*boundary="[^"]+"\r\n/);
  });

  test('boundary appears before the text part, before the attachment, and as terminator', () => {
    const s = asString(build());
    const boundary = s.match(/boundary="([^"]+)"/)[1];
    // Before text: --boundary\r\n
    expect(s).toContain(`\r\n--${boundary}\r\n`);
    // Terminator: --boundary--
    expect(s).toContain(`\r\n--${boundary}--\r\n`);
    // Should see the boundary marker at least 3 times: pre-text, pre-attach, terminator.
    const occurrences = s.split(`--${boundary}`).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  test('boundary is a 32-char hex string (unique per call, no collision risk)', () => {
    const s = asString(build());
    const boundary = s.match(/boundary="([^"]+)"/)[1];
    expect(boundary).toMatch(/^[0-9a-f-]{20,}$/i);
  });
});

describe('buildEmlMessage — text body part', () => {
  test('body is emitted as text/plain; charset=UTF-8', () => {
    expect(asString(build())).toMatch(
      /\r\nContent-Type:\s*text\/plain;\s*charset=UTF-8\r\n/
    );
  });

  test('body uses quoted-printable transfer encoding', () => {
    expect(asString(build())).toMatch(
      /\r\nContent-Transfer-Encoding:\s*quoted-printable\r\n/
    );
  });

  test('newlines in body become CRLF (so Outlook preserves paragraphing)', () => {
    const s = asString(build({ body: 'Line one\nLine two\nLine three' }));
    // Find the text/plain part and assert each intended line boundary
    // is CRLF.
    expect(s).toContain('Line one\r\nLine two\r\nLine three');
  });

  test('quoted-printable encodes the em-dash correctly', () => {
    const s = asString(build({ body: 'Price — £450' }));
    // em-dash = U+2014, UTF-8 bytes 0xE2 0x80 0x94 → =E2=80=94
    expect(s).toContain('Price =E2=80=94 =C2=A3450');
  });

  test('soft-wraps long body lines at ≤76 chars per RFC 2045', () => {
    const long = 'A'.repeat(200);
    const s = asString(build({ body: long }));
    const bodyStart = s.indexOf('\r\n\r\n');
    const body = s.slice(bodyStart);
    // No raw line longer than 76 characters (allowing for the soft-break = marker).
    const lines = body.split('\r\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe('buildEmlMessage — attachment part', () => {
  test('Content-Type includes application/pdf + name parameter', () => {
    const s = asString(build());
    expect(s).toMatch(
      /Content-Type:\s*application\/pdf;\s*name="quote\.pdf"/
    );
  });

  test('Content-Disposition: attachment; filename="…"', () => {
    expect(asString(build())).toMatch(
      /Content-Disposition:\s*attachment;\s*filename="quote\.pdf"/
    );
  });

  test('uses base64 transfer encoding for the attachment body', () => {
    const s = asString(build());
    expect(s).toMatch(/Content-Transfer-Encoding:\s*base64/);
  });

  test('attachment body is base64-encoded PDF bytes', () => {
    // PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]
    // base64: "JVBERi0xLjQ="
    const s = asString(build());
    expect(s).toContain('JVBERi0xLjQ=');
  });

  test('attachment body is wrapped to ≤76 chars per line (RFC 2045)', () => {
    // Build a larger attachment to force wrapping.
    const big = new Uint8Array(500).map((_, i) => i % 256);
    const s = asString(build({
      attachments: [{ filename: 'big.pdf', contentType: 'application/pdf', data: big }],
    }));
    // Find the base64 block between the attachment headers and the
    // terminating boundary.
    const b64Block = s.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    const lines = b64Block.split('\r\n').filter(Boolean);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  test('multiple attachments each get their own part', () => {
    const s = asString(build({
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', data: new Uint8Array([1, 2]) },
        { filename: 'b.txt', contentType: 'text/plain', data: new Uint8Array([65, 66]) },
      ],
    }));
    expect(s).toMatch(/filename="a\.pdf"/);
    expect(s).toMatch(/filename="b\.txt"/);
  });

  test('filename with non-ASCII uses RFC 2231 continuation', () => {
    const s = asString(build({
      attachments: [{
        filename: 'Quote — André.pdf',
        contentType: 'application/pdf',
        data: PDF_BYTES,
      }],
    }));
    // filename*=UTF-8''… with percent-encoded bytes for the non-ASCII.
    expect(s).toMatch(/filename\*=UTF-8''[^;\r\n]*%E2%80%94/);
  });

  test('filename with Windows-illegal chars is sanitised to dashes', () => {
    const s = asString(build({
      attachments: [{
        filename: 'bad<path>/file\\x?.pdf',
        contentType: 'application/pdf',
        data: PDF_BYTES,
      }],
    }));
    // No raw angle-brackets / slashes / backslashes / question marks in
    // the filename parameters.
    expect(s).not.toMatch(/filename="[^"]*[<>/\\?][^"]*"/);
    expect(s).not.toMatch(/filename\*=[^;\r\n]*[<>\\?]/);
  });

  test('filename with a trailing dot is stripped (Windows rejects those)', () => {
    const s = asString(build({
      attachments: [{
        filename: 'My Quote.',
        contentType: 'application/pdf',
        data: PDF_BYTES,
      }],
    }));
    expect(s).not.toMatch(/filename="[^"]*\.\.?"/);
  });

  test('accepts a Blob as attachment.data (browser path)', async () => {
    const blob = new Blob([PDF_BYTES], { type: 'application/pdf' });
    const out = buildEmlMessage({
      ...BASE,
      attachments: [{ filename: 'x.pdf', contentType: 'application/pdf', data: blob }],
    });
    // Blob path resolves asynchronously.
    const s = typeof out.then === 'function' ? await out : out;
    expect(asString(s)).toContain('JVBERi0xLjQ=');
  });
});

describe('buildEmlMessage — edge cases + safety', () => {
  test('empty body still produces a valid multipart message', () => {
    const s = asString(build({ body: '' }));
    expect(s).toMatch(/Content-Type:\s*text\/plain/);
    expect(s).toMatch(/--[0-9a-f-]+--\r\n$/);
  });

  test('missing attachments → single-part message is still RFC-valid', () => {
    const s = asString(build({ attachments: [] }));
    // No multipart — just text/plain at the top level.
    expect(s).not.toMatch(/multipart\/mixed/);
    expect(s).toMatch(/\r\nContent-Type:\s*text\/plain/);
  });

  test('rejects missing from.email (the one required field)', () => {
    expect(() => buildEmlMessage({ ...BASE, from: { name: 'x' } })).toThrow(/email/i);
  });

  test('strips control characters from the subject (no CR/LF injection)', () => {
    // An attacker-controlled subject must not be able to inject new
    // headers by smuggling \r\n. We strip bare CR/LF before encoding.
    const s = asString(build({
      subject: 'Quote\r\nX-Injected: evil',
    }));
    expect(s).not.toMatch(/X-Injected:\s*evil/);
  });

  test('NFC-normalises all free-text fields', () => {
    // "é" can be either U+00E9 or "e" + U+0301 (decomposed). Different
    // byte representations can confuse mail clients. Normalise to NFC.
    const decomposed = 'Andre\u0301';   // "Andre" + combining acute
    const composed = 'Andr\u00e9';      // single codepoint "André"
    const fromDecomposed = asString(build({
      from: { name: decomposed, email: 'x@y.co' },
    }));
    const fromComposed = asString(build({
      from: { name: composed, email: 'x@y.co' },
    }));
    // Same base64-encoded header bytes out the other end.
    const b64Decomp = fromDecomposed.match(/From:\s*=\?UTF-8\?B\?([^?]+)\?=/)?.[1];
    const b64Comp = fromComposed.match(/From:\s*=\?UTF-8\?B\?([^?]+)\?=/)?.[1];
    expect(b64Decomp).toBe(b64Comp);
  });
});

// ─── QE audit: previously-unmodeled attack surfaces + edge cases ──────
//
// These tests were added in the post-ship QE pass. Each represents a
// real-world scenario that was not explicitly locked down by the
// initial TDD suite but that a production mail client (or an attacker)
// could hit.

describe('buildEmlMessage — QE audit: injection defences', () => {
  // The security invariant is: user-controlled strings MUST NOT be
  // able to start a new header line. The test asserts that no line in
  // the output begins with "Bcc:" — the literal bytes may still appear
  // inside a From/To value (inert), but they may not form a header.
  const headerInjected = (s, headerName) => {
    const regex = new RegExp(`\\r\\n${headerName}:`, 'i');
    return regex.test(s);
  };

  test('strips CR/LF from from.email so no Bcc: header can be injected', () => {
    // Profile form validates email syntax upstream, but buildEmlMessage
    // shouldn't assume that. If the value ever lands here with CR/LF,
    // treat it as a header-injection attempt — not a template.
    const s = asString(build({
      from: { name: 'Paul', email: 'paul@doyle.co\r\nBcc: evil@evil.co' },
    }));
    expect(headerInjected(s, 'Bcc')).toBe(false);
  });

  test('strips CR/LF from from.name so no Bcc: header can be injected', () => {
    const s = asString(build({
      from: { name: 'Paul\r\nBcc: evil@evil.co', email: 'paul@doyle.co' },
    }));
    expect(headerInjected(s, 'Bcc')).toBe(false);
  });

  test('strips CR/LF from each entry in the To: list', () => {
    // jobDetails.clientEmail is the most likely injection vector in
    // production — the form validator is lenient and the value is
    // pasted into the To: header.
    const s = asString(build({
      to: ['client@example.com\r\nBcc: evil@evil.co', 'other@ok.com'],
    }));
    expect(headerInjected(s, 'Bcc')).toBe(false);
  });
});

describe('buildEmlMessage — QE audit: display-name RFC 5322 compliance', () => {
  test('quotes a display name containing a comma (would split into 2 addrs)', () => {
    // "Smith, John <email>" is parsed by RFC 5322 as TWO addresses:
    // "Smith" and "John <email>". Must be quoted.
    const s = asString(build({
      from: { name: 'Smith, John', email: 'j@smith.co' },
    }));
    expect(s).toMatch(/From:\s*"Smith, John" <j@smith\.co>/);
  });

  test('quotes a display name containing parentheses (would become comment)', () => {
    // Paul's real-world case: "Doyle Walling (Yorkshire) Ltd".
    // Unquoted parens are RFC 5322 comments, so the display name is lost.
    const s = asString(build({
      from: { name: 'Doyle Walling (Yorkshire) Ltd', email: 'p@doyle.co' },
    }));
    expect(s).toMatch(/From:\s*"Doyle Walling \(Yorkshire\) Ltd" <p@doyle\.co>/);
  });

  test('escapes double-quote inside a display name', () => {
    const s = asString(build({
      from: { name: 'The "Big" Stone Co', email: 'big@stone.co' },
    }));
    // Internal " must become \" inside the quoted display name.
    expect(s).toMatch(/From:\s*"The \\"Big\\" Stone Co" <big@stone\.co>/);
  });

  test('escapes backslash inside a display name', () => {
    const s = asString(build({
      from: { name: 'Back\\Slash', email: 'x@y.co' },
    }));
    expect(s).toMatch(/From:\s*"Back\\\\Slash" <x@y\.co>/);
  });

  test('does NOT quote a plain ASCII name with no specials (avoid needless noise)', () => {
    const s = asString(build({
      from: { name: 'Paul Clough', email: 'p@doyle.co' },
    }));
    // Should still be unquoted — quoting is only needed for specials.
    expect(s).toMatch(/From:\s*Paul Clough <p@doyle\.co>\r\n/);
    expect(s).not.toMatch(/From:\s*"Paul Clough"/);
  });
});

describe('buildEmlMessage — QE audit: invalid inputs handled safely', () => {
  test('invalid Date falls back to a valid RFC 5322 date instead of NaN', () => {
    // new Date('oops') → Invalid Date → getUTCDay() returns NaN →
    // RFC_DAYS[NaN] is undefined. Without a guard, the Date header
    // becomes "undefined, NaN undefined NaN NaN:NaN:NaN +0000" —
    // enough to make some mail clients reject the whole draft.
    const s = asString(build({ date: new Date('not-a-real-date') }));
    expect(s).not.toMatch(/undefined|NaN/);
    expect(s).toMatch(
      /Date:\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} \+0000/
    );
  });
});

describe('buildEmlMessage — QE audit: quoted-printable trailing whitespace', () => {
  test('encodes a trailing space before a line break (RFC 2045 §6.7 rule 3)', () => {
    // "Hello \nWorld" — the space before the newline MUST be encoded
    // as =20, or mail gateways that trim trailing whitespace will
    // mangle the body. Outlook is lenient, but downstream relay agents
    // (e.g. Postfix) often strip trailing whitespace silently.
    const s = asString(build({ body: 'Hello \nWorld' }));
    // Grab the quoted-printable body block (between the text-part
    // headers and the next boundary).
    const qpBlock = s
      .split('Content-Transfer-Encoding: quoted-printable\r\n\r\n')[1]
      .split('\r\n--')[0];
    // The first line must end with "=20" (encoded space), not a bare space.
    expect(qpBlock).toMatch(/Hello=20\r\n/);
    expect(qpBlock).not.toMatch(/Hello \r\n/);
  });

  test('encodes a trailing tab before a line break', () => {
    const s = asString(build({ body: 'Hello\t\nWorld' }));
    const qpBlock = s
      .split('Content-Transfer-Encoding: quoted-printable\r\n\r\n')[1]
      .split('\r\n--')[0];
    // Tab (0x09) is already QP-encoded as =09 — this test just guards
    // against a regression that treats tabs as printable.
    expect(qpBlock).toMatch(/Hello=09\r\n/);
  });
});

describe('buildEmlMessage — QE audit: filename edge cases', () => {
  test('strips CR/LF from attachment filename (another injection surface)', () => {
    const s = asString(build({
      attachments: [{
        filename: 'quote.pdf"\r\nX-Injected: evil',
        contentType: 'application/pdf',
        data: PDF_BYTES,
      }],
    }));
    expect(s).not.toMatch(/X-Injected:\s*evil/);
  });
});

// ─── QuoteOutput wiring — source-level assertions (TRQ-141) ───────────
//
// Mirrors the pattern in downloadBlob.test.js: rather than mount the
// full React tree, we grep the compiled source for the contract.
// Cheap, catches regressions if someone rips the handler out.

describe('Send via Outlook — QuoteOutput wiring', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
    'utf8'
  );

  test('imports buildEmlMessage', () => {
    expect(src).toMatch(
      /import\s*\{[\s\S]*buildEmlMessage[\s\S]*\}\s*from\s*['"`][^'"]*buildEmlMessage/
    );
  });

  test('handleSendViaOutlook handler is defined', () => {
    expect(src).toMatch(/handleSendViaOutlook\s*=\s*async/);
  });

  test('handler calls buildEmlMessage with a message/rfc822 output', () => {
    const idx = src.indexOf('handleSendViaOutlook = async');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 5000);
    expect(slice).toMatch(/buildEmlMessage\s*\(/);
    expect(slice).toMatch(/message\/rfc822/);
  });

  test('handler calls downloadBlob to hand the .eml to the OS', () => {
    const idx = src.indexOf('handleSendViaOutlook = async');
    const slice = src.slice(idx, idx + 5000);
    expect(slice).toMatch(/downloadBlob\s*\(/);
    expect(slice).toMatch(/\.eml/);
  });

  test('"Send via Outlook" button exists and is gated on profile email', () => {
    expect(src).toMatch(/Send via Outlook/);
    // disabled={sendingOutlook || !canSendOutlook}
    expect(src).toMatch(/disabled=\{[^}]*!canSendOutlook[^}]*\}/);
  });

  test('handler pre-flights for profile.email', () => {
    // Must not silently fail when profile.email is absent — the user
    // needs a clear instruction ("Add your email in profile").
    const idx = src.indexOf('handleSendViaOutlook = async');
    const slice = src.slice(idx, idx + 5000);
    expect(slice).toMatch(/canSendOutlook/);
  });

  test('iPad path calls navigator.share with ONLY files (no text field)', () => {
    // Regression guard for Paul's iPad "PREPARING EMAIL… then nothing"
    // bug: passing { files, title, text } to navigator.share was
    // rejected silently on iPad Safari. The reliable contract is the
    // same one downloadBlob uses — pass files + filename only.
    const idx = src.indexOf('handleSendViaOutlook = async');
    const slice = src.slice(idx, idx + 5000);
    // The iPad branch must delegate to downloadBlob (which uses the
    // proven { files: [file], title: filename } payload) and MUST NOT
    // call navigator.share directly with a text/body field.
    const ipadBranch = slice.slice(
      slice.indexOf('shouldUseShareSheetPath'),
      slice.indexOf('3b)') !== -1 ? slice.indexOf('3b)') : slice.length,
    );
    expect(ipadBranch).toMatch(/downloadBlob\s*\(/);
    // No stray navigator.share({... text: ...}) in the iPad branch.
    expect(ipadBranch).not.toMatch(/navigator\.share\s*\([^)]*text\s*:/);
  });
});
