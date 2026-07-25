# Cold Vacuum — Gap Analysis (art campaign sequencing)

**Author:** Art & Audio Agent · brief `a2-01-art-direction-lock`
**Contract:** [`style-guide.md`](../../style-guide.md) · **Tokens:** [`src/art/tokens.ts`](../../src/art/tokens.ts)
**Reference surface:** [`assets/preview/sprite-sheet.svg`](../../assets/preview/sprite-sheet.svg) (the committed contact sheet — current output) vs. the concept boards in this directory (the target).

This document compares what the generators in `src/art/` **currently** draw against the
frozen Cold Vacuum boards, family by family, and ranks the fixes by **visual impact per
unit of effort**. That ranking sequences the rest of the campaign (`a2-02..07`). It also
records the three places the boards and the ratified contract disagree — those are
**resolved, not gaps**, and must not be "fixed" back toward the board.

> **Note on `backlog/`.** The `a2-01` brief refers to briefs `a2-02..07` living in
> `backlog/`, but that directory does not exist in the repo at the time of writing. The
> sequence below is therefore **proposed** from the evidence, not reconciled against
> written briefs. Where I'd expect a reorder relative to a naïve family-by-family plan,
> §4 says so and why. When the backlog briefs land, check them against §3–§4.

---

## 1. The state of the set, in one line

The d5 procedural pass was disciplined: silhouettes are right, the palette is honest, the
RESERVED rule holds, and several families (**ships, wrecks, ore, VFX tint policy**) are
already contract-faithful. The distance to the boards is **not** in the shapes — it is in
**value and ink**: the current output reads a step too *pale and soft*. Two levers close
most of that distance, and they are the two cheapest changes in the whole campaign.

---

## 2. The two cross-cutting levers (do these first)

### Lever A — one crisp ink outline (`#262C34`), everywhere

Every board draws every entity inside a single dark ink line — `#262C34` at ~2.5px at
board scale (`tokens.ts` → `MATERIALS.steel` ink, `LINE.sprite`). The generators instead
stroke each family in a *different, lighter* derived ink at a *thinner* weight:

| Family | Current outline | Board target |
|---|---|---|
| Ships / turrets | `DERIVED.hullDark` `#383E45` @ 0.03–0.04u | `#262C34` @ `LINE.sprite` |
| Number decal | `DERIVED.decalInk` `#262A31` | `#262C34` |
| Asteroids / wrecks | `DERIVED.rockFissure` `#2D3239` @ 0.035–0.05u | `#262C34` @ `LINE.rock` |

No generator paints `#262C34` today. Unifying on one ink token, one weight scale, sharpens
**every sprite at once** — it is the single highest impact-per-effort change on the board.
Cost: introduce `#262C34` as a sanctioned shade (it is a near-exact vacuum-shade of
`hullSteel`, so it stays inside "no seventh hue"), point every generator's rim stroke at
it, and adopt `LINE`. **This re-baselines all goldens** — justified: it is the point.

### Lever B — darken the value floor (rock, ocean, plating)

The boards sit darker than the ramp currently resolves. Three shades carry it:

| Shade | Current | Board | Where it shows |
|---|---|---|---|
| Asteroid body | `DERIVED.rockBody` `#939BA5` (a *light* tint) | `#454E59` (dark charcoal) | Every rock, the whole match |
| Ocean | `DERIVED.oceanSteel` `#4F565F` (grey) | `#2E6E9E`* (steel-blue) | Every home world |
| Lit hull plating | `DERIVED.hullLight` `#A5ACB4` | `#8F99A6` | Every ship / turret |

Each is a **value** move on a colour already in the palette (`rockBody` flips from a
white-tint to a vacuum-shade; `hullLight` pulls down one stop), so each is a one-line
recipe edit that stays inside the contract. *(\*Ocean has a caveat — see §5.)*

---

## 3. Screen-by-screen gaps, ranked

Rank = visual impact per effort. Severity: ▲▲▲ high · ▲▲ medium · ▲ low. Effort likewise.

| # | Family (`file`) | Current output | Board target | Sev | Eff |
|---|---|---|---|---|---|
| 1 | **Ink & line** (all generators) | Per-family light inks, thin | One `#262C34` ink, `LINE` scale | ▲▲▲ | ▲ |
| 2 | **Asteroids** (`asteroids.ts`) | Body `#939BA5` *light*; thin rim; veins already pop | Dark `#454E59` body, bold rim, yellow veins reading from range | ▲▲▲ | ▲ |
| 3 | **Planets** (`planets.ts`) | Grey ocean; patina continents good; core lacks the board's ink ring | Bluer steel ocean, ink-ringed yellow core, crisper limb | ▲▲ | ▲▲ |
| 4 | **Ships** (`ships.ts`) | 4 correct, distinctness-tested silhouettes; trim correct; pale plating + soft ink | Same shapes, board plating `#8F99A6` + crisp ink; trim per livery sheet | ▲▲ | ▲▲ |
| 5 | **Turrets** (`buildings.ts`) | Already reads as a cannon (drum + long barrel + muzzle) | Tighten muzzle-brake/breech proportions; adopt ink | ▲ | ▲▲ |
| 6 | **VFX** (`vfx/`) | 11 pooled looks, on-palette, correct tint policy; flat/modest | Brighter, *generous* "fireworks" (GDD §3.6, tone §8) — an effects pass, not a recolor | ▲▲ | ▲▲▲ |
| 7 | **Shields** (`buildings.ts`) | Plasma bubble (≈ board option **W2**) | **Undecided** — W1 hazard-ring vs W2 plasma-plates | ▲▲ | — |
| 8 | **Wrecks** (`wrecks.ts`) | Cold ash body, dead core, ore-only debris — lands the ache | Already on-target | ▲ | ▲ |

