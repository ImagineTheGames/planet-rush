# a0-134 — the phone is being shot by a ship its screen does not draw

a0-131 put two real clients in one match for the first time and came back with a
disagreement it recorded as **failed**:

> **at the shipped VIEW 1× the phone player is being shot by an attacker its
> screen does not draw.**

Everything here re-stages that moment. The rig is a0-131's — the same profiles
(**HOST** desktop 1280×800 dpr2 pointer, **JOINER** phone 798×384 dpr2 touch),
the same two browser contexts against one room over real WebSockets, the same
local fleet (`tests/net/local-fleet.ts`), the same `frame()`/`note()` discipline,
and the same *measured* approach in the match (seven clicks at the left edge two
seconds apart, then one short hop). `lib.mjs` and `plates.mjs` **import** a0-131's
own modules rather than copying them, because a re-stage measured against a new
ruler is not a re-stage.

**Exactly one thing differs, and it is the finding: the joiner never touches its
VIEW control.** a0-131 had to press it twice for the attacker to be drawn.
Nothing here presses it. Whatever the phone shows is what the shipped default
gives a player who has touched nothing.

Two bundles are photographed through that one recipe:

| label | bundle |
|---|---|
| `before` | `origin/main` at `e1f0261f` — the tree a0-131 failed |
| `after`  | this branch |

No capture passes `?freeze=1` (`src/main.ts` sets `buildBadge.visible =
!flags.freeze`, so a frozen frame is one with the stamp deliberately hidden) and
no capture passes `?debug=1` (it nulls the main menu and the lobby, so there is
no online path at all). The build stamp is in the corner of every frame.

`measure.mjs` is the one thing here that *does* pass `?debug=1`, and it takes no
photographs: it reads `window.__viewStage`, whose `world()` returns
`renderer.visibleWorld` — the very rectangle the cull culls against. The finding
is a comparison between that rectangle and a weapon range, so neither half is
arithmetic written in the evidence.

## How to re-run it

```
# the fleet, once
LOCAL_FLEET=serve LOCAL_FLEET_PORT=8991 LOCAL_FLEET_EDGE_PORT=8992 \
  npx vite-node tests/net/local-fleet.ts &

# the two bundles, each pointed at that fleet
git worktree add /tmp/a0134-before origin/main
ln -s "$PWD/node_modules" /tmp/a0134-before/node_modules
(cd /tmp/a0134-before && VITE_ALLOCATOR_URL=http://127.0.0.1:8991 npx vite build --outDir dist-a0134-before)
VITE_ALLOCATOR_URL=http://127.0.0.1:8991 npx vite build --outDir dist-a0134-after

npx vite preview --outDir /tmp/a0134-before/dist-a0134-before --port 4319 --strictPort &
npx vite preview --outDir dist-a0134-after --port 4320 --strictPort &

# the numbers
BASE=http://localhost:4319 node evidence/a0-134-see-what-shoots-you/measure.mjs before
BASE=http://localhost:4320 node evidence/a0-134-see-what-shoots-you/measure.mjs after

# the photographs
A0_131_BASE=http://localhost:4319 LABEL=before node evidence/a0-134-see-what-shoots-you/capture-together.mjs
A0_131_BASE=http://localhost:4320 LABEL=after  node evidence/a0-134-see-what-shoots-you/capture-together.mjs
node evidence/a0-134-see-what-shoots-you/plates.mjs
```

`shots/` holds the specimens the plates are cut from and the JSON readbacks
beside them. Plates are composed nearest-neighbour and halved by dropping every
other pixel; nothing is resampled and nothing is annotated. Captions are here, as
words, rather than burnt into a picture.
