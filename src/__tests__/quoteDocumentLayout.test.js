import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('QuoteDocument layout — printed quote output', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/QuoteDocument.jsx'), 'utf8');
  });

  // TRQ-101: Notes & Conditions used `list-inside` which collapses the hanging
  // indent — wrapped lines fell back under the number instead of aligning under
  // the text of line 1. The fix uses `list-outside` with left padding on the ol,
  // so the marker sits in the gutter and wrapped text aligns with the first char.
  describe('Notes & Conditions indent (TRQ-101)', () => {
    it('notes ol uses hanging indent — list-outside, not list-inside', () => {
      // Find the ol inside the Notes & Conditions block (not other ols)
      const block = source.match(/Notes &amp; Conditions[\s\S]{0,600}<ol[^>]*>/);
      expect(block).not.toBeNull();
      const olTag = block[0].match(/<ol[^>]*>/)[0];
      expect(olTag).not.toMatch(/list-inside/);
    });

    it('notes ol has left padding so numbers sit in the gutter, not off-page', () => {
      const block = source.match(/Notes &amp; Conditions[\s\S]{0,600}<ol[^>]*>/);
      expect(block).not.toBeNull();
      const olTag = block[0].match(/<ol[^>]*>/)[0];
      // list-outside without padding would push markers off the left edge.
      // Accept Tailwind pl-*, ml-*, or inline paddingLeft/marginLeft.
      expect(olTag).toMatch(/pl-\d|ml-\d|padding-?[Ll]eft|margin-?[Ll]eft/);
    });
  });

  // DOCX cost-breakdown table column widths: docx 9.x requires the Table
  // constructor to declare both `columnWidths` and `layout: TableLayoutType.FIXED`
  // for the per-cell widths to be respected. Without them Word auto-fits the
  // columns to content, which collapsed the Description column to ~1ch wide
  // and wrapped text character-by-character down the page.
  describe('DOCX cost breakdown table column widths', () => {
    let quoteOutputSrc;
    beforeAll(() => {
      quoteOutputSrc = readFileSync(
        join(srcDir, 'components/steps/QuoteOutput.jsx'),
        'utf8'
      );
    });

    it('imports TableLayoutType from docx', () => {
      expect(quoteOutputSrc).toMatch(/TableLayoutType/);
    });

    it('cost-breakdown Table declares columnWidths so Word honours the DXA widths', () => {
      // The one-and-only `new Table(` call must include both columnWidths
      // and layout: TableLayoutType.FIXED.
      const tableBlock = quoteOutputSrc.match(/new Table\(\{[\s\S]*?\}\)/);
      expect(tableBlock).not.toBeNull();
      expect(tableBlock[0]).toMatch(/columnWidths/);
      expect(tableBlock[0]).toMatch(/layout:\s*TableLayoutType\.FIXED/);
    });
  });

  // TRQ-119 Phase 1: print-based PDF pipeline. Every major section in
  // QuoteDocument must carry a data-print-section attribute so the @media
  // print stylesheet in index.html can apply break-inside: avoid. Without
  // these attributes, Chrome's print engine paginates blindly and cuts
  // rows in half exactly like the old html2canvas approach did.
  describe('Print pagination (TRQ-119 Phase 1)', () => {
    const expectedSections = [
      'damage',
      'measurements',
      'schedule',
      'cost-breakdown',
      'totals',
      'notes',
      'photos',
    ];

    for (const section of expectedSections) {
      it(`QuoteDocument marks the ${section} section with data-print-section`, () => {
        const pattern = new RegExp(`data-print-section="${section}"`);
        expect(source).toMatch(pattern);
      });
    }

    it('photo appendix wraps pairs in data-print-pair containers', () => {
      expect(source).toMatch(/data-print-pair/);
    });
  });

  // TRQ-103: The PDF was showing the footer twice — once because html2canvas
  // captured the inline <div> footer at the end of the document, and again
  // because handleDownloadPDF overlays a pdf.text() footer at the bottom of
  // every page. Fix: mark the inline footer with data-html2canvas-ignore so
  // the preview still shows it but the PDF capture skips it, leaving only the
  // overlay (which also handles multi-page quotes correctly).
  describe('Footer appears once in PDF (TRQ-103)', () => {
    it('the inline footer <div> is marked data-html2canvas-ignore', () => {
      const footerBlock = source.match(/\{\/\*\s*Footer[^*]*\*\/\}[\s\S]{0,400}VAT No:\s*\$\{profile\.vatNumber\}/);
      expect(footerBlock).not.toBeNull();
      expect(footerBlock[0]).toMatch(/data-html2canvas-ignore/);
    });

    it('only one inline footer block exists in the component', () => {
      const matches = source.match(/VAT No:\s*\$\{profile\.vatNumber\}/g) || [];
      expect(matches.length).toBe(1);
    });
  });

});
