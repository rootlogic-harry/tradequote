# Handover — West Yorkshire homeowner quotes

**For:** a follow-on model finishing production readiness and reviewing this work.  
**Branch context:** built on top of the clickable mock in `prototypes/lead-pipe/`.  
**Operator:** Harry. Admins with the Enquiries panel: Harry + Mark (`plan = 'admin'`).

---

## What shipped (local / this PR)

### Product behaviour (both flows)

**Customer (no account)**

1. Lands on `/` → **Get a quote** or opens `/quote` / `/dry-stone-wall-cost-west-yorkshire`.
2. Enters postcode, length, height (1.0 / 1.2 / 1.5m). Guide band updates via `POST /api/homeowner/preview` (server recomputes; no Claude).
3. Outside West Yorkshire (incl. `BD23`, `BD24`, `LS24`): band still shows; ask is blocked with “We’re not matching wallers in your area yet.”
4. In West Yorkshire: **Ask a waller to quote this** → name, email, phone, optional photos (≤3), unticked share-consent + optional marketing.
5. On success: row in `homeowner_quotes`, private link `/e/:uuid`, confirmation copy that the link includes contact details.
6. **No PDF.** Same link is what the waller email contains.
7. Daily cap: 5 waller-requests per IP hash per day (`DAILY_LINK_CAP`).

**Waller / notify (test window)**

- Env `HOMEOWNER_NOTIFY_USER_IDS` defaults to **`mark` only** (see `parseNotifyUserIds`).
- Email goes to `users.email` for that id. Without `RESEND_API_KEY`, mail is **console-logged** (`[email:console]`).
- Paul is **not** notified until the env list is widened.

**Admin (Harry + Mark)**

- Side rail **Enquiries** when `HOMEOWNER_QUOTES_ENABLED=true` and `isAdminPlan`.
- `GET /api/admin/enquiries` + `PATCH /api/admin/enquiries/:id/outcome` (`contacted` | `visit` | `won` | `lost`).
- Basic users (including Paul) do not see the panel.

### Code map

| Piece | Path |
|-------|------|
| Guide price / coverage / validation | [`src/utils/homeownerEstimate.js`](../src/utils/homeownerEstimate.js) |
| Feature flag | [`src/utils/homeownerQuotesEnabled.js`](../src/utils/homeownerQuotesEnabled.js) |
| Resend / console email | [`src/utils/sendTransactionalEmail.js`](../src/utils/sendTransactionalEmail.js) |
| Routes | [`homeownerQuotesRoutes.js`](../homeownerQuotesRoutes.js) |
| Schema | `homeowner_quotes` in [`server.js`](../server.js) init |
| Public UI | [`public/homeowner/`](../public/homeowner/) |
| Admin UI | [`src/components/Enquiries.jsx`](../src/components/Enquiries.jsx) + Sidebar / App |
| Landing CTAs | `LANDING_PAGE_HTML` in [`server.js`](../server.js) |
| Local runner | [`scripts/run-local-homeowner.sh`](../scripts/run-local-homeowner.sh) |
| Prototype (reference only) | [`prototypes/lead-pipe/`](../prototypes/lead-pipe/) |
| Unit / wiring tests | [`src/__tests__/homeownerQuotes.test.js`](../src/__tests__/homeownerQuotes.test.js) |

### Flags / env

```bash
HOMEOWNER_QUOTES_ENABLED=true          # fail-closed unless exactly "true"
HOMEOWNER_NOTIFY_USER_IDS=mark         # comma list; default mark
HOMEOWNER_IP_HASH_SALT=...             # optional; salts ip_hash
RESEND_API_KEY=...                     # optional locally
RESEND_FROM=FastQuote <quotes@…>       # optional
PUBLIC_BASE_URL=http://127.0.0.1:3000  # used when building /e/ links in email
DATABASE_URL=postgresql://...
```

### Local run

```bash
# Postgres must be up; example DSN used in the agent VM:
export DATABASE_URL=postgresql://fastquote:fastquote@127.0.0.1:5432/fastquote
./scripts/run-local-homeowner.sh
```

