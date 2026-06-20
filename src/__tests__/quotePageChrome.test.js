/**
 * quotePageChrome (TRQ-169) — verify the page header/footer builders
 * Mark's reference PDF carries on every page.
 */
import {
  buildPageChromeText,
  buildPdfHeaderHtml,
  buildPdfFooterHtml,
} from '../utils/quotePageChrome.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('buildPageChromeText', () => {
  test('formats date as "29th April 2026" via formatDate', () => {
    const out = buildPageChromeText({
      profile: { email: 'mark@x.com', phone: '07986 661828' },
      jobDetails: { quoteDate: '2026-04-29' },
    });
    expect(out.dateText).toBe('29th April 2026');
    expect(out.email).toBe('mark@x.com');
    expect(out.phone).toBe('07986 661828');
  });

  test('reads VAT number + trading address from profile', () => {
    const out = buildPageChromeText({
      profile: {
        tradingAddress: 'Upper Lane House, 22 Upper Lane, Halifax HX3 7EE',
        vatNumber: 'GB 437 9344 64',
      },
    });
    expect(out.tradingAddress).toBe('Upper Lane House, 22 Upper Lane, Halifax HX3 7EE');
    expect(out.vatNumber).toBe('GB 437 9344 64');
  });

  test('falls back to profile.address when tradingAddress missing', () => {
    const out = buildPageChromeText({ profile: { address: '22 Upper Lane' } });
    expect(out.tradingAddress).toBe('22 Upper Lane');
  });

  test('handles empty / missing inputs without crashing', () => {
    const out = buildPageChromeText();
    expect(out).toEqual({
      dateText: '',
      email: '',
      phone: '',
      tradingAddress: '',
      vatNumber: '',
    });
  });
});

describe('buildPdfHeaderHtml (TRQ-178: per-page header retired)', () => {
  // Mark (June 2026): the per-page header strip (date · email · phone)
  // duplicated the trader card already in QuoteDocument's hero on page 1
  // and felt "templatey" on multi-page quotes. The footer (address +
  // VAT) is the only page chrome that earns its place. buildPdfHeaderHtml
  // now ALWAYS returns '' — the function is kept so legacy call sites
  // don't break, but Puppeteer's headerTemplate stays effectively empty.
  test('returns empty string regardless of inputs', () => {
    expect(buildPdfHeaderHtml({
      dateText: '29th April 2026',
      email: 'mark@x.com',
      phone: '07986 661828',
    })).toBe('');
  });

  test('returns empty string for blank inputs', () => {
    expect(buildPdfHeaderHtml({})).toBe('');
    expect(buildPdfHeaderHtml({ dateText: '', email: '', phone: '' })).toBe('');
    expect(buildPdfHeaderHtml()).toBe('');
  });

  test('cannot leak HTML — empty string regardless of payload', () => {
    // The XSS / sanitisation defence is moot now (empty output) but
    // the assertion is preserved to lock the behaviour in: if a
    // future change brings the header back, this test will catch it
    // and the author will be reminded to re-apply escapeHtml.
    expect(buildPdfHeaderHtml({
      email: '<script>alert(1)</script>',
      phone: 'a&b',
      dateText: '"foo"',
    })).toBe('');
  });
});

describe('buildPdfFooterHtml', () => {
  test('renders address  ·  VAT number', () => {
    const html = buildPdfFooterHtml({
      tradingAddress: 'Upper Lane House, 22 Upper Lane, Halifax HX3 7EE',
      vatNumber: 'GB 437 9344 64',
    });
    expect(html).toMatch(/Upper Lane House, 22 Upper Lane, Halifax HX3 7EE/);
    // TRQ-176: standardised on "VAT No:" everywhere (matches DOCX +
    // Mark's preferred wording). Was "VAT number:".
    expect(html).toMatch(/VAT No: GB 437 9344 64/);
    expect(html).toMatch(/text-align:center/);
  });

  test('renders address only when no VAT', () => {
    const html = buildPdfFooterHtml({ tradingAddress: '22 Upper Lane' });
    expect(html).toMatch(/22 Upper Lane/);
    expect(html).not.toMatch(/VAT number/);
  });

  test('returns empty string when nothing to render', () => {
    expect(buildPdfFooterHtml({})).toBe('');
  });
});

// Source-level wiring: the puppeteer caller and the DOCX builder both
// have to use the new chrome data so a future regression doesn't drop
// the headers/footers Mark relies on.
describe('quotePageChrome wiring', () => {
  // TRQ-118: DOCX/PDF bodies extracted from QuoteOutput.jsx into
  // exportDocx.js / exportPdf.js. Read all three so the chrome
  // assertions catch the right code regardless of where it lives.
  const quoteOutputSrc =
    readFileSync(join(__dirname, '../components/steps/QuoteOutput.jsx'), 'utf8') +
    '\n' +
    readFileSync(join(__dirname, '../utils/exportDocx.js'), 'utf8') +
    '\n' +
    readFileSync(join(__dirname, '../utils/exportPdf.js'), 'utf8');
  const pdfRendererSrc = readFileSync(
    join(__dirname, '../../pdfRenderer.js'), 'utf8'
  );

  test('handleDownloadPdfServer passes headerHtml + footerHtml to the /pdf route', () => {
    const idx = quoteOutputSrc.indexOf('handleDownloadPdfServer = async');
    expect(idx).toBeGreaterThan(-1);
    const slice = quoteOutputSrc.slice(idx, idx + 3000);
    expect(slice).toMatch(/buildPageChromeText/);
    expect(slice).toMatch(/buildPdfHeaderHtml/);
    expect(slice).toMatch(/buildPdfFooterHtml/);
    // Body includes the header + footer fields.
    expect(slice).toMatch(/headerHtml,\s*footerHtml/);
  });

  test('Send via Outlook handler also passes header + footer (PDF attachment matches)', () => {
    const idx = quoteOutputSrc.indexOf('handleSendViaOutlook = async');
    expect(idx).toBeGreaterThan(-1);
    const slice = quoteOutputSrc.slice(idx, idx + 6000);
    expect(slice).toMatch(/buildPdfHeaderHtml/);
    expect(slice).toMatch(/headerHtml,\s*footerHtml/);
  });

  test('renderQuotePdf accepts headerHtml + footerHtml and toggles displayHeaderFooter', () => {
    expect(pdfRendererSrc).toMatch(/headerHtml.*footerHtml/);
    expect(pdfRendererSrc).toMatch(/displayHeaderFooter:\s*enableHeaderFooter/);
    expect(pdfRendererSrc).toMatch(/headerTemplate/);
    expect(pdfRendererSrc).toMatch(/footerTemplate/);
  });

  test('DOCX builder constructs a Header (mirrors the existing Footer)', () => {
    // Header was missing — Mark's PDF has it on every page. Now both
    // outputs match. Accept Header anywhere in the docx import (static
    // or dynamic destructure) since TRQ-118 moved this into exportDocx.js
    // where the destructure list places Header in the middle, not at the end.
    expect(quoteOutputSrc).toMatch(
      /import[\s\S]*?Header[\s\S]*?from\s+['"]docx['"]|Header[,\s\}][\s\S]{0,300}?await import\(['"]docx['"]\)/
    );
    expect(quoteOutputSrc).toMatch(/const docHeader/);
    expect(quoteOutputSrc).toMatch(/headers:\s*\{\s*default:\s*docHeader\s*\}/);
  });
});
