import React, { useState, useEffect } from 'react';

function NumericInput({ value: propValue, onChange, step, className }) {
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
    />
  );
}

export default function LabourSection({ labourEstimate, dispatch }) {
  const { estimatedDays, numberOfWorkers, dayRate, aiEstimatedDays, description } = labourEstimate;
  const labourTotal = (estimatedDays || 0) * (numberOfWorkers || 0) * (dayRate || 0);

  const update = (field, value) => {
    dispatch({
      type: 'UPDATE_LABOUR',
      labour: { [field]: value },
    });
  };

  const inputClass = "w-full bg-tq-card border border-tq-border rounded px-2 py-1.5 text-sm font-mono text-tq-text focus:outline-none focus:border-tq-accent";

  return (
    <div>
      <h4 className="font-heading font-bold text-sm text-tq-muted uppercase tracking-wide mb-2">
        Labour
      </h4>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-tq-muted mb-1">Days</label>
          <NumericInput
            value={estimatedDays}
            step="0.5"
            onChange={(v) => update('estimatedDays', v)}
            className={inputClass}
          />
          {aiEstimatedDays != null && aiEstimatedDays !== estimatedDays && (
            <p className="text-xs text-tq-muted mt-0.5">AI: {aiEstimatedDays} days</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1">Workers</label>
          <NumericInput
            value={numberOfWorkers}
            onChange={(v) => update('numberOfWorkers', v)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1">Day Rate</label>
          <NumericInput
            value={dayRate}
            onChange={(v) => update('dayRate', v)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex justify-between items-center text-sm">
        <span className="text-tq-muted">Labour total</span>
        <span className="font-mono font-medium text-tq-text">{'\u00A3'}{labourTotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
