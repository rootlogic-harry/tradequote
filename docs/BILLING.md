# Billing — Stripe subscriptions (TRQ-150)

## Pricing model

| | |
|---|---|
| Price | £19.99 / month |
| Trial | 30 days, **no card up front** |
| Card prompt | At trial end (or any time during trial if the user opts in) |
| Statement descriptor | "FASTQUOTE" |
| Paul's free month | 100% off coupon, one-month, applied at checkout |

The trial is FastQuote-side, not Stripe-side. `users.trial_ends_at`
is set at OAuth signup (NOW() + 30 days). Stripe's subscription
starts at the moment of card collection, without an additional
trial — the FastQuote clock has already run.

## Code split

| File | Role |
|---|---|
| `billing.js` (new) | Lazy Stripe SDK init, checkout / portal / webhook helpers, subscription-state logic |
| `server.js` (modified) | Four routes: webhook (BEFORE express.json), status, checkout, portal. Schema additions. OAuth callback sets trial_ends_at. |
| `docs/BILLING.md` (this file) | Setup runbook + live-mode dry-run procedure |

## Required env vars

| Var | Where it's used | Test mode | Live mode |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Server-side API calls | `sk_test_…` | `sk_live_…` (Harry only) |
| `STRIPE_WEBHOOK_SECRET` | Verify incoming webhook signatures | `whsec_…` from Stripe CLI or Dashboard | `whsec_…` from Dashboard |
| `STRIPE_PRICE_ID` | The £19.99/mo Price object id | `price_…` (test) | `price_…` (live) |
| `STRIPE_PAUL_COUPON_ID` | Paul's 100%-one-month coupon | `coupon_…` (test) | `coupon_…` (live) |
| `STRIPE_PAUL_COUPON_USER_ID` | Which FastQuote user id triggers the coupon | `paul` | `paul` (or whatever the real id is) |
| `STRIPE_ALLOW_LIVE` | Hard gate against accidental live-key use | unset | `1` at the moment of go-live |

The `STRIPE_ALLOW_LIVE` flag exists because `STRIPE_SECRET_KEY` could
accidentally hold a `sk_live_…` in a staging environment. The
billing module refuses to construct a client from a live key unless
this flag is explicitly `1`. It is set in production by Harry at
go-live, never by an autonomous agent.

If `STRIPE_SECRET_KEY` is unset, the billing routes return 503 with
`{ configured: false }`. Staging may run this way; the rest of the
app keeps working.

## Harry-only setup (one-time, at go-live)

Per the Linear ticket: the FastQuote Stripe account is **separate**
from the Root Logic account. Keep bookkeeping clean from day one.

### 1. Create the FastQuote Stripe account

1. Stripe Dashboard → "+ Add new account" → name `FastQuote`.
2. Identity verification (passport / utility bill) — required before
   real charges can go through.
3. Connect bank account.
4. Set the **statement descriptor** to `FASTQUOTE` (Dashboard →
   Settings → Public details → Statement descriptor).
5. Default to GBP. Locale: UK.

### 2. Create the Price object

1. Dashboard → Products → + Add product.
2. Name: "FastQuote Monthly".
3. Pricing: Recurring, £19.99 GBP, monthly billing.
4. Copy the `price_…` id → into Railway env as `STRIPE_PRICE_ID`.

### 3. Create Paul's coupon

1. Dashboard → Products → Coupons → + New.
2. Type: Percentage discount. Percent off: 100. Duration: Once.
3. Name: "Paul's free month at launch".
4. Copy the `coupon_…` id → into Railway env as
   `STRIPE_PAUL_COUPON_ID`.
5. Also set `STRIPE_PAUL_COUPON_USER_ID` to Paul's FastQuote user id
   (currently `paul`).

### 4. Configure the webhook

1. Dashboard → Developers → Webhooks → + Add endpoint.
2. URL: `https://fastquote.uk/api/billing/webhook`.
3. Events to listen to (exact list):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the signing secret (`whsec_…`) → into Railway env as
   `STRIPE_WEBHOOK_SECRET`.

### 5. Set env vars on Railway (production service)

Settings → Variables:

```
STRIPE_SECRET_KEY=sk_live_…    # FROM step 1's API keys section
STRIPE_WEBHOOK_SECRET=whsec_…  # FROM step 4
STRIPE_PRICE_ID=price_…         # FROM step 2
STRIPE_PAUL_COUPON_ID=coupon_…  # FROM step 3
STRIPE_PAUL_COUPON_USER_ID=paul
STRIPE_ALLOW_LIVE=1             # gates the live-key safety check
```

