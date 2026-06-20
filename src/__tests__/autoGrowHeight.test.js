/**
 * Tests for the AutoGrowTextarea height-capping feature.
 *
 * Mark (2026-06-20): "Can we have a scroll option in the description and
 * schedule of works". The Pro Drive quote has a 3-paragraph damage
 * description and 7 multi-paragraph schedule steps. Today every textarea
 * grows unbounded with its content, so the Review screen scrolls forever
 * on his phone. The fix is a `maxHeight` prop on the shared
 * AutoGrowTextarea — content above the cap scrolls inside the field
 * instead of pushing the page.
 *
 * Two layers (same shape as subscriptionBanner.test.js):
 *
 *   1. Pure-helper tests on `computeAutoGrowHeight` — the height/overflow
 *      decision is the load-bearing logic and is exercised here directly.
 *
 *   2. Source-level regex assertions on AutoGrowTextarea.jsx + the two
 *      consumer call sites, to pin the wiring (Pitfall #11 regression
 *      guard, the fade overlay, and the cap values Mark cares about).
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { computeAutoGrowHeight } from '../utils/autoGrowHeight.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const autoGrowSrc = readFileSync(
  join(repoRoot, 'src/components/common/AutoGrowTextarea.jsx'),
  'utf8'
);
const reviewEditSrc = readFileSync(
  join(repoRoot, 'src/components/steps/ReviewEdit.jsx'),
  'utf8'
);
const scheduleListSrc = readFileSync(
  join(repoRoot, 'src/components/review/ScheduleList.jsx'),
  'utf8'
);

// ────────────────────────────────────────────────────────────────────
// Pure helper — the height/overflow decision
// ────────────────────────────────────────────────────────────────────
describe('computeAutoGrowHeight', () => {
  test('with no maxHeight, height grows to scrollHeight (current behaviour preserved)', () => {
    const res = computeAutoGrowHeight({ scrollHeight: 400, minHeight: 120 });
    expect(res.height).toBe(400);
    expect(res.overflowY).toBe('hidden');
    expect(res.overflowing).toBe(false);
  });

  test('with no maxHeight, height floors at minHeight when content is short', () => {
    const res = computeAutoGrowHeight({ scrollHeight: 40, minHeight: 120 });
    expect(res.height).toBe(120);
    expect(res.overflowY).toBe('hidden');
    expect(res.overflowing).toBe(false);
  });

  test('with maxHeight set + content fits, height equals scrollHeight and overflow stays hidden', () => {
    const res = computeAutoGrowHeight({
      scrollHeight: 180,
      minHeight: 140,
      maxHeight: 240,
    });
    expect(res.height).toBe(180);
    expect(res.overflowY).toBe('hidden');
    expect(res.overflowing).toBe(false);
  });

  test('with maxHeight set + content exceeds it, height caps at maxHeight and overflow becomes auto', () => {
    const res = computeAutoGrowHeight({
      scrollHeight: 600,
      minHeight: 140,
      maxHeight: 240,
    });
    expect(res.height).toBe(240);
    expect(res.overflowY).toBe('auto');
    expect(res.overflowing).toBe(true);
  });

  test('with maxHeight set + content exactly at the cap, treated as fitting (no scroll)', () => {
    const res = computeAutoGrowHeight({
      scrollHeight: 240,
      minHeight: 140,
      maxHeight: 240,
    });
    expect(res.height).toBe(240);
    expect(res.overflowY).toBe('hidden');
    expect(res.overflowing).toBe(false);
  });

  test('minHeight still wins when maxHeight is large and content is tiny', () => {
    const res = computeAutoGrowHeight({
      scrollHeight: 30,
      minHeight: 140,
      maxHeight: 240,
    });
    expect(res.height).toBe(140);
    expect(res.overflowY).toBe('hidden');
    expect(res.overflowing).toBe(false);
  });

  test('returns numbers (not strings) so the caller can compose px units itself', () => {
    const res = computeAutoGrowHeight({
      scrollHeight: 600,
      minHeight: 140,
      maxHeight: 240,
    });
    expect(typeof res.height).toBe('number');
  });
});

// ────────────────────────────────────────────────────────────────────
// Source-level wiring — AutoGrowTextarea.jsx
// ────────────────────────────────────────────────────────────────────
describe('AutoGrowTextarea — maxHeight wiring', () => {
  test('accepts a maxHeight prop in the destructured signature', () => {
    expect(autoGrowSrc).toMatch(/maxHeight/);
    // Destructured as part of the function signature, not just imported
    expect(autoGrowSrc).toMatch(/function AutoGrowTextarea\([\s\S]*?maxHeight[\s\S]*?\)/);
  });

  test('uses the shared computeAutoGrowHeight helper for the height decision', () => {
    expect(autoGrowSrc).toMatch(/computeAutoGrowHeight/);
    expect(autoGrowSrc).toMatch(/from\s+['"][^'"]*autoGrowHeight[^'"]*['"]/);
  });

  test('Pitfall #11 — measurement still runs in useLayoutEffect (not a ref callback)', () => {
    // TRQ-111 / TRQ-114 explicitly forbid the ref-callback pattern because
    // it fires before the value is reliably measurable and does not re-run
    // on prop change. We must keep the useLayoutEffect path.
    expect(autoGrowSrc).toMatch(/useLayoutEffect/);
    // The dependency list MUST include `value` so a typed character
    // triggers re-measurement on the same frame the user sees.
    expect(autoGrowSrc).toMatch(/\[\s*value\s*,[\s\S]*?\]/);
  });

  test('field-sizing native path bails when maxHeight is set (JS path enforces the cap)', () => {
    // Native CSS `field-sizing: content` grows unbounded — it cannot enforce
    // an upper cap or switch overflow to auto. So when maxHeight is set we
    // must take the JS path even on browsers that support field-sizing.
    expect(autoGrowSrc).toMatch(/SUPPORTS_FIELD_SIZING[\s\S]*?maxHeight/);
  });

  test('renders a fade overlay element (the "more below" visual cue)', () => {
    // The overlay sits inside a relative wrapper so it can be positioned
    // at the bottom of the textarea.
    expect(autoGrowSrc).toMatch(/linear-gradient/);
    expect(autoGrowSrc).toMatch(/pointerEvents:\s*['"]none['"]/);
  });

  test('the fade overlay only renders when content is overflowing the cap', () => {
    // Conditionally rendered on `overflowing` state (or equivalent). Without
    // this, the gradient would sit on every capped textarea even when the
    // last line is the literal last line — visually misleading.
    expect(autoGrowSrc).toMatch(/overflowing\s*&&/);
  });
});

// ────────────────────────────────────────────────────────────────────
// Source-level wiring — call sites (Mark's two offenders)
// ────────────────────────────────────────────────────────────────────
describe('Call sites pass the cap Mark asked for', () => {
  test('ReviewEdit damage description passes maxHeight={240}', () => {
    expect(reviewEditSrc).toMatch(/maxHeight=\{240\}/);
  });

  test('ScheduleList step description passes maxHeight={200}', () => {
    expect(scheduleListSrc).toMatch(/maxHeight=\{200\}/);
  });

  test('damage description still sets minHeight={160} so short content stays comfortable', () => {
    // The cap is an upper bound; the existing comfort floor must not regress.
    expect(reviewEditSrc).toMatch(/minHeight=\{160\}/);
  });

  test('schedule step still sets minHeight={140}', () => {
    expect(scheduleListSrc).toMatch(/minHeight=\{140\}/);
  });
});
