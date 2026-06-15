/**
 * Tailwind-compile-for-PDF fix — source-level wiring guards.
 *
 * Background: Mark's Pro Drive quote (June 2026) showed the cost
 * breakdown table and totals block collapsing. Root cause: the
 * server-side PDF renderer disabled JavaScript as a defence layer
 * (correct), but loaded Tailwind via its CDN runtime (which needs
 * JS to execute). Every utility class became a no-op.
 *
 * Fix: compile a static Tailwind CSS file at build time
 * (scripts/build-pdf-css.js → public/quote-tailwind.css) and inline
 * it in the PDF page the same way print.css is inlined. The CDN
 * script is removed from the HTML and from the request allowlist.
 *
 * These tests pin the wiring so the bug can't silently regress.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const pdfRendererSrc = readFileSync(join(repoRoot, 'pdfRenderer.js'), 'utf8');
const tailwindConfigSrc = readFileSync(join(repoRoot, 'tailwind.config.cjs'), 'utf8');
const buildScriptSrc = readFileSync(join(repoRoot, 'scripts/build-pdf-css.js'), 'utf8');
const entryCssSrc = readFileSync(join(repoRoot, 'src/quote-tailwind-entry.css'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

describe('pdfRenderer.js — Tailwind CDN is gone', () => {
  test('does not load Tailwind via CDN script anymore', () => {
    // The historical comment in pdfRenderer.js mentions
    // cdn.tailwindcss.com to explain why it was removed. Allow that
    // by anchoring on the actual `<script>` syntax shape (the real
    // bug would put the CDN back as an HTML script tag, not in a
    // comment).
    expect(pdfRendererSrc).not.toMatch(/<script[^>]*tailwindcss\.com/);
    // The REQUEST_ALLOWLIST set must not list it either — separate
    // assertion in the next test.
  });

  test('REQUEST_ALLOWLIST no longer includes cdn.tailwindcss.com', () => {
    // Slice the actual `new Set([...])` literal so we only check the
    // array contents, not surrounding comments.
    const m = pdfRendererSrc.match(/const REQUEST_ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    const setBody = m[1];
    expect(setBody).not.toMatch(/cdn\.tailwindcss\.com/);
    // Sanity: still allows the two Google Fonts hosts.
    expect(setBody).toMatch(/fonts\.googleapis\.com/);
    expect(setBody).toMatch(/fonts\.gstatic\.com/);
  });
});

describe('pdfRenderer.js — compiled Tailwind is inlined', () => {
  test('reads public/quote-tailwind.css at boot', () => {
    expect(pdfRendererSrc).toMatch(/readFileSync\([\s\S]{0,200}public\/quote-tailwind\.css/);
    // `let` is correct — we reassign in the catch branch on fail-soft.
    expect(pdfRendererSrc).toMatch(/let TAILWIND_CSS\s*=\s*['"]['"]/);
  });

  test('inlines TAILWIND_CSS in the rendered HTML, before PRINT_CSS', () => {
    const start = pdfRendererSrc.indexOf('const fullHtml = `');
    const end = pdfRendererSrc.indexOf('`;', start);
    const block = pdfRendererSrc.slice(start, end);
    expect(block).toMatch(/<style>\$\{TAILWIND_CSS\}<\/style>/);
    // PRINT_CSS rules are more specific overrides and must come AFTER
    // the Tailwind utilities so they win on cascade ties.
    const twIdx = block.indexOf('TAILWIND_CSS');
    const printIdx = block.indexOf('PRINT_CSS');
    expect(twIdx).toBeGreaterThan(-1);
    expect(printIdx).toBeGreaterThan(-1);
    expect(twIdx).toBeLessThan(printIdx);
  });

  test('missing CSS file fails soft (logs error, does not throw on boot)', () => {
    // The boot path uses try/catch so a missing file doesn't crash
    // the server; PDFs degrade to the broken layout but the rest of
    // the app keeps running.
    expect(pdfRendererSrc).toMatch(/try\s*\{[\s\S]{0,400}readFileSync[\s\S]{0,400}quote-tailwind\.css[\s\S]{0,400}\}\s*catch/);
    expect(pdfRendererSrc).toMatch(/Run `npm run build:pdf-css` to fix/);
  });
});

describe('tailwind.config.cjs — content scan + theme', () => {
  test('content scan includes QuoteDocument.jsx (the file whose classes drove the bug)', () => {
    expect(tailwindConfigSrc).toMatch(/src\/components\/QuoteDocument\.jsx/);
  });

  test('preflight is disabled (print.css already handles resets)', () => {
    expect(tailwindConfigSrc).toMatch(/preflight:\s*false/);
  });

  test('theme extends with the fq: breakpoint (used by QuoteDocument layout)', () => {
    expect(tailwindConfigSrc).toMatch(/fq:\s*['"]900px['"]/);
  });
});

describe('scripts/build-pdf-css.js — guards against producing an empty file', () => {
  test('exits non-zero when the output file is suspiciously small', () => {
    // The bug scenario this catches: a future tailwind.config.cjs
    // change drops QuoteDocument.jsx from the content scan, the
    // compile produces near-empty CSS, and PDFs silently regress.
    // The build refuses to ship in that case.
    expect(buildScriptSrc).toMatch(/size < 1000/);
    expect(buildScriptSrc).toMatch(/process\.exit\(1\)/);
  });

  test('passes --minify so the inlined CSS is compact', () => {
    expect(buildScriptSrc).toMatch(/'--minify'/);
  });

  test('uses the locally-installed tailwindcss binary (no global dep)', () => {
    expect(buildScriptSrc).toMatch(/node_modules\/\.bin\/tailwindcss/);
  });
});

describe('npm scripts — build pipeline wires pdf-css before vite', () => {
  test('build script runs pdf-css compile first', () => {
    expect(pkg.scripts.build).toMatch(/build:pdf-css.*vite build/);
  });

  test('build:pdf-css script exists', () => {
    expect(pkg.scripts['build:pdf-css']).toBe('node scripts/build-pdf-css.js');
  });

  test('tailwindcss is in devDependencies', () => {
    expect(pkg.devDependencies?.tailwindcss).toBeDefined();
  });
});

describe('quote-tailwind-entry.css — emits utilities, skips preflight', () => {
  test('contains @tailwind utilities directive', () => {
    expect(entryCssSrc).toMatch(/@tailwind\s+utilities/);
  });

  test('does NOT contain @tailwind base directive (would clash with print.css resets)', () => {
    // We deliberately skip the base layer — print.css already does
    // the reset and Tailwind's preflight would double-apply. Strip
    // /* … */ comments first so a comment that NAMES the directive
    // (to explain why we don't use it) doesn't false-positive.
    const codeOnly = entryCssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/@tailwind\s+base/);
    // Sanity: utilities IS present.
    expect(codeOnly).toMatch(/@tailwind\s+utilities/);
  });
});