- Customer: http://127.0.0.1:3000/quote  
- Admin: use legacy session switcher (non-prod) as `mark` or `harry` → **Enquiries** in the rail.  
- Watch server logs for `[email:console]` when Resend is unset.

---

## Intentional gaps (finish these)

1. **Privacy policy** — `/privacy` still describes tradesperson + uploaded end-clients only. Need a Harry-approved version bump for direct homeowner collection + disclosure to wallers as recipients (not processors). Do not store real leads in prod until that ships.
2. **Resend DNS** — production from-address + SPF/DKIM. Local console mode is fine for Harry’s machine.
3. **Photo storage** — photos are JSONB data URLs on `homeowner_quotes`. Move to private object storage (not the backup bucket), strip EXIF, signed URLs for `/e/:id`. Cap + mime checks already exist.
4. **Paul notify** — when the test window ends, set `HOMEOWNER_NOTIFY_USER_IDS=mark,paul` (and ensure Paul has `users.email`).
5. **Sitemap / SEO** — add `/dry-stone-wall-cost-west-yorkshire` to `public/sitemap.xml` + `discoverability.test.js` when ready to index. Page currently sets `index,follow` in the client when on that path; confirm robots meta once live.
6. **Smoke / Playwright** — no e2e coverage yet for `/quote` → ask → `/e/:id` → admin outcome. Add under `tests/e2e/`.
7. **CLAUDE.md** — document the new table, flag, and Enquiries surface when this graduates from PR.
8. **Landing honesty / FAQ** — hero and nav were rewritten for two audiences; re-read FAQ + JSON-LD for contradictions (still waller-centric SoftwareApplication). Optional follow-up.
9. **Rate-limit / abuse** — IP rate limit + daily cap exist; honeypot + CAPTCHA still optional.
10. **Mark’s production email** — bootstrap only fills `mark@localhost.dev` when email is null. Production Mark must keep his real Auth0 email.

---

## Review checklist (QA 2026-09-29, local server)

Checked against a running server with `HOMEOWNER_QUOTES_ENABLED=true` and `HOMEOWNER_NOTIFY_USER_IDS=mark`.

- [x] `homeowner_quotes` writes do not change `jobs`, `quote_diffs`, `agent_runs`, or `users.free_quotes_used` (all stayed 0).
- [x] No session: `GET /api/admin/enquiries` is 401. Mark demoted to `basic`: API 403 and the side rail has no Enquiries item. Restored to `admin` after the check.
- [x] Skipton `BD23`, Settle `BD24`, Tadcaster `LS24`, and York `YO1` still get a band and cannot create a request. Leeds, Bradford, Halifax, Huddersfield, Wakefield, and Ilkley can.
- [x] With Paul present (`paul@localhost.dev`, plan basic), notified ids were `{mark}` only. Console email lines are `homeowner-enquiry:<id>:mark`.
- [x] `/e/:id` HTML starts `noindex`. The JSON route sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. Phone and photos appear only on a real ask. A name containing `<img onerror>` is shown as text, not executed.
- [x] £19.99 is under the “Pricing for wallers” heading. The hero does not charge the homeowner.
- [x] Enquiries copy has no “AI”. A basic user does not see the panel. The rail label “Agents” is the existing admin item, not this feature.
- [ ] Privacy copy signed off before prod flag flip. Still the two-group notice (tradesperson + uploaded end clients). Do not flip the flag in production yet.
- [x] Customer UI: height change updates the band, long-wall copy, unticked consent, consent error, Skipton hides the ask, daily cap keeps the band and says “That’s the limit for today”, mobile header shows both actions. Admin UI: Mark and Harry can list and set contacted / visit / won / lost. Bad outcome is 400. Flag off (`PORT=3001`, unset flag) returns 404 for `/quote` and `/api/homeowner/meta`.

`npm test` was green before this QA pass (4564). This pass did not change product code.

---

## Out of scope (still)

PDF download, per-claim Stripe, SMS, claim lock, 24h expiry mail, waitlist, multi-town doorway pages, WhatsApp, vision-model estimates, national marketplace.
