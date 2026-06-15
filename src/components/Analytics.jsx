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
          <RetentionSection retention={data.retention} />
          <ActivitySection series={data.series} />
          <PerUserSection users={data.perUser} />
          <PerQuoteSection quotes={data.perQuote} />
          <SpendSection spend={data.spend} pricing={data.pricing} />
          <PageviewsSection pageviews={data.pageviews} series={data.series} />
          <ErrorsSection errors={data.errors} />
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
              <th className="text-right py-2 pr-3">RAMS</th>
              <th className="text-right py-2 pr-3">Active days</th>
              <th className="text-right py-2 pr-3">Fails</th>
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
                  {u.ramsCount || 0}
                </td>
                <td className="py-2 pr-3 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {u.activeDays || 0}
                </td>
                <td className="py-2 pr-3 text-right" style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  color: (u.failedAnalyseCalls || 0) > 0 ? 'var(--tq-error-txt)' : 'inherit',
                }}>
                  {u.failedAnalyseCalls || 0}
                </td>
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
  const series = trend.map((d) => ({
    date: d.date,
    value: Number(d.promptTokens) + Number(d.completionTokens),
  }));
  return <TimeSeriesSparkline series={series} label="Daily token total — last 30 days" />;
}

/**
 * TRQ-15: generic time-series sparkline. Takes an array of
 * `{ date, value }` objects and renders a single-line SVG path.
 * No external dependencies — same pattern as the original
 * DailySparkline above, just decoupled from the spend payload shape
 * so any new metric can reuse it.
 *
 * `bars` mode draws thin filled bars instead of a path — better for
 * weekly counts where the gaps between data points matter and a
 * line interpolation would lie about days with zero activity.
 */
