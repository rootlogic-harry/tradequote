/**
 * Page header/footer for the quote PDF (TRQ-169).
 *
 * Mark's hand-laid reference PDF is the visual standard: every page
 * carries a header line (date · email · phone) and a footer line
 * (trading address + VAT number). Both render paths use the same
 * markers so they stay in lockstep:
 *
 *   - PDF: Puppeteer's `headerTemplate` / `footerTemplate` strings
 *     in pdfRenderer.js. Templates are rendered without inheriting
 *     page CSS, so styling MUST be inline.
 *   - DOCX: docx.js Header / Footer objects in QuoteOutput.jsx. The
 *     plain-text shape is what's needed there; this module only
 *     supplies the strings.
 *
 * The PDF builders are isolated tags so a future renderer (HTML
 * email, etc.) can compose the same data differently.
 */
import { formatDate } from './quoteBuilder.js';

/**
 * Produce the plain-text pieces that make up the page header/footer.
 * Returns nullable strings so callers can decide what to render when
 * a field is missing (Paul's profile, for instance, may not have a
 * VAT number — that's fine, omit the trailing segment).
 */
export function buildPageChromeText({ profile = {}, jobDetails = {} } = {}) {
  const dateText = jobDetails.quoteDate ? formatDate(jobDetails.quoteDate) : '';
  const email = (profile.email || '').trim();
  const phone = (profile.phone || '').trim();

  const tradingAddress = (profile.tradingAddress || profile.address || '').trim();
  const vatNumber = (profile.vatNumber || '').trim();

  return { dateText, email, phone, tradingAddress, vatNumber };
}

/**
 * Build the Puppeteer headerTemplate string. Renders three columns
 * (date · email · phone) justified across the page. Inline styles
 * because Puppeteer header templates do not inherit page CSS.
 */
export function buildPdfHeaderHtml(parts) {
  const { dateText, email, phone } = parts || {};
  if (!dateText && !email && !phone) return '';
  const cell = (text) =>
    `<span style="flex:1;text-align:center;">${escapeHtml(text || '')}</span>`;
  return (
    `<div style="width:100%;padding:0 18mm;font-family:Inter,Arial,sans-serif;` +
    `font-size:9pt;color:#444;display:flex;justify-content:space-between;` +
    `align-items:center;">` +
    `<span style="flex:1;text-align:left;">${escapeHtml(dateText || '')}</span>` +
    cell(email) +
    `<span style="flex:1;text-align:right;">${escapeHtml(phone || '')}</span>` +
    `</div>`
  );
}

/**
 * Build the Puppeteer footerTemplate string. Single line, centred:
 * `<address>  ·  VAT No: <number>`. If neither is present, returns
 * an empty string (caller should fall back to no footer).
 *
 * TRQ-176: Mark's feedback — drop companyName (it's already in the
 * header), use "VAT No:" not "VAT number:", switch to near-black so
 * the line is actually readable on his iPad. Applied to all users,
 * not Mark-specific.
 */
export function buildPdfFooterHtml(parts) {
  const { tradingAddress, vatNumber } = parts || {};
  if (!tradingAddress && !vatNumber) return '';
  const segments = [];
  if (tradingAddress) segments.push(escapeHtml(tradingAddress));
  if (vatNumber) segments.push('VAT No: ' + escapeHtml(vatNumber));
  return (
    `<div style="width:100%;padding:0 18mm;font-family:Inter,Arial,sans-serif;` +
    `font-size:9pt;color:#222;text-align:center;">` +
    segments.join('  ·  ') +
    `</div>`
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
