import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('ReviewEdit desktop layout', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/steps/ReviewEdit.jsx'), 'utf8');
  });

  // Prior layout tried to cram three columns into the max-w-5xl main container
  // (~992px usable width). At laptop widths each column ended up 280-360px, which
  // wrecked the horizontal-flex measurement cards, truncated materials table rows,
  // and broke schedule step titles across 3-4 lines. The fix is a 2-column layout
  // with Schedule of Works stacked under Measurements.
  it('desktop grid uses two columns, not three', () => {
    const gridMatch = source.match(/gridTemplateColumns:\s*['"]([^'"]+)['"]/);
    expect(gridMatch).not.toBeNull();
    const cols = gridMatch[1].trim().split(/\s+/);
    expect(cols.length).toBe(2);
  });

  it('costs column is wider than the measurements column', () => {
    const gridMatch = source.match(/gridTemplateColumns:\s*['"]([^'"]+)['"]/);
    const [leftFr, rightFr] = gridMatch[1].trim().split(/\s+/).map(s => parseFloat(s));
    expect(rightFr).toBeGreaterThan(leftFr);
  });

  it('schedule of works is rendered in the left column alongside measurements', () => {
    // The left column <div className="space-y-6"> must contain scheduleContent
    const leftColumnMatch = source.match(
      /<div className="space-y-6">\s*\{transcriptContent\}\{damageDescriptionContent\}\{measurementsContent\}\{scheduleContent\}\s*<\/div>/
    );
    expect(leftColumnMatch).not.toBeNull();
  });

  it('mobile accordion still renders schedule section (not lost by layout change)', () => {
    expect(source).toMatch(/title="Schedule of Works"/);
  });
});
