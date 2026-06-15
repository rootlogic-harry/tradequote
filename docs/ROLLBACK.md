# Rollback runbook (TRQ-154)

## Why this exists

CI passes. The deploy goes green. Production breaks anyway. This
happens — the Paul bug history shows the quote flow has subtle
prod-only failure modes (mobile Safari activation timeouts, iPad
share-sheet quirks, Railway PG pool hiccups). When it does happen,
Harry should be reading a runbook, not improvising in front of a
paying waller.

**Goal: undo a bad deploy in under 5 minutes.** Two scenarios,
two different procedures, one decision-point to know which.

---

## Decide first: roll back vs fix forward

The wrong choice here costs more than the deploy did. Pre-commit
to the criteria so the decision is mechanical, not emotional.

| Symptom | Action |
|---|---|
| `/health` returns 503 | **Roll back app.** |
| 5xx on every request | **Roll back app.** |
| 5xx on one route (e.g. PDF download) | Fix forward if the cause is obvious in < 5 min; otherwise roll back. |
| Quote saves but renders wrong | Fix forward — visual bugs aren't worth a rollback. |
| Mark or Paul calls saying "I lost my quote" | **Stop. Take a backup. Then investigate.** Likely DB-side; see below. |
| Data appears missing from a table | **Stop. Take a backup. Then investigate.** |
| Schema migration ran and broke things | **Roll back DB** (full procedure, slower) — see below. |
| Stripe / billing failure | Roll back if it touches payment recording; fix-forward only if it's purely UI-side. |
| Login broken | Roll back app — every other path depends on it. |

**Default to rollback.** Fix-forward feels like the engineer's choice
but rollback is the operator's choice. If you're alone, tired, and a
real user is affected, rollback wins every time.

---

## Procedure 1 — App rollback (Railway deploy history)

Use this when the production container is running a bad commit but
the database is fine.

**Target: under 5 minutes.** Steps below time-estimated.

