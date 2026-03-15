import React, { useState, useEffect } from 'react';
import { buildDiff } from '../../utils/diffTracking.js';

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

  // Card-based layout (used for both mobile and desktop now)
  if (confirmed) {
    return (
      <div
        className="rounded-lg"
        style={{
          backgroundColor: 'var(--tq-confirmed-bg)',
          border: '1.5px solid var(--tq-confirmed-bd)',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--tq-confirmed-txt)', fontSize: 12 }}>
            {item}
          </span>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'var(--tq-confirmed-bd)',
              color: '#ffffff',
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
            }}
          >
            ✓ CONFIRMED
          </span>
        </div>
        {/* Value display */}
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
          {measurement.value}
        </div>
        {/* Footer */}
        <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--tq-confirmed-txt)', fontSize: 11 }}>
          <span>Accepted AI suggestion</span>
          <span>·</span>
          <button onClick={handleEdit} className="underline" style={{ color: 'var(--tq-confirmed-txt)' }}>Edit</button>
        </div>
      </div>
    );
  }

  // Unconfirmed card
  return (
    <div
      className="rounded-lg"
      style={{
        backgroundColor: 'var(--tq-unconf-bg)',
        border: '1.5px solid var(--tq-unconf-bd)',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--tq-unconf-txt)', fontSize: 12 }}>
          {item}
        </span>
        <span
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: 'var(--tq-unconf-bd)',
            color: '#ffffff',
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
          }}
        >
          ⚠ UNCONFIRMED
        </span>
      </div>
      {/* Input */}
      <input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        className="w-full rounded px-2 py-1.5 focus:outline-none"
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 13,
          border: '1.5px solid var(--tq-unconf-bd)',
          borderRadius: 6,
          backgroundColor: 'var(--tq-card)',
          color: 'var(--tq-text)',
        }}
      />
      {/* Confirm button */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs" style={{ color: 'var(--tq-muted)', fontSize: 11 }}>
          AI suggested: {aiValue}
        </span>
        <button
          onClick={handleConfirm}
          className="uppercase tracking-wide rounded"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 11,
            backgroundColor: 'var(--tq-accent)',
            color: '#ffffff',
            padding: '4px 10px',
            borderRadius: 6,
          }}
        >
          CONFIRM
        </button>
      </div>
    </div>
  );
}
