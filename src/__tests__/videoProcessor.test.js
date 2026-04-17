import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// ── Mock all dependencies ───────────────────────────────────────────

const mockGetVideoDuration = jest.fn();
const mockValidateVideoDuration = jest.fn();
jest.unstable_mockModule('../utils/videoValidator.js', () => ({
  getVideoDuration: mockGetVideoDuration,
  validateVideoDuration: mockValidateVideoDuration,
}));

const mockExtractFrames = jest.fn();
jest.unstable_mockModule('../utils/frameExtractor.js', () => ({
  extractFrames: mockExtractFrames,
}));

const mockExtractAudio = jest.fn();
jest.unstable_mockModule('../utils/audioExtractor.js', () => ({
  extractAudio: mockExtractAudio,
}));

const mockTranscribe = jest.fn();
jest.unstable_mockModule('../utils/whisperClient.js', () => ({
  transcribe: mockTranscribe,
  TRADE_PROMPT: 'test prompt',
}));

const { processVideo } = await import('../utils/videoProcessor.js');

// ── Helpers ─────────────────────────────────────────────────────────

function baseArgs(overrides = {}) {
  return {
    videoPath: '/tmp/test_video.mp4',
    jobId: 'job-123',
    extraNotes: 'Stone needs replacing near the gate',
    extraPhotos: [],
    siteAddress: '10 Main St, Yorkshire',
    profile: { dayRate: 400 },
    ...overrides,
  };
}

// Create small JPEG test files at given paths
function writeTestJpegs(paths) {
  for (const p of paths) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Minimal JPEG: FF D8 header + some bytes
    fs.writeFileSync(p, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));
  }
}

// Track the workDir that processVideo creates so mocks use the right paths
let capturedWorkDir = null;
const origMkdirSync = fs.mkdirSync;
const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation((dir, opts) => {
  if (String(dir).startsWith('/tmp/job_')) capturedWorkDir = dir;
  return origMkdirSync(dir, opts);
});

