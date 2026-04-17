import fs from 'node:fs';
import path from 'node:path';
import { getVideoDuration, validateVideoDuration } from './videoValidator.js';
import { extractFrames } from './frameExtractor.js';
import { extractAudio } from './audioExtractor.js';
import { transcribe } from './whisperClient.js';

const DEFAULT_MAX_FRAMES = 50;
const FRAME_INTERVAL = 3;
const MAX_DIMENSION = 2048;

/**
 * Process a video file: extract frames, extract and transcribe audio,
 * and return data ready for the analysis pipeline.
 *
 * This does NOT call analyseJob directly — it returns the prepared data
 * so the route handler can feed it into the same Anthropic analysis pipeline
 * that the photo path uses.
 *
 * @param {object} opts
 * @param {string} opts.videoPath    — absolute path to the uploaded video
 * @param {string} opts.jobId        — unique job identifier (for work directory)
 * @param {string} opts.extraNotes   — additional text notes from the user
 * @param {Array}  opts.extraPhotos  — array of { data: 'data:image/jpeg;base64,...', name }
 * @param {string} opts.siteAddress  — site address for the quote
 * @param {object} opts.profile      — user profile (dayRate, etc.)
 * @returns {Promise<object>}        — { frames, extraPhotoFrames, transcript, combinedNotes }
 */
export async function processVideo({
  videoPath,
  jobId,
  extraNotes = '',
  extraPhotos = [],
  siteAddress,
  profile,
}) {
  const workDir = `/tmp/job_${jobId}_${Date.now()}`;

  try {
    // 1. Validate duration
    const duration = await getVideoDuration(videoPath);
    const validation = validateVideoDuration(duration);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // 2. Create work directory
    fs.mkdirSync(workDir, { recursive: true });

    // 3. Extract audio
    const audioPath = path.join(workDir, 'audio.m4a');
    const audioResult = await extractAudio(videoPath, audioPath);

    // 4. Transcribe audio (if audio exists)
    let transcript = '';
    if (audioResult) {
      const audioBuffer = fs.readFileSync(audioResult);
      // Pass mimetype based on file extension for Whisper
      transcript = await transcribe(audioBuffer, 'audio/mp4');
    }

    // 5. Extract frames (reduce maxFrames when extra photos are present)
    const maxFrames = Math.max(1, DEFAULT_MAX_FRAMES - (extraPhotos?.length || 0));
    const framePaths = await extractFrames(videoPath, workDir, {
      maxFrames,
      intervalSeconds: FRAME_INTERVAL,
      maxDimension: MAX_DIMENSION,
    });

    // 6. Convert frames to base64
    const frames = framePaths.map(fp => ({
      base64: fs.readFileSync(fp).toString('base64'),
      mediaType: 'image/jpeg',
    }));

    // 7. Process extra photos (strip data URL prefix)
    const extraPhotoFrames = extraPhotos.map(photo => ({
      base64: photo.data.split(',')[1] || photo.data,
      mediaType: 'image/jpeg',
    }));

    // 8. Combine transcript and notes
    const combinedNotes = [transcript, extraNotes].filter(Boolean).join('\n\n');

    return {
      frames,
      extraPhotoFrames,
      transcript,
      combinedNotes,
    };
  } finally {
    // 9. Clean up work directory
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}
