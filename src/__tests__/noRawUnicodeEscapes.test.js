/**
 * Regression guard against Unicode escapes in JSX text content.
 *
 * JSX text treats \u2699 as literal backslash-u-2-6-9-9, not as the
 * cog-icon character. Escapes only evaluate inside a JS expression
 * {...} or a JS string literal.
 *
 * Paul hit this: my QuickBooks modal rendered "Settings \u2699 \u2192
 * Import data \u2192 Invoices" as raw text. Same bug was also on the
 * Saved Quotes list. This test scans every .jsx under src/components
 * for `\uXXXX` sequences that sit in JSX text (not inside {}).
 *
 * If you need a Unicode character in JSX, use one of:
 *   - the actual character: `→`, `·`, `—`, `⚙`
 *   - an HTML entity: `&rarr;`, `&middot;`
 *   - a JS expression: `{'\u2192'}`
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(__dirname, '..', 'components');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.jsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Strip content inside JS expressions `{...}` so only JSX-text
 * positions remain. Naive brace-matching is sufficient here — React
 * component bodies don't have deeply-nested template literals in JSX
 * text positions. We also strip single-line `//` and block `/* *\/`
 * comments so escape sequences documented in comments don't trip it.
 */
function extractJsxTextOnly(src) {
  // Strip comments (line + block).
  let s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // Strip JS expressions inside JSX {...}. We iterate balanced-brace
  // matching to avoid clipping at a template-literal brace.
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
        i++;
      }
    } else {
      out += s[i];
      i++;
    }
  }

  // Strip string literals (single, double, template) — escapes in JS
  // string literals evaluate correctly; we only care about JSX text.
  out = out
    .replace(/`(?:\\.|[^`\\])*`/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '');

  return out;
}

describe('No raw \\uXXXX escapes in JSX text content', () => {
  const files = walk(componentsDir);

  for (const file of files) {
    const rel = file.replace(componentsDir + '/', '');
    test(`${rel} — no literal \\uXXXX in JSX text`, () => {
      const src = readFileSync(file, 'utf8');
      const text = extractJsxTextOnly(src);
      const match = text.match(/\\u[0-9a-fA-F]{4}/);
      if (match) {
        throw new Error(
          `${rel}: literal ${match[0]} in JSX text will render as raw characters. ` +
          'Use the real Unicode char, an HTML entity, or wrap in {\'...\'}.'
        );
      }
    });
  }
});
