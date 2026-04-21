/**
 * Professional-formatting invariants for the PDF + DOCX exports.
 *
 * Mark asked for "this sort of thing never happens again" — so every
 * recurring formatting bug pattern (orphaned headers, clipped text boxes,
 * missing spacing between sections) is locked down here at the source
 * level. If a future change drifts, these tests say exactly what broke
 * and why it matters.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const printCss = readFileSync(join(repoRoot, 'public/print.css'), 'utf8');
const quoteDoc = readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8');
const quoteOutput = readFileSync(join(repoRoot, 'src/components/steps/QuoteOutput.jsx'), 'utf8');
const autoGrow = readFileSync(join(repoRoot, 'src/components/common/AutoGrowTextarea.jsx'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
// Auto-growing text areas (damage description + schedule descriptions)
// ─────────────────────────────────────────────────────────────────────────
describe('AutoGrowTextarea robustness', () => {
  it('uses native field-sizing where supported', () => {
    // CSS field-sizing: content is the zero-JS path for Chrome 123+, Safari 18+.
    expect(autoGrow).toMatch(/fieldSizing:\s*['"]content['"]/);
  });

  it('has a synchronous useLayoutEffect measurement on value changes', () => {
    expect(autoGrow).toMatch(/useLayoutEffect/);
  });

  it('retries the measurement via requestAnimationFrame', () => {
    // Catches browsers that delay layout after height="auto"; without this
    // the synchronous scrollHeight read is stale and the box stays at
    // minHeight even when the value is long.
    expect(autoGrow).toMatch(/requestAnimationFrame\(resize\)/);
  });

  it('uses a ResizeObserver to catch parent visibility changes', () => {
    // The textarea is mounted inside both the desktop grid and the mobile
    // accordion. When the hidden one becomes visible (responsive breakpoint
    // change, accordion expand) scrollHeight finally reports the real
    // content height and we must re-measure.
    expect(autoGrow).toMatch(/new ResizeObserver/);
  });

  it('skips measurement when clientWidth is 0 so it never overwrites a good height with a stale 0', () => {
    expect(autoGrow).toMatch(/clientWidth\s*===\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Printed-PDF photo appendix — header must not orphan to its own page
// ─────────────────────────────────────────────────────────────────────────
describe('Site Photographs print layout', () => {
  it('the section header is rendered inside the first data-print-pair', () => {
    // Keeping header + first pair in one unbreakable block is what prevents
    // Chrome's print engine from leaving "SITE PHOTOGRAPHS" alone on one
    // page and pushing the photos to the next.
    const block = quoteDoc.match(/data-print-section="photos"[\s\S]*?data-print-pair[\s\S]*?Site Photographs/);
    expect(block).not.toBeNull();
  });

  it('break-before: page is scoped to the FIRST pair, not the section wrapper', () => {
    // If the section wrapper carries break-before:page the header lands on
    // a new page alone when the first pair doesn't fit in remaining space.
    // Scoping to :first-child keeps the header WITH its photos.
    expect(printCss).toMatch(/\[data-print-section="photos"\]\s*>\s*\[data-print-pair\]:first-child\s*\{[\s\S]*break-before:\s*page/);
  });

  it('printed photos are height-capped so 2 + header fit on one page', () => {
    expect(printCss).toMatch(/\.print-photo img[\s\S]*max-height:\s*\d+mm/);
  });

  it('each data-print-pair has break-inside: avoid', () => {
    expect(printCss).toMatch(/\[data-print-pair\][\s\S]*break-inside:\s*avoid/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DOCX section spacing — Pages collapses shading-adjacent gaps
// ─────────────────────────────────────────────────────────────────────────
describe('DOCX section spacing', () => {
  it('inserts an explicit spacer paragraph between the quote-ref shaded block and DESCRIPTION OF DAMAGE', () => {
    // Pages.app visually collapses paragraph-after spacing when the
    // preceding paragraph has shading. An empty <Paragraph> forces the gap.
    const block = quoteOutput.match(/shading:\s*\{\s*fill:\s*['"]F5F5F5['"][\s\S]*?DESCRIPTION OF DAMAGE/);
    expect(block).not.toBeNull();
    // Between the shaded ref and the next heading there must be a spacer
    // paragraph with children: []
    expect(block[0]).toMatch(/new Paragraph\(\{\s*children:\s*\[\]\s*,\s*spacing/);
  });
});
