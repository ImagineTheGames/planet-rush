# n11-01 — the browse row's ping, measured on the live fleet

**Owner:** Netcode Engineer. **Brief:** n11-01 (`a1-17`'s third failure).
**Capture:** `node evidence/n11-01-browse-row-ping/capture-row.mjs` →
`readback-row.json` + the `n11-01-*` images in `evidence/images/`.
**Fleet:** `https://planet-rush-allocator.fly.dev`, live, 3 machines,
regions `iad` + `gru`. **Machine:** this lane's container (Davenport FL,
residential ISP), sharing six cores with two other lanes.

---

## 1. The finding: a race, not a missing wire

a1-17 read a row that said `IAD —` and concluded the row is handed no ping. It
is handed one — about a second after the listing it is drawn beside.

The label is the tell. `src/ui/lobby-browser.ts` `rowWhere` prints the region's
**place name** when it has a measurement for it (`VIRGINIA`) and falls back to
the raw **code** when it has none (`IAD`). a1-17's own readback says the rest:
`guestListWaitMs: 42` (the row was read 42 ms after the list landed) with
`"regions": []` and `"regionLine": ""` — the survey had not answered anybody yet,
not the row and not the doors.

Reproduced here, two real clients on the live fleet, before any change:

```
guest t=  77ms  regions=[]                 rows=[]
guest t= 613ms  regions=[]                 rows=["M7U4QW|IAD —"]      <- a1-17's frame
guest t=1220ms  regions=[]                 rows=["M7U4QW|IAD —"]
guest t=1748ms  regions=[iad:161,gru:274]  rows=["M7U4QW|VIRGINIA 161ms"]
```

The listing lands in ~0.6 s. The survey is **serial on purpose** (a0-29) and
answered only after its *last* sample: 1 warm-up + 3 samples × 2 regions = 7 round
trips. So the row sat with a region and no number for the gap between them.

## 2. The change, and the A/B that measures it

`measureRegionPings` now publishes every region's verdict at each **completed
round**, and `surveyRegions` ranks it per round (`onSurvey`). Nothing else moves:
same serial loop, same order, same request count, same budget.

Three guests per build, interleaved, same fleet, same machine, same minutes —
`BEFORE` is the deployed GitHub Pages bundle (the one a1-17 shot), `AFTER` is this
branch built here and served from `vite preview`. Both bundles were confirmed to
carry the live allocator's URL (`readback-row.json` → `before/after.assets`).

| | row drawn without a number | probe requests completed when the number appeared |
|---|---|---|
| **BEFORE** (deployed) | 1633 / 1552 / 1547 ms — **median 1552 ms** | 6, 6, 6 |
| **AFTER** (this branch) | 0 / 0 / 0 ms — **median 0 ms** | 2, 3, 6 |

The second column is the one that survives a noisy machine: it counts the
**schedule**, not the weather. A whole survey is 7 requests; a first round is 3.
Nothing about latency moves those numbers.

`0 ms` means the row was **never once drawn without its ping** in three runs: the
first round now lands before the first listing does.

## 3. The photographs — 390 px landscape, the developer's phone

Room `RNRF`, hosted by a second real client on the live fleet, browsed on
844 × 390 at dpr 3.

| image | what it shows |
|---|---|
| `images/n11-01-after-row-settled.png` | the whole BROWSE screen: `DMRPB7 · 1 PLAYER · 7 SEATS OPEN · FFA` · **`VIRGINIA 259ms`** · `JOIN` |
| `images/n11-01-after-row-settled-zoom.png` | that row, enlarged — put it beside `images/a1-17-browser-guest-row.png`, which is the same row reading `IAD —` |
| `images/n11-01-after-row-unmeasured.png` / `-zoom.png` | **the before-first-probe state, shown**: the same build with its probes held at the network, so the browser wins the race — the row prints its region and no number |
| `images/n11-01-before-row-first-zoom.png` | the deployed build, same viewport, same fleet: `IAD —` |
| `images/n11-01-before-row-ping-zoom.png` | the deployed build 1.5 s later, once its survey finished |

**The row and the picker agree.** In the settled frame the row reads
`VIRGINIA 259ms` and the doors' own picker line reads `[IAD 259ms] · GRU 418ms` —
one measurement, printed twice, exactly as `docs/region-picker.md` requires.

**The unmeasured row is a region without a number, never a zero.** `IAD —` is
region-probe rule 1 rendered: `pingMs: null` prints the em dash, and `0 ms` prints
`0ms`. The two can never be confused because the em dash is not a numeral.

## 4. What the numbers are worth, stated plainly

The pings photographed here (259 ms to Virginia) are **higher than the fleet
actually costs from this machine**. Measured from node in the same session, one
region at a time, min of four — the same discipline the client uses:

```
baselinePingsFromNode: { iad: 78, gru: 177 }
```

The browser's numbers run 2–4× that because three Chromium contexts render a
starfield on a container sharing six cores with two other lanes. **The number is
real** — a genuine round trip this client timed, not a claim from a server — it is
just measured on a busy machine. On the developer's own phone a0-29 read
`IAD 153ms · GRU 276ms`, and this session's `curl` reads `iad 154ms · gru 261ms`.

**Flagged, not fixed:** in 2 of 6 A/B runs the two regions came back inverted
(gru below iad) — on the **deployed** build as often as on this branch, so it is
not this change. It is the same container contention inflating whichever sample it
lands on, and it is worth knowing that a1-17-style captures on this hardware can
photograph a picker that ranks São Paulo above Virginia without a0-29 having
regressed. The node baseline above, taken outside any browser, orders them
correctly every time.
