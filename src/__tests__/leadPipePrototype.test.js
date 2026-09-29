/**
 * West Yorkshire homeowner mock — guide band and the screens the
 * prototype must click through. The live landing HTML is not part
 * of this mock.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAILY_LINK_CAP,
  classifyPostcode,
  consentCopy,
  formatBand,
  guideBand,
} from '../../prototypes/lead-pipe/estimate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'prototypes/lead-pipe/index.html'), 'utf8');
const ui = readFileSync(join(root, 'prototypes/lead-pipe/prototype.js'), 'utf8');
const decisions = readFileSync(join(root, 'prototypes/lead-pipe/DECISIONS.md'), 'utf8');

describe('guide band', () => {
  test('Leeds is in West Yorkshire and Skipton, Settle and Tadcaster are not', () => {
    expect(classifyPostcode('LS6 2AB')).toMatchObject({
      valid: true,
      inWestYorkshire: true,
      outward: 'LS6',
      area: 'Leeds',
    });
    expect(classifyPostcode('BD23 1EL').inWestYorkshire).toBe(false);
    expect(classifyPostcode('BD23 1EL').area).toBe('Skipton');
    expect(classifyPostcode('BD24 9AB').inWestYorkshire).toBe(false);
    expect(classifyPostcode('LS24').inWestYorkshire).toBe(false);
    expect(classifyPostcode('HX1 1DG').inWestYorkshire).toBe(true);
    expect(classifyPostcode('not a postcode').valid).toBe(false);
  });

  test('14m at 1.2m uses the published £160–£220 per metre band', () => {
    const band = guideBand(14, 1.2);
    expect(band).toMatchObject({ low: 2240, high: 3080, perLow: 160, perHigh: 220, longWall: false });
    expect(formatBand(band)).toBe('£2,240–£3,080');
  });

  test('height scales the band and a long wall is flagged', () => {
    expect(guideBand(14, 1).perLow).toBe(133);
    expect(guideBand(14, 1.5).perLow).toBe(200);
    expect(guideBand(50, 1.2).longWall).toBe(true);
    expect(guideBand(81, 1.2)).toBeNull();
    expect(guideBand(14, 2)).toBeNull();
  });

  test('a stored link is capped separately from seeing the band', () => {
    expect(DAILY_LINK_CAP).toBe(5);
  });
});

describe('prototype screens', () => {
  test('header offers Get a quote and Waller sign in, and the live landing is untouched', () => {
    expect(html).toContain('Get a quote');
    expect(html).toContain('Waller sign in');
    expect(html).toContain('Quotes for customers');
    expect(html).not.toContain('Download PDF');
    expect(ui).toContain('Quotes for customers · Quotes for wallers');
    expect(ui).toContain('Ask a waller to quote this');
    expect(ui).toContain('A local waller has been sent this link.');
    expect(ui).toContain('We’re not matching wallers in your area yet.');
    expect(ui).toContain('That’s the limit for today. Your latest estimate is still here.');
    expect(ui).toContain('consentCopy()');
    expect(consentCopy()).toBe(
      'FastQuote may share my details with a local dry stone waller so they can contact me about this job.',
    );
    expect(ui).not.toMatch(/pdf/i);
    expect(ui).toContain('To ${escapeHtml(who)} · FastQuote account email');
    expect(ui).toContain('Contacted');
    expect(ui).toContain('Visit booked');
    expect(ui).toContain('Waller sign in');
  });
});

describe('pre-production decisions', () => {
  test('mail provider and privacy frame are chosen and not wired into the app', () => {
    expect(decisions).toMatch(/Resend/);
    expect(decisions).toMatch(/controller/i);
    expect(decisions).toMatch(/not processors/);
    expect(decisions).toMatch(/Nothing here is implemented/);
  });
});
