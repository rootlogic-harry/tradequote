/**
 * TRQ-118 — QuoteOutput.jsx split into smaller files.
 *
 * Anchors the new structure so a future refactor can't quietly fold the
 * PDF/DOCX builders back into the component file. The wins this test
 * defends:
 *   1. QuoteOutput.jsx stays under 1,000 lines (was 1,679 at ticket time).
 *   2. The two extracted utilities export the canonical builder names.
 *   3. QuoteOutput.jsx imports + delegates to them — the bodies live
 *      in src/utils/, not in the component.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const quoteOutputSrc = readFileSync(
  join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
  'utf8'
);
const exportPdfSrc = readFileSync(join(repoRoot, 'src/utils/exportPdf.js'), 'utf8');
const exportDocxSrc = readFileSync(join(repoRoot, 'src/utils/exportDocx.js'), 'utf8');

describe('TRQ-118 — QuoteOutput.jsx split', () => {
  test('QuoteOutput.jsx is under 1100 lines (was 1679 at TRQ-118 split)', () => {
    // Original TRQ-118 split set the cap at 1000 (file was 951 then).
    // Cap bumped to 1100 when worker-copy PDF (16 June 2026) added a
    // new button + handler parameter — legitimate feature addition,
    // not bloat. The intent of the cap is to prevent re-growth to the
    // pre-split 1679; 1100 still serves that purpose with headroom
    // for a few more features.
    const lineCount = quoteOutputSrc.split('\n').length;
    expect(lineCount).toBeLessThan(1100);
  });

  test('exportPdf.js exports exportQuoteAsPdf', () => {
    expect(exportPdfSrc).toMatch(/export\s+(async\s+)?function\s+exportQuoteAsPdf/);
  });

  test('exportDocx.js exports exportQuoteAsDocx', () => {
    expect(exportDocxSrc).toMatch(/export\s+(async\s+)?function\s+exportQuoteAsDocx/);
  });

  test('QuoteOutput.jsx imports both extracted builders', () => {
    expect(quoteOutputSrc).toMatch(
      /import\s*\{\s*exportQuoteAsPdf\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/exportPdf/
    );
    expect(quoteOutputSrc).toMatch(
      /import\s*\{\s*exportQuoteAsDocx\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/exportDocx/
    );
  });

  test('handleDownloadPDF / handleDownloadDocx in QuoteOutput.jsx are thin wrappers', () => {
    // The wrappers should reach for the extracted builders and not
    // re-implement the canvas-slicing / docx-table-building logic.
    // Catch a regression where someone re-inlines the body.
    expect(quoteOutputSrc).toMatch(/handleDownloadPDF\s*=\s*async/);
    expect(quoteOutputSrc).toMatch(/await\s+exportQuoteAsPdf\(/);
    expect(quoteOutputSrc).toMatch(/handleDownloadDocx\s*=\s*async/);
    expect(quoteOutputSrc).toMatch(/await\s+exportQuoteAsDocx\(/);
    // Internals of the builders must not appear back in the component.
    expect(quoteOutputSrc).not.toMatch(/window\.html2canvas/);
    expect(quoteOutputSrc).not.toMatch(/Packer\.toBlob/);
  });

  test('exportPdf returns a Blob (via pdf.output("blob"))', () => {
    expect(exportPdfSrc).toMatch(/pdf\.output\(['"]blob['"]\)/);
  });

  test('exportDocx returns a Blob (via Packer.toBlob)', () => {
    expect(exportDocxSrc).toMatch(/Packer\.toBlob\(doc\)/);
  });
});
