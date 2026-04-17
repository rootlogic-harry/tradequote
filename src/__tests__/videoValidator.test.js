import { jest } from '@jest/globals';

// ── Pure duration validation (no ffmpeg) ────────────────────────────

const { validateVideoDuration } = await import('../utils/videoValidator.js');

describe('validateVideoDuration', () => {
  it('rejects video over 180 seconds', () => {
    const result = validateVideoDuration(200);
    expect(result).toEqual({ valid: false, error: 'Video must be under 3 minutes' });
  });

  it('accepts video at exactly 180 seconds', () => {
    const result = validateVideoDuration(180);
    expect(result).toEqual({ valid: true });
  });

  it('accepts video under 180 seconds', () => {
    const result = validateVideoDuration(90);
    expect(result).toEqual({ valid: true });
  });

  it('rejects zero-duration video', () => {
    const result = validateVideoDuration(0);
    expect(result).toEqual({ valid: false, error: 'Video appears to be empty' });
  });

  it('rejects negative duration', () => {
    const result = validateVideoDuration(-1);
    expect(result).toEqual({ valid: false, error: 'Video appears to be empty' });
  });

  it('rejects NaN duration', () => {
    const result = validateVideoDuration(NaN);
    expect(result).toEqual({ valid: false, error: 'Video appears to be empty' });
  });

  it('rejects undefined duration', () => {
    const result = validateVideoDuration(undefined);
    expect(result).toEqual({ valid: false, error: 'Video appears to be empty' });
  });
});

// ── ffmpeg duration extraction ──────────────────────────────────────

import { execSync } from 'node:child_process';

let ffmpegAvailable = false;
try {
  execSync('which ffprobe', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch { /* ffprobe not installed */ }

const describeIfFfmpeg = ffmpegAvailable ? describe : describe.skip;

describeIfFfmpeg('getVideoDuration (requires ffmpeg)', () => {
  let getVideoDuration;
  let testVideoPath;

  beforeAll(async () => {
    ({ getVideoDuration } = await import('../utils/videoValidator.js'));

    // Create a 6-second test fixture video
    testVideoPath = '/tmp/test_duration_fixture.mp4';
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=6:size=320x240:rate=15 ` +
      `-f lavfi -i sine=frequency=440:duration=6 ` +
      `-c:v libx264 -c:a aac -shortest ${testVideoPath}`,
      { stdio: 'ignore' }
    );
  });

  afterAll(() => {
    try { execSync(`rm -f ${testVideoPath}`, { stdio: 'ignore' }); } catch {}
  });

  it('extracts duration from a valid mp4 file', async () => {
    const duration = await getVideoDuration(testVideoPath);
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThan(5);
    expect(duration).toBeLessThan(8);
  });

  it('throws on non-video file', async () => {
    const textFile = '/tmp/test_not_a_video.txt';
    execSync(`echo "hello" > ${textFile}`);
    await expect(getVideoDuration(textFile)).rejects.toThrow();
    execSync(`rm -f ${textFile}`, { stdio: 'ignore' });
  });

  it('throws on non-existent file', async () => {
    await expect(getVideoDuration('/tmp/does_not_exist_12345.mp4')).rejects.toThrow();
  });
});
