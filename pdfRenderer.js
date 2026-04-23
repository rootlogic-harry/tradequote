import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sanitizeHtml from 'sanitize-html';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── SSRF defence (sec-audit C-2) ─────────────────────────────────────
//
// The PDF endpoint accepts user-supplied HTML (`quoteHtml`). Without
// the defences below, an authenticated attacker could:
//   - probe Railway's internal network via <iframe>, <img>, <link>
//   - hit cloud metadata services (169.254.169.254)
//   - exfiltrate via inline <script> + fetch()
//   - execute arbitrary JS in our long-lived Chromium
//
// Three layers, deepest first:
//   1. Sanitise HTML with a strict allowlist (drop scripts, iframes,
//      objects, embeds, event handlers, javascript: / non-image data:
//      URLs, and any URL whose host isn't in REQUEST_ALLOWLIST).
//   2. Disable JavaScript in the rendering page entirely.
//   3. Intercept every Chromium request and abort anything not in
//      REQUEST_ALLOWLIST. This catches anything that slipped past
//      sanitisation (e.g. a CSS import or @font-face url()).
//
// The QuoteDocument component never emits scripts, iframes, or
// off-allowlist URLs, so legitimate renders are unaffected.

// Hosts allowed at network level. Fonts come from Google; the print
// stylesheet ships inline. Tailwind CDN is allowlisted because we
// load it in the boilerplate; if we ever self-host Tailwind we should
// drop it from this list.
const REQUEST_ALLOWLIST = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com',
]);

const SANITIZE_OPTIONS = {
  // Inherit sanitize-html's default tag list (text + table + image)
  // and explicitly add the few extras QuoteDocument uses. Anything
  // not listed here is stripped — including <script>, <iframe>,
  // <object>, <embed>, <link>, <meta>, <base>, <form>, <input>.
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img', 'figure', 'figcaption', 'svg', 'path', 'g',
    'span', 'small', 'section', 'article', 'header', 'footer', 'main',
    'div', 'style',  // <style> needed for Tailwind's emitted classes
  ],
  // Allow class + style + a curated attribute set on every tag, plus
  // the standard ones for img/a. NEVER allow on*= handlers.
  allowedAttributes: {
    '*': ['class', 'style', 'id', 'data-*', 'aria-*', 'role', 'lang', 'dir'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    a: ['href', 'target', 'rel'],
    svg: ['viewbox', 'xmlns', 'fill', 'stroke', 'width', 'height'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
  },
  // Schemes allowed in href/src. data: kept ONLY for images so the
  // photo appendix base64 thumbnails work.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  // Drop the contents (not just the tags) of these — leaving the
  // text inside a <script> would still be a footgun.
  nonTextTags: ['script', 'style', 'noscript', 'textarea', 'option', 'iframe', 'object', 'embed', 'form'],
  // Treat unknown attributes (especially on* handlers) as droppable.
  // sanitize-html does this by default; explicit for documentation.
  allowVulnerableTags: false,
  // Filter URLs at the schema level too — block any host not in the
  // allowlist. A URL that survives this is still subject to network
  // interception (defence in depth).
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.href && !isAllowedHref(attribs.href)) {
        delete attribs.href;
      }
      if (attribs.target === '_blank' && !attribs.rel) {
        attribs.rel = 'noopener noreferrer';
      }
      return { tagName, attribs };
    },
    img: (tagName, attribs) => {
      if (attribs.src && !isAllowedSrc(attribs.src)) {
        delete attribs.src;
      }
      return { tagName, attribs };
    },
  },
};

function isAllowedHref(href) {
  // mailto:/tel:/relative paths are fine; for absolute URLs check host.
  if (/^(mailto|tel):/i.test(href)) return true;
  if (href.startsWith('/') || href.startsWith('#')) return true;
  try {
    const u = new URL(href);
    return REQUEST_ALLOWLIST.has(u.hostname);
  } catch {
    return false;
  }
}

function isAllowedSrc(src) {
  // data:image/...;base64,... is OK (used for inlined photos).
  if (/^data:image\//i.test(src)) return true;
  if (src.startsWith('/') || src.startsWith('#')) return true;
  try {
    const u = new URL(src);
    return REQUEST_ALLOWLIST.has(u.hostname);
  } catch {
    return false;
  }
}

export function sanitiseQuoteHtml(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);
}

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

  // Layer 1 — sanitise. Strips scripts, iframes, event handlers, and
  // off-allowlist URLs. See SANITIZE_OPTIONS at the top of this file.
  const safeQuoteHtml = sanitiseQuoteHtml(quoteHtml);

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
  <div class="print-root">${safeQuoteHtml}</div>
</body>
</html>`;

  const renderStart = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Layer 2 — disable JS in the rendering page. The QuoteDocument
    // is purely declarative HTML/CSS; nothing here needs to execute.
    // Without this, even sanitised HTML could be vulnerable to a
    // future bypass that smuggles a script in via a CSS expression
    // or attribute trick.
    await page.setJavaScriptEnabled(false);

    // Layer 3 — block every Chromium request whose host isn't in the
    // allowlist. Catches off-allowlist URLs that survived sanitisation
    // (e.g. inside a CSS @import or @font-face url()).
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:')) return req.continue();
      try {
        const host = new URL(url).hostname;
        if (REQUEST_ALLOWLIST.has(host)) return req.continue();
      } catch {
        // Malformed URL — block.
      }
      console.warn(`[PDF] blocked off-allowlist request: ${url.slice(0, 200)}`);
      req.abort('blockedbyclient');
    });

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
