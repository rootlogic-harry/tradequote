import React, { useEffect, useState, useCallback } from 'react';
import {
  getClient,
  patchClient,
  deleteClient,
  createSite,
  deleteSite,
} from '../utils/userDB.js';

/**
 * Client detail page (CLIENTS_SPEC_v3, 2026-07-07).
 *
 * The centerpiece of the Clients feature. Renders:
 *   - Header with the client's name (inline-editable), phone, status
 *   - Rollup card: Total won / Outstanding / Live pipeline / Lifetime quotes
 *   - Sites list with per-site quote count + "Add site" button
 *   - Timeline of every quote across all sites (chronological)
 *   - Delete client (soft-delete, cascades server-side)
 */

const currency = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric', month: 'short', day: 'numeric',
});

const STATUS_OPTIONS = [
  { value: 'active',       label: 'Active'      },
  { value: 'needs_visit',  label: 'Needs visit' },
  { value: 'lost',         label: 'Lost'        },
];

export default function ClientDetail({
  currentUserId,
  clientId,
  onBack,
  onOpenQuote,
  showToast,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [addSiteOpen, setAddSiteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getClient(currentUserId, clientId);
      setData(d);
    } catch (e) {
      setError(e?.message || 'Failed to load client');
    } finally {
      setLoading(false);
    }
  }, [currentUserId, clientId]);

  useEffect(() => { load(); }, [load]);

  const handlePatch = useCallback(async (patch) => {
    try {
      const res = await patchClient(currentUserId, clientId, patch);
      setData((prev) => prev ? { ...prev, client: res.client } : prev);
      showToast?.('Saved', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Save failed', 'error');
    }
  }, [currentUserId, clientId, showToast]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this client?\n\nAll their sites and quotes will be hidden. This is reversible for 30 days.')) return;
    try {
      await deleteClient(currentUserId, clientId);
      showToast?.('Client deleted', 'success');
      onBack?.();
    } catch (e) {
      showToast?.(e?.message || 'Delete failed', 'error');
    }
  }, [currentUserId, clientId, showToast, onBack]);

  const handleAddSite = useCallback(async (siteData) => {
    try {
      await createSite(currentUserId, { ...siteData, clientId });
      setAddSiteOpen(false);
      showToast?.('Site added', 'success');
      await load();
    } catch (e) {
      showToast?.(e?.message || 'Failed to add site', 'error');
    }
  }, [currentUserId, clientId, showToast, load]);

  const handleDeleteSite = useCallback(async (siteId) => {
    if (!confirm('Delete this site?\n\nQuotes at this site will be hidden from list views.')) return;
    try {
      await deleteSite(currentUserId, siteId);
      showToast?.('Site deleted', 'success');
      await load();
    } catch (e) {
      showToast?.(e?.message || 'Delete failed', 'error');
    }
  }, [currentUserId, showToast, load]);

  if (loading) return <div className="max-w-4xl mx-auto py-16 text-center" style={{ color: 'var(--tq-muted)' }}>Loading client…</div>;
  if (error) return (
    <div className="max-w-4xl mx-auto py-16 text-center" style={{ color: 'var(--tq-error, #b91c1c)' }}>
      {error}
      <div className="mt-3">
        <button type="button" onClick={onBack} className="btn-ghost text-xs" style={{ minHeight: 44 }}>Back to Clients</button>
      </div>
    </div>
  );
  if (!data) return null;

  const { client, sites, timeline, rollup } = data;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header with back nav + delete */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="btn-ghost text-xs"
          style={{ minHeight: 44, padding: '0 12px' }}
        >
          ← Clients
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleDelete}
          className="btn-ghost text-xs"
          style={{ minHeight: 44, padding: '0 12px', color: 'var(--tq-error, #b91c1c)' }}
        >
          Delete client
        </button>
      </div>

      {/* Client card */}
      <div
        style={{
          backgroundColor: 'var(--tq-card)',
          border: '1px solid var(--tq-border)',
          borderRadius: 2,
          padding: '20px 22px',
          marginBottom: 20,
        }}
      >
        <InlineField
          label="Name"
          value={client.name}
          onSave={(v) => handlePatch({ name: v })}
          editing={editingField === 'name'}
          setEditing={(b) => setEditingField(b ? 'name' : null)}
          heading
        />
        <div className="grid grid-cols-1 fq:grid-cols-3 gap-4 mt-3">
          <InlineField
            label="Phone"
            value={client.phone}
            onSave={(v) => handlePatch({ phone: v })}
            editing={editingField === 'phone'}
            setEditing={(b) => setEditingField(b ? 'phone' : null)}
          />
          <InlineField
            label="Email"
            value={client.email}
            onSave={(v) => handlePatch({ email: v })}
            editing={editingField === 'email'}
            setEditing={(b) => setEditingField(b ? 'email' : null)}
          />
          <div>
            <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>Status</div>
            <select
              value={client.status}
              onChange={(e) => handlePatch({ status: e.target.value })}
              className="nq-field"
              style={{ minHeight: 44 }}
              data-testid="client-status-select"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <InlineField
            label="Notes"
            value={client.notes}
            onSave={(v) => handlePatch({ notes: v })}
            editing={editingField === 'notes'}
            setEditing={(b) => setEditingField(b ? 'notes' : null)}
            multiline
          />
        </div>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 fq:grid-cols-4 gap-3 mb-5" data-testid="client-rollup">
        <RollupTile label="Total won" value={currency.format(rollup.totalWon)} />
        <RollupTile label="Outstanding" value={currency.format(rollup.outstanding)} />
        <RollupTile label="Live work" value={currency.format(rollup.livePipeline)} />
        <RollupTile label="Quotes" value={String(rollup.lifetimeQuoteCount)} />
      </div>

      {/* Sites */}
      <section className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="page-subtitle">Sites</h2>
          <button
            type="button"
            onClick={() => setAddSiteOpen(true)}
            className="btn-ghost text-xs"
            style={{ minHeight: 44, padding: '0 12px' }}
            data-testid="client-add-site"
          >
            + Add site
          </button>
        </div>
        {sites.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--tq-muted)' }}>No sites yet.</div>
        ) : (
          <div style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}>
            {sites.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3" style={{ borderBottom: '1px solid var(--tq-border)' }}>
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold text-sm truncate" style={{ color: 'var(--tq-text)' }}>{s.address}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--tq-muted)' }}>
                    {s.siteContactName ? `${s.siteContactName}${s.siteContactPhone ? ` · ${s.siteContactPhone}` : ''}` : 'No site contact'}
                  </div>
                </div>
                <div className="text-xs font-mono" style={{ color: 'var(--tq-muted)' }}>
                  {s.quoteCount} quote{s.quoteCount === 1 ? '' : 's'}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteSite(s.id)}
                  className="btn-ghost text-xs"
                  style={{ minHeight: 44, padding: '0 10px' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Timeline */}
      <section>
        <h2 className="page-subtitle mb-2">Quote timeline</h2>
        {timeline.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--tq-muted)' }}>No quotes for this client yet.</div>
        ) : (
          <div style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}>
            {timeline.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onOpenQuote?.(q.id)}
                className="w-full text-left"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 16px', minHeight: 60,
                  borderBottom: '1px solid var(--tq-border)',
                  background: 'transparent', cursor: 'pointer',
                }}
                data-testid="client-timeline-row"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-heading font-bold text-sm truncate" style={{ color: 'var(--tq-text)' }}>
                    {q.quoteReference || '(no reference)'} · {q.siteAddress || '—'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--tq-muted)' }}>
                    Saved {q.savedAt ? dateFormat.format(new Date(q.savedAt)) : '—'} · Status: {q.status || 'draft'}
                  </div>
                </div>
                <div className="font-mono text-sm" style={{ color: 'var(--tq-text)' }}>
                  {currency.format(Number(q.totalAmount) || 0)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {addSiteOpen && (
        <AddSiteModal onSubmit={handleAddSite} onCancel={() => setAddSiteOpen(false)} />
      )}
    </div>
  );
}

