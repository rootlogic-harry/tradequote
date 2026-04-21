import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(
  join(__dirname, '../../index.html'),
  'utf8'
);

// TRQ-119 Phase 1: print-based PDF pipeline. The @media print block in
// index.html is what makes Save as PDF produce clean page breaks instead
// of the old html2canvas slice-and-paginate bugs. Guard its key rules so
// nobody strips them thinking they're dead code.
describe('Print CSS in index.html', () => {
  it('declares @page with A4 size + margins', () => {
    expect(indexHtml).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    expect(indexHtml).toMatch(/@page\s*\{[^}]*margin:/);
  });

  it('has a @media print block', () => {
    expect(indexHtml).toMatch(/@media print/);
  });

  it('applies break-inside: avoid to every data-print-section', () => {
    // Both standard + legacy property for older Chrome/Safari.
    expect(indexHtml).toMatch(/\[data-print-section\][\s\S]*break-inside:\s*avoid/);
    expect(indexHtml).toMatch(/\[data-print-section\][\s\S]*page-break-inside:\s*avoid/);
  });

  it('prints coloured backgrounds with print-color-adjust: exact', () => {
    expect(indexHtml).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(indexHtml).toMatch(/print-color-adjust:\s*exact/);
  });

  it('defines .print-root as the sole visible tree during print', () => {
    expect(indexHtml).toMatch(/body\s*\*\s*\{[\s\S]*visibility:\s*hidden/);
    expect(indexHtml).toMatch(/\.print-root[\s\S]*visibility:\s*visible/);
  });

  it('defines .print-only to hide the print clone on screen', () => {
    expect(indexHtml).toMatch(/\.print-only\s*\{[\s\S]*display:\s*none/);
    expect(indexHtml).toMatch(/@media print[\s\S]*\.print-only[\s\S]*display:\s*block/);
  });

  it('hides data-html2canvas-ignore elements in print', () => {
    expect(indexHtml).toMatch(/data-html2canvas-ignore="true"[\s\S]*display:\s*none/);
  });

  it('breaks photo appendix onto a fresh page', () => {
    expect(indexHtml).toMatch(/\[data-print-section="photos"\][\s\S]*break-before:\s*page/);
  });
});
