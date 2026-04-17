import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Check whether a video file has an audio stream.
 */
async function hasAudioStream(videoPath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Extract the audio track from a video file.
 *
 * @param {string} videoPath  — absolute path to the video file
 * @param {string} outputPath — where to write the extracted audio (e.g. /tmp/audio.m4a)
 * @returns {Promise<string|null>} — path to extracted audio, or null if no audio track
 */
export async function extractAudio(videoPath, outputPath) {
  // Verify input file exists
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Check if the video has an audio stream
  const hasAudio = await hasAudioStream(videoPath);
  if (!hasAudio) {
    return null;
  }

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('aac')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}
