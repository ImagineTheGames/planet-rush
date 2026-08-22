# a0-128 — only reachable frames

**QA Agent · 2026-08-22 · branch `agent/qa/a0-128-only-reachable-frames`**

`tests/adversarial/layout-reachable.ts` (new) ·
`tests/adversarial/layout-frames.ts` · `tests/adversarial/layout-overlap.test.ts` ·
`tests/adversarial/layout-model.ts` · no changes to `src/`

---

## 0. The finding, in one paragraph

a0-122's sweep is a cross-product: every state × every viewport × every element
against every other one. A cross-product **composes**; a game does not. The
census took `wheelOpen` and `alarm` as independent booleans, two independent
booleans are four screens, and the game has three of them. The fourth is
`match-alarm-wheel` with the arrow home up, and it was **288 of the sweep's
1,896 frames** — every frame of that state, not merely the 38 that breached.
a0-125 spent a lane measuring one of them to 3.3 px and reasoning carefully
about a pixel of band; a0-127 went to photograph it and could not.

The sweep now derives what is on the glass from the world a frame is staged in,
so it cannot compose a screen the game refuses to draw. **1,896 frames → 1,612,
and every one of the 284 that went is accounted for below.** `KNOWN_COVERS` is
empty, and no allowance was removed.

---

## 1. How reachability is decided

### 1.1 Derived, and why not declared

The brief offered two roads and named the trap in the cheap one: an exclusion
list is *"a second hand-kept truth that will rot exactly the way the map
previews' dot list did (a0-124)."* This took the first road, and the result is
stronger than "the sweep skips that pair" — **there is no exclusion list, no
pair of ids is named impossible anywhere in `tests/`, and the impossible frame
is not excluded but unspellable.**

The mechanism is one field. A match frame is staged from a `MatchSituation`, and
a `MatchSituation` describes the **world**, never the screen:

```ts
export interface MatchSituation {
  readonly home: { readonly dx: number; readonly dy: number }; // station − ship, world units
  readonly buildRequested: boolean;   // the player is holding BUILD
  readonly shipAlive: boolean;
  readonly stationAlive: boolean;
  readonly alarmFiring: boolean;      // UnderAttackAlarm.active
  readonly prompt: string | null;
  readonly plateAt: { x: number; y: number } | null;
}
```

Both of the elements that used to be booleans are now read off it, through the
shipped predicates rather than restatements of them:

| element | decided by | which is |
|---|---|---|
| `build-wheel` | `wheelIsOpen(sit)` | `canOpenWheel` (`src/ui/build-wheel.ts:583`) fed the sim's own `isDocked` (`src/sim/buildings.ts:88`) — the same call `src/main.ts:3879` makes before it hands the HUD a frame |
| `alarm-arrow` | `arrowHome(sit, vp)` | `homeArrow` (`src/ui/alarm.ts:326`) and `Hud.drawHomeArrow`'s own `if (visible.onScreen) return;` (`src/ui/hud.ts:2532`) |
| `alarm-frame-*` | `sit.alarmFiring` | `Hud.updateAlarm`'s `alarmGroup.visible = active` (`src/ui/hud.ts:2481`) |

**They read the same `home`.** The offset that opens the wheel is the offset that
hides the arrow, so no situation exists that puts both on one screen — not
because a table forbids it, but because there is nothing to type. Change
`STATION.dockRange` or `ARROW_EDGE_INSET` in `src/` and this file follows without
being edited, which is the property a declared list could never have had.

### 1.2 Every frame says how the game reaches it

Every `Variant` in the census now carries a `Stage` — a discriminated union over
`match` / `pause` / `entry` / `online` / `end` — and every `StateSpec` carries a
`reached:` sentence in prose. `unreachable(frame, vp)` re-asks the shipped
predicates what belongs on that screen and reports **both** directions of
disagreement:

- an element the game would **not** draw → a finding nobody can act on (D5);
- an element the game **would** draw and the census left out → the quieter half,
  because an element left out of a sweep reads exactly like an element that
  passed.

Six rules are in that oracle, and it is deliberately not every element. A rule
earns its place by being something the census could get *wrong*: `controls-strip`
is `showControlsStrip(isTouch)` at its only call site, and re-deriving it here
would compare a function to itself over an input space of one bit. The six are
the places the census **composes**: the wheel, the alarm frame, the arrow, the
pause stack's corner DOWNLOAD LOG offer (`pauseAllowsDownloadLog`), the entry
screens' refusal panel, and the online overlay's BACK TO MENU.

