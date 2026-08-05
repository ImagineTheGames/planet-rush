# The net telemetry race, and the sweep behind it — n4-01

**Branch `agent/netcode/n4-net-telemetry-race` · owner: Netcode Engineer ·
measured in this lane's container against the real stack (`npx vitest run
tests/net`, vitest 2.1.8, Node 22).**

`main` was red at `d3ab29c` on one assertion —
`tests/net/playtest-log-online.test.ts:170`,
`expect(sample.data!['rtt']).not.toBeNull()` — with deploy and verify-live
skipped behind it. Nothing was broken. The test was asserting on a sample the
instrument had not finished filling in.

The bots were suspected because the red appeared when p15-02 merged. They are
innocent, and the brief's container run already said so (3/3 at `d3ab29c`, 2/2 at
`15da71d`). What follows is the actual mechanism, reproduced.

---

## A. What was wrong, and why "slow CI" is only half of it

**The test waited for a proxy and asserted on a derived value.**

```ts
'a finalized telemetry second to reach the log',
() => log.events.some((e) => e.kind === 'net'),        // ← a sample EXISTS
…
expect(sample.data!['rtt']).not.toBeNull();            // ← is it COMPLETE?
```

Those are two different conditions, and the second one is not implied by the
first. `NetTelemetry` keys its buckets on `floor(now / SAMPLE_INTERVAL_MS)`
(`src/net/telemetry.ts`), so **the first finalized "second" is a fragment** —
however much of a wall-clock second was left when the match started. Join at
`.999` and that sample covers one millisecond. It is a real, finalized sample;
it just contains whatever landed inside the fragment. `rttMeanMs` is null unless
a reconcile in there acknowledged an input the client still held a send time for.

So the phase of the wall clock at match start decides whether the first sample is
complete. A slower host puts fewer reconciles into the fragment, which is why
CI's ~6× runners hit it far more often than this hardware does — but the defect
is not a timeout being too short. **Raising the timeout would not have fixed it.**

### The reproduction

A 20-round probe over the real socket, running the test's own journey and
printing the first finalized sample (probe deleted; output as recorded):

```
round  0: first rtt=null recon=  1 corrMax=0       <-- CI's failure, on this hardware
round  1: first rtt=  50 recon= 27 corrMax=0.952
round  2: first rtt=  42 recon= 28 corrMax=0.951
…
round 19: first rtt=  52 recon= 29 corrMax=0.952
```

**1 in 20, unloaded.** Note `recon = 1`: the sample was not empty, so
`expect(recon).toBeGreaterThan(0)` passed and only the `rtt` assertion fell over
— exactly the line CI reported.

Forcing the phase (start the flight 15 ms before a second boundary) makes it
**20 in 20**. That is the same probe, after the fix, showing the new wait
stepping over the incomplete fragment and taking the next sample:

```
round  0: nets=2 chose #1 rtt= 30 recon= 30 waited= 1074ms   <-- SKIPPED an incomplete first sample
…
round 19: nets=2 chose #1 rtt= 44 recon= 30 waited= 1030ms   <-- SKIPPED an incomplete first sample
  incomplete first samples skipped: 20/20
```

---

## B. What the wait is now, and why that one is honest

```ts
const isCompleteSample = (e: PlaytestLogEvent): boolean =>
  e.kind === 'net' && e.data !== undefined && e.data['rtt'] !== null;