function setupSuccessfulMocks() {
  mockGetVideoDuration.mockResolvedValue(60);
  mockValidateVideoDuration.mockReturnValue({ valid: true });

  // extractFrames mock: create fake frame in whatever workDir processVideo creates
  mockExtractFrames.mockImplementation(async (_videoPath, workDir) => {
    const framePath = path.join(workDir, 'frame_0000.jpg');
    writeTestJpegs([framePath]);
    return [framePath];
  });

  // extractAudio mock: create fake audio file in the workDir
  mockExtractAudio.mockImplementation(async (_videoPath, audioOutPath) => {
    const dir = path.dirname(audioOutPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(audioOutPath, Buffer.from([0x00, 0x00, 0x00, 0x20]));
    return audioOutPath;
  });

  mockTranscribe.mockResolvedValue('The wall is about two metres high with a collapsed section');
}

// ── Tests ───────────────────────────────────────────────────────────

describe('processVideo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any test directories
    if (capturedWorkDir && fs.existsSync(capturedWorkDir)) {
      fs.rmSync(capturedWorkDir, { recursive: true, force: true });
    }
    capturedWorkDir = null;
  });

  it('calls getVideoDuration with the video path', async () => {
    setupSuccessfulMocks();
    await processVideo(baseArgs());
    expect(mockGetVideoDuration).toHaveBeenCalledWith('/tmp/test_video.mp4');
  });

  it('rejects video exceeding 3-minute duration limit', async () => {
    mockGetVideoDuration.mockResolvedValue(200);
    mockValidateVideoDuration.mockReturnValue({ valid: false, error: 'Video must be under 3 minutes' });
    await expect(processVideo(baseArgs())).rejects.toThrow('Video must be under 3 minutes');
  });

  it('calls extractAudio with correct input path', async () => {
    setupSuccessfulMocks();
    await processVideo(baseArgs());
    expect(mockExtractAudio).toHaveBeenCalledWith(
      '/tmp/test_video.mp4',
      expect.stringContaining('audio')
    );
  });

  it('calls Whisper transcribe with extracted audio', async () => {
    setupSuccessfulMocks();
    await processVideo(baseArgs());
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringContaining('audio')
    );
  });

  it('handles video with no audio track', async () => {
    setupSuccessfulMocks();
    mockExtractAudio.mockResolvedValue(null);
    const result = await processVideo(baseArgs());
    expect(mockTranscribe).not.toHaveBeenCalled();
    // Should still return a result — transcript will be empty
    expect(result).toBeDefined();
    expect(result.transcript).toBe('');
  });

  it('calls extractFrames with correct parameters', async () => {
    setupSuccessfulMocks();
    await processVideo(baseArgs());
    expect(mockExtractFrames).toHaveBeenCalledWith(
      '/tmp/test_video.mp4',
      expect.stringContaining('job_job-123'),
      expect.objectContaining({
        maxFrames: 50,
        intervalSeconds: 3,
        maxDimension: 2048,
      })
    );
  });

  it('converts extracted frames to base64', async () => {
    // Override extractFrames to return 2 frames
    mockGetVideoDuration.mockResolvedValue(60);
    mockValidateVideoDuration.mockReturnValue({ valid: true });
    mockExtractFrames.mockImplementation(async (_videoPath, workDir) => {
      const paths = [
        path.join(workDir, 'frame_0000.jpg'),
        path.join(workDir, 'frame_0001.jpg'),
      ];
      writeTestJpegs(paths);
      return paths;
    });
    mockExtractAudio.mockResolvedValue(null);
    mockTranscribe.mockResolvedValue('');

    const result = await processVideo(baseArgs());
    expect(result.frames.length).toBe(2);
    for (const frame of result.frames) {
      expect(frame.base64).toBeDefined();
      expect(typeof frame.base64).toBe('string');
      expect(frame.mediaType).toBe('image/jpeg');
    }
  });

  it('returns the analysis data with correct shape', async () => {
    setupSuccessfulMocks();
    const result = await processVideo(baseArgs());
    expect(result).toEqual(expect.objectContaining({
      frames: expect.any(Array),
      transcript: expect.any(String),
      combinedNotes: expect.any(String),
    }));
  });

  it('combines transcript and extraNotes into combinedNotes', async () => {
    setupSuccessfulMocks();
    const result = await processVideo(baseArgs({
      extraNotes: 'Extra detail about the wall',
    }));
    expect(result.combinedNotes).toContain('The wall is about two metres high');
    expect(result.combinedNotes).toContain('Extra detail about the wall');
  });

  it('works with empty extraNotes', async () => {
    setupSuccessfulMocks();
    const result = await processVideo(baseArgs({ extraNotes: '' }));
    expect(result.combinedNotes).toBe('The wall is about two metres high with a collapsed section');
  });

  it('works with no extra photos', async () => {
    setupSuccessfulMocks();
    const result = await processVideo(baseArgs({ extraPhotos: [] }));
    expect(result.extraPhotoFrames).toEqual([]);
  });

  it('includes extra photos when provided', async () => {
    setupSuccessfulMocks();
    const extraPhotos = [
      { data: 'data:image/jpeg;base64,AAAA', name: 'photo1.jpg' },
      { data: 'data:image/jpeg;base64,BBBB', name: 'photo2.jpg' },
    ];
    const result = await processVideo(baseArgs({ extraPhotos }));
    expect(result.extraPhotoFrames.length).toBe(2);
    expect(result.extraPhotoFrames[0].base64).toBe('AAAA');
  });

  it('reduces max frames when extra photos are present', async () => {
    setupSuccessfulMocks();
    const extraPhotos = [
      { data: 'data:image/jpeg;base64,AAAA', name: 'photo1.jpg' },
      { data: 'data:image/jpeg;base64,BBBB', name: 'photo2.jpg' },
      { data: 'data:image/jpeg;base64,CCCC', name: 'photo3.jpg' },
    ];
    await processVideo(baseArgs({ extraPhotos }));
    expect(mockExtractFrames).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxFrames: 47 }),
    );
  });

  it('cleans up temporary files after success', async () => {
    setupSuccessfulMocks();
    await processVideo(baseArgs());
    // processVideo's finally block cleans up the dynamic workDir
    expect(capturedWorkDir).toBeTruthy();
    expect(fs.existsSync(capturedWorkDir)).toBe(false);
  });

  it('cleans up temporary files after failure', async () => {
    mockGetVideoDuration.mockResolvedValue(60);
    mockValidateVideoDuration.mockReturnValue({ valid: true });
    mockExtractFrames.mockRejectedValue(new Error('ffmpeg failed'));
    mockExtractAudio.mockResolvedValue(null);

    await expect(processVideo(baseArgs())).rejects.toThrow('ffmpeg failed');
    expect(capturedWorkDir).toBeTruthy();
    expect(fs.existsSync(capturedWorkDir)).toBe(false);
  });
});
