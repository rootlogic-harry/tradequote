import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { safeError, formatErrorContext } from '../../safeError.js';

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

  describe('formatErrorContext — surfaces diagnostic fields by error shape', () => {
    test('Stripe errors get their detail / code / type extracted', () => {
      // Reproduces the 2026-06-17 incident: a Stripe SDK
      // StripeConnectionError where the underlying ERR_INVALID_CHAR
      // was hidden inside err.detail. Without this extraction,
      // logs only show "An error occurred with our connection to
      // Stripe" with no clue what caused it.
      const detail = new TypeError(
        'Invalid character in header content ["Authorization"]'
      );
      detail.code = 'ERR_INVALID_CHAR';
      const err = Object.assign(
        new Error('An error occurred with our connection to Stripe.'),
        { type: 'StripeConnectionError', code: undefined, detail }
      );
      const ctx = formatErrorContext(err);
      expect(ctx).toEqual({
        stripe: {
          type: 'StripeConnectionError',
          code: undefined,
          statusCode: undefined,
          requestId: undefined,
          detail: 'Invalid character in header content ["Authorization"]',
        },
      });
    });

    test('Stripe API errors include statusCode + requestId', () => {
      // Typical shape of a Stripe API-side error (4xx with a code).
      const err = Object.assign(new Error('No such price: price_bogus'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 404,
        requestId: 'req_abc123',
      });
      const ctx = formatErrorContext(err);
      expect(ctx.stripe).toEqual({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 404,
        requestId: 'req_abc123',
        detail: undefined,
      });
    });

    test('Node fs/net errors get code + errno + syscall', () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED', errno: -61, syscall: 'connect',
      });
      const ctx = formatErrorContext(err);
      expect(ctx).toEqual({
        node: { code: 'ECONNREFUSED', errno: -61, syscall: 'connect' },
      });
    });

    test('Errors with a .cause drill one level deep', () => {
      const cause = new Error('downstream timeout');
      const err = new Error('aggregate failed');
      err.cause = cause;
      const ctx = formatErrorContext(err);
      expect(ctx).toEqual({ cause: 'downstream timeout' });
    });

    test('Plain Error with nothing to extract returns null (no noise in log)', () => {
      const err = new Error('something went wrong');
      expect(formatErrorContext(err)).toBeNull();
    });

    test('null / non-object input is safe (no crash)', () => {
      expect(formatErrorContext(null)).toBeNull();
      expect(formatErrorContext(undefined)).toBeNull();
      expect(formatErrorContext('a string')).toBeNull();
      expect(formatErrorContext(42)).toBeNull();
    });
  });

  describe('safeError — logs the diagnostic context line', () => {
    test('Stripe error log includes the structured context object', () => {
      const detail = new TypeError('Invalid character');
      const err = Object.assign(
        new Error('An error occurred with our connection to Stripe.'),
        { type: 'StripeConnectionError', detail }
      );
      safeError(res, err, 'POST /api/billing/checkout');
      // First arg is the bracketed context, then message, then ctx object.
      const calls = consoleErrorSpy.mock.calls;
      expect(calls).toHaveLength(1);
      const [tag, message, ctxObj] = calls[0];
      expect(tag).toBe('[POST /api/billing/checkout]');
      expect(message).toMatch(/connection to Stripe/);
      expect(ctxObj).toHaveProperty('stripe');
      expect(ctxObj.stripe.detail).toMatch(/Invalid character/);
    });

    test('Plain error log keeps the existing 2-arg shape (back-compat)', () => {
      const err = new Error('boring failure');
      safeError(res, err, 'GET /api/test');
      expect(consoleErrorSpy.mock.calls[0]).toEqual([
        '[GET /api/test]',
        'boring failure',
      ]);
    });
  });
});
