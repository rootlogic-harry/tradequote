/**
 * RAMS header — date/phone/email line removed (Mark's 2026-09-19 WhatsApp UAT).
 *
 * Both RAMS render paths (screen/PDF via RamsDocument.jsx, and the DOCX
 * export in RamsOutput.jsx) used to print a `date | phone | email` line
 * directly under the logo. Mark flagged it as visually cluttered sitting
 * right under the logo. Removed from both; the document title
 * ("RISK ASSESSMENT & METHOD STATEMENT") stays. Contact info is still
 * covered elsewhere in the document (Organisation & Contact, Emergency
 * Contact Details sections).
 *
 * Guards against a future edit silently reintroducing profile.phone /
 * profile.email into either header block.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const ramsDocumentSrc = readFileSync(
  join(repoRoot, 'src/components/RamsDocument.jsx'), 'utf8',
);
const ramsOutputSrc = readFileSync(
  join(repoRoot, 'src/components/rams/RamsOutput.jsx'), 'utf8',
);

describe('RamsDocument.jsx (screen/PDF) — header contact line removed', () => {
  test('document title is still rendered', () => {
    expect(ramsDocumentSrc).toMatch(/RISK ASSESSMENT &amp; METHOD STATEMENT/);
  });

  test('profile.phone / profile.email are not referenced anywhere in the file', () => {
    // Both were only ever used in this one header block — a clean
    // removal means zero remaining references, not just the header
    // block specifically.
    expect(ramsDocumentSrc).not.toMatch(/profile\?\.phone/);
    expect(ramsDocumentSrc).not.toMatch(/profile\?\.email/);
  });

  test('formatDate + rams.documentDate are still used elsewhere (Document Date row)', () => {
    // The date itself isn't gone from the doc entirely — it still shows
    // in the Job Details table. Only the duplicate top-right line went.
    expect(ramsDocumentSrc).toMatch(/formatDate\(rams\.documentDate\)/);
  });
});

describe('RamsOutput.jsx (DOCX export) — header contact line removed', () => {
  test('document title paragraph is still pushed', () => {
    expect(ramsOutputSrc).toMatch(/RISK ASSESSMENT & METHOD STATEMENT/);
  });

  test('profile.phone / profile.email are not referenced anywhere in the file', () => {
    expect(ramsOutputSrc).not.toMatch(/profile\?\.phone/);
    expect(ramsOutputSrc).not.toMatch(/profile\?\.email/);
  });

  test('the header divider border moved onto the title paragraph (visual gap preserved)', () => {
    const headerStart = ramsOutputSrc.indexOf('// Header. Date/phone/email line removed');
    expect(headerStart).toBeGreaterThan(-1);
    const headerBlock = ramsOutputSrc.slice(headerStart, headerStart + 800);
    expect(headerBlock).toMatch(/RISK ASSESSMENT & METHOD STATEMENT[\s\S]*?border:\s*\{\s*bottom:/);
  });
});
