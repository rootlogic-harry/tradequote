/**
 * Regression test: PDF rendering must be deterministic for identical input.
 *
 * Mark needs the same quote to produce the same PDF every time — his
 * email anti-spam, accounting attachments, and "is this the version I
 * sent?" sanity checks all depend on it. Before this fix we observed
 * two back-to-back renders of the same input producing two PDFs that
 * differed only in /CreationDate, /ModDate, and (when present) /ID —
 * timestamps written by Chromium at PDF emit. Identical content,
 * different bytes.
 *
 * Two layers of protection:
 *
 *   1. `normalisePdfMetadata()` substitutes those three fields with
 *      fixed, byte-length-preserving placeholders.
 *
 *   2. `pdfRenderer.js` waits for `document.fonts.ready` before calling
 *      `page.pdf()`. Without that wait, layout can fall back to system
 *      fonts before Barlow Condensed / Inter swap in, which on a slow
 *      cold start (Railway, Lambda) shifts pagination — the classic
 *      "blank page" / "white gap" footgun.
 *
 * This file owns:
 *   - Behavioural unit tests for the normaliser.
 *   - Source-level wiring assertions for the renderer.
 *
 * It does NOT spawn Chromium — none of our Jest suites do. The integration
 * harness (regression/) is where a real Chromium run could be plugged in
 * once we ship one.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  normalisePdfMetadata,
  __placeholders,
} from '../utils/normalisePdfMetadata.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const pdfRendererSrc = readFileSync(join(repoRoot, 'pdfRenderer.js'), 'utf8');

// ─── Behavioural unit tests for the normaliser ─────────────────────────

describe('normalisePdfMetadata (TRQ-168)', () => {
  // Helper — builds a minimal byte sequence that contains every pattern
  // we care about, in the same shape Chromium emits them.
  const buildPdfWithMetadata = ({ date1, date2, id }) =>
    Buffer.from(
      'PDFHEAD\n' +
      `/CreationDate (${date1})\n` +
      `/ModDate (${date2})\n` +
      '/SomeOtherKey (untouched)\n' +
      `/ID [<${id}><${id}>]\n` +
      'trailer-stuff',
      'binary'
    );

  it('replaces /CreationDate with a length-preserving placeholder', () => {
    const input = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160202+00'00'",
      id: 'a'.repeat(32),
    });
    const out = normalisePdfMetadata(input);
    expect(out.length).toBe(input.length);
    expect(out.toString('binary')).toContain(
      `/CreationDate (${__placeholders.date})`
    );
    expect(out.toString('binary')).not.toContain('20260619160202');
  });

  it('replaces /ModDate independently of /CreationDate', () => {
    const input = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160203+00'00'", // different second
      id: 'b'.repeat(32),
    });
    const out = normalisePdfMetadata(input);
    expect(out.length).toBe(input.length);
    expect(out.toString('binary')).toContain(
      `/ModDate (${__placeholders.date})`
    );
  });

  it('replaces a 32-hex /ID trailer pair with zeroed segments', () => {
    const input = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160202+00'00'",
      id: 'abcdef0123456789ABCDEF0123456789',
    });
    const out = normalisePdfMetadata(input);
    expect(out.length).toBe(input.length);
    expect(out.toString('binary')).toContain(
      `/ID [<${__placeholders.idSegment}><${__placeholders.idSegment}>]`
    );
    expect(out.toString('binary')).not.toMatch(/abcdef0123456789/i);
  });

  it('leaves unrelated PDF bytes untouched', () => {
    const input = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160202+00'00'",
      id: 'c'.repeat(32),
    });
    const out = normalisePdfMetadata(input);
    expect(out.toString('binary')).toContain('/SomeOtherKey (untouched)');
    expect(out.toString('binary')).toContain('PDFHEAD');
    expect(out.toString('binary')).toContain('trailer-stuff');
  });

  it('is idempotent — applying twice equals applying once', () => {
    const input = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160202+00'00'",
      id: 'd'.repeat(32),
    });
    const once = normalisePdfMetadata(input);
    const twice = normalisePdfMetadata(once);
    expect(twice.equals(once)).toBe(true);
  });

  it('produces byte-identical output for two inputs that differ ONLY in the non-deterministic fields', () => {
    const inputA = buildPdfWithMetadata({
      date1: "D:20260619160202+00'00'",
      date2: "D:20260619160202+00'00'",
      id: 'a'.repeat(32),
    });
    const inputB = buildPdfWithMetadata({
      date1: "D:20260619160405+00'00'", // different time
      date2: "D:20260619160405+00'00'",
      id: 'b'.repeat(32),                // different ID
    });
    const outA = normalisePdfMetadata(inputA);
    const outB = normalisePdfMetadata(inputB);
    expect(outA.equals(outB)).toBe(true);
  });

  it('does NOT touch /CreationDate strings that lack the expected shape', () => {
    // Defensive: only the fixed-format Chromium pattern should be hit.
    const input = Buffer.from(
      '/CreationDate (some-other-format)\n/ModDate (also weird)',
      'binary'
    );
    const out = normalisePdfMetadata(input);
    expect(out.equals(input)).toBe(true);
  });

  it('does NOT touch short /ID values used by structure-tree elements', () => {
    // Chromium emits things like /ID (node00000045) inside tagged-PDF
    // structure trees. Those are sequential and already deterministic
    // for a given input, so leave them alone.
    const input = Buffer.from(
      '/ID (node00000045)\n/ID (node00000046)',
      'binary'
    );
    const out = normalisePdfMetadata(input);
    expect(out.equals(input)).toBe(true);
  });

  it('rejects non-Buffer input loudly', () => {
    expect(() => normalisePdfMetadata('not a buffer')).toThrow(TypeError);
    expect(() => normalisePdfMetadata(null)).toThrow(TypeError);
  });
});

// ─── Source-level wiring assertions ────────────────────────────────────

describe('pdfRenderer.js wires the determinism fix in (TRQ-168)', () => {
  it('waits for document.fonts.ready after setContent', () => {
    // The classic Puppeteer flakiness pattern: networkidle0 reports
    // "fonts downloaded" but the FontFaceSet may not have applied them
    // to layout yet. Without this wait, pdf() can capture using
    // fallback-font metrics — section heights shift, pagination
    // decisions race, and a blank trailing page or vertical gap
    // appears at random.
    expect(pdfRendererSrc).toMatch(/document\.fonts\.ready/);
  });

  it('imports the normaliser from src/utils/normalisePdfMetadata.js', () => {
    expect(pdfRendererSrc).toMatch(
      /import\s*\{\s*normalisePdfMetadata\s*\}\s*from\s*['"]\.\/src\/utils\/normalisePdfMetadata\.js['"]/
    );
  });

  it('calls normalisePdfMetadata on the PDF buffer before returning', () => {
    expect(pdfRendererSrc).toMatch(/normalisePdfMetadata\(/);
  });

  it('still preserves the SSRF defence layers (regression guard)', () => {
    // The fix must NOT undo any of the existing security wiring.
    expect(pdfRendererSrc).toMatch(/setJavaScriptEnabled\(false\)/);
    expect(pdfRendererSrc).toMatch(/setRequestInterception\(true\)/);
    expect(pdfRendererSrc).toMatch(/REQUEST_ALLOWLIST/);
  });
});
