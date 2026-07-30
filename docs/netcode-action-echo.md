# Every action happened twice — the M10 action-echo pass

**Owner:** Netcode Engineer · **Branch:** `agent/netcode/m10-action-echo` ·
**Reported by:** the developer, from a mobile playtest

> *"Shooting produces 2 sets of shots; my health went down then back up after
> taking damage; turrets built instantly and I built 2 but 3 got built."*

Three symptoms, one defect class, named exactly right in the brief: **a predicted
side effect and its authoritative echo were never matched, so both existed.**

Position never had this problem — a snapshot *overwrites* a ship, so authority's
answer replaces the prediction by construction. A side effect is different: it is a
*thing that came into being*, and a client that makes one and a server that makes
one make **two** unless something says they are the same thing.

Seven distinct causes were found. Five of them were multipliers on the *client's
own* screen and never crossed a wire at all, which is why the milestone's earlier
audit (`docs/netcode-audit.md`) did not catch them: it was reading the wire.

---

## 1. The client's reconcile was buying things

`PredictedMatch.reconcile` rewinds the world's **clock** — tick, sim time, RNG,
entity counter — and replays every unacknowledged input on top of authority. A
`station.builds` entry is not in that checkpoint and could not be without copying
the whole world every tick. So the build job an order created was still standing
when the replay re-ran the press that created it, **and ordered another**. At 150 ms
RTT a press is replayed four or five times before its ack lands.

**Fix.** A one-shot order (`buildOrder`, `upgradeOrder`) is predicted exactly once,
on the tick it was pressed, and stripped from the replay. Replay exists to put the
ship where the player's hands have taken it; thrust, aim and fire are the only verbs
that answer that question. An order is a *fact already established*, owned from then
on by the ledger and by authority's echo of it.

## 2. Structural clocks were spent once per replayed tick — *"turrets built instantly"*

A turret assembles over ten seconds and it is a **countdown integrated per tick**
(`job.remaining -= dt`). Every replayed tick took another `dt` off it. Snapshots
arrive 30 times a second and each replays one round trip's worth of input — about
10 ticks at 150 ms — so construction ran at roughly **ten times** its real rate. A
ten-second turret landed in under a second, and it was not a display bug: the
*simulation* finished it early, so the entity was real and the server's entity event
then arrived on top of a turret the client already had.

The same clock class covers the repair gate (`REPAIR in 12s` re-arming ten times too
fast — *"my repair showed twice"*) and, worst of all, the **weapon cooldown**:

| clock | integrated as | consequence of replay at 150 ms |
|---|---|---|
| `BuildJob.remaining` | `-= dt` | turrets and shields finish ~10× early |
| `MiningStation.repairGate` | `-= dt` | the 15 s repair lockout expires in ~1.5 s |
| `Ship.weaponCooldown` | `-= dt` | **the gun fires ~10× too fast** |

The weapon cooldown is the one the developer *shot* at. The predicted ship fired a
far denser stream than the ship authority was flying — not a copy of anything, the
client's own invention standing beside the real shots.

**Fix.** These clocks are frozen across the whole rewind/replay and moved on by the
**net** time the reconcile advanced — which in a steady state is zero. Construction
takes the sim's real ten seconds online, exactly as it does offline (GDD §2.4, the
parity principle: the offline and online sim run the identical code).

## 3. The interpolation buffer was carrying the firer's own shots

The firer draws their own shots from prediction, and the reconcile path suppresses
authority's copy for exactly that reason (audit item 2b). **That suppression only
ever touched the `World`.** `TransportSession` hands each decoded snapshot to the
interpolation buffer *raw*, own shots included, and the presentation layer draws
whatever the buffer samples into the pool slots the wire owns. So the suppressed
copy took the scenic route, arrived a jitter buffer late, in different pool slots,
beside the predicted volley it was a copy of.

The buffer's own doc comment had claimed since the day it was written that own shots
were "absent from this stream by the time it gets here". They were not.

**Fix.** Dropped on **ingest**, so `hold`, `extrapolate` and `interpolate` cannot
disagree about it, and the buffered history a later frame lerps through is already
clean.

## 4. The predicted shot and the replayed shot were both kept

The carry rule matched them by entity id — but a rewind restores `nextEntityId`, so a
re-fired shot can come back numbered differently and walk straight past an id-keyed
dedupe. Measured: **five own shots alive on a screen whose sim can hold two**, and
one id standing in two pool slots at once.

**Fix.** Every tick the replay re-runs was predicted once already, so every own shot
the replay could produce was produced then and is already carried. **Carried in,
replayed out** — no id matching at all.

## 5. Structures: two turrets on one mount

A build job finishes on both sides and each mints its own entity id from its own
counter. The applier is correctly id-keyed and idempotent, so with an id it had never
seen it did the only thing it could: it added a second turret to a ring that had
already been paid for once.