### 1.3 The half that is not a tautology

The census and the oracle both call `wheelIsOpen`, so on their own they prove
only that a helper agrees with itself. That is worth having — it fails the day
somebody hand-sets `wheelOpen: true` again — but it is not the claim. The claim
is proved separately inside `every swept frame is a frame the game can draw`:

1. **The inequality, per viewport, out of `src/`'s own constants** —
   `STATION.dockRange` against `min(width, height) / 2 − ARROW_EDGE_INSET`. The
   day a viewport is added on which the docked disc reaches the inset rect, this
   fails and says a state is now needed for it.
2. **The same claim by exhaustion** — 720 bearings × 41 radii out to `dockRange`
   × 4 viewports = **118,080 docked situations**, each with BUILD held and the
   alarm up, which is the most favourable position the pair could possibly have.
   None of them draws both.
3. **Two vacuity guards** — the wheel really opened on all 115,200 samples
   strictly inside the rim, and the arrow really is drawable. Without these, a
   `canOpenWheel` that returned `false` for everything would pass.

*(The rim itself: `isDocked` compares squared distances with `≤`, so at exactly
`dockRange` the product `(cos b · r)² + (sin b · r)²` lands an ulp over `r²` on
145 of the 720 bearings and the wheel shuts. That is binary floating point on a
boundary, not the game. It cuts the safe way — a rim sample the count does not
credit is a sample the exclusivity sweep still runs — so the rim stays in the
sweep and out of the tally.)*

---

## 2. `mutually exclusive`, for the D5 pair specifically

The pin was:

> `match-alarm-wheel | phone-798x384 | build-wheel | alarm-arrow`

and a0-127's verdict on it was:

> *"THE VERDICT IS ABOUT THE PIN, NOT ABOUT THE SCREEN: nothing in these two
> frames is drawn wrongly. […] This camera went to reproduce that on the running
> build and COULD NOT, because the two elements have **mutually exclusive**
> conditions."*

Here is that phrase as arithmetic. Both conditions are statements about **one
distance** — how far the local ship is from its own station — and they are
statements about *opposite sides* of it.

**The wheel is open only while you are close.** `canOpenWheel` requires
`docked`, and `docked` is `isDocked`, which is
`dist² ≤ STATION.dockRange²` centre to centre. `STATION.dockRange` is **160**
world units. Outside that disc the wheel refuses, whatever the player holds.

**The arrow is drawn only while you are far.** `homeArrow` returns
`onScreen: true` when `|dx| ≤ width/2 − inset` **and** `|dy| ≤ height/2 − inset`,
and `Hud.drawHomeArrow` returns without drawing on exactly that — *"The arrow is
a pointer to somewhere you can't see; once you can see the station, the station
is the tell and the arrow is clutter."* `ARROW_EDGE_INSET` is **28**. The world
is drawn at one CSS pixel per world unit at the shipped camera
(`DEFAULT_CAMERA_SCALE`), which is the assumption `drawHomeArrow` itself makes
when it hands raw `ship.pos` / `station.pos` to a function taking a CSS-pixel
viewport.

So the arrow needs the station **further** than the shorter of those two
half-extents, and the wheel needs it **nearer** than 160:

| viewport | wheel needs ≤ | arrow needs > | gap |
|---|---:|---:|---:|
| `phone-798x384` | 160 | **164** | 4 |
| `desktop-1280x800` | 160 | 372 | 212 |
| `ultrawide-3440x1440` | 160 | 692 | 532 |
| `ultrawide-3840x1080` | 160 | 512 | 352 |

`160 < 164` on the tightest of the four, so **the disc that opens the wheel lies
strictly inside the rect that hides the arrow, on every viewport the sweep
runs.** There is no ship position that satisfies both, and the phone — the
profile the pin named, and the one a0-125 measured its 3.3 px on — is the
closest any of them comes, by four world units.

What made the sweep produce it anyway is that the census never asked about a ship
position. It asked for `{ wheelOpen: true, alarm: true, bearing }` and got a
wheel because it said so and an arrow because it said so, with home staged 6000
units away *in the same frame as a wheel that requires 160*. The two rects were
computed correctly; the screen they were computed on was fiction.

