/**
 * Platform detection helpers (TRQ-141 follow-up).
 *
 * `shouldUseShareSheetPath()` — true on iPad / iPhone / Android, false
 * on desktop. Used by "Send via Outlook" to pick between:
 *
 *   - share sheet + PDF file (iPad — Safari has no .eml handler, and
 *     the sheet offers Print as a dead end on Paul's iPad)
 *   - .eml file download (desktop — Outlook Desktop, Mail.app, and
 *     Thunderbird all register for message/rfc822 and open it as an
 *     editable draft)
 *
 * We sniff the UA because there is no feature test that tells us
 * "this browser's share sheet can compose a mail draft from an .eml".
 * iPadOS 13+ reports as Macintosh, so we also require touch points
 * to catch that case.
 */
export function shouldUseShareSheetPath(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return false;
  if (typeof nav.canShare !== 'function') return false;
  const ua = nav.userAgent || '';
  const touch = nav.maxTouchPoints || 0;
  // iPadOS 13+ masquerades as Macintosh — require touch points to
  // distinguish a real iPad from a desktop Mac.
  const isIPadMasquerading = /Macintosh/.test(ua) && touch > 1;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadMasquerading;
  const isAndroid = /Android/.test(ua);
  return isIOS || isAndroid;
}
