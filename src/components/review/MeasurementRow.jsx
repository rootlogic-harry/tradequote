import React, { useState, useEffect } from 'react';
import { buildDiff } from '../../utils/diffTracking.js';

const CONFIDENCE_COLORS = {
  high: 'bg-tq-confirmed',
  medium: 'bg-tq-unconfirmed',
  low: 'bg-tq-error',
};

export default function MeasurementRow({ measurement, dispatch, variant = 'row' }) {
  const [editValue, setEditValue] = useState(measurement.value);
  const { id, item, aiValue, confirmed, confidence, note } = measurement;

  useEffect(() => {
    setEditValue(measurement.value);
  }, [measurement.value, measurement.confirmed]);

  const handleConfirm = () => {
    const diff = buildDiff('measurement', item, aiValue, editValue);
    dispatch({
      type: 'CONFIRM_MEASUREMENT',
      id,
      value: editValue,
      diff,
    });
  };

  const handleEdit = () => {
    dispatch({ type: 'EDIT_MEASUREMENT', id });
  };

  const confidenceDot = confidence ? (
    <span
      className={`inline-block w-2 h-2 rounded-full ${CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.low}`}
      title={`AI confidence: ${confidence}`}
    />
  ) : null;

  // Card variant for mobile
  if (variant === 'card') {
    return (
      <div
        className={`border rounded-lg p-3 ${
          confirmed
            ? 'border-tq-confirmed/30 bg-tq-confirmed/5'
            : 'border-tq-unconfirmed/30 bg-tq-unconfirmed/5'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {confidenceDot}
            <span className="text-sm font-medium text-tq-text">{item}</span>
          </div>
          <span className="text-center">
            {confirmed ? (
              <span className="text-tq-confirmed text-sm">✓</span>
            ) : (
              <span className="text-tq-unconfirmed text-sm animate-pulse">⚠️</span>
            )}
          </span>
        </div>
        <p className="text-xs text-tq-muted font-mono mb-2">AI: {aiValue}</p>
        <div className="flex items-center gap-2">
          {confirmed ? (
            <>
              <span className="flex-1 text-sm font-mono text-tq-confirmed">{measurement.value}</span>
              <button
                onClick={handleEdit}
                className="text-xs text-tq-muted hover:text-tq-accent"
              >
                Edit
              </button>
            </>
          ) : (
            <>
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 bg-tq-card border border-tq-unconfirmed/50 rounded px-2 py-1.5 text-sm font-mono text-tq-text focus:outline-none focus:border-tq-accent"
              />
              <button
                onClick={handleConfirm}
                className="text-xs bg-tq-accent text-tq-bg px-3 py-1.5 rounded font-heading uppercase hover:bg-tq-accent-dark"
              >
                Confirm
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Table row variant (default)
  return (
    <tr
      className={`border-b border-tq-border transition-colors ${
        confirmed
          ? 'bg-tq-confirmed/5'
          : 'bg-tq-unconfirmed/5'
      }`}
    >
      <td className="px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-1.5">
          {confidenceDot}
          {item}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-tq-muted font-mono">{aiValue}</td>
      <td className="px-3 py-2">
        {confirmed ? (
          <span className="text-sm font-mono text-tq-confirmed">{measurement.value}</span>
        ) : (
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full bg-tq-card border border-tq-unconfirmed/50 rounded px-2 py-1 text-sm font-mono text-tq-text focus:outline-none focus:border-tq-accent"
          />
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {confirmed ? (
          <span className="text-tq-confirmed text-sm">✓</span>
        ) : (
          <span className="text-tq-unconfirmed text-sm animate-pulse">⚠️</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {confirmed ? (
          <button
            onClick={handleEdit}
            className="text-xs text-tq-muted hover:text-tq-accent"
          >
            Edit
          </button>
        ) : (
          <button
            onClick={handleConfirm}
            className="text-xs bg-tq-accent text-tq-bg px-3 py-1 rounded font-heading uppercase hover:bg-tq-accent-dark"
          >
            Confirm
          </button>
        )}
      </td>
    </tr>
  );
}
