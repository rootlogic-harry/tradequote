import React from 'react';

export default function RamsContact({ rams, dispatch }) {
  const update = (field, value) => {
    dispatch({ type: 'UPDATE_RAMS', updates: { [field]: value } });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 fq:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Title</label>
          <input
            type="text"
            value={rams.contactTitle || ''}
            onChange={e => update('contactTitle', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Name</label>
          <input
            type="text"
            value={rams.contactName || ''}
            onChange={e => update('contactName', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Phone</label>
          <input
            type="tel"
            value={rams.contactNumber || ''}
            onChange={e => update('contactNumber', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
      </div>
    </div>
  );
}
