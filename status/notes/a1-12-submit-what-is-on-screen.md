# a1-12-submit-what-is-on-screen.md — working notes (platform)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

**Read `status/notes/a1-10-the-pooling-that-never-pooled.md` and
`status/notes/a1-11-wire-the-pooling-the-reducer-cannot-save-us.md` first.**
a1-12 is the follow-up both of them put first: a1-10 §6 A, "cull off-screen
entities".

**THE NOTE LIVES IN TWO PLACES.** `/status/notes/…` (absolute, the cross-agent
scratch area) and `<repo>/status/notes/…` (committed). a1-10 lost a session to
updating only one. Write BOTH, every time. Trust the branch over either.

## BUILT
<!-- what is actually finished, with the commit that did it -->

Branch `agent/platform/a1-12-viewport-cull`, **cut from
`origin/agent/platform/a1-11-wire-atlas-pooling`** (tip `b229e41`), with
`origin/main` merged in (`41b287d`). a1-11 has NOT merged to main — see
DECISIONS for why the branch is stacked on it anyway.

1. `4531317` — **the cull.** `src/render/cull.ts` (pure: the visible-world
   rectangle, the box/segment tests, the per-layer art extents) wired into every
   entity layer of `src/render/index.ts`. Plus `src/render/cull.test.ts` (the
   off-screen/straddling pair, layer by layer, and a guard that enumerates the
   art generators against the extents the cull pads by), and the four render
   suites that were about pooling or fog rather than about the window.
