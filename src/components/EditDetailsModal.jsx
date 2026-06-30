import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { patchJobDetails } from '../utils/userDB.js';

/**
 * EditDetailsModal — metadata-only edit for a saved quote (2026-06-30).
 *
 * Paul Clough asked: "Is there any way I could edit job details
 * without having to regenerate. The address is wrong and if I
 * regenerate it might alter details or figures which are spot on."
 *
 * This modal hits the new PATCH /api/users/:id/jobs/:jobId/details
 * route, which updates ONLY jobDetails (client name, site address,
 * client phone, quote date, brief notes) plus the denormalised
 * indexed columns (client_name, site_address, quote_date). reviewData,
 * quotePayload, diffs, quote_diffs, and the frozen client_snapshot
 * are all untouched. No AI call. No agent_run. No status change.
 *
 * When a client portal token has been generated, the modal shows a
 * small honest note explaining that the customer's link stays on the
 * version that was sent — the tradesman has to regenerate the link
 * from the Sharing tab if they want the customer to see the edit.
 */
export default function EditDetailsModal({
  open,
  onClose,
  userId,
  jobId,
  initialDetails,
  hasClientToken,
  onSaved,
  showToast,
}) {
  const [form, setForm] = useState(() => ({
    clientName:  initialDetails?.clientName  || '',
    siteAddress: initialDetails?.siteAddress || '',
    clientPhone: initialDetails?.clientPhone || '',
    quoteDate:   initialDetails?.quoteDate   || '',
    briefNotes:  initialDetails?.briefNotes  || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Refresh form state whenever the parent re-opens with a different
  // initialDetails snapshot (e.g. another job clicked from dashboard).
  useEffect(() => {
    if (!open) return;
    setForm({
      clientName:  initialDetails?.clientName  || '',
      siteAddress: initialDetails?.siteAddress || '',
      clientPhone: initialDetails?.clientPhone || '',
      quoteDate:   initialDetails?.quoteDate   || '',
      briefNotes:  initialDetails?.briefNotes  || '',
    });
    setError(null);
  }, [open, jobId, initialDetails]);

  // ESC closes.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, saving]);

  const dirty = useMemo(() => {
    return (
      form.clientName  !== (initialDetails?.clientName  || '') ||
      form.siteAddress !== (initialDetails?.siteAddress || '') ||
      form.clientPhone !== (initialDetails?.clientPhone || '') ||
      form.quoteDate   !== (initialDetails?.quoteDate   || '') ||
      form.briefNotes  !== (initialDetails?.briefNotes  || '')
    );
  }, [form, initialDetails]);

  const update = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Only send the fields that actually changed. The server treats
      // undefined-keyed fields as no-op (won't blank existing values).
      const patch = {};
      if (form.clientName  !== (initialDetails?.clientName  || '')) patch.clientName  = form.clientName;
      if (form.siteAddress !== (initialDetails?.siteAddress || '')) patch.siteAddress = form.siteAddress;
      if (form.clientPhone !== (initialDetails?.clientPhone || '')) patch.clientPhone = form.clientPhone;
      if (form.quoteDate   !== (initialDetails?.quoteDate   || '')) patch.quoteDate   = form.quoteDate;
      if (form.briefNotes  !== (initialDetails?.briefNotes  || '')) patch.briefNotes  = form.briefNotes;

      const result = await patchJobDetails(userId, jobId, patch);
      if (typeof showToast === 'function') showToast('Details saved');
      if (typeof onSaved === 'function') onSaved(result?.jobDetails || { ...initialDetails, ...patch });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, form, initialDetails, userId, jobId, showToast, onSaved, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-details-title"
      onClick={() => { if (!saving) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tq-card)', borderRadius: 12, width: 520,
          maxWidth: '95vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1.5px solid var(--tq-border)',
          boxShadow: '0 24px 60px -12px rgba(40,28,12,0.4)',
        }}
      >
        {/* Header — matches HelpModal / StatusModal Daylight pattern. */}
        <div
          style={{
            padding: '18px 22px',
            background: 'var(--tq-accent-bg, rgba(189,94,9,0.08))',
            borderBottom: '1.5px solid var(--tq-accent-bd, var(--tq-accent))',
            flexShrink: 0,
          }}
        >
          <h3
            id="edit-details-title"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800, fontSize: 22, color: 'var(--tq-text)',
              margin: 0, letterSpacing: '0.01em',
            }}
          >
            Edit details
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--tq-muted)', fontSize: 13.5 }}>
            Numbers, materials and the schedule of works stay exactly as they are.
          </p>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '20px 22px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            flex: '1 1 auto',
          }}
        >
          {hasClientToken && (
            <div
              data-testid="edit-details-portal-notice"
              style={{
                marginBottom: 18, padding: '10px 14px',
                background: 'rgba(189,94,9,0.06)',
                border: '1px solid rgba(189,94,9,0.18)',
                borderRadius: 6,
                color: 'var(--tq-muted)', fontSize: 13, lineHeight: 1.5,
              }}
            >
              Your client's link shows the version you sent. To update the
              link too, regenerate it from the Sharing tab after saving.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Client name">
              <input
                type="text"
                value={form.clientName}
                onChange={(e) => update('clientName', e.target.value)}
                onBlur={(e) => update('clientName', e.target.value)}
                className="nq-field"
                maxLength={200}
                autoComplete="off"
                data-testid="edit-details-client-name"
              />
            </Field>

            <Field label="Site address">
              <textarea
                value={form.siteAddress}
                onChange={(e) => update('siteAddress', e.target.value)}
                onBlur={(e) => update('siteAddress', e.target.value)}
                className="nq-field"
                rows={2}
                maxLength={300}
                autoComplete="off"
                style={{ resize: 'vertical', minHeight: 44 }}
                data-testid="edit-details-site-address"
              />
            </Field>

            <Field label="Client phone (optional)">
              <input
                type="tel"
                value={form.clientPhone}
                onChange={(e) => update('clientPhone', e.target.value)}
                onBlur={(e) => update('clientPhone', e.target.value)}
                className="nq-field"
                maxLength={40}
                autoComplete="off"
                data-testid="edit-details-client-phone"
              />
            </Field>

            <Field label="Quote date">
              <input
                type="date"
                value={form.quoteDate}
                onChange={(e) => update('quoteDate', e.target.value)}
                onBlur={(e) => update('quoteDate', e.target.value)}
                className="nq-field"
                data-testid="edit-details-quote-date"
              />
            </Field>

            <Field label="Brief notes">
              <textarea
                value={form.briefNotes}
                onChange={(e) => update('briefNotes', e.target.value)}
                onBlur={(e) => update('briefNotes', e.target.value)}
                className="nq-field"
                rows={3}
                maxLength={2000}
                autoComplete="off"
                style={{ resize: 'vertical', minHeight: 44 }}
                data-testid="edit-details-brief-notes"
              />
            </Field>
          </div>

          {error && (
            <div
              role="alert"
              data-testid="edit-details-error"
              style={{
                marginTop: 16, padding: '8px 12px',
                background: 'rgba(185,28,28,0.07)',
                border: '1px solid rgba(185,28,28,0.18)',
                borderRadius: 6,
                color: 'var(--tq-error, #b91c1c)', fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Sticky footer */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--tq-border)',
            display: 'flex', gap: 10, justifyContent: 'flex-end',
            flexShrink: 0, background: 'var(--tq-card)',
          }}
        >
          <button
            type="button"
            onClick={() => { if (!saving) onClose?.(); }}
            className="btn-ghost"
            style={{ minHeight: 44, padding: '0 18px' }}
            disabled={saving}
            data-testid="edit-details-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
            style={{ minHeight: 44, padding: '0 18px' }}
            disabled={!dirty || saving}
            data-testid="edit-details-save"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
      }}
    >
      <span
        className="eyebrow"
        style={{ color: 'var(--tq-muted)' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