**a0-125's measurements are not wrong and are left standing** in
`tests/reports/a0-122-overlaps.md`, with an amendment on the D5 heading. The
overlap really is 3.3 px deep on that model, the halo really is 318.5 px wide,
and the wave clock's compact row really does end 31.7 px down with the wheel's
footprint starting at 32.75. Every one of those numbers is about a frame that
has never been drawn.

---

## 3. Frame count, before and after, per state

**1,896 → 1,612 frames. 26,803 → 22,468 painted elements. 360,750 → 298,866
ordered pairs.** Both sides measured by running `sweepFrames()` on the commit
before and the commit after.

| state | variants × viewports | before | after | Δ | why |
|---|---|---:|---:|---:|---|
| `match-hud` | 28 stops × 4 | 112 | 112 | — | unchanged |
| `match-prompt` | 1 × 4 | 4 | 4 | — | unchanged |
| `match-wheel` | 1 × 4 | 4 | 4 | — | unchanged |
| `match-alarm` | 360 bearings × 4 | 1,440 | 1,440 | — | **every bearing kept — see §4.1** |
| `match-alarm-wheel` | 72 → 1 × 4 | 288 | 4 | **−284** | **see §4.2** |
| `pause-menu` | 1 × 4 | 4 | 4 | — | unchanged |
| `pause-settings` | 1 × 4 | 4 | 4 | — | unchanged |
| `pause-confirm` | 1 × 4 | 4 | 4 | — | unchanged |
| `doors` | 1 × 4 | 4 | 4 | — | unchanged |
| `doors-refused` | 1 × 4 | 4 | 4 | — | unchanged |
| `keypad-refused` | 1 × 4 | 4 | 4 | — | unchanged |
| `online-error` | 1 × 4 | 4 | 4 | — | unchanged |
| `online-reconnecting` | 1 × 4 | 4 | 4 | — | unchanged |
| `end-victory` | 1 × 4 | 4 | 4 | — | unchanged |
| `end-defeat` | 1 × 4 | 4 | 4 | — | unchanged |
| `end-draw` | 1 × 4 | 4 | 4 | — | unchanged |
| `end-eliminated` | 1 × 4 | 4 | 4 | — | unchanged |
| **total** | | **1,896** | **1,612** | **−284** | |

**Seventeen states before, seventeen after. No state was dropped, and no
viewport was dropped.** The `the cross-product is the full one` assertion still
requires every state × every viewport, and it still passes.

Two element-level counts, for the same reason:

| | before | after |
|---|---:|---:|
| frames painting `alarm-arrow` | 1,728 | 1,440 |
| frames painting `build-wheel` | 292 | 8 |
| frames painting **both** | **288** | **0** |

---

## 4. Justifying every frame that disappeared

The failure mode of this fix is over-correcting — excluding real states because
they are awkward to stage, and quietly shrinking the sweep. So: **284 frames
went, they are all one state, and here is the whole argument.**

### 4.1 First, what did NOT go: all 360 alarm bearings

`match-alarm` is 1,440 frames, 76% of the old sweep and 89% of the new one, and
it was the obvious place to lose coverage by accident. It lost none, and that is
measured rather than assumed.

The staging changed: home used to stand **6000 units** away so the arrow was
certain to clamp to an edge, and no shipped arena is that big — the widest is
`3200×2000` and the farthest a ship can get from its own station on any of the
six maps is **3067 u**. So the old census was itself staging an impossible world,
one level below D5. `arenaReach(dx, dy)` now answers it out of `src/sim/maps.ts`
and the wall clamp in `src/sim/step.ts` (`pos ∈ [SHIP_RADIUS, bounds −
SHIP_RADIUS]`): for a direction, the farthest a ship can retreat from any live
station on any map at any player count.

The frames survive because `ARROW_STAGED_RANGE = 2000` is bracketed at both ends,
and the test asserts both brackets over all 360 bearings × 4 viewports:

- **≥ 1958.7** — the largest separation any viewport needs to put home off its
  inset rect. Binding case: the 32:9 at 165°.
- **≤ 2048.0** — the tightest `arenaReach` over the sampled bearings (at 90°).

An 89-unit window, and 2000 sits in it. Every one of the 360 bearings is a
separation a shipped map can produce on every one of the four viewports; none
was dropped as unreachable.

