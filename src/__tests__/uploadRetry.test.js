import { jest } from '@jest/globals';

// ── Tests for upload retry logic ────────────────────────────────────

describe('uploadWithRetry', () => {
  let uploadWithRetry;

  beforeAll(async () => {
    ({ uploadWithRetry } = await import('../utils/uploadWithProgress.js'));
  });

  it('exports uploadWithRetry function', () => {
    expect(typeof uploadWithRetry).toBe('function');
  });

  it('resolves on first attempt if successful', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 200,
      responseText: '{"ok":true}',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const resultPromise = uploadWithRetry({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
      onRetry: () => {},
    });

    // Trigger success
    mockXHR.onload?.();
    const result = await resultPromise;
    expect(result).toEqual({ ok: true });

    global.XMLHttpRequest = originalXHR;
  });

  it('retries on retryable error (network)', async () => {
    const originalXHR = global.XMLHttpRequest;
    let callCount = 0;
    const retryCalls = [];

    global.XMLHttpRequest = jest.fn(() => {
      callCount++;
      const mockXHR = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        abort: jest.fn(),
        upload: {},
        readyState: 4,
        status: callCount <= 2 ? 0 : 200,
        responseText: callCount <= 2 ? '' : '{"ok":true}',
        timeout: 0,
      };

      // Schedule the appropriate callback
      setTimeout(() => {
        if (callCount <= 2) {
          mockXHR.onerror?.();
        } else {
          mockXHR.onload?.();
        }
      }, 0);

      return mockXHR;
    });

    const result = await uploadWithRetry({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
      onRetry: (info) => retryCalls.push(info),
      maxRetries: 3,
      backoffMs: 10, // Fast for tests
    });

    expect(result).toEqual({ ok: true });
    expect(retryCalls.length).toBe(2);
    expect(retryCalls[0].attempt).toBe(1);
    expect(retryCalls[1].attempt).toBe(2);

    global.XMLHttpRequest = originalXHR;
  });

  it('does not retry on non-retryable error (400)', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 400,
      responseText: '{"error":"Bad request"}',
      timeout: 0,
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const retryCalls = [];
    const resultPromise = uploadWithRetry({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
      onRetry: (info) => retryCalls.push(info),
      maxRetries: 3,
      backoffMs: 10,
    });

    mockXHR.onload?.();

    await expect(resultPromise).rejects.toThrow('Bad request');
    expect(retryCalls.length).toBe(0);

    global.XMLHttpRequest = originalXHR;
  });

  it('gives up after maxRetries exhausted', async () => {
    const originalXHR = global.XMLHttpRequest;
    const retryCalls = [];

    global.XMLHttpRequest = jest.fn(() => {
      const mockXHR = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        abort: jest.fn(),
        upload: {},
        readyState: 4,
        status: 0,
        responseText: '',
        timeout: 0,
      };
      setTimeout(() => mockXHR.onerror?.(), 0);
      return mockXHR;
    });

    await expect(
      uploadWithRetry({
        url: '/api/test',
        body: new FormData(),
        onProgress: () => {},
        onRetry: (info) => retryCalls.push(info),
        maxRetries: 2,
        backoffMs: 10,
      })
    ).rejects.toThrow();

    // 2 retries = 2 onRetry calls (original attempt + 2 retries)
    expect(retryCalls.length).toBe(2);

    global.XMLHttpRequest = originalXHR;
  });

  it('provides attempt and maxRetries in onRetry callback', async () => {
    const originalXHR = global.XMLHttpRequest;
    const retryCalls = [];
    let callCount = 0;

    global.XMLHttpRequest = jest.fn(() => {
      callCount++;
      const mockXHR = {
        open: jest.fn(),
        send: jest.fn(),
        setRequestHeader: jest.fn(),
        abort: jest.fn(),
        upload: {},
        readyState: 4,
        status: callCount <= 1 ? 0 : 200,
        responseText: callCount <= 1 ? '' : '{"ok":true}',
        timeout: 0,
      };
      setTimeout(() => {
        if (callCount <= 1) mockXHR.onerror?.();
        else mockXHR.onload?.();
      }, 0);
      return mockXHR;
    });

    await uploadWithRetry({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
      onRetry: (info) => retryCalls.push(info),
      maxRetries: 3,
      backoffMs: 10,
    });

    expect(retryCalls[0]).toEqual(expect.objectContaining({
      attempt: 1,
      maxRetries: 3,
    }));

    global.XMLHttpRequest = originalXHR;
  });
});

describe('JobDetails retry wiring', () => {
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

  it('uses uploadWithRetry instead of uploadWithProgress', () => {
    expect(jobDetailsSource).toMatch(/uploadWithRetry/);
  });

  it('passes onRetry callback', () => {
    expect(jobDetailsSource).toMatch(/onRetry/);
  });
});
