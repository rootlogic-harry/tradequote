/**
 * VoiceRecorder component tests.
 *
 * These test the exported helpers and state logic without requiring
 * a real DOM or MediaRecorder (Jest runs in Node, not a browser).
 *
 * Browser-dependent behaviour (getUserMedia, MediaRecorder) is tested
 * via the capability-detection helpers and the state machine logic.
 */

import {
  buildInsertedText,
  applyRemoval,
  isSegmentEdited,
  formatTime,
  VOICE_STATES,
  MAX_DURATION_MS,
  WARNING_THRESHOLD_MS,
} from '../utils/voiceRecorderHelpers.js';

describe('VoiceRecorder', () => {

  // ── Constants ──

  describe('constants', () => {
    it('max duration is 120 seconds', () => {
      expect(MAX_DURATION_MS).toBe(120_000);
    });

    it('warning threshold is 105 seconds (1:45)', () => {
      expect(WARNING_THRESHOLD_MS).toBe(105_000);
    });

    it('exports all required states', () => {
      expect(VOICE_STATES.IDLE).toBe('idle');
      expect(VOICE_STATES.RECORDING).toBe('recording');
      expect(VOICE_STATES.WARNING).toBe('warning');
      expect(VOICE_STATES.PROCESSING).toBe('processing');
      expect(VOICE_STATES.SUCCESS).toBe('success');
      expect(VOICE_STATES.ERROR).toBe('error');
      expect(VOICE_STATES.PERMISSION_DENIED).toBe('permission_denied');
      expect(VOICE_STATES.UNSUPPORTED).toBe('unsupported');
    });
  });

  // ── Text insertion logic ──

  describe('buildInsertedText', () => {
    it('inserts transcript into empty field', () => {
      const result = buildInsertedText('', 'Collapsed section near gate', '');
      expect(result).toBe('Collapsed section near gate');
    });

    it('appends transcript after existing text with blank line', () => {
      const result = buildInsertedText(
        'Existing notes here',
        'Wall needs full rebuild',
        'Existing notes here'
      );
      expect(result).toBe('Existing notes here\n\nWall needs full rebuild');
    });

    it('places transcript between pre-recording text and pending typed text', () => {
      const preRecording = 'Before recording.';
      const transcript = 'Dictated segment.';
      const currentValue = 'Before recording. Typed during transcription.';
      const result = buildInsertedText(preRecording, transcript, currentValue);
      // Should be: preRecording + transcript + pendingTyped
      expect(result).toContain('Before recording.');
      expect(result).toContain('Dictated segment.');
      expect(result).toContain('Typed during transcription.');
      // Transcript must come before pending typed text
      const transcriptIdx = result.indexOf('Dictated segment.');
      const pendingIdx = result.indexOf('Typed during transcription.');
      expect(transcriptIdx).toBeLessThan(pendingIdx);
    });

    it('handles trailing whitespace in pre-recording text', () => {
      const result = buildInsertedText('Notes  ', 'Transcript', 'Notes  ');
      expect(result).toBe('Notes\n\nTranscript');
    });

    it('handles pre-recording text ending with newlines', () => {
      const result = buildInsertedText('Notes\n\n', 'Transcript', 'Notes\n\n');
      expect(result).toBe('Notes\n\nTranscript');
    });

    it('preserves pending typed text that starts with whitespace', () => {
      const preRecording = 'Start';
      const transcript = 'Middle';
      const currentValue = 'Start and end';
      const result = buildInsertedText(preRecording, transcript, currentValue);
      expect(result).toContain('and end');
    });
  });

  // ── Segment edit detection ──

  describe('isSegmentEdited', () => {
    it('returns false when segment text unchanged in value', () => {
      const value = 'Some text\n\nOriginal transcript\n\nMore text';
      expect(isSegmentEdited('Original transcript', value)).toBe(false);
    });

    it('returns true when segment text is no longer found', () => {
      const value = 'Some text\n\nEdited transcript\n\nMore text';
      expect(isSegmentEdited('Original transcript', value)).toBe(true);
    });

    it('returns true for empty value', () => {
      expect(isSegmentEdited('Original transcript', '')).toBe(true);
    });

    it('returns false for exact match', () => {
      expect(isSegmentEdited('Hello', 'Hello')).toBe(false);
    });
  });

  // ── Removal logic ──

  describe('applyRemoval', () => {
    it('removes a single unedited segment from the text', () => {
      const segments = [{ text: 'Recorded part', edited: false }];
      const value = 'Manual text\n\nRecorded part\n\nMore manual';
      const result = applyRemoval(value, segments);
      expect(result).not.toContain('Recorded part');
      expect(result).toContain('Manual text');
      expect(result).toContain('More manual');
    });

    it('preserves edited segments', () => {
      const segments = [
        { text: 'Kept because edited', edited: true },
        { text: 'Removed unedited', edited: false },
      ];
      const value = 'Kept because edited\n\nRemoved unedited';
      const result = applyRemoval(value, segments);
      expect(result).toContain('Kept because edited');
      expect(result).not.toContain('Removed unedited');
    });

    it('cleans up double blank lines after removal', () => {
      const segments = [{ text: 'Middle part', edited: false }];
      const value = 'Top\n\nMiddle part\n\nBottom';
      const result = applyRemoval(value, segments);
      expect(result).not.toContain('\n\n\n');
    });

    it('trims leading/trailing whitespace after removal', () => {
      const segments = [{ text: 'Only recorded', edited: false }];
      const value = 'Only recorded';
      const result = applyRemoval(value, segments);
      expect(result).toBe('');
    });

    it('removes multiple unedited segments', () => {
      const segments = [
        { text: 'First recording', edited: false },
        { text: 'Second recording', edited: false },
      ];
      const value = 'Manual\n\nFirst recording\n\nSecond recording';
      const result = applyRemoval(value, segments);
      expect(result).toBe('Manual');
    });

    it('handles segment not found in value (already manually deleted)', () => {
      const segments = [{ text: 'Ghost segment', edited: false }];
      const value = 'Just manual text';
      const result = applyRemoval(value, segments);
      expect(result).toBe('Just manual text');
    });

    it('returns empty string when all text was recorded and unedited', () => {
      const segments = [{ text: 'All recorded', edited: false }];
      const value = 'All recorded';
      const result = applyRemoval(value, segments);
      expect(result).toBe('');
    });
  });

  // ── UI copy / banned vocabulary ──

  describe('design-law compliance', () => {
    // Dynamically read the component source to check for banned terms
    // This mirrors aiTextRemoval.test.js pattern
    let source;
    beforeAll(async () => {
      const fs = await import('fs');
      const componentSrc = fs.readFileSync(
        new URL('../components/VoiceRecorder.jsx', import.meta.url),
        'utf-8'
      );
      const helperSrc = fs.readFileSync(
        new URL('../utils/voiceRecorderHelpers.js', import.meta.url),
        'utf-8'
      );
      source = componentSrc + '\n' + helperSrc;
    });

    const bannedTerms = [
      'artificial intelligence',
      'LLM',
      'Claude',
      'Sonnet',
      'Whisper',
      'OpenAI',
      'GPT',
      'model',
      'confidence',
      'calibration',
    ];

    // Skip case-sensitive terms that appear in code identifiers
    const bannedInUserFacingStrings = ['AI ', ' AI', 'AI-', 'AI,', 'AI.'];

    it.each(bannedTerms)('does not contain banned term: %s', (term) => {
      // Only check string literals (inside quotes)
      const stringPattern = new RegExp(`['"\`][^'"\`]*${term}[^'"\`]*['"\`]`, 'i');
      expect(source).not.toMatch(stringPattern);
    });

    it('button labels do not mention AI', () => {
      // Extract string literals that look like button labels
      const labels = source.match(/>[^<]*</g) || [];
      const combined = labels.join(' ').toLowerCase();
      for (const term of bannedInUserFacingStrings) {
        expect(combined).not.toContain(term.toLowerCase());
      }
    });
  });
});