Redeploy the service so the env vars take effect.

### 6. Verify

```bash
# /api/billing/status should report configured:true and the right
# pricing block.
curl -s https://fastquote.uk/api/billing/status \
  -H "Cookie: tq_session=<your-session-cookie>" | jq .
```

Look for `{ "configured": true, "pricing": { "gbpPerMonth": 19.99,
"trialDays": 30 }, ... }`.

## Local development against Stripe test mode

For agent-side development:

```bash
# 1. Get test-mode keys: Stripe Dashboard → toggle "Test mode" → API keys.
export STRIPE_SECRET_KEY=sk_test_…
export STRIPE_PRICE_ID=price_…    # test-mode Price you create same way as step 2 above
# webhook secret: use the Stripe CLI to forward to localhost
# Install: brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
# Copy the whsec_… it prints into:
export STRIPE_WEBHOOK_SECRET=whsec_…
# (Optional: Paul coupon for testing)
export STRIPE_PAUL_COUPON_ID=coupon_…
export STRIPE_PAUL_COUPON_USER_ID=paul

# 2. Run the server normally.
node server.js

# 3. Trigger a test event:
stripe trigger checkout.session.completed
# The webhook handler should apply it; check the DB.
```

**No live keys in local development.** The `STRIPE_ALLOW_LIVE` gate
catches accidental sk_live_… leakage.

## Live-mode dry-run (TRQ-157, separate ticket)

Before public launch, Harry runs a real £19.99 charge end-to-end and
then refunds. The procedure is in TRQ-157; this section is the
billing-code-side checklist:

- [ ] Trial expires correctly when `trial_ends_at` passes
- [ ] Checkout session opens and renders £19.99 GBP
- [ ] Card → real charge succeeds
- [ ] `subscription_status` flips to `active` via webhook
- [ ] Receipt email lands with statement descriptor `FASTQUOTE`
- [ ] Bank account shows the credit (next business day)
- [ ] Refund via Stripe Dashboard → invoice → refund
- [ ] `subscription_status` updates via webhook on cancellation

## Subscription state map

Per `billing.js`'s `currentSubscriptionState(user)`:

| State | Means | UI implication |
|---|---|---|
| `trialing` | Within the 30-day trial, no Stripe sub yet | Banner: "Trial — N days remaining" |
| `active` | Paid subscriber (or recently paid, current period) | No banner |
| `past_due` | Last payment failed; Stripe is retrying | Banner: "Payment failed — update card" |
| `canceled` | Subscription ended | Banner: "Subscription ended" |
| `expired` | Trial ended, no subscription started | Banner: "Subscribe to continue — £19.99/mo" |
| `unknown` | Legacy user (Mark / Paul / Harry — predates billing) | No banner |

Mark, Harry, and Paul predate billing — their `trial_ends_at` is
NULL, so they fall into `unknown` and never see a billing banner.
Paul gets the coupon at his real signup once that flow exists; until
then he stays on his current admin/basic plan.

## What this PR does NOT do

- **Does not enforce billing gates** on the analyse / save routes.
  Sub-state is computed but no route refuses to serve based on it.
  We add gates in a follow-up after observing trial / churn data
  for the first cohort — premature gating annoys early users.
- **Does not collect VAT** separately. Stripe handles VAT at the
  account level (Stripe Tax can be enabled if needed).
- **Does not display a billing UI in the React app.** The
  `/api/billing/status` endpoint is wired and a minimal trial
  banner could be added next. This PR ships the server side first
  to keep the diff reviewable.
- **Does not handle dunning email content.** Stripe sends default
  payment-failed emails; customising them is a Stripe Dashboard
  setting, not code.

## Constitution compliance

- No live keys in repo. Code never logs `STRIPE_SECRET_KEY` or any
  customer object full payload (the webhook handler logs `event.type`
  + the result of the apply, never the raw event body).
- Webhook signature verification is mandatory — no bypass even in
  dev (the `STRIPE_WEBHOOK_SECRET` is required for `parseWebhookEvent`
  to function).
- Live-key gate via `STRIPE_ALLOW_LIVE=1` — a misplaced env var
  cannot accidentally aim at production Stripe.
- All routes are auth-gated (except the webhook, which is
  signature-gated).
- All DB writes from webhooks use scoped `WHERE` clauses with bound
  parameters.
