import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import { getVideoDuration } from './videoValidator.js';

const DEFAULT_INTERVAL = 3;       // seconds between frames
const DEFAULT_MAX_FRAMES = 50;
const DEFAULT_MAX_DIMENSION = 2048;

/**
 * Extract frames from a video at regular intervals.
 *
 * @param {string} videoPath   — absolute path to the video file
 * @param {string} workDir     — directory to write frames into (created if needed)
 * @param {object} [options]
 * @param {number} [options.maxFrames=50]
 * @param {number} [options.intervalSeconds=3]
 * @param {number} [options.maxDimension=2048]
 * @returns {Promise<string[]>} — array of absolute paths to extracted JPEG frames
 */
export async function extractFrames(videoPath, workDir, options = {}) {
  const {
    maxFrames = DEFAULT_MAX_FRAMES,
    intervalSeconds = DEFAULT_INTERVAL,
    maxDimension = DEFAULT_MAX_DIMENSION,
  } = options;

  // Ensure workDir exists
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // Get duration to compute timestamps
    const duration = await getVideoDuration(videoPath);

    // Compute timestamps at which to extract frames
    const timestamps = [];
    for (let t = 0; t < duration; t += intervalSeconds) {
      timestamps.push(t);
      if (timestamps.length >= maxFrames) break;
    }

    if (timestamps.length === 0) {
      timestamps.push(0);
    }

    // Extract frames using fluent-ffmpeg with screenshots
    const framePaths = [];
    for (let i = 0; i < timestamps.length; i++) {
      const outFile = path.join(workDir, `frame_${String(i).padStart(4, '0')}.jpg`);
      await extractSingleFrame(videoPath, timestamps[i], outFile, maxDimension);
      framePaths.push(outFile);
    }

    return framePaths;
  } catch (err) {
    // Don't clean up workDir here — let the caller (processVideo) handle cleanup
    // to avoid double-delete race conditions
    throw err;
  }
}

/**
 * Extract a single frame at a given timestamp.
 */
function extractSingleFrame(videoPath, timestampSeconds, outputPath, maxDimension) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestampSeconds)
      .frames(1)
      .outputOptions([
        '-vf', `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
        '-q:v', '2',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}
