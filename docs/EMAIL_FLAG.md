# Email integration kill-switch (`EMAIL_INTEGRATION_ENABLED`)

## Why this exists

Harry's 2026-06-29 screenshot review of the Quote screen (shipped in
PR #85) flagged a UX problem: the "Send to client" primary button
opens an Email / Outlook / Copy-link menu, but most wallers don't
have Outlook configured, mobile users have no Outlook flow at all,
and the .eml file path is brittle across desktop mail clients.

The waller's actual workflow is: copy the client link → paste into
WhatsApp / SMS / their own email → done. The Email / Outlook items
mislead more than they help.

This flag lets us **hide the Email + Outlook entry points in
production today** while leaving the `handleEmail`,
`handleSendViaOutlook`, and `buildEmlMessage` code paths
untouched — see `CLAUDE.md` Pitfall #15. Staging / dev keep the
surface live so iteration is unblocked.

## Contract

| Environment | `EMAIL_INTEGRATION_ENABLED` unset | `="true"` / `"1"` / `"yes"` | `="false"` / `"0"` / `"no"` |
|---|---|---|---|
| `NODE_ENV=production` | **DISABLED** (fail-closed) | ENABLED | DISABLED |
| `NODE_ENV` anything else (staging, dev, test) | **ENABLED** (default-open) | ENABLED | DISABLED |

The asymmetry is deliberate:

- **Production fails closed.** If somebody clears the Railway variable
  by accident, Email / Outlook entry points do not silently re-appear.
  The surface stays off until somebody types `true`.
- **Staging defaults open.** The flow can be iterated against the
  full menu without remembering to set a variable.

Truthy/falsy strings are case-insensitive and whitespace-trimmed:
`true`, `TRUE`, ` True `, `1`, `yes` all enable.

## What gets disabled when the flag is off

| Surface | Disabled behaviour |
|---|---|
| QuoteOutput primary `Send to client` button | Unchanged — main click still advances the job status from draft → sent, regardless of this flag. The button records the act of sending; it doesn't open any mail client. |
| Caret menu under `Send to client` | `Send via Email` and `Send via Outlook` items are **hidden**. The remaining menu (Copy client link + contextual status-change items) renders without them. |
| `/auth/me` | `features.emailIntegrationEnabled` reflects the current flag so the SPA can render the menu correctly on first paint. |

What **is not** disabled:

- The `handleEmail` and `handleSendViaOutlook` handlers in
  `src/components/steps/QuoteOutput.jsx` remain wired and tested.
- The `src/utils/buildEmlMessage.js` module ships unchanged. Every
  rule in CLAUDE.md Pitfall #15 still has a test in
  `buildEmlMessage.test.js` — these stay green. **Do not delete
  this module.** It is load-bearing if/when the flag flips on.
- The primary `Send to client` button (status-change behaviour) is
  always available — it has nothing to do with the email path.
- Saved quotes with previously-sent emails are unaffected; there is
  no audit/log dependency on the email path.

## Operator runbook

### Disable in production

```
railway variables set --service fastquote --environment production \
  EMAIL_INTEGRATION_ENABLED=false
```

Or via the Railway dashboard: Production env → variables →
`EMAIL_INTEGRATION_ENABLED` → set to `false` → Railway restarts the
service when the variable changes.

Removing the variable entirely also disables in production
(fail-closed), but explicit `false` is clearer to whoever reads the
config next.

### Re-enable in production

```
railway variables set --service fastquote --environment production \
  EMAIL_INTEGRATION_ENABLED=true
```

Verify with:

```
curl -s https://fastquote.uk/auth/me | jq .features
# → { "videoAnalysisEnabled": false, "emailIntegrationEnabled": true }
```

### Keep enabled in staging (default)

Staging needs no action when this PR ships — the default-open
behaviour for non-production environments keeps the surface live.
You can pin it explicitly:

```
railway variables set --service fastquote --environment staging \
  EMAIL_INTEGRATION_ENABLED=true
```

### Verify the current state

```bash
curl -s https://fastquote.uk/auth/me | jq .features.emailIntegrationEnabled
curl -s https://fastquote-staging.up.railway.app/auth/me | jq .features.emailIntegrationEnabled
```

## What this does NOT do

- It does not delete `buildEmlMessage.js`, `handleEmail`, or
  `handleSendViaOutlook`. Flipping the flag back on re-exposes them
  with zero code redeploy.
- It does not affect the dashboard's Send button, the kebab Resend
  link, the client portal, or any non-QuoteOutput surface.
- It does not gate the primary "Send to client" button — that's a
  status-change action (draft → sent) and is always available once
  the quote has been saved.

## Tests

`src/__tests__/emailIntegrationFlag.test.js`:

- Pure helper contract — production fail-closed, staging default-open,
  truthy/falsy parsing, whitespace + case insensitivity, non-string
  inputs.
- `isEmailIntegrationEnabledFromProcessEnv` wrapper reads
  `process.env` correctly.
- Server wiring — the helper is imported and `/auth/me` includes
  `features.emailIntegrationEnabled`.
- Client wiring — `App.jsx` reads the flag and `QuoteOutput.jsx`
  passes it to the caret-menu builder. `buildEmlMessage` import is
  preserved (Pitfall #15 guard).

## When to retire this doc

When the waller-shaped send flow is rebuilt (server-side mail via
an SMTP provider, or a permanently-fine Web Share path) and held
`true` in production for at least four weeks without complaints,
delete the variable and this doc together. Keep the helper module
as scaffolding for future kill-switches.
