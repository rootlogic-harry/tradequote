import React, { useState, useEffect } from 'react';
import { buildDiff } from '../../utils/diffTracking.js';

export default function MeasurementRow({ measurement, dispatch, variant = 'row' }) {
  const [editValue, setEditValue] = useState(measurement.value);
  const { id, item, aiValue, confirmed, confidence } = measurement;

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

  // ─── Confirmed: collapses to a single clean line ─────────────────────────
  if (confirmed) {
    return (
      <div style={{
        background: 'var(--tq-confirmed-bg, #f0faf4)',
        border: '1.5px solid var(--tq-confirmed-bd, #6dbf8a)',
        borderRadius: 10,
        marginBottom: 8,
      }}>
        <div style={{
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span
            aria-hidden
            style={{ color: 'var(--tq-confirmed-txt, #1a6b35)', fontSize: 16, flexShrink: 0 }}
          >
            {'\u2713'}
          </span>
          <div style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 500,
            color: 'var(--tq-confirmed-txt, #1a6b35)',
            minWidth: 0,
          }}>
            {item}
          </div>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--tq-text, #1a1714)',
            flexShrink: 0,
          }}>
            {measurement.value}
          </div>
          <button
            onClick={handleEdit}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--tq-confirmed-txt, #1a6b35)',
              textDecoration: 'underline',
              flexShrink: 0,
              padding: '10px 4px',
              minHeight: 44,
            }}
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  // ─── Unconfirmed: three zones (label+badges / input+button / suggested) ──
  const isLow = confidence === 'low';
  const palette = isLow
    ? {
        bg: 'var(--tq-error-bg, #fef0f0)',
        border: 'var(--tq-error-bd, #f09090)',
        text: 'var(--tq-error-txt, #a02020)',
        button: '#c04040',
      }
    : {
        bg: 'var(--tq-unconf-bg, #fef8ee)',
        border: 'var(--tq-unconf-bd, #e8c870)',
        text: 'var(--tq-unconf-txt, #a06010)',
        button: 'var(--tq-accent, #c07e12)',
      };

  const confidenceLabel = (confidence || 'medium').toUpperCase();

  return (
    <div style={{
      background: palette.bg,
      border: `1.5px solid ${palette.border}`,
      borderRadius: 10,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px' }}>

        {/* Zone 1: label + badges */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--tq-text, #1a1714)',
            lineHeight: 1.35,
            flex: 1,
            minWidth: 0,
          }}>
            {item}
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.04em',
              fontFamily: 'Barlow Condensed, sans-serif',
              background: palette.bg,
              color: palette.text,
              border: `1px solid ${palette.border}`,
              whiteSpace: 'nowrap',
            }}>
              {confidenceLabel}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              letterSpacing: '0.04em',
              fontFamily: 'Barlow Condensed, sans-serif',
              background: palette.bg,
              color: palette.text,
              border: `1px solid ${palette.border}`,
              whiteSpace: 'nowrap',
            }}>
              UNCONFIRMED
            </span>
          </div>
        </div>

        {/* Zone 2: input + button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="text"
            inputMode="text"
            enterKeyHint="done"
            autoComplete="off"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            style={{
              flex: 1,
              padding: '9px 12px',
              border: `1.5px solid ${palette.border}`,
              borderRadius: 7,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--tq-text, #1a1714)',
              background: 'var(--tq-card, #ffffff)',
              minWidth: 0,
              outline: 'none',
            }}
          />
          <button
            onClick={handleConfirm}
            style={{
              background: palette.button,
              color: '#ffffff',
              border: 'none',
              borderRadius: 7,
              padding: '9px 16px',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'Barlow Condensed, sans-serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              minHeight: 44,
            }}
          >
            CONFIRM
          </button>
        </div>

        {/* Zone 3: suggested value OR low-confidence warning */}
        {isLow ? (
          <div style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--tq-error-txt, #a02020)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            padding: '6px 8px',
            background: 'rgba(240,144,144,0.12)',
            borderRadius: 5,
          }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              style={{ flexShrink: 0, marginTop: 1 }}
              aria-hidden
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
            </svg>
            <span>
              Low confidence {'\u2014'} verify on site before issuing this quote. Suggested:{' '}
              <strong>{aiValue}</strong>
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--tq-muted, #7a6f5e)' }}>
            Suggested:{' '}
            <span style={{ color: palette.text, fontWeight: 500 }}>{aiValue}</span>
          </div>
        )}

      </div>
    </div>
  );
}
