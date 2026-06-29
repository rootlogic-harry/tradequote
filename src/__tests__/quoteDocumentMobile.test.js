/**
 * QuoteDocument mobile cost-breakdown — stacked rows for small viewports.
 *
 * Mobile PR-3 of 10 (see /tmp/mobile-responsive-plan.md, audit items 3 + 17).
 *
 * Goal: the 5-column cost table in QuoteDocument forced horizontal scroll
 * inside the in-app Live Preview overlay on a 390px viewport (and in the
 * QuoteOutput preview). This PR adds a parallel stacked-card layout that
 * shows ONLY on small SCREEN viewports — the desktop table is still the
 * source of truth and is what every export pipeline (server-side Puppeteer
 * PDF, browser-native print fallback, DOCX) reads.
 *
 * Pitfall #12 is the load-bearing constraint here: QuoteDocument must stay
 * byte-identical for read-only consumers (PDF/DOCX/SavedQuoteViewer). The
 * mobile stacked layout is therefore gated on `@media (max-width:899px)
 * AND screen` — print media hides it. Conversely the desktop table is
 * gated to ≥900px OR print, so PDFs (rendered by Puppeteer at 800×600
 * with `emulateMediaType('print')`) keep seeing the same `<table>`
 * markup they always have.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('QuoteDocument — mobile stacked cost-breakdown (Mobile PR-3)', () => {
  let source;
  let livePreviewSource;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/QuoteDocument.jsx'), 'utf8');
    livePreviewSource = readFileSync(
      join(srcDir, 'components/review/LivePreview.jsx'),
      'utf8'
    );
  });

  // ── Cost-breakdown section retains both layouts ───────────────────

  it('cost-breakdown section is still present and marked data-print-section', () => {
    // Sanity guard: the change must not delete or rename the section
    // wrapper, otherwise print.css orphan/widow rules wouldn't apply.
    expect(source).toMatch(/data-print-section="cost-breakdown"/);
  });

  it('still renders the desktop 5-column <table> (Description/Qty/Unit/Rate/Total)', () => {
    // The exact <table> that gets rendered to PDF must survive intact.
    const tableBlock = source.match(/<table[^>]*>[\s\S]*?<\/table>/);
    expect(tableBlock).not.toBeNull();
    const tableMarkup = tableBlock[0];
    expect(tableMarkup).toMatch(/>Description<\/th>/);
    expect(tableMarkup).toMatch(/>Qty<\/th>/);
    expect(tableMarkup).toMatch(/>Unit<\/th>/);
    expect(tableMarkup).toMatch(/>Rate<\/th>/);
    expect(tableMarkup).toMatch(/>Total<\/th>/);
  });

  // ── Mobile stacked layout exists and is screen-only ───────────────

  it('renders a mobile stacked block keyed off the same materials list', () => {
    // The stacked block is the second materials.map in the source — the
    // first is inside the desktop <table>. Marker class
    // `cost-breakdown-mobile` makes the block greppable and gives the
    // print rule something stable to target.
    expect(source).toMatch(/data-mobile-cost-breakdown/);
  });

  it('mobile stacked block is hidden on desktop AND in print media', () => {
    // The mobile-only block must NOT show in the PDF (which renders with
    // emulateMediaType("print")) and must NOT show on desktop screens.
    // Tailwind's `fq:hidden` covers ≥900px; `print:hidden` covers PDF.
    const mobileBlock = source.match(
      /<div[^>]*data-mobile-cost-breakdown[^>]*>/
    );
    expect(mobileBlock).not.toBeNull();
    const classAttr = mobileBlock[0].match(/className="([^"]*)"/)[1];
    expect(classAttr).toMatch(/\bfq:hidden\b/);
    expect(classAttr).toMatch(/\bprint:hidden\b/);
  });

  it('desktop <table> is hidden on small screens but visible in print media', () => {
    // The desktop table must keep rendering at ≥900px AND in print
    // media (PDF). Below 900px on screen it hides to make way for the
    // stacked block. Without `print:table` the PDF (800px viewport,
    // print media) would hide the table — breaking byte-identity.
    const tableTag = source.match(/<table[^>]+>/)[0];
    const classAttr = tableTag.match(/className="([^"]*)"/)[1];
    // hidden by default (mobile screens), shown at fq:, shown in print.
    expect(classAttr).toMatch(/\bhidden\b/);
    expect(classAttr).toMatch(/\bfq:table\b/);
    expect(classAttr).toMatch(/\bprint:table\b/);
  });

  // ── Stacked layout shape: description on row 1, qty × rate = total on row 2 ──

  it('mobile stacked block describes each material with description + qty × rate = total', () => {
    // Per the plan: row 1 = description, row 2 = `qty × rate = total`.
    // The literal × glyph + = sign make this greppable. Anchor on the
    // attribute appearing as actual JSX (not as a substring inside a
    // comment) — i.e. the form `data-mobile-cost-breakdown` followed by
    // a non-comment whitespace, eventually opening the inner block.
    const blockMatch = source.match(
      /<div\s+data-mobile-cost-breakdown[\s\S]*?<\/div>\s*\)\}/
    );
    expect(blockMatch).not.toBeNull();
    // × is the unicode multiplication sign — written as {'×'} in
    // JSX (raw \uXXXX in JSX text would render literally per the
    // noRawUnicodeEscapes guard).
    expect(blockMatch[0]).toMatch(/\\u00d7|×/);
    // The total prefix `= ` makes the per-row sum unambiguous on a
    // small screen — no risk of mistaking the qty × rate for the total.
    expect(blockMatch[0]).toMatch(/=\s/);
  });

  // ── LivePreview safety net ────────────────────────────────────────

  it('LivePreview mobile overlay inner container has overflow-x-auto safety net', () => {
    // PR-3 deliverable #2: even though the stacked layout removes the
    // need to pan horizontally, the inner container in the mobile
    // overlay also gains overflow-x-auto so any future wide content
    // (large logo, accreditation banner) doesn't blow the layout.
    // Pin: a `bg-white` div inside the mobile overlay contains the
    // overflow-x-auto safety net AND the QuoteDocument component.
    expect(livePreviewSource).toMatch(/bg-white\s+overflow-x-auto/);
    // And it must wrap the QuoteDocument render in the mobile overlay.
    const innerWrapper = livePreviewSource.match(
      /<div\s+className="bg-white overflow-x-auto"[\s\S]*?<QuoteDocument[\s\S]*?\/>/
    );
    expect(innerWrapper).not.toBeNull();
  });
});
