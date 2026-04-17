import React from 'react';

/**
 * Mode selection screen: video walkthrough vs photo upload.
 * Two cards, one tap. No other UI.
 *
 * @param {object} props
 * @param {(mode: 'video' | 'photos') => void} props.onSelectMode
 * @param {'video' | 'photos' | null} [props.defaultMode]
 */
export default function CaptureChoice({ onSelectMode, defaultMode = null }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '24px 0',
      maxWidth: '480px',
      margin: '0 auto',
    }}>
      <h3 style={{
        textAlign: 'center',
        margin: '0 0 8px',
        fontSize: '18px',
        fontWeight: 600,
        color: 'var(--text-primary, #1a1a1a)',
      }}>
        How would you like to capture this job?
      </h3>

      <button
        onClick={() => onSelectMode('video')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '20px 24px',
          minHeight: '80px',
          border: defaultMode === 'video'
            ? '2px solid var(--accent, #2563eb)'
            : '2px solid var(--border, #e0e0e0)',
          borderRadius: '12px',
          background: defaultMode === 'video'
            ? 'var(--accent-bg, #eff6ff)'
            : 'var(--card-bg, #fff)',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <span style={{ fontSize: '32px', lineHeight: 1, flexShrink: 0 }}>🎥</span>
        <div>
          <div style={{
            fontWeight: 600,
            fontSize: '16px',
            color: 'var(--text-primary, #1a1a1a)',
            marginBottom: '4px',
          }}>
            Walk me through it
          </div>
          <div style={{
            fontSize: '13px',
            color: 'var(--text-secondary, #666)',
          }}>
            Upload a video walkthrough of the wall
          </div>
        </div>
      </button>

      <button
        onClick={() => onSelectMode('photos')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '20px 24px',
          minHeight: '80px',
          border: defaultMode === 'photos'
            ? '2px solid var(--accent, #2563eb)'
            : '2px solid var(--border, #e0e0e0)',
          borderRadius: '12px',
          background: defaultMode === 'photos'
            ? 'var(--accent-bg, #eff6ff)'
            : 'var(--card-bg, #fff)',
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <span style={{ fontSize: '32px', lineHeight: 1, flexShrink: 0 }}>📸</span>
        <div>
          <div style={{
            fontWeight: 600,
            fontSize: '16px',
            color: 'var(--text-primary, #1a1a1a)',
            marginBottom: '4px',
          }}>
            Show me the photos
          </div>
          <div style={{
            fontSize: '13px',
            color: 'var(--text-secondary, #666)',
          }}>
            Upload photos of the wall from different angles
          </div>
        </div>
      </button>
    </div>
  );
}
