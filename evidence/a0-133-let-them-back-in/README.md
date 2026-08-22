# a0-133 — a correct code, a live match, and the door that said REFUSED

The same script, the same fleet, the same staging, run against two builds. The only
difference between the two runs is which commit the bundle was built from, and the
stamp in the corner of every frame says which: **`3f6cf82`** is `origin/main` (the
code a0-131 photographed), **`d081e3f`** is this branch.

Everything here comes off the **production bundle** (`vite build`, `vite preview`)
against a **real local fleet** (`tests/net/local-fleet.ts`: a real allocator, a
Fly-shaped edge, two ticket-enforcing Machines), two browser contexts, real
WebSockets. Profiles are a0-111's, unchanged — **HOST** desktop 1280×800 dpr2
pointer, **JOINER** phone 798×384 dpr2 touch. No capture passes `?freeze=1` or
`?debug=1`.

## The answer, both times

| | before (`3f6cf82`) | after (`d081e3f`) |
|---|---|---|
| the phone's seat memory while playing | `null` | `{room, seat: 1, tokenChars: 24, v: 1}` |
| …after the tab is discarded and rebuilt | `null` | the same, intact |
| **the correct code, into the live match** | `REFUSED: match-live — that match already started` | `JOINED · SEAT 2`, `matchStarted: true` |
| the host, at that instant | — | `humanCount: 2` |
| **a different device, same correct code** | `REFUSED: match-live` | `REFUSED: match-live` |

Plates in `../images/`:

- `a0-133-the-answer-before-after.png` — the phone three seconds after SUBMIT, both
  builds stacked. Above: the keypad holding `AB9Y` and the refusal, stamped
  `3f6cf82*`. Below: `WAVE 1/5 · Outer Drift`, `MATCH 0:47`, stamped `d081e3f*` —
  the same player, back in the match they were thrown out of.
- `a0-133-code-typed-before-after.png` — the keypad on the rebuilt page a moment
  before SUBMIT, both builds, so the plate above cannot be read as a typo.
- `a0-133-refused-match-live.png` — the refusal at 2×, on the build that shipped.
- `a0-133-stranger-still-refused.png` — **on this branch**: a different device
  types `SNQH`, the correct code, into the same running match and gets the same
  refusal it always did.
- `a0-133-host-when-they-return.png` — the host's whole screen at t+50 s on this
  branch. The agreement that a human is back in seat 2 is in the readback beside it
  (`humanCount: 2`), not in these pixels: the two ships are not in one view at
  `VIEW 1×`, which is a0-131's own separate finding and is untouched here.

## The one instrument that had to change, and why

a0-131 staged its fresh client as **a new browser context**. A new context is a new
`localStorage`, which makes it a different *device* — the right instrument for the
question a0-131 was asking ("can anyone with the code walk in?") and the wrong one
for the developer's, because their phone did not become a different phone while the
screen was black. It got a new **page**.

So `lib.mjs` has both, under names that say which is which:

- `samePageAgain(page)` — closes the page and opens another in the **same context**.
  New heap, new socket, new session object, nothing in memory; same origin, so the
  same `localStorage`. This is a discarded tab coming back, and it is the client the
  fix is for.
- `anotherDevice(browser, profile)` — a0-131's new-context client, kept because "let
  the returning player in" is only the right fix if this one is still turned away.

Both are in the run, and both answers are above. A run that photographed only one of
them would be evidence for a claim nobody made.

## What is emulated, and said so in every artefact it writes

The drop is `context.setOffline(true)` — a0-131's instrument. It kills the phone's
WebSocket the way losing the radio does; it is **not** a real network drop and no
attestation may call it one. The readback taken at the cut says so in a field —
`before-03-dropped-10s.json` and `after-03-dropped-10s.json` both carry
`"emulated": true` — so a frame from this run cannot be quoted as a real drop by
anyone reading the files rather than this page.

The token in the readbacks is redacted to its character count (`tokenChars: 24`) —
it is a live credential and this is a public artefact.

## How to re-run it

```
LOCAL_FLEET=serve LOCAL_FLEET_PORT=8897 LOCAL_FLEET_EDGE_PORT=8898 \
  npx vite-node tests/net/local-fleet.ts &

VITE_ALLOCATOR_URL=http://127.0.0.1:8897 npx vite build --outDir dist-a0-133-after
git checkout origin/main
VITE_ALLOCATOR_URL=http://127.0.0.1:8897 npx vite build --outDir dist-a0-133-before
git checkout -

npx vite preview --outDir dist-a0-133-before --port 4342 --strictPort &
npx vite preview --outDir dist-a0-133-after  --port 4343 --strictPort &

A0_131_BASE=http://localhost:4342 A0_133_TAG=before node evidence/a0-133-let-them-back-in/capture-rejoin.mjs
A0_131_BASE=http://localhost:4343 A0_133_TAG=after  node evidence/a0-133-let-them-back-in/capture-rejoin.mjs
node evidence/a0-133-let-them-back-in/plates.mjs
```

Two ports rather than one build torn down and replaced, because the two runs must
not share an origin: `localStorage` is keyed by origin, and a before-run that
inherited the after-run's credential would prove nothing at all. `dist-a0-133-*` are
build outputs and are not committed.

Traps worth carrying forward, on top of a0-131's seven:

- **The doors need an allocator baked in** (a0-131's trap, still true):
  `VITE_ALLOCATOR_URL` at build time, not `?server=`.
- **Two lanes, two port sets.** a0-131 held 4318/8891/8892 and a0-132 4341/8895/8896;
  this used 4342+4343/8897/8898.
- **The whole run is ~3 minutes per build** on this box, most of it the renderer
  (a0-131 measured the client at ~2.7 rAF fps in this lane). Do not read a missing
  frame as a hang.

`shots/` holds every specimen with its JSON readback beside it — `before-*` and
`after-*`, the same names, so any pair can be diffed. Evidence is deliberately **not**
indexed in `evidence/manifest.json`: that file is QA's, shared across lanes, and a
merge conflict looking for somewhere to happen.
