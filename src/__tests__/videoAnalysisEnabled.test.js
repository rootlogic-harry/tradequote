import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isVideoAnalysisEnabled,
  isVideoAnalysisEnabledFromProcessEnv,
  VIDEO_DISABLED_MESSAGE,
} from '../utils/videoAnalysisEnabled.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('isVideoAnalysisEnabled', () => {
  describe('production environment', () => {
    it('returns false when the flag is missing (fail-closed)', () => {
      expect(isVideoAnalysisEnabled({ nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: undefined, nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: '', nodeEnv: 'production' })).toBe(false);
    });

    it('returns true only when the flag is explicitly truthy', () => {
      expect(isVideoAnalysisEnabled({ flag: 'true', nodeEnv: 'production' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: 'TRUE', nodeEnv: 'production' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: '1', nodeEnv: 'production' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: 'yes', nodeEnv: 'production' })).toBe(true);
    });

    it('returns false when the flag is explicitly falsy', () => {
      expect(isVideoAnalysisEnabled({ flag: 'false', nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: '0', nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: 'no', nodeEnv: 'production' })).toBe(false);
    });

    it('treats unrecognised flag values as missing (fail-closed)', () => {
      expect(isVideoAnalysisEnabled({ flag: 'maybe', nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: 'enabled', nodeEnv: 'production' })).toBe(false);
    });
  });

  describe('non-production environment (staging / dev / test)', () => {
    it('returns true when the flag is missing (default-open)', () => {
      expect(isVideoAnalysisEnabled({ nodeEnv: 'development' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: undefined, nodeEnv: 'test' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: '', nodeEnv: 'staging' })).toBe(true);
      // NODE_ENV unset is also non-production.
      expect(isVideoAnalysisEnabled({})).toBe(true);
    });

    it('returns true when the flag is explicitly truthy', () => {
      expect(isVideoAnalysisEnabled({ flag: 'true', nodeEnv: 'development' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: '1', nodeEnv: 'test' })).toBe(true);
    });

    it('respects explicit disable even in non-production', () => {
      expect(isVideoAnalysisEnabled({ flag: 'false', nodeEnv: 'development' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: 'no', nodeEnv: 'test' })).toBe(false);
    });
  });

  describe('input hygiene', () => {
    it('trims whitespace and is case-insensitive', () => {
      expect(isVideoAnalysisEnabled({ flag: '  true ', nodeEnv: 'production' })).toBe(true);
      expect(isVideoAnalysisEnabled({ flag: ' False ', nodeEnv: 'development' })).toBe(false);
    });

    it('non-string flag is treated as missing', () => {
      expect(isVideoAnalysisEnabled({ flag: true, nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: 1, nodeEnv: 'production' })).toBe(false);
      expect(isVideoAnalysisEnabled({ flag: null, nodeEnv: 'production' })).toBe(false);
    });
  });
});

describe('isVideoAnalysisEnabledFromProcessEnv', () => {
  const originalFlag = process.env.VIDEO_ANALYSIS_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.VIDEO_ANALYSIS_ENABLED;
    else process.env.VIDEO_ANALYSIS_ENABLED = originalFlag;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('reads from process.env directly', () => {
    process.env.VIDEO_ANALYSIS_ENABLED = 'true';
    process.env.NODE_ENV = 'production';
    expect(isVideoAnalysisEnabledFromProcessEnv()).toBe(true);

    delete process.env.VIDEO_ANALYSIS_ENABLED;
    process.env.NODE_ENV = 'production';
    expect(isVideoAnalysisEnabledFromProcessEnv()).toBe(false);

    delete process.env.VIDEO_ANALYSIS_ENABLED;
    process.env.NODE_ENV = 'development';
    expect(isVideoAnalysisEnabledFromProcessEnv()).toBe(true);
  });
});

