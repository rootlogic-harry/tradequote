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

});
