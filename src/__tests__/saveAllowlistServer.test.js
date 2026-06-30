import { SERVER_SAVE_ALLOWLIST, pickAllowedKeys } from '../../serverSaveAllowlist.js';

describe('SERVER_SAVE_ALLOWLIST', () => {
  test('contains expected keys', () => {
    expect(SERVER_SAVE_ALLOWLIST).toContain('profile');
    expect(SERVER_SAVE_ALLOWLIST).toContain('jobDetails');
    expect(SERVER_SAVE_ALLOWLIST).toContain('reviewData');
    expect(SERVER_SAVE_ALLOWLIST).toContain('quotePayload');
    expect(SERVER_SAVE_ALLOWLIST).toContain('quoteSequence');
    expect(SERVER_SAVE_ALLOWLIST).toContain('diffs');
  });

  test('excludes photos and blobs', () => {
    expect(SERVER_SAVE_ALLOWLIST).not.toContain('photos');
    expect(SERVER_SAVE_ALLOWLIST).not.toContain('extraPhotos');
  });

  test('excludes aiRawResponse (lifecycle bug-hunt 2026-06-30 #5)', () => {
    // aiRawResponse is transient (CLAUDE.md Pitfall #3). The SPA's
    // client SAVE_ALLOWLIST never sent it at top-level — only the
    // nested quotePayload.quote.aiRawResponse was leaking through
    // (also stripped in quoteBuilder.js). This server entry was
    // dead code carrying a GDPR + snapshot-bloat liability.
    expect(SERVER_SAVE_ALLOWLIST).not.toContain('aiRawResponse');
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
