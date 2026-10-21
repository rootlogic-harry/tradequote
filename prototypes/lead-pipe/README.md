# West Yorkshire lead-pipe mock

A clickable prototype of the homeowner flow. It is not served by the app. The live landing page is unchanged.

From the repo root:

```bash
python3 -m http.server 4177
```

Open http://localhost:4177/prototypes/lead-pipe/

The bar at the bottom jumps between landing, get a quote, the shared quote link, the emails Mark and Paul would receive, the enquiries tracker, and the daily-limit message.

Try `LS6 2AB` for a Leeds guide price and an ask. Try `BD23 1EL` for a guide price with no waller ask. The link is created only when someone asks a waller to quote. There is no PDF.

Guide-price rules live in `estimate.js`. The mail provider and privacy frame for a later build are in `DECISIONS.md`. Neither is wired up.
