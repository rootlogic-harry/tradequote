/**
 * SET_VIEW_MODE reducer behaviour + structural lockstep with
 * SavedQuotes.jsx's VIEW_MODES + jobLifecycle.js's bucket functions.
 *
 * Background: 2026-06-30 user-report from Harry — clicking the
 * "Completed (1)" tab in Saved jobs did nothing. Root cause: the
 * reducer's SET_VIEW_MODE guard was written when there were two
 * tabs (Active | Archive) and was never extended for Mark's
 * 2026-06-26 three-tab split. The dispatch fired, the guard
 * rejected mode='completed', state.viewMode stayed 'active', the
 * UI looked frozen.
 *
 * This suite would have caught the bug — three tests:
 *   1. Each allowed mode round-trips through the reducer.
 *   2. Unknown modes are ignored (no phantom state).
 *   3. The reducer's allow-list matches the SavedQuotes VIEW_MODES
 *      constant exactly, so the next time a tab is added the gap
 *      can't reopen silently.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { reducer, initialState } from '../reducer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const reducerSrc = readFileSync(join(repoRoot, 'src/reducer.js'), 'utf8');
const savedQuotesSrc = readFileSync(
  join(repoRoot, 'src/components/SavedQuotes.jsx'),
  'utf8'
);

describe('SET_VIEW_MODE — reducer behaviour', () => {
  test('default viewMode is "active"', () => {
    expect(initialState.viewMode).toBe('active');
  });

  test.each([
    ['active'],
    ['completed'],
    ['archive'],
  ])('accepts mode="%s" and updates viewMode', (mode) => {
    const state = { ...initialState, viewMode: 'active' };
    const result = reducer(state, { type: 'SET_VIEW_MODE', mode });
    expect(result.viewMode).toBe(mode);
  });

  test('completed mode actually transitions state (Harry 2026-06-30 regression)', () => {
    // The original bug. State must move from active → completed.
    const state = { ...initialState, viewMode: 'active' };
    const result = reducer(state, { type: 'SET_VIEW_MODE', mode: 'completed' });
    expect(result.viewMode).toBe('completed');
    expect(result).not.toBe(state); // new reference, not same-object
  });

  test('ignores unknown modes (no phantom state)', () => {
    const state = { ...initialState, viewMode: 'active' };
    for (const mode of ['draft', 'sent', 'random', '', null, undefined]) {
      const result = reducer(state, { type: 'SET_VIEW_MODE', mode });
      expect(result.viewMode).toBe('active');
    }
  });
});

describe('SET_VIEW_MODE — structural lockstep with the UI', () => {
  test('reducer allow-list matches SavedQuotes VIEW_MODES exactly', () => {
    // Extract the ALLOWED list from the reducer source.
    const reducerMatch = reducerSrc.match(
      /case ['"]SET_VIEW_MODE['"][\s\S]*?const ALLOWED = \[([^\]]+)\]/
    );
    expect(reducerMatch).not.toBeNull();
    const reducerAllowed = reducerMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .sort();

    // Extract VIEW_MODES from SavedQuotes.jsx.
    const uiMatch = savedQuotesSrc.match(
      /const VIEW_MODES\s*=\s*\[([^\]]+)\]/
    );
    expect(uiMatch).not.toBeNull();
    const uiModes = uiMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
      .sort();

    // Locked-step invariant — when a new tab is added (or removed),
    // both lists must update together. Otherwise the new tab does
    // nothing and the bug silently reopens.
    expect(reducerAllowed).toEqual(uiModes);
  });

  test('reducer allow-list contains the three known buckets', () => {
    const reducerMatch = reducerSrc.match(
      /case ['"]SET_VIEW_MODE['"][\s\S]*?const ALLOWED = \[([^\]]+)\]/
    );
    const allowed = reducerMatch[1];
    expect(allowed).toMatch(/['"]active['"]/);
    expect(allowed).toMatch(/['"]completed['"]/);
    expect(allowed).toMatch(/['"]archive['"]/);
  });
});
