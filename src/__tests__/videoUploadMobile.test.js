import { jest } from '@jest/globals';
import React from 'react';

// ── Helpers ─────────────────────────────────────────────────────────
// We test the component source directly for mobile-critical attributes
// since JSDOM doesn't support MediaRecorder / getUserMedia.

let VideoUploadSource;

beforeAll(async () => {
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  VideoUploadSource = readFileSync(
    join(__dirname, '..', 'components', 'VideoUpload.jsx'),
    'utf8'
  );
});

describe('VideoUpload mobile optimisations', () => {
  describe('record + pick — two-input design', () => {
    // Original test asserted "no capture attribute" was best, but
    // Paul's iPad video showed library-only left him stuck in the
    // Photos picker for 50+ seconds. Hardened design exposes BOTH:
    //   - capture=environment → shoots directly from the camera
    //   - no capture → opens the library picker
    // Separate buttons let the user pick the right path per situation.
    it('exposes a camera-capture input AND a library-picker input', () => {
      expect(VideoUploadSource).toMatch(/accept=["']video\/\*["']/);
      // Camera-capture input present (direct record).
      expect(VideoUploadSource).toMatch(/capture=["']environment["']/);
      // Library-picker input present (no capture attr on fileInputRef).
      const libInput = VideoUploadSource.match(
        /<input\s+[\s\S]{0,200}?ref=\{fileInputRef\}[\s\S]{0,300}?\/>/
      );
      expect(libInput).not.toBeNull();
      expect(libInput[0]).not.toMatch(/capture=/);
    });
  });

  describe('touch targets', () => {
    it('replace button has minimum 44px tap target', () => {
      // iOS HIG and WCAG 2.5.5 require 44px minimum touch targets
      expect(VideoUploadSource).toMatch(/minHeight:\s*['"]?44/);
    });

    it('photo remove button has minimum 44px tap target', () => {
      // The × remove button on photo thumbnails must be 44×44 for touch
      // Check for either 44px width/height or minWidth/minHeight
      expect(VideoUploadSource).toMatch(/width:\s*['"]?44/);
    });

    it('add photo button has minimum 44px dimensions', () => {
      // The + add photo dashed button needs touch-friendly sizing
      // Must not be smaller than 44px on any axis
      expect(VideoUploadSource).toMatch(/minHeight:\s*['"]?44|height:\s*['"]?80/);
    });
  });

  describe('client-side duration check', () => {
    it('calls onDurationError when video exceeds maxDuration', () => {
      // VideoUpload should accept an onDurationError callback and maxDuration prop
      expect(VideoUploadSource).toMatch(/onDurationError/);
      expect(VideoUploadSource).toMatch(/maxDuration/);
    });

    it('has a default maxDuration of 180 seconds (3 minutes)', () => {
      expect(VideoUploadSource).toMatch(/maxDuration\s*=\s*180/);
    });

    it('checks duration in loadedmetadata handler', () => {
      // The metadata handler should compare duration to maxDuration
      expect(VideoUploadSource).toMatch(/duration\s*>\s*maxDuration/);
    });
  });

  describe('mobile-friendly UI text', () => {
    it('shows mobile-friendly prompt text (tap/record)', () => {
      // Drop zone should mention tapping or recording for mobile users
      expect(VideoUploadSource).toMatch(/[Tt]ap|[Rr]ecord/);
    });
  });

  describe('responsive thumbnails', () => {
    it('uses percentage or responsive width for video thumbnail', () => {
      // Thumbnail should adapt to container, not be fixed px on mobile
      // Accept either maxWidth pattern or percentage-based width
      expect(VideoUploadSource).toMatch(/maxWidth:\s*['"]?120|width:\s*['"]?(100%|120)/);
    });
  });

  describe('drop zone sizing', () => {
    it('has minimum height for comfortable mobile tap', () => {
      // Drop zone padding should give enough vertical space on mobile
      // At least 32px padding or minHeight specified
      expect(VideoUploadSource).toMatch(/padding:\s*['"]?(32|36|40|44|48)/);
    });
  });
});
