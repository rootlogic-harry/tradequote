/**
 * downloadBlob — iOS-safe download helper (TRQ-140).
 *
 * iOS Safari ignores the `download` attribute on blob URLs — tap
 * "Download PDF", get nothing visible (Paul's iPad). The fix: use
 * `navigator.share` with a File when available (iOS 15+, modern
 * Android), fall back to the legacy blob-URL + anchor click on
 * desktop and older browsers.
 *
 * Also: user cancelling the share sheet is NOT an error. `share()`
 * rejects with a DOMException named "AbortError" — swallow it.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('downloadBlob — Web Share API path (iOS / modern Android)', () => {
  let originalNavigator;
  let originalURL;
  let originalDocument;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
    originalURL = globalThis.URL;
    originalDocument = globalThis.document;
  });
  afterEach(() => {
    globalThis.navigator = originalNavigator;
    globalThis.URL = originalURL;
    globalThis.document = originalDocument;
    jest.resetModules();
  });

  // Share sheet now requires a touch-primary platform (iPad/iPhone/
  // Android) — macOS Safari's share sheet was hijacking the desktop
  // flow, turning "Export for QuickBooks" into a confused "Text
  // Document" share sheet. Set up a full iPad-like navigator for the
  // share-path tests.
  const asIPadNavigator = (extras = {}) => ({
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    maxTouchPoints: 5,
    ...extras,
  });

  test('uses navigator.share on iPad (canShare true, touch platform)', async () => {
    const shareSpy = jest.fn(async () => undefined);
    globalThis.navigator = asIPadNavigator({
      canShare: (data) => Array.isArray(data?.files) && data.files.length === 1,
      share: shareSpy,
    });
    globalThis.File = class {
      constructor(parts, name, opts) {
        this.name = name;
        this.type = opts?.type;
      }
    };
    const { downloadBlob } = await import('../utils/downloadBlob.js');
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });
    await downloadBlob(blob, 'test.pdf');
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const arg = shareSpy.mock.calls[0][0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe('test.pdf');
  });

  test('desktop macOS Safari goes to anchor-click, NOT share sheet (Harry\'s QBO bug)', async () => {
    // Regression guard: Harry's QBO export triggered macOS Safari's
    // share sheet because canShare existed. Desktop users expect the
    // file in Downloads, not a share sheet.
    const shareSpy = jest.fn();
    const clickSpy = jest.fn();
    globalThis.navigator = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 0,
      canShare: () => true,
      share: shareSpy,
    };
    globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: jest.fn() };
    globalThis.document = {
      createElement: () => ({
        set href(v) {}, set download(v) {},
        click: clickSpy,
        style: {},
      }),
      body: { appendChild: jest.fn(), removeChild: jest.fn() },
    };
    const { downloadBlob } = await import('../utils/downloadBlob.js');
    await downloadBlob(new Blob(['x'], { type: 'text/csv' }), 'test.csv');
    expect(shareSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  test('falls back to anchor-click when canShare({ files }) is not supported', async () => {
    const clickSpy = jest.fn();
    const appendSpy = jest.fn();
    const removeSpy = jest.fn();
    globalThis.navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36',
      maxTouchPoints: 0,
    };
    globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: jest.fn() };
    globalThis.document = {
      createElement: () => ({
        set href(v) {}, set download(v) {},
        click: clickSpy,
        style: {},
      }),
      body: { appendChild: appendSpy, removeChild: removeSpy },
    };
    const { downloadBlob } = await import('../utils/downloadBlob.js');
    await downloadBlob(new Blob(['x'], { type: 'application/pdf' }), 'test.pdf');
    expect(clickSpy).toHaveBeenCalled();
  });

  test('user cancelling the share sheet (AbortError) is NOT treated as an error', async () => {
    const abort = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
    globalThis.navigator = asIPadNavigator({
      canShare: () => true,
      share: jest.fn(async () => { throw abort; }),
    });
    globalThis.File = class { constructor() {} };
    const { downloadBlob } = await import('../utils/downloadBlob.js');
    const result = await downloadBlob(new Blob(['x']), 'x.pdf');
    expect(result).toEqual({ cancelled: true });
  });

  test('non-AbortError share failure falls through to anchor-click', async () => {
    const clickSpy = jest.fn();
    globalThis.navigator = asIPadNavigator({
      canShare: () => true,
      share: jest.fn(async () => { throw new Error('permission denied'); }),
    });
    globalThis.File = class { constructor() {} };
    globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: jest.fn() };
    globalThis.document = {
      createElement: () => ({ click: clickSpy, style: {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    const { downloadBlob } = await import('../utils/downloadBlob.js');
    await downloadBlob(new Blob(['x']), 'x.pdf');
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('downloadBlob — wiring in QuoteOutput export paths', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
    'utf8'
  );

  test('imports downloadBlob', () => {
    expect(src).toMatch(/import\s*\{[\s\S]*downloadBlob[\s\S]*\}\s*from\s*['"`][^'"]*downloadBlob/);
  });

  test('server PDF handler calls downloadBlob', () => {
    // Grab a generous slice from the handler keyword forward — the
    // arrow-function body is long and contains try/catch/finally, so
    // a lazy regex terminates too early.
    const idx = src.indexOf('handleDownloadPdfServer = async');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 3000);
    expect(slice).toMatch(/downloadBlob\s*\(/);
  });

  test('DOCX handler calls downloadBlob', () => {
    const idx = src.indexOf('handleDownloadDocx = async');
    expect(idx).toBeGreaterThan(-1);
    // DOCX handler is the largest in this file (builds the whole
    // document tree inline). Give it a very wide window.
    const slice = src.slice(idx, idx + 40000);
    expect(slice).toMatch(/downloadBlob\s*\(/);
  });

  test('legacy jsPDF handler calls downloadBlob', () => {
    const idx = src.indexOf('handleDownloadPDF = async');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 10000);
    expect(slice).toMatch(/downloadBlob\s*\(/);
  });
});