**And no `match-alarm` finding moved**, because the clamped arrow position is
scale-invariant in distance: past the edge, `x = cx ± halfW` and `y = cy ± halfH`
regardless of how far home is. 6000 and 2000 give the identical rect. The change
is honesty about the world, not about the pixel.

### 4.2 The 284: `match-alarm-wheel`, 288 → 4

**The state stays.** It is reachable and it is worth sweeping: flying home to
spend under siege is the triangle decision GDD §2.2 is about, and the wave
clock's **compact single-row re-flow** (a0-24, `waveClockLayout(…, wheelOpen)`)
exists on no other state. Deleting it would have been the over-correction the
brief warned about. It is still swept, on all four viewports.

**What went is 71 of its 72 variants, and they were the bearing of an element
the game does not draw there.** The variants existed for exactly one reason —
`BEARINGS.filter((_, i) => i % 5 === 0)`, the arrow's direction — and with the
arrow correctly absent, the 72 frames are byte-identical to each other. Keeping
72 copies of one frame would be padding the count, not coverage.

Frame-for-frame, then, the 284 that disappeared are:

- **288 frames that composed the wheel and the arrow together** — every frame of
  the state, on all four viewports. All 288 are unreachable, by §2.
- **replaced by 4** — one per viewport, the same state with the arrow derived
  away: alarm frame up, wheel open, wave clock compact, no arrow.

Nothing else about those frames changed. The wheel's footprint, the compact
clock, the ore cluster, the HOME column, the stamps, the touch controls and the
minimap are all still measured against each other on all four viewports.

**Is one frame per viewport enough, when the docked disc is a whole disc?** For
the sweep, yes — nothing painted on that state depends on where in the disc the
ship is. The general claim over the disc is not left to sampling at all: the test
proves it over 118,080 situations plus the per-viewport inequality (§1.3), which
is stronger than the 72 points the old sweep looked at.

### 4.3 Nothing else shrank

The other fifteen states are untouched, frame for frame. The only other change to
the census is that `CONTROLS` — the six negative controls — are re-staged through
the same situations, and all six still reproduce their pair on the viewports the
report says they do (assertion 4 is green). The a0-116 control in particular is
staged at `homeAway(−π/2)` instead of a raw bearing, and produces the same rect.

---

## 5. Pins and allowances removed as unreachable

### 5.1 One pin removed, and `KNOWN_COVERS` is now empty

| pin | disposition |
|---|---|
| `match-alarm-wheel \| phone-798x384 \| build-wheel \| alarm-arrow` | **withdrawn — unreachable** (§2) |

That was the only line left, so:

```ts
const KNOWN_COVERS: readonly string[] = [];
```

**The brief asked for this to be said plainly rather than left as a placeholder,
so: the list is empty, and empty is the correct state of it.** Five defects went
into that table at a0-122; a0-125 landed four of them in `src/`; a0-128 withdrew
the fifth as a frame that does not exist. Nothing breaches today — the sweep
finds **zero** covers on 1,612 frames.

The assertion that reads the list (`every pinned overlap still reproduces where
the report says it does`) is kept, not deleted. On an empty list it asserts
nothing, which is correct; the day a line is added it goes back to failing when
the fix lands, which is its whole job.

### 5.2 No allowance removed — all seven still fire

`LAYOUT_ALLOWANCES` was the other place unreachable frames could have been
propping something up, and the gate already asserts that a row excusing nothing
is deleted. Measured on both sides:

| allowance | frames before | frames after | still needed |
|---|---:|---:|---|
| `banked-total` over `ore-hud` | 1,848 | 1,564 | yes — every match frame |
| `settings-help` over `settings-row` | 24 | 24 | yes |
| `alarm-arrow` over `minimap` | 52 | 58 | yes — and it went **up**, see §6 |
| `alarm-frame-bottom` over `controls-strip` | 1,296 | 1,083 | yes |
| `alarm-frame-left` over `controls-strip` | 432 | 361 | yes |
| `alarm-frame-right` over `controls-strip` | 432 | 361 | yes |
| `entry-eyebrow` over `entry-title` | 8 | 8 | yes |

Every row that fired on `match-alarm-wheel` also fires on `match-alarm` or
elsewhere, so **not one allowance was carried by an unreachable frame alone.**
The drops are exactly the 284 frames leaving. The one row that rose did so for a
different reason and is the subject of §6 — its own before/after across the two
commits is 52 → 43 (the 9 unreachable frames leaving) → 58 (the arrow moving to
the edge the view actually clamps it to).

