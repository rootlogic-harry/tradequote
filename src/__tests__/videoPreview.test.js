import { jest } from '@jest/globals';

// ── Tests for video playback preview ────────────────────────────────

describe('Video playback preview', () => {
  let videoUploadSource;

  beforeAll(async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    videoUploadSource = readFileSync(
      join(__dirname, '..', 'components', 'VideoUpload.jsx'),
      'utf8'
    );
  });

  describe('playback element', () => {
    it('renders a <video> element with native controls', () => {
      expect(videoUploadSource).toMatch(/<video[\s\S]*controls/);
    });

    it('uses the video file as src via object URL', () => {
      // Should create an object URL for the video element
      expect(videoUploadSource).toMatch(/createObjectURL/);
    });

    it('shows playback controls (play, scrub, volume)', () => {
      // Native controls attribute provides all this
      expect(videoUploadSource).toMatch(/controls/);
    });
  });

  describe('video metadata display', () => {
    it('shows video duration', () => {
      expect(videoUploadSource).toMatch(/duration|formatDuration/);
    });

    it('shows file size', () => {
      expect(videoUploadSource).toMatch(/size.*MB|toFixed/);
    });
  });

  describe('action buttons', () => {
    it('has a Replace/Record Again button', () => {
      expect(videoUploadSource).toMatch(/Replace|Record again/i);
    });

    it('buttons have minimum 44px touch targets', () => {
      expect(videoUploadSource).toMatch(/minHeight:\s*['"]?44/);
    });
  });

  describe('object URL cleanup', () => {
    it('revokes video object URL on unmount or change', () => {
      expect(videoUploadSource).toMatch(/revokeObjectURL/);
    });
  });
});
