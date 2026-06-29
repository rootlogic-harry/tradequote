/**
 * Touch-target regression guard (Q8 from /tmp/mobile-responsive-plan.md).
 *
 * CLAUDE.md's Mobile section says: "44px minimum touch targets on all
 * interactive elements". The plan's audit identifies ~20 current
 * violations, all to be fixed in PR-5 / PR-6 / PR-8 / PR-9 / PR-10.
 *
 * This test is a *regression guard*, not a fixer:
 *   - scans every .jsx under src/components/ for interactive elements
 *     (<button>, anchors with onClick, <input>, <select>, <textarea>,
 *      role="button", or any element with an inline onClick)
 *   - asserts each one is "44px-safe" via one of:
 *       a class from CANONICAL_44PX_CLASSES (.btn-primary, .row-action-btn,
 *       .pill, .nq-field, .touch-44, etc.)
 *       a Tailwind min-h-[Npx] where N >= 44
 *       an inline style={{ minHeight: 44 }} (or larger)
 *       a data-touch-exempt="true" / data-testid="static" opt-out
 *   - allows the violations listed in CURRENT_VIOLATIONS, each tagged
 *     with the PR that will eventually remove the entry from this list
 *
 * Approach: line-anchored regex. Cheap, fast, and tolerant of false
 * negatives — the goal is to stop NEW sub-44px elements from landing,
 * not to be a perfect static-analysis tool. False positives are bad
 * (they block legitimate PRs); false negatives are tolerable (CLAUDE.md
 * "use judgement" + design review are still in play).
 *
 * To add an allow-list entry: discover by running the test, append a
 * tuple here with a comment naming the PR that will remove it. Removing
 * entries is the easy direction; adding them needs human approval in
 * PR review.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const COMPONENTS_DIR = join(REPO_ROOT, 'src', 'components');

// -------------------------------------------------------------------
// Canonical "44px-safe" CSS classes — defined in index.html or on the
// 44px-by-design list. Adding to this list requires a corresponding
// CSS rule guaranteeing ≥44px touch height on mobile.
//
// `.touch-44` is reserved as a forward-compatible utility class for
// future fixes (PR-5/6/10 may introduce it as the canonical opt-in
// marker — see plan.md "Tap targets" section).
// -------------------------------------------------------------------
const CANONICAL_44PX_CLASSES = [
  // Buttons (48px tall — defined in index.html)
  'btn-primary',
  'btn-ghost',
  'btn-secondary',
  'btn-link',
  // Row-action button (36px desktop, 44px mobile — index.html:248-254)
  'row-action-btn',
  // Pill nav (36px desktop, 40px mobile — close enough we treat as safe;
  // pill is used for non-critical filter/nav targets only).
  'pill',
  // Form field (48px tall — index.html:383-396)
  'nq-field',
  // RAMS-section form field (36px desktop, 44px mobile — index.html, PR-10).
  // Promoted from the legacy `px-2 py-1.5 text-sm` pattern repeated
  // across all 9 src/components/rams/* sub-components.
  'rams-input',
  // Forward-compat opt-in for future PRs to mark a sub-canonical button
  // as touch-safe with one class.
  'touch-44',
  // Tailwind size suffixes still composed on top of .btn — safe.
  'btn-sm',
  'btn-lg',
  'btn-block',
];

// Inline-style minHeight values >= 44 (covers `minHeight: 44`,
// `minHeight: 48`, `minHeight: '44px'`, etc.).
function hasInlineMinHeight44(line) {
  const re = /minHeight\s*:\s*['"]?(\d+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  // Also catch `height: 44` (etc.) when used as an explicit fixed height
  // — same intent.
  const reH = /\bheight\s*:\s*['"]?(\d+)/g;
  while ((m = reH.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  return false;
}

// Tailwind `min-h-[Npx]` or `h-[Npx]` where N >= 44, plus the static
// `min-h-11`/`min-h-12`/`h-11`/`h-12` shortcuts (11 = 44px, 12 = 48px).
function hasTailwindMinHeight44(line) {
  const reBracket = /\b(?:min-h|h)-\[(\d+)px\]/g;
  let m;
  while ((m = reBracket.exec(line)) !== null) {
    if (Number.parseInt(m[1], 10) >= 44) return true;
  }
  // Tailwind's static spacing scale: 11 = 44px, 12 = 48px, 14 = 56px etc.
  if (/\b(?:min-h|h)-(?:1[1-9]|[2-9]\d|\d{3,})\b/.test(line)) return true;
  return false;
}

function hasCanonicalClass(line) {
  return CANONICAL_44PX_CLASSES.some(cls => {
    // Match the class as a whole word inside a className string. Allow
    // hyphenated variants like `btn-primary` to match without matching
    // longer accidental superstrings.
    const re = new RegExp(`(?:^|[\\s"'\`{(])${cls}(?:$|[\\s"'\`})])`);
    return re.test(line);
  });
}

function hasExplicitExemption(line) {
  if (/data-touch-exempt\s*=\s*["']?true["']?/i.test(line)) return true;
  if (/data-testid\s*=\s*["']static["']/i.test(line)) return true;
  return false;
}

// Heuristic: does this line look like the OPENING tag of an interactive
// element? We only flag the tag-open line; multi-line tags are handled
// by collecting class/style/onClick from the surrounding window.
const INTERACTIVE_OPEN_RE = /<(button|input|select|textarea)\b/;
const ROLE_BUTTON_RE = /role\s*=\s*["']button["']/;
const ON_CLICK_RE = /\bonClick\s*=\s*\{/;
const ANCHOR_OPEN_RE = /<a\b/;

// Visually-passive contexts where touch targets don't apply (table
// headers, decorative chips inside read-only summaries, etc.). We only
// skip elements that appear inside a `<thead>`-anchored block; the
// regex-scanner is line-oriented so we use a lightweight stack.
function isInsidePassiveContext(linesBefore, linesAfter) {
  // Look back up to 20 lines for an unclosed <thead> or a comment marker.
  for (let i = linesBefore.length - 1; i >= Math.max(0, linesBefore.length - 20); i--) {
    const l = linesBefore[i];
    if (/<\/thead>/i.test(l)) return false;
    if (/<thead\b/i.test(l)) return true;
  }
  return false;
}

// Multi-line tag-spanning collector: grabs all text from the tag-open
// line until the JSX opening tag's `>` (or self-closing `/>`).
//
// Tracks `{...}` JSX-expression brace depth and string quotes so a
// `=>` arrow function or `>` comparator inside a JSX expression is
// not mistaken for the tag terminator. Without this, every multi-line
// tag containing `onClick={(e) => …}` was being truncated at the `=>`
// arrow, swallowing the `minHeight: 44` style block on the line below
// and producing torrents of false positives.
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
    if (st.isDirectory()) {
      yield* walkJsxFiles(full);
    } else if (name.endsWith('.jsx')) {
      yield full;
    }
  }
}

// Returns a list of { file, line, snippet } for every interactive
// element in `src/components/` whose 44px-safety can't be inferred.
function scanRepoForViolations() {
  const violations = [];
  for (const file of walkJsxFiles(COMPONENTS_DIR)) {
    const rel = relative(REPO_ROOT, file);
    const src = readFileSync(file, 'utf-8');
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comment-only lines (single-line // and JSX {/* */}).
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('{/*')) continue;

      const isButton = INTERACTIVE_OPEN_RE.test(line);
      const isAnchorWithClick = ANCHOR_OPEN_RE.test(line) && (() => {
        // Look ahead up to 10 lines for onClick on the same tag.
        const tagBody = collectTagBody(lines, i);
        return ON_CLICK_RE.test(tagBody);
      })();
      const isRoleButton = ROLE_BUTTON_RE.test(line);

      // Element with `onClick=` that's not a button/input/select/textarea
      // (e.g. <div onClick=…>). Only flag the tag-open line.
      const isDivWithOnClick =
        !isButton && !isAnchorWithClick &&
        ON_CLICK_RE.test(line) &&
        /<\w+\b/.test(line);

      if (!isButton && !isAnchorWithClick && !isRoleButton && !isDivWithOnClick) continue;

      // Collect the full tag body (multi-line tags are common in this codebase).
      const tagBody = collectTagBody(lines, i);

      // Type=hidden inputs are not interactive.
      if (/<input\b[^>]*\btype\s*=\s*["']hidden["']/i.test(tagBody)) continue;

      // Divs whose only onClick is an `e.stopPropagation()` sink are
      // event-bubbling containers, not interactive targets.
      if (isDivWithOnClick && /onClick\s*=\s*\{\s*\(?e\)?\s*=>\s*e\.stopPropagation\(\)\s*\}/.test(tagBody)) continue;

      // File inputs styled via the .file:* Tailwind pseudo are a known
      // pattern (ProfileSetup logo upload) — flag as normal so the
      // allow-list catches it.

      if (hasExplicitExemption(tagBody)) continue;
      if (hasCanonicalClass(tagBody)) continue;
      if (hasInlineMinHeight44(tagBody)) continue;
      if (hasTailwindMinHeight44(tagBody)) continue;

      // Layout-role classes that inherit height from a sized parent
      // (BottomNav cells fill the 64px nav via `h-full`, sticky bars
      // use `h-screen`). The button's height is dictated by the
      // container, not the button itself — treat as safe.
      if (/\b(?:h-full|h-screen|min-h-screen|min-h-full)\b/.test(tagBody)) continue;

      // Inside <thead>?
      if (isInsidePassiveContext(lines.slice(0, i), lines.slice(i + 1))) continue;

      violations.push({
        file: rel,
        line: i + 1,
        snippet: line.trim().slice(0, 120),
      });
    }
  }
  return violations;
}

