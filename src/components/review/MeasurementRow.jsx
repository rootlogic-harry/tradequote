import React, { useState, useEffect } from 'react';
import { buildDiff } from '../../utils/diffTracking.js';

export default function MeasurementRow({ measurement, dispatch }) {
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

  return (
    <tr
      className={`border-b border-tq-border transition-colors ${
        confirmed
          ? 'bg-tq-confirmed/5'
          : 'bg-tq-unconfirmed/5'
      }`}
    >
      <td className="px-3 py-2 text-sm">{item}</td>
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
