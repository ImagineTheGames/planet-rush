# The region picker — measured, not inferred

**Owner:** Netcode Engineer. **Status:** built (n3-01, `agent/netcode/n3-region-picker`).
**Ratified direction** (developer's question, 2026-07-30) — auto edge-inference
(m10-15a) is the default and **stays**; this adds *agency* on top of it:

> 1. CREATE shows each fleet region with a LIVE measured ping ("GRU 38ms · IAD
>    224ms") — the client pings each region's host on lobby open; default
>    selection = lowest; one tap to override. The override rides the allocate
>    body's `region` field (already wins over inference).
> 2. Joiners see the room's region + their measured ping to it on the JOIN screen
>    BEFORE committing (the host's region is the room's ping profile for every
>    guest — surface it, don't surprise them).
> 3. The regions list comes from the allocator (`/regions`) — no hardcoding; a new
>    fleet region appears in the picker automatically.
> 4. Tests: measurement fallback when a region host is unreachable; default =
>    lowest measured; override honored end-to-end.

Companions: `docs/hosting-plan.md` (the fleet this reads), `docs/netcode-spike.md`
(the day-0 rule this obeys — measure it), `docs/lobby-ping.md` (the same instinct
one screen later: the per-seat ping in the lobby).

---

## 1. Why this is a measurement and not a table

The client could have shipped a geo-IP guess, or a hard-coded "US East is 40ms
from most people". It has been bitten by exactly that shape of thing already: the
client used to send a hard-coded `region: 'iad'` on every `POST /rooms`, which was
not a preference but a **pin**, and it placed a creator in Minas Gerais on a
Virginia box on purpose (m10-15a). A number nobody measured is a claim, and a claim
about someone else's network is usually wrong.

So the picker prices each region the only honest way: **it times a real HTTP round
trip to a machine in that region**, from the player's own device, on the screen
where the choice is made.

## 2. What is timed

`GET /health` on the match server — the plain-HTTP route that exists precisely so a
check never has to speak WebSocket (`server/index.ts`). It is the closest reachable
thing to the socket the match will actually use: same process, same port, same
datacentre.

Four properties make the number mean what it says. (Three, until a0-29 found that
the missing fourth was inverting the ranking — §8.)

| Rule | Where | Why |
|---|---|---|
| **Min of N** (N = 3) | `src/net/region-probe.ts` | The first sample pays TLS and (behind an edge) a CORS preflight. A mean would report that setup cost as the region's latency forever; the minimum is the closest thing to the wire's real round trip. |
| **One probe in flight at a time** (a0-29) | same | Behind an edge every region shares one origin, so overlapping probes queue on one connection and the *near* region is charged the *far* region's flight. This is the one that shipped broken — see §8. |
| **Verify the answering region** | same | Behind anycast, an ignored steer would otherwise be measured as "gru is 12ms away" when what was timed is the nearest POP. `/health` states its own `region`; a mismatch is **not a measurement** (`wrong-region`), and reads as `—`. |
| **Absent, never zero** | same | `0ms` on an unprobed region reads as the best server in the fleet. The lobby's per-seat ping refuses the same lie (`docs/lobby-ping.md` rule 1). |

## 3. How a client reaches one region out of a fleet

This is the one genuinely vendor-shaped corner, and it lives in exactly one file —
`allocator/probe-target.ts`, beside `allocator/router.ts`, which has the same shape
for the same reason. `GET /regions` now publishes, per region, a **probe
descriptor**: a URL and the headers that steer a request into that region.

* **On Fly** every client reaches one anycast hostname, so a plain GET measures the
  nearest edge and never the region behind it. The steer is the documented
  `Fly-Prefer-Region` request header. Because the client *verifies* the answering
  region (above), an edge that ignores the steer produces a blank, never a
  flattering number — the feature degrades to "unmeasured", which is a state the
  whole design already handles.
* **Off Fly** — the €4 VPS, a laptop, the Oracle free tier — a Machine has its own
  address and needs no steer: the probe URL is that Machine's own `/health`,
  derived from the same `MATCH_URL_TEMPLATE` the socket dial is built from. One
  variable configures both, so the dial and the ping cannot point at different
  fleets.

The client is vendor-blind: it fetches a URL with some headers and times it.

**CORS.** The probe times the *match server* from the GitHub Pages origin, so
`/health` needed a browser grant it never had. Rather than a second copy of the
allocator's rule, both processes now share `src/net/cors.ts` (as they already share
`fleet-auth` and `ticket`). The preflight's day-long cache is load-bearing: a probe
paying a preflight per sample would measure the preflight.

## 4. The four rules the picker keeps

1. **Absent, never zero** — an unmeasured region prints `—`.
2. **An unmeasured region is never the default.** With *nothing* measured there is
   no default at all, so the allocate carries no `region` field — which is exactly
   the edge-inferred placement of m10-15a. **The picker sits on top of the
   inference and can only ever degrade back to it.**
3. **An unmeasured region is still choosable.** It has no number, not no existence.
4. **The list is the fleet's.** `GET /regions` is the only source; no region code
   appears in the client. A new fleet region appears in the picker the day it
   registers, and the one-region launch config keeps the picker suppressed *by
   count* (`regionPickerVisible`), not by a flag.

## 5. The JOIN half

A joiner places nothing: the room is where its creator put it, and **the host's
region is the ping profile of every guest**. So the JOIN screen reads the room's
advertisement (`GET /rooms/:code`, the body `probeRoomLiveness` already threw away)
the moment a full code is typed, and says — before the player commits —

```
ROOM IN GRU · YOUR PING 38ms
```

using the same measurement the picker made. It **decides nothing**: `readRoomAdvert`
is advisory by construction, and the join round trip stays the only thing that can
refuse a player (it already distinguishes full / gone / offline with copy for each).

## 6. Where each piece lives

| File | What it owns |
|---|---|
| `allocator/probe-target.ts` | The vendor seam: how a region is addressed for timing. Fly steer vs. a Machine's own URL. |
| `allocator/index.ts` (`/regions`) | Publishes capacity **+ probe target** per region. Additive: an old client ignores the key, and a deployment with no targeter answers the shape it always did. |
| `server/index.ts` | The CORS grant on `/health`, and its preflight. |
| `src/net/cors.ts` | The grant itself, shared by both processes. |
| `src/net/region-probe.ts` | The measurement, the ranking, the default, and the two lines of copy. |
| `src/net/allocator-client.ts` | `readRoomAdvert` — the JOIN screen's read. |
| `src/main.ts` | The wiring: survey on lobby open, the override into the allocate body, the preview on the JOIN screen, and the `__onlineMenu` seam. |

## 7. What is NOT in this change

**The picker's plates.** Drawing a row per region, with a tap target on each, is
`src/ui/`'s — the netcode lane does not draw. What this change delivers is
everything underneath and one line of text through the message slot the doors
screen already has (`GRU 38ms · [IAD 224ms]`, the selection bracketed), plus the
seam a picker binds to:

```ts
__onlineMenu.regions          // [{ id, label, pingMs }] — fastest measured first
__onlineMenu.regionSelected   // the id a CREATE will send, or null
__onlineMenu.regionLine       // 'GRU 38ms · [IAD 224ms]'
__onlineMenu.regionPickerVisible
__onlineMenu.selectRegion(id) // the override; ignores an id the fleet does not advertise
```

`crossRegionWarning` and `RegionInfo` in `src/ui/online-copy.ts` were built for
this day and are unchanged — the model they anticipated now has real numbers in it.

**A live Fly verification of the steer.** `Fly-Prefer-Region` is documented and the
client verifies the region that answers, so a fleet where it does not work reports
`—` rather than a wrong number. That verification is a *runtime* one; it has not
been observed against the live fleet from this branch, which currently runs a
single region (there is nothing to pick between). The check to run when the fleet
grows past one region:

```bash
curl -s -H 'Fly-Prefer-Region: gru' https://planet-rush-gameserver.fly.dev/health | jq .region
curl -s -H 'Fly-Prefer-Region: iad' https://planet-rush-gameserver.fly.dev/health | jq .region
```

Two different answers ⇒ the steer works and both regions measure. The same two
answers ⇒ every region but that one reads `—`, which is the honest failure and not
a wrong number — and the fallback to fix it is a per-region hostname in
`MATCH_HEALTH_URL`'s place, which is a config change in one file.

---

## 8. a0-29 — the correction, and the steer verified live

**Nothing above is retracted.** The ratified direction, the four rules, the
`length > 1` suppression and the `__onlineMenu` seam are all unchanged and all
verified working on the live build. What follows corrects one factual claim in §2
and closes the open item in §7.

### The defect

From the United States the picker ranked **São Paulo above Virginia**. The
developer's own phone, in Florida, on 5G:

```
[GRU 218ms] · IAD 229ms          ← GRU selected, an 11 ms gap
```

Virginia is ~1,300 km from Florida; São Paulo is ~6,500 km. An 11 ms gap is not
possible, and two distant regions reading nearly the same — both far too high —
is the tell that the number is dominated by something other than the network path.

### The cause

§2's "min of N" is true and was never the problem. The problem is that
`measureRegionPings` fired the regions **concurrently**, on the reasoning that
they are different hosts. **Behind an edge they are not.** §3 says it plainly and
the consequence was missed: every region shares one anycast hostname and differs
only by a steer header, so a browser puts every probe on **one connection to one
POP**. Concurrent probes then queue against each other on it — and asymmetrically,
because a 75 ms request stuck behind a 180 ms request is *measured* at ~255 ms
while the 180 ms one is barely touched. The near region is dragged up to the far
region's number; the far region keeps its own. The ordering does not get noisier,
it gets destroyed.

Measured from Florida, real browser, cold, three rounds each
(`spikes/a0-29-region-ping/browser-lab.mjs`):

| shape | `gru` | `iad` | order |
|---|---|---|---|
| concurrent (as shipped) | 257 / 255 / 253 | 254 / 259 / 234 | coin flip — right twice, wrong once |
| **warm-up, then concurrent** | 258 / 253 / 255 | 256 / 260 / 258 | **still inverted 2 of 3** |
| serial | 186 / 180 / 182 | 78 / 75 / 78 | correct 3/3 |
| **round-robin serial** | 187 / 183 / 180 | 76 / 74 / 74 | **correct 3/3** |

Note row 2: **warming the connection does not fix it.** The cost being measured is
the other region's flight, not the handshake — so only removing the overlap works.

### The fix

`measureRegionPings` samples **round-robin, one probe in flight at a time**, with:

* **a warm-up per distinct origin** — untimed, headers and all, so TLS *and* the
  CORS preflight are banked before any clock starts. Min-of-N sheds setup only
  when every sample lands; a region that keeps one sample out of three must not
  report the handshake as its latency.
* **a whole-survey wall-clock budget** (8 s) — the price of being serial is that
  one dead region can delay the live ones. The budget can only ever produce
  *fewer* numbers, never a wrong one: a region already measured keeps its number,
  and one the budget never reached reads `—`. Rules 1–4 are untouched, and a
  failed probe still cannot block hosting.

Round-robin rather than region-by-region because region-by-region always charges
the connection's setup to whichever region the allocator happened to list first.

The real bundle against the deployed fleet, same command, only the scheduler
differing (`tests/live-stage/region-order.spec.ts`):

```
concurrent   [GRU 255ms] · IAD 260ms   selected gru   FAILS
serial       [IAD 153ms] · GRU 276ms   selected iad   PASSES
```

### §7's open item, now closed

The live steer verification §7 asked for has been run, from Florida, against the
two-region fleet:

```
$ curl -s -H 'fly-prefer-region: iad' https://planet-rush-gameserver.fly.dev/health
{"region":"iad", …}          204 / 205 / 177 ms
$ curl -s -H 'fly-prefer-region: gru' https://planet-rush-gameserver.fly.dev/health
{"region":"gru", …}          275 / 413 / 406 ms
```

**Two different answers: `Fly-Prefer-Region` works**, both regions measure, and no
per-region hostname is needed. The `—` fallback §7 describes stays as the honest
failure it always was, and is now only reachable if the edge stops honouring the
header.

---

## 9. n11-01 — when each screen may have the numbers

`a1-17` photographed a browse row reading `IAD —` and reported that the list is
handed no ping. It is handed one. What it was not handed was one *yet*: the
lobby browser's first listing lands in ~0.6 s and this survey answered only after
its **last** sample. That gap is a state every consumer of this module meets, so
it is written down here rather than left to the order two network reads happen to
finish in.

### The defect, exactly

`src/ui/lobby-browser.ts` `rowWhere` prints a region's **place name** when it has
a measurement (`VIRGINIA 153ms`) and falls back to the raw **code** when it has
none (`IAD —`). a1-17's own readback carries the proof that the second is what was
photographed: `guestListWaitMs: 42` — the row was read 42 ms after the listing
landed — with `"regions": []` and `"regionLine": ""`, so neither the row nor the
doors' picker had been told anything yet. Reproduced live, unchanged, two real
clients: row at 613 ms reading `IAD —`, number at 1748 ms reading
`VIRGINIA 161ms`.

Serial sampling is why: 1 warm-up + 3 samples × 2 regions = **7 round trips**
before a survey that only answers at the end. **That stays serial** (a0-29 is what
the ordering costs, and it is not for sale).

### The sequence, stated

`measureRegionPings` publishes at every **completed round**
(`RegionProbeOptions.onRound`; `surveyRegions` ranks it as `onSurvey`), so:

| when | what every region carries | what a browse row prints |
|---|---|---|
| before the first round | nothing has been timed | the region, no number — `IAD —` |
| after **round 1** (3 requests) | a measured round trip **or** the reason it has none | `VIRGINIA 259ms`, or `IAD —` for a region that failed |
| after each later round | the same, with the min-of-N settling **downwards only** | the number, refining |
| budget spent mid-round | that round is **not** published; whatever was measured stands | unchanged from the last whole round |

Two rules make this safe rather than merely fast. A round is published **whole or
not at all** — every region has then had the same number of attempts, and ranking
two regions on unequal evidence is a0-29's unfairness in a different costume. And
a published number can only ever fall, so a row never has to un-say something.

**Rule 1 covers the first line of that table.** *Not measured yet* is one of the
ways a region has no number, and it prints exactly what *could not be measured*
prints: the em dash, never `0ms`. A screen that wants to distinguish "measuring"
from "unmeasurable" needs a third state of its own — that is `src/ui/`'s call, not
this module's, and this module now makes it cheap by ending the ambiguous window
after one round instead of three.

### Measured, before and after

Interleaved A/B on the live fleet, three guests per build, deployed bundle against
the branch (`evidence/n11-01-browse-row-ping/`):

```
BEFORE   row drawn with no number for 1633 / 1552 / 1547 ms   (median 1552)
AFTER    row drawn with no number for    0 /    0 /    0 ms   (median 0)
probe requests completed when the number appeared: 6,6,6  →  2,3,6
```

The request count is the claim that survives a busy machine: a whole survey is 7
requests and a first round is 3, and no amount of latency moves that.

### And two joins hardened while here

* **A region id is keyed one way.** A row finds its ping by matching the room's
  region against the measured fleet, and `/regions` and `GET /rooms` are different
  allocator code paths. Both are now normalised (trimmed, lower-cased) where they
  are parsed, so `IAD ` and `iad` cannot become two regions to a lookup and one to
  everyone else. Display is untouched — `formatRegionPing` upper-cases it back.
* **An empty fleet never replaces a measured one** (`src/main.ts`). `surveyRegions`
  answers with no regions for an allocator that is down, older than `/regions`, or
  answering nonsense; that is a fact about the allocator, not about anybody's ping,
  and letting it through dropped every row back to `IAD —` mid-session for a
  hiccup.
