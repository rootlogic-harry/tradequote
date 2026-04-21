import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const pdfRenderer = readFileSync(join(repoRoot, 'pdfRenderer.js'), 'utf8');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const quoteOutputJsx = readFileSync(
  join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
  'utf8'
);
const nixpacks = readFileSync(join(repoRoot, 'nixpacks.toml'), 'utf8');

// TRQ-120 Phase 2 — Puppeteer PDF endpoint. These tests don't spawn Chromium
// (that needs a full integration test with the deployed server); they verify
// the wiring is in place so the live endpoint behaves predictably.
describe('Server-side PDF renderer (pdfRenderer.js)', () => {
  it('imports puppeteer-core and @sparticuz/chromium', () => {
    expect(pdfRenderer).toMatch(/from 'puppeteer-core'/);
    expect(pdfRenderer).toMatch(/from '@sparticuz\/chromium'/);
  });

  it('loads public/print.css at startup and inlines it', () => {
    expect(pdfRenderer).toMatch(/public\/print\.css/);
    expect(pdfRenderer).toMatch(/PRINT_CSS/);
  });

  it('keeps a singleton browser across requests', () => {
    // Persistent browser is required so every request doesn't pay the
    // ~1-2s Chromium launch cost.
    expect(pdfRenderer).toMatch(/browserPromise/);
    expect(pdfRenderer).toMatch(/disconnected/); // recreate on crash
  });

  it('emulates print media and enables printBackground', () => {
    expect(pdfRenderer).toMatch(/emulateMediaType\('print'\)/);
    expect(pdfRenderer).toMatch(/printBackground:\s*true/);
  });

  it('wraps the quote HTML in a .print-root container', () => {
    // This is what activates every @media print rule in print.css
    expect(pdfRenderer).toMatch(/class="print-root"/);
  });

  it('rejects empty quoteHtml', () => {
    expect(pdfRenderer).toMatch(/quoteHtml is required/);
  });
});

describe('Server PDF route', () => {
  it('exposes POST /api/users/:id/jobs/:jobId/pdf', () => {
    expect(serverJs).toMatch(/app\.post\('\/api\/users\/:id\/jobs\/:jobId\/pdf'/);
  });

  it('the PDF route is rate-limited', () => {
    expect(serverJs).toMatch(/pdfRateLimit/);
  });

  it('rejects huge payloads with 413', () => {
    // 5MB guard — photos inline as base64 can get big but should stay well below
    expect(serverJs).toMatch(/413/);
    expect(serverJs).toMatch(/exceeds 5MB/);
  });

  it('sets Content-Type application/pdf + Content-Disposition attachment', () => {
    expect(serverJs).toMatch(/Content-Type.*application\/pdf/);
    expect(serverJs).toMatch(/Content-Disposition.*attachment/);
  });
});

describe('QuoteOutput client wiring', () => {
  it('imports renderToStaticMarkup', () => {
    expect(quoteOutputJsx).toMatch(/renderToStaticMarkup.*from 'react-dom\/server'/);
  });

  it('has a handleDownloadPdfServer that POSTs to the PDF route', () => {
    expect(quoteOutputJsx).toMatch(/handleDownloadPdfServer/);
    expect(quoteOutputJsx).toMatch(/\/api\/users\/.*\/jobs\/.*\/pdf/);
  });

  it('sends the QuoteDocument markup with photos in the payload', () => {
    expect(quoteOutputJsx).toMatch(/renderToStaticMarkup\(\s*<QuoteDocument[^>]*showPhotos[^>]*selectedPhotos/);
  });

  it('keeps window.print fallback button alongside the server download', () => {
    expect(quoteOutputJsx).toMatch(/handlePrint/);
    expect(quoteOutputJsx).toMatch(/Save via print/);
  });
});

describe('Nixpacks Chromium deps', () => {
  it('apt-installs the libraries @sparticuz/chromium needs at runtime', () => {
    for (const pkg of ['libnss3', 'libgbm1', 'libatk-bridge2.0-0', 'libxshmfence1']) {
      expect(nixpacks).toContain(`"${pkg}"`);
    }
  });

  it('apt-installs fonts Chromium can fall back to', () => {
    expect(nixpacks).toContain('fonts-liberation');
  });

  it('retains ffmpeg for the video pipeline', () => {
    expect(nixpacks).toContain('"ffmpeg"');
  });
});
