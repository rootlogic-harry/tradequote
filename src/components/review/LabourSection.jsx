import React, { useState, useEffect } from 'react';
import { formatCurrency } from '../../utils/quoteBuilder.js';

function NumericInput({ value: propValue, onChange, step, className, style }) {
  const [local, setLocal] = useState(String(propValue ?? ''));

  useEffect(() => {
    setLocal(String(propValue ?? ''));
  }, [propValue]);

  return (
    <input
      type="number"
      step={step}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onChange(parseFloat(local) || 0)}
      className={className}
      style={style}
    />
  );
}

export default function LabourSection({ labourEstimate = {}, dispatch }) {
  const { estimatedDays, numberOfWorkers, dayRate, aiEstimatedDays, description } = labourEstimate;
  const labourTotal = (estimatedDays || 0) * (numberOfWorkers || 0) * (dayRate || 0);

  const update = (field, value) => {
    dispatch({
      type: 'UPDATE_LABOUR',
      labour: { [field]: value },
    });
  };

  const inputStyle = {
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: 16,
    fontWeight: 500,
    textAlign: 'center',
    backgroundColor: 'var(--tq-card)',
    border: '1.5px solid var(--tq-border)',
    borderRadius: 6,
    color: 'var(--tq-text)',
    width: '100%',
    padding: '6px 4px',
  };

  return (
    <div>
      <h4 className="font-heading font-bold text-sm uppercase tracking-wide mb-3" style={{ color: 'var(--tq-muted)' }}>
        Labour
      </h4>

      {/* Calculator layout */}
      <div
        className="rounded-lg p-3"
        style={{ backgroundColor: 'var(--tq-surface)', borderRadius: 8 }}
      >
        <div className="flex items-end gap-2">
          {/* Days */}
          <div className="flex-1 text-center">
            <label className="block mb-1" style={{ fontSize: 10, color: 'var(--tq-muted)', textTransform: 'uppercase' }}>Days</label>
            <NumericInput
              value={estimatedDays}
              step="0.5"
              onChange={(v) => update('estimatedDays', Math.max(0, v))}
              className="focus:outline-none focus:border-tq-accent"
              style={inputStyle}
            />
          </div>
          {/* × */}
          <span className="pb-2 text-sm" style={{ color: 'var(--tq-muted)' }}>×</span>
          {/* Workers */}
          <div className="flex-1 text-center">
            <label className="block mb-1" style={{ fontSize: 10, color: 'var(--tq-muted)', textTransform: 'uppercase' }}>Workers</label>
            <NumericInput
              value={numberOfWorkers}
              step="1"
              onChange={(v) => update('numberOfWorkers', Math.max(1, Math.round(v)))}
              className="focus:outline-none focus:border-tq-accent"
              style={inputStyle}
            />
          </div>
          {/* × */}
          <span className="pb-2 text-sm" style={{ color: 'var(--tq-muted)' }}>×</span>
          {/* Day Rate */}
          <div className="flex-1 text-center">
            <label className="block mb-1" style={{ fontSize: 10, color: 'var(--tq-muted)', textTransform: 'uppercase' }}>Day Rate</label>
            <NumericInput
              value={dayRate}
              onChange={(v) => update('dayRate', Math.max(0, v))}
              className="focus:outline-none focus:border-tq-accent"
              style={inputStyle}
            />
          </div>
        </div>

        {aiEstimatedDays != null && aiEstimatedDays !== estimatedDays && (
          <p className="text-xs mt-2" style={{ color: 'var(--tq-muted)' }}>Suggested: {aiEstimatedDays} days</p>
        )}

        {/* Labour total */}
        <div
          className="flex justify-between items-center mt-3 pt-3"
          style={{ borderTop: '1px solid var(--tq-border)' }}
        >
          <span className="text-xs uppercase tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-muted)' }}>
            LABOUR TOTAL
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, fontWeight: 500, color: 'var(--tq-text)' }}>
            {formatCurrency(labourTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}
