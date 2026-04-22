import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { safeError } from '../../safeError.js';

describe('safeError', () => {
  let res;
  let consoleErrorSpy;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('returns generic message for 500 errors', () => {
    const err = new Error('relation "jobs" does not exist');
    safeError(res, err, 'POST /api/users/mark/jobs');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Something went wrong. Please try again.' });
  });

  test('does not leak internal error details for 500', () => {
    const err = new Error('FATAL: password authentication failed for user "postgres"');
    safeError(res, err, 'GET /api/users');
    const response = res.json.mock.calls[0][0];
    expect(response.error).not.toContain('password');
    expect(response.error).not.toContain('postgres');
  });

  test('preserves specific message for 400 errors', () => {
    const err = new Error('diffs must be an array');
    safeError(res, err, 'POST /api/diffs', 400);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'diffs must be an array' });
  });

  test('preserves specific message for 404 errors', () => {
    const err = new Error('Job not found');
    safeError(res, err, 'PUT /api/jobs/123', 404);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Job not found' });
  });

  test('logs full error to console.error with context', () => {
    const err = new Error('connection refused');
    safeError(res, err, 'GET /api/users/mark/profile');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[GET /api/users/mark/profile]',
      'connection refused'
    );
  });

  test('handles error without message gracefully', () => {
    safeError(res, {}, 'GET /api/test');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Something went wrong. Please try again.' });
  });

  describe('transient infrastructure errors → 503 + Retry-After', () => {
    test('Railway DNS blip (EAI_AGAIN) returns 503 with Retry-After and retryable flag', () => {
      // Literal error we saw in today's outage.
      const err = Object.assign(
        new Error('getaddrinfo EAI_AGAIN postgres-8dej.railway.internal'),
        { code: 'EAI_AGAIN' }
      );
      safeError(res, err, 'GET /api/users/mark/jobs');
      expect(res.set).toHaveBeenCalledWith('Retry-After', '10');
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual(expect.objectContaining({ retryable: true }));
      expect(body.error).toMatch(/reconnecting/i);
    });

    test('Postgres cannot_connect_now (57P03) returns 503', () => {
      const err = Object.assign(new Error('the database is starting up'), { code: '57P03' });
      safeError(res, err, 'GET /api/test');
      expect(res.status).toHaveBeenCalledWith(503);
    });

    test('ECONNREFUSED returns 503', () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      });
      safeError(res, err, 'POST /api/test');
      expect(res.status).toHaveBeenCalledWith(503);
    });

    test('SQL syntax error (42601) still returns a 500, NOT a 503', () => {
      // Regression guard: classifying real bugs as transient would hide
      // them behind "try again later" and delay diagnosis.
      const err = Object.assign(new Error('syntax error at or near "SELEKT"'), {
        code: '42601',
      });
      safeError(res, err, 'POST /api/test');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.set).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    });

    test('error code missing but message contains "EAI_AGAIN" → still 503', () => {
      // Some pg/node layers strip .code but keep the message. We must
      // still recognise the outage.
      const err = new Error('getaddrinfo EAI_AGAIN postgres-8dej.railway.internal');
      safeError(res, err, 'GET /api/test');
      expect(res.status).toHaveBeenCalledWith(503);
    });

    test('503 response does NOT leak internal error details', () => {
      const err = Object.assign(
        new Error('getaddrinfo EAI_AGAIN postgres-8dej.railway.internal'),
        { code: 'EAI_AGAIN' }
      );
      safeError(res, err, 'GET /api/test');
      const body = res.json.mock.calls[0][0];
      expect(body.error).not.toContain('postgres-8dej.railway.internal');
      expect(body.error).not.toContain('EAI_AGAIN');
    });
  });
});