**Fix** (`src/net/entity-echo.ts`). A station's structures are **authority's**
structures: the first time authority names an id, a predicted structure of the same
kind at that station steps aside for it. One in, one out. Turrets match on their
mount slot, which is a turret's real identity in this sim (the ring is capped at 4
and the sim picks the lowest free slot by the same rule on both sides).

## 6. Orders: two taps, three turrets

Two locks were missing, and the failure costs the player ore.

**The wire.** `InputQueue` dedupes on `(player, tick)`, which catches a retransmit
only while the copy still names the tick the original named. The server's own
late-input softening — a message whose tick has already been simulated is re-filed
onto the next unsimulated tick, so a lost packet race does not make a player's hands
go dead — hands that copy a **different** tick. The queue sees a first arrival, and
the sim validates the order exactly as it validated the first one.

**Identity.** Nothing in the protocol said "this is the same press you already ran".

**Fix.** `seq <= ackSeq` is dropped whole rather than re-filed (those actions have
already happened), and every one-shot order carries a client sequence id
(`@shared/types` `OrderId`, stamped in `src/net/session.ts`) that the room refuses a
second time. Orders without an id — bots, offline play, an older client — pass
through untouched.

## 7. The client re-used tick numbers, and the server dropped those messages whole

Found while chasing a test that had been flaking about one run in six (and was
flaking at the same rate *before* any of this milestone's changes — it was reporting
a real defect, not a slow machine).

`InputQueue` files by `(player, tick)` and keeps the first message for a pair —
correctly; two messages claiming one tick cannot both be that tick's input. But the
predicted clock is **not monotonic**: a lead trim rewinds it a few ticks
(`trimLead`), so the next input was stamped for a tick this client had already sent
one for, and the server dropped it silently. Measured on a real socket: **~4 % of all
input, in bursts.** A lost stick frame is invisible. A lost `buildOrder` is a purchase
the player made, was charged for locally, and that authority never heard — the wheel
press that "does nothing sometimes".

**Fix.** Input ticks only ever go up. The latency harness counts repeated input ticks
across both clients and the acceptance gate asserts zero.

---

## Hull is authority's

*"My health went down then back up after taking damage."*

That is prediction working exactly as designed, on the one quantity it must not
touch. The client runs the same `step()` the server runs and `step()` resolves
collisions, so a shot the client can see arriving takes HP off the local hull the
frame it lands. The next snapshot then states the hull the server actually has — read
one round trip earlier, before that shot resolved — and the bar pops back up. Thirty
times a second, for the length of the exchange.

And the reconcile is *right*: damage is decided by geometry the client does not have.
A remote ship's position is a jitter buffer in the past, its shots are drawn from the
same buffer, and spawn protection, shields and allegiance are all resolved
server-side against state this client only half knows. A hull the client predicts is
wrong more often than it is right, and being wrong about HP reads as a lie about the
fight.

So hull is **held** at authority's last word: written by the snapshot, re-asserted
after every predicted tick and every replay, never moved by anything local. There is
nothing to blend, which is the point — the bar only ever moves in the direction and
by the amount the server says, so it never rewinds.

## The order echo, and the three ways a prediction can end

`OrderEchoMessage` (`src/net/transport.ts`) is the server's answer for one identified
order: **accepted or refused**, on **which tick** (the authoritative birth tick a
spawned thing dates from), and **what it queued**. The outcome is *observed* rather
than reported by the sim — `step()` resolves orders internally and returns nothing,
and reaching into `src/sim/` to change that would be this lane writing in another
lane's file — so the room reads the world either side of the step and the difference
is the answer.

`OrderLedger` (`src/net/order-ledger.ts`) holds the client's side:

| ending | what happens |
|---|---|
| **accepted** | the predicted job is *adopted into* authority's — authority's id, authority's construction clock wound forward by the client's lead. One job, not two, finishing when the server's does. |
| **refused** | rolled back at once, visibly. The half-built ghost disappears: the truth arriving late. |
| **silence** | rolled back at a TTL sized from measured RTT. This is the one a client can only get wrong quietly, by leaving a turret assembling for the rest of the match. |

The TTL errs long (`2 × RTT + 4 × jitter`, floored at 0.5 s) because the cost of a
wrong rollback is taking away something the player paid for, and the cost of a wrong
wait is a stale prediction the next entity event corrects anyway.

## Mobile logs — the share sheet

*"The developer had NO way to send them."* COPY LOG has been on the pause menu since
the playtest-log brief, and on a phone its one route out was the clipboard: a 40 KB
JSON blob pasted into a chat app, on the platform whose clipboard rules refuse
`writeText` outside a narrow gesture window.

The export now tries **share → clipboard → download**, in the order a phone wants
them. `navigator.share` hands the OS a *named file*
(`planet-rush-log-<sha>-<time>.json`) and the developer picks the destination from
the sheet they already use. `canShare` is asked first, because a browser that refuses
a `files:` share rejects rather than degrades and that must cost the clipboard route
nothing. A dismissed sheet falls through silently. Still no `fetch` and no endpoint
anywhere in the feature.

