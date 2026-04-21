import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');
const quoteOutputJsx = readFileSync(
  join(srcDir, 'components/steps/QuoteOutput.jsx'),
  'utf8'
);
const ramsOutputJsx = readFileSync(
  join(srcDir, 'components/rams/RamsOutput.jsx'),
  'utf8'
);

// TRQ-122: client-facing quote filenames were formatted
//   "Quote-QT-2026-0004-Jordan-Fleet.pdf"
// which reads to the end customer as an auto-generated reference code.
// Mark asked for a more natural filename. We swap to
//   "Quote - Jordan Fleet (QT-2026-0004).pdf"
// — client name first so attachments sort alphabetically by client, and the
// quote reference moves to parens so it's still present but not dominant.
describe('Quote filename format (TRQ-122)', () => {
  it('uses "Quote - {clientName} ({quoteReference})" format for PDF server export', () => {
    expect(quoteOutputJsx).toMatch(/Quote - \$\{(?:safeClient|clientName)\}[\s\S]{0,40}\$\{[^}]*quoteReference[^}]*\}/);
  });

  it('uses "Quote - {clientName} ({quoteReference})" format for legacy PDF export', () => {
    // Legacy html2canvas path — pdf.save call
    expect(quoteOutputJsx).toMatch(/pdf\.save\(`Quote - \$\{/);
  });

  it('uses "Quote - {clientName} ({quoteReference})" format for DOCX export', () => {
    expect(quoteOutputJsx).toMatch(/const filename = `Quote - /);
  });

  it('no longer uses the old dashed reference-first pattern', () => {
    expect(quoteOutputJsx).not.toMatch(/`Quote-\$\{[^}]*quoteReference[^}]*\}-\$\{clientClean\}\.pdf`/);
    expect(quoteOutputJsx).not.toMatch(/`Quote-\$\{[^}]*quoteReference[^}]*\}-\$\{clientClean\}\.docx`/);
  });

  it('only strips filesystem-illegal characters from client name (keeps spaces, apostrophes)', () => {
    // The old sanitiser was `.replace(/[^a-zA-Z0-9]/g, '-')` — too aggressive.
    // We now want to preserve spaces, apostrophes, hyphens; only strip the
    // Windows/macOS-illegal set.
    expect(quoteOutputJsx).toMatch(/replace\(\/\[<>:"\/\\\\\|\?\*\]/);
  });
});

describe('RAMS filename format (TRQ-122)', () => {
  it('uses "RAMS - {clientName} (Job {jobNumber})" format for PDF + DOCX', () => {
    expect(ramsOutputJsx).toMatch(/`RAMS - \$\{/);
  });

  it('no longer uses the old dashed job-number-first pattern', () => {
    expect(ramsOutputJsx).not.toMatch(/`RAMS-\$\{[^}]*jobNumber[^}]*\}-\$\{clientClean\}\.pdf`/);
  });
});
