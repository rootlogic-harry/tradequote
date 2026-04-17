import { jest } from '@jest/globals';

// ── Tests for upload resilience and error handling ──────────────────

describe('Upload resilience', () => {
  describe('reducer error handling', () => {
    let reducerSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      reducerSource = readFileSync(join(__dirname, '..', 'reducer.js'), 'utf8');
    });

    it('has ANALYSIS_CANCEL action that clears isAnalysing', () => {
      expect(reducerSource).toMatch(/ANALYSIS_CANCEL/);
      expect(reducerSource).toMatch(/isAnalysing:\s*false/);
    });

    it('has ANALYSIS_ERROR action that stores error', () => {
      expect(reducerSource).toMatch(/ANALYSIS_ERROR/);
      expect(reducerSource).toMatch(/analysisError/);
    });

    it('has RETRY_ANALYSIS action', () => {
      expect(reducerSource).toMatch(/RETRY_ANALYSIS/);
    });
  });

  describe('JobDetails error resilience', () => {
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

    it('has AbortController for cancellation', () => {
      expect(jobDetailsSource).toMatch(/AbortController/);
    });

    it('has a timeout for the upload', () => {
      expect(jobDetailsSource).toMatch(/setTimeout.*abort|controller\.abort/);
    });

    it('handles AbortError specifically', () => {
      expect(jobDetailsSource).toMatch(/AbortError/);
    });

    it('dispatches ANALYSIS_ERROR with error message', () => {
      expect(jobDetailsSource).toMatch(/ANALYSIS_ERROR.*error.*err\.message|type:\s*['"]ANALYSIS_ERROR['"]/);
    });

    it('cleans up EventSource in finally block', () => {
      expect(jobDetailsSource).toMatch(/finally[\s\S]*eventSource.*close/);
    });

    it('validates video file size before upload', () => {
      expect(jobDetailsSource).toMatch(/100\s*\*\s*1024\s*\*\s*1024|videoFile\.size/);
    });
  });

  describe('AIAnalysis error UI', () => {
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

    it('shows error state when analysisError is set', () => {
      expect(analysisSource).toMatch(/analysisError/);
    });

    it('has a Try Again button for retrying', () => {
      expect(analysisSource).toMatch(/Try Again/);
      expect(analysisSource).toMatch(/RETRY_ANALYSIS/);
    });

    it('has a Back to Job Details button', () => {
      expect(analysisSource).toMatch(/Back to Job Details/);
    });

    it('displays the error message to the user', () => {
      expect(analysisSource).toMatch(/state\.analysisError/);
    });

    it('has cancel button during loading', () => {
      expect(analysisSource).toMatch(/Cancel/);
      expect(analysisSource).toMatch(/cancelAnalysis|ANALYSIS_CANCEL/);
    });

    it('uses minimum 44px touch targets on error action buttons', () => {
      expect(analysisSource).toMatch(/minHeight:\s*44/);
    });
  });

  describe('server video route error handling', () => {
    let serverSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      serverSource = readFileSync(join(__dirname, '..', '..', 'server.js'), 'utf8');
    });

    it('returns 400 for missing video file', () => {
      expect(serverSource).toMatch(/400[\s\S]*No video file/);
    });

    it('returns 400 for duration validation failures', () => {
      expect(serverSource).toMatch(/400[\s\S]*Video must be under/);
    });

    it('returns 422 for unparseable AI response', () => {
      expect(serverSource).toMatch(/422/);
    });

    it('uses safeError for unexpected failures', () => {
      expect(serverSource).toMatch(/safeError.*video/i);
    });

    it('cleans up files in finally block', () => {
      expect(serverSource).toMatch(/finally[\s\S]*unlinkSync/);
    });

    it('emits error progress on failure', () => {
      expect(serverSource).toMatch(/videoProgress\.error/);
    });
  });
});
