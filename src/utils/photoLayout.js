/**
 * Photo layout — aspect-aware sizing rules so any combination of
 * landscape + portrait + square photos always fits 2 per page (TRQ-177).
 *
 * Background: Mark's reference PDF caps photos at 158mm wide. The
 * fixed 118mm height cap from TRQ-169 only fits when every photo is
 * landscape — a portrait photo at 158mm wide is ~211mm tall, so two
 * stacked won't fit on A4. Banding the height by orientation (and
 * pre-computing aspects on the client) means we no longer rely on
 * "Chromium will guess" for the page-break decision.
 *
 * The bands are derived from Mark's actual reference dimensions
 * (158×118mm at 4:3, 152×88mm at 16:9), with a tighter cap added for
 * portraits so two of them still fit on one A4 page with the heading.
 *
 * Numeric budget (A4, 25mm top + 22mm bottom margins → 250mm content):
 *   page 1 (heading + 2 photos): 12mm heading + 8mm spacing + 2 × maxH
 *     ≤ 250mm → maxH ≤ 115mm. Banding gives the four cases below
 *     with a 5mm safety margin on the worst case (mixed pair).
 *   page 2+ (no heading): 2 × maxH + 8mm spacing → maxH ≤ 121mm,
 *     so all bands always fit on continuation pages.
 */

// Page-content budget in mm (A4 minus current margins). Used by
// fitsTwoPerPage to verify a photo set will paginate cleanly.
export const A4_CONTENT_HEIGHT_MM = 250;
export const A4_CONTENT_WIDTH_MM = 158;

// Heading "Site Photographs" + paragraph spacing on the FIRST photo
// page. Subsequent pages have no heading. Tightened to give the math
// room: heading + 2 photos must fit in 250mm, and Tailwind's default
// space-y-6 (24mm) was eating too much of the budget.
export const PAIR_HEADING_HEIGHT_MM = 12;
export const PAIR_INTER_PHOTO_SPACING_MM = 6;

/** Classify an aspect ratio into one of three render bands. */
export function aspectBand(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 'landscape'; // safe default
  if (aspect >= 1.3) return 'landscape';
  if (aspect < 1.0) return 'portrait';
  return 'square';
}

/**
 * Per-band max dimensions in mm. Used by both render paths:
 *   - DOCX builder picks numeric width/height for each ImageRun
 *   - print.css mirrors these via [data-orientation="..."] selectors
 *
 * Heights derived to fit two-per-page even on the FIRST photo page
 * (with the "Site Photographs" heading). Mark's reference rendered
 * landscapes at 118mm; the 3mm shave to 115 is visually identical
 * but gives the budget room for the heading + spacing.
 */
export function photoMaxDimensions(aspect) {
  const band = aspectBand(aspect);
  switch (band) {
    case 'portrait':  return { maxWidthMm: 158, maxHeightMm: 110, band };
    case 'square':    return { maxWidthMm: 158, maxHeightMm: 113, band };
    case 'landscape':
    default:          return { maxWidthMm: 158, maxHeightMm: 115, band };
  }
}

/**
 * Compute the rendered height of a photo at maxWidth=158mm, capped by
 * the band's maxHeight. Mirrors what Chromium does with object-fit.
 */
export function renderedHeightMm(aspect) {
  const { maxWidthMm, maxHeightMm } = photoMaxDimensions(aspect);
  const widthCappedHeight = aspect > 0 ? maxWidthMm / aspect : maxHeightMm;
  return Math.min(widthCappedHeight, maxHeightMm);
}

/**
 * Future-proofing primitive: given the aspects of every photo we plan
 * to render, return whether each pair will fit two-per-page given the
 * current page-content budget.
 *
 * Returns the worst-case pair (deepest overflow) so callers can warn
 * the user. UI uses this to surface "Photo 5 may print on its own page"
 * before they hit Download — better than a surprise.
 */
export function fitsTwoPerPage(aspects) {
  if (!Array.isArray(aspects) || aspects.length === 0) {
    return { willFit: true, pairs: [] };
  }
  const pairs = [];
  for (let i = 0; i < aspects.length; i += 2) {
    const isFirstPair = i === 0;
    const a1 = aspects[i];
    const a2 = aspects[i + 1];
    const headingMm = isFirstPair ? PAIR_HEADING_HEIGHT_MM : 0;
    const h1 = renderedHeightMm(a1);
    const h2 = a2 != null ? renderedHeightMm(a2) : 0;
    const totalMm =
      headingMm +
      h1 +
      (a2 != null ? PAIR_INTER_PHOTO_SPACING_MM + h2 : 0);
    const fits = totalMm <= A4_CONTENT_HEIGHT_MM;
    pairs.push({
      indices: a2 != null ? [i, i + 1] : [i],
      heights: a2 != null ? [h1, h2] : [h1],
      totalMm: Math.round(totalMm),
      fits,
    });
  }
  return {
    willFit: pairs.every((p) => p.fits),
    pairs,
  };
}

/**
 * Enrich an array of photo objects with `aspect` by loading each one
 * via `new Image()`. Browser-only — caller (handleDownloadPdfServer,
 * handleDownloadDocx, etc.) must await this BEFORE renderToStaticMarkup.
 *
 * Errors and missing dimensions resolve to `aspect: null`, which the
 * `aspectBand()` helper safely treats as 'landscape' (the most common
 * case in Mark's actual data).
 */
export async function loadAspects(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return [];
  return Promise.all(
    photos.map(async (p) => {
      if (!p?.data) return p;
      try {
        const img = new Image();
        img.src = p.data;
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const aspect = w > 0 && h > 0 ? w / h : null;
        return { ...p, aspect };
      } catch {
        return { ...p, aspect: null };
      }
    })
  );
}
