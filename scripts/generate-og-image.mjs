#!/usr/bin/env node
/**
 * Generate `public/og.png` — the OpenGraph preview image for fastquote.uk.
 *
 * Renders an inline HTML page in headless Chrome at 1200×630 (the LinkedIn /
 * Twitter / Facebook recommended size) and saves the screenshot as PNG.
 *
 * Run locally:
 *   node scripts/generate-og-image.mjs
 *
 * The output PNG is checked into git at public/og.png. It only needs to be
 * regenerated when the design changes — DON'T wire this into the deploy.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 1200px; height: 630px; overflow: hidden; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #f4eee2; /* Daylight cream */
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 60px;
      position: relative;
    }
    .canvas {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 28px;
      background: #fffdf8;
      border: 4px solid #211a10;
      border-radius: 12px;
      padding: 48px;
      position: relative;
    }
    .corner {
      position: absolute;
      top: 28px;
      right: 36px;
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7c6c50;
    }
    .corner b { color: #bd5e09; }
    .fq-mark {
      width: 156px;
      height: 156px;
      background: #211a10;
      color: #bd5e09;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 800;
      font-size: 96px;
      letter-spacing: 0.02em;
    }
    .wordmark {
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 800;
      font-size: 96px;
      letter-spacing: -0.01em;
      color: #211a10;
      line-height: 1;
    }
    .tagline {
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 600;
      font-size: 30px;
      letter-spacing: 0.04em;
      color: #4a3d29;
      text-align: center;
      max-width: 820px;
      line-height: 1.2;
    }
    .tagline b { color: #bd5e09; }
    .domain {
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 700;
      font-size: 22px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #bd5e09;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="canvas">
    <div class="corner">For <b>dry stone wallers</b></div>
    <div class="fq-mark">FQ</div>
    <div class="wordmark">FastQuote</div>
    <div class="tagline">From quote to customer.<br/><b>Ready in five minutes.</b></div>
    <div class="domain">fastquote.uk</div>
  </div>
</body>
</html>`;

// Find a local Chrome to drive puppeteer-core. macOS default first; fall
// back to whatever PUPPETEER_EXECUTABLE_PATH points at.
function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  // Last resort: ask `which`
  try {
    const out = execSync('which google-chrome chromium chrome 2>/dev/null || true').toString().trim();
    if (out) return out.split('\n')[0];
  } catch { /* */ }
  return null;
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    console.error('No Chrome/Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH.');
    process.exit(2);
  }
  console.log('Using Chrome at:', executablePath);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
    await page.setContent(HTML, { waitUntil: 'networkidle0' });
    // Wait for Google Fonts to apply before screenshot.
    await page.evaluate(() => document.fonts.ready);
    const buffer = await page.screenshot({
      type: 'png',
      omitBackground: false,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    writeFileSync('public/og.png', buffer);
    console.log(`✓ wrote public/og.png (${buffer.length.toLocaleString()} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
