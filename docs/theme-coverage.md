# Theme coverage — how far Gantry / Bone actually reached

**Author:** Architect Agent (a0-20) · **Date:** 2026-08-11 · **Status:** audit, read-only.
**Scope:** every surface a player sees *during a match*, plus the build wheel measured
against its own ratified design. **No `src/` was changed by this brief.**

---

## The headline

> **24 in-match surfaces audited: 11 COMPLIANT, 6 PARTIAL, 7 UNTHEMED.**
> Every one of the four touch controls is UNTHEMED — the developer is right, the
> thumbs were never touched. The build wheel is the *most* compliant surface on the
> glass and still not fully: its material, geometry, type and palette are the
> handoff's own numbers, but the **selection state the design specifies — the
> highlighted wedge, the 140 ms sweep, and the caption band that says what a wedge
> does — was never built**, and on desktop the wheel has no hover at all.

And two things worth knowing before the table:

- **The HUD was never in the handoff's named scope** (`docs/design/gantry-bone-handoff.md:11`
  — "the **five screens** … title, build wheel, lobby, ship select, settings"). But the
  direction *was* extended into the match afterwards, deliberately and well, by u7-07
  (`src/ui/instrument.ts`) and u11-01. So the in-match HUD is not "untouched" — it is
  **most of the way there**, and what is left is small. The touch controls are a
  different story: nothing has ever been applied to them.
- **`src/art/compliance.test.ts` cannot see any of this.** It walks the *sprite* IR
  (`src/art/compliance.ts:36-47` imports `./shapes`; the suite's own headings are
  "the RESERVED rule across the whole catalogue"), so it audits ships, stations and
  asteroids — never a `src/ui/` view. Every plasma stick and every flat
  `letterSpacing: 0.5` in this report passes it green. Colour is guarded; the *look*
  is not.

---

## Reproducing the design-side citations

The ratified artefact `docs/design/gantry-bone-handoff.html` ships as a single
JSON-escaped line, so `grep -n` on it returns one line number and no context. Every
quote below that cites the **design** (rather than the code) is read through the
throwaway extractor in this brief's spike:

```bash
node spikes/a0-20/extract-handoff.mjs        # lists the screens: 4c, 5a…5d
node spikes/a0-20/extract-handoff.mjs 5a     # the BUILD WHEEL screen's markup
```

Line numbers quoted as `5a:NN` are lines of that command's output. Code citations are
`file:line` in the repo as of this branch's parent, `0f8fd05`.

---

## 1. The build wheel, against its own design

The developer's sharpest question: *"is the build wheel FULLY theme compliant like how
the design for it was made"*. The wheel **is** one of the five, so this is measured
clause by clause against screen 5a rather than against the prose summary.

### 1a. What is compliant, and provably so

| The design says (screen 5a) | The build ships | Where |
|---|---|---|
| 470 px disc, 150 px hub, wedge type 17 / 12 / 20 / 12 px | The same numbers, declared as the desktop profile *verbatim* | `src/art/materials.ts:1488-1512` |
| Halo: a box inset −120 px carrying `radial-gradient(rgba(13,16,21,.7) 52%, transparent 78%)` | peak 0.7, hold to 0.79 R, fade to 1.18 R — the same gradient re-expressed in units of the radius (52 % of 355 px = 0.79 × 235; 78 % = 1.18 ×) | `src/art/materials.ts:1656-1665`, drawn `src/ui/build-wheel-view.ts:820-838` |
| `inset:-26px; border:1px solid rgba(126,136,148,.14)` — the hairline that ends the pool | `circle(r + haloOffset).stroke({ haloRing, hullSteel, alpha: 0.14 })`, `haloOffset` 26 | `src/ui/build-wheel-view.ts:839-841` |
| `box-shadow: inset 0 0 56px rgba(0,0,0,.74)` — the machined inner lip | vignette 56, stepped as nested rings | `src/ui/build-wheel-view.ts:846-853` |
| A 2 px rim in `#55616e` | Lit across the top (`ruleLit`), shadowed across the bottom (`ruleDeep`) — the handoff's own "lit top edge, shadowed under-line" diagnosis stated on a circle | `src/ui/build-wheel-view.ts:855-861` |
| 1.2° conic spokes in `#55616e` between wedges | Hairline spokes in `MATERIAL_SHADES.hairline`, one per boundary | `src/ui/build-wheel-view.ts:889-903` |
| An 8 px index diamond at twelve o'clock | Drawn, in `WHEEL_CHROME.mark` | `src/ui/build-wheel-view.ts:863-868` |
| Hub: 40 px ore numeral, `ORE` caption, a 38 px fading hairline, `CLOSE` | All four, plus a chevron the design does not have (added later by field report v0.2.4) | `src/ui/build-wheel-view.ts:700-790` |
| `sub` line at `.16em`, wedge names in Audiowide | `TRACKING.label` (= .16em) on the sub and detail lines, `DISPLAY_TRACKING.heading` on the name | `src/ui/wheel-stack.ts:88-131` |
| Cost yellow when affordable, red when not, `FULL` when capped | Exactly that, as the one ratified RESERVED carve-out | `src/ui/build-wheel-view.ts:258-272`, `src/ui/instrument.ts:200-206` |
| "No plates over gameplay — the world reads through" (`5a:5`) | The wedge draws **no outline of its own** and the disc stays translucent; a wedge's state is a brightness lift, not a surface | `src/ui/instrument.ts:262-281` |

