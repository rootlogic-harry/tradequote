/**
 * Cross-surface field parity — QuoteDocument.jsx ↔ portalRenderer.js
 *
 * The frozen-at-send-time snapshot contract (docs/CLIENTS_SPEC_v3.md
 * §6) makes the client portal's JSONB copy of `quote_snapshot` +
 * `profile` LOAD-BEARING for the customer view. But nothing today
 * asserts that every field the tradesman's PDF shows also lands on
 * the customer's portal. Mark's 2026-07-14 UAT surfaced this: the
 * trading address + VAT number were on the DOCX + server PDF footers
 * but silently missing from the portal (and, transitively, from the
 * portal's "Save as PDF" browser-print export).
 *
 * This suite pins the compliance-critical fields — the ones a UK
 * VAT-registered trader must show on any quote-shaped surface — as
 * BOTH-OR-NEITHER assertions across the three render paths.
 *
 * Scope note: this is not a full field-parity matrix. The portal is
 * a summarised view of the tradesman's document by design (no
 * measurements section, no unit-rate column, no photos). We only
 * pin the fields where "on the PDF but not the portal" is a
 * customer-facing bug rather than a design call.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const quoteDocSrc = readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8');
const portalSrc = readFileSync(join(repoRoot, 'portalRenderer.js'), 'utf8');
const docxSrc = readFileSync(join(repoRoot, 'src/utils/exportDocx.js'), 'utf8');
const chromeSrc = readFileSync(join(repoRoot, 'src/utils/quotePageChrome.js'), 'utf8');

// Every source that renders a customer-facing "quote-shaped" surface.
// If any of these stops reading a compliance-critical field, this
// suite flags it before the client sees the mismatch.
const SURFACES = [
  { name: 'QuoteDocument.jsx (tradesman PDF/DOCX preview + Puppeteer render)', src: quoteDocSrc },
  { name: 'portalRenderer.js (client portal + Save-as-PDF window.print)',       src: portalSrc },
  { name: 'exportDocx.js (Word document)',                                       src: docxSrc },
  { name: 'quotePageChrome.js (Puppeteer per-page footer template)',             src: chromeSrc },
];

describe('compliance chrome — trading address + VAT number', () => {
  test.each(SURFACES)(
    '$name reads the trading address (with profile.address fallback)',
    ({ src }) => {
      // Every surface must consult BOTH `tradingAddress` and `address`
      // so a profile with only one populated (Mark's real shape — only
      // `address` is set) still renders the footer line.
      expect(src).toMatch(/tradingAddress/);
      expect(src).toMatch(/\baddress\b/);
    },
  );

  test.each(SURFACES)('$name reads the VAT number', ({ src }) => {
    expect(src).toMatch(/vatNumber/);
  });

  // Every surface that decides FOR ITSELF whether to render the VAT
  // line must do a strict boolean check. quotePageChrome.js is
  // excluded — it consumes already-resolved parts from its caller, so
  // the caller owns the gate.
  const GATED_SURFACES = SURFACES.filter(
    (s) => !s.name.includes('quotePageChrome.js'),
  );

  test.each(GATED_SURFACES)(
    '$name gates the VAT line on a STRICT boolean vatRegistered check',
    ({ src }) => {
      // Fail-closed. String "true" / 1 / objects must NOT flip VAT on
      // — that was Paul's regression in the React render paths
      // (TRQ-127, Pitfall #17 in CLAUDE.md). The strict === true or a
      // dedicated isVatRegistered helper are both acceptable.
      const gates = src.match(/vatRegistered\s*===\s*true|isVatRegistered\s*\(/g) || [];
      expect(gates.length).toBeGreaterThan(0);
    },
  );

  test('portal footer line uses the same " · " separator as the DOCX footer', () => {
    // Small visual continuity check — the same profile should render
    // the same footer text across surfaces. If someone changes the
    // separator on one, this catches the drift.
    const dot = / · /;
    expect(portalSrc).toMatch(dot);
    expect(quoteDocSrc).toMatch(dot);
    expect(chromeSrc).toMatch(dot);
  });

  test('portal footer emits the "VAT No: " label used by every other surface', () => {
    // The UK-convention label. Consistency across surfaces means a
    // client verifying the number across their DOCX copy and the
    // portal sees the same string.
    for (const { name, src } of SURFACES) {
      expect(src).toMatch(/VAT No:/);
    }
  });
});
