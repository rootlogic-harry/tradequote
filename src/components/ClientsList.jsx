import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  listClients,
  getClientDuplicates,
  mergeClients,
} from '../utils/userDB.js';

/**
 * Clients list — Paul's pipeline surface (CLIENTS_SPEC_v3, 2026-07-07).
 *
 * Renders when Sidebar → Clients is clicked. Shows:
 *   - Search box (name / phone / address)
 *   - Status filter pills (All / Active / Needs visit / Lost)
 *   - Duplicate-merge banner at the top when candidates exist (push-based;
 *     dismissible per session)
 *   - Table: name, phone, total won, outstanding, status
 *   - Row click → onOpenClient(client.id) to navigate to the detail view
 *   - Empty state guiding new users to save a quote first
 */
const STATUS_FILTERS = [
  { key: 'all',         label: 'All',         value: []             },
  { key: 'active',      label: 'Active',      value: ['active']     },
  { key: 'needs_visit', label: 'Needs visit', value: ['needs_visit'] },
  { key: 'lost',        label: 'Lost',        value: ['lost']       },
];

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});

export default function ClientsList({ currentUserId, onOpenClient, onBack, showToast }) {
  const [clients, setClients] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [merging, setMerging] = useState(false);

  const currentFilter = STATUS_FILTERS.find((f) => f.key === activeStatus) || STATUS_FILTERS[0];

  const refresh = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    setError(null);
    try {
      const [listRes, dupeRes] = await Promise.all([
        listClients(currentUserId, {
          search: search.trim() || undefined,
          status: currentFilter.value.length ? currentFilter.value : undefined,
        }),
        getClientDuplicates(currentUserId),
      ]);
      setClients(listRes?.clients || []);
      setDuplicates(dupeRes?.duplicates || []);
    } catch (e) {
      setError(e?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [currentUserId, search, activeStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  // Compute a lightweight "high-confidence duplicate names" list for
  // the banner copy. Show at most 3 in the banner text; the modal
  // shows the full list.
  const highConfPairs = useMemo(
    () => duplicates.filter((d) => d.confidence === 'high').slice(0, 3),
    [duplicates]
  );
  const bannerVisible = !bannerDismissed && duplicates.length > 0;

  const clientById = useMemo(() => {
    const m = new Map();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const handleMergePair = useCallback(async (sourceId, intoId) => {
    if (!confirm('Merge these two clients?\n\nThe first (source) will be removed. All their sites and quotes move to the second (target).')) return;
    setMerging(true);
    try {
      await mergeClients(currentUserId, sourceId, intoId);
      showToast?.('Clients merged', 'success');
      setBannerDismissed(false);
      await refresh();
    } catch (e) {
      showToast?.(e?.message || 'Merge failed', 'error');
    } finally {
      setMerging(false);
    }
  }, [currentUserId, refresh, showToast]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="page-title mb-1">Clients</h1>
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
          {clients.length} {clients.length === 1 ? 'client' : 'clients'}
        </p>
      </div>

      {/* Duplicate merge banner. */}
      {bannerVisible && (
        <div
          data-testid="clients-duplicate-banner"
          className="mb-4"
          style={{
            backgroundColor: 'var(--tq-warning-bg, rgba(189,94,9,0.09))',
            border: '1px solid var(--tq-warning-bd, rgba(189,94,9,0.28))',
            borderRadius: 6,
            padding: '12px 14px',
          }}
        >
          <div className="flex flex-col fq:flex-row gap-2 fq:items-start fq:justify-between">
            <div>
              <div className="font-heading font-bold text-sm mb-1" style={{ color: 'var(--tq-text)' }}>
                {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'} found
              </div>
              <div className="text-xs" style={{ color: 'var(--tq-muted)', lineHeight: 1.5 }}>
                {highConfPairs.length > 0 ? (
                  <>Matching name AND phone: {highConfPairs.map((p, i) => {
                    const a = clientById.get(p.candidateClientIds[0]);
                    const b = clientById.get(p.candidateClientIds[1]);
                    return (
                      <span key={i}>
                        {i > 0 ? '; ' : ''}
                        {a?.name || '(unknown)'} ↔ {b?.name || '(unknown)'}
                      </span>
                    );
                  })}
                  </>
                ) : (
                  <>Some clients share a name, phone or email. Merge to combine their sites + quotes.</>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {highConfPairs[0] && (
                <button
                  type="button"
                  onClick={() => handleMergePair(highConfPairs[0].candidateClientIds[0], highConfPairs[0].candidateClientIds[1])}
                  disabled={merging}
                  className="btn-primary text-xs"
                  style={{ minHeight: 44, padding: '0 14px' }}
                  data-testid="clients-duplicate-banner-merge"
                >
                  {merging ? 'Merging…' : 'Merge first pair'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="btn-ghost text-xs"
                style={{ minHeight: 44, padding: '0 10px' }}
                data-testid="clients-duplicate-banner-dismiss"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search + status filter */}
      <div className="flex flex-col fq:flex-row gap-3 mb-5 fq:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or address…"
          className="nq-field flex-1"
          data-testid="clients-search"
        />
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter clients by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={activeStatus === f.key}
              onClick={() => setActiveStatus(f.key)}
              className={`pill ${activeStatus === f.key ? 'active' : ''}`}
              style={{ minHeight: 44 }}
              data-testid={`clients-filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="text-center py-16" style={{ color: 'var(--tq-muted)' }}>
          Loading clients…
        </div>
      )}
      {error && !loading && (
        <div className="text-center py-16" style={{ color: 'var(--tq-error, #b91c1c)' }}>
          {error}
          <div className="mt-3">
            <button type="button" onClick={refresh} className="btn-ghost text-xs" style={{ minHeight: 44 }}>
              Retry
            </button>
          </div>
        </div>
      )}
      {!loading && !error && clients.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--tq-muted)' }}>
          <div className="text-4xl mb-3 opacity-30" aria-hidden="true">👥</div>
          <p>No clients yet. Save a quote and one gets created automatically.</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && clients.length > 0 && (
        <div
          style={{
            backgroundColor: 'var(--tq-card)',
            border: '1px solid var(--tq-border)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {clients.map((c) => (
            <ClientRow key={c.id} client={c} onOpen={() => onOpenClient?.(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientRow({ client, onOpen }) {
  const statusChip = getStatusChip(client.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="clients-row"
      className="w-full text-left"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 16px',
        minHeight: 64,
        borderBottom: '1px solid var(--tq-border)',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-heading font-bold text-sm truncate" style={{ color: 'var(--tq-text)' }}>
          {client.name || '(unnamed)'}
        </div>
        <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--tq-muted)' }}>
          {client.phone || '—'}
        </div>
      </div>
      <div className="text-right" style={{ minWidth: 100 }}>
        <div className="eyebrow mb-0.5" style={{ color: 'var(--tq-muted)', fontSize: 10 }}>Won</div>
        <div className="font-mono text-sm" style={{ color: 'var(--tq-text)' }}>
          {currency.format(Number(client.totalWon) || 0)}
        </div>
      </div>
      <div className="text-right" style={{ minWidth: 100 }}>
        <div className="eyebrow mb-0.5" style={{ color: 'var(--tq-muted)', fontSize: 10 }}>Outstanding</div>
        <div className="font-mono text-sm" style={{ color: 'var(--tq-text)' }}>
          {currency.format(Number(client.outstanding) || 0)}
        </div>
      </div>
      <div
        style={{
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          background: statusChip.bg,
          color: statusChip.fg,
          flexShrink: 0,
        }}
      >
        {statusChip.label}
      </div>
    </button>
  );
}

function getStatusChip(status) {
  switch (status) {
    case 'active':
      return { label: 'Active',       bg: 'rgba(20,120,60,0.12)',  fg: 'rgb(20,90,50)'   };
    case 'needs_visit':
      return { label: 'Needs visit',  bg: 'rgba(189,94,9,0.14)',   fg: 'rgb(140,60,0)'   };
    case 'lost':
      return { label: 'Lost',         bg: 'rgba(120,120,120,0.14)', fg: 'rgb(80,80,80)'  };
    default:
      return { label: status || '—',  bg: 'rgba(120,120,120,0.14)', fg: 'rgb(80,80,80)'  };
  }
}
