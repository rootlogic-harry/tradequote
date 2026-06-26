#!/usr/bin/env node
/**
 * Standalone touch-target scan — same logic as the Jest test, but
 * outputs JSON to stdout for easy allow-list curation.
 *
 * Usage: node scripts/scan-touch-targets.mjs [--counts]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const COMPONENTS_DIR = join(REPO_ROOT, 'src', 'components');

const CANONICAL_44PX_CLASSES = [
  'btn-primary', 'btn-ghost', 'btn-secondary', 'btn-link',
  'row-action-btn', 'pill', 'nq-field', 'touch-44',
  'btn-sm', 'btn-lg', 'btn-block',
];

function hasInlineMinHeight44(line) {
  const re = /minHeight\s*:\s*['"]?(\d+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  const reH = /\bheight\s*:\s*['"]?(\d+)/g;
  while ((m = reH.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  return false;
}

function hasTailwindMinHeight44(line) {
  const reBracket = /\b(?:min-h|h)-\[(\d+)px\]/g;
  let m;
  while ((m = reBracket.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  if (/\b(?:min-h|h)-(?:1[1-9]|[2-9]\d|\d{3,})\b/.test(line)) return true;
  return false;
}

function hasCanonicalClass(line) {
  return CANONICAL_44PX_CLASSES.some(cls => {
    const re = new RegExp(`(?:^|[\\s"'\`{(])${cls}(?:$|[\\s"'\`})])`);
    return re.test(line);
  });
}

function hasExplicitExemption(line) {
  if (/data-touch-exempt\s*=\s*["']?true["']?/i.test(line)) return true;
  if (/data-testid\s*=\s*["']static["']/i.test(line)) return true;
  return false;
}

const INTERACTIVE_OPEN_RE = /<(button|input|select|textarea)\b/;
const ROLE_BUTTON_RE = /role\s*=\s*["']button["']/;
const ON_CLICK_RE = /\bonClick\s*=\s*\{/;
const ANCHOR_OPEN_RE = /<a\b/;

function isInsidePassiveContext(linesBefore) {
  for (let i = linesBefore.length - 1; i >= Math.max(0, linesBefore.length - 20); i--) {
    const l = linesBefore[i];
    if (/<\/thead>/i.test(l)) return false;
    if (/<thead\b/i.test(l)) return true;
  }
  return false;
}

// Collect the entire JSX opening tag — multi-line in this codebase. We
// track JSX-expression `{...}` brace depth and string quotes so an
// arrow function `=>` or a JSX text comparator inside an expression is
// not mistaken for the tag-closing `>`. Stop at the first `>` (or `/>`)
// that appears at brace-depth 0 outside strings.
function collectTagBody(lines, startIdx) {
  let body = '';
  let braceDepth = 0;
  let inSingle = false, inDouble = false, inBacktick = false;
  for (let i = startIdx; i < Math.min(lines.length, startIdx + 50); i++) {
    const line = lines[i];
    body += line + '\n';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const prev = j > 0 ? line[j - 1] : '';
      // Toggle quotes (ignore escapes — JSX strings don't typically need them
      // here).
      if (!inDouble && !inBacktick && ch === "'" && prev !== '\\') inSingle = !inSingle;
      else if (!inSingle && !inBacktick && ch === '"' && prev !== '\\') inDouble = !inDouble;
      else if (!inSingle && !inDouble && ch === '`' && prev !== '\\') inBacktick = !inBacktick;
      if (inSingle || inDouble || inBacktick) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '>' && braceDepth === 0 && prev !== '=') {
        return body;
      }
    }
  }
  return body;
}

function* walkJsxFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkJsxFiles(full);
    else if (name.endsWith('.jsx')) yield full;
  }
}

function scanRepoForViolations() {
  const violations = [];
  for (const file of walkJsxFiles(COMPONENTS_DIR)) {
    const rel = relative(REPO_ROOT, file);
    const src = readFileSync(file, 'utf-8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('{/*')) continue;
      const isButton = INTERACTIVE_OPEN_RE.test(line);
      const isAnchorWithClick = ANCHOR_OPEN_RE.test(line) && (() => {
        const tagBody = collectTagBody(lines, i);
        return ON_CLICK_RE.test(tagBody);
      })();
      const isRoleButton = ROLE_BUTTON_RE.test(line);
      const isDivWithOnClick =
        !isButton && !isAnchorWithClick &&
        ON_CLICK_RE.test(line) && /<\w+\b/.test(line);
      if (!isButton && !isAnchorWithClick && !isRoleButton && !isDivWithOnClick) continue;
      const tagBody = collectTagBody(lines, i);
      // Skip noise: divs whose only handler is event-bubbling sinks
      // (`e.stopPropagation()`) are containers, not interactive targets.
      if (isDivWithOnClick && /onClick\s*=\s*\{\s*\(?e\)?\s*=>\s*e\.stopPropagation\(\)\s*\}/.test(tagBody)) continue;
      if (/<input\b[^>]*\btype\s*=\s*["']hidden["']/i.test(tagBody)) continue;
      if (hasExplicitExemption(tagBody)) continue;
      if (hasCanonicalClass(tagBody)) continue;
      if (hasInlineMinHeight44(tagBody)) continue;
      if (hasTailwindMinHeight44(tagBody)) continue;
      // Common Tailwind classes that effectively guarantee >=44px on
      // mobile through their layout role: h-full (parent-sized nav
      // cells where the parent is the BottomNav at 64px) and h-screen.
      // These are intentionally exempt — the touch target's height is
      // dictated by the container, not the button itself.
      if (/\b(?:h-full|h-screen|min-h-screen|min-h-full)\b/.test(tagBody)) continue;
      if (isInsidePassiveContext(lines.slice(0, i))) continue;
      violations.push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 160) });
    }
  }
  return violations;
}

const args = process.argv.slice(2);
const violations = scanRepoForViolations();

if (args.includes('--counts')) {
  const counts = {};
  for (const v of violations) counts[v.file] = (counts[v.file] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`Total: ${violations.length} violations across ${sorted.length} files\n`);
  for (const [file, n] of sorted) console.log(`${String(n).padStart(4)}  ${file}`);
} else if (args.includes('--json')) {
  console.log(JSON.stringify(violations, null, 2));
} else if (args.includes('--write')) {
  const out = join(REPO_ROOT, 'scan-output.json');
  writeFileSync(out, JSON.stringify(violations, null, 2));
  console.log(`Wrote ${violations.length} entries to ${out}`);
} else {
  for (const v of violations) console.log(`${v.file}:${v.line} — ${v.snippet}`);
  console.log(`\nTotal: ${violations.length}`);
}
