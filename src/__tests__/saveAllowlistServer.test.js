import { SERVER_SAVE_ALLOWLIST, pickAllowedKeys } from '../../serverSaveAllowlist.js';

describe('SERVER_SAVE_ALLOWLIST', () => {
  test('contains expected keys', () => {
    expect(SERVER_SAVE_ALLOWLIST).toContain('profile');
    expect(SERVER_SAVE_ALLOWLIST).toContain('jobDetails');
    expect(SERVER_SAVE_ALLOWLIST).toContain('reviewData');
    expect(SERVER_SAVE_ALLOWLIST).toContain('quotePayload');
    expect(SERVER_SAVE_ALLOWLIST).toContain('quoteSequence');
    expect(SERVER_SAVE_ALLOWLIST).toContain('diffs');
    expect(SERVER_SAVE_ALLOWLIST).toContain('aiRawResponse');
  });

  test('excludes photos and blobs', () => {
    expect(SERVER_SAVE_ALLOWLIST).not.toContain('photos');
    expect(SERVER_SAVE_ALLOWLIST).not.toContain('extraPhotos');
  });
});

describe('pickAllowedKeys', () => {
  test('strips disallowed keys', () => {
    const input = {
      profile: { name: 'Mark' },
      jobDetails: { clientName: 'Client A' },
      photos: { overview: { data: 'base64junk' } },
      extraPhotos: [{ data: 'base64junk' }],
      unknownKey: 'should be stripped',
    };
    const result = pickAllowedKeys(input);
    expect(result.profile).toEqual({ name: 'Mark' });
    expect(result.jobDetails).toEqual({ clientName: 'Client A' });
    expect(result.photos).toBeUndefined();
    expect(result.extraPhotos).toBeUndefined();
    expect(result.unknownKey).toBeUndefined();
  });

  test('handles empty input', () => {
    expect(pickAllowedKeys({})).toEqual({});
  });

  test('handles null input', () => {
    expect(pickAllowedKeys(null)).toEqual({});
  });

  test('handles undefined input', () => {
    expect(pickAllowedKeys(undefined)).toEqual({});
  });
});
