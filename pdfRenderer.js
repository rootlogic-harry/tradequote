import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the print stylesheet once at boot. Same file the browser loads at
// /print.css when users click "Save as PDF" — single source of truth.
const PRINT_CSS = fs.readFileSync(path.join(__dirname, 'public/print.css'), 'utf8');

// Fonts used in the quote. Loaded from Google Fonts inside the headless
// browser so text is crisp + selectable. If Railway ever loses outbound
// HTTPS to Google, we'd swap this for self-hosted @font-face files under
// public/fonts/.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Barlow+Condensed:wght@400;600;700;800' +
  '&family=Inter:wght@400;500;600' +
  '&family=JetBrains+Mono:wght@400;500' +
  '&display=swap';

// Persistent browser singleton. First request pays the launch cost (~1-2s);
// every subsequent request reuses it. Concurrency is bounded by newPage().
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // Chromium can crash or be disconnected; check and recreate.
      if (b && b.connected !== false) return b;
    } catch {
      // fall through and re-launch
    }
  }

  const launchStart = Date.now();
  try {
    const execPath = await chromium.executablePath();
    console.log(`[PDF] launching Chromium at ${execPath}`);
    browserPromise = puppeteer.launch({
      args: chromium.args,
      executablePath: execPath,
      headless: chromium.headless,
    });
    const browser = await browserPromise;
    console.log(`[PDF] Chromium launched in ${Date.now() - launchStart}ms`);

    browser.on('disconnected', () => {
      console.warn('[PDF] Chromium disconnected; will relaunch on next request');
      browserPromise = null;
    });

    return browser;
  } catch (err) {
    console.error(`[PDF] Chromium launch failed after ${Date.now() - launchStart}ms:`, err);
    browserPromise = null;
    throw err;
  }
}

/**
 * Render a quote's pre-rendered HTML (from react-dom/server.renderToStaticMarkup)
 * into a native A4 PDF with reliable page breaks driven by public/print.css.
 *
 * @param {object} opts
 * @param {string} opts.quoteHtml - the <QuoteDocument /> markup as a string
 * @param {string} [opts.title] - used as the PDF's document title
 * @returns {Promise<Buffer>} the PDF as a binary buffer
 */
export async function renderQuotePdf({ quoteHtml, title = 'Quote' }) {
  if (typeof quoteHtml !== 'string' || quoteHtml.length === 0) {
    throw new Error('renderQuotePdf: quoteHtml is required');
  }

  const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <link href="${FONTS_HREF}" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="print-root">${quoteHtml}</div>
</body>
</html>`;

  const renderStart = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // networkidle0 waits for Tailwind + fonts to load
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    // Force print CSS to apply inside Chromium's PDF engine
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
    });
    console.log(`[PDF] rendered ${pdf.length} bytes in ${Date.now() - renderStart}ms`);
    return pdf;
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Expose for tests / health-checks if ever needed
export const __internal = { getBrowser };
