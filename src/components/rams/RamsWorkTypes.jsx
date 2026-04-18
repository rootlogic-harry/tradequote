import React from 'react';
import { WORK_TYPES, WORK_TYPE_LABELS } from '../../data/ramsConstants.js';

export default function RamsWorkTypes({ rams, dispatch }) {
  const toggle = (wt) => {
    const current = rams.workTypes || [];
    const next = current.includes(wt)
      ? current.filter(t => t !== wt)
      : [...current, wt];
    dispatch({ type: 'SET_RAMS_WORK_TYPES', workTypes: next });
  };

  return (
    <div className="grid grid-cols-2 fq:grid-cols-3 gap-2">
      {WORK_TYPES.map(wt => {
        const selected = (rams.workTypes || []).includes(wt);
        return (
          <button
            key={wt}
            onClick={() => toggle(wt)}
            className={`text-left px-3 py-2 rounded border text-sm font-heading transition-colors ${
              selected
                ? 'bg-tq-accent/20 border-tq-accent text-tq-accent font-bold'
                : 'bg-tq-card border-tq-border text-tq-text hover:border-tq-accent/50'
            }`}
          >
            {selected ? '\u2713 ' : ''}{WORK_TYPE_LABELS[wt] || wt}
          </button>
        );
      })}
    </div>
  );
}
