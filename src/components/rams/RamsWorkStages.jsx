import React, { useState } from 'react';
import { WORK_TYPE_LABELS } from '../../data/ramsConstants.js';

export default function RamsWorkStages({ rams, dispatch }) {
  const [newStage, setNewStage] = useState('');
  const workStages = rams.workStages || [];

  const removeStage = (index) => {
    const updated = workStages.filter((_, i) => i !== index);
    dispatch({ type: 'UPDATE_RAMS', updates: { workStages: updated } });
  };

  const addStage = () => {
    if (!newStage.trim()) return;
    const updated = [...workStages, { type: 'custom', stage: newStage.trim() }];
    dispatch({ type: 'UPDATE_RAMS', updates: { workStages: updated } });
    setNewStage('');
  };

  const editStage = (index, value) => {
    const updated = workStages.map((s, i) => i === index ? { ...s, stage: value } : s);
    dispatch({ type: 'UPDATE_RAMS', updates: { workStages: updated } });
  };

  const moveStage = (from, to) => {
    if (to < 0 || to >= workStages.length) return;
    const updated = [...workStages];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    dispatch({ type: 'UPDATE_RAMS', updates: { workStages: updated } });
  };

  // Group by type for display
  const grouped = {};
  workStages.forEach((s, i) => {
    const key = s.type || 'custom';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...s, originalIndex: i });
  });

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([type, stages]) => (
        <div key={type}>
          <h4 className="text-xs font-heading font-bold text-tq-accent uppercase tracking-wide mb-2">
            {WORK_TYPE_LABELS[type] || 'Custom'}
          </h4>
          <ol className="space-y-1">
            {stages.map((s, displayIdx) => (
              <li key={s.originalIndex} className="flex items-start gap-2 group">
                <span className="text-tq-muted font-mono text-xs mt-2 w-6 text-right flex-shrink-0">
                  {displayIdx + 1}.
                </span>
                <input
                  type="text"
                  value={s.stage}
                  onChange={e => editStage(s.originalIndex, e.target.value)}
                  className="flex-1 bg-tq-card border border-tq-border rounded px-2 py-1.5 text-tq-text text-sm"
                />
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => moveStage(s.originalIndex, s.originalIndex - 1)}
                    className="text-tq-muted hover:text-tq-accent text-xs px-1"
                    title="Move up"
                  >
                    &#9650;
                  </button>
                  <button
                    onClick={() => moveStage(s.originalIndex, s.originalIndex + 1)}
                    className="text-tq-muted hover:text-tq-accent text-xs px-1"
                    title="Move down"
                  >
                    &#9660;
                  </button>
                  <button
                    onClick={() => removeStage(s.originalIndex)}
                    className="text-tq-muted hover:text-red-400 text-sm px-1"
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {workStages.length === 0 && (
        <p className="text-tq-muted text-sm italic">Select work types above to auto-populate work stages.</p>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newStage}
          onChange={e => setNewStage(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addStage()}
          placeholder="Add custom work stage..."
          className="flex-1 bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
        />
        <button
          onClick={addStage}
          disabled={!newStage.trim()}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-4 py-2 rounded transition-colors disabled:opacity-40"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
