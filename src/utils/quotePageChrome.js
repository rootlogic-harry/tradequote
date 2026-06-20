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
 * Build the Puppeteer headerTemplate string.
 *
 * TRQ-178: Mark's June-2026 feedback — the per-page header
 * (date · email · phone) duplicates the trader card already rendered
 * in QuoteDocument's hero (top-right of page 1, see lines 169-173 of
 * components/QuoteDocument.jsx). Repeating the same three fields on
 * every page made the document feel "templatey" rather than
 * professional, especially on multi-page quotes with photo
 * appendices. The footer (trading address + VAT) is the only
 * page chrome that earns its place — it carries a different fact
 * (the registered office + VAT registration) on every page so a
 * client reading any single page can verify the trader is real.
 *
 * Returning an empty string here means renderQuotePdf's
 * `enableHeaderFooter` check (in pdfRenderer.js) only flips on when
 * the FOOTER has content — Puppeteer's headerTemplate is then
 * effectively suppressed via the empty fallback.
 *
 * Parameters are accepted-and-ignored so existing call sites stay
 * unchanged. If a future caller wants the page header back, restore
 * the previous three-column template — but talk to Mark first.
 */
// eslint-disable-next-line no-unused-vars
export function buildPdfHeaderHtml(_parts) {
  return '';
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