describe('VIDEO_DISABLED_MESSAGE', () => {
  it('mentions photos as the fallback path', () => {
    expect(VIDEO_DISABLED_MESSAGE).toMatch(/photos/i);
  });

  it('does not leak the AI abstraction (design law)', () => {
    // Banned vocabulary check — basic users see this string. Must not
    // mention model, AI, prompt, etc.
    const banned = /\bAI\b|claude|sonnet|prompt|model|LLM/i;
    expect(VIDEO_DISABLED_MESSAGE).not.toMatch(banned);
  });
});

describe('server wiring', () => {
  let serverSource;
  beforeAll(() => {
    serverSource = readFileSync(join(__dirname, '..', '..', 'server.js'), 'utf8');
  });

  it('imports the flag helper and the disabled message', () => {
    expect(serverSource).toMatch(/isVideoAnalysisEnabledFromProcessEnv|isVideoAnalysisEnabled/);
    expect(serverSource).toContain('VIDEO_DISABLED_MESSAGE');
  });

  it('the video upload route checks the flag before processing', () => {
    // The flag check must appear textually before the processVideo() call.
    // We accept either an inline isVideoAnalysisEnabledFromProcessEnv()
    // call or a requireVideoAnalysisEnabled middleware mount — both
    // satisfy the contract.
    const routeStart = serverSource.indexOf("app.post('/api/users/:id/jobs/:jobId/video'");
    const processVideoCall = serverSource.indexOf('processVideo(', routeStart);
    expect(routeStart).toBeGreaterThan(-1);
    expect(processVideoCall).toBeGreaterThan(-1);

    const routeBody = serverSource.slice(routeStart, processVideoCall);
    expect(routeBody).toMatch(/requireVideoAnalysisEnabled|isVideoAnalysisEnabledFromProcessEnv/);
  });

  it('exposes a reusable middleware that 503s when the flag is off', () => {
    // The middleware approach lets us refuse the upload before multer
    // streams the body to disk.
    expect(serverSource).toMatch(/function requireVideoAnalysisEnabled[\s\S]{0,300}503/);
  });

  it('the video upload route returns 503 with the disabled message when the flag is off', () => {
    // Look for a 503 response carrying the disabled message in the route.
    expect(serverSource).toMatch(/503[^]{0,400}VIDEO_DISABLED_MESSAGE/);
  });

  it('the SSE progress route also gates on the flag', () => {
    const sseRouteStart = serverSource.indexOf("app.get('/api/users/:id/jobs/:jobId/video/progress'");
    expect(sseRouteStart).toBeGreaterThan(-1);
    const nextRoute = serverSource.indexOf("app.", sseRouteStart + 1);
    const sseRouteBody = serverSource.slice(sseRouteStart, nextRoute);
    expect(sseRouteBody).toMatch(/isVideoAnalysisEnabledFromProcessEnv|videoAnalysisEnabled/);
  });

  it('/auth/me exposes the videoAnalysisEnabled feature flag to the client', () => {
    const meRouteStart = serverSource.indexOf("app.get('/auth/me'");
    const nextRoute = serverSource.indexOf("app.", meRouteStart + 1);
    const meRouteBody = serverSource.slice(meRouteStart, nextRoute);
    expect(meRouteBody).toMatch(/videoAnalysisEnabled/);
  });
});

describe('client wiring', () => {
  it('JobDetails respects videoAnalysisEnabled prop and hides the video mode', () => {
    const jobDetailsSource = readFileSync(
      join(__dirname, '..', 'components', 'steps', 'JobDetails.jsx'),
      'utf8',
    );
    expect(jobDetailsSource).toMatch(/videoAnalysisEnabled/);
  });

  it('App.jsx reads videoAnalysisEnabled from /auth/me payload', () => {
    const appSource = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8');
    expect(appSource).toMatch(/videoAnalysisEnabled/);
  });

  it('CaptureChoice accepts a videoEnabled prop', () => {
    const captureChoiceSource = readFileSync(
      join(__dirname, '..', 'components', 'CaptureChoice.jsx'),
      'utf8',
    );
    expect(captureChoiceSource).toMatch(/videoEnabled/);
  });
});
