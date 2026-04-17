import { jest } from '@jest/globals';

// ── Tests for client-side SSE progress wiring ───────────────────────

describe('Client-side video progress wiring', () => {
  describe('reducer video progress actions', () => {
    let reducerSource;

    beforeAll(async () => {
      const { readFileSync } = await import('fs');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      reducerSource = readFileSync(join(__dirname, '..', 'reducer.js'), 'utf8');
    });

    it('has a VIDEO_PROGRESS action', () => {
      expect(reducerSource).toMatch(/VIDEO_PROGRESS/);
    });

    it('stores videoProgress in state', () => {
      expect(reducerSource).toMatch(/videoProgress/);
    });

    it('resets videoProgress on ANALYSIS_START', () => {
      // videoProgress should reset when a new analysis begins
      expect(reducerSource).toMatch(/ANALYSIS_START[\s\S]*videoProgress:\s*null/);
    });
  });

  describe('AIAnalysis uses SSE progress', () => {
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

    it('reads videoProgress from state', () => {
      expect(analysisSource).toMatch(/videoProgress|state\.videoProgress/);
    });

    it('maps SSE stages to UI stages', () => {
      // The component should map server stage names to display stages
      expect(analysisSource).toMatch(/processing|analysing|reviewing|complete/);
    });

    it('falls back to time-based estimation when no SSE data', () => {
      // Should still have the durationHint-based fallback
      expect(analysisSource).toMatch(/durationHint|elapsedSeconds/);
    });
  });

  describe('JobDetails SSE wiring', () => {
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

    it('creates an EventSource for video progress', () => {
      expect(jobDetailsSource).toMatch(/EventSource/);
    });

    it('connects to the video progress SSE endpoint', () => {
      expect(jobDetailsSource).toMatch(/video\/progress/);
    });

    it('dispatches VIDEO_PROGRESS on SSE messages', () => {
      expect(jobDetailsSource).toMatch(/VIDEO_PROGRESS/);
    });

    it('closes EventSource on completion or error', () => {
      expect(jobDetailsSource).toMatch(/\.close\(\)/);
    });
  });
});
