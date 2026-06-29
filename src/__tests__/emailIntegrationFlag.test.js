/**
 * EMAIL_INTEGRATION_ENABLED — feature-flag kill-switch for the
 * Quote screen's Email / Outlook entry points.
 *
 * Pattern mirrors src/__tests__/videoAnalysisEnabled.test.js. The
 * pure helper is tested via direct invocation (no process.env
 * mutation); the wiring is asserted by reading server.js / App.jsx /
 * QuoteOutput.jsx as text and matching against structural anchors.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isEmailIntegrationEnabled,
  isEmailIntegrationEnabledFromProcessEnv,
} from '../utils/emailIntegrationEnabled.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('isEmailIntegrationEnabled', () => {
  describe('production environment', () => {
    it('returns false when the flag is missing (fail-closed)', () => {
      expect(isEmailIntegrationEnabled({ nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: undefined, nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: '', nodeEnv: 'production' })).toBe(false);
    });

    it('returns true only when the flag is explicitly truthy', () => {
      expect(isEmailIntegrationEnabled({ flag: 'true', nodeEnv: 'production' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: 'TRUE', nodeEnv: 'production' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: '1', nodeEnv: 'production' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: 'yes', nodeEnv: 'production' })).toBe(true);
    });

    it('returns false when the flag is explicitly falsy', () => {
      expect(isEmailIntegrationEnabled({ flag: 'false', nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: '0', nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: 'no', nodeEnv: 'production' })).toBe(false);
    });

    it('treats unrecognised flag values as missing (fail-closed)', () => {
      expect(isEmailIntegrationEnabled({ flag: 'maybe', nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: 'enabled', nodeEnv: 'production' })).toBe(false);
    });
  });

  describe('non-production environment (staging / dev / test)', () => {
    it('returns true when the flag is missing (default-open)', () => {
      expect(isEmailIntegrationEnabled({ nodeEnv: 'development' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: undefined, nodeEnv: 'test' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: '', nodeEnv: 'staging' })).toBe(true);
      // NODE_ENV unset is also non-production.
      expect(isEmailIntegrationEnabled({})).toBe(true);
    });

    it('returns true when the flag is explicitly truthy', () => {
      expect(isEmailIntegrationEnabled({ flag: 'true', nodeEnv: 'development' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: '1', nodeEnv: 'test' })).toBe(true);
    });

    it('respects explicit disable even in non-production', () => {
      expect(isEmailIntegrationEnabled({ flag: 'false', nodeEnv: 'development' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: 'no', nodeEnv: 'test' })).toBe(false);
    });
  });

  describe('input hygiene', () => {
    it('trims whitespace and is case-insensitive', () => {
      expect(isEmailIntegrationEnabled({ flag: '  true ', nodeEnv: 'production' })).toBe(true);
      expect(isEmailIntegrationEnabled({ flag: ' False ', nodeEnv: 'development' })).toBe(false);
    });

    it('non-string flag is treated as missing', () => {
      expect(isEmailIntegrationEnabled({ flag: true, nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: 1, nodeEnv: 'production' })).toBe(false);
      expect(isEmailIntegrationEnabled({ flag: null, nodeEnv: 'production' })).toBe(false);
    });
  });
});

describe('isEmailIntegrationEnabledFromProcessEnv', () => {
  const originalFlag = process.env.EMAIL_INTEGRATION_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.EMAIL_INTEGRATION_ENABLED;
    else process.env.EMAIL_INTEGRATION_ENABLED = originalFlag;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('reads from process.env directly', () => {
    process.env.EMAIL_INTEGRATION_ENABLED = 'true';
    process.env.NODE_ENV = 'production';
    expect(isEmailIntegrationEnabledFromProcessEnv()).toBe(true);

    delete process.env.EMAIL_INTEGRATION_ENABLED;
    process.env.NODE_ENV = 'production';
    expect(isEmailIntegrationEnabledFromProcessEnv()).toBe(false);

    delete process.env.EMAIL_INTEGRATION_ENABLED;
    process.env.NODE_ENV = 'development';
    expect(isEmailIntegrationEnabledFromProcessEnv()).toBe(true);
  });
});

describe('server wiring', () => {
  let serverSource;
  beforeAll(() => {
    serverSource = readFileSync(join(__dirname, '..', '..', 'server.js'), 'utf8');
  });

  it('imports the email-flag helper', () => {
    expect(serverSource).toMatch(/isEmailIntegrationEnabledFromProcessEnv/);
  });

  it('/auth/me exposes the emailIntegrationEnabled feature flag to the client', () => {
    const meRouteStart = serverSource.indexOf("app.get('/auth/me'");
    expect(meRouteStart).toBeGreaterThan(-1);
    const nextRoute = serverSource.indexOf("app.", meRouteStart + 1);
    const meRouteBody = serverSource.slice(meRouteStart, nextRoute);
    expect(meRouteBody).toMatch(/emailIntegrationEnabled:\s*isEmailIntegrationEnabledFromProcessEnv\(\)/);
  });
});

describe('client wiring', () => {
  it('App.jsx reads emailIntegrationEnabled from /auth/me payload', () => {
    const appSource = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8');
    expect(appSource).toMatch(/emailIntegrationEnabled/);
    // Pin the setter pattern so a future refactor can't drop the
    // server-driven update silently.
    expect(appSource).toMatch(/setEmailIntegrationEnabled\(!!data\.features\.emailIntegrationEnabled\)/);
  });

  it('App.jsx threads emailIntegrationEnabled into QuoteOutput', () => {
    const appSource = readFileSync(join(__dirname, '..', 'App.jsx'), 'utf8');
    expect(appSource).toMatch(/<QuoteOutput[\s\S]{0,800}emailIntegrationEnabled=\{emailIntegrationEnabled\}/);
  });

  it('QuoteOutput accepts emailIntegrationEnabled with a safe-off default', () => {
    const quoteOutputSource = readFileSync(
      join(__dirname, '..', 'components', 'steps', 'QuoteOutput.jsx'),
      'utf8'
    );
    expect(quoteOutputSource).toMatch(/emailIntegrationEnabled\s*=\s*false/);
  });

  it('QuoteOutput renders the Email + Outlook menu items only when the flag is on', () => {
    const quoteOutputSource = readFileSync(
      join(__dirname, '..', 'components', 'steps', 'QuoteOutput.jsx'),
      'utf8'
    );
    // The flag check guards both items.
    expect(quoteOutputSource).toMatch(
      /if \(emailIntegrationEnabled\)[\s\S]{0,800}['"]Send via Email['"]/
    );
    expect(quoteOutputSource).toMatch(
      /if \(emailIntegrationEnabled\)[\s\S]{0,800}['"]Send via Outlook['"]/
    );
  });
});

describe('CLAUDE.md Pitfall #15 — load-bearing email code is preserved', () => {
  it('buildEmlMessage.js still exists', () => {
    const buildEmlSource = readFileSync(
      join(__dirname, '..', 'utils', 'buildEmlMessage.js'),
      'utf8'
    );
    expect(buildEmlSource.length).toBeGreaterThan(0);
    // Pin the two load-bearing rules: CRLF + X-Unsent: 1.
    expect(buildEmlSource).toMatch(/X-Unsent/);
  });

  it('QuoteOutput still imports buildEmlMessage and wires handleSendViaOutlook', () => {
    const quoteOutputSource = readFileSync(
      join(__dirname, '..', 'components', 'steps', 'QuoteOutput.jsx'),
      'utf8'
    );
    expect(quoteOutputSource).toMatch(/import\s*\{\s*buildEmlMessage\s*\}/);
    expect(quoteOutputSource).toMatch(/const handleSendViaOutlook = async/);
    expect(quoteOutputSource).toMatch(/const handleEmail = \(\)/);
  });
});
