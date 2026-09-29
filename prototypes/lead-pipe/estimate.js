/**
 * Pure guide-price rules for the West Yorkshire homeowner mock.
 * A published £/m band. No model call. The server would recompute
 * these same numbers before storing a real link.
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
