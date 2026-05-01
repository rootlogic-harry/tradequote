/**
 * photoLayout (TRQ-177) — aspect-aware sizing rules so two photos
 * always fit per page, regardless of orientation mix.
 */
import {
  aspectBand,
  photoMaxDimensions,
  renderedHeightMm,
  fitsTwoPerPage,
  A4_CONTENT_HEIGHT_MM,
} from '../utils/photoLayout.js';

describe('aspectBand', () => {
  test('Mark\'s 4:3 reference photos band as landscape', () => {
    // Real values from his hand-laid PDF: 932x699, 1353x1022, 928x696,
    // 1353x1021 — all aspect ≈ 1.33
    expect(aspectBand(1.33)).toBe('landscape');
  });

  test("Mark's 16:9 reference photos band as landscape", () => {
    // 902x523, 1308x773 — aspect ≈ 1.72, 1.69
    expect(aspectBand(1.72)).toBe('landscape');
    expect(aspectBand(1.69)).toBe('landscape');
  });

  test('iPhone portrait 3:4 bands as portrait', () => {
    expect(aspectBand(0.75)).toBe('portrait');
  });

  test('iPhone portrait 9:16 bands as portrait', () => {
    expect(aspectBand(9 / 16)).toBe('portrait');
  });

  test('square photo (1.0) bands as square', () => {
    expect(aspectBand(1.0)).toBe('square');
  });

  test('boundary at 1.3 — exactly landscape', () => {
    expect(aspectBand(1.3)).toBe('landscape');
    expect(aspectBand(1.29)).toBe('square');
  });

  test('boundary at 1.0 — exactly square', () => {
    expect(aspectBand(1.0)).toBe('square');
    expect(aspectBand(0.99)).toBe('portrait');
  });

  test('safe defaults — null/0/NaN → landscape', () => {
    expect(aspectBand(null)).toBe('landscape');
    expect(aspectBand(0)).toBe('landscape');
    expect(aspectBand(NaN)).toBe('landscape');
    expect(aspectBand(undefined)).toBe('landscape');
  });
});

describe('photoMaxDimensions', () => {
  test('landscape returns 158×115mm (3mm under Mark reference for budget headroom)', () => {
    expect(photoMaxDimensions(1.33)).toEqual({
      maxWidthMm: 158, maxHeightMm: 115, band: 'landscape',
    });
  });

  test('portrait returns 158×110mm (tighter to fit 2 per page)', () => {
    expect(photoMaxDimensions(0.75)).toEqual({
      maxWidthMm: 158, maxHeightMm: 110, band: 'portrait',
    });
  });

  test('square returns 158×113mm (between portrait and landscape)', () => {
    expect(photoMaxDimensions(1.0)).toEqual({
      maxWidthMm: 158, maxHeightMm: 113, band: 'square',
    });
  });
});

describe('renderedHeightMm', () => {
  test('Mark\'s 4:3 photo: 158/1.33 = 119mm, capped at 115mm', () => {
    expect(renderedHeightMm(1.33)).toBe(115);
  });

  test('Mark\'s 16:9 photo: 158/1.72 = 92mm, under cap so kept', () => {
    expect(renderedHeightMm(1.72)).toBeCloseTo(91.86, 1);
  });

  test('Portrait 3:4: width-cap → 158/0.75 = 211mm, but height-capped at 110mm', () => {
    expect(renderedHeightMm(0.75)).toBe(110);
  });

  test('Square: 158/1 = 158, height-capped at 113mm', () => {
    expect(renderedHeightMm(1.0)).toBe(113);
  });
});

describe('fitsTwoPerPage', () => {
  test('all-landscape (Mark\'s reference): 6 photos fit in 3 pairs', () => {
    const aspects = [1.33, 1.33, 1.33, 1.33, 1.72, 1.69];
    const out = fitsTwoPerPage(aspects);
    expect(out.willFit).toBe(true);
    expect(out.pairs).toHaveLength(3);
    // Page 1 (heading): 12 + 115 + 6 + 115 = 248mm — fits 250mm budget.
    expect(out.pairs[0].totalMm).toBe(248);
    // Page 2 (no heading, 2 × 4:3): 115 + 6 + 115 = 236mm.
    expect(out.pairs[1].totalMm).toBe(236);
    // Page 3 (no heading, 2 × 16:9, height ≈ 92mm each): 92 + 6 + 92 = 190mm.
    // (Cumulative height-capped renderedHeight for 16:9 returns ~91.86)
    expect(out.pairs[2].fits).toBe(true);
  });

  test('mixed portrait + landscape: still fits', () => {
    const aspects = [0.75, 1.33];
    const out = fitsTwoPerPage(aspects);
    // 12 (heading) + 110 (portrait) + 6 (spacing) + 115 (landscape) = 243
    expect(out.willFit).toBe(true);
    expect(out.pairs[0].totalMm).toBe(243);
  });

  test('two portraits: well within budget', () => {
    const aspects = [0.75, 0.75];
    const out = fitsTwoPerPage(aspects);
    // 12 + 110 + 6 + 110 = 238
    expect(out.willFit).toBe(true);
    expect(out.pairs[0].totalMm).toBe(238);
  });

  test('odd photo count — last pair is single', () => {
    const aspects = [1.33, 1.33, 1.33];
    const out = fitsTwoPerPage(aspects);
    expect(out.pairs).toHaveLength(2);
    expect(out.pairs[1].indices).toEqual([2]);
    expect(out.pairs[1].heights).toHaveLength(1);
  });

  test('empty array returns willFit:true with no pairs', () => {
    expect(fitsTwoPerPage([])).toEqual({ willFit: true, pairs: [] });
  });

  test('non-array returns willFit:true (defensive)', () => {
    expect(fitsTwoPerPage(null)).toEqual({ willFit: true, pairs: [] });
    expect(fitsTwoPerPage(undefined)).toEqual({ willFit: true, pairs: [] });
  });

  test('A4_CONTENT_HEIGHT_MM is exposed for callers', () => {
    expect(A4_CONTENT_HEIGHT_MM).toBe(250);
  });
});
