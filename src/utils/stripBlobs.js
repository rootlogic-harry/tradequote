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
 * Build a save-safe snapshot. Strips blobs and excludes aiRawResponse.
 * aiRawResponse is excluded entirely — it is large, immutable, and
 * can never be edited. The confirmed values in reviewData are what matter.
 */
export function buildSaveSnapshot(state) {
  const stripped = stripBlobs({
    profile:       state.profile,
    jobDetails:    state.jobDetails,
    reviewData:    state.reviewData,
    quotePayload:  state.quotePayload,
    quoteSequence: state.quoteSequence,
    quoteMode:     state.quoteMode,
    diffs:         state.diffs,
    // aiRawResponse intentionally excluded
  })

  if (typeof Blob !== 'undefined') {
    const size = new Blob([JSON.stringify(stripped)]).size
    if (size > 500 * 1024) {
      console.warn('[Save] Snapshot large after stripping:', Math.round(size / 1024), 'KB')
    }
  }
  return stripped
}
