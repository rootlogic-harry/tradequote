/**
 * West Yorkshire homeowner guide-price rules.
 * Published £/m band. No model call. Server recomputes before store.
 */

export const HEIGHTS = [
  { id: '1.0', metres: 1.0, label: 'About 1.0m', hint: 'Garden' },
  { id: '1.2', metres: 1.2, label: 'About 1.2m', hint: 'Field' },
  { id: '1.5', metres: 1.5, label: 'About 1.5m', hint: 'Tall' },
];

/** West Yorkshire urban/suburban double-faced wall at 1.2m. */
export const RATE_PER_M_AT_1_2 = { low: 160, high: 220 };

export const MAX_LENGTH_M = 80;
export const LONG_WALL_M = 40;
export const DAILY_LINK_CAP = 5;
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 900_000;

const CONSENT_COPY =
  'FastQuote may share my details with a local dry stone waller so they can contact me about this job.';

export function consentCopy() {
  return CONSENT_COPY;
}

const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;
const OUTWARD_ONLY = /^[A-Z]{1,2}\d[A-Z\d]?$/;

// North Yorkshire outward codes that share a West Yorkshire prefix.
const OUTSIDE_OUTWARDS = new Set(['BD23', 'BD24', 'LS24']);

const DISTRICT_BY_AREA = {
  BD: 'Bradford',
  HX: 'Halifax',
  HD: 'Huddersfield',
  LS: 'Leeds',
  WF: 'Wakefield',
};

function outwardFrom(raw) {
  const compact = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const full = compact.match(FULL_POSTCODE);
  if (full) return full[1];
  if (OUTWARD_ONLY.test(compact)) return compact;
  return null;
}

function areaLabel(outward) {
  if (outward === 'BD23') return 'Skipton';
  if (outward === 'BD24') return 'Settle';
  if (outward === 'LS24') return 'Tadcaster';
  if (outward === 'LS29') return 'Ilkley';
  const prefix = outward.replace(/\d.*/, '');
  return DISTRICT_BY_AREA[prefix] || null;
}

export function classifyPostcode(raw) {
  const outward = outwardFrom(raw);
  if (!outward) {
    return {
      valid: false,
      inWestYorkshire: false,
      outward: null,
      area: null,
      hint: 'Enter a UK postcode, such as LS6 2AB.',
    };
  }
  const prefix = outward.replace(/\d.*/, '');
  const knownPrefix = Object.prototype.hasOwnProperty.call(DISTRICT_BY_AREA, prefix);
  const inWestYorkshire = knownPrefix && !OUTSIDE_OUTWARDS.has(outward);
  return {
    valid: true,
    inWestYorkshire,
    outward,
    area: areaLabel(outward) || outward,
    hint: null,
  };
}

function roundTo10(n) {
  return Math.round(n / 10) * 10;
}

export function guideBand(lengthM, heightM) {
  const length = Number(lengthM);
  const height = Number(heightM);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_LENGTH_M) return null;
  if (!HEIGHTS.some((h) => h.metres === height)) return null;
  const scale = height / 1.2;
  const perLow = Math.round(RATE_PER_M_AT_1_2.low * scale);
  const perHigh = Math.round(RATE_PER_M_AT_1_2.high * scale);
  return {
    low: roundTo10(perLow * length),
    high: roundTo10(perHigh * length),
    perLow,
    perHigh,
    longWall: length > LONG_WALL_M,
  };
}

export function formatGbp(amount) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatBand(band) {
  if (!band) return '';
  return `${formatGbp(band.low)}–${formatGbp(band.high)}`;
}

export const OUTCOMES = ['contacted', 'visit', 'won', 'lost'];

/**
 * Parse notify-user id list. Default during the test window: Mark only.
 * @param {string} [raw]
 * @returns {string[]}
 */
export function parseNotifyUserIds(raw) {
  const source = raw == null || String(raw).trim() === ''
    ? 'mark'
    : String(raw);
  return source
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalise optional photo data-URLs from the public form.
 * Returns { ok, photos, error }.
 */
export function normalisePhotos(rawPhotos) {
  if (rawPhotos == null) return { ok: true, photos: [] };
  if (!Array.isArray(rawPhotos)) {
    return { ok: false, photos: [], error: 'Photos must be a list.' };
  }
  if (rawPhotos.length > MAX_PHOTOS) {
    return { ok: false, photos: [], error: `At most ${MAX_PHOTOS} photos.` };
  }
  const photos = [];
  for (const item of rawPhotos) {
    const dataUrl = typeof item === 'string' ? item : item?.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') {
      return { ok: false, photos: [], error: 'Each photo must be a data URL.' };
    }
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) {
      return { ok: false, photos: [], error: 'Photos must be jpeg, png or webp.' };
    }
    const approxBytes = Math.floor((m[2].length * 3) / 4);
    if (approxBytes > MAX_PHOTO_BYTES) {
      return { ok: false, photos: [], error: 'A photo is too large.' };
    }
    photos.push({ mime: m[1], dataUrl });
  }
  return { ok: true, photos };
}

export function validateAskPayload(body = {}) {
  const errors = {};
  const place = classifyPostcode(body.postcode);
  if (!place.valid) errors.postcode = place.hint;
  else if (!place.inWestYorkshire) {
    errors.postcode = 'We’re not matching wallers in your area yet.';
  }

  const length = Number(body.lengthM);
  const height = Number(body.heightM);
  const band = guideBand(length, height);
  if (!band) errors.lengthM = 'Enter a length and height for the guide price.';

  const name = String(body.name || '').trim();
  if (!name || name.length > 80) errors.name = 'Enter your name.';

  const email = String(body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    errors.email = 'Enter a valid email.';
  }

  const phone = String(body.phone || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || phone.length > 40) errors.phone = 'Enter a phone number.';

  if (body.consentShare !== true) {
    errors.consentShare = 'Tick the box so a waller can contact you.';
  }

  const photoResult = normalisePhotos(body.photos);
  if (!photoResult.ok) errors.photos = photoResult.error;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    place,
    band,
    name,
    email,
    phone,
    photos: photoResult.photos,
    consentMarketing: body.consentMarketing === true,
  };
}
