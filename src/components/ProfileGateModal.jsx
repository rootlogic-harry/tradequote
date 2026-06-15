import React from 'react';

/**
 * TRQ-94 — Profile gate modal.
 *
 * Raised from any customer-facing surface (Send via Outlook, PDF/DOCX
 * download, client portal link generation) when the tradesman tries to
 * produce an artefact their customer will see before they've filled in
 * their own company details.
 *
 * Tapping "Add details" hands off to App.jsx's existing profile modal
 * via the onOpenProfile callback — that modal already knows how to
 * save and flip profile_complete=true on close, so once the form is
 * filled the gate stops being raised on the next attempt.
 *
 * `term` lets the copy match what the user calls their document type
 * (quote / estimate / invoice — see documentTerm.js). Defaults to
 * 'quote' so the component is safe to drop in anywhere.
 */
export default function ProfileGateModal({ open, term, onClose, onOpenProfile }) {
  if (!open) return null;
  const lower = term?.lower || 'quote';
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-gate-title"
    >
      <div className="bg-tq-surface rounded-lg max-w-md w-full p-6 border border-tq-border">
        <h3
          id="profile-gate-title"
          className="text-lg font-heading font-bold text-tq-accent mb-3"
        >
          Add your business details first
        </h3>
        <p className="text-tq-muted mb-5 text-sm leading-relaxed">
          Your company name, contact details, and trading address appear on
          every {lower} your customer receives. Fill them in once and
          you're set.
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-ghost">
            Not now
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              if (onOpenProfile) onOpenProfile();
            }}
            className="btn-primary"
            autoFocus
          >
            Add details
          </button>
        </div>
      </div>
    </div>
  );
}
