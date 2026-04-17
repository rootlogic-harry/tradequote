import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_DURATION_SECONDS = 180;

/**
 * Pure validation of a video duration value.
 * @param {number} durationSeconds
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function validateVideoDuration(durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0 || Number.isNaN(durationSeconds)) {
    return { valid: false, error: 'Video appears to be empty' };
  }
  if (durationSeconds > MAX_DURATION_SECONDS) {
    return { valid: false, error: 'Video must be under 3 minutes' };
  }
  return { valid: true };
}

/**
 * Extract the duration of a video file using ffprobe.
 * @param {string} filePath — absolute path to a video file
 * @returns {Promise<number>} duration in seconds
 */
export async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (Number.isNaN(duration) || duration <= 0) {
    throw new Error(`Could not determine video duration for ${filePath}`);
  }
  return duration;
}
