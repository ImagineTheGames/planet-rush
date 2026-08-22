# a0-131 — the first time two clients in one match were photographed

Five sweeps (a0-96, a0-99, a0-111, a0-118, a0-127), dozens of attestations, eleven
defects — and every camera this studio has pointed has been at **one client
playing offline**. The richest seam of real bugs this project has is an online
session, and until now nothing but the developer has been down it.

Everything here comes off the **production bundle** (`vite build`, `vite preview`)
built against a **real local fleet** — `tests/net/local-fleet.ts`: a real
allocator, a Fly-shaped edge, and two ticket-enforcing Machines — with **two
browser contexts against one room over real WebSockets**. Profiles are a0-111's,
unchanged, so a finding here is comparable with every earlier sweep: **HOST** is
desktop 1280×800 dpr2 pointer, **JOINER** is phone 798×384 dpr2 touch. No
capture passes `?freeze=1` (`src/main.ts` sets `buildBadge.visible = !flags.freeze`,
so a frozen frame is one with the stamp deliberately hidden), and none passes
`?debug=1` (it skips the main menu, which is the screen this whole brief is about).
The stamp `01a8353` is in the corner of every frame.

## The six things the brief asked for, and how they came back

| # | Asked | Verdict |
|---|---|---|
| 1 | the join path, end to end, both clients | **verified** — and the code on the host's screen is the code the joiner typed |
| 2 | both clients, one moment, both ships on screen | **verified** — every figure the two screens share agrees, and both ships are on both screens once the phone widens to `VIEW 2×` |
| 3 | a shot fired by the OTHER player | **inconclusive** — one shot caught, heading agrees within ~2°, but not tracked across frames |
| 4 | disconnect, and rejoin | **failed** — a fresh client is refused from a running match |
| 5 | the lobby as the guest sees it, and no "claim" | **verified** — zero hits in 2,930 rasterised strings |
| 6 | a bots-only online match | **verified** — the game answers in words: `NOBODY JOINED — PLAYING LOCALLY` |

**Four of the six came back verified.** Three further defects are in the manifest
as their own entries, all of them disagreements between the two clients:

- **A fresh client cannot rejoin a running match** — `REFUSED: match-live — that
  match already started`, against the developer's standing ruling. The *same*
  client whose socket returns inside the grace window does recover; that is a
  separate entry, because the answer needs both sentences.
- **A dropped client is told nothing.** Thirty seconds after the cut its frame is
  identical to the moment of the drop — clock stopped at `MATCH 1:16`, no banner,
  no explanation. The host is not told either: the only visible change anywhere is
  the rival station's minimap blip going dark.
- **At the shipped `VIEW 1×` the phone player cannot see who is shooting them.**
  416 world units of separation fits in the desktop's 1280-wide view and not in
  the phone's 798. One tap on the phone's own VIEW control fixes it; the desktop
  has no such control and never needs one.

## How to re-run it

```
LOCAL_FLEET=serve LOCAL_FLEET_PORT=8891 LOCAL_FLEET_EDGE_PORT=8892 \
  npx vite-node tests/net/local-fleet.ts &
VITE_ALLOCATOR_URL=http://127.0.0.1:8891 npx vite build
npx vite preview --port 4318 --strictPort &

node evidence/a0-131-online-with-eyes/capture-match.mjs        # items 1, 4, 5
node evidence/a0-131-online-with-eyes/capture-together.mjs     # item 2
node evidence/a0-131-online-with-eyes/capture-remote-shot2.mjs # item 3
node evidence/a0-131-online-with-eyes/capture-words.mjs        # the "claim" census
node evidence/a0-131-online-with-eyes/capture-bots.mjs         # item 6
node evidence/a0-131-online-with-eyes/plates.mjs
node evidence/a0-131-online-with-eyes/manifest-entries.mjs
```

`shots/` holds the specimens the plates are cut from and a JSON readback beside
each — pruned to the frames the manifest cites, because a full run is ~300 MB.
`plate.mjs` crops nearest-neighbour and halves frames by dropping every other
pixel; nothing is resampled, nothing is annotated. Captions live in the manifest,
where they can be read as words rather than trusted as pixels.
`capture-duel.mjs`, `capture-shots.mjs`, `capture-fire.mjs`,
`capture-screencast.mjs` and `capture-remote-shot.mjs` are the stagings that
**failed**; they are kept because their headers carry the reasons, and the next
sweep should not pay for them twice.

## Seven traps this run hit, written down so the next one doesn't

**The doors need an allocator, and `?server=` is not it.** `src/net/server-url.ts`
looks like the way to point a client at a local server, and for the *direct-connect*
path it is. The CREATE/JOIN doors never consult it: `startResolve()` opens with
`const base = allocatorUrlFromEnv(); if (base === null) … failOnline('network')`.
A bundle pointed at a bare `match-server.mjs` photographs the "can't reach the
servers" refusal and nothing else. Use the local fleet and bake `VITE_ALLOCATOR_URL`.

**Chromium launches here.** `tests/live-stage/build-badge-online.spec.ts` records
that its authoring lane could not launch a browser (no `libnss3.so`, no root), so
that spec has never been executed. It runs in this lane. That was checked *first*,
before anything was built, and it is the reason this brief was possible at all.

**WASD moves nothing.** Held for 38 s online and again offline, the ship did not
shift a pixel. The shipped desktop control is the strip's own line — `Click
anywhere · Move or attack`. A click sets a waypoint and the ship flies there and
**stops**; clicking again before it arrives only replaces the waypoint, which is
how the first attempt overshot the entire arena and pinned itself to the west wall.

**Two ships can never be in one frame at their spawns.** One world unit is one CSS
pixel (`src/ui/viewport.ts`), so the desktop sees 1280 units across and the phone
798 — and The Ring at two seats spawns the seats 1728 apart
(`src/sim/maps.ts` + `mulberry32`, computed: seat 0 ship at (1968,1200), seat 1 at
(432,1200)). They have to be flown together, and the arithmetic has to be done
before the camera is pointed.

**The world centre is an asteroid belt.** The obvious rendezvous — fly both ships
to (1200,1200) — killed both of them simultaneously at `MATCH 0:32`. Meet in open
space between a station and the centre instead.

**An idle client never fires.** Four stagings parked a stationary joiner beside the
host and waited for a fight that was never going to start: on the default scheme a
ship only shoots **when it is ordered to**, so a player who touches nothing is a
target and not a combatant. Whoever is meant to shoot has to be driven.

**Two instruments that lie about the picture.** (1) At ~420 units apart the two
ships do not fire at all — weapons range is shorter than that, so a burst taken
there is a burst of two ships ignoring each other; the hulls sit unchanged at
12/50 and 15/50 for eight consecutive frames. (2) The phone's CDP screencast frames
come back **1596×384 inside a 1596×768 canvas** — horizontally stretched 2× — and
**no angle may ever be measured off them**. Plain `page.screenshot()` is
undistorted and, in this lane, loses nothing: the client's own measured rAF rate
is **2.7–2.8 frames per second**, which is why no single bolt could be followed
from one frame to the next and why item 3 is inconclusive rather than clean.
