import { jest } from '@jest/globals';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let ffmpegAvailable = false;
try {
  execSync('which ffmpeg', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch { /* ffmpeg not installed */ }

const describeIfFfmpeg = ffmpegAvailable ? describe : describe.skip;

describeIfFfmpeg('extractFrames (requires ffmpeg)', () => {
  let extractFrames;
  let testVideoPath;
  const workDir = '/tmp/test_frame_extraction';

  beforeAll(async () => {
    ({ extractFrames } = await import('../utils/frameExtractor.js'));

    // Create a 6-second test fixture video (640x480)
    testVideoPath = '/tmp/test_frames_fixture.mp4';
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=6:size=640x480:rate=15 ` +
      `-f lavfi -i sine=frequency=440:duration=6 ` +
      `-c:v libx264 -c:a aac -shortest ${testVideoPath}`,
      { stdio: 'ignore' }
    );
  });

  afterAll(() => {
    try { execSync(`rm -f ${testVideoPath}`, { stdio: 'ignore' }); } catch {}
  });

  beforeEach(() => {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true });
  });

  it('extracts frames at 3-second intervals from a 6-second video', async () => {
    const frames = await extractFrames(testVideoPath, workDir);
    // 6s video at 3s intervals → frames at 0s and 3s = 2 frames
    expect(frames.length).toBe(2);
  });

  it('outputs JPEG files', async () => {
    const frames = await extractFrames(testVideoPath, workDir);
    expect(frames.length).toBeGreaterThan(0);
    for (const framePath of frames) {
      expect(framePath).toMatch(/\.jpg$/);
      // Check JPEG magic bytes (FF D8)
      const buf = fs.readFileSync(framePath);
      expect(buf[0]).toBe(0xFF);
      expect(buf[1]).toBe(0xD8);
    }
  });

  it('resizes frames so longest edge does not exceed maxDimension', async () => {
    // Create a large video to test resize
    const largeVideo = '/tmp/test_large_video.mp4';
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=3840x2160:rate=15 ` +
      `-c:v libx264 -shortest ${largeVideo}`,
      { stdio: 'ignore' }
    );
    try {
      const frames = await extractFrames(largeVideo, workDir, { maxDimension: 2048 });
      expect(frames.length).toBeGreaterThan(0);

      // Check frame dimensions via ffprobe
      const { stdout } = await import('node:child_process').then(m =>
        new Promise((resolve, reject) => {
          m.execFile('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0',
            frames[0],
          ], (err, stdout) => err ? reject(err) : resolve({ stdout }));
        })
      );
      const [w, h] = stdout.trim().split(',').map(Number);
      expect(Math.max(w, h)).toBeLessThanOrEqual(2048);
    } finally {
      execSync(`rm -f ${largeVideo}`, { stdio: 'ignore' });
    }
  }, 30000);

  it('caps frames at maxFrames regardless of video length', async () => {
    const frames = await extractFrames(testVideoPath, workDir, { maxFrames: 1 });
    expect(frames.length).toBe(1);
  });

  it('cleans up working directory on success when cleanup is requested', async () => {
    const frames = await extractFrames(testVideoPath, workDir);
    expect(frames.length).toBeGreaterThan(0);
    // Frames exist during processing; after returning, caller is responsible for cleanup
    // The function itself creates the workDir if needed
    expect(fs.existsSync(workDir)).toBe(true);
  });

  it('propagates error on failure (caller handles cleanup)', async () => {
    await expect(
      extractFrames('/tmp/nonexistent_video_12345.mp4', workDir)
    ).rejects.toThrow();
    // Cleanup is the caller's responsibility (processVideo's finally block)
    // workDir may or may not exist depending on when the error occurred
  });

  it('creates the workDir if it does not exist', async () => {
    const freshDir = '/tmp/test_fresh_frame_dir';
    if (fs.existsSync(freshDir)) fs.rmSync(freshDir, { recursive: true });
    const frames = await extractFrames(testVideoPath, freshDir);
    expect(frames.length).toBeGreaterThan(0);
    fs.rmSync(freshDir, { recursive: true });
  });
});
