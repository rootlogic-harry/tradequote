import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const printCss = readFileSync(join(repoRoot, 'public/print.css'), 'utf8');
const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');

// TRQ-119/120: the print CSS lives in public/print.css and is shared by two
// render paths — window.print() in the browser (Phase 1) and Puppeteer
// server-side (Phase 2). Guard its key rules so nobody strips them thinking
// they're dead code.
describe('Print CSS in public/print.css', () => {
  it('declares @page with A4 size + margins', () => {
    expect(printCss).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    expect(printCss).toMatch(/@page\s*\{[^}]*margin:/);
  });

  it('has a @media print block', () => {
    expect(printCss).toMatch(/@media print/);
  });

  it('applies break-inside: avoid to every data-print-section', () => {
    // Both standard + legacy property for older Chrome/Safari.
    expect(printCss).toMatch(/\[data-print-section\][\s\S]*break-inside:\s*avoid/);
    expect(printCss).toMatch(/\[data-print-section\][\s\S]*page-break-inside:\s*avoid/);
  });

  it('prints coloured backgrounds with print-color-adjust: exact', () => {
    expect(printCss).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(printCss).toMatch(/print-color-adjust:\s*exact/);
  });

  it('defines .print-root as the sole visible tree during print', () => {
    expect(printCss).toMatch(/body\s*\*\s*\{[\s\S]*visibility:\s*hidden/);
    expect(printCss).toMatch(/\.print-root[\s\S]*visibility:\s*visible/);
  });

  it('defines .print-only to hide the print clone on screen', () => {
    expect(printCss).toMatch(/\.print-only\s*\{[\s\S]*display:\s*none/);
    expect(printCss).toMatch(/@media print[\s\S]*\.print-only[\s\S]*display:\s*block/);
  });

  it('hides data-html2canvas-ignore elements in print', () => {
    expect(printCss).toMatch(/data-html2canvas-ignore="true"[\s\S]*display:\s*none/);
  });

  it('breaks photo appendix onto a fresh page', () => {
    expect(printCss).toMatch(/\[data-print-section="photos"\][\s\S]*break-before:\s*page/);
  });

  // index.html must reference the stylesheet so the browser loads it for
  // window.print(); the server-side Puppeteer path reads the file directly.
  it('index.html links the print stylesheet', () => {
    expect(indexHtml).toMatch(/<link[^>]+href="\/print\.css"/);
  });
});
