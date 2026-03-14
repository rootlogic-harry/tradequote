import React from 'react';
import { COMMON_PPE } from '../../data/ramsDefaults.js';

export default function RamsPPE({ rams, dispatch }) {
  const selected = rams.ppeRequirements || [];

  const toggle = (ppeId) => {
    const next = selected.includes(ppeId)
      ? selected.filter(id => id !== ppeId)
      : [...selected, ppeId];
    dispatch({ type: 'UPDATE_RAMS', updates: { ppeRequirements: next } });
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {COMMON_PPE.map(ppe => {
        const isSelected = selected.includes(ppe.id);
        return (
          <button
            key={ppe.id}
            onClick={() => toggle(ppe.id)}
            className={`flex flex-col items-center gap-1 p-3 rounded border text-sm transition-colors ${
              isSelected
                ? 'bg-tq-accent/20 border-tq-accent text-tq-accent'
                : 'bg-tq-card border-tq-border text-tq-muted hover:border-tq-accent/50'
            }`}
          >
            <span className="text-2xl">{ppe.icon}</span>
            <span className="text-[10px] font-heading font-bold uppercase tracking-wide text-center leading-tight">
              {ppe.label}
            </span>
            {isSelected && <span className="text-xs text-tq-confirmed">&#10003;</span>}
          </button>
        );
      })}
    </div>
  );
}
