# a0-122 — the overlap sweep: every state, every viewport, every pair

**Six overlap defects shipped in four days. Every one was found by a person
looking at a screenshot. CI was green for all six.**

| brief | what was covering what |
|---|---|
| a0-97 | the pause SETTINGS screen's DONE plate, under the DOWNLOAD LOG button |
| a0-100 | the objective prompt drawn through the build wheel, 318 px of it |
| a0-114 | a refused HOST drawing RETRY and DOWNLOAD LOG onto the doors |
| a0-115 | a rival nameplate drawn through the word ORE, 4 of 28 stops |
| a0-116 | the alarm arrow across the wave clock |
| a0-119 | two nameplates for the same owner, on each other |

A golden compares a frame to yesterday's frame, so a frame that was always wrong
stays wrong quietly. Six briefs each measured one pair by hand — a0-99, a0-111
and a0-118 did the measuring — and none of them left an instrument behind, so the
seventh had to start over.

This is the instrument. `tests/adversarial/layout-overlap.test.ts`,
`nothing a player must read is covered by anything else`, ~90 ms, in the standing
suite.

---

## 1. The rule

> **An element a player must read or press may not be covered by another element
> drawn after it.**

Three words in it are load-bearing, and each one is one of the six:

- **"must read or press"** — not every intersection is a bug. A scrim under a
  readout intersects it by design (a0-102's ground); the touch sticks sit under
  whatever the fight puts above them; a nameplate passing behind the HUD is the
  world passing behind the HUD. So everything painted declares a **role** —
  `read`, `press`, `ground`, `world` — and only `read` and `press` can be the
  *victim* of a cover. A blanket "no two rects may intersect" fails on all of the
  above and teaches everyone to ignore the gate.
- **"covered by"** — a rect test, never a point test. a0-98 asked
  `elementFromPoint` at one point per control, and a button taking the top third
  of the HOST plate answered *clear*.
- **"drawn after it"** — the asymmetry is why the rule can be stated once instead
  of as a table of pairs. A scrim drawn **before** a readout is a ground; the
  same rect drawn **after** it is a cover.

### What the registry cannot say — the brief asks, and the answer is three things

A `LayoutEntry` (`@platform/layout-registry`) is `{id, anchor, bounds}`. The rule
needs three facts that are not in it, and each absence is one of the six:

1. **Draw order.** Nothing says which of two entries is on top. Without it, a
   scrim under a readout and a button over a plate are the same finding.
2. **"Must be read or pressed."** Every entry is equal, so the registry cannot
   tell the DONE plate from the beam behind it.
3. **"This may sit inside that."** a0-115 established that some elements
   legitimately sit inside others. There is no way to declare it, which is why
   `src/ui/layout-exclusions.ts` had to invent one side table and
   `src/ui/anchor-reach.ts` a second — both in UI-owned files, both explicitly
   written to lift into the registry verbatim on the day its owner wants them.

`tests/adversarial/layout-model.ts` is the third such side table, for the same
reason and in the same shape. `Painted.role`, `Painted.surface` and the paint
order are the three missing fields; they lift into `LayoutEntry` unchanged.

**And a fourth thing the registry cannot see at all: the DOM.**
`src/net/playtest-log-button.ts` (a0-97) and `src/net/connect-trace-view.ts`
(a0-114) are `position:fixed` elements over the canvas at the platform's maximum
z-index, and neither registers anything. A rect sweep of registry entries alone
scores both of those defects clean — that is what *"rect intersection alone missed
the DOWNLOAD LOG button once already"* means. Both are modelled here from their
own CSS, marked `surface: 'dom'`, and painted above every canvas element.

---

## 2. What was swept

**17 states × 4 viewports × their variants = 1,896 frames, 26,803 painted
elements, 360,750 ordered pairs.**

Every rect comes out of the shipped geometry — `entryLayout`, `pauseLayout`,
`settingsLayout`, `endOfMatchLayout`, `connectionStatusLayout`, `wheelFootprint`,
`promptBounds`, `waveClockLayout`, `oreCounterLayout`, `stationHpBounds`,
`collapsedRect`, `homeArrow` — and every string is measured through
`src/ui/font-metrics.ts`, the repo's own per-glyph advances of the shipped
`public/fonts/*.woff2`. Nothing below is a number typed into the sweep, so a
drawing change lands here by itself. The paint order is `src/ui/hud.ts`'s own
`addChild` list and each view's own draw sequence.

### The viewports

| id | size | touch | why it is in |
|---|---|---|---|
| `phone-798x384` | 798×384 | yes | the profile a0-98, a0-111, a0-114 and a0-118 all captured on, so a finding here sits beside their numbers |
| `desktop-1280x800` | 1280×800 | no | the second half of that same pair |
| `ultrawide-3440x1440` | 3440×1440 | no | 21:9 — the developer's own display (`evidence/a0-75-fill-rate`), and the ultrawide report a0-74 answered |
| `ultrawide-3840x1080` | 3840×1080 | no | 32:9, where the HUD chrome is bound to a content box far inside the glass (a0-74's fix, a0-103's `CONTENT_BOUND_IDS`) — the case a naive sweep gets wrong in both directions |

### The states

| state | frames/viewport | what it is | the defect that lived here |
|---|---:|---|---|
| `match-hud` | 28 | the match HUD at rest, one frame per camera stop | a0-115 — a nameplate through the word ORE |
| `match-prompt` | 1 | the HUD with an onboarding prompt up | a0-100 |
| `match-wheel` | 1 | the build wheel open, SPEND prompt firing | a0-100 — 318 px of prompt through the wheel |
| `match-alarm` | 360 | under alarm, one frame per bearing | a0-116 — the arrow across the wave clock |
| `match-alarm-wheel` | 72 | alarm sounding with the wheel open | a0-116 + a0-24's one-row clock re-flow |
| `pause-menu` | 1 | the pause menu | a0-97 — the corner offer stands here, and only here |
| `pause-settings` | 1 | the pause SETTINGS screen | a0-97 — DONE under the DOWNLOAD LOG button |
| `pause-confirm` | 1 | the EXIT confirmation | a0-97 — the second screen stacked over pause |
| `doors` | 1 | the doors screen, idle | a0-114 — the screen the refusal landed on |
| `doors-refused` | 1 | a refused HOST | a0-114 — DOWNLOAD LOG over the word HOST |
| `keypad-refused` | 1 | a refused JOIN | a0-114 — the mode switch under RETRY, missed by a centre probe |
| `online-error` | 1 | the online error overlay | a0-97 — an error screen carries the corner offer |
| `online-reconnecting` | 1 | the reconnecting overlay | a0-97 — an overlay that is merely waiting |
| `end-victory` | 1 | end of match — VICTORY | the four outcomes the brief names |
| `end-defeat` | 1 | end of match — DEFEAT | " |
| `end-draw` | 1 | end of match — DRAW | a0-113 made DRAW reachable; it had never been swept |
| `end-eliminated` | 1 | end of match — ELIMINATED | " |

The 28 camera stops in `match-hud` are a row of 14 across the top band where the
readouts live plus 14 down the middle — a0-111 sampled 28 and found 4 bad. The
two nameplates at each stop are a **station's and a ship's, one owner, rows
coincident**: that is the frame the developer photographed on 2026-08-19, and a
census that put them a comfortable distance apart would never engage a0-119's
rule at all.

---

## 3. Every intersection the sweep found

Twelve `(coverer, covered)` classes across the 1,896 frames. Seven are declared
exceptions; **five are defects**, and all five are new. *(a0-125 fixed four of
the five; §3a carries each one's disposition.)*

### 3a. Defects — pinned in `KNOWN_COVERS`, not fixed

QA owns `tests/` and `harness/`. Each of these is a reproduction a ui brief can
be built from, and the third assertion in the gate fails **the day one is fixed**,
so none can be quietly forgotten and none can be quietly re-broken.

> **a0-125 (2026-08-21): four of the five are fixed, and `KNOWN_COVERS` is one
> line.** D1, D2, D3 and D4 no longer reproduce; D5 is measured, argued and kept.
> Each heading below carries its disposition, and the rows are left standing
> rather than struck because the measurements are what the fixes were built from.
> Evidence for D1: `evidence/a0-125-the-corner-two-boxes-share/`.

#### D1 — the re-enter-fullscreen affordance over own-station HP — **FIXED (a0-125)**

| | |
|---|---|
| **pair** | `fullscreen-reenter` over `station-hp` |
| **frames** | 462 — the phone, every one of the five match states |
| **worst** | **31%** of the readout |
| **rects** | `fullscreen-reenter {738,12 48×48}` ∩ `station-hp {642,16 140×30}` = `{738,16 44×30}` |

Both elements declare `top-right`. The affordance
(`@render/fullscreen-affordance`) hugs the top-right of the **glass** at margin
12; the HOME readout hugs the top-right of the **content box** at `HUD_PAD` 16.
a0-103 asserted that each one reaches its own corner; nobody asked whether they
reach the same one. On the phone the affordance takes 44×30 px of a 140×30 px
readout — the own-station HP GDD §2.2 puts in that corner — from the moment the
player leaves fullscreen, and it is `main.ts`'s `gameRoot.addChild` order that
decides it: `hud`, then `touchVisuals`, then `fsAffordance`.

Desktop and the ultrawides are clean, for two different reasons that are both
worth writing down: `FullscreenLifecycle.affordanceVisible` is **touch-only**
(*"desktop is untouched — keyboard/mouse never auto-fullscreens"*), and on 21:9
and 32:9 the content box is far enough inside the glass that the two corners are
hundreds of px apart.

> **a0-125.** The sentence above is the finding, and the fix is named after it:
> the registry now has a word for *whose box* — `LayoutSurface` in
> `src/ui/anchor-reach.ts`, with `CONTENT_BOUND_IDS` as its data and
> `cornerRivals()` as the check nobody had ("every pair declaring one region from
> two different boxes whose rects really meet"). The HOME column and the VIEW chip
> under it step left by exactly the button's intrusion while the button is up —
> `glassCornerReserve`, two declared rows in `LAYOUT_RESERVATIONS` — which is 0 on
> both ultrawides by arithmetic and 0 on every frame the button is down, so the
> three profiles that were already correct are untouched. Measured on the bench:
> 32% → 0%, air 0 → 1.5 px.

#### D2 — the ping stamp over the arrow home — **FIXED (a0-125)**

| | |
|---|---|
| **pair** | `net-ping` over `alarm-arrow` |
| **frames** | 21 — 17 phone, 3 desktop, 1 at 32:9 |
| **worst** | **63%** of the arrow (phone, bearing 155°) |
| **rects** | `net-ping {8,349 160×12}` ∩ `alarm-arrow {33.7,343.3 24.8×19}` = `{33.7,349 24.8×12}` |

#### D3 — the build stamp over the arrow home — **FIXED (a0-125)**

| | |
|---|---|
| **pair** | `build-badge` over `alarm-arrow` |
| **frames** | 22 — all four viewports |
| **worst** | **62%** of the arrow (21:9, bearing 158°) |
| **rects** | `build-badge {8,1394 160×12}` ∩ `alarm-arrow {14.1,1391.1 24.8×19.5}` = `{14.1,1394 24.8×12}` |

D2 and D3 are one root. The two dev stamps stack in the bottom-left on
`badgeRoot`, which `main.ts` adds to the **stage** after `gameRoot` — so they are
over the entire game, not merely over the HUD. a0-103 lifted both of them clear of
the controls strip (`BADGE_STRIP_LIFT`, `PING_BADGE_STACK_LIFT`); nothing lifted
them clear of a mark that **moves**. On the bearings that put home in that corner
the arrow is more than half under a stamp. Neither stamp is in
`HUD_READOUT_IDS`, so a0-116's yield never considers them, and neither is
registered as something the arrow must clear.

> **a0-125.** D2, D3 and D4 are answered once, not three times:
> `src/ui/layout-exclusions.ts` `ARROW_KEEPOUT_IDS` states what the arrow may
> share pixels with, and it is deliberately a second table from the world label's.
> The arrow gives up radius — never bearing — to clear every FIXED rect on the
> glass, in either direction, and may overlap only WORLD surfaces. The stamps are
> `@render`/`@net` elements the HUD cannot measure, so `main.ts` hands their rects
> in on the frame (`HudFrame.hostChrome`). The same rule caught a **fourth** cover
> of this mark that the D1 fix created — with HOME out of the corner the arrow rode
> straight under the fullscreen button, 100% — photographed in
> `evidence/a0-125-the-corner-two-boxes-share/`.

#### D4 — the arrow home over the controls strip — **FIXED (a0-125)**

| | |
|---|---|
| **pair** | `alarm-arrow` over `controls-strip` |
| **frames** | 440 of 1,440 alarm frames — desktop and both ultrawides |
| **worst** | 1% of the strip's band, but `{629.5,770 21×17}` of it — a 21×17 px triangle **in the type** |
| **rects** | `alarm-arrow {629.5,764.5 21×22.5}` ∩ `controls-strip {0,770 1280×30}` |

**This is a0-116 exactly, one element over.** The arrow yields to
`HUD_READOUT_IDS`, and that list leaves the strip out with an argument attached:
*"`controls-strip` and the touch affordances (furniture the thumb finds, not type
the eye reads)"*. That argument was written in a0-115, about a world **label**
landing on a thumb target. On a desktop there is no thumb, the strip is nothing
but type — `WASD Thrust` — and the arrow lands in it on 440 of 1,440 alarm frames.

Whether this is a defect to fix (add `controls-strip` to the arrow's keep-out) or
an exception to accept (the strip is chrome, the arrow is a danger tell, and the
tell should win) is a ui/design call and **not QA's**. It is pinned so that the
call gets made rather than forgotten. The phone is clean because
`showControlsStrip(isTouch)` draws no strip there at all.

> **a0-125 made the call: fix.** The strip's exclusion argument — *"furniture the
> thumb finds, not type the eye reads"* — was written in a0-115 about a world
> LABEL landing on a thumb target. On a desktop there is no thumb and the strip is
> nothing but type, and the arrow is not a caption: it is the tell the player is
> least able to hunt for. `controls-strip` is on `ARROW_KEEPOUT_IDS`; the arrow
> clears the band and keeps its bearing bit-identical.

#### D5 — the wheel's halo over the arrow home — **KEPT (a0-125), pinned**

| | |
|---|---|
| **pair** | `build-wheel` over `alarm-arrow` |
| **frames** | 38 — phone only, wheel open under alarm |
| **worst** | **100%** — the arrow's whole box inside the wheel's footprint |
| **rects** | `build-wheel {239.7,32.7 318.5×318.5}` ∩ `alarm-arrow {240.7,33.7 23.3×23.3}` |

The registered footprint is what the wheel **fills**, halo included — a0-100's own
finding, `wheelFootprint` 318.5 px against a `wheelBounds` disc of 276.5 px. On a
384 px-tall screen that reaches the 28 px edge inset the arrow rides, so at the
diagonal bearings the arrow is inside the halo pool. What it is under is the
**halo**, not the disc: the disc begins 21 px further in on each side. Low
severity and real — an alarm tell dimmed by the surface the player just opened.

### 3b. Declared exceptions — `LAYOUT_ALLOWANCES`, one argument each

Each row is in `tests/adversarial/layout-model.ts` with its reason, never a silent
skip. **Every row fires** — the gate asserts it, so a permission that excuses
nothing is deleted rather than left to read as "we thought about this".

| pair | frames | worst | the reason |
|---|---:|---:|---|
| `banked-total` over `ore-hud` | 1848 | 21% | The numeral **is** the counter's second row. `Hud.describeLayout` registers the cluster and the numeral as two ids (a0-115 lists both in `HUD_READOUT_IDS` for exactly this reason), so the pair overlapping is a fact about the id list, not about the screen. |
| `settings-help` over `settings-row` | 24 | 11% | The `?` square is hung off its own row's leading edge (a0-77) — one control nested in the row it explains. |
| `alarm-arrow` over `minimap` | 35 | 8% | `HUD_READOUT_IDS` leaves the minimap out **on purpose** and says why: *"a map of the world is a world surface, and a name over it is a name over the thing it names."* The arrow is a world mark by that same argument. Across all 360 bearings it reaches at most 8% of the map's rect and never its centre, so the tap that expands the map is untouched. |
| `alarm-frame-bottom` over `controls-strip` | 1296 | 13% | The alarm frame **is** the screen's border: `ALARM_FRAME_STROKE` is 4 px hard against the viewport edge, and the strip's band runs to that same edge, so the two meet by construction. What the border crosses is the band's outermost 4 px — the scrim's bleed, not its type, which sits a row up. The frame is modelled as **four bars, not a filled rect**, precisely so this stays a claim about 4 px and never becomes "the alarm frame may cover anything". |
| `alarm-frame-left` over `controls-strip` | 432 | 0% | as above — 4×30 px at the strip's left end |
| `alarm-frame-right` over `controls-strip` | 432 | 0% | as above — 4×30 px at its right end |
| `entry-eyebrow` over `entry-title` | 8 | 34% | **A limit of the model, not a fact about the screen** — see §5. Both rects are allocations of ONE header beam: `entryLayout` gives the eyebrow cluster the beam's left share and centres the wordmark across the whole beam, *"and the view shrinks the wordmark (never the cluster) if the two would collide."* |

---

## 4. Are the six clean? **Yes — all six.**

And the more useful half of that sentence: **the sweep would have caught all six.**
A green run that cannot go red is a screenshot with extra steps, and all six of
these screens were green in CI. So each of the six is re-staged through the *same
builders* with only the shipped rule that fixed it switched off, and the gate
asserts the sweep still names the pair (`CONTROLS`, assertion 4). It also asserts
that none of those six pairs appears anywhere in the real sweep (assertion 5).

| brief | rule bypassed | the sweep, with it off | in the shipped build |
|---|---|---|---|
| **a0-97** | `pauseAllowsDownloadLog` — the offer withdraws on anything stacked over pause | `playtest-download-log-button` over `settings-done`: **52%** on the phone `{598.4,335.5 176.6×36.5}`, 35% on the other three | **clean** — the offer is not on the settings screen at all, so there is no rect to intersect |
| **a0-100** | `promptBand` / `promptWithdraws` — the prompt yields to an open wheel | `onboarding` over `build-wheel`: **10%**, `{239.7,319 318.5×32.3}` — 318.5 px wide, a0-99's own number | **clean** on all four viewports, wheel open and closed |
| **a0-114** | `refusalStrip` — the panel stands in the band the screen reserved for it | phone: `pr-connect-trace-download` over `door-create` (**12%** — `create` **is** the HOST door) and `pr-connect-trace-retry` over `door-campaign` (9%). Desktop and both ultrawides: `pr-connect-trace-download` over `entry-message` — *the failure line, behind the button offering to report it*, which is a0-114's own desktop finding | **clean** — `doors-refused` and `keypad-refused`, all four viewports |
| **a0-115** | `labelYieldsToReadouts` — a world label steps out of a fixed readout | `ore-hud` over `nameplate-station`: **71–77%** of the plate, all four viewports | **clean** — 112 camera stops |
| **a0-116** | `arrowClearOfReadouts` — the arrow gives up radius to clear a readout | `alarm-arrow` over `wave-clock`: 3–5%, all four viewports | **clean** — 1,728 alarm frames, 360 bearings × 4 viewports × 2 wheel states |
| **a0-119** | `labelRepeatsOwner` — an owner's second label stands down | `nameplate-ship` over `nameplate-station`: **100%**, the two rects identical, all four viewports | **clean** — the second plate stands down at every stop |

The a0-114 row is the one worth reading twice: the model reproduces **both halves
of that capture independently** — the phone's covered HOST plate and the desktop's
covered failure line — which is the strongest evidence available here that the
model's geometry is the shipped geometry and not a second opinion about it.

---

## 5. Modelling limits, declared

A model that quietly guesses is what a0-98 was. These are the places this one
guesses, said out loud.

1. **Five private constants are mirrored** (`MIRRORED` in `layout-frames.ts`):
   `hud.ts`'s `STRIP_ROW` 18 and `STRIP_PAD` 12, and the wave clock's three type
   sizes 15/14/13. Each is a **size**, never a position, so a drift makes a
   modelled rect the wrong size rather than putting it in a different corner. The
   same compromise `src/ui/minimap.test.ts` `STAMP_TEXT` makes, and for the same
   reason: the alternative is not measuring the element at all, and an element
   left out of a sweep reads as an element that passed.
2. **The refusal panel's height is transcribed, not measured** — 69.4 px, the
   number a0-114's capture read off both real profiles. It is a DOM box, so a
   headless model cannot measure it; `src/main.ts` `refusalHeightLogical` reads
   `getBoundingClientRect` for exactly that reason.
3. **The corner DOWNLOAD LOG button's box is its own CSS minimum** —
   `min-height:44px`, `min-width:44px`, `padding:.55rem 1.1rem`,
   `clamp(12px,3vw,14px)`. Conservative by construction: where this is wrong it
   is wrong by being too **small**, and a too-small box can only miss a cover,
   never invent one.
4. **A layout rect is not always an ink box.** `entry-eyebrow` over `entry-title`
   is the one finding in this sweep that is an artefact of that: both are
   allocations of one header beam, and the wordmark's real ink is narrower and
   centred. It is carried as a declared exception rather than deleted, because
   the day the beam stops being shared it should be re-examined.
5. **One control scheme.** The match states are swept at Tap Commander
   (`'tap'` + `AutoAim`), the default on every platform since a0-30, which draws
   no sticks and no FIRE. The stick/FIRE layouts are a second dimension this
   sweep does not cross, and `src/ui/minimap.test.ts` crosses them for reach.
6. **No portrait, and no landscape lock.** Under the lock the fixed DOM surfaces
   lie *across* the logical screen rather than above it — a0-114 recorded the same
   gap and did not close it, `refusalHeightLogical` returns 0 under rotation, and
   guessing a rotated rect here would be a guess where the rest of this measures.

---

## 6. How to run it

```sh
npx vitest run tests/adversarial/layout-overlap.test.ts
```

1,896 frames in about 90 ms, in the standing suite — cheap enough to be a gate
rather than an evidence script somebody remembers to run, which is the whole
difference between this and the six hand measurements it replaces.

To add a state: one entry in `STATES`, built from that screen's own layout
function. To add a viewport: one row in `VIEWPORTS`. To accept a finding: delete
its line from `KNOWN_COVERS` **and** add a row to `LAYOUT_ALLOWANCES` with the
argument — the gate will not let you do only one of those.
