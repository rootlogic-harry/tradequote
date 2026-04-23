/**
 * Platform-aware blob download.
 *
 * Two real-world constraints we have to reconcile:
 *
 *   - iPad Safari IGNORES the `download` attribute on blob: URLs
 *     (TRQ-140: Paul's original "tap Download PDF, nothing happens").
 *     Fix on iOS/Android is the Web Share API with a File, which opens
 *     the native share sheet (Save to Files, AirDrop, Mail...).
 *
 *   - macOS Safari also supports `navigator.share`, but desktop users
 *     don't want a share sheet — they expect "click download, file in
 *     Downloads folder". The share sheet also confuses macOS's type
 *     inference: a CSV comes through as "Text Document · 583 bytes"
 *     without visible extension (Harry's QuickBooks export bug).
 *
 * So: use the share sheet ONLY on touch-primary platforms (iPad,
 * iPhone, Android). Everywhere else, anchor-click to Downloads.
 *
 * User cancelling the share sheet is not an error — we swallow
 * AbortError and return `{ cancelled: true }`.
 */
import { shouldUseShareSheetPath } from './platform.js';

export async function downloadBlob(blob, filename, { mimeType } = {}) {
  const type = mimeType || blob?.type || 'application/octet-stream';

  // Share-sheet path — iOS/Android only.
  if (shouldUseShareSheetPath()) {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return { shared: true };
        } catch (err) {
          if (err?.name === 'AbortError') {
            return { cancelled: true };
          }
          // Non-abort error — fall through to anchor-click so something
          // still happens (e.g. on an unusual mobile browser config).
        }
      }
    } catch {
      // File constructor unavailable — fall through.
    }
  }

  // Desktop / older browsers path — blob URL + anchor click. Saves
  // directly to the browser's Downloads folder with the filename and
  // extension intact.
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