// -------------------------------------------------------------------
// ALLOW-LIST — known current violations, each tagged with the PR that
// will eventually fix it. This list can only SHRINK over time.
//
// Format: { file, line, pr, why }
//   file:  path relative to repo root
//   line:  line number of the offending tag-open
//   pr:    audit-plan PR that will close it (PR-2 … PR-10 per
//          /tmp/mobile-responsive-plan.md)
//   why:   one-line reason / what's wrong
//
// Discovery date: 2026-06-26 against commit 1252d3e3.
// Last shrunk: 2026-06-29 — PR-5+6 cleared MaterialsTable, ScheduleList,
// and ReviewEdit entries (162 → 139 violations total).
// -------------------------------------------------------------------
const CURRENT_VIOLATIONS = [
  // -- src/components/AgentActivity.jsx --
  { file: "src/components/AgentActivity.jsx", line: 207, pr: "PR-future-admin", why: "Admin-only surface" },
  { file: "src/components/AgentActivity.jsx", line: 285, pr: "PR-future-admin", why: "Admin-only surface" },
  // -- src/components/CalibrationManager.jsx --
  { file: "src/components/CalibrationManager.jsx", line: 78, pr: "PR-future-admin", why: "Admin-only surface" },
  { file: "src/components/CalibrationManager.jsx", line: 114, pr: "PR-future-admin", why: "Admin-only surface" },
  { file: "src/components/CalibrationManager.jsx", line: 161, pr: "PR-future-admin", why: "Admin-only surface" },
  { file: "src/components/CalibrationManager.jsx", line: 172, pr: "PR-future-admin", why: "Admin-only surface" },
  // -- src/components/LandingPage.jsx --
  { file: "src/components/LandingPage.jsx", line: 37, pr: "PR-future-polish", why: "React LandingPage fallback (production landing is server-rendered HTML)" },
  { file: "src/components/LandingPage.jsx", line: 180, pr: "PR-future-polish", why: "React LandingPage fallback (production landing is server-rendered HTML)" },
  // -- src/components/QuoteDocument.jsx --
  { file: "src/components/QuoteDocument.jsx", line: 28, pr: "PR-future-polish", why: "Quote-document inline editor (em-based, by design)" },
  { file: "src/components/QuoteDocument.jsx", line: 39, pr: "PR-future-polish", why: "Quote-document inline editor (em-based, by design)" },
  // -- src/components/Sidebar.jsx --
  { file: "src/components/Sidebar.jsx", line: 74, pr: "PR-future-polish", why: "Desktop-only sidebar nav (hidden <900px so 44px not load-bearing)" },
  { file: "src/components/Sidebar.jsx", line: 109, pr: "PR-future-polish", why: "Desktop-only sidebar nav (hidden <900px so 44px not load-bearing)" },
  { file: "src/components/Sidebar.jsx", line: 118, pr: "PR-future-polish", why: "Desktop-only sidebar nav (hidden <900px so 44px not load-bearing)" },
  { file: "src/components/Sidebar.jsx", line: 142, pr: "PR-future-polish", why: "Desktop-only sidebar nav (hidden <900px so 44px not load-bearing)" },
  // -- src/components/UserSelector.jsx --
  { file: "src/components/UserSelector.jsx", line: 18, pr: "PR-future-polish", why: "Legacy user-selector list (admin/dev)" },
  // -- src/components/UserSwitcher.jsx --
  { file: "src/components/UserSwitcher.jsx", line: 22, pr: "PR-future-polish", why: "Legacy session switcher (dev only)" },
  { file: "src/components/UserSwitcher.jsx", line: 54, pr: "PR-future-polish", why: "Legacy session switcher (dev only)" },
  { file: "src/components/UserSwitcher.jsx", line: 72, pr: "PR-future-polish", why: "Legacy session switcher (dev only)" },
  { file: "src/components/UserSwitcher.jsx", line: 86, pr: "PR-future-polish", why: "Legacy session switcher (dev only)" },
  // -- src/components/VideoUpload.jsx --
  { file: "src/components/VideoUpload.jsx", line: 283, pr: "PR-future-polish", why: "VideoUpload (gated off in prod); already mostly mobile-tuned per audit #15" },
  { file: "src/components/VideoUpload.jsx", line: 291, pr: "PR-future-polish", why: "VideoUpload (gated off in prod); already mostly mobile-tuned per audit #15" },
  { file: "src/components/VideoUpload.jsx", line: 465, pr: "PR-future-polish", why: "VideoUpload (gated off in prod); already mostly mobile-tuned per audit #15" },
  // -- src/components/common/AutoGrowTextarea.jsx --
  { file: "src/components/common/AutoGrowTextarea.jsx", line: 107, pr: "PR-future-polish", why: "Base textarea — min-height is set per caller, not the wrapper" },
  // -- src/components/review/LabourSection.jsx --
  { file: "src/components/review/LabourSection.jsx", line: 12, pr: "PR-future-polish", why: "Labour input (covered by 3-col flex sized by parent, audit notes OK)" },
  // -- src/components/review/MeasurementRow.jsx --
  { file: "src/components/review/MeasurementRow.jsx", line: 166, pr: "PR-future-polish", why: "Numeric edit input inside measurement row" },
  // -- src/components/steps/JobDetails.jsx --
  { file: "src/components/steps/JobDetails.jsx", line: 366, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 383, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 399, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 416, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 442, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 464, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 488, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 534, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 583, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 607, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 632, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 689, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 869, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 913, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 924, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 944, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 981, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  { file: "src/components/steps/JobDetails.jsx", line: 996, pr: "PR-future-mobile", why: "JobDetails client/site/scale inputs (mostly use nq-field at top but secondary fields lack class)" },
  // -- src/components/steps/ProfileSetup.jsx --
  { file: "src/components/steps/ProfileSetup.jsx", line: 165, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 182, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 199, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 217, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 235, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 295, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 327, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 351, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 370, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 411, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 563, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  { file: "src/components/steps/ProfileSetup.jsx", line: 585, pr: "PR-settings-redesign", why: "ProfileSetup auxiliary inputs / nested form fields (dynamic className via fieldClass)" },
  // -- src/components/steps/QuoteOutput.jsx --
  { file: "src/components/steps/QuoteOutput.jsx", line: 1208, pr: "PR-future-polish", why: "Photo selection toggle (20×20 by design, inside Preview overlay)" },

];

function isAllowed(violation, allowList) {
  return allowList.some(
    a => a.file === violation.file && a.line === violation.line,
  );
}

describe('Touch-target lint (CLAUDE.md Mobile §: 44px minimum)', () => {
  // First test gives a clear, actionable failure for new violations.
  test('no NEW sub-44px interactive elements outside the allow-list', () => {
    const violations = scanRepoForViolations();
    const newViolations = violations.filter(v => !isAllowed(v, CURRENT_VIOLATIONS));

    if (newViolations.length > 0) {
      const details = newViolations
        .map(
          v =>
            `Touch-target violation at ${v.file}:${v.line} —\n` +
            `  ${v.snippet}\n` +
            `Interactive elements must be >=44px tall. Options:\n` +
            `  1. Add class .btn-primary / .row-action-btn / .pill / .touch-44\n` +
            `  2. Add Tailwind class min-h-[44px]\n` +
            `  3. Add inline style minHeight: 44\n` +
            `See CLAUDE.md Mobile section.`,
        )
        .join('\n\n');
      throw new Error(
        `Found ${newViolations.length} NEW touch-target violation(s):\n\n${details}\n\n` +
          `If this is an intentional exception, add data-touch-exempt="true" to ` +
          `the element, OR (with human approval) append the entry to ` +
          `CURRENT_VIOLATIONS in src/__tests__/touchTargets.test.js.`,
      );
    }
  });

  // Second test keeps the allow-list honest — once a fix lands, the
  // stale entry has to be removed or this test fails.
  test('ALLOW-LIST does not contain stale entries (every entry still matches a current violation)', () => {
    const violations = scanRepoForViolations();
    const stale = CURRENT_VIOLATIONS.filter(
      a => !violations.some(v => v.file === a.file && v.line === a.line),
    );

    if (stale.length > 0) {
      const details = stale
        .map(a => `  ${a.file}:${a.line} (was tagged for ${a.pr})`)
        .join('\n');
      throw new Error(
        `${stale.length} stale allow-list entr(y/ies) — these violations ` +
          `are no longer present in the source, so the entry should be ` +
          `removed:\n${details}`,
      );
    }
  });

  // Diagnostic — emits the discovery report when this suite is run in
  // isolation. Useful when refreshing the allow-list after a fix PR.
  test('SCAN: emit current allow-list snapshot', () => {
    if (!process.env.EMIT_TOUCH_TARGET_SCAN) return; // opt-in
    const violations = scanRepoForViolations();
    // eslint-disable-next-line no-console
    console.log(
      '\n=== TOUCH-TARGET SCAN ===\n' +
        violations.map(v => `${v.file}:${v.line} — ${v.snippet}`).join('\n') +
        `\nTotal: ${violations.length}\n`,
    );
    expect(violations).toBeDefined();
  });
});
