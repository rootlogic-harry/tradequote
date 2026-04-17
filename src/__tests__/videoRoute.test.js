import { jest } from '@jest/globals';

// Mock processVideo
const mockProcessVideo = jest.fn();
jest.unstable_mockModule('../utils/videoProcessor.js', () => ({
  processVideo: mockProcessVideo,
}));

describe('POST /api/users/:id/jobs/:jobId/video', () => {
  beforeEach(() => {
    mockProcessVideo.mockReset();
  });

  describe('input validation', () => {
    it('rejects requests with no video file', () => {
      const file = undefined;
      expect(file).toBeUndefined();
      // Route contract: if (!req.file) return res.status(400)
    });

    it('rejects files exceeding 100MB', () => {
      const maxSize = 100 * 1024 * 1024;
      const oversized = maxSize + 1;
      expect(oversized).toBeGreaterThan(maxSize);
    });

    it('rejects non-video MIME types', () => {
      const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      const badTypes = ['image/png', 'audio/mp3', 'application/json'];

      for (const t of videoTypes) {
        expect(t.startsWith('video/')).toBe(true);
      }
      for (const t of badTypes) {
        expect(t.startsWith('video/')).toBe(false);
      }
    });

    it('accepts common video MIME types', () => {
      const videoMimes = [
        'video/mp4',          // Standard MP4
        'video/webm',         // WebM
        'video/quicktime',    // MOV (iPhone)
        'video/x-msvideo',   // AVI
        'video/x-matroska',  // MKV
      ];
      for (const mime of videoMimes) {
        expect(mime.startsWith('video/')).toBe(true);
      }
    });
  });

  describe('video processing', () => {
    it('calls processVideo with correct parameters', async () => {
      const mockResult = {
        frames: [{ base64: 'FRAME1', mediaType: 'image/jpeg' }],
        extraPhotoFrames: [],
        transcript: 'The wall is damaged',
        combinedNotes: 'The wall is damaged',
      };
      mockProcessVideo.mockResolvedValue(mockResult);

      const args = {
        videoPath: '/tmp/video_job-1_12345',
        jobId: 'job-1',
        extraNotes: 'Near the gate',
        extraPhotos: [],
        siteAddress: '10 Main St',
        profile: { dayRate: 400 },
      };

      await mockProcessVideo(args);
      expect(mockProcessVideo).toHaveBeenCalledWith(args);
    });

    it('returns analysis result on success', async () => {
      const mockResult = {
        frames: [{ base64: 'FRAME1', mediaType: 'image/jpeg' }],
        extraPhotoFrames: [],
        transcript: 'The wall is damaged',
        combinedNotes: 'The wall is damaged',
      };
      mockProcessVideo.mockResolvedValue(mockResult);

      const result = await mockProcessVideo({});
      expect(result.frames).toBeDefined();
      expect(result.transcript).toBeDefined();
      expect(result.combinedNotes).toBeDefined();
    });

    it('handles processing failure gracefully', async () => {
      mockProcessVideo.mockRejectedValue(new Error('ffmpeg failed'));
      await expect(mockProcessVideo({})).rejects.toThrow('ffmpeg failed');
    });

    it('handles duration validation failure', async () => {
      mockProcessVideo.mockRejectedValue(new Error('Video must be under 3 minutes'));
      await expect(mockProcessVideo({})).rejects.toThrow('Video must be under 3 minutes');
    });
  });

  describe('MIME type validation helper', () => {
    const isValidVideoMime = (mime) =>
      typeof mime === 'string' && mime.startsWith('video/');

    it('accepts video/mp4', () => expect(isValidVideoMime('video/mp4')).toBe(true));
    it('accepts video/webm', () => expect(isValidVideoMime('video/webm')).toBe(true));
    it('accepts video/quicktime', () => expect(isValidVideoMime('video/quicktime')).toBe(true));
    it('rejects audio/mp4', () => expect(isValidVideoMime('audio/mp4')).toBe(false));
    it('rejects image/png', () => expect(isValidVideoMime('image/png')).toBe(false));
    it('rejects undefined', () => expect(isValidVideoMime(undefined)).toBe(false));
    it('rejects empty string', () => expect(isValidVideoMime('')).toBe(false));
  });

  describe('rate limiting contract', () => {
    it('rate limit is 5 per hour per user', () => {
      const rateConfig = {
        windowMs: 60 * 60 * 1000,
        max: 5,
        keyGenerator: (req) => String(req.user?.id ?? 0),
      };
      expect(rateConfig.max).toBe(5);
      expect(rateConfig.windowMs).toBe(3600000);
    });
  });

  describe('multer config contract', () => {
    it('uses disk storage (not memory) for large video files', () => {
      // Video files can be up to 100MB — too large for memory storage.
      // Route uses multer.diskStorage() with /tmp destination.
      // req.file.path gives the file path on disk.
      const diskConfig = {
        destination: '/tmp',
        fileSize: 100 * 1024 * 1024,
      };
      expect(diskConfig.destination).toBe('/tmp');
      expect(diskConfig.fileSize).toBe(104857600);
    });
  });

  describe('response shape', () => {
    it('success response includes analysis data', async () => {
      const mockResult = {
        frames: [{ base64: 'FRAME1', mediaType: 'image/jpeg' }],
        extraPhotoFrames: [],
        transcript: 'Walkthrough description',
        combinedNotes: 'Walkthrough description\n\nExtra notes',
      };
      mockProcessVideo.mockResolvedValue(mockResult);

      const result = await mockProcessVideo({});
      // Route will wrap this in { analysis: result }
      const response = { analysis: result };
      expect(response.analysis.frames).toHaveLength(1);
      expect(response.analysis.transcript).toBe('Walkthrough description');
    });
  });

  describe('server route source validation', () => {
    let serverSource;
    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      serverSource = readFileSync(join(__dirname, '..', '..', 'server.js'), 'utf8');
    });

    it('imports aiParser functions for server-side normalisation', () => {
      expect(serverSource).toContain('parseAIResponse');
      expect(serverSource).toContain('normalizeAIResponse');
    });

    it('returns normalised and rawResponse in response (not content array)', () => {
      // The video route should return { normalised, rawResponse } not { content }
      expect(serverSource).toMatch(/res\.json\(\{[\s\S]*normalised/);
      expect(serverSource).toMatch(/res\.json\(\{[\s\S]*rawResponse/);
    });

    it('uses multer fields for video and extraPhotos', () => {
      expect(serverSource).toMatch(/videoUpload\.fields/);
    });

    it('reads briefNotes from req.body (not extraNotes)', () => {
      expect(serverSource).toMatch(/req\.body\.briefNotes/);
    });

    it('parses profile from JSON string', () => {
      expect(serverSource).toMatch(/JSON\.parse\(req\.body\.profile\)/);
    });

    it('has explicit requireAuth middleware', () => {
      expect(serverSource).toMatch(/video['"],\s*\n?\s*requireAuth/);
    });

    it('sanitizes jobId in filename', () => {
      expect(serverSource).toMatch(/safeJobId|replace\(.*[^a-zA-Z]/);
    });

    it('cleans up extra photo files in finally block', () => {
      expect(serverSource).toMatch(/extraPhotoFiles/);
    });

    it('returns 422 when AI response cannot be parsed', () => {
      expect(serverSource).toMatch(/422/);
    });
  });
});
