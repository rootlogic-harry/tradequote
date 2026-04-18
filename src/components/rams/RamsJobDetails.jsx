import React from 'react';

export default function RamsJobDetails({ rams, dispatch }) {
  const update = (field, value) => {
    dispatch({ type: 'UPDATE_RAMS', updates: { [field]: value } });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Job Number</label>
          <input
            type="text"
            value={rams.jobNumber || ''}
            onChange={e => update('jobNumber', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Document Date</label>
          <input
            type="date"
            value={rams.documentDate || ''}
            onChange={e => update('documentDate', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Site Address</label>
        <input
          type="text"
          value={rams.siteAddress || ''}
          onChange={e => update('siteAddress', e.target.value)}
          className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
        />
      </div>

      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Company</label>
          <input
            type="text"
            value={rams.company || ''}
            onChange={e => update('company', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Client</label>
          <input
            type="text"
            value={rams.client || ''}
            onChange={e => update('client', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Foreman / Site Supervisor</label>
        <input
          type="text"
          value={rams.foreman || ''}
          onChange={e => update('foreman', e.target.value)}
          className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
        />
      </div>

      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Commencement Date</label>
          <input
            type="date"
            value={rams.commencementDate || ''}
            onChange={e => update('commencementDate', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">Projected Completion</label>
          <input
            type="date"
            value={rams.projectedCompletionDate || ''}
            onChange={e => update('projectedCompletionDate', e.target.value)}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>
      </div>
    </div>
  );
}