### 1. Confirm it's actually broken (60s)

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://fastquote.uk/health
curl -s https://fastquote.uk/health | jq .
```

If you get 503 with `db: unreachable` and Railway's Postgres plugin
status is also red, you've got a DB outage, not a bad deploy. Don't
roll back — wait or escalate to Railway support. App rollback won't
help.

If you get 503 with `db: ok` or no `db` field at all, the new build
itself is crashing. Continue.

### 2. Roll back via Railway dashboard (90s)

1. Railway → FastQuote project → main service → **Deployments**.
2. Find the most recent green deploy BEFORE the bad one.
   (The bad one is the top entry; you want the one just below it.)
3. Click the ⋮ menu on that previous deploy → **Redeploy**.
4. Railway promotes the previous build's image to active. No
   rebuild, no install — it's the cached image. Should be live
   within 60-90 seconds.

### 3. Verify (60s)

```bash
curl -s https://fastquote.uk/health | jq .
# Expect: { "status": "ok", "db": "ok", "latency_ms": <small number> }
```

Also: load the dashboard in a browser, click into a saved quote,
make sure it renders. Don't trust `/health` alone.

### 4. Tell people (60s)

- Email Mark + Paul: "Brief outage — fixed within 5 minutes.
  Resume normal use." Don't dwell on it; they don't need details.
- Open a Linear ticket: title "Incident: rollback of <commit
  sha>", body with timestamp + symptom + what triggered the
  decision. The bad commit needs investigating before redeploying
  forward.

### 5. Investigate the bad commit (whenever)

The rolled-back commit is still in `main` (Railway's deploy history
doesn't touch git). You need to either:

- Revert the commit (`git revert <sha>`) and merge a PR
  — preferred, keeps history clean.
- Fix-forward in a new PR if the bug is now understood.

Until that lands, **do not push to main**. Any new commit Railway
auto-deploys, which would push the bad code back live.

---

## Procedure 2 — Database rollback (the scarier case)

Use this when a schema migration ran, broke data, and you can't
get to a good state by reverting the app code. **This is the
runbook that destroys writes since the last backup.** Treat as a
last resort.

The full restore procedure is in `docs/RESTORE.md` under
"Disaster recovery". This section is a pointer + the rollback-
specific extras.

### Pre-flight

- [ ] Mark + Paul are warned. App will be down 15–30 minutes.
- [ ] A FRESH backup of the current (broken) state is taken first.
      Restoring a backup over a broken DB is reversible if you
      have the broken state saved. Without it, you've now made
      two losses.
- [ ] You have decided WHICH backup to restore from. Newest is
      usually wrong — if the incident happened 6 hours ago, the
      newest backup is post-incident. Verify by `node
      scripts/restore-test.js --r2-key daily/<candidate>.sql.gz`
      first and confirm it pre-dates the breakage.

### Procedure

Follow `docs/RESTORE.md` → "Disaster recovery" section verbatim:

1. Take a fresh backup (already done in pre-flight).
2. Download the chosen good backup.
3. Verify in scratch via `restore-test.js`.
4. Pause the Railway main service.
5. Restore: `gunzip -c <good>.sql.gz | psql "$PROD_DATABASE_URL"`.
6. Run `check-moat.js` against prod.
7. Re-enable the Railway service.
8. Verify `/health` and a real quote flow.

### Time estimate

The full procedure is ~15–25 minutes, dominated by step 5
(restoring a ~10MB gzip is fast; step 4's service pause + verify
takes the rest). It is NOT under 5 minutes. That's why the
decision criterion above defaults to "roll back DB only when
unavoidable."

### Post-restore reality

Writes since the chosen backup are gone. Tell Mark + Paul honestly:
"We restored to <date>. Any quotes you saved between that time and
now will need to be redone." Don't lie about this; UK GDPR
expects controllers to be transparent about data loss to data
subjects.

---

## Rehearsal status

**The rollback procedure has NOT been rehearsed yet.** This ticket
documents the procedure; the rehearsal step is gated on TRQ-153
(staging environment) so we can practise on a real-but-non-prod
Railway service.

The plan when TRQ-153 lands:
1. Deploy a deliberate trivial change to staging (e.g. flip a
   string in CLAUDE.md).
2. Roll it back via the Procedure 1 steps above.
3. Time it. Update this runbook if any step took longer than
   the estimate.
4. Then a DB rollback on staging: restore a snapshot, verify,
   re-deploy.
5. Tick the "rehearsed" acceptance criterion on TRQ-154.

Until that's done, this runbook is provisional. The procedures
ARE correct (they're the documented Railway + restore-test
patterns) but unrehearsed runbooks fail more often than rehearsed
ones — operator muscle-memory matters under stress.

---

## When to escalate to Harry rather than attempt rollback

If you (the agent) hit any of these mid-incident, STOP and ask:

- `/health` is 503 and you can't tell whether DB or app is the cause.
- Railway dashboard requires interactive console access you don't have.
- The previous good deploy is itself flagged with a known bug.
- The bad deploy contains a schema migration AND data writes the
  rollback would lose.
- More than one of the above.

The constitution's "stop and ask before anything irreversible"
applies here. App rollback is reversible (Railway keeps the bad
build's image). DB restore is NOT reversible — the writes between
the backup timestamp and now are gone. Don't attempt the DB path
autonomously.

---

## CLAUDE.md pointer

A one-liner cross-reference lives in `CLAUDE.md` under "Verification
& Self-Healing" so the next autonomous agent in a session knows
this runbook exists before assuming fix-forward is always the
right move.

---

## What this runbook deliberately doesn't include

- **Per-route rollback.** Railway redeploys the whole image; there's
  no "roll back just the PDF code" path. If you need that
  granularity, fix forward.
- **Automated rollback on `/health` 503.** Tempting but dangerous —
  a brief Postgres blip could trigger an unnecessary rollback that
  introduces its own outage window. Keep rollback as a human
  decision.
- **Multi-region failover.** We have one region (TRQ-149 is moving
  it). Multi-region is a Phase 1+ problem.
