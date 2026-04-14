/**
 * Recursively strip all base64 image data from a snapshot.
 * Replaces any string >10,000 chars starting with 'data:' with '[photo-stripped]'.
 */
export function stripBlobs(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (obj.startsWith('data:') && obj.length > 10000) return '[photo-stripped]'
    return obj
  }
  if (Array.isArray(obj)) return obj.map(stripBlobs)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      if (['logo', 'dataUrl', 'data', 'src'].includes(key) &&
          typeof value === 'string' && value.startsWith('data:')) {
        result[key] = '[photo-stripped]'
      } else {
        result[key] = stripBlobs(value)
      }
    }
    return result
  }
  return obj
}

/**
 * Keys explicitly allowed in save snapshots.
 * New state fields must be added here consciously to be persisted.
 */
export const SAVE_ALLOWLIST = [
  'profile', 'jobDetails', 'reviewData',
  'quotePayload', 'quoteSequence', 'quoteMode', 'diffs',
];

/**
 * Build a save-safe snapshot. Only includes SAVE_ALLOWLIST keys,
 * then strips blobs. This is functionally identical to the previous
 * manual construction but enforced via the allowlist.
 */
export function buildSaveSnapshot(state) {
  const picked = {}
  for (const key of SAVE_ALLOWLIST) {
    if (state[key] !== undefined) {
      picked[key] = state[key]
    }
  }
  const stripped = stripBlobs(picked)

  if (typeof Blob !== 'undefined') {
    const size = new Blob([JSON.stringify(stripped)]).size
    if (size > 500 * 1024) {
      console.warn('[Save] Snapshot large after stripping:', Math.round(size / 1024), 'KB')
    }
  }
  return stripped
}