2. `02a1430` — `tests/sim-render-parity.test.ts` (Platform's, permanent) asks
   its question through a window that contains the arena.
3. `2236d6c` — **CROSS-OWNER, flagged**: two viewport literals in
   `tests/combat-visibility.test.ts` (Gameplay's). Its siege fixture parks its
   two shooters ~2800 units apart, so no 800×600 window ever held both.
4. `a01d0db` — the rig: a landscape-phone profile for the whole-frame baseline,
   a `drawn` (submitted-entities) column, and the hardenings the runs below cost
   me (ephemeral port, settle-and-check, rig marker, group kill).
5. `961ee73` — **the golden alarm's answer**: the station body is culled where it
   is DRAWN, not where the sim says it is, and its creation timing is left exactly
   as a1-11 had it. See the section below; all 44 goldens pass unchanged.
6. `b74d027` — `docs/viewport-cull-measured.md` + `evidence/a1-12-viewport-cull/`.

**tsc clean. 4838 tests green across 279 files. All 44 goldens green, UNCHANGED.**

**Measured** (a1-10's rig, this box, back to back, `docs/viewport-cull-measured.md`):

| | draw calls | submitted | median frame |
|---|---|---|---|
| desktop 1280×800 | 32.1 → **10.9** | 660 → **173** | 53.2 → **38.0 ms** |
| phone 844×390 | 32.1 → **9.0** | 660 → **11** | 36.3 → **20.7 ms** |

Rocks on the phone: 200 → **6**, which is a1-10 §4.1's own number. The phone
profile no longer trips `VfxAutoQuality`. The desktop scene is still NOT under
budget (~26 fps on a box with no GPU) — say that plainly, and rest the conclusion
on the draw-call and submitted columns, never on the milliseconds.

## DECISIONS
<!-- why you chose an approach, what you rejected, and the trap you hit -->

**Cut from a1-11, not from main.** The brief measures "next to a1-11's 32.1 /
53.1" and says the pooling and the a2-07 VFX wiring are what to cull in front
of. Neither is on `main` (a1-11 is nine commits on its own branch and carries
a2-07's VFX merged in). Culling in front of main's un-pooled renderer would
answer a question nobody asked and produce numbers that cannot sit next to
a1-11's. a1-11 itself stacked on a1-10 the same way (`3d83e0b`). The cost is a
PR that carries a1-11's diff until a1-11 merges — stated plainly in the PR.

**Index-stable slots, not a running count of survivors.** The obvious cull is
`if (!visible) continue;` over a `live++` counter — and it silently destroys the
pooling a1-11 just built. Slot *j* would hold a different rock every time the
set of visible rocks shifted by one, so one rock leaving the left of the screen
would miss the look key of every rock behind it and re-swap ~75 textures in a
frame. So the slot is the entity's own identity: the rock's index in the field,
the projectile's index in the sim's own recycled pool
(`sim/projectiles.ts`), and `(station × mount slot)` for a gun — `Turret.slot`
is the sim's own reservation and is unique per station while the turret lives.
Turrets and scaffolds start each frame hidden (`hideFrom(0)`) and light up.

**The pad is per-entity, not per-layer.** The brief says "pad by the largest
sprite radius in the layer". Per-entity `radius × RENDER_EXTENT[layer] × slop`
is strictly tighter and never wrong: the art is authored in unit space, the
renderer lands unit radius 1 on the collision radius, so the drawn half-extent
is exactly `extent · radius`. `RENDER_EXTENT` holds an upper bound on `extent`
per layer (rock 1, turret 2.2, shot 1.48, ship 1.16, shield 1.15, chunk 1) and
`cull.test.ts` enumerates every look each generator can produce and fails if one
grows past its entry — so a wider muzzle telegraph cannot silently start
clipping at the screen edge. `CULL_SLOP` = the bake margin (1.08), applied
everywhere, because the pooled bake is that fraction wider than the art.

**Measured extents, not guessed ones** (probe run, then pinned + guarded):
turret 2.2 (a firing barrel — its extent deliberately tracks the muzzle flash),
shot 1.48 (the top DAMAGE rung's halo), ship 1.16, shield 1.15, rock exactly 1.

**Muzzles are culled as a SEGMENT.** A flash fired from off screen at something
on screen crosses the window. Culling on the origin drops it; culling on the
segment's own bounding box keeps it, and is conservative in the safe direction.

**Stations get four tests, not one**, each taken where that object is drawn. The
reach is `stationReach` — the widest of the Cutterhead art (1.95× the core), the
construction arc, and the outermost shield bubble (90 units in its own right,
bigger than the station it stands on). The **overlay** is tested at
`station.pos`, where it is repositioned every frame. The **body** is tested at
its OWN `g.x/g.y` (see the golden section — they are not always the same point).
The **halo** gets its own at `ATMOSPHERE_HALO_RADIUS` (four station radii): on a
phone the air fills the window while the station it rings is still off the left
edge. Each **turret** gets its own, because a gun slides around its station's rim
(`Turret.orbitAngle`).

**Rejected: a screen-space pad for the URL bar.** The visual viewport can grow
(URL bar hides) before `relayout` fires, which would reveal a band the cull had
already skipped. I did not pad for it: a canvas that has not been resized yet
already shows a backdrop gap in that band, so this is a pre-existing one-frame
reflow artefact and not something the cull introduces — and on the phone a 96 px
pad would have cost most of the win it exists to protect (844×390 → 1036×582 is
1.8× the area). Named here so the next session does not re-derive it.

**Rejected: culling `src/art/vfx/layer.ts`.** The brief lists the VFX layer.
`VfxLayer.draw(pool)` is Art's file with no cull seam, and particles are emitted
at combat/mining events — i.e. overwhelmingly at the thing the camera is
following. Measured rather than assumed (see the doc), and recommended to Art as
a `draw(pool, box?)` overload rather than edited unilaterally.

**GDD §2.2 "health at every range" is about FOG, not about the window.** The
a0-05 amendment killed a 180-unit `SENSOR_RANGE` gate that blanked the ring of a
rival you could see perfectly well. An off-screen station draws nothing at all —
body, beacon, ring — so no read is lost. `cull.test.ts` pins the amendment where
it bites: a rival at 250 units, plainly on screen, still rings.

### THE GOLDENS FIRED, AND THEY WERE RIGHT — read this before touching them

Two phone TEAMS goldens moved by ~9250 px (3%), identically across three retries.
**They were not moved by a cull dropping something visible. The opposite.**

Isolation, in the order that made it defensible (a1-11's method):

1. `git worktree add /tmp/pre-cull <a1-11 tip>` + symlink `node_modules`, then
   `CI=1 PREVIEW_PORT=<free> npx playwright test … -g TEAMS`. **a1-11 reproduces
   its committed baselines exactly.** That makes the delta mine and nothing else's.
2. Dump both scene graphs off a REAL boot at the golden's own profile *with the
   golden's own staging* (`window.__nameplateStage.stageBot()` — it is what boots
   the TEAMS scene, and it TELEPORTS a rival's home beside the local ship). A
   throwaway `window.__stationDump` in `main.ts`, reverted after.

```
a1-11   station-1 body at (336, 1200)    overlay-1 at (2088, 1340)
a1-12   station-1 body at (2088, 1340)   overlay-1 at (2088, 1340)
```

**`stationBody` writes its transform only on the frame it (re)builds the
geometry — once per match. A station that moves afterwards leaves its body
behind.** The baselines had baked a station drawn as a bare damage ring with no
body under it. My first cut delayed the body's creation until it was on screen,
so it got built *after* the teleport, at the right place — and the picture
improved, which is still a golden moving.

Not fixed here: fixing it moves those two frozen goldens for real and re-cutting
frozen scenes is not this brief's mandate. Scoped around instead (`961ee73`) —
the body is built on exactly the frames a1-11 built it on (it is drawn once per
match, so delaying it saved nothing at all), and its cull test reads `g.x/g.y`
off the display object, so the cull cannot hide a body that is on screen whether
or not it is in the right place. **All 44 goldens green, unchanged.** Reported in
`docs/viewport-cull-measured.md` §6 with the fix and the two images named.

*Do not "fix" this by re-cutting. If you are told to fix the bug, it is two
assignments in `stationBody` plus a re-cut of `phone-landscape-frozen-teams` and
`phone-portrait-frozen-teams`, and it is a change of its own.*

### THE TRAP THIS BRIEF HIT, AND IT PRINTED A PLAUSIBLE LIE

The first bench run **measured a1-11's code and printed it as a1-12's.** A stale
vite from an earlier session still held `--strictPort 5183`; the new one exited
with "Port 5183 is already in use"; `run.mjs` raced past the exit event, loaded
the survivor's page, and reported a1-11's two baselines (`32.1 draw calls`, no
phone profile, `0 submitted`) as this run's numbers. Nothing failed. It is the
same class of failure as a1-11's `reuseExistingServer` golden trap.

Fixed in the instrument, not in the operator's memory:

- **an ephemeral free port** (`BENCH_PORT` overrides), so a survivor cannot
  collide at all;
- **a settle-and-check** before the first navigation, so a dying vite is caught;
- **a rig marker** — `run.mjs` refuses to report any payload without the
  `baselines` field only this revision of `bench.ts` emits.

Kill leftovers with `pkill -f 'vite --port'` if one is ever seen again.

## NEXT
<!-- what remains, in order, and anything blocking -->

Everything the brief asked for is committed. Remaining: push and PR, then the
DoD's PR-checks-green line.

**Done:** the cull + its tests (`4531317`), the two test-window scopings
(`02a1430`, `2236d6c` cross-owner), the rig's phone profile and hardenings
(`a01d0db`), the golden investigation and its scoping fix (`961ee73`), the doc +
evidence (`b74d027`). tsc clean; 4838 tests green; 44/44 goldens green and
unchanged.

**The headline to defend in review, and do not soften it:** 32.1 → 10.9 draw
calls on the desktop window and 32.1 → 9.0 on the landscape phone; 660 → 173 and
660 → **11** entities submitted; and the §4.3 scene is **still not under budget**
on the desktop profile (~26 fps on a box with no GPU). Rest it on the draw-call
and submitted columns. The milliseconds do not travel off this box.

**Two things for whoever comes next**, both in the doc rather than in a commit:

- **Art:** `VfxLayer.draw(pool, visible?: CullBox)` — the particle layer is the
  one entity layer this brief did not cull, because widening Art's ratified seam
  unilaterally is not mine to do. `Renderer.visibleWorld` already exposes the box.
- **Real hardware.** `PERF_GATE=1 tests/perf/playwright.perf.config.ts`. This box
  has no GPU and cannot answer the 60 fps question — a1-10 said so, a1-11 said
  so, and it is still true.

Nothing is blocked.
