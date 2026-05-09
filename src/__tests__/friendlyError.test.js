import { classifyAnalysisError } from '../utils/friendlyError.js';

describe('classifyAnalysisError', () => {
  test('preserves the existing 400 contract for the two known video-validation messages', () => {
    expect(classifyAnalysisError(new Error('Video must be under 3 minutes'))).toEqual({
      status: 400,
      message: 'Video must be under 3 minutes',
    });
    expect(classifyAnalysisError(new Error('Video appears to be empty'))).toEqual({
      status: 400,
      message: 'Video appears to be empty',
    });
  });

  test('returns 413 with logo guidance when multer field-size limit is hit', () => {
    const err = Object.assign(new Error('Field value too long'), { code: 'LIMIT_FIELD_VALUE' });
    const result = classifyAnalysisError(err);
    expect(result.status).toBe(413);
    expect(result.message).toMatch(/profile data is too large/i);
    expect(result.message).toMatch(/logo/i);
  });

  test('matches multer field-size limit by message alone (no code)', () => {
    const result = classifyAnalysisError(new Error('Field value too long'));
    expect(result?.status).toBe(413);
  });

  test('returns 413 for a too-large video file', () => {
    const err = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
    const result = classifyAnalysisError(err);
    expect(result.status).toBe(413);
    expect(result.message).toMatch(/500MB/);
  });

  test('returns 422 with photo fallback hint when Whisper rejects audio format', () => {
    const err = new Error("400 Invalid file format. Supported formats: ['flac', 'm4a', 'mp4']");
    const result = classifyAnalysisError(err);
    expect(result.status).toBe(422);
    expect(result.message).toMatch(/audio/i);
    expect(result.message).toMatch(/photos instead/i);
  });

  test('returns 503 when OPENAI_API_KEY is missing', () => {
    const result = classifyAnalysisError(new Error('OPENAI_API_KEY is not configured'));
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/voice transcription/i);
  });

  test('returns 429 for Anthropic rate-limit errors', () => {
    const result = classifyAnalysisError(new Error('Anthropic API error (429): rate_limit_error'));
    expect(result.status).toBe(429);
    expect(result.message).toMatch(/wait a moment/i);
  });

  test('returns 503 for Anthropic 529 overloaded errors', () => {
    const result = classifyAnalysisError(new Error('Anthropic API error (529): overloaded_error'));
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/overloaded/i);
  });

  test('returns 503 generic for other Anthropic API errors', () => {
    const result = classifyAnalysisError(new Error('Anthropic API error (500): internal_server_error'));
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/AI service/i);
  });

  test('returns 503 when ANTHROPIC_API_KEY is missing', () => {
    const result = classifyAnalysisError(new Error('ANTHROPIC_API_KEY not configured'));
    expect(result.status).toBe(503);
  });

  test('returns 422 with photo fallback hint for ffmpeg failures', () => {
    const result = classifyAnalysisError(new Error('ffmpeg exited with code 1: Invalid data found when processing input'));
    expect(result.status).toBe(422);
    expect(result.message).toMatch(/photos instead/i);
  });

  test('returns 502 with retry hint when the model returns unparseable JSON', () => {
    const result = classifyAnalysisError(new Error('Anthropic API returned unparseable response: …'));
    expect(result.status).toBe(502);
    expect(result.message).toMatch(/try again/i);
  });

  test('returns null for unmapped errors so callers fall through to safeError', () => {
    expect(classifyAnalysisError(new Error('something completely unexpected'))).toBeNull();
    expect(classifyAnalysisError(null)).toBeNull();
    expect(classifyAnalysisError(undefined)).toBeNull();
    expect(classifyAnalysisError({})).toBeNull();
  });
});