await until('a finalized telemetry second WITH a measured round trip in it', …);
```

`rtt` is the only field in this sample that can legitimately be absent, so it is
the one to wait on. Everything the test then asserts is a claim about
correctness rather than about timing.

**No assertion was weakened.** `recon > 0` and `corrMax < 5` are both still
there, and `recon > 0` is *not* a restatement of the wait: a round trip is only
ever matched inside `recordReconcile`, which has already done `reconciles++` on
the same bucket, so a measured `rtt` **implies** `recon > 0`. Keeping the
assertion means a change to the instrument that broke that implication would
fail here instead of passing silently.

The mechanism is pinned as a unit test on an injected clock —
`src/net/telemetry.test.ts`, *"finalizes an opening FRAGMENT of a second with a
null RTT — a real sample, incomplete"* — so the shape the e2e wait is written
around cannot move underneath it without a red.

---

## C. The sweep — the same two patterns, everywhere else in `tests/net/`

This is the second wall-clock flake to redden `main` in a week, in the second
suite. Every socket-backed test in `tests/net/` was read for both patterns.

### C.1 Proxy wait → derived assertion

| where | was | now |
|---|---|---|
| `online-2p` settle | `sleep(200)`, then `expect(lead).toBe(0)` | wait for both input queues to drain — the fact `lead === 0` states |
| `online-orders` stake | `sleep(250)` "let the stake reach the client" | wait for the staked wallet to be on the client |
| `online-orders` tier | `sleep(400)` "the economy channel's trip home" | wait for the bought tier to be on the client's ship |
| `online-orders` satellite | `sleep(600)` "several 10 Hz intervals" | wait for the satellite to reach both clients |
| `satellite-visibility` ×2 | `sleep(600)` ×2 | wait for the satellite, and later its death, to reach both clients |
| `online-allocated` refusal | `sleep(300)`, then "no room was opened" | wait for the Machine's terminal close, and assert its reason too |

### C.2 Flat timeouts on multi-step journeys

Every socket test hand-wrote `30_000` (or `20_000`, or `60_000`) — numbers that
say nothing about the work. Worse, **five tests declared nothing at all** and
were riding vitest's built-in 5 s default:

| test | measured here | against |
|---|---|---|
| `rtt-decomposition` › measures the NETWORK round trip | **4.3 s** | 5 s |
| `latency-feel` › holds its feel thresholds at 150 ms | **2.8 s** | 5 s |
| `online-lobby-flow` › configures the room… | 0.35 s | 5 s |
| `online-lobby-flow` › never starts from a guest | 0.35 s | 5 s |
| `lifecycle-latency` › ×8 (worst 2.2 s) | **2.2 s** | 5 s |

At the ~6× the brief measured, the first of those is a **26 s test against a 5 s
cap**. That was the next red, and it had nothing to do with the file that
actually went red.

### C.3 Waiting for a non-event

Two assertions in `online-lobby-flow` are of the form "nothing happened", and a
sleep cannot honestly establish those — on a loaded runner it can assert the
absence of a thing *before the server has read the message being refused*. Both
now use an **ordering barrier**:

- a guest's refused `startMatch` is followed by a lobby change on the **same
  socket**; TCP delivers in order and the room handles a socket's messages in
  order, so the server's own roster reflecting the second proves it already saw
  and refused the first;
- the departed client's non-arrival is asserted only once `matchStart` has been
  **delivered** — the host's own lobby ended on it, and the guest would have been
  in that same broadcast.

### C.4 One time base moved onto the sim's clock

`online-2p` held thrust for `sleep(1_500)` and then asserted `authority.tick > 60`
and "travelled more than 20 units". The server steps on a `setInterval(…, 1000/60)`
and Node timers are a floor, not a schedule: 1.5 wall seconds buys 90 ticks here
and fewer on a two-core runner competing with two client sessions. So those
assertions were partly assertions about CI's CPU. It now waits for **90 fixed
steps on the server's own clock** (`tests/net/sim-clock.ts`), which is the same
simulation on any host.

`waitForTicks()` carries its own liveness bound: no tick at all for 2 s fails
immediately, naming how far it got. **Budgets bound the slow; that bounds the
stuck.**

---

## D. One project, one way of budgeting a test

`tests/net/budgets.ts` is q7-01's model, in q7-01's vocabulary:

```
budget = max(suite default, roundUpToStep(measured in-container seconds × CI_SLOW_FACTOR))
```

`CI_SLOW_FACTOR` is **imported from `tests/mobile/budget-model.ts`**, not
re-declared. It is a fact about the runner, not about a suite, and the day
someone re-measures it both suites should move together. (That file is QA's; this
branch reads it and does not touch it.)

Two constants are this suite's own, and both are the same rule instantiated
differently:

| | `tests/mobile` | `tests/net` |
|---|---|---|
| floor = the suite's own default | `playwright.config.ts` → 60 s | vitest built-in → **5 s** |
| step budgets are quoted in | 30 s (journeys land at 60–330 s) | **5 s** (these land at 5–45 s) |

The step is set **equal to the floor** on purpose. Round to a coarser step and
rounding swallows the floor — no measurement, however small, can produce it, and
"a cheap test stays cheap" quietly stops being true. `tests/net/budget-contract.test.ts`
asserts exactly that, along with the rest.

Call sites read:

```ts
}, netBudget({
  work: 'boot a server → seat two clients by room code → RUSH! → 90 SIM ticks of two-way thrust at 60 Hz → …',
  measuredSeconds: 1.9,
}));
```

`work` is the reviewable half: you can tell whether the number matches the
journey without running it.

### D.1 The rule is mechanical now

`tests/net/budget-contract.test.ts` (vitest, no socket time, fails on the
cheapest CI job) enforces four things:

1. every test in a file that lets time pass declares a budget via `netBudget()`;
2. no test hand-rolls a numeric timeout;
3. **no test sleeps** — a wait is on the condition (`until()`) or on the sim's
   clock (`waitForTicks()`). This is the rule both reds were actually about, and
   it is now unbreakable rather than remembered;
4. the arithmetic holds, including that the floor is reachable.

"A file that lets time pass" = one importing `node-websocket`, `local-fleet`,
`latency-harness` or `match-server`. `online-teams.test.ts` is the one named
exclusion: it calls `server.update()` **once** to build a world and then asks the
sim synchronous questions — no wire, no loop, nothing that waits, and its slowest
test is a quarter second. Budgeting fifty model checks that no clock can reach is
ceremony, and ceremony is how a rule stops being read.

---

## E. The budgets

45 declarations. Measured across five full runs of `tests/net`; each
`measuredSeconds` is the **worst** reading, per q7-01's rule — an understated
record quietly spends part of the ×10 allowance before the runner ever gets it.

| test | measured (worst of 5) | budget |
|---|---|---|
| `rtt-decomposition` › measures the NETWORK round trip | 4.3 | **45 s** |
| `latency-feel` › holds its feel thresholds at 150 ms | 2.8 | **30 s** |
| `lifecycle-latency` › stops predicting the dead ship | 2.2 | **25 s** |
| `latency-feel` › holds them at 250 ms | 2.0 | **20 s** |
| `latency-feel` › the jitter buffer sizes itself | 1.8 | **20 s** |
| `online-2p` › runs end-to-end, each client predicting | 1.9 | **20 s** |
| `playtest-log-online` › records a healthy match | 2.0 | **20 s** |
| `latency-feel` › the lead does not ratchet | 1.4 | **15 s** |
| `lifecycle-latency` › settles back to a quiet wire | 1.2 | **15 s** |
| `lifecycle-latency` › shows the other client a corpse | 1.4 | **15 s** |
| `online-allocated` › registers, allocates, and plays | 1.4 | **15 s** |
| `rtt-decomposition` › the composite, taken apart | 1.4 | **15 s** |
| `rtt-decomposition` › shows the player the network figure | 1.4 | **15 s** |
| `rtt-decomposition` › reports the server loop honestly | 1.1 | **15 s** |
| `rtt-decomposition` › returns to baseline after a stall | 1.1 | **15 s** |
| `lifecycle-latency` › runs the respawn countdown | 1.0 | **10 s** |
| `rtt-decomposition` › adds up | 1.0 | **10 s** |
| `rtt-decomposition` › keeps all three every second | 1.0 | **10 s** |
| `rtt-decomposition` › never widens on a hiccup | 1.0 | **10 s** |
| `single-volley` › never shows two shots for one pull | 0.9 | **10 s** |
| `economy-conservation` › balances every tick | 0.8 | **10 s** |
| `live-pin` › welcomes from BOTH machines as first hop | 0.7 | **10 s** |
| `latency-feel` › is quiet on a clean wire | 0.6 | **10 s** |
| `reconnect-resume` › a dropped player reclaims | 0.6 | **10 s** |
| *20 further tests* | ≤ 0.5 | **5 s (floor)** |

**Twenty of forty-five land on the floor.** That is the check that this is a
sweep and not a blanket bump — and it is a floor that `main` today does not even
have, because the tests that most needed it were the ones declaring nothing.

`playtest-log-online` › healthy match is the one budget set above its observed
cost (0.5–0.8 s over five runs, declared 2.0 s). The reason is structural rather
than a stopwatch reading: the wait is on a telemetry second finalizing, and those
are keyed on the **wall** clock, so the work is legitimately a fragment of a
second plus a whole one. A reading taken on a lucky phase understates it. The
`work` line says so in place.

**Two tests got measurably cheaper while proving the same thing.**
`online-orders` 1.59 s → 0.40 s and `satellite-visibility` 1.51 s → 0.41 s: those
five `sleep()`s were spending 1.2 s each waiting for something that had already
arrived.

---

## F. What is not claimed

- **The runner is not measured here.** Every figure is in-container. The ~6×
  ratio is the brief's reproduction; the budgets are sized from it at the top of
  the band LESSONS §5 records, and the first CI run on this branch is the check.
- **`src/` and `server/` are unchanged apart from one added unit test.** The
  telemetry fragment behaviour is *pinned*, not altered: a fragment second with a
  null RTT is correct — the sample really is incomplete — and the client that
  pastes it into a log reads it correctly already (`rtt` is rendered as null, and
  `src/net/playtest-log-attach.test.ts` has said so since it was written).
- **Nothing in `src/bots/` was touched**, and nothing needed to be. The p15-02
  correlation was coincidence; the probe above reproduces the failure with the
  bots doing nothing at all.
- **The `online-lobby-flow` server-side seat leak stays flagged, not fixed.** The
  NOTE at `online-lobby-flow.test.ts:337` about a lobby socket close never
  reaching `Room.disconnect` is `server/`'s to fix and is out of this branch's
  scope; this branch only made the test around it wait honestly.

---

## G. Reproduce

```
npx tsc --noEmit
npm test -- --run                                    # 220 files, 3352 tests
for i in 1 2 3 4 5; do npx vitest run tests/net/playtest-log-online.test.ts || exit 1; done
```

All three green on this branch. The five-run loop is the one that matters: a race
that survives is a race that fails there.