function TimeSeriesSparkline({
  series, label, color = 'var(--tq-accent)', bars = false, height = 60,
}) {
  if (!series || series.length === 0) {
    return (
      <div className="text-xs" style={{ color: 'var(--tq-muted)' }}>
        {label} — no data
      </div>
    );
  }
  // Single-point series is valid input but produces a 1px dot, not a
  // line — render the headline number instead so the user sees
  // something useful.
  if (series.length === 1) {
    return (
      <div className="flex items-baseline gap-3">
        <div className="text-xs" style={{ color: 'var(--tq-muted)' }}>{label}:</div>
        <div className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {series[0].value}
        </div>
      </div>
    );
  }
  const points = series.map((d) => ({
    x: new Date(d.date).getTime(),
    y: Number(d.value) || 0,
  }));
  const yMax = Math.max(...points.map((p) => p.y), 1);
  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const xRange = xMax - xMin || 1;
  const w = 600, h = height;
  let body;
  if (bars) {
    const barWidth = Math.max(2, (w / points.length) - 4);
    body = points.map((p, i) => {
      const x = ((p.x - xMin) / xRange) * (w - barWidth);
      const barH = (p.y / yMax) * h;
      const y = h - barH;
      return (
        <rect key={i} x={x} y={y} width={barWidth} height={barH} fill={color} />
      );
    });
  } else {
    const path = points.map((p, i) => {
      const x = ((p.x - xMin) / xRange) * w;
      const y = h - (p.y / yMax) * h;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    body = <path d={path} fill="none" stroke={color} strokeWidth="2" />;
  }
  return (
    <div>
      <div className="flex justify-between items-baseline text-xs mb-1" style={{ color: 'var(--tq-muted)' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>peak {yMax}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {body}
      </svg>
    </div>
  );
}

// ─── TRQ-15: Retention section ───────────────────────────────────────

function RetentionSection({ retention }) {
  if (!retention) return null;
  return (
    <Section title="Retention">
      <div className="grid grid-cols-2 fq:grid-cols-4 gap-4">
        <MetricBlock
          label="New signups (30d)"
          value={retention.newSignups30d || 0}
          sub={`${retention.convertedIn7d || 0} saved a quote in week 1`}
        />
        <MetricBlock
          label="Conversion rate"
          value={retention.newSignups30d > 0
            ? `${Math.round(retention.conversionRate * 100)}%`
            : '—'}
          sub="signup → first quote in 7d"
        />
        <MetricBlock
          label="D7 active"
          value={retention.eligibleUsers > 0
            ? `${Math.round(retention.d7Rate * 100)}%`
            : '—'}
          sub={`${retention.d7Active || 0} / ${retention.eligibleUsers || 0} eligible`}
        />
        <MetricBlock
          label="D14 active"
          value={retention.eligibleUsers > 0
            ? `${Math.round(retention.d14Rate * 100)}%`
            : '—'}
          sub={`${retention.d14Active || 0} / ${retention.eligibleUsers || 0} eligible`}
        />
      </div>
      <p className="text-[11px] mt-3" style={{ color: 'var(--tq-muted)' }}>
        D7 / D14 measure: of users who signed up ≥ 7 days ago, what fraction saved a quote in the last 7 / 14 days.
      </p>
    </Section>
  );
}

// ─── TRQ-15: Activity charts ─────────────────────────────────────────

function ActivitySection({ series }) {
  if (!series) return null;
  return (
    <Section title="Activity over time">
      <div className="space-y-4">
        <TimeSeriesSparkline
          series={(series.quotesPerWeek || []).map((r) => ({ date: r.week, value: r.count }))}
          label="Quotes saved per week — last 12 weeks"
          bars
        />
        <TimeSeriesSparkline
          series={(series.signupsPerDay || []).map((r) => ({ date: r.date, value: r.count }))}
          label="Signups per day — last 30 days"
          bars
        />
        <TimeSeriesSparkline
          series={(series.failuresPerDay || []).map((r) => ({ date: r.date, value: r.count }))}
          label="Failures per day — last 30 days"
          color="var(--tq-error-txt)"
          bars
        />
      </div>
    </Section>
  );
}

// ─── TRQ-15: Landing / SPA pageviews ─────────────────────────────────

function PageviewsSection({ pageviews, series }) {
  if (!pageviews) return null;
  return (
    <Section title="Page views (30d)">
      <div className="grid grid-cols-2 fq:grid-cols-3 gap-4 mb-4">
        <MetricBlock
          label="Total views"
          value={(pageviews.total30d || 0).toLocaleString()}
          sub={`${pageviews.sessions30d || 0} unique sessions`}
        />
        <MetricBlock
          label="Avg / day"
          value={Math.round((pageviews.total30d || 0) / 30)}
        />
        <MetricBlock
          label="Top path"
          value={pageviews.topPaths?.[0]?.path || '—'}
          sub={pageviews.topPaths?.[0] ? `${pageviews.topPaths[0].count} hits` : ''}
        />
      </div>
      <TimeSeriesSparkline
        series={(series?.pageviewsPerDay || []).map((r) => ({ date: r.date, value: r.count }))}
        label="Daily views"
      />
      {pageviews.topPaths && pageviews.topPaths.length > 0 && (
        <div className="mt-4">
          <div className="text-xs mb-2" style={{ color: 'var(--tq-muted)' }}>
            Top paths
          </div>
          <table className="w-full text-xs">
            <tbody>
              {pageviews.topPaths.map((p) => (
                <tr key={p.path} className="border-b" style={{ borderColor: 'var(--tq-border-soft)' }}>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.path}</td>
                  <td className="py-1 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─── TRQ-15: System errors ───────────────────────────────────────────

function ErrorsSection({ errors }) {
  const [sourceFilter, setSourceFilter] = useState('all');
  if (!errors) return null;
  const recent = errors.recent || [];
  const sources = Array.from(new Set(recent.map((r) => r.source)));
  const filtered = sourceFilter === 'all'
    ? recent
    : recent.filter((r) => r.source === sourceFilter);
  return (
    <Section title="Errors">
      <div className="grid grid-cols-2 fq:grid-cols-3 gap-4 mb-4">
        <MetricBlock
          label="Errors (30d)"
          value={errors.total30d || 0}
          sub={(errors.total30d || 0) === 0 ? 'All clear' : 'See recent log'}
        />
        <MetricBlock
          label="In last 50 entries"
          value={recent.length}
          sub={sources.length > 0 ? `${sources.length} source${sources.length === 1 ? '' : 's'}` : ''}
        />
        <MetricBlock
          label="Latest"
          value={recent[0] ? formatDateTime(recent[0].createdAt) : '—'}
          sub={recent[0]?.route || ''}
        />
      </div>
      <TimeSeriesSparkline
        series={(errors.perDay || []).map((r) => ({ date: r.date, value: r.count }))}
        label="Errors per day — last 30 days"
        color="var(--tq-error-txt)"
        bars
      />
      {sources.length > 1 && (
        <div className="flex gap-2 mt-4 mb-2 flex-wrap">
          <button
            type="button"
            className={`pill ${sourceFilter === 'all' ? 'active' : ''}`}
            onClick={() => setSourceFilter('all')}
          >
            All
          </button>
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              className={`pill ${sourceFilter === s ? 'active' : ''}`}
              onClick={() => setSourceFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {filtered.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--tq-border)', color: 'var(--tq-muted)' }}>
                <th className="text-left py-2 pr-3">When</th>
                <th className="text-left py-2 pr-3">Source</th>
                <th className="text-left py-2 pr-3">Route</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">User</th>
                <th className="text-left py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b" style={{ borderColor: 'var(--tq-border-soft)' }}>
                  <td className="py-1 pr-3" style={{ color: 'var(--tq-muted)' }}>
                    {formatDateTime(e.createdAt)}
                  </td>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{e.source}</td>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--tq-muted)' }}>
                    {e.route || '—'}
                  </td>
                  <td className="py-1 pr-3" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{e.statusCode || '—'}</td>
                  <td className="py-1 pr-3">{e.userId || '—'}</td>
                  <td className="py-1 truncate" style={{ maxWidth: 360, color: 'var(--tq-error-txt)' }}>
                    {e.message || '—'}
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