describe('gitignore — compiled output is not committed', () => {
  test('public/quote-tailwind.css is gitignored', () => {
    expect(gitignore).toMatch(/^public\/quote-tailwind\.css$/m);
  });
});

describe('behavioural — compile produces the critical classes', () => {
  // This is the hard test — actually invoke the build and confirm
  // every class the cost-section JSX uses lands in the compiled CSS.
  // If a future change accidentally removes a class from the content
  // scan, this fails loudly with the missing class name.

  const compiledPath = join(repoRoot, 'public/quote-tailwind.css');

  beforeAll(() => {
    // Run the compile so the test is self-contained — doesn't depend
    // on whether someone ran `npm run build` recently.
    const result = spawnSync('node', ['scripts/build-pdf-css.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(`build-pdf-css.js failed: ${result.stderr || result.stdout}`);
    }
  });

  test('compiled CSS file exists', () => {
    expect(existsSync(compiledPath)).toBe(true);
  });

  test.each([
    // Cost table layout
    'flex',
    'justify-between',
    'justify-end',
    'text-right',
    'text-left',
    // Sizing for the totals box
    'w-full',
    'w-2\\/3',
    // Vertical rhythm
    'mt-6',
    'pt-3',
    'py-1',
    'mb-12',
    'space-y-2',
    // Borders + separators
    'border-t-2',
    'border-b',
    'border-gray-200',
    // Typography
    'text-lg',
    'text-2xl',
    'font-bold',
    'uppercase',
  ])('compiled CSS contains a rule for .%s', (cls) => {
    const css = readFileSync(compiledPath, 'utf8');
    // Tailwind escapes the / in fractions; match either form.
    const pattern = new RegExp(`\\.${cls.replace('\\/', '\\\\?/')}[{:>~+\\s]`);
    expect(css).toMatch(pattern);
  });

  test('compiled CSS is non-trivial (size > 5KB)', () => {
    const { size } = readFileSync(compiledPath).length
      ? { size: readFileSync(compiledPath).length }
      : { size: 0 };
    expect(size).toBeGreaterThan(5000);
  });
});
