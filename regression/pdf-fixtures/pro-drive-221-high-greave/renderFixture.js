/**
 * Render the Pro Drive PDF fixture through the live pipeline.
 *
 * Used by:
 *   - The TRQ-178 regression test (src/__tests__/proDrivePdfRegression.test.js)
 *     which calls `renderFixturePdf()` and asserts page count + footer-shape.
 *   - Manual re-baselining: `node regression/pdf-fixtures/pro-drive-221-high-greave/renderFixture.js`
 *     writes a fresh after-fix.pdf into the fixture directory.
 *
 * The fixture's input.json carries a sanitised version of Mark's quote
 * (every PII field is `[redacted-*]`). Photos in the input are
 * placeholders only — we synthesise simple coloured PNG data URLs at
 * render time so the photo appendix layout is exercised without
 * committing image binaries.
 *
 * QuoteDocument is a JSX component and node can't import JSX directly;
 * we bundle it on the fly via esbuild (already a dev-dep transitive of
 * vite) into a temp ESM file, then import that. Same trick scripts/
 * build-pdf-css.js uses for QuoteDocument scanning.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { normalisePdfMetadata } from '../../../src/utils/normalisePdfMetadata.js';

// Local-Chrome override. @sparticuz/chromium ships a Linux-only
// serverless binary; on macOS it extracts an ELF and spawn ENOEXECs.
// For local re-baselining we fall back to a system Chrome install.
// This is opt-out: set FASTQUOTE_LOCAL_CHROME=0 to force the @sparticuz
// path (e.g. on CI where Linux Chromium is the right binary).
const LOCAL_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
function findLocalChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.FASTQUOTE_LOCAL_CHROME === '0') return null;
  if (process.platform !== 'darwin' && process.platform !== 'linux') return null;
  for (const c of LOCAL_CHROME_CANDIDATES) {
    if (existsSync(c)) return c;
  }
  return null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

// Deterministic placeholder photos sized to match real-quote dimensions
// so the photo appendix layout (max-height caps in print.css) is
// exercised correctly. A 1×1 transparent PNG would lay out as zero-
// height even with width:100%, collapsing the photo grid to blank
// space and producing misleading page counts.
//
// SVG with explicit width/height is the lightweight way to get an
// img element that takes its declared intrinsic dimensions. We use
// 800×1100 for portrait (≈ 4:5.5 ≈ Mark's iPhone shots) and 1600×1200
// for landscape (4:3 = Street View / older camera). The values match
// the aspect bands in src/utils/photoLayout.js so QuoteDocument
// emits the right data-orientation.
function placeholderPhotoDataUrl(orientation) {
  const isPortrait = orientation === 'portrait';
  const w = isPortrait ? 800 : 1600;
  const h = isPortrait ? 1100 : 1200;
  // Two-tone SVG so the photo edges are visible if eyeballing the PDF.
  // base64 keeps the data URL small (~200 bytes) and stable across
  // platforms — important for byte-comparable regression renders.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#cbd5e1"/><rect x="0" y="${h * 0.65}" width="${w}" height="${h * 0.35}" fill="#94a3b8"/></svg>`;
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

// Compile QuoteDocument.jsx (and any JSX it pulls in transitively)
// into a single ESM module bundle and write it to a temp file.
// External: react / react-dom so we share the loaded React instance.
async function loadQuoteDocument() {
  // Write the bundle inside REPO_ROOT (under a hidden cache dir) so
  // node's resolver can still find the workspace's react package.
  // node_modules resolution walks up from the file's directory; a
  // /tmp file has no node_modules above it and would ERR_MODULE_NOT_FOUND.
  const cacheDir = mkdtempSync(join(REPO_ROOT, '.pdf-fixture-cache-'));
  const outFile = join(cacheDir, 'QuoteDocument.bundle.mjs');
  try {
    await esbuild.build({
      entryPoints: [join(REPO_ROOT, 'src/components/QuoteDocument.jsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: outFile,
      external: ['react', 'react-dom', 'react-dom/server'],
      jsx: 'automatic',
      logLevel: 'silent',
    });
    const mod = await import(pathToFileURL(outFile).href);
    return { Component: mod.default, cleanup: () => rmSync(cacheDir, { recursive: true, force: true }) };
  } catch (err) {
    rmSync(cacheDir, { recursive: true, force: true });
    throw err;
  }
}

export async function renderFixturePdf({ inputPath, outputPath } = {}) {
  const fixturePath = inputPath || join(__dirname, 'input.json');
  const input = JSON.parse(readFileSync(fixturePath, 'utf8'));

  // Hydrate extraPhotos with deterministic placeholder data URLs.
  // input.json deliberately ships without binary photo data
  // (sanitisation requirement — no real photos in committed files).
  const extraPhotos = (input.extraPhotos || []).map((p) => ({
    label: p.label,
    aspect: p.aspect || 'landscape',
    data: placeholderPhotoDataUrl(p.aspect || 'landscape'),
  }));

  // Reconstruct the state shape QuoteDocument expects (matches the
  // reducer's initialState for everything we don't override).
  const state = {
    profile: input.profile,
    jobDetails: input.jobDetails,
    reviewData: input.reviewData,
    photos: {
      overview: null,
      closeup: null,
      sideProfile: null,
      referenceCard: null,
      access: null,
    },
    extraPhotos,
    captureMode: 'photos',
    transcript: null,
  };

  const { Component: QuoteDocument, cleanup } = await loadQuoteDocument();
  try {
    const { sanitiseQuoteHtml } = await import(pathToFileURL(join(REPO_ROOT, 'pdfRenderer.js')).href);
    const { buildPageChromeText, buildPdfHeaderHtml, buildPdfFooterHtml } = await import(
      pathToFileURL(join(REPO_ROOT, 'src/utils/quotePageChrome.js')).href
    );

    const quoteHtml = renderToStaticMarkup(
      React.createElement(QuoteDocument, {
        state,
        showPhotos: true,
        selectedPhotos: extraPhotos,
      })
    );

    const chromeText = buildPageChromeText({
      profile: state.profile,
      jobDetails: state.jobDetails,
    });
    const headerHtml = buildPdfHeaderHtml(chromeText);
    const footerHtml = buildPdfFooterHtml(chromeText);

    // Render via the same composition pdfRenderer.js uses — but with a
    // launcher that picks system Chrome on macOS when @sparticuz's
    // Linux binary can't run locally. The HTML composition + page.pdf
    // options are kept in lockstep with pdfRenderer.js so this fixture
    // exercises the same layout the production path produces.
    const pdfBuffer = await renderPdfLocally({
      quoteHtml: sanitiseQuoteHtml(quoteHtml),
      headerHtml: headerHtml ? sanitiseQuoteHtml(headerHtml) : '',
      footerHtml: footerHtml ? sanitiseQuoteHtml(footerHtml) : '',
      title: 'Pro Drive regression',
    });

    if (outputPath) {
      writeFileSync(outputPath, pdfBuffer);
    }
    return pdfBuffer;
  } finally {
    try { cleanup(); } catch { /* best-effort */ }
  }
}