**Shields are blocked, not ranked.** `ui-mockup.html`'s footer leaves the shield style open
("W1 hazard ring — shown — vs W2 plasma plates"). The generator shipped W2; the mockup HUD
shows W1. This is a **Director/design decision**, not an art gap — flagged here so no form
brief silently picks one. **BLOCKED on the shield pick before any shield form work.**

---

## 4. Proposed campaign sequence (`a2-02..07`) + reorder flags

Ordered so the cheapest, broadest wins land first and net-new work trails:

1. **`a2-02` — Ink & line language** *(Lever A).* Introduce `#262C34`, adopt `LINE`
   across every generator; re-baseline goldens. Touches all families; unblocks the rest.
2. **`a2-03` — Asteroids & ore** *(Lever B, rock).* Dark body, bold rim, payout-at-range
   vein read. Highest single-family visibility (the economy object).
3. **`a2-04` — Planets & wrecks.** Steel-blue ocean (within-ramp, see §5), ink-ringed core,
   limb contrast; wrecks a light confirming pass (already close).
4. **`a2-05` — Ships & turrets.** Board plating value, livery-accurate trim, cannon
   proportion polish. Shapes are already right, so this is finish, not redraw.
5. **`a2-06` — VFX set (GDD §3.6).** The "explosions are fireworks" pass — brightness,
   generosity, the planet-death quiet. Largest effort; benefits from the ink/value floor
   being settled first so particles read against finished sprites.
6. **`a2-07` — UI type & HUD.** Adopt `TYPE` (Audiowide display + Oxanium HUD), the HUD
   composition from `ui-mockup.html`. Independent of the sprite work, so it can run in
   parallel with any of the above.

**Reorder flags** (vs. a naïve "one brief per family in catalogue order"):

- **Ink/line must go first, not with ships.** It is a prerequisite lift for every family;
  sequencing it inside the ships brief would leave asteroids/planets/wrecks soft for the
  whole campaign. Pulled to `a2-02`.
- **VFX must trail, not lead.** It is net-new tuning (GDD §3.6), the highest effort, and it
  reads *against* the other sprites — do it once they're finished, or redo it.
- **Shields drop out of the sequence entirely** until the W1/W2 pick is made (§3). If a
  backlog brief schedules shield form work before that decision, it should block.
- **UI (`a2-07`) is order-independent** — it consumes `TYPE`/`tokens.ts` and touches no
  sprite generator, so it can float earlier if a UI milestone needs it.

---

## 5. Divergences that are *resolved*, not gaps

Three places the boards differ from the ratified contract. In all three the **contract
wins**; `tokens.ts` already encodes the resolution. Do **not** "fix" these toward the board.

1. **Player roster.** The early boards drew slots in cyan `#4DC3FF` (= plasma), red
   `#E24A3B` (≈ danger) and gold `#FFC93E` (≈ ore) — hues that collide with reserved
   material colours. `style-guide.md` §3.1 replaced them with a collision-free 8-slot
   roster; `tokens.ts` `PLAYER_ROSTER` and `palette.ts` `PLAYER_COLORS` already carry it.
   The board roster is **superseded**.
2. **Ocean hue.** The boards paint oceans a saturated `#2E6E9E`, which would import a
   seventh hue against §1. The frozen rule pulls oceans to a **steel-blue shade within the
   ramp**. `a2-04` may bias `oceanSteel` bluer *within a vacuum-shade of `hullSteel`*, but
   adopting `#2E6E9E` literally needs the Director (a new hue). Current `#4F565F` is *too*
   grey; the fix is "bluer, still in-ramp," not "the board hex."
3. **HUD font.** `ui-mockup.html` set the whole HUD in Audiowide as an experiment; §7
   splits the faces — Audiowide for the wordmark/headings, **Oxanium** for HUD numerals
   (it holds at 12px). `tokens.ts` `TYPE` encodes the split. `a2-07` follows §7, not the
   mockup.

---

## 6. What `a2-01` already shipped

- **`src/art/tokens.ts`** — the single source: palette, material vocabulary
  (steel/ice/ember/void), line weights, glow language, silhouette rules, UI type scale,
  frozen roster. Every `a2` brief imports from here.
- **`src/art/palette.ts`** sources the six + roster from `tokens.ts` (mechanical; no colour
  shifted, goldens unchanged).
- **`src/art/compliance.test.ts`** now proves `tokens.ts` is the single source and that
  colours outside it fail.

The campaign's job from here is to close §2–§3 without ever breaking §5.
