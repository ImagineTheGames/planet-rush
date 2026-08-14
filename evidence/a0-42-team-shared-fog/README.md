# a0-42 — in TEAMS, the fog lifts where your teammates are

> *"when playing on a team the fog of war should lift where your team mates are it
> should be like as if you were there...."* — the developer, 2026-08-13

Branch `agent/gameplay/a0-42-team-shared-fog`. Every frame below is the **minimap
overlay of the same frozen TEAMS match, at the same tick** — `?debug=1&freeze=1&sides=2`,
desktop 1280×800, dpr 1, the centred overlay opened with `M` (GDD §2.4). The
numbers under each are read from `window.__minimapStage.state()`, which counts
what actually **drew** after the fog gate, not what the world holds.

Frame 1 is the **`origin/main` bundle** (`5936a08`), built in a worktree and
served on a private port; frames 2–5 are this branch's bundle. Same seed, same
map, same freeze tick, same viewport — the only variable between 1 and 2 is the
code.

## 1 → 2 · the reveal

| | `1-before-per-player-fog.png` | `2-after-team-shared-fog.png` |
|---|---|---|
| coverage discs | 2 | **8** |
| stations drawn | 1 | **4** |
| ship dots | 0 | **3** |
| ore hints | 12 | **30** |

Before, a player on a side of four could see their own two discs and nothing
else: three quarters of their own team's board was dark. After, the side's sight
is the union of its members' — their homes, their ships, and the ore under their
coverage are on the map, and **each ally's coverage disc is drawn as a disc**, so
the reveal reads as something the team paid for rather than as magic.

The three teammates are far enough away that **no disc of the viewer's own
overlaps theirs** — the frames are only worth what that geometry is worth, which
is why it is visible in the picture rather than asserted here.

## 3 → 4 · remembered geography, not just live dots

This is the half a live-dots-only implementation would have dropped, staged
through `__minimapStage.stageAllyScout()` — a seam that moves an ally's *ship*
and runs the sim's own `updateSensory`, and computes no fog of its own.

| | `3-ally-scouting-live-coverage.png` | `4-ally-home-field-remembered.png` |
|---|---|---|
| coverage discs | 8 | 8 |
| stations drawn | 6 | 6 |
| ship dots | **5** | 3 |
| ore hints | 48 | 48 |

**Frame 3** — the teammate is parked on an ore field **442 units beyond the
nearest disc the side projects**, so nothing about what it reveals can be
second-hand: their disc is live out there, and under it sit two enemy homes
(bright orange, bright purple) and eighteen rocks the viewer had never seen.

**Frame 4** — the same teammate has flown home. Their disc up there is **gone**,
and the two live ship dots it was showing are gone with it — but the two enemy
homes are still drawn, in the *remembered* dimming (dull brown, dull violet), and
so is every rock of the field. **The side scouted it once and keeps it.** That is
"as if you were there": your own coverage would have left exactly this behind.

## 5 · the collapse

`5-ally-dead-coverage-collapsed.png` — the tick the teammate's ship dies
(`__minimapStage.killAlly()`), staged from frame 3's state (out on the field).

| | frame 3 | frame 5 |
|---|---|---|
| coverage discs | 8 | **7** |
| ship dots | 5 | **2** |
| ore hints | 48 | 48 |
| stations drawn | 6 | 6 |

Their disc goes with them **that same tick**, and everything only under it drops
— precisely as a killed radar satellite collapses its own coverage (feature f1,
item 2). A teammate's coverage is shared; it is never *remembered* as live dots.
What they had already **mapped** stays mapped: ore and station counts do not
move, because geography is remembered and never un-remembered.

## FFA did not move

- `sensedState` is proved **field-for-field identical** to a verbatim copy of the
  pre-change per-player function, for every viewer, in a teams-of-one world —
  `src/sim/team-sensing.test.ts`, first describe block. FFA *is* teams-of-one
  (`createWorld` defaults each player's `team` to their own id), so this is a
  property of the construction, not a special case.
- The full `tests/mobile/goldens.spec.ts` run on this branch: **50 passed, 0
  failed**, every FFA baseline untouched in the diff.

## Reproducing

```
npx vite build && npx vite preview --port 4194 --strictPort   # this branch
# then, in a worktree at origin/main, the same on 4195 for frame 1
```
Boot `http://localhost:4194/?debug=1&freeze=1&sides=2`, press `M`, and drive
`window.__minimapStage` — `stageAllyScout(stay)` / `killAlly()` / `state()`.

**One gotcha, worth writing down:** the minimap's content layer is throttled on
**sim ticks**, and a `?freeze=1` scene never advances one — so staging done after
boot does not repaint until something changes the layer's *rect*. Opening the
overlay (`M`) is that change. Read `state()` and the pixels will disagree
otherwise, and the pixels are the ones lying.
