import React, { useEffect, useState } from 'react';

/**
 * Admin enquiries panel — Harry + Mark (admin plan).
 * Lists West Yorkshire homeowner asks and one-tap outcomes.
 * Plain vocabulary: enquiry, not lead score / AI.
 */
const OUTCOMES = [
  { id: 'contacted', label: 'Contacted' },
  { id: 'visit', label: 'Visit booked' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

function outcomeLabel(outcome) {
  if (!outcome || outcome === 'unknown') return 'Notified';
  if (outcome === 'visit') return 'Visit booked';
  if (outcome === 'awaiting_contact') return 'Notified';
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/enquiries', { credentials: 'include' });
      if (!res.ok) {
        setError(res.status === 404 ? 'Enquiries are not enabled.' : 'Could not load enquiries.');
        setEnquiries([]);
        return;
      }
      const data = await res.json();
      setEnquiries(data.enquiries || []);
    } catch {
      setError('Could not load enquiries.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setOutcome = async (id, outcome) => {
    try {
      const res = await fetch(`/api/admin/enquiries/${encodeURIComponent(id)}/outcome`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      if (!res.ok) return;
      setEnquiries((prev) =>
        prev.map((row) => (row.id === id ? { ...row, outcome, status: outcome } : row)),
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6" style={{ color: 'var(--tq-ink, #211a10)' }}>
      <p
        className="text-xs font-semibold tracking-widest uppercase mb-2"
        style={{ color: 'var(--tq-accent, #bd5e09)' }}
      >
        Enquiries
      </p>
      <h1
        className="text-3xl mb-2"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 800, textTransform: 'uppercase' }}
      >
        West Yorkshire
      </h1>
      <p className="mb-6 text-sm" style={{ color: 'var(--tq-muted, #7c6c50)' }}>
        Homeowners who asked a waller to quote. During the test, Mark is emailed the private link.
        Update the outcome when you know what happened.
      </p>

      {loading && <p className="text-sm">Loading…</p>}
      {error && <p className="text-sm" style={{ color: '#8f4604' }}>{error}</p>}
      {!loading && !error && enquiries.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--tq-muted, #7c6c50)' }}>No enquiries yet.</p>
      )}

      <div className="space-y-3">
        {enquiries.map((row) => (
          <article
            key={row.id}
            className="rounded border p-4"
            style={{ background: 'var(--tq-card, #fffdf8)', borderColor: 'var(--tq-rule, #ddd1ba)' }}
          >
            <div className="flex justify-between gap-3 items-baseline mb-2">
              <h2 className="text-lg font-semibold m-0">
                {row.area} · {row.outward}
              </h2>
              <span
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: 'var(--tq-accent, #bd5e09)' }}
              >
                {outcomeLabel(row.outcome || row.status)}
              </span>
            </div>
            <p className="text-sm m-0 mb-1">
              {row.lengthM} metres · {row.heightLabel} · {row.bandText}
            </p>
            <p className="text-sm m-0 mb-1">
              {row.name} · {row.phone}
            </p>
            <p className="text-xs m-0 mb-3" style={{ color: 'var(--tq-muted, #7c6c50)' }}>
              {row.createdAt ? new Date(row.createdAt).toLocaleString('en-GB') : ''}
              {' · '}
              <a href={row.url} target="_blank" rel="noreferrer" style={{ color: 'var(--tq-accent, #bd5e09)' }}>
                Quote link
              </a>
              {row.notifiedUserIds?.length
                ? ` · emailed ${row.notifiedUserIds.join(', ')}`
                : ' · not emailed yet'}
            </p>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map(({ id, label }) => {
                const pressed = (row.outcome || row.status) === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOutcome(row.id, id)}
                    className="px-3 py-2 text-sm rounded border min-h-11"
                    style={{
                      background: pressed ? 'var(--tq-ink, #211a10)' : '#fff',
                      color: pressed ? '#f4eee2' : 'var(--tq-ink, #211a10)',
                      borderColor: pressed ? 'var(--tq-ink, #211a10)' : 'var(--tq-rule, #c9ba9c)',
                    }}
                    aria-pressed={pressed}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
