# Secrets management

## Single source of truth

**Railway environment variables, per environment.** That's it. There is no
`.env` file in the repo, no shared secrets vault, no copy-pasted keys in
1Password notes. If a service needs a secret, it reads it from
`process.env.X` at runtime, and Railway is where that value lives.

`.gitignore` already excludes `.env`, `.env.local`, `.env.*.local` —
keep it that way. If you add a new env-file pattern locally, gitignore
it before the first commit.

Each Railway environment has its own variable set:

| Env | DB | AI keys | Stripe | OAuth |
|---|---|---|---|---|
| `production` | Real `DATABASE_URL` injected by Railway PG plugin | Real Anthropic + OpenAI keys | **Live** Stripe keys (post-TRQ-150) | Real Google OAuth |
| `staging` (TRQ-153) | Separate `DATABASE_URL`, isolated PG instance | Real or scratch AI keys (project decision) | Stripe **test mode** only | Test OAuth client |

**Staging never holds live Stripe keys.** Test-mode keys only. This is
the bright line. A leaked live key means real money moves; a leaked
test key means inconvenience.

## What's a secret here

Anything where leaking it would let someone do something on a paid /
permissioned account on our behalf:

| Secret | Lives in | Rotation cost |
|---|---|---|
| `DATABASE_URL` | Railway env (auto-injected by the PG plugin) | High — coordinated DB password reset |
| `ANTHROPIC_API_KEY` | Railway env | Low — generate new key in Anthropic console, revoke old |
| `OPENAI_API_KEY` | Railway env | Low — same pattern in OpenAI dashboard |
| `STRIPE_SECRET_KEY` (live) | Railway env (production only) | **High** — live keys can move money. Treat as urgent. |
| `STRIPE_WEBHOOK_SECRET` | Railway env | Low — Stripe dashboard regenerate |
| `SESSION_SECRET` | Railway env | Medium — rotation logs every active user out |
| `AUTH0_CLIENT_SECRET` (2026-06-29) | Railway env | Medium — invalidates active sessions if not coordinated. Rotate via Auth0 dashboard → Applications → FastQuote → Settings → "Rotate". |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (TRQ-147) | Railway env (backup service only) | Medium — rotate via Cloudflare dashboard |

Things that are **not** secrets (safe to commit, log, share):

- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CALLBACK_URL`,
  `R2_BUCKET_NAME`, `PUBLIC_BASE_URL` — public-facing identifiers.
- `NODE_ENV`, `PORT`.
- Database table names, schema field names, error messages (provided
  they don't echo a key).
- Test fixtures with **obviously fake** values (`sk-test-fake-1234`).

## Secret-scanning gate

`.github/workflows/secret-scan.yml` runs `gitleaks` on:

- Every pull request to `main` (scans the diff).
- Every push to `main` (full-history audit so a force-push that
  bypasses the PR scan still gets caught).
- A weekly cron (Sundays 03:30 UTC) as a safety net.

A finding fails the workflow. With branch protection on (TRQ-146),
that blocks the merge. An autonomous agent commit cannot land a key
without trying very hard.

## Leaked-key response runbook

**If you suspect a secret has been committed, exposed in logs, or
shared with the wrong audience, follow this in order. Do the rotation
*first*; cleaning history is a follow-up.**

### Stripe live keys (THE WORST CASE)

1. **Within 5 minutes**: Stripe Dashboard → Developers → API keys → roll
   the leaked key. Stripe revokes the old key on a 1-hour grace period.
2. Update Railway production env with the new key. Redeploy.
3. Check Stripe Dashboard → Logs for any unrecognised API calls in the
   leak window. Refund anything suspicious.
4. If the key was committed to git: see "Cleaning git history" below.
5. **Notify Stripe support** at `support@stripe.com` with the rotation
   timestamp — they keep a record.

### Anthropic / OpenAI keys

1. Anthropic Console (or OpenAI Dashboard) → API keys → revoke the
   leaked key.
2. Generate a new key, paste into Railway env, redeploy.
3. Spot-check the provider's usage page for the leak window — a
   compromised key may have racked up tokens you didn't authorise.
4. Open a support ticket with the provider citing the rotation
   timestamp if usage is suspect.

### `DATABASE_URL`

The URL contains the Postgres password, so leaking it leaks the
password.

1. **Take a backup immediately** (TRQ-147 runbook) before doing
   anything else.
2. Railway → Database → Settings → Reset password. Railway will
   re-inject the new URL into the service env.
3. Trigger a redeploy so the running service picks up the new URL.
4. Check Postgres logs for any unfamiliar IPs in the leak window.
5. Treat the backup as canonical until step 3 completes — if anyone
   else used the URL during the window, you'll need it.

### `SESSION_SECRET`

1. Rotate in Railway env. Every existing session is invalidated.
2. Redeploy.
3. **Notify Mark + Paul**: they'll be logged out and need to sign in
   again. No data loss.

### Cloudflare R2 keys

1. Cloudflare Dashboard → R2 → Manage R2 API Tokens → revoke.
2. Create new key with the same scoped permissions (read/write to the
   backup bucket only — never account-wide).
3. Update Railway env, redeploy.
4. Check R2 access logs for the leak window.

### Cleaning git history (after rotation, not before)

If the secret reached a public branch, the rotated key being safe is
necessary but not sufficient — the *next* leak (e.g. someone clones a
mirror) shouldn't re-expose it.

```bash
# Identify the commit(s) containing the secret
git log -p --all -S "<a unique fragment of the secret>"

# Rewrite history with git-filter-repo (NOT git filter-branch — it's
# slower and buggier). install: brew install git-filter-repo
git filter-repo --replace-text <(echo 'LEAKED_VALUE==>***REMOVED***')

# Force-push the cleaned branches
git push --force-with-lease origin main
```

**`--force-with-lease` not `--force`** — refuses to clobber concurrent
commits. The constitution's "no force-push" rule has a single
documented exception: this runbook, with the key already rotated.

After rewriting:
- Tell Harry. The local repo on every laptop is now divergent and
  needs re-cloning or a hard reset.
- Re-run the secret-scan workflow manually
  (`gh workflow run secret-scan.yml`) to confirm the history is clean.

## Periodic hygiene

Once per quarter, Harry should:

- [ ] Audit which keys are actually in use (Anthropic + OpenAI + Stripe
      dashboards).
- [ ] Revoke any unused keys (failed experiments, old laptops).
- [ ] Re-read this runbook so a 2 AM page isn't the first time you see
      it.

## Why this exists

For a single-developer app with payment keys + a DB password + a moat
of learning data, "we'll be careful" isn't a strategy. This file is the
strategy. Anything that touches a secret should refer back here rather
than re-deriving the right thing to do.
