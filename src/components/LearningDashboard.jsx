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

  const { fieldBias = [], weeklyTrend = [], refCardImpact = [], userAccuracy = [] } = data || {};

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="page-title mb-1" style={{ fontSize: 28 }}>
        AI Learning Dashboard
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--tq-muted)' }}>
        How the AI's estimates compare to confirmed values. Use this data to update calibration notes in the system prompt.
      </p>

      {/* Weekly Accuracy Trend */}
      <Section title="Accuracy Trend (Last 12 Weeks)">
        {weeklyTrend.length === 0 ? (
          <EmptyState>No data yet. Generate and save quotes to build accuracy history.</EmptyState>
        ) : (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <Row header>
                <Th>Week</Th>
                <Th align="right">Avg Accuracy</Th>
                <Th align="right">Quotes</Th>
              </Row>
            </thead>
            <tbody>
              {weeklyTrend.map((row, i) => (
                <Row key={i}>
                  <Td>{new Date(row.week).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</Td>
                  <Td align="right">{(row.avgAccuracy * 100).toFixed(1)}%</Td>
                  <Td align="right">{row.quoteCount}</Td>
                </Row>
              ))}
            </tbody>
          </table>
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
