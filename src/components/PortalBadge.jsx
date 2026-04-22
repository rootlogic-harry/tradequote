import React from 'react';
import { resolvePortalBadgeKind } from '../utils/portalBadgeKind.js';
import { relativeViewedLabel } from '../utils/portalFollowUp.js';

/**
 * Dashboard badge for the Client Portal lifecycle state (TRQ-132).
 *
 * Complements (does NOT duplicate) the existing StatusBadge. Once the
 * client has responded, the StatusBadge carries the 'accepted' /
 * 'declined' stamp — we return null here so rows don't double-stamp.
 *
 * Variants:
 *   - await   (grey)          token exists, not viewed, not expired
 *   - viewed  (amber + pulse) viewed, no response — shows relative
 *                             timestamp ("Viewed 2 days ago") so Paul
 *                             can see at a glance which viewers have
 *                             gone cold (portal insights feature).
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
  // Viewed-but-silent rows get a relative timestamp so the dashboard
  // tells Paul *when* the client looked, not just that they did.
  // "Viewed 2 days ago" is an order of magnitude more useful than
  // "Viewed" when triaging which clients to chase.
  const label = kind === 'viewed'
    ? (relativeViewedLabel(job) || LABELS.viewed)
    : LABELS[kind];
  return (
    <span className={`portal-badge portal-badge--${kind}`}>
      <span className="portal-badge-dot" aria-hidden />
      {label}
    </span>
  );
}