// Local render path — mirrors pdfRenderer.js' renderQuotePdf composition
// (sanitised HTML in .print-root, print.css + Tailwind inlined, JS off,
// network locked down, same page.pdf options) but with launcher logic
// that picks system Chrome on macOS where the @sparticuz Linux binary
// can't run. Kept side-by-side with pdfRenderer.js — if the production
// renderer changes its composition, this needs updating too.
async function renderPdfLocally({ quoteHtml, headerHtml, footerHtml, title }) {
  const PRINT_CSS = readFileSync(join(REPO_ROOT, 'public/print.css'), 'utf8');
  let TAILWIND_CSS = '';
  try {
    TAILWIND_CSS = readFileSync(join(REPO_ROOT, 'public/quote-tailwind.css'), 'utf8');
  } catch { /* fixture render tolerates missing file */ }
  const FONTS_HREF =
    'https://fonts.googleapis.com/css2?' +
    'family=Barlow+Condensed:wght@400;600;700;800' +
    '&family=Inter:wght@400;500;600' +
    '&family=JetBrains+Mono:wght@400;500' +
    '&display=swap';
  const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title.replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]))}</title>
  <link href="${FONTS_HREF}" rel="stylesheet" />
  <style>${TAILWIND_CSS}</style>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="print-root">${quoteHtml}</div>
</body>
</html>`;

  const localChrome = findLocalChrome();
  const execPath = localChrome || (await chromium.executablePath());
  const launchArgs = localChrome
    ? ['--no-sandbox', '--disable-setuid-sandbox']
    : chromium.args;
  const browser = await puppeteer.launch({
    args: launchArgs,
    executablePath: execPath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    // Local renders allow Google Fonts; everything else blocks.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:')) return req.continue();
      try {
        const host = new URL(url).hostname;
        if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') return req.continue();
      } catch { /* fallthrough */ }
      req.abort('blockedbyclient');
    });
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    // TRQ-179: mirror pdfRenderer.js' font-race guard. Without this the
    // fixture renders with fallback-font metrics in cold-start runs and
    // page counts drift from prod. page.evaluate() bypasses
    // setJavaScriptEnabled(false) (uses DevTools Runtime.evaluate).
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMediaType('print');
    const enableHeaderFooter = !!(headerHtml || footerHtml);
    const headerTemplate = headerHtml || '<div style="font-size:1px"></div>';
    const footerTemplate = footerHtml || '<div style="font-size:1px"></div>';
    const rawPdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: enableHeaderFooter,
      headerTemplate,
      footerTemplate,
      margin: enableHeaderFooter
        ? { top: '25mm', right: '22mm', bottom: '22mm', left: '22mm' }
        : { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
    });
    // TRQ-179: mirror pdfRenderer.js' metadata normalisation so fixture
    // re-baselining produces a byte-stable PDF identical (up to legitimate
    // rendering differences) to the prod path. Without this, `node
    // renderFixture.js` writes a PDF with Chromium's bake-time
    // /CreationDate + /ModDate, so two consecutive baseline runs differ.
    return normalisePdfMetadata(Buffer.from(rawPdf));
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }
}

// CLI entry — `node renderFixture.js` writes after-fix.pdf into the
// fixture directory. Used for manual re-baselining when the page-break
// rules change again.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const out = join(__dirname, 'after-fix.pdf');
  renderFixturePdf({ outputPath: out })
    .then((buf) => {
      console.log(`Wrote ${out} (${buf.length} bytes)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Render failed:', err);
      process.exit(1);
    });
}
