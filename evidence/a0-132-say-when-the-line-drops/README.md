# a0-132 — when the line drops, both sides are told

a0-131 cut a joiner's link against a real local fleet and came back with two failed
verdicts, one on each side of the wire:

> **30 seconds after the joiner's link is cut its screen is frame-for-frame
> identical to the moment of the cut.**

> **the host plays on with no notice that the only other human is gone** — the one
> visible change is the other ship going still.

Both are reproduced here, on the same harness, and then photographed again with the
fix. Everything comes off the **production bundle** (`vite build`, `vite preview`)
against the same **real local fleet** a0-131 used (`tests/net/local-fleet.ts`: a real
allocator, a Fly-shaped edge, two ticket-enforcing Machines), two browser contexts,
one room, real WebSockets. Profiles are a0-131's, unchanged — **HOST** desktop
1280×800 dpr2 pointer, **JOINER** phone 798×384 dpr2 touch — so a frame here is
comparable with a frame there. No `?freeze=1`, no `?debug=1`.

Two builds, one staging, run back to back:

| tag | build | stamp |
|---|---|---|
| `before-*` | `origin/main` at the time of writing | `9e2e418*` bundle, pre-fix `src/net/link-loss-view.ts` + `server/room.ts` |
| `after-*` | this branch | same bundle build, both fixes in |

## What came back

| # | Question | Before | After |
|---|---|---|---|
| 1 | Does the dropped client say anything, at the cut? | **no** — nothing on screen | **yes** — `RECONNECTING…`, with RECONNECT NOW / ABANDON MATCH |
| 2 | …and thirty seconds later? | **no** — frame identical to the cut, clock stopped at `MATCH 0:13` | **yes** — the same card, `no server data for 31s`, seat held |
| 3 | When does the room tell the host? | **t+24.0 s** | **t+5.3 s** |
| 4 | Does the host's screen say it? | **no** | **yes** — `P2 — CONNECTION LOST · BOT FLYING` |

Plates in `evidence/images/`: `a0-132-joiner-at-cut-before-after`,
`a0-132-joiner-30s-before-after`, `a0-132-host-band-before-after`,
`a0-132-host-told`. Each stacks the same frame of the same staging, before on top.

## The finding that only a photograph could have made

The joiner's DOM readback is **identical on both builds**, at both instants:

```
before-04-30s.json  joiner overlay mounted True  title 'RECONNECTING…'  link redialing
after-04-30s.json   joiner overlay mounted True  title 'RECONNECTING…'  link redialing
```

Nothing was undetected and nothing was unsaid. The watchdog fired, the sim froze,
the model composed the right words, and `#pr-link-loss` was in the page at the full
viewport with `display:flex`, `visibility:visible`, `opacity:1` and
`z-index:2147483646`. It was **painted underneath the game**: `#app` is the
`document.fullscreenElement` — on touch, PLAY enters fullscreen, which is the
ordinary state of every online match a phone ever plays — and a fullscreen element
is in the browser's **top layer**, which no z-index outranks.
`document.elementFromPoint` at the centre of the joiner's screen returns the
`CANVAS`. This is a0-28, which `src/net/playtest-log-button.ts` already solved for
the DOWNLOAD LOG button and which this later overlay never got.

That is why five sweeps of unit tests stayed green through it: **no fake DOM can
paint**, so no fake DOM could see it. The new unit test therefore asserts the rule
that decides the painting — which box the card is appended to — rather than the
painting itself.

## What an emulated cut does and does not cover

The drop is **emulated**: `context.setOffline(true)`, the same instrument a0-131
used, and no attestation here calls it a real network cut. Measured, not assumed:

- **What it does cover.** No packets cross in either direction, which is the whole
  of the client's case. Chromium also fails the WebSocket to the renderer
  immediately, so the joiner sees `onclose` at once (`link: reconnecting` by the
  first frame after the cut, before its own 2.5 s silence rule could fire).
- **What it does NOT cover — and this is the half that matters for the room.** It
  sends **no FIN to the server**. The wire capture proves it: the room learned
  nothing for 24 s on the old build, which is `server/ws.ts`'s keepalive
  (`PING_INTERVAL_MS` 20 s + `PONG_TIMEOUT_MS` 15 s), not a hang-up. So the emulated
  cut happens to reproduce the real mobile drop *on the server side* — a screen
  lock, a backgrounded tab and a cellular loss are all silent in exactly the same
  way — while being *unrepresentatively kind* on the client side, where a real drop
  gives no `onclose` at all and the client must fall back on silence.
- **What neither covers.** A cut that recovers, a half-open socket that resumes
  mid-flight, and any real radio. Those want a device on a real network.

Because of the third point the client's silence path is proven where it can be
proven exactly — in node, over a real socket blackholed at the TCP layer with both
connections held open, in `src/net/session.test.ts`. That harness is the one that
measured the room's old 34.8 s worst case; the 24.0 s here is the same mechanism
caught at a luckier point in its 20 s ping cycle.

## Two traps, written down so the next run doesn't pay for them

**The host's telling is a five-second transient, and a sparse capture photographs
the wrong answer.** `src/ui/peer-presence` `PRESENCE_TELL_SECONDS` is 5, so the
banner is gone well before a0-131's +30 s instant — at that frame the host's screen
is legitimately clear on both builds, and the first version of this capture read
that as "still broken". The dense window exists for that reason and takes the host
alone.

**A screenshot costs seconds in this lane.** a0-131 measured the client at 2.7–2.8
rAF fps. A loop taking a full pair plus three seam reads per sample drifts to ~5.4 s
an iteration: the first version of this file wrote a frame named `30s` that was taken
at **59.4 s**. Every file here is now named with the time measured when the shutter
opened, and every JSON carries `measuredAtMs`.

## How to re-run it

```
LOCAL_FLEET=serve LOCAL_FLEET_PORT=8895 LOCAL_FLEET_EDGE_PORT=8896 \
  npx vite-node tests/net/local-fleet.ts &
VITE_ALLOCATOR_URL=http://127.0.0.1:8895 npx vite build
npx vite preview --port 4341 --strictPort &

A0_131_BASE=http://localhost:4341 A0_132_TAG=after \
  node evidence/a0-132-say-when-the-line-drops/capture-drop.mjs
node evidence/a0-132-say-when-the-line-drops/plates.mjs
```

Ports are private to this lane (a0-131 held 4318/8891/8892; others hold
4327/4328/4330). For the `before-*` set, check `src/net/link-loss-view.ts` and
`server/room.ts` out of `origin/main`, rebuild, restart the fleet, and pass
`A0_132_TAG=before`.

`shots/` holds the specimens the plates are cut from and a JSON readback beside each:
the CONNECTION LOST overlay as the DOM actually has it, the session's link phase, and
**every roster frame that crossed the host's WebSocket, timestamped** — read off the
socket with CDP rather than off a game seam, because "was the room told, and when" is
a question about the wire and answering it from the client's own state would be
answering it from the thing under test.

Not indexed in `evidence/manifest.json`: that file is QA's and shared across lanes,
and a netcode branch editing it is a merge conflict looking for somewhere to happen.
