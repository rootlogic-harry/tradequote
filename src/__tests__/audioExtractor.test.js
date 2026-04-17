import { jest } from '@jest/globals';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

let ffmpegAvailable = false;
try {
  execSync('which ffmpeg', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch { /* ffmpeg not installed */ }

const describeIfFfmpeg = ffmpegAvailable ? describe : describe.skip;

describeIfFfmpeg('extractAudio (requires ffmpeg)', () => {
  let extractAudio;
  let testVideoWithAudio;
  let testVideoSilent;

  beforeAll(async () => {
    ({ extractAudio } = await import('../utils/audioExtractor.js'));

    // Video with audio
    testVideoWithAudio = '/tmp/test_audio_fixture.mp4';
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=6:size=320x240:rate=15 ` +
      `-f lavfi -i sine=frequency=440:duration=6 ` +
      `-c:v libx264 -c:a aac -shortest ${testVideoWithAudio}`,
      { stdio: 'ignore' }
    );

    // Video without audio
    testVideoSilent = '/tmp/test_silent_fixture.mp4';
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=320x240:rate=15 ` +
      `-c:v libx264 -an ${testVideoSilent}`,
      { stdio: 'ignore' }
    );
  });

  afterAll(() => {
    try {
      execSync(`rm -f ${testVideoWithAudio} ${testVideoSilent}`, { stdio: 'ignore' });
    } catch {}
  });

  it('extracts audio track from mp4', async () => {
    const outputPath = '/tmp/test_extracted_audio.m4a';
    try {
      const result = await extractAudio(testVideoWithAudio, outputPath);
      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
    } finally {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  });

  it('output audio is in a format Whisper accepts', async () => {
    const outputPath = '/tmp/test_whisper_audio.m4a';
    try {
      const result = await extractAudio(testVideoWithAudio, outputPath);
      // Whisper accepts: .webm, .mp4, .m4a, .wav, .mp3, .mpeg, .mpga
      const ext = result.split('.').pop();
      expect(['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mpeg', 'mpga']).toContain(ext);
    } finally {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  });

  it('handles video with no audio track gracefully', async () => {
    const outputPath = '/tmp/test_no_audio.m4a';
    try {
      const result = await extractAudio(testVideoSilent, outputPath);
      expect(result).toBeNull();
    } finally {
      try { fs.unlinkSync(outputPath); } catch {}
    }
  });

  it('throws on non-existent video file', async () => {
    await expect(
      extractAudio('/tmp/nonexistent_video_12345.mp4', '/tmp/out.m4a')
    ).rejects.toThrow();
  });
});
