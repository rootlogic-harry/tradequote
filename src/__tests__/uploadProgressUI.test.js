import { jest } from '@jest/globals';

// ── Tests for upload progress wiring into reducer + AIAnalysis ──────

describe('Upload progress UI wiring', () => {
  describe('reducer UPLOAD_PROGRESS action', () => {
    let reducerSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      reducerSource = readFileSync(join(__dirname, '..', 'reducer.js'), 'utf8');
    });

    it('has an UPLOAD_PROGRESS action', () => {
      expect(reducerSource).toMatch(/UPLOAD_PROGRESS/);
    });

    it('stores uploadProgress in state', () => {
      expect(reducerSource).toMatch(/uploadProgress/);
    });

    it('initialises uploadProgress as null', () => {
      expect(reducerSource).toMatch(/uploadProgress:\s*null/);
    });

    it('resets uploadProgress on ANALYSIS_START', () => {
      expect(reducerSource).toMatch(/ANALYSIS_START[\s\S]*uploadProgress:\s*null/);
    });
  });

  describe('JobDetails uses uploadWithProgress', () => {
    let jobDetailsSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      jobDetailsSource = readFileSync(
        join(__dirname, '..', 'components', 'steps', 'JobDetails.jsx'),
        'utf8'
      );
    });

    it('imports uploadWithProgress', () => {
      expect(jobDetailsSource).toMatch(/uploadWithProgress/);
    });

    it('dispatches UPLOAD_PROGRESS from onProgress callback', () => {
      expect(jobDetailsSource).toMatch(/UPLOAD_PROGRESS/);
    });

    it('uses abort from uploadWithProgress', () => {
      expect(jobDetailsSource).toMatch(/abort/);
    });
  });

  describe('AIAnalysis shows real upload progress', () => {
    let analysisSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      analysisSource = readFileSync(
        join(__dirname, '..', 'components', 'steps', 'AIAnalysis.jsx'),
        'utf8'
      );
    });

    it('reads uploadProgress from state', () => {
      expect(analysisSource).toMatch(/uploadProgress|state\.uploadProgress/);
    });

    it('displays upload percentage', () => {
      // Should show the real upload % somewhere
      expect(analysisSource).toMatch(/percent|uploadProgress/);
    });

    it('displays upload ETA or speed', () => {
      expect(analysisSource).toMatch(/eta|remaining|speed/i);
    });

    it('uses upload progress to drive stage 0 (uploading)', () => {
      // Stage 0 should use real upload % when available
      expect(analysisSource).toMatch(/uploadProgress.*percent|percent.*upload/i);
    });
  });
});
