import React, { useEffect, useState } from 'react';

/**
 * BillingSection — Settings / Billing surface (2026-06-30 launch checklist).
 *
 * Two stacks:
 *   1. Subscription status card — plan name + next billing date + Manage
 *      subscription button (opens Stripe billing portal). Only renders
 *      when the user has an active subscription.
 *   2. Past purchases table — combined pack + subscription invoices,
 *      most recent first, capped at 24. Each row has a "Download
 *      invoice" link that opens hostedInvoiceUrl in a new tab.
 *
 * Stripe invoice strategy: every payment in the list is a Stripe-hosted
 * invoice page (hosted_invoice_url). Stripe handles branding, VAT lines,
 * PDF rendering — we just surface the link. No custom rendering.
 *
 * Free-tier users with no purchases still see this section; they get an
 * empty-state. The whole component is read-only (no edits, no forms),
 * matching the locked spec.
 *
 * Vocabulary stays inside the safe-list: "subscription", "invoice",
 * "manage", "download", "monthly", "pack". No banned terms.
 */
export default function BillingSection() {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [status, setStatus] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [purchasesResp, statusResp] = await Promise.all([
          fetch('/api/billing/purchases').catch(() => null),
          fetch('/api/billing/status').catch(() => null),
        ]);
        if (purchasesResp?.ok) {
          const data = await purchasesResp.json();
          if (alive) setPurchases(Array.isArray(data?.purchases) ? data.purchases : []);
        }
        if (statusResp?.ok) {
          const data = await statusResp.json();
          if (alive) setStatus(data);
        }
      } catch (err) {
        if (alive) setError(err?.message || 'Failed to load billing');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' });
      if (!r.ok) throw new Error(`portal ${r.status}`);
      const { url } = await r.json();
      if (url) window.location.href = url;
    } catch {
      setPortalBusy(false);
    }
  };

  // Subscription card only renders when Stripe says state==='active'.
  // For trial / expired / free-tier users, the card is hidden — they
  // see the standalone Subscribe banner elsewhere in the app.
  const isSubscribed = status?.state === 'active' || status?.hasActiveSubscription === true;
  const monthlyPrice = status?.pricing?.gbpPerMonth ?? 19.99;
  const nextBillingDate = status?.currentPeriodEnd
    ? formatDate(status.currentPeriodEnd)
    : null;

  return (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">Billing</h2>
        <p className="ps-section-desc">
          Your subscription and downloadable invoices for every payment.
        </p>
      </div>

      {isSubscribed && (
        <div
          className="mb-6 p-4 border border-tq-border rounded"
          style={{ background: 'var(--tq-card)' }}
          data-billing-card="subscription"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>
                Subscription
              </div>
              <div className="font-heading text-lg mt-1">
                FastQuote Unlimited &mdash; &pound;{monthlyPrice.toFixed(2)}/month
              </div>
              {nextBillingDate && (
                <div className="text-sm mt-1" style={{ color: 'var(--tq-muted)' }}>
                  {status?.cancelAtPeriodEnd
                    ? <>Ends on {nextBillingDate}</>
                    : <>Next billing date: {nextBillingDate}</>}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openPortal}
              disabled={portalBusy}
              className="btn-ghost touch-44"
              style={{ minHeight: 44 }}
              data-action="manage-subscription"
            >
              Manage subscription
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="font-heading uppercase tracking-wide text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
          Past purchases
        </div>
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--tq-muted)' }}>Loading&hellip;</div>
        ) : error ? (
          <div className="text-sm" style={{ color: 'var(--tq-error, #b91c1c)' }}>{error}</div>
        ) : purchases.length === 0 ? (
          <div
            className="p-6 border border-tq-border rounded text-center text-sm"
            style={{ color: 'var(--tq-muted)' }}
            data-billing-empty
          >
            No purchases yet.
          </div>
        ) : (
          <PurchasesTable purchases={purchases} />
        )}
      </div>
    </div>
  );
}

function PurchasesTable({ purchases }) {
  return (
    <>
      {/* Desktop: 4-column table (>=900px). */}
      <table
        className="hidden fq:table w-full text-sm"
        data-billing-table="purchases"
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--tq-border)' }}>
            <th className="text-left py-2 px-2 font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>Date</th>
            <th className="text-left py-2 px-2 font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>Description</th>
            <th className="text-right py-2 px-2 font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>Amount</th>
            <th className="text-right py-2 px-2 font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {purchases.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid var(--tq-border)' }} data-purchase-id={p.id}>
              <td className="py-2 px-2">{formatDate(p.date)}</td>
              <td className="py-2 px-2">{p.description}</td>
              <td className="py-2 px-2 text-right font-mono">{formatAmount(p.amountPence)}</td>
              <td className="py-2 px-2 text-right">
                <InvoiceLink hostedInvoiceUrl={p.hostedInvoiceUrl} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards (<900px). */}
      <ul className="fq:hidden flex flex-col gap-3" data-billing-list="purchases">
        {purchases.map((p) => (
          <li
            key={p.id}
            className="p-3 border border-tq-border rounded"
            style={{ background: 'var(--tq-card)' }}
            data-purchase-id={p.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-heading uppercase tracking-wide" style={{ color: 'var(--tq-muted)' }}>
                {formatDate(p.date)}
              </div>
              <div className="font-mono text-sm">{formatAmount(p.amountPence)}</div>
            </div>
            <div className="mt-1 text-sm">{p.description}</div>
            <div className="mt-2">
              <InvoiceLink hostedInvoiceUrl={p.hostedInvoiceUrl} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function InvoiceLink({ hostedInvoiceUrl }) {
  if (!hostedInvoiceUrl) {
    return (
      <span className="text-xs" style={{ color: 'var(--tq-muted)' }} data-invoice-unavailable>
        Not yet available
      </span>
    );
  }
  return (
    <a
      href={hostedInvoiceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm underline touch-44 inline-flex items-center"
      style={{ color: 'var(--tq-accent)', minHeight: 44 }}
      data-action="download-invoice"
    >
      Download invoice
    </a>
  );
}

function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

function formatAmount(pence) {
  const value = Number(pence);
  if (!Number.isFinite(value)) return '';
  return `£${(value / 100).toFixed(2)}`;
}
