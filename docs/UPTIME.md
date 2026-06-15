# Uptime monitoring (TRQ-155)

## What this is

`GET /health` returns 200 only when the app **and** its database are
both reachable. Before TRQ-155 the endpoint returned 200 unconditionally
(it was a stub), which meant any uptime monitor pointed at it would
have said "up" during a real outage. The new endpoint probes Postgres
on every request — cheap (`SELECT 1`, 2-second hard cap) but real.

## Endpoint contract

`GET /health` — no auth, no rate-limit, no body.

### Healthy

```json
HTTP 200
{
  "status": "ok",
  "db": "ok",
  "latency_ms": 12
}
```

### Degraded

```json
HTTP 503
{
  "status": "degraded",
  "db": "timeout"     // or "unreachable"
  "latency_ms": 2007
}
```

The `db` category distinguishes a slow Postgres (`timeout`) from a
gone Postgres (`unreachable`). Useful triage at 3 AM.

### What "degraded" doesn't catch

`/health` is intentionally narrow. It does **not** test:

- Anthropic / OpenAI reachability (an AI outage degrades quoting, not
  the platform; checking on every healthcheck would burn money + add
  upstream-dependency noise to the signal)
- R2 reachability (backup service runs separately)
- Email send (no real outbound email yet)
- Disk space / memory

If any of those becomes critical for "is FastQuote functional" we'll
add them as separate endpoints (`/health/ai`, `/health/storage`),
not bundled into `/health`.

## Railway healthcheck

`railway.toml` already points at `/health`:

```toml
[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 60
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

With the DB-aware endpoint, Railway now restarts the container if the
DB stays unreachable across 3 consecutive checks. Previously it would
have happily kept a broken container alive.

The 60s `healthcheckTimeout` is generous — the endpoint's own 2s
timeout ensures we never approach Railway's.

## External monitor (Harry — one-time setup)

The endpoint is useless without something pinging it. Set up an
external monitor so a down signal reaches Harry even when the app
can't notify itself.

Recommended: **UptimeRobot** free tier (50 monitors, 5-min interval).
Other options: BetterStack, Healthchecks.io.

### Setup steps

1. Sign in to https://uptimerobot.com (Google OAuth fine).
2. Add New Monitor:
   - Type: **HTTP(s)**
   - URL: `https://fastquote.uk/health`
   - Friendly name: `FastQuote – prod /health`
   - Interval: **5 minutes**
   - Keyword monitoring (advanced): expect substring `"status":"ok"` —
     guards against a 200 with a non-OK JSON body (shouldn't happen
     but defence-in-depth).
3. Configure alerts:
   - **Email** to Harry's primary inbox.
   - **SMS / Push** (UptimeRobot's mobile app pushes are free) for
     instant on-the-road notification.
   - Trigger alert: After **2 consecutive failures** (10 min) — avoids
     paging on a single 5xx blip from a Railway deploy.
   - Send recovery alert too.
4. **Test the alert.** Temporarily change the monitor URL to
   `https://fastquote.uk/health-does-not-exist`, wait 10 min, confirm
   the email + push arrive. Restore the URL. (Don't skip this step —
   an unconfigured alert is worse than no monitor at all.)

### Adding staging later

Once TRQ-153 (staging) lands, add a separate monitor for
`https://fastquote-staging.up.railway.app/health` — staging being down
is informational not urgent, so configure email-only (no SMS/push).

## Monitoring + interpretation

| What you see | What it means | Action |
|---|---|---|
| Alert: "FastQuote – prod /health is DOWN" with response showing 503 + `db: unreachable` | Postgres is gone (network split, Railway PG plugin failure, password rotation went wrong) | Railway → Postgres plugin → Logs. If PG itself is up, check `DATABASE_URL` env var. |
| Same alert with `db: timeout` | Postgres reachable but slow — long-running query, IO saturated, lock contention | Railway → Postgres plugin → Metrics. Often resolves itself in a couple of minutes. |
| HTTP 500 / connection refused (UptimeRobot says "host not responding") | Container itself is down or unhealthy | Railway → main service → Deployments. Last deploy might be crashing on startup. |
| HTTP 200 but recovery alert never fires | Monitor's recovery threshold not met (still waiting for N consecutive successes) | Wait. Usually resolves within 10–15 min. |
| Repeated short outages (down for 5 min every few hours) | Likely a deploy churn — Railway restarting the container | Railway → Deployments. Look for repeated restarts in the same hour. |

## Cost

UptimeRobot free tier: £0/month. 5-min interval, 50 monitors. Plenty.

## Why this endpoint isn't part of the CI workflow

CI runs against a deterministic Jest suite without a live database.
Asserting on `/health` would require booting the server + a live PG —
which is what the (separate) `test:api` and `test:security` suites do.
The CI gate keeps to code correctness; production health is the
external monitor's job.
