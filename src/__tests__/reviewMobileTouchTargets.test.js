/**
 * Mobile PR-5+6 — Review touch targets + Materials mobile cards.
 *
 * Closes audit items 5, 6, 13 from /tmp/mobile-responsive-plan.md.
 *
 * Source-scan tests pinning the load-bearing layout/touch-target
 * decisions so a future rebase or refactor can't silently regress them.
 * Behaviour is tested elsewhere (componentCrashSafety, autoGrowHeight,
 * touchTargets); this suite captures the SHAPE.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const materialsTable = readFileSync(
  join(repoRoot, 'src/components/review/MaterialsTable.jsx'),
  'utf8',
);
const scheduleList = readFileSync(
  join(repoRoot, 'src/components/review/ScheduleList.jsx'),
  'utf8',
);
const reviewEdit = readFileSync(
  join(repoRoot, 'src/components/steps/ReviewEdit.jsx'),
  'utf8',
);
const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');

describe('PR-6 — MaterialsTable mobile cards re-flow', () => {
  test('mobile card grid uses grid-cols-2, not grid-cols-4', () => {
    // Mobile card field grid should be 2-column so Qty / Unit / Rate /
    // Total each get half the row width — the 4-col layout cramped them
    // below the iPhone 13 tap-target threshold.
    expect(materialsTable).toMatch(/grid grid-cols-2 gap-3/);
    // And the old 4-col layout must NOT come back.
    expect(materialsTable).not.toMatch(/grid grid-cols-4/);
  });

  test('mobile card has explicit up/down move buttons (not just drag)', () => {
    // The drag-reorder mechanism only fires on desktop; mobile needs
    // explicit ↑ / ↓ buttons or reordering is impossible on touch.
    expect(materialsTable).toMatch(/aria-label="Move material up"/);
    expect(materialsTable).toMatch(/aria-label="Move material down"/);
  });

  test('mobile up/down move buttons get .touch-44 hit area', () => {
    // The buttons render as small ↑/↓ glyphs — without an explicit
    // 44×44 wrapper they'd be sub-target.
    const upMatch = materialsTable.match(
      /onClick=\{\(\) => moveItem\(i, i - 1\)\}[\s\S]*?className="([^"]+)"/,
    );
    const downMatch = materialsTable.match(
      /onClick=\{\(\) => moveItem\(i, i \+ 1\)\}[\s\S]*?className="([^"]+)"/,
    );
    expect(upMatch).not.toBeNull();
    expect(downMatch).not.toBeNull();
    expect(upMatch[1]).toMatch(/\btouch-44\b/);
    expect(downMatch[1]).toMatch(/\btouch-44\b/);
  });

  test('description input in mobile card is at least 44px tall', () => {
    // Mobile card description input — `min-h-[44px]`.
    expect(materialsTable).toMatch(
      /placeholder="Description"[\s\S]{0,300}min-h-\[44px\]|min-h-\[44px\][\s\S]{0,300}placeholder="Description"/,
    );
  });

  test('desktop table inputs also bumped to >=44px', () => {
    // Even though the desktop table is `hidden fq:block`, the touch-
    // target lint scans every <input>; bumping them keeps the rule
    // simple and gives Mark a comfortable tap area on the 768px iPad
    // breakpoint where the desktop layout is still shown.
    expect(materialsTable).toMatch(/inputClass[\s\S]{0,400}min-h-\[44px\]/);
  });
});

describe('PR-5 — ScheduleList touch targets', () => {
  test('step title input is at least 44px tall on mobile', () => {
    expect(scheduleList).toMatch(
      /placeholder="Step title"[\s\S]{0,200}min-h-\[44px\]|min-h-\[44px\][\s\S]{0,200}placeholder="Step title"/,
    );
  });

  test('step × remove button uses .touch-44', () => {
    const removeMatch = scheduleList.match(
      /onClick=\{\(\) => removeStep\(i\)\}[\s\S]*?className="([^"]+)"/,
    );
    expect(removeMatch).not.toBeNull();
    expect(removeMatch[1]).toMatch(/\btouch-44\b/);
  });
});

describe('PR-5 — ReviewEdit touch targets', () => {
  test('mobile AccordionSection toggle button has 44px minHeight', () => {
    // Section header buttons (Measurements / Costs / Schedule / Damage)
    // are the primary mobile nav — must hit 44px.
    expect(reviewEdit).toMatch(
      /onClick=\{onToggle\}[\s\S]{0,400}minHeight:\s*44/,
    );
  });

  test('transcript section toggle button has 44px minHeight', () => {
    expect(reviewEdit).toMatch(
      /onClick=\{\(\) => toggleSection\('transcript'\)\}[\s\S]{0,400}minHeight:\s*44/,
    );
  });

  test('additional cost label + amount inputs are >=44px', () => {
    // The Travel / Accommodation / Skip hire row.
    expect(reviewEdit).toMatch(
      /placeholder="Label"[\s\S]{0,300}min-h-\[44px\]|min-h-\[44px\][\s\S]{0,300}placeholder="Label"/,
    );
  });

  test('+ Travel / + Accommodation / + Skip hire / + Add cost buttons are touch-44', () => {
    const lines = reviewEdit.split('\n');
    const wanted = ['+ Travel', '+ Accommodation', '+ Skip hire', '+ Add cost'];
    for (const label of wanted) {
      const lineIdx = lines.findIndex((l) => l.includes(label));
      expect(lineIdx).toBeGreaterThan(-1);
      // Walk back up to 5 lines to find the className.
      const window = lines.slice(Math.max(0, lineIdx - 5), lineIdx + 1).join('\n');
      expect(window).toMatch(/\btouch-44\b/);
    }
  });

  test('notes editor × remove + + Add note are touch-44', () => {
    // Notes-list × buttons.
    expect(reviewEdit).toMatch(
      /UPDATE_NOTES[\s\S]{0,400}touch-44[\s\S]{0,100}aria-label="Remove note"/,
    );
    // + Add note button.
    expect(reviewEdit).toMatch(
      /\+ Add note[\s\S]{0,50}/,
    );
    const addNoteIdx = reviewEdit.indexOf('+ Add note');
    expect(addNoteIdx).toBeGreaterThan(-1);
    // Look back for the className on the enclosing button.
    const before = reviewEdit.slice(Math.max(0, addNoteIdx - 400), addNoteIdx);
    expect(before).toMatch(/\btouch-44\b/);
  });

  test('notes textarea is at least 44px tall', () => {
    // Each note row has a <textarea rows={2} ...>. Min-height keeps it
    // a comfortable tap on mobile when collapsed.
    expect(reviewEdit).toMatch(
      /rows=\{2\}[\s\S]{0,300}min-h-\[44px\]/,
    );
  });
});

describe('PR-5+6 — .touch-44 utility is defined in index.html', () => {
  test('.touch-44 CSS rule exists with min-height >= 44px', () => {
    // Match the rule even if it gets reformatted slightly. Capture the
    // declarations and assert min-height covers 44px.
    const ruleMatch = indexHtml.match(/\.touch-44\s*\{[^}]+\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch[0]).toMatch(/min-height:\s*44px/);
  });
});
