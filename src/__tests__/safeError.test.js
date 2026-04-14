import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { safeError } from '../../safeError.js';

describe('safeError', () => {
  let res;
  let consoleErrorSpy;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
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
});