The **colour** half was the last gap and u11-01 closed it: the hub chevron was plasma,
the `OPEN ▸` signpost and the index diamond were a hand-picked chalk, and every wedge
face was raw `hullSteel`. All of it now comes from one declared Bone ramp
(`src/ui/instrument.ts:208-260`), recomputed against its recipes by
`src/ui/instrument.test.ts`. **On material, geometry, type and palette the answer to
the developer's question is yes.**

Three deliberate, defensible departures, listed so nobody re-opens them as bugs:

- **Five wedges, not four.** The design draws TURRET / SHIELD / REPAIR CORE / UPGRADE
  SHIP at 90°. RADAR was added by feature f1 and GDD §2.5 carries the cap, so the wheel
  is five at 72°. The design is superseded here, not missed.
- **`cost/held` is gone.** `5a` prints `items[i].cost + '/' + ore`; the developer
  retracted that on 2026-08-07 (*"just need the needed amount in yellow, and red if
  insufficient"*, GDD §2.5) and a0-03 executed it. One numeral is correct.
- **No 92 px beams on this screen.** `docs/design/gantry-bone-handoff.md:22` claims
  "44 px margins, 92 px header/footer beams" across all five screens — and its **own
  screen 5a has no beams at all**: a 176 px top gradient (`5a:23`) over an 84 px
  content row at `padding: 0 44px` (`5a:25`). `src/ui/instrument.ts:30-38` translates
  beam → scrim for precisely this reason. The code follows the HTML; where the two
  disagree the HTML is the artefact the developer ratified.

### 1b. What is missing — and it is the part the design spends the most pixels on

**The selection state does not exist.** Screen 5a gives a selected wedge five separate
tells, all keyed off `sel`:

| `5a` | The design |
|---|---|
| `5a:55` | A 90° accent-tint conic over the selected quadrant, `rotate({{selRot}}deg)` |
| `5a:56` | Two 1.6° white edge lines bounding it, with `box-shadow: 0 0 26px rgba(255,255,255,.16)` |
| `5a:57` | A `closest-side` outer glow masked to that quadrant |
| `5a:55-57` | All three on `transition: transform 140ms cubic-bezier(.2,.7,.2,1)` — **the sweep** |
| script `wedge(i)` | The selected wedge's name goes **19 px** (from 17), to `--acc-hi`, with `text-shadow: 0 0 18px`; its sub line goes `#DCE3EC` (from `#7E8894`) |
| `5a:100-103` | A caption band under the wheel: a fading rule, `{{selName}}` as a `.26em` eyebrow, and **`{{selDesc}}` — a sentence saying what the wedge does** ("Automated point defence. Fires on anything that isn't yours.") |

None of it ships:

- `BuildWheelModel` has no selected index — `open`, `ore`, `segments`, `hubBack`, and
  nothing else (`src/ui/build-wheel.ts:398-414`).
- `drawWedge` takes no selection and paints a wedge from **affordability alone**; the
  only per-wedge dynamic is the press/confirm driver (`src/ui/build-wheel-view.ts:910-1006`).
- The in-match `pointermove` handler routes to the pause menu and the end overlay and
  nothing else (`src/main.ts:1530-1541`) — **on desktop, moving the mouse across the
  wheel changes nothing and makes no sound.** The design's "Wedge crossed → detent, one
  note an octave above the click, muted while unaffordable" (handoff §Audio) fires
  nowhere on this wheel: every `audio.cue('detent')` in `src/main.ts` is a menu, a
  settings row or a lobby seat.
- `PLATE_MOTION` — the handoff's `90ms` control transition and `140ms
  cubic-bezier(.2,.7,.2,1)` wheel sweep — is **declared and imported by nothing**
  (`src/art/materials.ts:642-648`; `grep -rn PLATE_MOTION src` returns that declaration
  and no consumer). The wheel's only motion is its own open/close pop at 0.12 s
  (`src/ui/wheel-toggle.ts:34`), which is a different event.

Two smaller omissions from the same screen: the disc's top sheen
(`linear-gradient(180deg, rgba(220,227,236,.09) 0%, transparent 34%)`, `5a:58`) is not
drawn, and the hub's face is a flat `vacuum @ .95` where the design gradients
`#1a2129 → #0d1015` (`src/ui/build-wheel-view.ts:871`).

**Verdict — BUILD WHEEL: PARTIAL.** Fully compliant in material, geometry, type and
palette; missing the selection language the design built the screen around.

**Cost:** the selection tells are one `selected: number | null` on `BuildWheelModel`,
one conic/arc highlight in `drawRings`, a brightness+size step in `drawWedge`, and a
pointer-hover route in `main.ts` — a day for one UI-lane agent. The caption band
(`selDesc`) is a **content** job before it is a drawing job: five sentences of
industrial-voice copy that do not exist anywhere yet, and GDD §2.5's "the wheel says
what a thing costs and what it acts on; the game teaches what it's worth" is an
argument *against* adding them. That one needs a ruling, not an estimate.

---

## 2. Every in-match surface, with a verdict

Ranked by how much of a match the player spends looking at it.

| # | Surface | Verdict | Why | Evidence |
|---|---|---|---|---|
| 1 | **Left thrust stick** (ghost ring, live base, knob) | **UNTHEMED** | 3 px plasma rings and a plasma knob. No Bone, no tracking, no instrument import — the file has never referenced the direction. | `src/platform/touch-visuals.ts:437-448` |
| 2 | **Right aim stick** (Manual mode) | **UNTHEMED** | The same two factories, same plasma. | `src/platform/touch-visuals.ts:266-268, 437-448` |
| 3 | **Hold-to-FIRE button** (Auto-aim) | **UNTHEMED** | Plasma fill + 4 px plasma ring + a plasma `FIRE` label at flat `letterSpacing: 1`. | `src/platform/touch-visuals.ts:299-307` |
| 4 | **BUILD button** | **UNTHEMED** | Two plasma haloes, plasma fill, 5 px plasma ring, `BUILD` at `letterSpacing: 1` and `& UPGRADE` at `0.5`. | `src/platform/touch-visuals.ts:330-349` |
| 5 | **Build & Upgrade wheel** | **PARTIAL** | §1 above. Material/geometry/type/palette compliant; no selection state, no hover, no sweep, no caption band. | `src/ui/build-wheel-view.ts`, `src/ui/build-wheel.ts:398-414` |
| 6 | **Over-ship hull bars** | **COMPLIANT** | Square corners by the direction's own rule (`INSTRUMENT_RADIUS`), track spent by role, the one tracking scale on the numerals. | `src/ui/healthbar-view.ts:49, 150-164, 289` |
| 7 | **Nameplates** (incl. `FRIENDLY A` / `ENEMY B`) | **COMPLIANT** | Gantry tracking on all three pools (`hudTracking('name', …)`), replacing the flat `0.5` all three used to spell. Colour is identity/side meaning, not chrome. | `src/ui/nameplates-view.ts:54, 70-72` |
| 8 | **Under-ship ore-hold pips** | **COMPLIANT** | Square by `INSTRUMENT_RADIUS`; signal yellow because it is ore, the one thing that may be. | `src/ui/ore-hold-view.ts:29, 107-115` |
| 9 | **Ore readout** (top-left, `ORE` + bank) | **PARTIAL** | Chrome is right — scrim + closing edge rule + the one tracking scale + a scaling type ramp. The **text tones are still the pre-Gantry literals**: `TEXT_MUTED = 0x8b95a5` and a local `TEXT_PRIMARY = 0xdce3ec`, neither of which is a declared point on the Bone ramp. | chrome `src/ui/hud.ts:916-924`; tones `:147`, `:693`; `src/ui/chrome.ts:49` |
| 10 | **Wave clock** (top-centre) | **PARTIAL** | Same: scrim + rule + tracking correct, `TEXT_PRIMARY` / `TEXT_MUTED` on two of its three lines. Its **layout** also differs from the design's own in-match sample — 5a draws the wave as a name over five 64×4 progress bars with `NEXT WAVE` as a separate top-right cluster; we stack three centred text lines. | `src/ui/hud.ts:706-708, 927-936`; design `5a:39-47` |
| 11 | **Station HP** (top-right, `HOME` + bar + `100/100`) | **PARTIAL** | Same two tones; everything else on-direction. | `src/ui/hud.ts:732-734, 940-947` |
| 12 | **Under-attack alarm** (screen frame + home arrow) | **COMPLIANT** | Threat red, drawn only while sounding. Red here is *damage*, which is the one thing style-guide §2 reserves it for — the direction preserves this rather than overriding it. No chrome to theme. | `src/ui/hud.ts:1636-1673` |
| 13 | **Minimap** | **PARTIAL** | The frame is genuinely Gantry — the gantry corner cut (top-right + bottom-left, never all four) and the Bone rule, and it is the *one* HUD element the direction says may be an opaque surface. Its **fill is still `PANEL_FILL` from the pre-Gantry ui-mockup vocabulary** (`#10141c`), not a Gantry face tone. | `src/ui/minimap-view.ts:40, 229-238`; rule `src/ui/instrument.ts:521-532` |
| 14 | **Controls strip** (desktop only) | **PARTIAL** | Keys are `INSTRUMENT_KEY` (Bone's brightest) — the correct fix, and it freed plasma. Action labels are still `TEXT_MUTED`. Scrim + rule correct. | `src/ui/hud.ts:1099-1107, 959-967` |
| 15 | **Onboarding prompt** | **COMPLIANT** | The plate's 3 px accent tick + a scrim at `SCRIM.prompt`, replacing a nearly-opaque panel that used to cover two wedges of an open wheel on a landscape phone. Text tone is `TEXT_PRIMARY` (see #9), nothing else. | `src/ui/hud.ts:1865-1878`; `src/ui/instrument.ts:296-308` |
| 16 | **Respawn countdown** | **COMPLIANT** | Scrim at `SCRIM.overlay` + an edge rule in the player's colour. | `src/ui/hud.ts:1249-1250` |
| 17 | **Cost floats** (ore travelling to the bank) | **COMPLIANT** | Signal yellow because it is ore; Gantry tracking via the shared `makeText` tier. | `src/ui/hud.ts:1800` |
| 18 | **Tap Commander markers** | **COMPLIANT** | Reticle / intent line / waypoint pulse in the owner's identity colour and nothing else — no chrome and no type for the theme to reach. | `src/ui/tap-markers-view.ts:155-226` |
| 19 | **Connection-status card** | **COMPLIANT** | `gantryPoly` silhouette on both the card and its action, and the one tracking scale. Plasma/threat-red is severity, i.e. meaning. | `src/ui/connection-status-view.ts:31, 123-144` |
| 20 | **Pause menu** | **COMPLIANT** | Real Gantry beams and `drawPlate` plates. | `src/ui/pause-menu-view.ts:46-47` |
| 21 | **End-of-match summary** | **COMPLIANT** | u7-05 rebuilt it in the material: beams, plates, one tracking scale, result stated as *brightness* on the Bone ramp rather than as a hue, identity as a 4 px rule. | `src/ui/end-of-match-view.ts:9-36, 41-56, 255-256` |
| 22 | **Re-enter-fullscreen button** (top-right, in match) | **UNTHEMED** | Plasma fill, plasma stroke, plasma glyph, `roundRect(..., 8)` — a rounded corner on the one glass the direction says is square. | `src/render/fullscreen-affordance.ts:71-94` |
| 23 | **Build-progress badge** (over a station under construction) | **UNTHEMED** | `hullSteel` text at flat `letterSpacing: 0.5` — the exact drift the handoff's one-line diagnosis names. | `src/render/build-badge.ts:191-192` |
| 24 | **Ping badge** (online) | **UNTHEMED** | Flat `letterSpacing: 0.5`. | `src/net/ping-badge.ts:116` |

**Tally: 11 COMPLIANT · 6 PARTIAL · 7 UNTHEMED.**

---

## 3. Every touch control — confirmed or refuted

The developer: *"some of the buttons mobile are still using the same unchanged buttons."*

| Control | Verdict | Confirmed / refuted |
|---|---|---|
| **Left thrust stick** | **UNTHEMED** | **Confirmed.** Plasma ring at three alphas, plasma knob. Unchanged since M1. |
| **Right aim stick** (Manual) | **UNTHEMED** | **Confirmed.** Identical factories to the left. |
| **Hold-to-FIRE button** (Auto-aim) | **UNTHEMED** | **Confirmed.** Plasma ring/fill/label, `letterSpacing: 1`. |
| **BUILD button** | **UNTHEMED** | **Confirmed.** Plasma throughout, including the two glow haloes added on 2026-08-05 to make it stand out — which made it *louder in plasma*, not themed. |
| **Boost button** | **n/a — does not exist** | **Refuted, as a premise.** Boost was cut (GDD §2.4 amended 2026-07-27, "an earlier build added a boost and a ping verb; both were cut"). The only trace in the tree is a comment in `src/bots/behaviors.ts:475`. There is nothing to theme. |
| **Ping tap** | **n/a — does not exist** | **Refuted, as a premise.** Cut in the same amendment. Every `ping` in `src/ui/` is a *latency* readout, not a map ping. |
| **Re-enter-fullscreen button** | **UNTHEMED** | Not in the brief's list, but it is a thumb control on the match screen and belongs here. |

`src/platform/touch-visuals.ts` imports `PALETTE` and nothing from `../art/materials`,
`./gantry` or `../ui/instrument` — the direction has never been applied to this file in
any form. Its own header still states its colour rule as *"plasma for
energy/interactive"* (`:14`), which was the correct pre-Gantry rule and is the opposite
of Bone's premise.

**One nuance that matters for the ruling:** on the touch layer plasma is not a wrong
colour, it is an *older* one. It is palette-legal (plasma is one of the six) and it
reads as "interactive". Recolouring these five controls to Bone therefore **frees a
hue rather than spending one** — plasma means energy in the match (shields, torch,
cockpit, weapon fire), and right now the game paints the player's own thumb furniture
in the same blue as the shield standing in front of an enemy reactor.

---

## 4. What applying the theme would cost — one sentence each

Ordered by cost, so the developer can buy the top of the list without buying the
bottom.

| Item | Cost |
|---|---|
| **Ping badge, build badge** (#23, #24) | Two lines each: swap `letterSpacing: 0.5` for `hudTracking('name', size)` — under an hour, no visual risk. |
| **Minimap fill** (#13) | One line: `PANEL_FILL` → a Gantry face tone; the frame is already right. |
| **Re-enter-fullscreen button** (#22) | Half a day: square the corners (`INSTRUMENT_RADIUS`) and take the ring off plasma — it is one 40-line file with no state. |
| **The two HUD text tones** (#9, #10, #11, #14, #15) | Half a day, and **the least visible thing in this document**: `TEXT_MUTED` is 5 units of blue off `BONE.lo` and `TEXT_PRIMARY` sits between `BONE.mid` and white. Nobody will see the change; the reason to do it is that it deletes the last hand-picked hex from the HUD, which is what stops the next drift. Do not spend the developer's attention on this ahead of the touch controls. |
| **The four touch controls** (#1–#4) | **One to two days for one Platform-lane agent, and this is the fix the developer actually asked for.** It is one file (`touch-visuals.ts`, 461 lines, all geometry drawn once in the constructor), it has a pure decision layer already unit-tested, and it needs a Bone vocabulary for *rings and knobs* — which does not exist yet, because `instrument.ts` has tick/rule/scrim/track and no round primitive. Budget the vocabulary, not the recolour. |
| **The build wheel's selection state** (#5) | About a day: one field on the model, one highlight arc, a brightness+size step on the selected wedge, a `pointermove` route, and the detent cue wired to boundary crossings. It also buys back a mechanic the design specified and the game currently has no equivalent of on desktop. |
| **The wheel's caption band** (`selDesc`) | Not an estimate — a ruling. Five sentences of copy that do not exist, on a wheel GDD §2.5 deliberately keeps free of effect text. |
| **The wave clock's five progress bars** (#10) | Half a day of drawing, but it changes what the HUD *says*, not how it looks, so it is a design decision rather than a theme one. |

Nothing above spends signal yellow, threat red, or a player identity colour. The in-match
palette's meanings are untouched by every item on this list — and the touch-control item
*returns* plasma to meaning energy, which is the handoff's own stated reason for Bone
existing (`gantry-bone-handoff.md:21`: "It spends no colour on the menu, which leaves
the palette's hues free to mean things during a match").

---

## 5. Where the edge of the handoff actually falls

Nobody had written this down, so here it is in three lines.

1. **The five named screens** — title, build wheel, lobby, ship select, settings —
   are the ratified scope, and all five have shipped in the material.
2. **The match HUD was outside it, and was extended into anyway**, correctly: u7-07
   wrote `src/ui/instrument.ts`, whose whole thesis is that the direction cannot be
   copied onto glass and must be *translated* — plates → nothing, cast shadow →
   scrim, beam → edge rule, rivets → nothing, tracking scale → kept verbatim. That
   translation is the reason the HUD is 11-of-19 compliant rather than 0 —
   counting the 19 non-thumb surfaces in the table above.
3. **The touch controls were outside it and were never revisited.** They are the only
   surface in the game with no relationship to the direction at all — not translated,
   not deferred, just never assigned.

One thing the Director's framing understates, and it helps rather than hurts: **the
handoff's build-wheel screen *is* an in-match screen.** Screen 5a draws the wheel over a
live match, and to do so it draws a whole HUD — a `HOLD` eyebrow over five ore pips, a
`SPENDABLE` total, `WAVE 1 / 5 · OUTER DRIFT` over five progress bars, a `NEXT WAVE`
clock, and four 22 px corner brackets (`5a:19-47`). So the design **does** show what
in-match Gantry/Bone looks like — once. Where the shipped HUD differs from it, it
differs on later developer rulings, not by neglect: the hold pips moved from the corner
to under the ship on a quoted rule (`src/ui/ore-hold.ts:4`, logged as ratified in
`docs/gdd-conformance.md:414`), and the top-right carries station HP because GDD §2.2
puts it there. The one difference with no ruling behind it is the page margin: the
design's in-match row sits at 44 px from the edge (`5a:25`) and its corner brackets at
36 px; our HUD sits at `HUD_PAD = 16` (`src/ui/hud-geometry.ts:177`).

---

## 6. Traps, for whoever is told to implement any of this

The brief asks for costs, not plans, so this is not a plan — it is the four things
that will bite an agent who skims. Each cost me a read to find.

1. **There is no round primitive in the Bone vocabulary.** `src/ui/instrument.ts`
   gives you a tick, a rule, a scrim, a track and a `gantryPoly` — all rectilinear.
   The touch controls are *rings and knobs*, and the direction has never been stated
   on a circle except inside `drawRings` (`src/ui/build-wheel-view.ts:817-878`), where
   it lives as private drawing code rather than as a shared primitive. Budget the
   vocabulary before the recolour; whoever writes it should lift the wheel's lit-top /
   shadowed-bottom rim arcs into `instrument.ts` rather than copying them a third time.
2. **`touch-visuals.ts` draws every affordance once, in the constructor** (`:285-363`),
   and the per-frame path only moves and toggles them (GDD §4.3, zero per-frame
   allocation). A state that needs a *redraw* — a Bone brightness step on press, say —
   breaks that contract unless it is expressed as an `alpha`/`scale` change, which is
   how the existing pressed FIRE state does it (`:414-417`). Do not reach for
   `clear()` in `update()`.
3. **`buildButtonRect` is a layout contract, not a drawing detail**
   (`src/platform/touch-visuals.ts:217-229`). The BUILD button's glow haloes were
   deliberately drawn *outside* the rim without growing the hit rect. A re-skin that
   changes `R_BUILD` moves a rect QA's placement suite asserts against.
4. **The build wheel's selection state has to arrive on the MODEL, not in the view.**
   Every decision on this wheel is made in the pure, headless-tested sibling
   (`src/ui/build-wheel.ts`) and the view only paints — that split is why the wheel's
   copy can be held to a fit budget at every profile without a canvas
   (`src/ui/hud-geometry.test.ts`). A `selected` flag stashed in `BuildWheelView` would
   be the one piece of wheel state no test can reach, and the open/close latch bug the
   view's own header describes (`src/ui/build-wheel-view.ts:19-25`) is what that looks
   like when it goes wrong.

---

## 7. What else the audit turned up

Two things found while reading, neither in the brief's scope, both cheap to note now
and expensive to find later:

- **The two wheels still speak different grammars across one press.** The build wheel
  prints `12`; the upgrade wheel behind its `UPGRADE SHIP ▸` prints `12/8`
  (`src/ui/upgrade-wheel.ts:329` `costLabelOf`, drawn `src/ui/wheel-stack.ts:203-214`).
  GDD §2.5 flags this itself — "⚠ **OPEN**, flagged 2026-08-07 by a0-03 and not
  resolved by it … **The developer's call**" — and it is still open. It is not a theme
  defect, but it is the same wheel the developer is asking about, one press deeper.
- **The ping badge paints a "fair" latency in signal yellow** (`src/net/ping-badge.ts:64`).
  Style-guide §2 reserves that hue for ore and danger, and a traffic-light readout is
  neither. `compliance.test.ts` cannot catch it because it is a UI view, not a sprite.
  Flagging, not deciding — a three-grade readout may be exactly what a warm hue is for.

---

## QUESTIONS FOR THE DEVELOPER

**Q1 — Do the touch controls get the theme, and does that mean giving up plasma on
them?** This is the developer's own observation and the largest single gap in the game.
The change would take the twin sticks, the FIRE button and the BUILD button off plasma
and onto the Bone brightness ramp. **The argument for:** plasma has an in-match
*meaning* — energy, shields, the mining torch, weapon fire — and the thumb furniture is
currently wearing it, so the player's own controls are the same blue as an enemy's
shield. **The argument against:** plasma is how "this is interactive" reads on the glass
today, and Bone's answer ("the brightest thing is the actionable thing") is easier to
state on a menu full of plates than on four translucent rings over a fight. A ruling
either way unblocks a one-to-two-day Platform-lane brief; without one, nothing should
move, because this is a look decision and not an implementation one.

**Q2 — Does the build wheel get its selection state back?** The design specifies a
highlighted wedge, a 140 ms sweep between wedges, a brighter and larger name on the
selected one, and a detent note as the thumb crosses a boundary. We ship none of it,
and on desktop the wheel has no hover at all. This is the concrete answer to *"is the
build wheel FULLY theme compliant like how the design for it was made"* — it is not,
and this is the part that is missing. About a day, and it adds a real affordance rather
than only a look.

**Q3 — Does the wheel get the design's caption band (`{{selDesc}}`)?** Screen 5a puts a
sentence under the wheel explaining the selected wedge ("Absorbs incoming fire until it
breaks"). GDD §2.5 says the opposite — "no rates, no HP-per-ore, no effect text … the
wheel says what a thing costs and what it acts on; the game teaches what it's worth."
Both are ratified and they disagree. Only the developer can settle which one the wheel
obeys, and until then no agent should add the copy.

**Q4 — Does the upgrade wheel drop its `cost/held` denominator?** Not raised by this
brief, but GDD §2.5 has been carrying it as ⚠ OPEN since 2026-08-07 and it is the same
control one press deeper. A yes is a one-line change in `costLabelOf`.

**One correction to the brief, on the record.** The brief asks me to surface the
handoff's first "decision I need from you" — ship stats on ship-select as coarse pips —
as never answered. **It was answered, on 2026-08-05, and it shipped.** The developer's
words were *"both pips and numbers"*, which overrode the design's proposal (the handoff
offered pips *rather than* numbers); it is folded into GDD §2.5 under "Where ship stats
appear — two screens now, not one", and the shipped tile draws both from the sim's own
class table (`src/ui/class-tile-view.ts:5, 213-251`; `src/ui/ship-select.ts:7`). There
is nothing outstanding there. The handoff's *second* question — the industrial voice —
was likewise answered and shipped (`docs/copy-sweep-industrial-voice.md`). **Both of
the handoff's two decisions are closed.** The open questions are Q1–Q4 above.
