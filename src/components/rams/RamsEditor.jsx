import React, { useState } from 'react';
import { calculateRamsCompletion } from '../../utils/ramsBuilder.js';
import RamsJobDetails from './RamsJobDetails.jsx';
import RamsWorkTypes from './RamsWorkTypes.jsx';
import RamsWorkStages from './RamsWorkStages.jsx';
import RamsRiskTable from './RamsRiskTable.jsx';
import RamsRiskMatrix from './RamsRiskMatrix.jsx';
import RamsPPE from './RamsPPE.jsx';
import RamsSiteDetails from './RamsSiteDetails.jsx';
import RamsPersonnel from './RamsPersonnel.jsx';
import RamsContact from './RamsContact.jsx';

const SECTIONS = [
  { id: 'job', label: 'Job Details', Component: RamsJobDetails },
  { id: 'workTypes', label: 'Work Types', Component: RamsWorkTypes },
  { id: 'workStages', label: 'Method Statement', Component: RamsWorkStages },
  { id: 'risks', label: 'Risk Assessments', Component: RamsRiskTable },
  { id: 'matrix', label: 'Risk Matrix', Component: RamsRiskMatrix },
  { id: 'ppe', label: 'PPE Requirements', Component: RamsPPE },
  { id: 'site', label: 'Site Details', Component: RamsSiteDetails },
  { id: 'personnel', label: 'Personnel', Component: RamsPersonnel },
  { id: 'contact', label: 'Contact Details', Component: RamsContact },
];

export default function RamsEditor({ rams, dispatch, onPreview }) {
  const [openSections, setOpenSections] = useState(new Set(['job']));
  const completion = calculateRamsCompletion(rams);

  const toggleSection = (id) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setOpenSections(new Set(SECTIONS.map(s => s.id)));
  const collapseAll = () => setOpenSections(new Set());

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="page-title mb-1" style={{ fontSize: 28 }}>
            RAMS Editor
          </h2>
          <p className="text-tq-muted text-sm">
            Risk Assessment &amp; Method Statement
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="text-tq-muted hover:text-tq-accent text-xs font-heading uppercase"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-tq-muted hover:text-tq-accent text-xs font-heading uppercase"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Completion bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-heading font-bold text-tq-muted uppercase tracking-wide">Completion</span>
          <span className="font-mono text-tq-text">{completion}%</span>
        </div>
        <div className="h-2 bg-tq-card rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${completion}%`,
              backgroundColor: completion === 100 ? '#4ade80' : '#e8a838',
            }}
          />
        </div>
      </div>

      {/* Sticky pill bar for quick-jump navigation */}
      <div className="sticky top-0 z-10 bg-tq-bg/95 backdrop-blur-sm border-b border-tq-border -mx-4 px-4 py-2 mb-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => {
                setOpenSections(prev => new Set([...prev, id]));
                document.getElementById(`rams-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`pill ${openSections.has(id) ? 'active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Accordion sections */}
      <div className="space-y-2 mb-6">
        {SECTIONS.map(({ id, label, Component }) => {
          const isOpen = openSections.has(id);
          // RamsRiskMatrix doesn't take rams/dispatch props
          const isMatrix = id === 'matrix';

          return (
            <div key={id} id={`rams-${id}`} className="bg-tq-surface border border-tq-border overflow-hidden" style={{ borderRadius: 2 }}>
              <button
                onClick={() => toggleSection(id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-tq-card transition-colors"
              >
                <span className="font-heading font-bold text-sm text-tq-text uppercase tracking-wide">
                  {label}
                </span>
                <span className="text-tq-muted text-lg">
                  {isOpen ? '\u2212' : '+'}
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  {isMatrix ? <Component /> : <Component rams={rams} dispatch={dispatch} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview button */}
      <button
        onClick={onPreview}
        className="w-full bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide py-3 rounded transition-colors text-sm"
      >
        Preview &amp; Export RAMS
      </button>
    </div>
  );
}
