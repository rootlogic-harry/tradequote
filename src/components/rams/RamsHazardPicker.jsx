import React, { useState, useMemo } from 'react';
import { CONSTRUCTION_HAZARDS } from '../../data/constructionHazards.js';
import { HAZARD_CATEGORIES } from '../../data/ramsConstants.js';
import { getRiskLevel } from '../../utils/ramsBuilder.js';

export default function RamsHazardPicker({ onAdd, onClose }) {
  const [activeCategory, setActiveCategory] = useState(HAZARD_CATEGORIES[0]);
  const [search, setSearch] = useState('');

  const filteredHazards = useMemo(() => {
    let hazards = CONSTRUCTION_HAZARDS;
    if (search.trim()) {
      const q = search.toLowerCase();
      hazards = hazards.filter(h =>
        h.task.toLowerCase().includes(q) ||
        h.hazardDescription.toLowerCase().includes(q) ||
        h.category.toLowerCase().includes(q)
      );
    } else {
      hazards = hazards.filter(h => h.category === activeCategory);
    }
    return hazards;
  }, [activeCategory, search]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-tq-surface rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col border border-tq-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-tq-border">
          <h2 className="text-lg font-heading font-bold text-tq-accent">Construction Hazard Database</h2>
          <button onClick={onClose} className="text-tq-muted hover:text-tq-text text-2xl">&times;</button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-tq-border">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search hazards..."
            className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
          />
        </div>

        <div className="flex flex-col fq:flex-row flex-1 min-h-0">
          {/* Category tabs */}
          {!search.trim() && (
            <div className="w-48 flex-shrink-0 border-r border-tq-border overflow-y-auto hidden fq:block">
              {HAZARD_CATEGORIES.map(cat => {
                const count = CONSTRUCTION_HAZARDS.filter(h => h.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`w-full text-left px-3 py-2 text-xs font-heading transition-colors ${
                      activeCategory === cat
                        ? 'bg-tq-accent/20 text-tq-accent font-bold'
                        : 'text-tq-text hover:bg-tq-card'
                    }`}
                  >
                    {cat} <span className="text-tq-muted">({count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Mobile category select */}
          {!search.trim() && (
            <div className="fq:hidden p-2 border-b border-tq-border">
              <select
                value={activeCategory}
                onChange={e => setActiveCategory(e.target.value)}
                className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-tq-text text-sm"
              >
                {HAZARD_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          )}

          {/* Hazard cards */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {filteredHazards.length === 0 && (
              <p className="text-tq-muted text-sm text-center py-8">No hazards found.</p>
            )}
            {filteredHazards.map(hazard => {
              const rating = hazard.typicalLikelihood * hazard.typicalConsequence;
              const level = getRiskLevel(rating);
              return (
                <div key={hazard.id} className="bg-tq-card border border-tq-border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-tq-text">{hazard.task}</div>
                      {search.trim() && (
                        <div className="text-[10px] text-tq-accent font-heading uppercase">{hazard.category}</div>
                      )}
                    </div>
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold font-mono whitespace-nowrap"
                      style={{ backgroundColor: level.color + '20', color: level.color }}
                    >
                      {rating} {level.label}
                    </span>
                  </div>
                  <p className="text-xs text-tq-muted mb-2">{hazard.hazardDescription}</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {hazard.typicalControls.map((ctrl, i) => (
                      <span key={i} className="bg-tq-surface text-tq-text text-[10px] px-2 py-0.5 rounded">
                        {ctrl}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-tq-muted font-mono">
                      L:{hazard.typicalLikelihood} x C:{hazard.typicalConsequence}
                    </span>
                    <button
                      onClick={() => onAdd(hazard)}
                      className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-[10px] px-3 py-1 rounded transition-colors"
                    >
                      Add to RAMS
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