function InlineField({ label, value, onSave, editing, setEditing, heading, multiline }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  const commit = () => {
    const next = (draft || '').trim();
    if (next !== (value || '')) onSave?.(next);
    setEditing(false);
  };
  if (!editing) {
    return (
      <div>
        <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>{label}</div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left"
          style={{
            background: 'transparent', border: 'none', padding: 0,
            fontSize: heading ? 22 : 14,
            fontFamily: heading ? "'Barlow Condensed', sans-serif" : 'inherit',
            fontWeight: heading ? 800 : 500,
            color: 'var(--tq-text)',
            minHeight: 44,
            cursor: 'pointer',
          }}
        >
          {value || <span style={{ color: 'var(--tq-muted)', fontStyle: 'italic' }}>Tap to add</span>}
        </button>
      </div>
    );
  }
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div>
      <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>{label}</div>
      <Field
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' && !multiline) commit(); if (e.key === 'Escape') setEditing(false); }}
        rows={multiline ? 3 : undefined}
        className="nq-field"
        style={{ minHeight: 44 }}
      />
    </div>
  );
}

function RollupTile({ label, value }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--tq-card)',
        border: '1px solid var(--tq-border)',
        borderRadius: 2,
        padding: '14px 16px',
      }}
    >
      <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>{label}</div>
      <div className="font-mono" style={{ color: 'var(--tq-text)', fontSize: 20, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function AddSiteModal({ onSubmit, onCancel }) {
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!address.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        address: address.trim(),
        siteContactName: contactName.trim() || undefined,
        siteContactPhone: contactPhone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-site-title"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 480,
          maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1.5px solid var(--tq-border)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--tq-border)' }}>
          <h3 id="add-site-title" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 20, margin: 0, color: 'var(--tq-text)' }}>
            Add site
          </h3>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto', overflowY: 'auto' }}>
          <label>
            <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>Address</div>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="nq-field"
              style={{ minHeight: 44 }}
              maxLength={300}
              required
              autoFocus
            />
          </label>
          <label>
            <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>Site contact name (optional)</div>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="nq-field" maxLength={200} />
          </label>
          <label>
            <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>Site contact phone (optional)</div>
            <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="nq-field" maxLength={40} />
          </label>
          <label>
            <div className="eyebrow mb-1" style={{ color: 'var(--tq-muted)' }}>Notes (optional)</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="nq-field" style={{ minHeight: 44 }} maxLength={2000} />
          </label>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--tq-border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} className="btn-ghost" style={{ minHeight: 44, padding: '0 16px' }}>Cancel</button>
          <button type="submit" disabled={submitting || !address.trim()} className="btn-primary" style={{ minHeight: 44, padding: '0 16px' }}>
            {submitting ? 'Adding…' : 'Add site'}
          </button>
        </div>
      </form>
    </div>
  );
}
