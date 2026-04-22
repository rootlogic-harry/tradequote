/**
 * iOS-safe blob download helper (TRQ-140).
 *
 * Paul reported "tap Download PDF, nothing happens" on iPad Safari.
 * Root cause: iOS Safari ignores the `download` attribute on blob
 * URLs, so the standard web pattern (`<a href="blob:…" download>`)
 * silently opens the blob in a new tab (or gets popup-blocked).
 *
 * Modern iOS + Android support `navigator.share({ files: [File] })`
 * which opens the native share sheet — Save to Files, AirDrop, Mail,
 * Messages. That's the pattern iPad users expect. We detect support
 * via `navigator.canShare({ files })` and fall back to the legacy
 * anchor-click path on desktop or older browsers.
 *
 * User cancelling the share sheet is not an error — we swallow
 * AbortError and return `{ cancelled: true }` so the caller can
 * decide whether to show a toast.
 */

export async function downloadBlob(blob, filename, { mimeType } = {}) {
  const type = mimeType || blob?.type || 'application/octet-stream';

  // Prefer the Web Share API when the browser says it can share the
  // file. Wrapped in try/catch so we can distinguish user cancellation
  // (fine) from API failure (fall through to anchor click).
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { shared: true };
        } catch (err) {
          if (err?.name === 'AbortError') {
            return { cancelled: true };
          }
          // Fall through to anchor-click.
        }
      }
    } catch {
      // File constructor unavailable or canShare threw — fall through.
    }
  }

  // Legacy path — blob URL + anchor click. Works on desktop. Ignored
  // on iOS Safari but harmless (the browser either opens the blob in
  // a new tab or does nothing; the caller can still fall back to
  // window.print() if needed).
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { downloaded: true };
}