### …and the button was sideways

`tests/live-stage/copy-log-touch.spec.ts` **has now run**, green, both tests, on the
phone profile against the shipped bundle. Getting it to run needed no root after all,
which is worth writing down because the same recipe unblocks `connect-trace.spec.ts`
and every other live-stage config in this lane:

```sh
# Chromium's binary is installed; 17 of its shared libraries are not, and
# `playwright install-deps` wants a root this box does not have. It does not need to.
apt-get -o Dir::State::Lists=/tmp/plibs/lists -o Dir::Cache=/tmp/plibs/cache update
cd /tmp/plibs/debs && apt-get -o Dir::State::Lists=/tmp/plibs/lists download \
  libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
  libcups2 libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libasound2 libwayland-server0 libxi6 libxtst6 libpango-1.0-0 libcairo2 \
  libgtk-3-0 libgdk-pixbuf-2.0-0 libepoxy0 libxshmfence1 libxcb-dri3-0 libxcb-present0
for d in *.deb; do dpkg-deb -x "$d" /tmp/plibs/root/; done
export LD_LIBRARY_PATH=/tmp/plibs/root/usr/lib/x86_64-linux-gnu
npx playwright test --config tests/live-stage/playwright.copy-log.config.ts
```

It earned the run twice over.

**The spec was asserting a payload that does not exist.** `parsed.entries` for
`events`, a `viewportWidth` number for the `"390x844"` string
`PlaytestLogEnvironment` actually carries. Both plausible, neither real, and nothing
else in the suite could have said so — the unit tests import the type, so they cannot
disagree with it. A test that has never executed is a claim, not evidence.

**And the affordance did not turn with the game.** Planet Rush is landscape on mobile
*always*: on a touch viewport held portrait the game root is rotated +90°
(`@platform/orientation`) so the player sees a landscape game however the phone is
held. Everything drawn *into* that root rotates for free. COPY LOG is DOM over the
canvas, laid out in physical space, and so was the one element on the screen reading
sideways — in the physical bottom-right, which under that transform is not the corner
it means. The screenshot is what showed it; no unit test was ever going to.

It now carries the rotation itself, as a media query stating the lock's own condition
(`pointer:coarse` is the `isTouch` `main.ts` hands `computeRootTransform`;
`orientation:portrait` is its `physH > physW`) — rather than wiring in from `main.ts`,
which is another lane's file, and which a pure media query cannot fall out of step
with. Logical bottom-right lands on the physical bottom-left, so the rule releases
`right`, anchors `left`/`bottom`, and turns about `left bottom` with a `translateX(-100%)`
that applies first, putting the element's right edge on the origin so it grows back
*into* the logical viewport instead of off its right edge.

A log the developer has to tilt their head to find is most of the way back to having
no way to send one.

## The gate

`tests/net/single-volley.test.ts` runs the full two-client stack at 150 ms / ±30 ms
jitter / 2 % loss and samples **every frame** on **both screens**. A final reading
cannot tell "one shot throughout" from "two for 300 ms and then one", and 300 ms is
the whole complaint.

```
===== ONE VOLLEY, TWO SCREENS =====
wire            : 150ms RTT, ±30ms jitter, 2% loss
trigger         : frame 40, held 3 frames (one shot)
columns         : ship shots owned by the firer, as drawn on each screen

  f 40  firer 0  rival 0  ·· | ··     trigger down
  f 44  firer 1  rival 0  █· | ··     the firer's own shot, immediately
  f 56  firer 1  rival 1  █· | █·     the rival picks it up a jitter buffer later
  f 72  firer 1  rival 1  █· | █·     one, and only one, on both screens
  f 76  firer 0  rival 1  ·· | █·     it expires on the firer's screen first
  f 96  firer 0  rival 0  ·· | ··
```

Alongside it: order idempotence under redelivery (`tests/server/order-idempotence`),
the ledger's three endings (`src/net/order-ledger.test.ts`), echo adoption and TTL
rollback and a build clock that takes two seconds to build two seconds of turret on a
150 ms wire (`src/net/order-prediction.test.ts`), structure adoption
(`src/net/entity-echo.test.ts`), the streamed-shot leak in every playback regime
(`src/net/shot-echo.test.ts`), and a four-snapshot fight in which every hull value the
player reads is one the server stated (`src/net/hull-authority.test.ts`).

`tests/live-stage/copy-log-touch.spec.ts` proves the export path on a phone profile
in the real bundle, and **it is green** — see the section above for the run and for
the two defects the run found. Evidence: `copy-log-touch-pause-evidence.png` and
`copy-log-touch-shared-evidence.png`, both portrait, both showing COPY LOG turned
with the game.
