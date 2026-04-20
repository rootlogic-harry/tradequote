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

  // Confidence badge helper
  const confidenceBadge = confidence && confidence !== 'high' ? (
    <span
      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ml-1"
      style={{
        backgroundColor: confidence === 'low' ? '#dc2626' : '#d97706',
        color: '#ffffff',
        fontFamily: 'Barlow Condensed, sans-serif',
        fontWeight: 700,
      }}
    >
      {confidence}
    </span>
  ) : null;

  // Card-based layout (used for both mobile and desktop now)
  if (confirmed) {
    const wasEdited = measurement.value !== measurement.aiValue;
    return (
      <div className="rv-measure confirmed">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--tq-confirmed-txt)', fontSize: 12 }}>
            {item}
            {confidenceBadge}
          </span>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5"
            style={{
              backgroundColor: 'var(--tq-confirmed-bd)',
              color: '#ffffff',
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              borderRadius: 2,
            }}
          >
            {'\u2713'} CONFIRMED
          </span>
        </div>
        {/* Value display */}
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 500, color: 'var(--tq-text)' }}>
          {measurement.value}
        </div>
        {/* Footer */}
        <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--tq-confirmed-txt)', fontSize: 11 }}>
          <span>{wasEdited ? `Edited (was: ${measurement.aiValue})` : 'Accepted'}</span>
          <span>{'\u00B7'}</span>
          <button onClick={handleEdit} className="underline" style={{ color: 'var(--tq-confirmed-txt)', padding: '10px 16px', minHeight: 44 }}>Edit</button>
        </div>
      </div>
    );
  }

  // Unconfirmed card
  return (
    <div className="rv-measure">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--tq-unconf-txt)', fontSize: 12 }}>
          {item}
          {confidenceBadge}
        </span>
        <span
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5"
          style={{
            backgroundColor: 'var(--tq-unconf-bd)',
            color: '#ffffff',
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            borderRadius: 2,
          }}
        >
          {'\u26A0'} UNCONFIRMED
        </span>
      </div>
      {/* Input */}
      <input
        type="text"
        inputMode="text"
        enterKeyHint="done"
        autoComplete="off"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
        className="nq-field w-full"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 16,
          border: '1.5px solid var(--tq-unconf-bd)',
        }}
      />
      {confidence === 'low' && (
        <p className="text-xs mt-1" style={{ color: '#dc2626', fontSize: 11 }}>Verify on-site — low confidence estimate</p>
      )}
      {/* Confirm button */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs" style={{ color: 'var(--tq-muted)', fontSize: 11 }}>
          Suggested: {aiValue}
        </span>
        <button onClick={handleConfirm} className="btn-primary text-xs" style={{ minHeight: 44 }}>
          CONFIRM
        </button>
      </div>
    </div>
  );
}
