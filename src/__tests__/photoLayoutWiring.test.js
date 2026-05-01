/**
 * Source-level wiring guards for the aspect-aware photo layout (TRQ-177).
 *
 * The fix lives in three places — print.css, QuoteDocument.jsx, and the
 * DOCX builder. Each has to keep its end of the contract for two-per-
 * page rendering to actually work. These guards stop a future refactor
 * from quietly breaking one path while the others continue working.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const printCss = readFileSync(join(__dirname, '../../public/print.css'), 'utf8');
const quoteDocSrc = readFileSync(join(__dirname, '../components/QuoteDocument.jsx'), 'utf8');
const quoteOutputSrc = readFileSync(join(__dirname, '../components/steps/QuoteOutput.jsx'), 'utf8');

describe('print.css carries the per-orientation height caps', () => {
  test('default photo cap is 115mm (landscape — Mark reference minus 3mm)', () => {
    expect(printCss).toMatch(
      /\[data-print-section="photos"\]\s+\.print-photo\s+img[\s\S]*max-height:\s*115mm/
    );
  });

  test('portrait override caps at 110mm', () => {
    expect(printCss).toMatch(
      /\.print-photo\[data-orientation="portrait"\]\s+img[\s\S]*max-height:\s*110mm/
    );
  });

  test('square override caps at 113mm', () => {
    expect(printCss).toMatch(
      /\.print-photo\[data-orientation="square"\]\s+img[\s\S]*max-height:\s*113mm/
    );
  });

  test('inter-photo spacing tightened to 6mm so two photos + heading fit', () => {
    expect(printCss).toMatch(/\[data-print-pair\]\s+>\s+\*\s*\+\s*\*[\s\S]*margin-top:\s*6mm/);
  });

  test('heading vertical spacing neutralised so the 12mm budget is realistic', () => {
    expect(printCss).toMatch(
      /\[data-print-section="photos"\]\s+h2[\s\S]*margin-top:\s*0[\s\S]*padding-top:\s*0/
    );
  });
});

describe('QuoteDocument emits data-orientation per photo', () => {
  test('imports aspectBand from photoLayout', () => {
    expect(quoteDocSrc).toMatch(
      /import\s*\{\s*aspectBand\s*\}\s*from\s*['"]\.\.\/utils\/photoLayout/
    );
  });

  test('each photo wrapper carries data-orientation derived from p.aspect', () => {
    expect(quoteDocSrc).toMatch(/data-orientation=\{aspectBand\(p\.aspect\)\}/);
  });
});

describe('PDF render paths precompute aspects before serialisation', () => {
  test('handleDownloadPdfServer awaits loadAspects before renderToStaticMarkup', () => {
    const idx = quoteOutputSrc.indexOf('handleDownloadPdfServer = async');
    const block = quoteOutputSrc.slice(idx, idx + 2500);
    expect(block).toMatch(/await\s+loadAspects\(filteredPhotos\)/);
    expect(block).toMatch(/photosWithAspect[\s\S]{0,400}renderToStaticMarkup/);
  });

  test('handleSendViaOutlook awaits loadAspects too (email PDF path)', () => {
    const idx = quoteOutputSrc.indexOf('handleSendViaOutlook = async');
    const block = quoteOutputSrc.slice(idx, idx + 6000);
    expect(block).toMatch(/await\s+loadAspects\(filteredPhotos\)/);
  });
});

describe('DOCX builder uses per-band dimensions, not fixed 6.25/4.65 inches', () => {
  test('imports photoMaxDimensions from photoLayout', () => {
    expect(quoteOutputSrc).toMatch(
      /import\s*\{[^}]*photoMaxDimensions[^}]*\}\s*from\s*['"]\.\.\/\.\.\/utils\/photoLayout/
    );
  });

  test('photo paragraph builder calls photoMaxDimensions(aspect)', () => {
    // Locate the photo-building loop and confirm the new util is used.
    // Anchor on the DOCX-specific comment so we don't hit the legacy
    // jsPDF "Photo appendix" earlier in the file.
    const docxAnchor = quoteOutputSrc.indexOf(
      'Photo appendix — 2 photos per page, each in its own section'
    );
    expect(docxAnchor).toBeGreaterThan(-1);
    const photoSlice = quoteOutputSrc.slice(docxAnchor, docxAnchor + 4000);
    expect(photoSlice).toMatch(/photoMaxDimensions\(\s*aspect\s*\)/);
    // The old fixed-inch literals should no longer be present.
    expect(photoSlice).not.toMatch(/6\.25\s*\*\s*96/);
    expect(photoSlice).not.toMatch(/4\.65\s*\*\s*96/);
  });

  test('DOCX heading only emits on the first photo page', () => {
    // Was: every photo-page section had its own SITE PHOTOGRAPHS heading,
    // which crowded out photo height. Now matches PDF (page-1 only).
    // Anchor on the DOCX-specific comment so we don't hit the legacy
    // jsPDF "Photo appendix" earlier in the file.
    const docxAnchor = quoteOutputSrc.indexOf(
      'Photo appendix — 2 photos per page, each in its own section'
    );
    expect(docxAnchor).toBeGreaterThan(-1);
    const photoSlice = quoteOutputSrc.slice(docxAnchor, docxAnchor + 4000);
    expect(photoSlice).toMatch(/isFirstPhotoPage/);
    expect(photoSlice).toMatch(/if\s*\(\s*isFirstPhotoPage\s*\)/);
  });
});
