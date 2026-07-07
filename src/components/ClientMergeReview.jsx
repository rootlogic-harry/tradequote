import React, { useMemo, useState } from 'react';
import { mergeClients } from '../utils/userDB.js';
import { computeDuplicateGroups } from '../utils/mergeGroups.js';

/**
 * Duplicate-review modal — opened from the banner on ClientsList.
 *
 * The server returns candidate PAIRS (2-tuples). For a group of N
 * genuine duplicates the server emits N-choose-2 pairs — three
 * "Yorkshire Estates" become three pairs (AB, AC, BC). Rendering
 * those pairs verbatim (as we did initially) is confusing: the user
 * sees the same client on multiple rows and can't tell whether they
 * need to merge one, two, or three times.
 *
 * This modal now GROUPS by transitive closure (see mergeGroups.js) —
 * three duplicates render as one card with three "Keep this one"
 * buttons. Picking a target performs N-1 sequential merges into that
 * client in a single confirmation, so a group of 3 collapses to 1 in
 * one action.
 *
 * Confidence order: high first, then medium, then low. Within a
 * confidence bucket, larger groups first (the "biggest win" merges
 * rise to the top).
 */

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});

export default function ClientMergeReview({
  currentUserId,
  duplicates,
  clientsById,
  onClose,
  onMerged,
  showToast,
}) {
  const [busyGroupKey, setBusyGroupKey] = useState(null);

  const groups = useMemo(
    () => computeDuplicateGroups(duplicates, clientsById),
    [duplicates, clientsById],
  );

  const totalDuplicateClients = groups.reduce((sum, g) => sum + g.clients.length, 0);

  const handleGroupMerge = async (group, targetId, groupKey) => {
    const target = group.clients.find((c) => c.id === targetId);
    const sources = group.clients.filter((c) => c.id !== targetId);
    if (sources.length === 0) return;

    const sourceNames = sources.map((c) => `"${c.name || c.id}"`).join(', ');
    const confirmMsg =
      `Merge ${sources.length} duplicate${sources.length === 1 ? '' : 's'} INTO ` +
      `"${target?.name || targetId}"?\n\n` +
      `All sites and quotes from ${sourceNames} move to "${target?.name || targetId}". ` +
      `${sources.length === 1 ? 'That client' : 'Those clients'} will be soft-deleted ` +
      `(recoverable for 30 days).`;
    if (!confirm(confirmMsg)) return;

    setBusyGroupKey(groupKey);
    try {
      // Sequential — server-side merge is a single-target transaction
      // and locks the target row. Running in parallel would risk FK
      // conflicts and interleaved audit rows.
      for (const src of sources) {
        // Skip if source is missing (defensive — e.g. server-side merge
        // already reparented it in a previous attempt).
        if (!src?.id) continue;
        await mergeClients(currentUserId, src.id, targetId);
      }
      showToast?.(
        `Merged ${sources.length} duplicate${sources.length === 1 ? '' : 's'}`,
        'success',
      );
      await onMerged?.();
    } catch (e) {
      // Partial failure is possible — some merges succeeded, one failed.
      // onMerged refetches so the modal renders whatever state is now
      // canonical on the server. No client-side rollback.
      showToast?.(e?.message || 'Merge failed', 'error');
      await onMerged?.();
    } finally {
      setBusyGroupKey(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-merge-review-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 720,
          maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1.5px solid var(--tq-border)',
        }}
      >
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--tq-border)',
          background: 'var(--tq-accent-bg, rgba(189,94,9,0.08))',
        }}>
          <h3 id="client-merge-review-title"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 800, fontSize: 22, margin: 0, color: 'var(--tq-text)',
            }}>
            Review duplicates
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--tq-muted)', fontSize: 13.5 }}>
            {groupsHeadline(groups.length, totalDuplicateClients)}
          </p>
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: '1 1 auto' }}>
          {groups.length === 0 && (
            <div style={{ color: 'var(--tq-muted)', textAlign: 'center', padding: '32px 0' }}>
              No duplicates.
            </div>
          )}
          <div className="flex flex-col gap-4">
            {groups.map((group, idx) => {
              const groupKey = group.clients.map((c) => c.id).sort().join('|');
              const busy = busyGroupKey === groupKey;
              return (
                <div
                  key={groupKey}
                  data-testid="client-merge-review-group"
                  style={{
                    border: '1px solid var(--tq-border)',
                    borderRadius: 6,
                    padding: '14px 16px',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow" style={{ color: 'var(--tq-muted)' }}>
                      {group.clients.length} clients ·{' '}
                      {group.matchTypes.map(matchTypeLabel).join(' / ')} ·{' '}
                      {group.confidences.join('/')} confidence
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 12,
                    }}
                  >
                    {group.clients.map((c) => (
                      <ClientCard
                        key={c.id}
                        client={c}
                        onKeep={() => handleGroupMerge(group, c.id, groupKey)}
                        busy={busy}
                        otherCount={group.clients.length - 1}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--tq-border)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost"
            style={{ minHeight: 44, padding: '0 18px' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client, onKeep, busy, otherCount }) {
  return (
    <div
      style={{
        border: '1px solid var(--tq-border)',
        borderRadius: 4,
        padding: '10px 12px',
        background: 'var(--tq-bg, transparent)',
      }}
    >
      <div className="font-heading font-bold text-sm mb-1" style={{ color: 'var(--tq-text)' }}>
        {client.name || '(unnamed)'}
      </div>
      <div className="text-xs" style={{ color: 'var(--tq-muted)', lineHeight: 1.6 }}>
        {client.phone && <div>📞 {client.phone}</div>}
        {client.email && <div>✉ {client.email}</div>}
        <div style={{ marginTop: 4 }}>
          Won: <strong style={{ color: 'var(--tq-text)' }}>
            {currency.format(Number(client.totalWon) || 0)}
          </strong>
          {' · '}
          Outstanding: {currency.format(Number(client.outstanding) || 0)}
          {' · '}
          {client.lifetimeQuoteCount || 0} quote{Number(client.lifetimeQuoteCount) === 1 ? '' : 's'}
        </div>
      </div>
      <button
        type="button"
        onClick={onKeep}
        disabled={busy}
        className="btn-primary text-xs mt-2 w-full"
        style={{ minHeight: 44 }}
        data-testid="client-merge-review-keep"
        title={
          otherCount === 1
            ? 'Keep this client — the other one will be merged in'
            : `Keep this client — the other ${otherCount} will be merged in`
        }
      >
        {busy ? 'Merging…' : 'Keep this one'}
      </button>
    </div>
  );
}

function groupsHeadline(groupCount, totalClients) {
  if (groupCount === 0) return 'No duplicates found.';
  if (groupCount === 1) {
    return `1 duplicate group across ${totalClients} clients. Pick which to keep — the rest merge in.`;
  }
  return `${groupCount} duplicate groups across ${totalClients} clients. Pick which to keep in each.`;
}

function matchTypeLabel(type) {
  switch (type) {
    case 'name+phone': return 'same name AND phone';
    case 'name':       return 'same name';
    case 'phone':      return 'same phone';
    case 'email':      return 'same email';
    default:           return type || 'match';
  }
}
