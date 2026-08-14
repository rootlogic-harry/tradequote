/**
 * MaterialsTable — addMaterial default-quantity fix (Mark's 2026-08-12 UAT).
 *
 * Bug: clicking "+ Add material" then filling only description + Rate £
 * (a lump-sum item pattern — "Pointing mortar" @ £50, "Skip hire" @ £180)
 * produced a row with totalCost = 0. Downstream renderers
 * (QuoteDocument.jsx:101, exportDocx.js:320, portalRenderer.js:221)
 * filter on `description.trim() && totalCost > 0`, so the row silently
 * vanished from the printed / PDF / client-portal cost breakdown.
 * From Mark's side that read as "cant add extra materials, doesn't
 * apply to the cost column".
 *
 * Fix: seed new materials with quantity=1 (not empty). Then
 * updateMaterial's totalCost = qty × unitCost picks up the rate the
 * moment the tradesman types it, and the row renders. Multi-quantity
 * items are unaffected — the waller types over the 1 with the real
 * number.
 *
 * Source-level test (no JSDOM) — matches the pattern in
 * dashboard.test.js / savedQuotes.test.js. The behavioural side of
 * the calculation (totalCost = qty × unitCost) is already covered by
 * calculations.test.js — this file pins the ADD default so a future
 * refactor can't quietly revert to `quantity: ''`.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, '../components/review/MaterialsTable.jsx'),
  'utf8',
);

describe('MaterialsTable addMaterial default (Mark\'s 2026-08-12 UAT)', () => {
  it('seeds new material rows with quantity=1 (not empty)', () => {
    // Anchor on the addMaterial function body. The literal seed object
    // must include `quantity: 1`. Any refactor that switches back to
    // `quantity: ''` or `quantity: 0` re-introduces the invisible-row
    // bug for lump-sum items.
    const start = src.indexOf('const addMaterial =');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);

    expect(body).toMatch(/quantity:\s*1[,\s]/);
    // Guard against the two ways this could silently regress:
    expect(body).not.toMatch(/quantity:\s*['"]['"][,\s]/);  // empty string
    expect(body).not.toMatch(/quantity:\s*0[,\s]/);          // literal zero
  });

  it('keeps the seed unit as "Item" so lump-sum items read naturally', () => {
    // "1 Item × £50 = £50" reads correctly on the printed quote.
    // Any refactor that flips the default unit (e.g. to "t" or "m²")
    // would make a bare lump-sum row look wrong in the cost breakdown.
    const start = src.indexOf('const addMaterial =');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/unit:\s*['"]Item['"]/);
  });

  it('preserves the rationale comment so future edits see the WhatsApp trigger', () => {
    // The comment above the seed object explains WHY quantity is 1
    // (WhatsApp 2026-08-12) and points at the three downstream
    // filters. Without it, a "clean-up unused default" refactor could
    // silently break the fix. Guard the comment stays.
    const start = src.indexOf('const addMaterial =');
    const end = src.indexOf('};', start);
    const body = src.slice(start, end);
    expect(body).toMatch(/lump-sum/i);
    expect(body).toMatch(/2026-08-12/);
  });
});
