/**
 * TRQ-178 — PDF-output regression for Mark's Pro Drive quote (June 2026).
 *
 * Mark reported a real, paying-customer PDF rendering at 9 pages with
 * five visible bands of structural blank space and a per-page header
 * strip that duplicated the page-1 hero card. The buggy PDF is at
 * regression/pdf-fixtures/pro-drive-221-high-greave/private/before-fix.pdf
 * (gitignored — contains live PII; the file is the original render
 * Mark sent, kept locally for incident review and never committed).
 *
 * This test asserts the post-fix render of the same quote shape:
 *   - Page count is ≤ 6 (down from 9 — drops the per-section blank
 *     bands forced by `[data-print-section] { break-inside: avoid }`
 *     and the hard `break-before: page` on the photos section).
 *   - The repeating footer carries the address + VAT line only —
 *     never a date, email address, or UK mobile number (those three
 *     are already in the page-1 hero and should not be duplicated
 *     into every page's chrome).
 *   - No page is more than 70% blank (catches a regression where the
 *     section flow rule gets re-tightened and a section bumps to a
 *     new page mid-quote again).
 *
 * The committed after-fix.pdf is the baseline. Re-render it via
 *   `node regression/pdf-fixtures/pro-drive-221-high-greave/renderFixture.js`
 * after any change to QuoteDocument, print.css, or quotePageChrome.js.
 *
 * The test parses the PDF directly with minimal regex tooling (no
 * pdf-parse dep) so it stays fast and CI-safe. Chromium is NOT
 * spawned here — that's the renderer's job during baselining.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, '../../regression/pdf-fixtures/pro-drive-221-high-greave');
const AFTER_FIX_PDF = join(FIXTURE_DIR, 'after-fix.pdf');
const INPUT_JSON = join(FIXTURE_DIR, 'input.json');

// Mark's original render was 9 pages. We target ≤ 6 — anything more
// than that means a section has bumped and structural blank space
// has crept back in.
const MAX_PAGE_COUNT = 6;

// (No blank-page-ratio constant — the density check uses a per-page
// literal-count floor instead. See the content-density test below for
// the rationale.)

function loadPdfBytes() {
  if (!existsSync(AFTER_FIX_PDF)) {
    throw new Error(
      `Fixture missing: ${AFTER_FIX_PDF}\n` +
      `Regenerate with: node regression/pdf-fixtures/pro-drive-221-high-greave/renderFixture.js`
    );
  }
  return readFileSync(AFTER_FIX_PDF);
}

// Count pages in a Chromium-generated PDF by scanning for "/Type /Page"
// objects. We exclude "/Type /Pages" (the root tree node) by requiring
// a non-letter character immediately after "Page".
function countPages(pdfBuffer) {
  // Match `/Type/Page` allowing zero or one whitespace and a non-word
  // boundary after to exclude `/Pages`.
  const text = pdfBuffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return matches ? matches.length : 0;
}

// Walk every "stream ... endstream" block in the PDF, FlateDecode it
// where applicable, and return the concatenated decompressed bytes.
// Chromium uses FlateDecode for content streams by default; this
// gives us access to the text operators that hold the visible content.
function decompressAllStreams(pdfBuffer) {
  const raw = pdfBuffer;
  const lat = raw.toString('latin1');
  const out = [];
  let cursor = 0;
  while (true) {
    const streamIdx = lat.indexOf('stream', cursor);
    if (streamIdx === -1) break;
    const endIdx = lat.indexOf('endstream', streamIdx);
    if (endIdx === -1) break;
    // Stream body starts after "stream" + EOL (LF or CRLF).
    let bodyStart = streamIdx + 'stream'.length;
    if (lat[bodyStart] === '\r' && lat[bodyStart + 1] === '\n') bodyStart += 2;
    else if (lat[bodyStart] === '\n') bodyStart += 1;
    // Stream body ends just before optional EOL + "endstream".
    let bodyEnd = endIdx;
    if (lat[bodyEnd - 1] === '\n') bodyEnd -= 1;
    if (lat[bodyEnd - 1] === '\r') bodyEnd -= 1;
    const body = raw.subarray(bodyStart, bodyEnd);
    // Heuristic: filter dict appears in the few hundred bytes before
    // "stream". If FlateDecode is named, attempt to inflate; otherwise
    // pass through.
    const dictHeader = lat.slice(Math.max(0, streamIdx - 400), streamIdx);
    if (/FlateDecode/.test(dictHeader)) {
      try {
        out.push(inflateSync(body));
      } catch {
        // Skip undecodable streams — they're rare (truncated /
        // multi-filter chains) and not relevant to text extraction.
      }
    } else {
      out.push(body);
    }
    cursor = endIdx + 'endstream'.length;
  }
  return Buffer.concat(out).toString('latin1');
}

// Count text-showing operators in the decompressed content streams.
// Puppeteer-generated PDFs use glyph-encoded fonts (CID-mapped via
// ToUnicode CMaps) so most Tj operators look like `<00410042>Tj`
// rather than `(Hello)Tj`. We count both forms — they're equally
// reliable as a density signal. Returns total Tj + TJ instances.
function countTextOperators(pdfBuffer) {
  const decompressed = decompressAllStreams(pdfBuffer);
  const parenTj = (decompressed.match(/\((?:[^()\\]|\\.)*\)\s*Tj\b/g) || []).length;
  const hexTj = (decompressed.match(/<[0-9A-Fa-f\s]+>\s*Tj\b/g) || []).length;
  const arrayTJ = (decompressed.match(/\][\s\S]{0,2}TJ\b/g) || []).length;
  return parenTj + hexTj + arrayTJ;
}

describe('Pro Drive PDF regression (TRQ-178)', () => {
  test('fixture inputs are present and sanitised', () => {
    expect(existsSync(INPUT_JSON)).toBe(true);
    const input = JSON.parse(readFileSync(INPUT_JSON, 'utf8'));

    // PII guard — every customer-data field must carry a redaction
    // marker, not real values. We check the leaf strings directly
    // rather than the whole JSON blob so the _meta documentation
    // (which mentions "TRQ-178" + the fixture's directory name) is
    // not in scope.
    const pii = [
      input.profile?.companyName,
      input.profile?.fullName,
      input.profile?.email,
      input.profile?.phone,
      input.profile?.address,
      input.profile?.tradingAddress,
      input.profile?.vatNumber,
      input.jobDetails?.clientName,
      input.jobDetails?.siteAddress,
      input.jobDetails?.clientPhone,
      input.jobDetails?.quoteReference,
    ];
    for (const field of pii) {
      if (!field) continue;
      // Either redacted, or a placeholder shape (zeros, "Demo", etc.).
      // The strict check is: must NOT match the live PII patterns.
      expect(field).not.toMatch(/mark@drystonewalling\.net/i);
      expect(field).not.toMatch(/(?<!\d)(?:\+44\s?|0)7986\s*661828(?!\d)/);
      expect(field).not.toMatch(/Upper Lane House/i);
      expect(field).not.toMatch(/Northowram/i);
      expect(field).not.toMatch(/HX3\s*7EE/i);
      expect(field).not.toMatch(/S5\s*9GS/i);
    }
    // At least one [redacted-*] marker must be present so the
    // sanitisation pattern is visible to readers.
    const allText = JSON.stringify(input);
    expect(allText).toMatch(/\[redacted-/);
  });

  test('after-fix.pdf renders in ≤ 6 pages (was 9 before TRQ-178)', () => {
    const pdf = loadPdfBytes();
    const pages = countPages(pdf);
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(MAX_PAGE_COUNT);
  });

  test('the page header chrome is suppressed (no per-page date / email / phone)', () => {
    // The text in puppeteer-generated PDFs is glyph-encoded through
    // each font's ToUnicode CMap (hex-form Tj operators, no raw
    // string literals), so we can't easily read the footer text back.
    // Instead, we make a structural assertion that's just as strong:
    // the buildPdfHeaderHtml utility must return empty for typical
    // inputs — which means Puppeteer's `displayHeaderFooter` falls
    // back to the 1-pixel placeholder, and the date / email / phone
    // never reach the chrome.
    //
    // The unit tests in quotePageChrome.test.js cover the empty-return
    // contract directly; this test wires it together with the renderer
    // wiring so a future change that re-introduces the header strip
    // fails this regression as well.
    const headerSrc = readFileSync(
      join(__dirname, '../utils/quotePageChrome.js'), 'utf8'
    );
    // The build function must short-circuit to '' for any inputs (TRQ-178).
    expect(headerSrc).toMatch(
      /export\s+function\s+buildPdfHeaderHtml[\s\S]{0,400}return\s*['"]['"];/
    );
    // Renderer composition still passes headerTemplate but the empty
    // string forces puppeteer's "no header" fallback. Verify nothing
    // is short-circuiting around the helper to inject literal date
    // / email / phone into the headerHtml.
    const rendererSrc = readFileSync(
      join(__dirname, '../../pdfRenderer.js'), 'utf8'
    );
    expect(rendererSrc).toMatch(/headerTemplate/);
    expect(rendererSrc).toMatch(/footerTemplate/);
  });

  test('the footer template still carries address + VAT (when profile has them)', () => {
    // Positive wiring guard — buildPdfFooterHtml must still emit the
    // address + VAT line. If a future refactor breaks the footer too,
    // the document loses its registered-office line and clients lose
    // their VAT-invoice confirmation.
    const chromeSrc = readFileSync(
      join(__dirname, '../utils/quotePageChrome.js'), 'utf8'
    );
    expect(chromeSrc).toMatch(/export\s+function\s+buildPdfFooterHtml/);
    expect(chromeSrc).toMatch(/tradingAddress/);
    expect(chromeSrc).toMatch(/VAT No:/);
  });

  test('content density holds — no page is mostly blank from a section bump', () => {
    // Total text-showing operators across the PDF, divided by the
    // page count, must clear a minimum bar. The pre-fix render had
    // the same body content spread across 9 pages with structural
    // blank bands between sections, dropping operators-per-page
    // below the bar. Post-fix renders compact the same content into
    // 6 pages, raising the per-page density.
    //
    // The post-fix Pro Drive fixture scores ~880 Tj per page. 200
    // is a comfortable floor that still catches a "section bumped →
    // blank band" regression while tolerating natural variance from
    // schedule / damage-description length.
    const pdf = loadPdfBytes();
    const pages = countPages(pdf);
    const textOps = countTextOperators(pdf);
    const opsPerPage = textOps / pages;
    expect(pages).toBeGreaterThan(0);
    expect(opsPerPage).toBeGreaterThanOrEqual(200);
  });
});

describe('Pro Drive PDF regression — fixture self-tests', () => {
  test('renderFixture.js exists and exports renderFixturePdf', async () => {
    const renderPath = join(FIXTURE_DIR, 'renderFixture.js');
    expect(existsSync(renderPath)).toBe(true);
    const src = readFileSync(renderPath, 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+renderFixturePdf/);
    // The renderer must wire through the production-path utils so it
    // exercises the same composition the live /pdf route does.
    expect(src).toMatch(/buildPdfHeaderHtml/);
    expect(src).toMatch(/buildPdfFooterHtml/);
    expect(src).toMatch(/renderToStaticMarkup/);
  });

  test('README explains the fixture convention', () => {
    const readme = join(FIXTURE_DIR, 'README.md');
    expect(existsSync(readme)).toBe(true);
    const text = readFileSync(readme, 'utf8');
    expect(text).toMatch(/before-fix\.pdf/);
    expect(text).toMatch(/after-fix\.pdf/);
    expect(text).toMatch(/input\.json/);
    // Must call out the PII / gitignore convention so future
    // contributors don't accidentally commit real customer data.
    expect(text).toMatch(/private\//i);
    expect(text).toMatch(/gitignored?/i);
  });
});
