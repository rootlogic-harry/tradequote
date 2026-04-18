import React, { useState, useEffect, useCallback } from 'react';
import CalibrationManager from './CalibrationManager.jsx';

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ status }) {
  const styles = {
    running: { bg: 'var(--tq-accent-bg)', bd: 'var(--tq-accent-bd)', color: 'var(--tq-accent)' },
    completed: { bg: 'var(--tq-confirmed-bg)', bd: 'var(--tq-confirmed-bd)', color: 'var(--tq-confirmed-txt)' },
    failed: { bg: 'var(--tq-error-bg)', bd: 'var(--tq-error-bd)', color: 'var(--tq-error-txt)' },
  };
  const s = styles[status] || styles.running;
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{
        fontFamily: 'Barlow Condensed, sans-serif',
        fontWeight: 700,
        backgroundColor: s.bg,
        border: `1px solid ${s.bd}`,
        color: s.color,
      }}
    >
      {status}
    </span>
  );
}

function AgentTypeBadge({ type }) {
  const labels = {
    self_critique: 'Critique',
    feedback: 'Feedback',
    calibration: 'Calibration',
  };
  return (
    <span
      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{
        fontFamily: 'Barlow Condensed, sans-serif',
        fontWeight: 700,
        backgroundColor: 'var(--tq-surface)',
        color: 'var(--tq-text)',
      }}
    >
      {labels[type] || type}
    </span>
  );
}

