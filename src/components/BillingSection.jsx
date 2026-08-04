import React, { useEffect, useState } from 'react';

/**
 * BillingSection — Settings / Billing surface (2026-06-30 launch checklist).
 *
 * Renders one of two subscription cards then the past-purchases stack:
 *   1a. Subscribed card — plan name + next billing date + "Manage or
 *       cancel subscription" button (opens the Stripe billing portal —
 *       Stripe owns the cancel flow, dunning, cancel-at-period-end,
 *       retention offers, so we deliberately don't reimplement it).
 *   1b. Non-subscribed card (Mark's 2026-08-04 UAT) — headline price,
 *       "Cancel anytime" reassurance, and a "Subscribe" button that
 *       POSTs /api/billing/checkout and follows the returned Stripe
 *       Checkout URL. Before this, non-subscribers saw nothing but
 *       past purchases here — the Subscribe path was only reachable
 *       via the QuotaCounter banner, which is quota-state gated and
 *       invisible in Settings.
 *   2. Past purchases table — combined pack + subscription invoices,
 *      most recent first, capped at 24. Each row has a "Download
 *      invoice" link that opens hostedInvoiceUrl in a new tab.
 *
 * Stripe invoice strategy: every payment in the list is a Stripe-hosted
 * invoice page (hosted_invoice_url). Stripe handles branding, VAT lines,
 * PDF rendering — we just surface the link. No custom rendering.
 *
 * Free-tier users with no purchases still see this section; they get an
 * empty-state on the purchases stack + the Subscribe card above it.
 *
 * Vocabulary stays inside the safe-list: "subscription", "invoice",
 * "manage", "cancel", "download", "monthly", "pack", "unlimited".
 * No banned AI/agent/confidence terms.
 */
export default function BillingSection() {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [status, setStatus] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
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

  // Mirrors the SubscriptionBanner / QuotaCounter subscribe pattern —
  // POST to /api/billing/checkout, follow the returned Stripe Checkout
  // URL. Failures re-enable the button so a network blip is recoverable.
  const startCheckout = async () => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    try {
      const r = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!r.ok) throw new Error(`checkout ${r.status}`);
      const { url } = await r.json();
      if (url) window.location.href = url;
      else setCheckoutBusy(false);
    } catch {
      setCheckoutBusy(false);
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

      {isSubscribed ? (
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
            {/* "Manage or cancel" — Stripe portal is the canonical
                cancel path (Stripe handles cancel-at-period-end +
                retention). Naming makes that discoverable so users
                don't hunt for a separate Cancel button. */}
            <button
              type="button"
              onClick={openPortal}
              disabled={portalBusy}
              className="btn-ghost touch-44"
              style={{ minHeight: 44 }}
              data-action="manage-subscription"
            >
              Manage or cancel subscription
            </button>
          </div>
        </div>
      ) : (
        // Non-subscribed card — Mark's 2026-08-04 UAT ("here we need
        // the option for the monthly subscription"). Same shape as
        // the subscribed card so the layout doesn't shift after a
        // successful checkout. Loading state suppresses the card to
        // avoid a flash of Subscribe → Manage when the user IS
        // subscribed and status hasn't loaded yet.
        !loading && (
          <div
            className="mb-6 p-4 border border-tq-border rounded"
            style={{ background: 'var(--tq-card)' }}
            data-billing-card="subscribe"
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-heading uppercase tracking-wide text-xs" style={{ color: 'var(--tq-muted)' }}>
                  Subscription
                </div>
                <div className="font-heading text-lg mt-1">
                  FastQuote Unlimited &mdash; &pound;{monthlyPrice.toFixed(2)}/month
                </div>
                <div className="text-sm mt-1" style={{ color: 'var(--tq-muted)' }}>
                  Unlimited quotes. Cancel anytime.
                </div>
              </div>
              <button
                type="button"
                onClick={startCheckout}
                disabled={checkoutBusy}
                className="btn-primary touch-44"
                style={{ minHeight: 44 }}
                data-action="subscribe-monthly"
              >
                Subscribe
              </button>
            </div>
          </div>
        )
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
