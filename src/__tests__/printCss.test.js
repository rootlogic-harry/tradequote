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

  it('keeps totals block unbreakable (the one section that must not split)', () => {
    // TRQ-178: the previous rule pinned `break-inside: avoid` on every
    // [data-print-section], which forced any section that didn't fit
    // on the current page to bump and leave a blank band above its
    // heading. Sections now flow. Totals is the one exception: the
    // Subtotal / VAT / TOTAL trio is meaningless if split across pages.
    // Both standard + legacy property for older Chrome/Safari.
    expect(printCss).toMatch(/\[data-print-section="totals"\][\s\S]*break-inside:\s*avoid/);
    expect(printCss).toMatch(/\[data-print-section="totals"\][\s\S]*page-break-inside:\s*avoid/);
  });

  it('lets non-totals sections flow (TRQ-178 — kill structural blank-space)', () => {
    // Regression guard: nothing else in the file should pin
    // break-inside on a bare [data-print-section] selector. If a
    // future change re-adds it we want a loud failure pointing at
    // this comment so the author thinks about page bumps before
    // shipping. We scan for the bare selector followed (in any rule
    // body, anywhere in the file) by `break-inside: avoid`.
    const bareSection = /\[data-print-section\]\s*\{[^}]*break-inside:\s*avoid/;
    expect(printCss).not.toMatch(bareSection);
  });

  it('prints coloured backgrounds with print-color-adjust: exact', () => {
    expect(printCss).toMatch(/-webkit-print-color-adjust:\s*exact/);
    expect(printCss).toMatch(/print-color-adjust:\s*exact/);
  });

  it('scopes the visibility-hide rule to html.app-chrome so Puppeteer is unaffected', () => {
    // When Puppeteer renders the server-side HTML (no app chrome, no
    // app-chrome class) these rules should NOT apply — otherwise the
    // position:absolute takes the only content out of flow and Chromium
    // produces blank pages.
    expect(printCss).toMatch(/html\.app-chrome\s+body\s*\*\s*\{[\s\S]*visibility:\s*hidden/);
    expect(printCss).toMatch(/html\.app-chrome\s+\.print-root[\s\S]*visibility:\s*visible/);
    expect(printCss).toMatch(/html\.app-chrome\s+\.print-root\s*\{[\s\S]*position:\s*absolute/);
  });

  it('the server-side path (html:not(.app-chrome)) keeps .print-root in normal flow', () => {
    expect(printCss).toMatch(/html:not\(\.app-chrome\)\s+\.print-root/);
  });

  it('index.html tags <html> with app-chrome so the scope kicks in', () => {
    expect(indexHtml).toMatch(/<html[^>]+class="[^"]*app-chrome[^"]*"/);
  });

  it('defines .print-only to hide the print clone on screen', () => {
    expect(printCss).toMatch(/\.print-only\s*\{[\s\S]*display:\s*none/);
    expect(printCss).toMatch(/@media print[\s\S]*\.print-only[\s\S]*display:\s*block/);
  });

  it('hides data-html2canvas-ignore elements in print', () => {
    expect(printCss).toMatch(/data-html2canvas-ignore="true"[\s\S]*display:\s*none/);
  });

  it('lets the photo appendix flow naturally from the cost section (TRQ-178)', () => {
    // Previously: `break-before: page` on the first photo pair forced
    // SITE PHOTOGRAPHS onto a fresh page even when half a page sat
    // empty after totals. Now the photos heading + first pair follow
    // directly. Individual photos still avoid mid-image splits.
    expect(printCss).toMatch(/\[data-print-section="photos"\]\s+\.print-photo[\s\S]*break-inside:\s*avoid/);
    // Negative: no hard page break before the photos section.
    expect(printCss).not.toMatch(/\[data-print-section="photos"\][^}]*break-before:\s*page/);
  });

  // 2026-07-20 (Mark's Juans-Building worker-copy PDF): the SITE
  // PHOTOGRAPHS heading widowed at the bottom of page 3 while the
  // photos flowed onto pages 4-5. Two fixes below prevent this class
  // of bug for the photos section AND every other section heading.
  describe('section headings never widow — 2026-07-20 fix', () => {
    it('every [data-print-section] > h2 has break-after: avoid', () => {
      // Covers Description of Damage, Measurements, Schedule of Works,
      // Cost Breakdown, Notes & Conditions. Their h2 is a direct child
      // of the [data-print-section] wrapper. Tells the layout engine
      // to keep the heading with the block that follows.
      expect(printCss).toMatch(/\[data-print-section\]\s*>\s*h2\s*\{[^}]*break-after:\s*avoid/);
      // Legacy property alias for older Chromium builds.
      expect(printCss).toMatch(/\[data-print-section\]\s*>\s*h2\s*\{[^}]*page-break-after:\s*avoid/);
    });

    it('the first [data-print-pair] in the photos section has break-inside: avoid', () => {
      // The Site Photographs h2 nests inside the first [data-print-pair]
      // — the selector above doesn't reach it. This rule groups the
      // heading with the first two photos as one atomic unit, matching
      // the intended contract documented in QuoteDocument.jsx since
      // TRQ-178.
      expect(printCss).toMatch(
        /\[data-print-section="photos"\]\s+\[data-print-pair\]:first-child\s*\{[^}]*break-inside:\s*avoid/,
      );
      expect(printCss).toMatch(
        /\[data-print-section="photos"\]\s+\[data-print-pair\]:first-child\s*\{[^}]*page-break-inside:\s*avoid/,
      );
    });

    it('subsequent [data-print-pair] elements still flow (kills 70% whitespace)', () => {
      // TRQ-178's rationale — a 5-photo appendix shouldn't strand the
      // 5th photo alone on its own page with 70% whitespace above. The
      // :first-child scope means pairs 2+ stay unconstrained; the rule
      // must NOT expand to `[data-print-pair]` alone.
      const bareRule = /\[data-print-section="photos"\]\s+\[data-print-pair\]\s*\{[^}]*break-inside:\s*avoid/;
      expect(printCss).not.toMatch(bareRule);
    });
  });

  // index.html must reference the stylesheet so the browser loads it for
  // window.print(); the server-side Puppeteer path reads the file directly.
  it('index.html links the print stylesheet', () => {
    expect(indexHtml).toMatch(/<link[^>]+href="\/print\.css"/);
  });
});
