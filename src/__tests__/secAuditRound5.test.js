/**
 * Sec-audit round 5 (TRQ-172) — three hardening fixes:
 *
 *   M-1  PDF header/footer HTML sanitised before reaching Puppeteer
 *   M-2  jobs list query capped at LIMIT 100
 *   L-1  QBO CSV export route rate-limited per user
 *
 * Source-level assertions guard against regressions sliding the fixes
 * back out (the same agent that flagged these in audit 5 will mis-flag
 * a future audit if these guards aren't in place).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('M-1: PDF header/footer sanitised before Puppeteer', () => {
  test('POST /pdf route imports sanitiseQuoteHtml', () => {
    expect(serverSrc).toMatch(
      /import\s*\{[^}]*sanitiseQuoteHtml[^}]*\}\s*from\s*['"]\.\/pdfRenderer\.js['"]/
    );
  });

  test('safeHeader and safeFooter run sanitiseQuoteHtml, not raw passthrough', () => {
    const idx = serverSrc.indexOf("app.post('/api/users/:id/jobs/:jobId/pdf'");
    expect(idx).toBeGreaterThan(-1);
    const block = serverSrc.slice(idx, idx + 2000);
    // Both safeHeader and safeFooter must call sanitiseQuoteHtml
    expect(block).toMatch(
      /safeHeader\s*=\s*[^;]*sanitiseQuoteHtml\(\s*headerHtml\s*\)/
    );
    expect(block).toMatch(
      /safeFooter\s*=\s*[^;]*sanitiseQuoteHtml\(\s*footerHtml\s*\)/
    );
  });
});

describe('M-2: jobs list query capped at LIMIT 100', () => {
  test('GET /api/users/:id/jobs query has LIMIT clause', () => {
    const idx = serverSrc.indexOf("app.get('/api/users/:id/jobs'");
    expect(idx).toBeGreaterThan(-1);
    const block = serverSrc.slice(idx, idx + 2000);
    // Match the SELECT against the jobs table inside this route — must
    // include LIMIT (not just any LIMIT in the file).
    expect(block).toMatch(/FROM jobs[\s\S]*ORDER BY saved_at DESC[\s\S]*LIMIT\s+100/i);
  });
});

describe('L-1: QBO CSV export route rate-limited', () => {
  test('csvExportRateLimit is declared with per-user keyGenerator', () => {
    expect(serverSrc).toMatch(/const csvExportRateLimit\s*=\s*rateLimit\(/);
    // Per-user keying (req.params.id) — same pattern as pdfRateLimit
    const decl = serverSrc.slice(
      serverSrc.indexOf('const csvExportRateLimit'),
      serverSrc.indexOf('const csvExportRateLimit') + 600
    );
    expect(decl).toMatch(/keyGenerator:\s*\(req\)\s*=>\s*req\.params\.id/);
  });

  test('GET /export/quickbooks-csv applies the rate limiter', () => {
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/api\/users\/:id\/jobs\/:jobId\/export\/quickbooks-csv['"]\s*,\s*csvExportRateLimit/
    );
  });
});
