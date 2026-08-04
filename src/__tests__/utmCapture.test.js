/**
 * pickUtms — pure helper. Same threat model as normaliseReferralCode:
 * defensive at the earliest layer so downstream code (session store,
 * DB, admin dashboard) never sees a hostile string.
 *
 * Ad-attribution spec (2026-08-04): FastQuote captures utm_source /
 * utm_campaign / utm_medium once, at signup, into three nullable
 * columns on users. NULL = direct / organic / word-of-mouth.
 */
import { pickUtms, UTM_MAX_LENGTH } from '../utils/utmCapture.js';

describe('pickUtms — happy path', () => {
  it('extracts all three when present', () => {
    expect(pickUtms({
      utm_source: 'meta',
      utm_campaign: 'test1',
      utm_medium: 'paid_social',
    })).toEqual({
      source: 'meta',
      campaign: 'test1',
      medium: 'paid_social',
    });
  });

  it('extracts source alone (common Meta ad case)', () => {
    // Real Meta ads often supply source + campaign but no medium —
    // the utm_medium field is manual and frequently skipped.
    expect(pickUtms({ utm_source: 'meta' })).toEqual({
      source: 'meta',
      campaign: null,
      medium: null,
    });
  });

  it('trims surrounding whitespace before validating', () => {
    // Ad managers sometimes paste with trailing spaces; a leading/
    // trailing space shouldn't cost the attribution.
    expect(pickUtms({ utm_source: '  meta  ' })).toEqual({
      source: 'meta',
      campaign: null,
      medium: null,
    });
  });

  it('accepts realistic ad-manager naming conventions', () => {
    // Case + digits + hyphens + underscores + dots — all four are
    // used by Meta Ads Manager, Google Ads, LinkedIn.
    expect(pickUtms({
      utm_source: 'Meta-Ads',
      utm_campaign: 'launch_2026-08-04.v2',
      utm_medium: 'paid.social',
    })).toEqual({
      source: 'Meta-Ads',
      campaign: 'launch_2026-08-04.v2',
      medium: 'paid.social',
    });
  });
});

describe('pickUtms — null return (no attribution to record)', () => {
  it('returns null when none of the three keys are present', () => {
    expect(pickUtms({})).toBeNull();
    expect(pickUtms({ ref: 'PAUL-X7K9', remember: '1' })).toBeNull();
  });

  it('returns null for missing/nullish input', () => {
    // Defensive — real callers pass req.query which is always an
    // object, but a future refactor could pass undefined and we
    // want the helper to no-op rather than throw.
    expect(pickUtms(undefined)).toBeNull();
    expect(pickUtms(null)).toBeNull();
    expect(pickUtms('meta')).toBeNull();
  });

  it('returns null when every UTM is present-but-invalid', () => {
    // All three fail validation → nothing to persist → null (not
    // { source: null, campaign: null, medium: null } which would
    // still trigger a session-stash + DB no-op write).
    expect(pickUtms({
      utm_source: '',
      utm_campaign: '   ',
      utm_medium: 'x'.repeat(UTM_MAX_LENGTH + 1),
    })).toBeNull();
  });
});

describe('pickUtms — partial validity (drop bad, keep good)', () => {
  it('drops an invalid field but keeps the valid siblings', () => {
    // Reason: real-world tracking often has one broken param
    // (someone pasted a tag manager token into utm_campaign by
    // mistake). Losing source alongside is worse than logging
    // source without campaign.
    expect(pickUtms({
      utm_source: 'meta',
      utm_campaign: 'x'.repeat(UTM_MAX_LENGTH + 1),
      utm_medium: 'paid',
    })).toEqual({
      source: 'meta',
      campaign: null,
      medium: 'paid',
    });
  });
});

describe('pickUtms — length + type defences', () => {
  it('rejects values longer than 64 chars', () => {
    expect(pickUtms({ utm_source: 'x'.repeat(UTM_MAX_LENGTH + 1) })).toBeNull();
    // Exactly at the cap still passes — off-by-one guard.
    expect(pickUtms({ utm_source: 'x'.repeat(UTM_MAX_LENGTH) })?.source).toBe(
      'x'.repeat(UTM_MAX_LENGTH),
    );
  });

  it('rejects non-string types (numbers, booleans, objects)', () => {
    expect(pickUtms({ utm_source: 123 })).toBeNull();
    expect(pickUtms({ utm_source: true })).toBeNull();
    expect(pickUtms({ utm_source: { evil: 1 } })).toBeNull();
  });

  it('rejects arrays — Express hands us [a, b] for ?k=a&k=b duplicates', () => {
    // Attackers can weaponise param duplication to smuggle values
    // past naive validators. Arrays fail the typeof-string check.
    expect(pickUtms({ utm_source: ['meta', 'evil'] })).toBeNull();
  });
});

describe('pickUtms — alphabet defence (XSS / header injection)', () => {
  it('rejects whitespace inside the value (post-trim)', () => {
    expect(pickUtms({ utm_source: 'meta ads' })).toBeNull();
    expect(pickUtms({ utm_source: 'meta\tads' })).toBeNull();
  });

  it('rejects angle brackets, quotes, backslashes, ampersands', () => {
    for (const bad of ['<script>', '"; DROP', "\\evil", 'a&b', "a'b", 'a`b']) {
      expect(pickUtms({ utm_source: bad })).toBeNull();
    }
  });

  it('rejects newlines and CR (header-injection defence)', () => {
    // A UTM that survives into an admin dashboard cell could poison
    // a downstream Set-Cookie if it slipped through as-is. Reject
    // \r and \n at the earliest layer.
    expect(pickUtms({ utm_source: 'meta\nSet-Cookie: evil=1' })).toBeNull();
    expect(pickUtms({ utm_source: 'meta\r\nX-Injected: 1' })).toBeNull();
  });

  it('rejects null bytes and other control characters', () => {
    expect(pickUtms({ utm_source: 'meta\x00' })).toBeNull();
    expect(pickUtms({ utm_source: 'meta\x1b' })).toBeNull();
  });
});
