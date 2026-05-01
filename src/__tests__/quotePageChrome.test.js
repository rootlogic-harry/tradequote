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

describe('buildPdfHeaderHtml', () => {
  test('renders three columns (date / email / phone) flex-justified', () => {
    const html = buildPdfHeaderHtml({
      dateText: '29th April 2026',
      email: 'mark@x.com',
      phone: '07986 661828',
    });
    expect(html).toMatch(/29th April 2026/);
    expect(html).toMatch(/mark@x\.com/);
    expect(html).toMatch(/07986 661828/);
    // Three flex columns + space-between justification
    expect(html).toMatch(/justify-content:space-between/);
    expect(html).toMatch(/flex:1/);
    // Inline styling — Puppeteer header templates do NOT inherit page CSS.
    expect(html).toMatch(/font-size:9pt/);
  });

  test('returns empty string when nothing to render', () => {
    expect(buildPdfHeaderHtml({})).toBe('');
    expect(buildPdfHeaderHtml({ dateText: '', email: '', phone: '' })).toBe('');
  });

  test('escapes HTML in user-supplied fields', () => {
    const html = buildPdfHeaderHtml({
      email: '<script>alert(1)</script>',
      phone: 'a&b',
      dateText: '"foo"',
    });
    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(html).toMatch(/a&amp;b/);
    expect(html).toMatch(/&quot;foo&quot;/);
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
  const quoteOutputSrc = readFileSync(
    join(__dirname, '../components/steps/QuoteOutput.jsx'), 'utf8'
  );
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
    // outputs match.
    expect(quoteOutputSrc).toMatch(/import.*Header.*from\s+['"]docx['"]|Header\s*\}\s*=\s*await import\(['"]docx['"]\)/);
    expect(quoteOutputSrc).toMatch(/const docHeader/);
    expect(quoteOutputSrc).toMatch(/headers:\s*\{\s*default:\s*docHeader\s*\}/);
  });
});
