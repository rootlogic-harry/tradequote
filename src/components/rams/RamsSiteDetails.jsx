import React from 'react';

export default function RamsSiteDetails({ rams, dispatch }) {
  const update = (field, value) => {
    dispatch({ type: 'UPDATE_RAMS', updates: { [field]: value } });
  };

  const fields = [
    { key: 'workplaceAccess', label: 'Workplace Access' },
    { key: 'workplaceLighting', label: 'Workplace Lighting' },
    { key: 'wasteManagement', label: 'Waste Management' },
    { key: 'hazardousMaterials', label: 'Hazardous Materials' },
    { key: 'specialControlMeasures', label: 'Special Control Measures' },
  ];

  return (
    <div className="space-y-4">
      {fields.map(f => (
        <div key={f.key}>
          <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-1">
            {f.label}
          </label>
          <textarea
            value={rams[f.key] || ''}
            onChange={e => update(f.key, e.target.value)}
            rows={3}
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm resize-y"
          />
        </div>
      ))}
    </div>
  );
}
