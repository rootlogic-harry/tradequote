#!/usr/bin/env node
/**
 * Build the static Tailwind stylesheet used by the server-side PDF
 * renderer.
 *
 * Why this script exists:
 *   - pdfRenderer.js runs Puppeteer with `setJavaScriptEnabled(false)`.
 *   - The Tailwind CDN is a JIT runtime that needs JS to scan the DOM
 *     and emit CSS. Without it, every utility class is a no-op.
 *   - Compile a tiny ahead-of-time CSS bundle here, write it to
 *     `public/quote-tailwind.css`, and have pdfRenderer.js inline it
 *     at boot (same pattern as `public/print.css`).
 *
 * Mark spotted this in the wild (June 2026 Pro Drive quote): the
 * cost-breakdown table and totals block were collapsing because
 * `flex`, `justify-between`, `text-right`, `w-2/3` etc. weren't
 * resolving to any CSS.
 *
 * Build chain:
 *   `npm run build` calls `npm run build:pdf-css` first via the
 *   prebuild hook. Vite then bundles dist/ which includes
 *   public/quote-tailwind.css automatically (Vite's public-dir
 *   convention).
 *
 * Locally:
 *   npm run build:pdf-css        # one-off compile
 *
 * Outputs:
 *   public/quote-tailwind.css    (versioned in git? no — generated)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const INPUT_PATH = join(repoRoot, 'src/quote-tailwind-entry.css');
const OUTPUT_PATH = join(repoRoot, 'public/quote-tailwind.css');
const CONFIG_PATH = join(repoRoot, 'tailwind.config.cjs');

// 1. Ensure the entry CSS exists (it's checked in; this is just a sanity
//    check so a fresh clone with `npm run build` doesn't fail mysteriously).
try {
  statSync(INPUT_PATH);
} catch {
  console.error(`build-pdf-css: missing input file ${INPUT_PATH}`);
  process.exit(2);
}

// 2. Ensure public/ exists.
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

// 3. Invoke the tailwindcss CLI. We use the binary from node_modules
//    (installed via npm i -D tailwindcss) so the build works on
//    Railway's Dockerfile without a separate global install.
console.log('build-pdf-css: compiling QuoteDocument Tailwind classes…');
const tailwindBin = join(repoRoot, 'node_modules/.bin/tailwindcss');
const result = spawnSync(
  tailwindBin,
  [
    '-i', INPUT_PATH,
    '-o', OUTPUT_PATH,
    '-c', CONFIG_PATH,
    '--minify',
  ],
  { stdio: 'inherit', cwd: repoRoot }
);

if (result.status !== 0) {
  console.error(`build-pdf-css: tailwindcss exited ${result.status}`);
  process.exit(result.status || 1);
}

// 4. Sanity-check the output. A successful Tailwind compile against
//    QuoteDocument produces a CSS file with hundreds of utility rules.
//    A near-empty file means the content scan didn't find any classes —
//    which means the renderer will silently produce the same broken
//    PDF as before. Fail loudly here.
const size = statSync(OUTPUT_PATH).size;
console.log(`build-pdf-css: wrote ${OUTPUT_PATH} (${size} bytes)`);
if (size < 1000) {
  console.error(
    `build-pdf-css: output suspiciously small (${size} bytes). ` +
    'The content-scan in tailwind.config.cjs probably missed QuoteDocument.jsx. ' +
    'Refusing to ship a broken PDF stylesheet.'
  );
  process.exit(1);
}
