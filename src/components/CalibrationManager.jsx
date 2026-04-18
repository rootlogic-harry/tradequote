import React, { useState, useEffect, useCallback } from 'react';

export default function CalibrationManager() {
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState('proposed');
  const [loading, setLoading] = useState(false);
  const [runningCalibration, setRunningCalibration] = useState(false);
  const [lastRunResult, setLastRunResult] = useState(null);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/calibration-notes?status=${filter}`);
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch calibration notes:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleAction = async (noteId, status) => {
    try {
      const res = await fetch(`/api/admin/calibration-notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        fetchNotes();
      }
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  };

  const handleRunCalibration = async () => {
    setRunningCalibration(true);
    setLastRunResult(null);
    try {
      const res = await fetch('/api/admin/calibration/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setLastRunResult(data);
      fetchNotes(); // Refresh to show new proposals
    } catch (err) {
      setLastRunResult({ error: err.message });
    } finally {
      setRunningCalibration(false);
    }
  };

  const severityColor = (evidence) => {
    const editRate = evidence?.editRate || evidence?.edit_rate || 0;
    if (editRate > 70) return 'var(--tq-error-bd)';
    if (editRate > 50) return 'var(--tq-accent)';
    return 'var(--tq-muted)';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-heading font-bold" style={{ color: 'var(--tq-text)' }}>
            Calibration Manager
          </h2>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            Review and approve proposed calibration notes for the system prompt.
          </p>
        </div>
        <button
          onClick={handleRunCalibration}
          disabled={runningCalibration}
          className="font-heading font-bold uppercase tracking-wide px-5 py-2.5 rounded text-sm"
          style={{
            backgroundColor: runningCalibration ? 'var(--tq-surface)' : 'var(--tq-accent)',
            color: runningCalibration ? 'var(--tq-muted)' : '#ffffff',
            cursor: runningCalibration ? 'not-allowed' : 'pointer',
          }}
        >
          {runningCalibration ? 'RUNNING...' : 'RUN CALIBRATION'}
        </button>
      </div>

      {lastRunResult && (
        <div
          className="rounded p-4 mb-4"
          style={{
            backgroundColor: lastRunResult.error ? 'var(--tq-error-bg)' : 'var(--tq-confirmed-bg)',
            border: `1.5px solid ${lastRunResult.error ? 'var(--tq-error-bd)' : 'var(--tq-confirmed-bd)'}`,
          }}
        >
          {lastRunResult.error ? (
            <p style={{ color: 'var(--tq-error-txt)', fontSize: 13 }}>Error: {lastRunResult.error}</p>
          ) : (
            <p style={{ color: 'var(--tq-confirmed-txt)', fontSize: 13 }}>
              Calibration complete — {lastRunResult.proposals?.proposed?.length || 0} new proposals.
              {lastRunResult.proposals?.summary && ` ${lastRunResult.proposals.summary}`}
            </p>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {['proposed', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="px-3 py-1.5 rounded text-xs uppercase tracking-wide"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 700,
              backgroundColor: filter === s ? 'var(--tq-accent)' : 'var(--tq-surface)',
              color: filter === s ? '#ffffff' : 'var(--tq-muted)',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>Loading...</p>
      ) : notes.length === 0 ? (
        <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>No {filter} calibration notes.</p>
      ) : (
        <div className="space-y-3">
          {notes.map(note => (
            <div
              key={note.id}
              className="rounded p-4"
              style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)' }}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mr-2"
                    style={{
                      fontFamily: 'Barlow Condensed, sans-serif',
                      fontWeight: 700,
                      backgroundColor: 'var(--tq-surface)',
                      color: severityColor(note.evidence),
                    }}
                  >
                    {note.field_type}/{note.field_label}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>
                    {new Date(note.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {filter === 'proposed' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(note.id, 'approved')}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        backgroundColor: 'var(--tq-confirmed-bg)',
                        color: 'var(--tq-confirmed-txt)',
                        border: '1px solid var(--tq-confirmed-bd)',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(note.id, 'rejected')}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        backgroundColor: 'var(--tq-error-bg)',
                        color: 'var(--tq-error-txt)',
                        border: '1px solid var(--tq-error-bd)',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {filter === 'approved' && note.approved_by_name && (
                  <span className="text-xs" style={{ color: 'var(--tq-confirmed-txt)' }}>
                    Approved by {note.approved_by_name}
                  </span>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--tq-text)', lineHeight: 1.5 }}>
                {note.note}
              </p>
              {note.evidence && (
                <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--tq-muted)' }}>
                  {note.evidence.sampleSize != null && <span>Samples: {note.evidence.sampleSize}</span>}
                  {note.evidence.avgBias != null && <span>Avg bias: {note.evidence.avgBias}%</span>}
                  {note.evidence.editRate != null && <span>Edit rate: {note.evidence.editRate}%</span>}
                  {note.evidence.direction && <span>Direction: {note.evidence.direction}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
