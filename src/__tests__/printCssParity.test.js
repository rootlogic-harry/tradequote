/**
 * print.css must carry the rules QuoteDocument depends on for PDF
 * rendering (TRQ-171).
 *
 * The Puppeteer PDF path runs with `setJavaScriptEnabled(false)` for
 * security (sec-audit C-2). That means Tailwind's CDN runtime JIT
 * never executes, and any utility class without an equivalent rule
 * below silently fails to render. These assertions lock in the
 * minimum vendor-style coverage so the PDF can't drift back to a
 * bare-HTML look if someone removes a rule expecting Tailwind to
 * pick it up.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const printCss = readFileSync(
  join(__dirname, '../../public/print.css'),
  'utf8'
);

describe('print.css carries non-Tailwind fallbacks for PDF render', () => {
  test('logo size matches Mark reference (65×32mm = 245×120px @ 96dpi)', () => {
    expect(printCss).toMatch(/img\[alt="Logo"\][\s\S]*max-width:\s*245px/);
    expect(printCss).toMatch(/img\[alt="Logo"\][\s\S]*max-height:\s*120px/);
  });

  test('Measurements list shows disc bullets (Tailwind preflight strips defaults)', () => {
    expect(printCss).toMatch(
      /\[data-print-section="measurements"\] ul[\s\S]*list-style:\s*disc/
    );
  });

  test('Site Photographs heading centred above centred photos', () => {
    expect(printCss).toMatch(
      /\[data-print-section="photos"\] h2[\s\S]*text-align:\s*center/
    );
  });

  test('Photo height capped at 118mm (matches Mark reference, was 95mm)', () => {
    expect(printCss).toMatch(/max-height:\s*118mm/);
  });
});
