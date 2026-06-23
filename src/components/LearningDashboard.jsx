import React, { useState, useEffect } from 'react';

export default function LearningDashboard({ currentUserId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/learning')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20" style={{ color: 'var(--tq-muted)' }}>
        Loading learning data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20" style={{ color: 'var(--tq-error-txt, #f87171)' }}>
        Failed to load learning data: {error}
      </div>
    );
  }

  const {
    fieldBias = [],
    weeklyTrend = [],
    weightedWeeklyTrend = [],
    weightedSummary = null,
    refCardImpact = [],
    userAccuracy = [],
    promptSize = null,
  } = data || {};

  // Merge edit-presence + weighted into one week-keyed table so both
  // metrics sit side-by-side and the trajectory is easy to compare.
  // Edit-presence is the canonical historical metric; weighted is the
  // 2026-06-22 follow-up.
  const weeklyByKey = new Map();
  for (const row of weeklyTrend) {
    const key = new Date(row.week).toISOString();
    weeklyByKey.set(key, { week: row.week, avgAccuracy: row.avgAccuracy, quoteCount: row.quoteCount });
  }
  for (const row of weightedWeeklyTrend) {
    const key = new Date(row.week).toISOString();
    const existing = weeklyByKey.get(key) || { week: row.week, avgAccuracy: null, quoteCount: row.count };
    existing.weightedMean = row.mean;
    existing.weightedP50 = row.p50;
    existing.weightedP90 = row.p90;
    weeklyByKey.set(key, existing);
  }
  const mergedWeekly = [...weeklyByKey.values()].sort(
    (a, b) => new Date(b.week) - new Date(a.week)
  );

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="page-title mb-1" style={{ fontSize: 28 }}>
        AI Learning Dashboard
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--tq-muted)' }}>
        How the AI's estimates compare to confirmed values. Use this data to update calibration notes in the system prompt.
      </p>

      {/* TRQ-176: prompt-length budget alarm — must render before any
          other section so admin sees the threshold breach immediately. */}
      {promptSize && promptSize.alarm && (
        <PromptBudgetAlarm
          avg20={promptSize.avg20}
          threshold={promptSize.threshold}
        />
      )}

      {/* TRQ-176: prompt-length budget telemetry */}
      <Section title="Prompt Size (Last 50 Quotes)">
        <PromptSizePanel promptSize={promptSize} />
      </Section>

      {/* Weighted accuracy headline — 2026-06-22 follow-up */}
      <Section title="Weighted Accuracy (Last 90 Days)">
        {!weightedSummary || weightedSummary.count === 0 ? (
          <EmptyState>No scoreable numeric fields in the last 90 days.</EmptyState>
        ) : (
          <div>
            <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
              % closeness — rewards near-misses. The unweighted metric below counts any edit as a full miss.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Mean"
                value={(weightedSummary.mean * 100).toFixed(1) + '%'}
              />
              <Stat
                label="Median (p50)"
                value={(weightedSummary.p50 * 100).toFixed(1) + '%'}
              />
              <Stat
                label="p90"
                value={(weightedSummary.p90 * 100).toFixed(1) + '%'}
              />
            </div>
            <p className="text-xs mt-3" style={{ color: 'var(--tq-muted)' }}>
              {weightedSummary.count} quote{weightedSummary.count === 1 ? '' : 's'} contributed.
            </p>
          </div>
        )}
      </Section>

      {/* Weekly Accuracy Trend — both metrics, side by side */}
      <Section title="Accuracy Trend (Last 12 Weeks)">
        {mergedWeekly.length === 0 ? (
          <EmptyState>No data yet. Generate and save quotes to build accuracy history.</EmptyState>
        ) : (
          <>
            <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
              Unweighted = % of numeric fields the tradesman did not edit. Weighted = % closeness per field, averaged.
            </p>
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <Row header>
                  <Th>Week</Th>
                  <Th align="right">Unweighted</Th>
                  <Th align="right">Weighted (mean)</Th>
                  <Th align="right">Weighted (p50)</Th>
                  <Th align="right">Quotes</Th>
                </Row>
              </thead>
              <tbody>
                {mergedWeekly.map((row, i) => (
                  <Row key={i}>
                    <Td>{new Date(row.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                    <Td align="right">{row.avgAccuracy != null ? (row.avgAccuracy * 100).toFixed(1) + '%' : '—'}</Td>
                    <Td align="right">{row.weightedMean != null ? (row.weightedMean * 100).toFixed(1) + '%' : '—'}</Td>
                    <Td align="right">{row.weightedP50 != null ? (row.weightedP50 * 100).toFixed(1) + '%' : '—'}</Td>
                    <Td align="right">{row.quoteCount ?? '—'}</Td>
                  </Row>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      {/* Field Bias */}
      <Section title="Field Bias Analysis">
        {fieldBias.length === 0 ? (
          <EmptyState>No field-level data yet.</EmptyState>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <Row header>
                <Th>Field</Th>
                <Th>Type</Th>
                <Th align="right">Samples</Th>
                <Th align="right">Edit Rate</Th>
                <Th align="right">Avg Bias</Th>
                <Th align="right">Avg Error</Th>
              </Row>
            </thead>
            <tbody>
              {fieldBias.map((row, i) => (
                <Row key={i}>
                  <Td>{row.field_label}</Td>
                  <Td><TypeBadge type={row.field_type} /></Td>
                  <Td align="right">{row.total}</Td>
                  <Td align="right">
                    <span style={{ color: row.editRatePct > 40 ? 'var(--tq-unconfirmed, #fbbf24)' : 'var(--tq-text)' }}>
                      {row.editRatePct}%
                    </span>
                  </Td>
                  <Td align="right">
                    <span style={{ color: row.avgBiasPct > 0 ? '#4ade80' : row.avgBiasPct < 0 ? '#f87171' : 'var(--tq-text)' }}>
                      {row.avgBiasPct > 0 ? '+' : ''}{row.avgBiasPct}%
                    </span>
                  </Td>
                  <Td align="right">{row.avgErrorPct}%</Td>
                </Row>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Reference Card Impact */}
      <Section title="Reference Card Impact">
        {refCardImpact.length === 0 ? (
          <EmptyState>No measurement data yet.</EmptyState>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <Row header>
                <Th>Reference Card</Th>
                <Th align="right">Edit Rate</Th>
                <Th align="right">Samples</Th>
              </Row>
            </thead>
            <tbody>
              {refCardImpact.map((row, i) => (
                <Row key={i}>
                  <Td>{row.referenceCardUsed === true ? 'With card' : row.referenceCardUsed === false ? 'Without card' : 'Unknown'}</Td>
                  <Td align="right">{row.editRatePct}%</Td>
                  <Td align="right">{row.total}</Td>
                </Row>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Per-User Accuracy */}
      <Section title="Per-User Accuracy">
        {userAccuracy.length === 0 ? (
          <EmptyState>No per-user data yet.</EmptyState>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <Row header>
                <Th>User</Th>
                <Th align="right">Avg Accuracy</Th>
                <Th align="right">Quotes</Th>
                <Th align="right">Status</Th>
              </Row>
            </thead>
            <tbody>
              {userAccuracy.map((row, i) => (
                <Row key={i}>
                  <Td>{row.userId}</Td>
                  <Td align="right">{(row.avgAccuracy * 100).toFixed(1)}%</Td>
                  <Td align="right">{row.quoteCount}</Td>
                  <Td align="right">
                    {row.isOutlier ? (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--tq-error-bg, #7f1d1d)', color: 'var(--tq-error-txt, #f87171)' }}>Outlier</span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>Normal</span>
                    )}
                  </Td>
                </Row>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Prompt Update Guidance */}
      <Section title="Prompt Update Guidance">
        <PromptGuidance fieldBias={fieldBias} refCardImpact={refCardImpact} />
      </Section>
    </div>
  );
}

// --- Sub-components ---

function Section({ title, children }) {
  return (
    <div
      className="mb-6"
      style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', padding: '20px', borderRadius: 2 }}
    >
      <h3
        className="mb-4"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--tq-text)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="text-sm py-4 text-center" style={{ color: 'var(--tq-muted)' }}>{children}</p>;
}

function Stat({ label, value }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--tq-surface)',
        border: '1px solid var(--tq-border)',
        padding: '12px',
        borderRadius: 2,
      }}
    >
      <div
        className="text-xs uppercase tracking-wide mb-1"
        style={{ color: 'var(--tq-muted)', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 22,
          color: 'var(--tq-text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ header, children }) {
  return (
    <tr style={{ borderBottom: header ? '2px solid var(--tq-border)' : '1px solid var(--tq-border)' }}>
      {children}
    </tr>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      className="py-2 px-3 font-heading font-bold uppercase tracking-wide text-xs"
      style={{ textAlign: align, color: 'var(--tq-muted)' }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left' }) {
  return (
    <td className="py-2 px-3" style={{ textAlign: align, color: 'var(--tq-text)' }}>
      {children}
    </td>
  );
}

function TypeBadge({ type }) {
  const labels = {
    measurement: 'Measurement',
    material_unit_cost: 'Material Cost',
    labour_days: 'Labour Days',
  };
  return (
    <span
      className="text-xs px-2 py-0.5 rounded"
      style={{ backgroundColor: 'var(--tq-surface)', color: 'var(--tq-muted)', border: '1px solid var(--tq-border)' }}
    >
      {labels[type] || type}
    </span>
  );
}

// TRQ-176: prompt-length budget alarm. Banner-style warning shown only
// when avg-of-last-20 jobs exceeds the threshold. Admin-only — mounted
// inside LearningDashboard which is gated by isAdmin in App.jsx.
// Copy uses "calibration corpus" (admin-only vocabulary).
function PromptBudgetAlarm({ avg20, threshold }) {
  return (
    <div
      role="alert"
      className="mb-6"
      style={{
        backgroundColor: 'var(--tq-error-bg, #7f1d1d)',
        color: 'var(--tq-error-txt, #fecaca)',
        border: '1px solid #f87171',
        padding: '14px 18px',
        borderRadius: 2,
      }}
    >
      <div
        className="text-xs uppercase tracking-wide mb-1"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}
      >
        Prompt Budget Warning
      </div>
      <div className="text-sm">
        Average prompt size over the last 20 quotes is{' '}
        <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {avg20.toLocaleString()} chars
        </strong>{' '}
        — over the{' '}
        <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {threshold.toLocaleString()}
        </strong>{' '}
        threshold. Calibration corpus is growing — consider pruning notes.
      </div>
    </div>
  );
}

// TRQ-176: prompt size sparkline + current value. Renders the last 50
// jobs' prompt_chars as an inline SVG sparkline plus the current and
// avg-of-last-20 stats. No external chart library — keeps the bundle
// lean and the assertion surface stable.
function PromptSizePanel({ promptSize }) {
  if (!promptSize || promptSize.current == null || !Array.isArray(promptSize.history) || promptSize.history.length === 0) {
    return <EmptyState>No prompt-size data yet. Save a quote to populate.</EmptyState>;
  }
  // History is newest-first from the server; reverse for left→right time order.
  const points = [...promptSize.history].reverse().map(h => h.promptChars);
  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
        Character count of the system prompt + appended calibration notes, stamped at save time.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Current" value={promptSize.current.toLocaleString()} />
        <Stat
          label="Avg (Last 20)"
          value={promptSize.avg20 != null ? promptSize.avg20.toLocaleString() : '—'}
        />
        <Stat label="Threshold" value={promptSize.threshold.toLocaleString()} />
      </div>
      <Sparkline values={points} threshold={promptSize.threshold} />
      <p className="text-xs mt-2" style={{ color: 'var(--tq-muted)' }}>
        {promptSize.history.length} quote{promptSize.history.length === 1 ? '' : 's'} plotted (newest right).
      </p>
    </div>
  );
}

// Inline SVG sparkline — no chart library. Width is fluid via viewBox.
function Sparkline({ values, threshold }) {
  const w = 600;
  const h = 80;
  const pad = 4;
  const min = Math.min(...values, threshold);
  const max = Math.max(...values, threshold);
  const range = Math.max(1, max - min);
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const yFor = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${yFor(v)}`)
    .join(' ');
  const thresholdY = yFor(threshold);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Prompt size sparkline"
      style={{ width: '100%', height: 80, display: 'block' }}
    >
      <line
        x1={pad}
        x2={w - pad}
        y1={thresholdY}
        y2={thresholdY}
        stroke="#f87171"
        strokeDasharray="4 4"
        strokeWidth="1"
      />
      <path d={path} fill="none" stroke="var(--tq-text)" strokeWidth="1.5" />
    </svg>
  );
}

function PromptGuidance({ fieldBias, refCardImpact }) {
  const highEditFields = fieldBias.filter(f => f.editRatePct > 40);
  const withCard = refCardImpact.find(r => r.referenceCardUsed === true);
  const withoutCard = refCardImpact.find(r => r.referenceCardUsed === false);
  const totalSamples = fieldBias.reduce((sum, f) => sum + f.total, 0);

  if (totalSamples === 0) {
    return <EmptyState>Generate more quotes to see prompt calibration suggestions.</EmptyState>;
  }

  return (
    <div className="text-sm" style={{ color: 'var(--tq-text)', fontFamily: 'JetBrains Mono, monospace', fontSize: 13 }}>
      <p className="mb-3" style={{ color: 'var(--tq-muted)' }}>
        Based on {totalSamples} field comparisons:
      </p>
      {highEditFields.length === 0 ? (
        <p style={{ color: 'var(--tq-confirmed, #4ade80)' }}>
          No fields with edit rate above 40%. AI estimates are well-calibrated.
        </p>
      ) : (
        <ul className="space-y-2">
          {highEditFields.map((f, i) => (
            <li key={i}>
              <strong>{f.field_label}</strong>: AI {f.avgBiasPct > 0 ? 'underestimates' : 'overestimates'} by avg {Math.abs(f.avgBiasPct)}%.
              {' '}Edit rate: {f.editRatePct}% ({f.total} samples).
            </li>
          ))}
        </ul>
      )}
      {withCard && withoutCard && (
        <p className="mt-3">
          Reference card: measurements without card have {(withoutCard.editRatePct / (withCard.editRatePct || 1)).toFixed(1)}x higher edit rate
          ({withoutCard.editRatePct}% vs {withCard.editRatePct}%).
        </p>
      )}
    </div>
  );
}
