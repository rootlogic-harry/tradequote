import React, { useState } from 'react';
import { mergeClients } from '../utils/userDB.js';

/**
 * Duplicate-review modal — opened from the banner on ClientsList.
 *
 * Shows every candidate pair from GET /clients/duplicates side-by-side
 * so the user picks which client to KEEP (the target) and which to
 * remove (the source). Merge reparents the source's sites onto the
 * target and soft-deletes the source. Transactional server-side.
 *
 * Confidence order: name+phone matches first, then name/phone, then
 * email-only. Each pair gets its own row so a user with many
 * duplicates can work through them in one sitting.
 */

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

export default function ClientMergeReview({
  currentUserId,
  duplicates,
  clientsById,
  onClose,
  onMerged,
  showToast,
}) {
  const [busyPairKey, setBusyPairKey] = useState(null);

  // Sort by confidence (high first), then by whichever pair has the
  // most site+quote data on the "kept" side so the productive merges
  // rise to the top.
  const sortedPairs = [...duplicates].sort((a, b) => {
    const ra = CONFIDENCE_RANK[a.confidence] ?? 3;
    const rb = CONFIDENCE_RANK[b.confidence] ?? 3;
    return ra - rb;
  });

  const handleMerge = async (sourceId, intoId, pairKey) => {
    const src = clientsById.get(sourceId);
    const tgt = clientsById.get(intoId);
    if (!confirm(
      `Merge "${src?.name || sourceId}" INTO "${tgt?.name || intoId}"?\n\n` +
      `All sites and quotes from the source move to the target. ` +
      `The source client is soft-deleted (recoverable for 30 days).`
    )) return;
    setBusyPairKey(pairKey);
    try {
      await mergeClients(currentUserId, sourceId, intoId);
      showToast?.('Merged', 'success');
      await onMerged?.();
    } catch (e) {
      showToast?.(e?.message || 'Merge failed', 'error');
    } finally {
      setBusyPairKey(null);
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
            {sortedPairs.length} pair{sortedPairs.length === 1 ? '' : 's'} found. Pick which one to keep.
          </p>
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: '1 1 auto' }}>
          {sortedPairs.length === 0 && (
            <div style={{ color: 'var(--tq-muted)', textAlign: 'center', padding: '32px 0' }}>
              No duplicates.
            </div>
          )}
          <div className="flex flex-col gap-4">
            {sortedPairs.map((pair, idx) => {
              const [aId, bId] = pair.candidateClientIds;
              const a = clientsById.get(aId);
              const b = clientsById.get(bId);
              const pairKey = `${aId}-${bId}`;
              // Only render the pair if we have BOTH clients cached —
              // if a merge earlier in this session removed one, skip.
              if (!a || !b) return null;
              return (
                <div
                  key={pairKey}
                  data-testid="client-merge-review-pair"
                  style={{
                    border: '1px solid var(--tq-border)',
                    borderRadius: 6,
                    padding: '14px 16px',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="eyebrow" style={{ color: 'var(--tq-muted)' }}>
                      {matchTypeLabel(pair.matchType)} · {pair.confidence} confidence
                    </div>
                  </div>
                  <div className="grid grid-cols-1 fq:grid-cols-2 gap-3">
                    <ClientCard
                      client={a}
                      onKeep={() => handleMerge(bId, aId, pairKey)}
                      busy={busyPairKey === pairKey}
                    />
                    <ClientCard
                      client={b}
                      onKeep={() => handleMerge(aId, bId, pairKey)}
                      busy={busyPairKey === pairKey}
                    />
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

function ClientCard({ client, onKeep, busy }) {
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
      >
        {busy ? 'Merging…' : 'Keep this one'}
      </button>
    </div>
  );
}

function matchTypeLabel(type) {
  switch (type) {
    case 'name+phone': return 'Same name AND phone';
    case 'name':       return 'Same name';
    case 'phone':      return 'Same phone';
    case 'email':      return 'Same email';
    default:           return type || 'Match';
  }
}
