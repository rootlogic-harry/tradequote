import React, { useEffect, useState } from 'react';

/**
 * Admin Analytics dashboard (TRQ-175).
 *
 * Sole consumer of GET /api/admin/analytics. Renders:
 *   • Top-line spend + quote summary cards
 *   • Per-user table (last login, quotes, tokens, £ estimate)
 *   • Per-quote table (top 20 most-expensive)
 *   • Spend by model (pie/bar)
 *   • Daily token trend (sparkline)
 *   • Reliability — recent failures + retry queue depth
 *   • Portal — view rate, response rate
 *
 * Range selector: 24h / 7d / 30d / all (default 30d).
 *
 * Server caches for 60s so a refresh-happy admin doesn't hammer the
 * DB; the client doesn't need its own cache.
 *
 * Visibility: admin-only at the route layer (App.jsx gates currentView
 * === 'analytics' on isAdmin) AND the API endpoint is requireAdminPlan-
 * gated. Two layers of defence.
 */
export default function Analytics() {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?range=${encodeURIComponent(range)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `Analytics failed (${res.status})`;
          try { const j = await res.json(); msg = j.error || msg; } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="max-w-6xl mx-auto">
      <Header range={range} setRange={setRange} loading={loading} data={data} />
      {error && <ErrorBanner message={error} />}
      {!error && data && (
        <>
          <SummaryCards data={data} />
          <PerUserSection users={data.perUser} />
          <PerQuoteSection quotes={data.perQuote} />
          <SpendSection spend={data.spend} pricing={data.pricing} />
          <ReliabilitySection reliability={data.reliability} />
          <PortalSection portal={data.portal} />
        </>
      )}
      {!error && !data && loading && (
        <div className="text-center py-20" style={{ color: 'var(--tq-muted)' }}>
          Loading analytics…
        </div>
      )}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────

function Header({ range, setRange, loading, data }) {
  const ranges = [
    { key: '24h', label: '24 hours' },
    { key: '7d',  label: '7 days' },
    { key: '30d', label: '30 days' },
    { key: 'all', label: 'All time' },
  ];
  return (
    <div className="mb-6">
      <h1 className="page-title mb-1">Analytics</h1>
      <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
        {loading ? 'Refreshing…'
          : data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`
          : '\u00A0'}
      </p>
      <div className="flex gap-2 flex-wrap">
        {ranges.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`pill ${range === r.key ? 'active' : ''}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Summary cards ───────────────────────────────────────────────────

function SummaryCards({ data }) {
  const { users, quotes, spend, portal } = data;
  const cards = [
    {
      label: 'Total spend',
      value: '£' + (spend.totalGbp || 0).toFixed(2),
      sub: `${quotes.total || 0} quote${quotes.total === 1 ? '' : 's'}`,
    },
    {
      label: 'Quote value',
      value: '£' + Math.round(quotes.totalValueGbp || 0).toLocaleString(),
      sub: `avg £${Math.round(quotes.avgValueGbp || 0).toLocaleString()}`,
    },
    {
      label: 'Active users',
      value: String(users.total - users.dormantCount),
      sub: `${users.dormantCount} dormant 14d+`,
    },
    {
      label: 'Portal viewed',
      value: portal.tokensIssued > 0
        ? `${Math.round((portal.viewed / portal.tokensIssued) * 100)}%`
        : '—',
      sub: `${portal.viewed}/${portal.tokensIssued} tokens`,
    },
  ];
  return (
    <div className="stats-strip mb-6">
      {cards.map((c) => (
        <div className="stat-cell" key={c.label}>
          <div className="stat-label">{c.label}</div>
          <div className="stat-value">{c.value}</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--tq-nav-muted)' }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Per-user section ────────────────────────────────────────────────

function PerUserSection({ users }) {
  if (!users || users.length === 0) {
    return (
      <Section title="Per-user spend">
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>No user data in this range.</p>
      </Section>
    );
  }
  return (
    <Section title="Per-user spend">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--tq-border)', color: 'var(--tq-muted)' }}>
              <th className="text-left py-2 pr-3">User</th>
              <th className="text-left py-2 pr-3">Plan</th>
              <th className="text-left py-2 pr-3">Last login</th>
              <th className="text-right py-2 pr-3">Quotes</th>
              <th className="text-right py-2 pr-3">Quoted £</th>
              <th className="text-right py-2 pr-3">Analyse calls</th>
              <th className="text-right py-2 pr-3">Tokens</th>
              <th className="text-right py-2">Spend £</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId} className="border-b" style={{ borderColor: 'var(--tq-border-soft)' }}>
                <td className="py-2 pr-3 font-medium">{u.name || u.userId}</td>
                <td className="py-2 pr-3">{u.plan}</td>
                <td className="py-2 pr-3" style={{ color: 'var(--tq-muted)' }}>
                  {formatDateTime(u.lastLoginAt)}
                </td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{u.jobs}</td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  £{Math.round(u.quotedValue).toLocaleString()}
                </td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{u.analyseCalls}</td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatTokens(Number(u.promptTokens) + Number(u.completionTokens))}
                </td>
                <td className="py-2 text-right font-medium" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  £{u.estimatedCostGbp.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ─── Per-quote section ───────────────────────────────────────────────

function PerQuoteSection({ quotes }) {
  if (!quotes || quotes.length === 0) {
    return (
      <Section title="Top quotes by token spend">
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>No quotes have logged token spend yet.</p>
      </Section>
    );
  }
  return (
    <Section title="Top quotes by token spend">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--tq-border)', color: 'var(--tq-muted)' }}>
              <th className="text-left py-2 pr-3">Quote ref</th>
              <th className="text-left py-2 pr-3">Client</th>
              <th className="text-left py-2 pr-3">User</th>
              <th className="text-right py-2 pr-3">Calls</th>
              <th className="text-right py-2 pr-3">Tokens</th>
              <th className="text-right py-2">Spend £</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.jobId} className="border-b" style={{ borderColor: 'var(--tq-border-soft)' }}>
                <td className="py-2 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--tq-accent)' }}>
                  {q.quoteReference || q.jobId}
                </td>
                <td className="py-2 pr-3">{q.clientName || '—'}</td>
                <td className="py-2 pr-3" style={{ color: 'var(--tq-muted)' }}>{q.userId}</td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{q.calls}</td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {formatTokens(Number(q.promptTokens) + Number(q.completionTokens))}
                </td>
                <td className="py-2 text-right font-medium" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  £{q.estimatedCostGbp.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ─── Spend section ───────────────────────────────────────────────────

function SpendSection({ spend, pricing }) {
  const totalTokens = (spend.byModel || []).reduce(
    (sum, m) => sum + Number(m.promptTokens) + Number(m.completionTokens), 0
  );
  return (
    <Section title="Spend by model">
      {(!spend.byModel || spend.byModel.length === 0) && (
        <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>No model spend in this range.</p>
      )}
      {spend.byModel && spend.byModel.length > 0 && (
        <div className="space-y-2 mb-4">
          {spend.byModel.map((m) => {
            const tokens = Number(m.promptTokens) + Number(m.completionTokens);
            const pct = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
            return (
              <div key={m.model}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{m.model}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatTokens(tokens)} · £{m.estimatedCostGbp.toFixed(2)} · {m.calls} calls
                  </span>
                </div>
                <div style={{
                  height: 8, background: 'var(--tq-border-soft)',
                  borderRadius: 4, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: 'var(--tq-accent)',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DailySparkline trend={spend.dailyTrend || []} />
      {pricing && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--tq-muted)' }}>
          Prices last reviewed {pricing.pricesLastReviewed} · USD→GBP {pricing.usdToGbp}
        </p>
      )}
    </Section>
  );
}

function DailySparkline({ trend }) {
  if (!trend || trend.length === 0) return null;
  const points = trend.map((d) => ({
    x: new Date(d.date).getTime(),
    y: Number(d.promptTokens) + Number(d.completionTokens),
  }));
  const yMax = Math.max(...points.map((p) => p.y), 1);
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const xRange = xMax - xMin || 1;
  const w = 600, h = 60;
  const path = points.map((p, i) => {
    const x = ((p.x - xMin) / xRange) * w;
    const y = h - (p.y / yMax) * h;
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: 'var(--tq-muted)' }}>
        Daily token total — last 30 days
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 60 }}>
        <path d={path} fill="none" stroke="var(--tq-accent)" strokeWidth="2" />
      </svg>
    </div>
  );
}

// ─── Reliability section ─────────────────────────────────────────────

function ReliabilitySection({ reliability }) {
  const failures = reliability.recentFailures || [];
  return (
    <Section title="Reliability">
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4 mb-4">
        <MetricBlock label="Retry queue depth" value={reliability.retryQueueDepth || 0}
          sub={(reliability.retryQueueStuck || 0) + ' stuck (≥2 attempts)'} />
        <MetricBlock label="Recent failures" value={failures.length}
          sub={failures.length > 0 ? 'In selected range' : 'All clear'} />
      </div>
      {failures.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--tq-border)', color: 'var(--tq-muted)' }}>
                <th className="text-left py-2 pr-3">When</th>
                <th className="text-left py-2 pr-3">User</th>
                <th className="text-left py-2 pr-3">Agent</th>
                <th className="text-left py-2 pr-3">Model</th>
                <th className="text-left py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id} className="border-b" style={{ borderColor: 'var(--tq-border-soft)' }}>
                  <td className="py-1 pr-3" style={{ color: 'var(--tq-muted)' }}>
                    {formatDateTime(f.createdAt)}
                  </td>
                  <td className="py-1 pr-3">{f.userId || '—'}</td>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{f.agentType}</td>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--tq-muted)' }}>{f.model || '—'}</td>
                  <td className="py-1 truncate" style={{ maxWidth: 360, color: 'var(--tq-error-txt)' }}>
                    {f.error || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── Portal engagement ───────────────────────────────────────────────

function PortalSection({ portal }) {
  return (
    <Section title="Client portal engagement">
      <div className="grid grid-cols-2 fq:grid-cols-4 gap-4">
        <MetricBlock label="Tokens issued" value={portal.tokensIssued || 0} />
        <MetricBlock label="Viewed" value={portal.viewed || 0}
          sub={portal.tokensIssued > 0 ? `${Math.round(portal.viewRate * 100)}%` : '—'} />
        <MetricBlock label="Responded" value={portal.responded || 0}
          sub={portal.viewed > 0 ? `${Math.round(portal.responseRate * 100)}% of viewed` : '—'} />
        <MetricBlock label="Accepted / declined"
          value={`${portal.accepted || 0} / ${portal.declined || 0}`} />
      </div>
    </Section>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="mb-8 p-4" style={{
      background: 'var(--tq-card)',
      border: '1px solid var(--tq-border)',
      borderRadius: 4,
    }}>
      <div className="eyebrow mb-3">{title}</div>
      {children}
    </div>
  );
}

function MetricBlock({ label, value, sub }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--tq-muted)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>{sub}</div>}
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="p-3 mb-4 rounded text-sm" style={{
      background: 'var(--tq-error-bg)',
      border: '1px solid var(--tq-error-bd)',
      color: 'var(--tq-error-txt)',
    }}>
      {message}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function formatTokens(n) {
  if (!n || n < 1000) return String(n || 0);
  if (n < 1e6) return (n / 1e3).toFixed(1) + 'k';
  return (n / 1e6).toFixed(2) + 'M';
}
