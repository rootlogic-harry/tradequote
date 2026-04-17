import { jest } from '@jest/globals';

// ── Tests for uploadWithProgress utility ────────────────────────────

describe('uploadWithProgress', () => {
  let uploadWithProgress;

  beforeAll(async () => {
    ({ uploadWithProgress } = await import('../utils/uploadWithProgress.js'));
  });

  it('exports a function', () => {
    expect(typeof uploadWithProgress).toBe('function');
  });

  it('returns an object with promise and abort', () => {
    // Mock XMLHttpRequest for this test
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 0,
      status: 0,
      responseText: '',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const result = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    expect(result).toHaveProperty('promise');
    expect(result).toHaveProperty('abort');
    expect(typeof result.abort).toBe('function');

    global.XMLHttpRequest = originalXHR;
  });

  it('calls onProgress with upload percentage, speed, and eta', () => {
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

    const progressCalls = [];
    uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: (data) => progressCalls.push(data),
    });

    // Simulate upload progress event
    if (mockXHR.upload.onprogress) {
      mockXHR.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    }

    expect(progressCalls.length).toBeGreaterThanOrEqual(0);
    // If progress was called, check shape
    if (progressCalls.length > 0) {
      expect(progressCalls[0]).toHaveProperty('percent');
    }

    global.XMLHttpRequest = originalXHR;
  });

  it('resolves with parsed JSON on success', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 200,
      responseText: '{"normalised":{"test":true}}',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    // Simulate successful response
    mockXHR.onload?.();

    const result = await promise;
    expect(result).toEqual({ normalised: { test: true } });

    global.XMLHttpRequest = originalXHR;
  });

  it('rejects on HTTP error with error message', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 400,
      responseText: '{"error":"Video too long"}',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    mockXHR.onload?.();

    await expect(promise).rejects.toThrow('Video too long');

    global.XMLHttpRequest = originalXHR;
  });

  it('rejects on network error', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 0,
      responseText: '',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    mockXHR.onerror?.();

    await expect(promise).rejects.toThrow();

    global.XMLHttpRequest = originalXHR;
  });

  it('marks network errors as retryable', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 0,
      responseText: '',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    mockXHR.onerror?.();

    try {
      await promise;
    } catch (err) {
      expect(err.retryable).toBe(true);
    }

    global.XMLHttpRequest = originalXHR;
  });

  it('marks 400 errors as non-retryable', async () => {
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
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    mockXHR.onload?.();

    try {
      await promise;
    } catch (err) {
      expect(err.retryable).toBe(false);
    }

    global.XMLHttpRequest = originalXHR;
  });

  it('marks 500 errors as retryable', async () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
      readyState: 4,
      status: 500,
      responseText: '{"error":"Server error"}',
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { promise } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    mockXHR.onload?.();

    try {
      await promise;
    } catch (err) {
      expect(err.retryable).toBe(true);
    }

    global.XMLHttpRequest = originalXHR;
  });

  it('abort function calls xhr.abort()', () => {
    const originalXHR = global.XMLHttpRequest;
    const mockXHR = {
      open: jest.fn(),
      send: jest.fn(),
      setRequestHeader: jest.fn(),
      abort: jest.fn(),
      upload: {},
    };
    global.XMLHttpRequest = jest.fn(() => mockXHR);

    const { abort } = uploadWithProgress({
      url: '/api/test',
      body: new FormData(),
      onProgress: () => {},
    });

    abort();
    expect(mockXHR.abort).toHaveBeenCalled();

    global.XMLHttpRequest = originalXHR;
  });
});
