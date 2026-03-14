import React, { useState } from 'react';

function PersonList({ label, items, field, dispatch, rams }) {
  const [newItem, setNewItem] = useState('');

  const add = () => {
    if (!newItem.trim()) return;
    const updated = [...items, newItem.trim()];
    dispatch({ type: 'UPDATE_RAMS', updates: { [field]: updated } });
    setNewItem('');
  };

  const remove = (index) => {
    const updated = items.filter((_, i) => i !== index);
    dispatch({ type: 'UPDATE_RAMS', updates: { [field]: updated } });
  };

  return (
    <div>
      <label className="block text-xs font-heading font-bold text-tq-muted uppercase tracking-wide mb-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-1 mb-2">
        {items.map((name, i) => (
          <span key={i} className="bg-tq-card border border-tq-border rounded px-2 py-1 text-sm text-tq-text flex items-center gap-1">
            {name}
            <button onClick={() => remove(i)} className="text-tq-muted hover:text-red-400 text-xs ml-1">&times;</button>
          </span>
        ))}
        {items.length === 0 && <span className="text-tq-muted text-sm italic">None added</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add name..."
          className="flex-1 bg-tq-card border border-tq-border rounded px-3 py-1.5 text-tq-text text-sm"
        />
        <button
          onClick={add}
          disabled={!newItem.trim()}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function RamsPersonnel({ rams, dispatch }) {
  return (
    <div className="space-y-6">
      <PersonList
        label="Employees on Job"
        items={rams.employeesOnJob || []}
        field="employeesOnJob"
        dispatch={dispatch}
        rams={rams}
      />
      <PersonList
        label="RAMS Communicated To"
        items={rams.communicatedEmployees || []}
        field="communicatedEmployees"
        dispatch={dispatch}
        rams={rams}
      />
    </div>
  );
}
