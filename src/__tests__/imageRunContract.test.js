/**
 * Contract: every `new ImageRun({...})` must declare `type`.
 *
 * docx v9 types `type: "jpg" | "png" | "gif" | "bmp"` as REQUIRED on raster
 * images. Omitting it does not throw — it silently writes the picture as
 * word/media/<hash>.undefined with no content type, and Word then reports
 * "unreadable content" (2026-09-20). Callers must get the type from
 * decodeImageDataUrl() (magic-byte detection), never hard-code or omit it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === '__tests__' || f === 'node_modules') continue;
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : /\.(js|jsx)$/.test(f) && out.push(p);
  }
  return out;
}

// Strip comments so prose mentioning ImageRun is not scanned.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const files = walk(srcRoot).map((p) => ({ p: relative(srcRoot, p), src: code(readFileSync(p, 'utf8')) }));
const withImageRun = files.filter((f) => /new ImageRun\(/.test(f.src));

describe('ImageRun always declares a type', () => {
  test('the scan finds the known ImageRun call sites (guards the guard)', () => {
    const names = withImageRun.map((f) => f.p);
    expect(names).toEqual(expect.arrayContaining(['utils/exportDocx.js', 'utils/exportRamsDocx.js']));
  });

  test('exporters stay out of React components (they must be testable + validated; RamsOutput used to hold one inline)', () => {
    expect(withImageRun.map((f) => f.p).filter((p) => p.startsWith('components/'))).toEqual([]);
  });

  test.each(withImageRun.map((f) => [f.p, f.src]))('%s: every new ImageRun({ ... }) has `type:`', (_p, src) => {
    const calls = [...src.matchAll(/new ImageRun\(\{([\s\S]*?)transformation/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, opts] of calls) expect(opts).toMatch(/\btype\b/);
  });

  test.each(withImageRun.map((f) => [f.p, f.src]))('%s: image bytes come from decodeImageDataUrl (magic-byte typing)', (_p, src) => {
    expect(src).toMatch(/decodeImageDataUrl\(/);
  });
});
