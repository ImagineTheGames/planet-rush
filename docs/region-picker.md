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

Three properties make the number mean what it says.

| Rule | Where | Why |
|---|---|---|
| **Min of N** (N = 3) | `src/net/region-probe.ts` | The first sample pays TLS and (behind an edge) a CORS preflight. A mean would report that setup cost as the region's latency forever; the minimum is the closest thing to the wire's real round trip. |
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
