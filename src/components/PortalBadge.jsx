import React from 'react';
import { resolvePortalBadgeKind } from '../utils/portalBadgeKind.js';

/**
 * Dashboard badge for the Client Portal lifecycle state (TRQ-132).
 *
 * Complements (does NOT duplicate) the existing StatusBadge. Once the
 * client has responded, the StatusBadge carries the 'accepted' /
 * 'declined' stamp — we return null here so rows don't double-stamp.
 *
 * Variants:
 *   - await   (grey)          token exists, not viewed, not expired
 *   - viewed  (amber + pulse) viewed, no response
 *   - expired (muted red)     token expired, no response
 *   - null                    no badge needed
 */
export { resolvePortalBadgeKind };

const LABELS = {
  await:   'Awaiting view',
  viewed:  'Viewed',
  expired: 'Link expired',
};

export default function PortalBadge({ job }) {
  const kind = resolvePortalBadgeKind(job);
  if (!kind) return null;
  return (
    <span className={`portal-badge portal-badge--${kind}`}>
      <span className="portal-badge-dot" aria-hidden />
      {LABELS[kind]}
    </span>
  );
}
