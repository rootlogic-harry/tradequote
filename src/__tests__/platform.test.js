/**
 * shouldUseShareSheetPath — picks iPad/iPhone/Android path for
 * "Send via Outlook". See TRQ-141 follow-up: Paul's iPad test hit a
 * print dialog because Safari has no .eml handler; the fix is to use
 * the Web Share API with the PDF itself on iOS / Android.
 */
import { shouldUseShareSheetPath } from '../utils/platform.js';

const withCanShare = (overrides = {}) => ({
  canShare: () => true,
  maxTouchPoints: 0,
  userAgent: '',
  ...overrides,
});

describe('shouldUseShareSheetPath', () => {
  test('iPad (classic UA) → true', () => {
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    }))).toBe(true);
  });

  test('iPadOS 13+ masquerading as Macintosh → true (touch points disambiguate)', () => {
    // iPadOS 13+ reports as Macintosh in UA by default. Without the
    // touch-point check we\'d mis-classify it as desktop and ship Paul
    // the broken .eml path again.
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    }))).toBe(true);
  });

  test('iPhone → true', () => {
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    }))).toBe(true);
  });

  test('Android → true', () => {
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
      maxTouchPoints: 5,
    }))).toBe(true);
  });

  test('macOS desktop Safari → false (Paul\'s Windows box analogue)', () => {
    // Real Mac has maxTouchPoints: 0. Desktop Mail.app handles .eml
    // fine, so we want the .eml download path here.
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 0,
    }))).toBe(false);
  });

  test('Windows desktop Chrome → false', () => {
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      maxTouchPoints: 0,
    }))).toBe(false);
  });

  test('browser without canShare (older desktop) → false (no share sheet exists)', () => {
    expect(shouldUseShareSheetPath({
      userAgent: 'Mozilla/5.0 (iPad; …)',
      maxTouchPoints: 5,
      // no canShare
    })).toBe(false);
  });

  test('no navigator at all (SSR / Node) → false', () => {
    expect(shouldUseShareSheetPath(null)).toBe(false);
  });

  test('touchscreen Windows laptop → false (desktop UA, not iOS/Android)', () => {
    // Some Windows laptops report touch points but aren\'t iPads.
    // They have Outlook installed, so the .eml path is right for them.
    expect(shouldUseShareSheetPath(withCanShare({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      maxTouchPoints: 10,
    }))).toBe(false);
  });
});