---

## 6. A second unreachable frame, found on the way — the arrow's edge

Declared here because it is the same defect class one level down, and because it
is a change to the census that the brief did not ask for. It is its own commit
(`2093b540`) so it can be read or reverted separately.

`Hud.drawHomeArrow` asks **two** rectangles, and its own comment says they are
*"genuinely different on an ultrawide (a0-74)"*:

- *is home on screen?* — against the **whole viewport**, because the world is
  full-bleed and a station out in the gutter is a station you can see;
- *where does the arrow go?* — clamped to the **content box**, because *"the far
  edge of a 32:9 display is where the whole second report says the player is not
  looking."*

The census asked only the first and rode the arrow along the screen edge on all
four viewports. That is the game's answer on the phone and the 1280×800 desktop,
where the content box **is** the screen; on the two ultrawides it is wrong by the
box inset — 440 px on the 21:9 and **960 px** on the 32:9. At a due-east bearing
on the 32:9 the sweep drew the arrow at `x 3812` and the game draws it at
`x 2844.5`.

It cut the expensive way: the readouts the a0-116 / a0-125 yield must clear are
content-box furniture, and an arrow riding the screen edge mostly misses them, so
the sweep was **under-testing the rule on the two widest screens**. Corrected, the
arrow reaches the minimap on 58 frames rather than 43 — and the shipped
`ARROW_KEEPOUT_IDS` yield holds on every one of them, which is a confirmation
a0-125 could not have had at the positions it was measured at. No new breach.

While re-measuring it, the `alarm-arrow over minimap` row's worst case was
re-taken: **7.7% of the map's rect, on the phone at bearing 17°, and never the
map's centre** — so the tap that expands the map is still untouched and the row's
argument is unchanged. The comment had been carrying a0-122's *3%* since before
a0-125 changed what the arrow yields to; it now carries the measured number and
says when it was taken.

---

## 7. What this does not claim

Three limits, stated rather than left to be rediscovered — the same discipline
a0-122 §5 set for itself.

1. **Reachability is decided for the elements the census composes, not for every
   element.** The six rules in §1.2 are the compositions; nameplate placement
   (`labelYieldsToReadouts`, `labelRepeatsOwner`, off-canvas culling) and the
   onboarding prompt's withdrawal are already taken straight from the shipped
   functions inside the builder, so there is no free boolean there to check
   against. A future element added with a hand-set flag needs a rule here, and
   the `Stage` on every variant is the hook it hangs from.
2. **"A prompt is up" is still a free fact.** Whether GDD §2.10's onboarding
   sentence has fired is a persistence question (`src/ui/onboarding.ts`), not a
   geometric one, and the sweep stages it on `match-prompt`, `match-wheel` and
   the a0-100 control on the argument the census already carried. If that ever
   becomes a place a defect hides, it is the next thing to derive.
3. **The camera scale is taken as 1, because `drawHomeArrow` takes it as 1.**
   `@platform/camera` grew a scale at a0-74 and the touch VIEW chip ladders it to
   `1 / 1.5` and `1 / 2` (`@ui/viewport` `cameraScale`), but the shipped
   visibility test hands raw world `ship.pos` / `station.pos` to a function whose
   viewport is in CSS pixels — so at a zoomed-out step the game's own arrow can
   be up while the station is visibly on screen. **That is a question about
   `src/`, not about this sweep**, and it does not touch the exclusion in §2:
   both conditions are stated in world units, so the 160-vs-164 arithmetic is the
   same at every zoom step. Flagged for a ui brief; not modelled here, because
   modelling it would mean modelling a behaviour nobody has ruled on.

---

## 8. How to run it

```sh
npx vitest run tests/adversarial/layout-overlap.test.ts
```

Eight assertions, 1,612 frames, about 100 ms — still cheap enough to be a
standing gate. The new one is:

```
✓ every swept frame is a frame the game can draw
```

To add a state: one entry in `STATES` with a `Stage` and a `reached:` sentence
saying how a player gets there. To add a viewport: one row in `VIEWPORTS` — and
if it is narrow enough that the docked disc reaches its inset rect, the
inequality in §1.3 will fail and tell you the sweep now needs a state for a wheel
and an arrow on one screen.
