# a1-13 — three features shipped in a night, none of them yet seen working

Merged is not shipped. Three things landed and none was attested on a served
build: the VFX layer finally constructed (`a2-07` / #371), the CONNECTION LOST
overlay finally installed (`n6-01` / #370), and a lighter renderer
(`a1-11` + `a1-12` / #373, #374). Everything here was captured against the live
GitHub Pages deployment, never a lane checkout:

    https://imaginethegames.github.io/planet-rush/

## The gate — and the deploy that moved under it

**The site redeployed in the middle of this round.** The first three captures ran
against `ecc1496`; at about `14:31Z` `version.json` began answering `ffc414e`
(#375, `n7-01` delete-dead-wood) and everything after that ran against it. That
is not a problem to hide, it is a fact to record: **each item names the sha its
own frames were taken on, read off the page itself** — `__planetRush.build.sha`
and the in-frame badge — and both shas are gated independently:

| file | claimed | served | files compared | verdict |
|---|---|---|---|---|
| `served-source-check-ecc1496.json` | `ecc1496` | `ecc1496` | 12 | all identical |
| `served-source-check.json` | `ffc414e` | `ffc414e` | 12 | all identical |

The gate is a1-06's and it is stronger than either self-report: the client ships
sourcemaps, a sourcemap carries `sourcesContent` — the original source of the
code on the page — so `verify-served-source.mjs` byte-compares the served source
against `git show <sha>:<path>` for every non-test `src/` file the four merges
touched. Both runs: twelve of twelve identical, including `src/render/cull.ts`
(did not exist before #374) and `src/net/link-loss-attach.ts` (the wire that did
not exist before #370). `#373` merged into the a1-12 branch rather than into
main, which is why `git log --grep "#373"` on main finds nothing; the a1-11
commits `0c1cfc1..b229e41` are all ancestors of both shas.

`ffc414e` deletes only `src/net/spike/*`, so all three features are in it.

**Do not gate on the bundle filename** — `vite.config.ts` injects a build *time*,
so the content hash moves on every build at identical source. a1-06 nearly filed
that as a stale deploy.

## What the round found

| # | claim | verdict |
|---|---|---|
| 1 | `shipExplode` and `oreCollect` draw on the live build | **verified** (`ecc1496`) |
| 2 | CONNECTION LOST arrives, and ABANDON gets you out | **verified** (`ffc414e`) |
| 3 | the overlay offers RECONNECT | **failed** (`ffc414e`) — it is never drawn |
| 4 | the renderer submits tens of draw calls, not hundreds, at 390 px | **verified** (`ffc414e`) |
| 5 | the specific bench figures (10.9 desktop, 660→11 entities) | **inconclusive** (`ffc414e`) |

## Three instruments that had to be thrown away first

Every one of these produced a confident number that was wrong, and each is
written up in the header of the script that replaced it, because the failure is
the reusable part.

1. **`page.screenshot()` cannot photograph a VFX burst.** ~1.1 s per shot on this
   GPU-less box; the earliest frame landed 1169 ms after the kill, with the burst
   over and the RESPAWNING banner across the wreck. The tally said
   `shipExplode: 2` and the picture showed no explosion.
2. **CDP screencast is faster and its clock disagrees with the page's.** The
   in-page tally moved 79 ms after staging; screencast frames stamped 248, 475 and
   721 ms still showed the ship intact. A frame is evidence for a counter only if
   the two share a clock. Frames are now taken in-page, in the same
   `requestAnimationFrame` that reads the tally.
3. **A gag on a link that was already dead.** `routeWebSocket` reported "no
   CONNECTION LOST for 41 s" — and the socket probe showed the page's socket had
   already been silent 7.0 s, had taken 8 frames in a whole match, and sat at
   `readyState: 2` before the gag was flipped. Then, with the proxy removed
   entirely, a **one-human room did the same thing unaided**: `probe-socket.mjs`
   watched the match socket close **1006, unclean, no reason** about 8 s after
   CREATE, and the match run 60 s more on 7 frames ever received.

So the link-loss runs use two real humans in a real room, and `requireLiveLink`
refuses to start the experiment unless the guest's socket is OPEN and taking
frames — it measured 126–128 frames per 4 s on every leg that was kept.

## The one intervention this round makes to the served page

`capture-vfx.mjs` forces `preserveDrawingBuffer: true` on the WebGL context, or
`drawImage` returns black and there are no frames at all. It changes whether the
drawn buffer is kept, not what is drawn into it, which emitter runs, or whether
the layer is on the stage. Every image in item 1 was taken through it. Nothing
else here modifies the page: the link-loss and draw-call runs read only.

## Files

| file | what |
|---|---|
| `verify-served-source.mjs` | the gate |
| `served-source-check-ecc1496.json`, `served-source-check.json` | its two runs |
| `capture-vfx.mjs`, `readback-vfx.json` | item 1 |
| `zoom-strip.mjs` | analysis helper — nearest-neighbour magnification, no interpolation |
| `capture-linkloss.mjs`, `readback-linkloss.json` | items 2 and 3, five legs |
| `probe-socket.mjs`, `readback-socket-probe.json` | the untouched one-human socket |
| `capture-drawcalls.mjs`, `readback-drawcalls.json` | item 4, both profiles |
| `capture-drawcalls-density.mjs`, `readback-density.json` | the density sweep, and why it did not answer what it was for |

## What is still open

- **The density sweep did not test density.** It ran 12 minutes at 844×390 to
  watch draw calls as waves arrived, and the unpiloted client was ELIMINATED at
  about 2.5 minutes — a1-06's own trap, repeated. Samples 0–2 are the match
  (16.95–16.98 draw calls/frame); everything from sample 3 on is the end screen,
  and the "drop" from ~17 to ~13 is a menu, not a cull. Closing it needs a client
  that stays alive, which needs a flown ship.
- **The one-human room's 1006 close** (`probe-socket.mjs`) is a netcode question
  this round only observed. It is not filed as one of the five verdicts because
  it is not what the brief asked about, and it deserves its own round.
- **`rttMs` read null in the badge on every online client here**, where a1-06 saw
  `602ms` in-frame. Not chased.
