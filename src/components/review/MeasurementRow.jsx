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
            {confidenceBadge}
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
          <span>{wasEdited ? `Edited (was: ${measurement.aiValue})` : 'Accepted'}</span>
          <span>·</span>
          <button onClick={handleEdit} className="underline" style={{ color: 'var(--tq-confirmed-txt)', padding: '10px 16px', minHeight: 44 }}>Edit</button>
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
          {confidenceBadge}
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
        type="text"
        inputMode="text"
        enterKeyHint="done"
        autoComplete="off"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
        className="w-full rounded px-2 py-1.5 focus:outline-none"
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 16,
          border: '1.5px solid var(--tq-unconf-bd)',
          borderRadius: 6,
          backgroundColor: 'var(--tq-card)',
          color: 'var(--tq-text)',
          minHeight: 44,
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
        <button
          onClick={handleConfirm}
          className="uppercase tracking-wide rounded"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            backgroundColor: 'var(--tq-accent)',
            color: '#ffffff',
            padding: '10px 16px',
            borderRadius: 6,
            minHeight: 44,
          }}
        >
          CONFIRM
        </button>
      </div>
    </div>
  );
}
