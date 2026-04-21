import { isClientTokenExpired } from './clientToken.js';

/**
 * Decide which portal-badge variant (if any) a dashboard row should
 * show, from the Client Portal lifecycle fields on a job.
 *
 * Returns one of: 'await' | 'viewed' | 'expired' | null.
 *
 * Null = no badge. No token yet, or the client has already responded
 * (in which case the existing StatusBadge's 'ACCEPTED'/'DECLINED' stamp
 * does the work — we don't want to double-stamp the row).
 */
export function resolvePortalBadgeKind(job) {
  if (!job || !job.clientToken) return null;
  if (job.clientResponse === 'accepted' || job.clientResponse === 'declined') {
    return null;
  }
  if (isClientTokenExpired(job.clientTokenExpiresAt)) return 'expired';
  if (job.clientViewedAt) return 'viewed';
  return 'await';
}
