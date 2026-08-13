# n11-01-the-browse-row-has-no-ping.md — working notes (netcode)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/netcode/n11-01-browse-row-ping`, cut from `21a0942`.

## THE FIRST THING A FUTURE ME SHOULD READ

**The seam is joined already. `a1-17` photographed a RACE, not a missing wire.**
Measured on the live fleet from this lane (2026-08-13, `playwright` against
`https://imaginethegames.github.io/planet-rush/`, real allocator, two real
clients, host room `G8ZJ`):

```
guest t=  77ms  regions=[]                 rows=[]                        (list not in yet)
guest t= 613ms  regions=[]                 rows=["M7U4QW|IAD —"]          <- a1-17's frame
guest t=1220ms  regions=[]                 rows=["M7U4QW|IAD —"]
guest t=1748ms  regions=[iad:161,gru:274]  rows=["M7U4QW|VIRGINIA 161ms"] <- the number lands
```

`a1-17`'s capture read the row **42 ms after the listing landed**
(`readback-browser.json` `guestListWaitMs: 42`, and its own `"regions": []` /
`"regionLine": ""` say the survey had not answered yet either). So the row *does*
get the measured ping — about **1.1 s after the list it is drawn beside**.
`IAD —` is the pre-probe state, and the label proves it: a matched region prints
`VIRGINIA`, an unmatched one falls back to the raw code
(`src/ui/lobby-browser.ts` `rowWhere`).

That reframed the brief: nothing to *join*, everything to make **arrive sooner**
and to **say what it is** while it has not arrived.

## BUILT

- `8536e83` **`src/net/region-probe.ts` — the survey publishes each COMPLETED
  round** (`RegionProbeOptions.onRound`; `surveyRegions` ranks it as `onSurvey`).
  Same serial loop, same order, same request count, same budget — it reports
  sooner, it does not measure differently. 10 new tests in `region-probe.test.ts`
  (46 total), including one that compares the request order with and without the
  callback so a0-29 cannot be re-broken by this.
- `ae0631d` **`src/main.ts` wiring + both ends of the region-id join.**
  `measureFleet` draws each round as it lands; `takeSurvey` refuses to let an
  EMPTY survey replace a measured one (an allocator hiccup used to drop every row
  back to `IAD —` mid-session); `toFleetRegion` and `toListing` both normalise the
  region code (trim + lower-case), because the row's ping is found by matching one
  against the other and they come from two different allocator code paths.
- `a608fff` **evidence** — `evidence/n11-01-browse-row-ping/` (capture script,
  `readback-row.json`, README) + 12 images. Interleaved A/B on the live fleet,
  three guests per build.
- `0a6d419` **`docs/region-picker.md` §9** — the sequence stated: what every
  region carries before the first round, after round 1, after each later round,
  and when the budget cuts a round short.

### The numbers that matter

| | row drawn with no number | probe requests done when the number appeared |
|---|---|---|
| BEFORE (deployed bundle) | 1633 / 1552 / 1547 ms | 6, 6, 6 |
| AFTER (this branch) | 0 / 0 / 0 ms | 2, 3, 6 |

A whole survey is 7 round trips; a first round is 3. The request count is the
claim that survives a contended machine — the wall clock is noisy here.

## DECISIONS

1. **Publish per ROUND, not per sample.** Per-sample would report a region that
   has been sampled against one that has not, which is a0-29's unfairness wearing
   a different costume — and it would let the browse rows re-sort three times
   under a thumb. A whole round means every region has had the same number of
   attempts. A round the budget truncates is never published.
2. **Rejected: a second probe, or overlapping samples.** The brief forbids both
   and they are the obvious "fixes". Serial is what makes the ordering mean
   anything (a0-29, freshly landed).
3. **Rejected: re-timing on the browser's refresh.** The list polls every 5 s;
   the fleet is measured once per visit to the doors. Untouched.
4. **Rejected: persisting a measurement across sessions** to fill the first-visit
   gap. A ping is only worth showing if it is *this* session's, on *this*
   network.
5. **The em dash stays.** Brief point 2 reads as a rule to keep, not a change to
   make: `region-probe` rule 1 is *absent, never zero*, and `—` is its ratified
   rendering (`NO_PING`, and `src/ui/lobby-browser.ts`'s `BROWSE_NO_PING`). A
   dash and `0ms` cannot look the same because the dash is not a numeral. What a
   dash *cannot* say is "measuring, hold on" — telling that apart from
   "unmeasurable" needs a third state on the row, and **the row is drawn in
   `src/ui/lobby-browser.ts`, which this lane does not touch**. Flagged in the PR
   for the UI owner; the window it would cover is now ~0 ms wide anyway.
6. **The evidence had to be an interleaved A/B**, not a single after-shot: this
   container inflates every browser-measured ping 2–4× (node baseline in the same
   session: `iad 78ms`, `gru 177ms`; the browser read 259 ms). A before/after
   taken minutes apart would have been measuring the machine.

### Traps hit

- `vite preview` binds IPv6 `localhost` only — `127.0.0.1` is refused. Pass
  `--host 127.0.0.1`, and spawn `node_modules/.bin/vite` directly so the server is
  a child this script can actually kill (killing `npx` leaves it running and the
  port held).
- A "served source check" that greps `index-*.js` for the allocator URL answers
  **no** for a perfectly good build: the entry chunk is ~1.3 kB and the client
  lives in `main-*.js`. Follow one import hop.

## OPEN / FLAGGED (not this brief's)

- **Ordering noise on this hardware.** In 2 of 6 A/B runs the two regions came
  back inverted (gru below iad) — on the **deployed** build as often as on this
  branch, and never in the node baseline. It is container contention, not an
  a0-29 regression, but it means an a1-17-style capture *can* photograph a picker
  that ranks São Paulo above Virginia. Worth knowing before someone re-opens
  a0-29 on the strength of a screenshot.

## NEXT

Nothing outstanding on the branch. DoD: `npx tsc --noEmit` clean, `npm test --
--run` green, branch pushed, PR open with checks green.
