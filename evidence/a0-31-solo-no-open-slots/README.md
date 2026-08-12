# a0-31 — a solo lobby must not offer an OPEN seat

Evidence for `agent/ui/a0-31-solo-no-open-slots`.

The developer:

> *"in solo play there should be no slot open it's either closed or bot. no one
> can join in solo…."*

Both frames are taken by the **real client**, on the real preview bundle, reached
by real presses at the points the client itself reported drawing its controls at
(`capture.spec.ts` — PLAY → the doors → PLAY SOLO). Nothing here is a mock-up and
nothing is cropped. The build the frames came from is stamped in `readback.json`
(`servedVersion.sha`) and in the badge at the bottom-left of each image.

| frame | what it shows |
|---|---|
| `a0-31-solo-lobby.png` | PLAY SOLO as it opens: you in `TAKEN`, **seven `BOT` rows, no `OPEN`** |
| `a0-31-solo-lobby-closed.png` | the same lobby after the host walks two rows round the ring: `BOT` and `CLOSED` on screen together, and still no `OPEN` |

## What the readback proves that the pictures cannot

A still frame only says "OPEN was not on screen *then*". `readback.json` carries
the whole session:

- `ringWalked: ["CLOSED", "BOT", "CLOSED"]` — three real presses on one row. The
  solo ring is **two rungs**, so the third press lands back on `CLOSED` instead of
  finding a third rung. Before this branch the same three presses read
  `CLOSED → OPEN → BOT`.
- `everSeenLabels: ["BOT", "CLOSED", "TAKEN"]` — every word this lobby drew on
  **any** row at **any** point in the walk, sampled after every press. `OPEN` is
  not among them, which is the brief's claim stated as a fact about the session
  rather than about two screenshots.
- `freshSolo.online: false` — this is the solo flavour, which is the whole of why
  `OPEN` has nothing left to mean here.
- `size` goes 8 → 6 as two seats shut, so the roster the screen shows is the
  roster the match would contain (`N` counts humans plus bots, GDD §2.1 amended
  2026-08-07).

## Online is untouched

`a0-11` is ratified — *"when creating a room to play online it should start with
all slots OPEN and no bots in it"* — and this branch narrows **solo only**. That
frame already exists and is not re-shot here:
`evidence/a0-11-open-rooms/a0-11-fresh-room.png` (seven `OPEN`, no bots), taken
against the shipped allocator and match server. The unit half is
`src/ui/lobby.test.ts` — the same walk, asserted in both flavours in one test, so
the two rings cannot drift apart without a red run.

## Running it again

```
npx playwright test --config evidence/a0-31-solo-no-open-slots/playwright.config.ts
```

No allocator and no match server: this is an offline claim, so the shipped bundle
with no `VITE_ALLOCATOR_URL` is exactly the artifact under test. It takes a
private port (4196) and a private `outDir` (`dist-a0-31`) and never reuses an
existing server, so it cannot silently capture another lane's bundle.
