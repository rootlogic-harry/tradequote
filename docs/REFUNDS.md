# REFUNDS.md — pay-as-you-go quote pack

Locked-spec policy for the £9.99 / 5-quote pack (shipped 2026-06-24).
Subscription refunds (TRQ-150) are out of scope for this document —
those go through the Stripe billing portal that customers self-serve.

This runbook is for **Harry-only manual refund actions** on the
one-time pack. The autonomous agents in this repo **must not** refund
or adjust `purchased_quotes` automatically — the policy is deliberately
manual. Mirrors TRQ-150 / TRQ-157 patterns.

---

## Policy (locked spec, 2026-06-24)

| Decision | Value |
|---|---|
| Refund automation | **None** — Stripe-dashboard manual only |
| Claw-back of consumed quotes | **None** — if the user already burned them, they keep them |
| `purchased_quotes` adjustment | **Manual SQL only** — and only if the user has NOT consumed the credited quotes |
| Audit row in `quote_purchases` | **Left in place** — the row records what was paid, even after refund |
| Receipt VAT line | **Must be absent** — Harry is not VAT-registered (see `automatic_tax: false` in `billing.js`) |

### Why no automated claw-back?

The pack is £9.99 for 5 quotes. By the time a user asks for a refund,
they have usually run at least one of those quotes. Reaching back into
`users.purchased_quotes` to subtract what they consumed would feel
predatory and is operationally not worth the engineering effort.
Harry takes the £ hit on the small refund volume.

---

## Step-by-step: refund a single pack purchase

### 1. Find the purchase in Stripe

Stripe Dashboard → Payments → search by customer email OR by the
PaymentIntent id (`pi_…`). You can also start from the database:

```sql
-- DRY-RUN: list this user's pack history. Replace USER_EMAIL.
SELECT
  qp.id,
  qp.created_at,
  qp.amount_paid_pence,
  qp.quotes_added,
  qp.stripe_payment_id,
  u.email
FROM quote_purchases qp
JOIN users u ON u.id = qp.user_id
WHERE u.email = 'USER_EMAIL'
ORDER BY qp.created_at DESC;
```

The `stripe_payment_id` is the dedupe key — it's the Stripe
PaymentIntent id (`pi_…`) which is what you search for in the
Stripe Dashboard.

### 2. Issue the refund in Stripe Dashboard

1. Open the PaymentIntent in the Dashboard.
2. Click **Refund** → **Refund full amount** (£9.99).
3. Reason: pick the closest one (usually *Requested by customer*).
4. Confirm.

Stripe handles VAT-free refunds correctly because the original
charge had `automatic_tax: false`. The customer's bank statement
will show the refund within 5–10 business days.

### 3. Decide whether to adjust `purchased_quotes`

The CONSUME-ON-SUCCESS rule means `users.purchased_quotes` is what's
LEFT after consumption, NOT what was bought. So:

| Scenario | Action |
|---|---|
| User has not used any pack quotes yet (`purchased_quotes >= 5`) | OK to subtract 5 from `purchased_quotes`. The user still has free quotes; the pack hadn't started being used. |
| User has used 1–4 pack quotes already | **Do nothing.** They already got value for the £9.99. The refund is a goodwill gesture, but they keep the remaining quotes. Policy: no claw-back. |
| User has used all 5 pack quotes | **Do nothing** to `purchased_quotes` — it's already 0. The refund is purely monetary goodwill. |

If you decide to adjust:

```sql
-- DRY-RUN: confirm the user + balance first.
SELECT id, email, purchased_quotes FROM users WHERE id = 'USER_ID';

-- ONLY proceed if the user has not consumed pack quotes.
-- Subtract the pack size; clamp at 0 defensively.
UPDATE users
   SET purchased_quotes = GREATEST(0, purchased_quotes - 5)
 WHERE id = 'USER_ID';
```

> **Constitution reminder:** UPDATEs on `users` MUST always include a
> reviewed `WHERE id = ...` clause. Run a SELECT first, eyeball the row,
> then run the UPDATE. Never `WHERE email LIKE …` or any pattern
> with surprise breadth.

### 4. Leave the `quote_purchases` row alone

Do NOT delete the audit row. The row records that £9.99 was paid; the
refund happens in Stripe. The two ledgers are independent on purpose
— accountancy + Stripe reconciliation rely on the audit row.

If you need to mark the refund somewhere, do it in Stripe's metadata
on the PaymentIntent (Notes field) — we don't have a `refunded_at`
column on `quote_purchases` yet and probably don't need one for the
volume this is expected to see.

---

## Step-by-step: cancel a duplicate / accidental purchase

Sometimes a customer hits **Pay** twice and Stripe charges them
twice. The webhook is idempotent on `stripe_payment_id` (UNIQUE
constraint), so each charge produces its own audit row with its own
PaymentIntent id.

1. In Stripe Dashboard, find both PaymentIntents.
2. Refund the duplicate one fully.
3. Decide whether to subtract 5 from `purchased_quotes` per the table
   above (likely YES for a true duplicate — the user didn't intend
   to buy 10 quotes).

---

## What NOT to do

- **Don't** issue partial refunds. The pack is one indivisible unit.
- **Don't** edit `quote_purchases.amount_paid_pence` — it's a frozen
  audit value.
- **Don't** edit `quote_purchases.stripe_payment_id` — it's the
  webhook dedupe key. Touching it could let a redelivered Stripe
  event credit a SECOND pack.
- **Don't** DELETE rows from `quote_purchases`. Use the Stripe
  Dashboard for monetary correction; the DB row stays.
- **Don't** automate any of this. The locked spec is explicit: manual.

---

## Cross-references

- **TRQ-150** — Stripe subscription billing (separate flow; users
  self-serve cancellations via the billing portal).
- **TRQ-157** — Live-mode VAT-free dry-run pattern. Mirror it for
  any quote-pack live-mode test purchase.
- **billing.js → `createQuotePackCheckoutSession`** — the
  `automatic_tax: false` flag that keeps receipts VAT-free.
- **billing.js → `applyQuotePackEventToDb`** — the idempotent
  webhook write that this runbook is the manual counterpart to.
- **docs/BILLING.md** — Stripe account setup, env vars, the
  Harry-only steps. The pack uses the same Stripe account as the
  subscription.

---

## Pre-launch dry-run checklist (Harry — execute before merging)

Mirrors TRQ-157's live-mode pattern.

- [ ] In Stripe **live** mode, click the Buy button in production.
- [ ] Complete the £9.99 purchase with a real card.
- [ ] Check the receipt email: **no VAT line**. (Confirms
      `automatic_tax: false` is working.)
- [ ] Check the database:
      `SELECT purchased_quotes FROM users WHERE id = 'YOUR_USER_ID'`
      — should be `+5` from before.
- [ ] Check `quote_purchases`: one new row with
      `amount_paid_pence = 999`.
- [ ] In Stripe Dashboard, refund the £9.99 fully.
- [ ] Confirm `users.purchased_quotes` is **unchanged** (still +5).
      The locked-spec policy is no automated claw-back — the
      webhook handler must NOT decrement on refund.
- [ ] Manually run the SQL to subtract 5 from `purchased_quotes`
      (per the table above — this is a fresh purchase with no
      consumption yet, so the manual claw-back IS appropriate for
      this test).
- [ ] Confirm the buy button is **hidden** for an active subscriber
      (set `subscription_status='active'` on a test user briefly,
      reload, check the UI — then revert).
