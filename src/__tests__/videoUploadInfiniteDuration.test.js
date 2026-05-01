/**
 * VideoUpload — non-finite duration handling (TRQ-178).
 *
 * Mark hit "Video must be under 3 minutes (this one is Infinity min)"
 * on a 31-second WhatsApp clip. Root cause: WhatsApp-compressed MP4s
 * ship with the moov atom at the end of the file, and Safari with
 * preload="metadata" can return videoEl.duration = Infinity. Source-
 * level guards make sure the client doesn't reject these uploads.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../components/VideoUpload.jsx'), 'utf8');

describe('VideoUpload non-finite-duration handling', () => {
  test('duration check guarded by Number.isFinite (no false rejection)', () => {
    // The duration > maxDuration comparison must sit inside an
    // isFinite() branch. Otherwise Infinity > 180 is true and a
    // 31-second WhatsApp clip gets the "must be under 3 minutes"
    // error.
    expect(src).toMatch(
      /Number\.isFinite\(videoEl\.duration\)[\s\S]*?if\s*\(videoEl\.duration\s*>\s*maxDurationRef/
    );
  });

  test('formatDuration returns empty string for Infinity / NaN', () => {
    expect(src).toMatch(
      /formatDuration\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?Number\.isFinite\(secs\)[\s\S]*?return ''/
    );
  });

  test('videoEl.onerror logs but does not block (server validates anyway)', () => {
    expect(src).toMatch(/videoEl\.onerror\s*=\s*\(\s*\)\s*=>/);
    expect(src).toMatch(/could not read metadata client-side/);
  });

  test('non-finite-duration branch logs telemetry so we can spot future cases', () => {
    expect(src).toMatch(/non-finite duration/);
    expect(src).toMatch(/deferring duration check to server/);
  });
});
