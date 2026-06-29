import React, { useState } from 'react';
import { getRiskLevel } from '../../utils/ramsBuilder.js';
import RamsHazardPicker from './RamsHazardPicker.jsx';

export default function RamsRiskTable({ rams, dispatch }) {
  const [showPicker, setShowPicker] = useState(false);
  const risks = rams.riskAssessments || [];

  const updateRisk = (id, updates) => {
    dispatch({ type: 'UPDATE_RAMS_RISK', id, updates });
  };

  const removeRisk = (id) => {
    dispatch({ type: 'REMOVE_RAMS_RISK', id });
  };

  const addBlankRisk = () => {
    dispatch({
      type: 'ADD_RAMS_RISK',
      risk: {
        id: `risk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        task: '',
        hazardDescription: '',
        whoMightBeHarmed: '',
        existingControls: [],
        likelihood: 1,
        consequence: 1,
        riskRating: 1,
        furtherActionRequired: '',
      },
    });
  };

  const handleAddFromDb = (hazard) => {
    dispatch({
      type: 'ADD_RAMS_RISK',
      risk: {
        id: `risk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        task: hazard.task,
        hazardDescription: hazard.hazardDescription,
        whoMightBeHarmed: hazard.whoMightBeHarmed,
        existingControls: [...hazard.typicalControls],
        likelihood: hazard.typicalLikelihood,
        consequence: hazard.typicalConsequence,
        riskRating: hazard.typicalLikelihood * hazard.typicalConsequence,
        furtherActionRequired: '',
      },
    });
  };

  const updateControl = (riskId, controlIdx, value) => {
    const risk = risks.find(r => r.id === riskId);
    if (!risk) return;
    const controls = [...risk.existingControls];
    controls[controlIdx] = value;
    updateRisk(riskId, { existingControls: controls });
  };

  const addControl = (riskId) => {
    const risk = risks.find(r => r.id === riskId);
    if (!risk) return;
    updateRisk(riskId, { existingControls: [...risk.existingControls, ''] });
  };

  const removeControl = (riskId, controlIdx) => {
    const risk = risks.find(r => r.id === riskId);
    if (!risk) return;
    updateRisk(riskId, { existingControls: risk.existingControls.filter((_, i) => i !== controlIdx) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 mb-2">
        <button
          onClick={addBlankRisk}
          style={{ minHeight: 44 }}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide text-xs px-4 rounded transition-colors"
        >
          + Add Risk
        </button>
        <button
          onClick={() => setShowPicker(true)}
          style={{ minHeight: 44 }}
          className="border border-tq-accent text-tq-accent hover:bg-tq-accent/10 font-heading font-bold uppercase tracking-wide text-xs px-4 rounded transition-colors"
        >
          + Add from Database
        </button>
      </div>

      {/* Risk cards (mobile-friendly) */}
      <div className="space-y-3">
        {risks.map((risk) => {
          const level = getRiskLevel(risk.riskRating);
          return (
            <div key={risk.id} className="bg-tq-card border border-tq-border p-4" style={{ borderRadius: 2 }}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <input
                  type="text"
                  value={risk.task}
                  onChange={e => updateRisk(risk.id, { task: e.target.value })}
                  placeholder="Task / Activity"
                  className="rams-input flex-1 font-bold"
                />
                <span
                  className="px-2 py-1 rounded text-xs font-bold font-mono whitespace-nowrap"
                  style={{ backgroundColor: level.color + '20', color: level.color }}
                >
                  {risk.riskRating} {level.label}
                </span>
                <button
                  type="button"
                  onClick={() => removeRisk(risk.id)}
                  className="touch-44 text-tq-muted hover:text-red-400 flex-shrink-0"
                  aria-label="Remove risk"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Hazard</label>
                  <textarea
                    value={risk.hazardDescription}
                    onChange={e => updateRisk(risk.id, { hazardDescription: e.target.value })}
                    rows={2}
                    className="rams-input resize-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Who Might Be Harmed</label>
                  <input
                    type="text"
                    value={risk.whoMightBeHarmed}
                    onChange={e => updateRisk(risk.id, { whoMightBeHarmed: e.target.value })}
                    className="rams-input"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Existing Controls</label>
                  <div className="space-y-1">
                    {(risk.existingControls || []).map((ctrl, ci) => (
                      <div key={ci} className="flex gap-1 items-center">
                        <input
                          type="text"
                          value={ctrl}
                          onChange={e => updateControl(risk.id, ci, e.target.value)}
                          className="rams-input flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeControl(risk.id, ci)}
                          className="touch-44 text-tq-muted hover:text-red-400"
                          aria-label="Remove control"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addControl(risk.id)}
                      className="touch-44 text-tq-accent text-xs hover:underline"
                      style={{ justifyContent: 'flex-start' }}
                    >
                      + Add control
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Likelihood (1-5)</label>
                    <select
                      value={risk.likelihood}
                      onChange={e => updateRisk(risk.id, { likelihood: Number(e.target.value) })}
                      className="rams-input"
                    >
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Consequence (1-5)</label>
                    <select
                      value={risk.consequence}
                      onChange={e => updateRisk(risk.id, { consequence: Number(e.target.value) })}
                      className="rams-input"
                    >
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-heading text-tq-muted uppercase tracking-wide mb-0.5">Further Action Required</label>
                  <input
                    type="text"
                    value={risk.furtherActionRequired}
                    onChange={e => updateRisk(risk.id, { furtherActionRequired: e.target.value })}
                    className="rams-input"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {risks.length === 0 && (
        <p className="text-tq-muted text-sm italic text-center py-4">
          No risk assessments yet. Add from the database or create a blank entry.
        </p>
      )}

      {showPicker && (
        <RamsHazardPicker
          onAdd={handleAddFromDb}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