export default function AgentActivity() {
  const [runs, setRuns] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedRun, setExpandedRun] = useState(null);
  const [activeTab, setActiveTab] = useState('runs'); // 'runs' | 'calibration' | 'feedback'

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (typeFilter) params.set('type', typeFilter);
      const res = await fetch(`/api/admin/agent-runs?${params}`);
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    if (activeTab === 'runs' || activeTab === 'feedback') {
      fetchRuns();
    }
  }, [fetchRuns, activeTab]);

  const feedbackRuns = runs.filter(r => r.agent_type === 'feedback' && r.status === 'completed');

  if (activeTab === 'calibration') {
    return (
      <div>
        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
        <CalibrationManager />
      </div>
    );
  }

  if (activeTab === 'feedback') {
    return (
      <div>
        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
        <h2 className="text-2xl font-heading font-bold mb-1" style={{ color: 'var(--tq-text)' }}>
          Feedback Lessons
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--tq-muted)' }}>
          Lessons learned from completed jobs with feedback.
        </p>
        {loading ? (
          <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>Loading...</p>
        ) : feedbackRuns.length === 0 ? (
          <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>No feedback lessons yet. Complete jobs with feedback to generate lessons.</p>
        ) : (
          <div className="space-y-3">
            {feedbackRuns.map(run => {
              const output = run.output_summary;
              const severity = output?.severity || 'low';
              const severityColors = {
                high: 'var(--tq-error-bd)',
                medium: 'var(--tq-accent)',
                low: 'var(--tq-confirmed-bd)',
              };
              return (
                <div
                  key={run.id}
                  className="p-4"
                  style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: severityColors[severity] }}
                    />
                    <span className="text-xs uppercase tracking-wide" style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: severityColors[severity] }}>
                      {severity} severity
                    </span>
                    <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>
                      {new Date(run.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {run.input_summary?.feedback && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--tq-surface)', color: 'var(--tq-text)' }}>
                        {run.input_summary.feedback}
                      </span>
                    )}
                  </div>
                  <p className="text-sm mb-2" style={{ color: 'var(--tq-text)' }}>
                    {output?.overallAssessment || 'No assessment available.'}
                  </p>
                  {output?.likelyIssues?.length > 0 && (
                    <ul className="text-xs space-y-1" style={{ color: 'var(--tq-muted)' }}>
                      {output.likelyIssues.map((issue, i) => (
                        <li key={i}>
                          <span style={{ fontWeight: 600, color: 'var(--tq-text)' }}>[{issue.category}]</span> {issue.description}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Default: Recent Runs tab
  return (
    <div>
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="page-title" style={{ fontSize: 28 }}>
            Agent Activity
          </h2>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            All agent runs, outputs, and performance.
          </p>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-2 mb-4">
        {[
          { value: '', label: 'All' },
          { value: 'self_critique', label: 'Critique' },
          { value: 'feedback', label: 'Feedback' },
          { value: 'calibration', label: 'Calibration' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`pill ${typeFilter === f.value ? 'active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>Loading...</p>
      ) : runs.length === 0 ? (
        <p style={{ color: 'var(--tq-muted)', fontSize: 14 }}>No agent runs yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <div
              key={run.id}
              className="overflow-hidden"
              style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}
            >
              <button
                onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <AgentTypeBadge type={run.agent_type} />
                <StatusBadge status={run.status} />
                <span className="text-xs flex-1" style={{ color: 'var(--tq-muted)' }}>
                  {run.job_id ? `Job: ${run.job_id.slice(0, 12)}...` : 'No job'}
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--tq-muted)' }}>
                  {formatDuration(run.duration_ms)}
                </span>
                <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>
                  {new Date(run.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: 'var(--tq-muted)', fontSize: 12 }}>
                  {expandedRun === run.id ? '▲' : '▼'}
                </span>
              </button>

              {expandedRun === run.id && (
                <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--tq-border)' }}>
                  <div className="grid grid-cols-2 gap-4 py-3 text-xs">
                    <div>
                      <span style={{ color: 'var(--tq-muted)' }}>Model: </span>
                      <span style={{ color: 'var(--tq-text)' }}>{run.model || '-'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--tq-muted)' }}>Tokens: </span>
                      <span style={{ color: 'var(--tq-text)' }}>
                        {run.prompt_tokens != null ? `${run.prompt_tokens} in / ${run.completion_tokens} out` : '-'}
                      </span>
                    </div>
                  </div>
                  {run.error && (
                    <div className="rounded p-3 mb-3" style={{ backgroundColor: 'var(--tq-error-bg)', border: '1px solid var(--tq-error-bd)' }}>
                      <p className="text-xs" style={{ color: 'var(--tq-error-txt)' }}>Error: {run.error}</p>
                    </div>
                  )}
                  {run.input_summary && (
                    <div className="mb-3">
                      <h4 className="text-xs uppercase tracking-wide mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-muted)' }}>
                        Input
                      </h4>
                      <pre className="text-xs rounded p-2 overflow-x-auto" style={{ backgroundColor: 'var(--tq-surface)', color: 'var(--tq-text)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {JSON.stringify(run.input_summary, null, 2)}
                      </pre>
                    </div>
                  )}
                  {run.output_summary && (
                    <div>
                      <h4 className="text-xs uppercase tracking-wide mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, color: 'var(--tq-muted)' }}>
                        Output
                      </h4>
                      <pre className="text-xs rounded p-2 overflow-x-auto max-h-64" style={{ backgroundColor: 'var(--tq-surface)', color: 'var(--tq-text)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {JSON.stringify(run.output_summary, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { key: 'runs', label: 'Recent Runs' },
    { key: 'feedback', label: 'Feedback Lessons' },
    { key: 'calibration', label: 'Calibration' },
  ];
  return (
    <div className="flex gap-1 mb-6 p-1" style={{ backgroundColor: 'var(--tq-surface)', borderRadius: 2 }}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => setActiveTab(t.key)}
          className="flex-1 py-2 rounded text-xs uppercase tracking-wide transition-colors"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 700,
            backgroundColor: activeTab === t.key ? 'var(--tq-card)' : 'transparent',
            color: activeTab === t.key ? 'var(--tq-text)' : 'var(--tq-muted)',
            ...(activeTab === t.key ? { boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } : {}),
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
