import { jest } from '@jest/globals';

// Set fake key so getClient() doesn't throw before reaching the mock
process.env.OPENAI_API_KEY = 'test-key-for-jest';

// Mock the openai module before importing whisperClient
const mockCreate = jest.fn();
jest.unstable_mockModule('openai', () => ({
  default: class OpenAI {
    constructor() {
      this.audio = { transcriptions: { create: mockCreate } };
    }
  },
}));

const { transcribe, TRADE_PROMPT } = await import('../utils/whisperClient.js');

describe('whisperClient', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('transcribe', () => {
    it('returns trimmed text from Whisper response', async () => {
      mockCreate.mockResolvedValue({ text: '  Collapsed section near the gate.  ' });
      const result = await transcribe(Buffer.from('fake-audio'), 'audio/webm');
      expect(result).toBe('Collapsed section near the gate.');
    });

    it('passes correct model and language to Whisper', async () => {
      mockCreate.mockResolvedValue({ text: 'test' });
      await transcribe(Buffer.from('audio'), 'audio/webm');
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('whisper-1');
      expect(callArgs.language).toBe('en');
    });

    it('includes trade-vocabulary prompt bias', async () => {
      mockCreate.mockResolvedValue({ text: 'test' });
      await transcribe(Buffer.from('audio'), 'audio/mp4');
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.prompt).toBeDefined();
      expect(callArgs.prompt).toContain('gritstone');
      expect(callArgs.prompt).toContain('hearting');
      expect(callArgs.prompt).toContain('through-stones');
      expect(callArgs.prompt).toContain('cope stones');
      expect(callArgs.prompt).toContain('lime mortar');
      expect(callArgs.prompt).toContain('galleting');
    });

    it('requests json response format', async () => {
      mockCreate.mockResolvedValue({ text: 'test' });
      await transcribe(Buffer.from('audio'), 'audio/webm');
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.response_format).toBe('json');
    });

    it('propagates OpenAI errors', async () => {
      mockCreate.mockRejectedValue(new Error('OpenAI rate limit exceeded'));
      await expect(transcribe(Buffer.from('audio'), 'audio/webm'))
        .rejects.toThrow('OpenAI rate limit exceeded');
    });

    it('handles empty transcript', async () => {
      mockCreate.mockResolvedValue({ text: '   ' });
      const result = await transcribe(Buffer.from('audio'), 'audio/webm');
      expect(result).toBe('');
    });

    it('passes a file object to the API', async () => {
      mockCreate.mockResolvedValue({ text: 'wall needs rebuilding' });
      await transcribe(Buffer.from('audio-data'), 'audio/mp4');
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.file).toBeDefined();
    });
  });

  describe('TRADE_PROMPT', () => {
    it('is exported for testing/reuse', () => {
      expect(typeof TRADE_PROMPT).toBe('string');
      expect(TRADE_PROMPT.length).toBeGreaterThan(50);
    });

    it('contains dry stone walling context', () => {
      expect(TRADE_PROMPT.toLowerCase()).toContain('dry stone');
    });
  });
});
