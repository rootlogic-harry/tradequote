/**
 * hideLabourDays — profile toggle that suppresses the customer-portal's
 * "X days × Y workers" breakdown.
 *
 * Paul, 2026-05-13:
 *   "Is there a way to do it so that I can see the days but the customer
 *    doesn't? I've had a couple who have mentioned 'oh you'll get it done
 *    in 4, someone else said 10'."
 *
 * Tested layers:
 *   1. Reducer initial state                                  (default false)
 *   2. UPDATE_PROFILE round-trips the field                   (read/write)
 *   3. SELECT_USER on a legacy profile (no flag) leaves false (back-compat)
 *   4. ProfileSetup ships a toggle wired to update('hideLabourDays', …)
 *   5. QuoteDocument continues to show NO day breakdown       (regression)
 *
 * Portal renderer behaviour (the actual customer-facing render) is covered
 * separately in portalRenderer.test.js — those tests boot the renderer.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('reducer — hideLabourDays in default profile', () => {
  test('initial state.profile.hideLabourDays defaults to false (opt-in)', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const state = reducer(initialState, { type: '@@INIT' });
    expect(state.profile.hideLabourDays).toBe(false);
  });

  test('UPDATE_PROFILE can flip hideLabourDays true', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'UPDATE_PROFILE',
      updates: { hideLabourDays: true },
    });
    expect(next.profile.hideLabourDays).toBe(true);
    // Other fields untouched.
    expect(next.profile.companyName).toBe(initial.profile.companyName);
    expect(next.profile.vatRegistered).toBe(initial.profile.vatRegistered);
    expect(next.profile.accent).toBe(initial.profile.accent);
  });

  test('SELECT_USER merging a legacy profile (no flag) defaults to false', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'u',
      name: 'U',
      profile: { companyName: 'Old Co', vatRegistered: true }, // no hideLabourDays key
      quoteSequence: 1,
    });
    expect(next.profile.hideLabourDays).toBe(false);
  });

  test('SELECT_USER with hideLabourDays=true round-trips', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'u',
      name: 'U',
      profile: { hideLabourDays: true },
      quoteSequence: 1,
    });
    expect(next.profile.hideLabourDays).toBe(true);
  });
});

describe('ProfileSetup.jsx — toggle UI', () => {
  const src = readFileSync(join(repoRoot, 'src/components/steps/ProfileSetup.jsx'), 'utf8');

  test('renders user-facing copy for the hide-days option', () => {
    // Either "Hide labour days" or "Show labour days" copy is acceptable —
    // either points at the same toggle. The customer-facing surface is what
    // matters; the wording must read as a quote-output preference.
    expect(src).toMatch(/labour days|day breakdown/i);
  });

  test('wires the toggle to UPDATE_PROFILE via update("hideLabourDays", …)', () => {
    expect(src).toMatch(/update\s*\(\s*['"]hideLabourDays['"]/);
  });

  test('lives in the Quote Preferences section alongside showNotesOnQuote', () => {
    // Both flags are quote-output preferences and should share a section so
    // the tradesman finds them together.
    const prefIdx = src.indexOf('Quote Preferences');
    const nextSectionIdx = src.indexOf('Document Type');
    expect(prefIdx).toBeGreaterThan(-1);
    expect(nextSectionIdx).toBeGreaterThan(prefIdx);
    const prefBlock = src.slice(prefIdx, nextSectionIdx);
    expect(prefBlock).toMatch(/hideLabourDays/);
    // Sanity: the other preference still lives here too.
    expect(prefBlock).toMatch(/showNotesOnQuote/);
  });
});

describe('ReviewEdit — Step 4 discoverability indicator', () => {
  // Multi-agent UX review (2026-05-14): when the toggle is on, the
  // tradesman still sees the full days × workers × rate breakdown in
  // Step 4. Without a cue, Paul can forget the customer's view is
  // stripped and get blindsided by "how many days?". A muted pill
  // labelled "hidden from customer" next to the labour breakdown
  // keeps internal/external views in sync.
  const src = readFileSync(join(repoRoot, 'src/components/steps/ReviewEdit.jsx'), 'utf8');

  test('Step 4 labour row conditionally renders a "hidden from customer" indicator', () => {
    expect(src).toMatch(/profile\.hideLabourDays\s*===\s*true/);
    expect(src).toMatch(/hidden from customer/i);
  });

  test('indicator lives inside the labour-row block, not stray text', () => {
    // Anchor: the conditional must appear in the labour summary block,
    // which surrounds the "({labour.days}d × {labour.workers}w" pattern.
    const labourIdx = src.indexOf('{labour.days}d');
    expect(labourIdx).toBeGreaterThan(-1);
    const block = src.slice(labourIdx, labourIdx + 1200);
    expect(block).toMatch(/profile\.hideLabourDays/);
    expect(block).toMatch(/hidden from customer/i);
  });
});

describe('QuoteDocument — regression: never shows day breakdown', () => {
  // QuoteDocument is the PDF / dashboard preview render. It has always shown
  // just "Labour: £X" without the "X days × Y workers" sub-label. This
  // assertion locks that contract so a future refactor can't quietly add
  // the breakdown back in and bypass the hideLabourDays toggle.
  const src = readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8');

  test('labour cell does not interpolate estimatedDays or numberOfWorkers', () => {
    const labourRowIdx = src.indexOf('Labour');
    expect(labourRowIdx).toBeGreaterThan(-1);
    // Take the surrounding block — labour rendering is local to ~40 lines
    // around the "Labour" cell.
    const block = src.slice(Math.max(0, labourRowIdx - 200), labourRowIdx + 400);
    expect(block).not.toMatch(/estimatedDays/);
    expect(block).not.toMatch(/numberOfWorkers/);
    expect(block).not.toMatch(/\bdayRate\b/);
  });
});

describe('QuoteOutput DOCX builder — regression: never shows day breakdown', () => {
  // Same contract for the DOCX export path.
  const src = readFileSync(join(repoRoot, 'src/components/steps/QuoteOutput.jsx'), 'utf8');

  test('docx Labour TableRow does not interpolate days or workers into the label', () => {
    // Match the labour TableRow (it's currently colSpan 4 with the £ total
    // in the 5th cell) and assert no day-count leaks into the label cell.
    const labourRowMatch = src.match(
      /\/\/ Labour row[\s\S]*?new TableRow\(\{[\s\S]*?\}\),?/
    );
    expect(labourRowMatch).not.toBeNull();
    const block = labourRowMatch[0];
    expect(block).not.toMatch(/labour\.days/);
    expect(block).not.toMatch(/labour\.workers/);
    expect(block).not.toMatch(/numberOfWorkers/);
    expect(block).not.toMatch(/estimatedDays/);
  });
});
