/**
 * src/art/backdrop.ts — the void, v4: the space the design actually drew.
 * OWNER: Art Agent.
 *
 * **a0-40 — the numbers come from `./mockup-reference` now, and nothing here may
 * tune them.** Six reports on one subject, the last of them with the design and
 * the game rendered side by side: *"the mockup still looks a million times
 * better"*. The first five were treated as rendering bugs. None was. The renderer
 * was always fine — handed the design's numbers it reproduces the design exactly
 * (`sky-preview.ts`, the `ported` column) — and what had happened instead is that
 * **the parameters drifted away from the design and no gate ever compared the two.**
 * Every ceiling CI could see (`peakLuma`, `overdraw`, `SKY_ALPHA_MAX`) rewards a
 * darker sky, so five briefs optimised toward them and nothing pulled back.
 *
 * So the direction of authority is inverted here. `./mockup-reference` holds the
 * design as data; this file *consumes* it; `./compliance`'s ceilings are
 * re-derived **from** the ported art rather than the art being trimmed to fit
 * them; and `backdrop.test.ts` asserts every built sky against
 * `MOCKUP_REFERENCE`, so the drift that caused six reports fails CI the next time
 * it starts.
 *
 * What that changed, concretely — the three divergences, which compounded:
 *
 * ```
 *                    design    game before a0-40
 *   ground luma        9.1          1.9        FLOOR #010204 → #070910
 *   star p99           46–53        7–9        35 stars a screenful → 560
 *   nebula lift        3.8–10.0     0.02–0.92  every sky's count/radius/alpha
 * ```
 *
 * Iron Veil is the control: the one sky whose numbers never drifted, and the one
 * sky the developer has never complained about. It is unchanged here except for
 * the ground under it and the stars over it.
 *
 * **r9-01 — a sky may thin, and it may never leave.** Nothing about what any sky
 * *is* changed here either; what changed is what the auto-reducer is allowed to
 * do to one. Measured on the served build `dd1d3f5`, two live boots side by side
 * for 40 s: The Oval booted **with** `void-nebula-plasmaReef` on the stage, held
 * it for three polls, and at **t+8.3 s the layer was gone** — while Line, the
 * control on the same box under the same load, kept `void-nebula-deepEmber` for
 * the full 40 s. The reef was the only coloured sky declaring
 * {@link NebulaSpec.reducedDensity} `0`, and `0` meant *delete the layer*, so a
 * whole sky popped out of the frame in one frame on a machine that was merely
 * warm. Two rules now stand between the reducer and that:
 *
 *  1. **A floor** — {@link SKY_REDUCED_FLOOR}. A throttled sky is a *thinner*
 *     sky, never an absent one; the reducer may take at most three quarters of
 *     one. Plasma Reef declares `0.45` on measured grounds (see it), and layer
 *     *presence* is no longer a function of the VFX tier at all.
 *  2. **The tier is read once, at build** — {@link VoidBackdrop.configure} pins
 *     the density the first time a sky goes on the stage and holds it until the
 *     sky itself changes. A device that boots throttled gets the thin sky for the
 *     whole match; a device that throttles at t+8 s keeps the sky it started
 *     with. Either way the transition never happens in front of the player.
 *
 * That second rule is Coalsack's own argument, generalised: *"shedding it
 * mid-match would make a wall of stars appear at once"* is a hazard about
 * **mid-match**, not about dust, and it was already written on this file before
 * the reef went missing.
 *
 * **a0-07b — how the sky MOVES.** One number changed since the ratification
 * below, and nothing about what the sky *is*: the distant skies drift at
 * {@link SKY_PARALLAX} `0.085` instead of `0.05`, so they travel with the far
 * star-field instead of falling half a screen-width behind it and reading as
 * stuck to the glass. The reasoning, the measurements and the rejected
 * alternatives are on that constant. Ground, bloom rule, bloom intensity, the
 * six skies and {@link MAP_NEBULA} are untouched.
 *
 * v2 (a2-06) gave the void a body — a layered parallax star-field over a single
 * patina/steel wash. **a0-07 replaces the ground under it and turns the wash
 * into map identity.** Both halves are ratifications off the developer's
 * backdrop compositor (2026-08-07), not explorations:
 *
 * > *"i like floor, (nebula i like all of them including none) i think each map
 * > should get one of these … (seeded scatter), and subtle…"*
 *
 * | axis | picked |
 * |---|---|
 * | Ground | **Floor `#010204`** — replaces Vacuum as the *backdrop* (`./tokens` `FLOOR`) |
 * | Bloom rule | **seeded scatter** — which stars bloom is a pure function of the seed, at any magnitude |
 * | Bloom intensity | **subtle** — the lowest of the three shown ({@link BLOOM}) |
 * | Nebula | **all six, one per map** — including NONE ({@link MAP_NEBULA}) |
 *
 * ## The sky is part of a map's identity, and it is a registry
 *
 * {@link MAP_NEBULA} names one sky per map, by hand. Not a hash of the map id,
 * not `index % 6`: a modulo would silently repeat the day a fifth map lands and
 * would give two maps the same sky without anyone deciding it. Four of the six
 * are assigned here; `a0-12` is building the two maps the other two belong to,
 * and {@link UNASSIGNED_NEBULAE} names them so the hole in the registry is a
 * *stated* hole a test asserts rather than a gap someone fills by guessing.
 *
 * ## What a darker ground does and does not change
 *
 * It does **not** hurt rock legibility, and that was measured rather than
 * argued: a darker ground raises contrast for anything lighter than it, and on
 * this palette that is everything. `rockBody #484E57` reads 2.27:1 on Vacuum and
 * **2.47:1 on Floor** — 8.9% more. No rim light or contrast floor was added,
 * because there is no problem to compensate for (style-guide §1.1).
 *
 * What it does not help with is **additive light in the same hue as a
 * load-bearing colour**, which is independent of how dark the ground is. The
 * owner beacon ring is plasma `#4DC3FF` and Plasma Reef is a cyan additive sky —
 * that collision is the one real check, and `backdrop.test.ts` measures it two
 * ways, because brightness and hue are different questions:
 *
 *  - **contrast** — the ring reads **9.4:1** over the reef's brightest clot,
 *    against 10.4:1 over bare Floor. The sky costs it 9.7% of its contrast.
 *  - **colour** — CIE76 **ΔE 78** between the ring and that same clot, against a
 *    40 floor. Cyan light on a cyan sky is still unmistakably two colours.
 *
 * The first build of the reef failed the first of those at **69%** and is why
 * {@link ADDITIVE_STOPS} exists. If a sky ever fails again, the fix is the
 * *assignment* — give that map a different sky — never the palette and never the
 * ground.
 *
 * ## The palette, including the two warm skies
 *
 * No seventh hue. Stars are the steel value ramp; the skies are patina, plasma,
 * steel, Floor itself — and, for Iron Veil and Deep Ember, threat red at a
 * whisper the audit enforces numerically (style-guide §2.2 / `./compliance`
 * `SKY_RESERVED_ALPHA_MAX`). Signal yellow never appears on the sky at any
 * alpha. Every sky ink is painted on the `sky` role, which no entity may wear.
 *
 * ## It respects the frame budget (GDD §4.3, risk 5)
 *
 * Same discipline as v2, and it has to be stricter because a nebula is a
 * per-frame fill-rate layer on a mobile GPU. Geometry is played into a **static
 * `Graphics` once per layer** at {@link VoidBackdrop.configure}; per frame the
 * only thing touched is each layer's `position`. A sky is authored **per
 * screenful**, not per arena: feature size comes from the viewport and element
 * count from field-area ÷ screen-area, so the developer's own numbers (14
 * sheets, 22 blobs) are what a *phone* sees, and {@link NebulaSpec.overdraw} is
 * a genuine per-frame constant a test can pin on any map. Each sky declares its
 * own {@link NebulaSpec.reducedDensity}: what `VfxAutoQuality` leaves of it when
 * the auto-reducer throttles a device — never nothing (r9-01).
 *
 * Sizing to the *field* instead was the first build's mistake and it is worth
 * remembering: on a wide arena the parallax field is ~2.2 screens across, so
 * Plasma Reef's nine clots spread over five screenfuls and the evidence frame
 * came back **with no reef in it**.
 */

import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '@shared/types';
import { FLOOR, PALETTE } from './palette';
import {
  MOCKUP_REFERENCE,
  MOCKUP_STARS,
  MOCKUP_STAR_DENSITY,
  mockupBlobs,
  starAlpha,
  starBlooms,
  starMagnitude,
  starRadius,
  type MockupSkyId,
  type SkyReference,
} from './mockup-reference';
import {
  circle,
  ellipsePoints,
  fill,
  poly,
  polyline,
  round,
  softFill,
  sprite,
  stroke,
  type Shape,
  type SpriteDef,
} from './shapes';
import { drawSprite } from './textures';

// ---------------------------------------------------------------------------
// Look constants — the whole void, in one place
// ---------------------------------------------------------------------------

/** A stable seed for the void. The field is procedural but the *same* every
 *  boot (GDD §4.1), so the frozen golden scene is byte-deterministic. */
export const VOID_SEED = 0x5061_6365; // 'Pace' — a wink, and a fixed 32-bit seed.

/**
 * **The ground.** Every layer below is composited over this, and it is drawn as
 * a real opaque quad rather than left to the canvas clear colour — the backdrop
 * owns its own ground, so the void looks the same whatever is behind it.
 *
 * `./tokens` `FLOOR`, which a0-40 moved from `#010204` to the design's own
 * `#070910` ({@link MOCKUP_GROUND}) — the first and largest of the three
 * divergences, since everything above it composites over it.
 */
export const GROUND_COLOR = FLOOR;

/** The ground's luma Y′, 0..255 — **9.1**. The floor of every `peakLuma` in the
 *  table below, and the baseline `sky-preview.ts` measures every sky's lift
 *  above. Stated once, so no sky's declaration quietly disagrees with the ground
 *  it sits on (which is exactly how Coalsack came to declare 1.9 forever). */
export const GROUND_LUMA =
  Math.round(
    (0.2126 * ((GROUND_COLOR >> 16) & 0xff) +
      0.7152 * ((GROUND_COLOR >> 8) & 0xff) +
      0.0722 * (GROUND_COLOR & 0xff)) *
      10,
  ) / 10;

/**
 * A star colour: one of the steel-ramp values, climbing by *value* and not by
 * hue — and, since a0-22, an optional colour for the light that *scatters off*
 * it.
 *
 * **a0-40 replaced `alpha` with {@link minMagnitude}.** An ink used to declare
 * how bright its stars were, and inks were sampled uniformly, so a layer's
 * brightness distribution was a three-value histogram. The design draws one
 * continuous **magnitude curve** ({@link MOCKUP_STARS}) and lets the value ramp
 * *follow* it: a faint star is dim steel, a bright one is white, and the ink is
 * chosen by the magnitude rather than the other way round. That is what makes a
 * field instead of three tiers, and the three-tier version is what the developer
 * described as *"all 1 color"*.
 */
interface StarInk {
  /** The star's own point. Always a steel-ramp value (style-guide §1). */
  readonly color: number;
  /**
   * The bottom of the magnitude band this ink paints, 0..1. The inks of a layer
   * are listed in ascending order and the last one at or below a star's
   * magnitude wins, so the ramp climbs with the curve.
   */
  readonly minMagnitude: number;
  /**
   * **The colour of this star's bloom, when it is not the star's own** — one of
   * {@link BLOOM_TINTS}, or absent for a halo that stays on the value ramp.
   *
   * See {@link BLOOM_TINTS} for why this field exists and what bounds it. Two
   * things are worth having in front of you at the point of use:
   *
   *  - it never touches {@link color}, so the star's *point* is on the steel ramp
   *    whatever its halo does;
   *  - it may only name a hue that leaves this halo dimmer than the brightest
   *    halo the field already draws, and short of the ink outline every sprite in
   *    the game is drawn with (`backdrop.test.ts` asserts both, per ink).
   */
  readonly halo?: number;
}

/** One depth layer of the star-field. */
export interface StarLayerSpec {
  /** Stable id — part of the sprite name (texture/pool key) and the layer seed. */
  readonly key: string;
  /** Parallax factor: 0 = fixed to the screen (infinitely far), 1 = locked to
   *  the world (moves with the fleet). Far layers are small, near layers large. */
  readonly parallax: number;
  /**
   * This layer's share of the field, 0..1. The three sum to 1, and the total is
   * {@link MOCKUP_STAR_DENSITY} — **the design's 560 stars a screenful**, against
   * the 35 that shipped. The split is the shipped one (0.61 / 0.30 / 0.09,
   * from the old 92 : 46 : 13), because how the field is *layered* is a parallax
   * decision (a0-07b) and this brief is about how much of it there is.
   */
  readonly share: number;
  /** Stars per 1e6 px² of covered area — {@link share} of the design's total. */
  readonly density: number;
  /** The value ramp this layer climbs, in ascending magnitude order. */
  readonly inks: readonly StarInk[];
}

/**
 * The ink a star of this magnitude is painted in: the last band it clears.
 *
 * **The layers do not scale a star's size, and that is deliberate.** A per-layer
 * size multiplier is the obvious way to sell depth, and it is what a0-40 removed:
 * the design has *one* magnitude curve, so a multiplier on top of it is a second
 * distribution nobody specified, and it pulled the field's measured p99 away from
 * the design's by more than the ground did. Depth is carried by
 * {@link StarLayerSpec.parallax}, which is what actually reads as depth in
 * motion, and the curve alone already spans 0.4–2.45 px.
 */
export function starInkFor(spec: StarLayerSpec, mag: number): StarInk {
  let chosen = spec.inks[0]!;
  for (const ink of spec.inks) if (mag >= ink.minMagnitude) chosen = ink;
  return chosen;
}

/**
 * **The two hues a bloom may be tinted with** — the whole of a0-22, in one list.
 *
 * The developer, from live play: *"the bloom is still messed up, still doesn't
 * match our mockups and if you notice our mockups had different colored blooms
 * these are all 1 color there are no stars in them…"*. They are right about the
 * colour, and it was not a bug: the rule this block used to open with — *"steel
 * value ramp only: a star is a bright point, so it climbs by alpha/whiteness,
 * never by hue"* — is what removed the colour, and it obeyed style-guide §1 while
 * the compositor page the developer picked from did not. Nobody noticed the two
 * disagreed until the game was in front of them.
 *
 * ## What §1 is actually protecting, which is not the same as what it says
 *
 * The in-match palette carries **meaning**: yellow is ore, red is danger, the
 * roster hues are *who*. The failure the ban prevents is a bloom that reads as
 * one of those — a warm glow in the corner of the eye that a player checks,
 * because on this screen a warm glow has always meant something. That is the
 * line, and it holds independently of anything about "points" or "value ramps".
 *
 * Two of the four colours on the mockup were **ore yellow `#F2D24B` and threat
 * red `#B23A3A`**, and they are exactly the two the line excludes. That is not a
 * judgement made here — it is already a number and already in CI:
 *
 *  - `compliance.ts` fails yellow and red on any role but `ore`/`core`/`danger`,
 *    and the star field is in `ALL_SPRITES`, so a yellow or red halo reddens the
 *    build today. It always would have.
 *  - The §2.2 sky carve-out prices red on the backdrop at **alpha ≤ 0.06**. A
 *    bloom's inner ring runs `0.042`–`0.147` (ink alpha × `BLOOM.intensity[0]`),
 *    so a red bloom is over the carve-out on **every layer**, by 1.0× to 2.5×.
 *    Only the outer ring squeezes under — and an outer ring alone, with a steel
 *    inner ring inside it, is not a red bloom, it is a steel bloom with a rumour.
 *  - Signal yellow gets no carve-out at any alpha, by §2.2 clause 3.
 *
 * So **the two mockup hues this cannot deliver are barred by a rule with a number
 * on it, not by taste**, and moving that number is the Director's call, not
 * Art's. What is left is the other half of the mockup — its cyan `#4DC3FF` and
 * its steel `#7E8894` — and the palette's own cold green.
 *
 * ## The two that are left, and why each is safe
 *
 * | tint | palette job (§1) | why a bloom in it is not a signal |
 * |---|---|---|
 * | **plasma `#4DC3FF`** | beams, cockpits, energy | the mockup's own bloom colour, and the most chromatic thing in the palette (C\* 41.7), which is why it is the one that survives being painted at a bloom's alpha. Its brightest halo composites to Y′ **26.2** over Floor — **14%** of a plasma shot's value (188.9) and 60% of the ink outline every sprite is drawn with (43.4). |
 * | **patina `#4FA08B`** | corrosion, continents, repair | the palette's other cold hue (C\* 30.2), already the whole of Patina Drift's sky. Its brightest halo composites to Y′ **22.4**. |
 *
 * Both are on the **cold** side of the wheel, which is the point: the hue that
 * would be dangerous is a warm one, because warm is where ore and danger live.
 *
 * ## A tint is bought with alpha, and `BLOOM.intensity` is what there is to spend
 *
 * A halo paints at 16% of its star's own alpha, so whatever colour it carries
 * arrives diluted by Floor. That is not a side effect to work around — it is what
 * makes a *tint* out of a *colour*, and it is also a hard ceiling on how much
 * hue a bloom can hold. Measured, per ink, as the composited pixel's Lab chroma
 * C\* (0 = grey; the untinted halos sit at 1.0–2.3) and its luma Y′ over Floor:
 *
 * ```
 *   layer  ink            halo      C*  →   C*      Y′  →  Y′     tax  →  tax
 *   deep   hullSteel .26  —        1.0    1.0      7.5    7.5    3.2%   3.2%
 *   deep   hullSteel .38  —        1.2    1.2     10.0   10.0    4.6%   4.6%
 *   deep   hullLight .30  —        1.1    1.1     10.1   10.1    4.7%   4.7%
 *   mid    hullLight .55  —        1.6    1.6     16.8   16.8    8.9%   8.9%
 *   mid    hullSteel .70  plasma   2.1    8.2     16.8   21.2    8.9%  12.8%
 *   mid    WHITE     .42  —        1.3    1.3     18.9   18.9   10.4%  10.4%
 *   near   WHITE     .88  plasma   1.3    9.7     37.6   26.2   26.7%  17.2%
 *   near   hullLight .92  patina   2.3    5.6     26.8   22.4   16.9%  13.6%
 *   near   WHITE     .64  —        1.4    1.4     27.8   27.8   17.8%  17.8%
 *   ──────────────────────────────────────────────────────────────────────────
 *   brightest halo pixel in the game        Y′ 37.6 → 27.8   (−26%)
 *   worst contrast tax any halo puts on a signal  26.7% → 17.8%
 *   the ink outline every sprite is drawn with    Y′ 43.4  ← nothing reaches it
 * ```
 *
 * (`tax` = the fraction of contrast a bright signal loses to that halo's pixel,
 * signal-independent by construction — the same measure `backdrop.test.ts`
 * applies to every sky.) Two things in that table are the whole safety argument:
 *
 *  1. **The frame gets quieter, not louder.** White is the most luminous thing in
 *     the palette, so the brightest bloom in the game — a white halo at 14% —
 *     *loses* a quarter of its value by becoming cyan. The peak halo pixel falls
 *     from Y′ 37.6 to 27.8 and the worst tax from 26.7% to 17.8%; no halo, tinted
 *     or not, comes near the ink outline. One ink moves the other way (mid's
 *     steel at 0.70, Y′ 16.8 → 21.2, tax 8.9% → 12.8%), and it is stated rather
 *     than buried: it is still below both the shipped peak and half the outline,
 *     and it buys the only cyan a frame reliably contains.
 *  2. **C\* is the honest measure of "coloured", not ΔE.** Every one of these
 *     lands ΔE ≥ 66 from ore, from danger and from all eight roster hues, because
 *     at Y′ 20 everything is far from everything; that number proves nothing. The
 *     chroma column is what a player sees, and its ceiling here is **C\* 10**.
 *
 * ## What does NOT change, and why
 *
 *  - **The star's own point stays on the steel ramp.** §1's sentence is about the
 *    *point* — how a star climbs in brightness — and the point is untouched: only
 *    the scattered light around it takes a hue. That also answers the second half
 *    of the report directly. A white core inside a cyan halo is *more* findable
 *    than a white core inside a white halo, not less.
 *  - **The glint** (the diffraction cross) stays the star's own colour too. It is
 *    the point's own spike, not the scatter.
 *  - **`deep` takes no tint at all, and this was priced rather than assumed.** A
 *    tint on the far layer is the narrowest change available and it is the one
 *    that buys nothing: at deep's halo alphas (0.042–0.061) the most chroma any
 *    tint can reach is **C\* 3.9**, against C\* 8.2–9.7 on the layers that do
 *    carry one — painted across a **6 px** disc sitting **Δ7 of luma** above its
 *    background. It is a change the developer could not see, on the layer where
 *    25 of a frame's 36 blooms happen to live. Keeping deep neutral also keeps
 *    the module header's own line true — *distance steals a star's colour before
 *    its light* — so the tint becomes a nearness cue rather than a repaint.
 *  - **`BLOOM.scatter`, `BLOOM.intensity`, `BLOOM.radii`, every density, every
 *    parallax and every ink alpha.** a0-07 ratified *"seeded scatter, subtle"*
 *    and the developer has not asked for a different set of stars to bloom, only
 *    for a different colour in the ones that do. The consequence is worth naming
 *    for whoever reads this next: **`BLOOM.intensity` is the ceiling on how
 *    coloured a bloom can be**, and at 0.16 that ceiling is C\* 10. If the answer
 *    to this round is "still not colourful enough", the lever is that number and
 *    it is the developer's to move — a0-07 chose the lowest of the three
 *    magnitudes they were shown, and Art does not get to raise it back.
 */
export const BLOOM_TINTS = {
  /** The mockup's own bloom cyan, and the palette's energy hue. */
  plasma: PALETTE.plasma,
  /** The palette's cold green — Patina Drift's hue, at a star's scale. */
  patina: PALETTE.patina,
} as const;

/**
 * Three depth layers, back to front. **A star's point is the steel value ramp
 * only** (style-guide §1): it climbs by alpha/whiteness, never by hue. Its
 * *bloom* may be tinted, from {@link BLOOM_TINTS} and under the bound stated
 * there — one tint per layer, per hue, on the two layers where a bloom is big
 * enough to have a colour at all.
 */
/**
 * The value ramp every layer climbs, from {@link MOCKUP_STARS}`.ramp` — one
 * curve, one ramp, three depths. a0-07 gave each layer its own three-value ink
 * set (and barred white from `deep`, on the reasoning that *distance steals a
 * star's colour before its light*); at 35 stars a screenful that was a density
 * compensation, and at 560 it is a third distribution nobody specified. Depth is
 * carried by {@link StarLayerSpec.parallax}, which is what reads as depth.
 */
const RAMP_INKS: readonly StarInk[] = MOCKUP_STARS.ramp.map((b) => ({
  color: b.color,
  minMagnitude: b.minMagnitude,
}));

/** The ramp with `tint` on its top band — the only band that ever blooms, and so
 *  the only one a halo colour can reach (a0-22, {@link BLOOM_TINTS}). */
function tinted(tint: number): readonly StarInk[] {
  return RAMP_INKS.map((ink, i) => (i === RAMP_INKS.length - 1 ? { ...ink, halo: tint } : ink));
}

export const STAR_LAYERS: readonly StarLayerSpec[] = [
  {
    key: 'deep',
    parallax: 0.1,
    share: 0.61,
    density: round(MOCKUP_STAR_DENSITY * 0.61),
    // Faint far dust: dim steel, climbing to a hair of lit steel at the top of
    // the layer's own range. Never white — distance steals a star's colour before
    // its light. No tint either, and for the same reason measured out: a hue here
    // is worth C* < 5 on a disc a few px across (BLOOM_TINTS).
    inks: RAMP_INKS,
  },
  {
    key: 'mid',
    parallax: 0.26,
    share: 0.3,
    density: round(MOCKUP_STAR_DENSITY * 0.3),
    // The cyan goes on the band that actually blooms, because a tint's chroma is
    // bought with the halo's alpha and only a bloomed star has one. Below it the
    // layer is plain ramp, so mid is a steel field with cyan flares in it rather
    // than a repainted layer.
    inks: tinted(BLOOM_TINTS.plasma),
  },
  {
    key: 'near',
    parallax: 0.5,
    share: 0.09,
    density: round(MOCKUP_STAR_DENSITY * 0.09),
    // The closest, brightest points — the only real orbs in a frame, and the
    // layer where a tint is worth the most per star. It carries the second hue
    // because it is the only one whose halos are big enough for two to be
    // *distinguishable* rather than merely both present.
    inks: tinted(BLOOM_TINTS.patina),
  },
];

/**
 * **How fast a distant sky drifts** — the whole of a0-07b, in one number.
 *
 * The developer, from live play: *"the parallax effect is kind of broken, those
 * bloom as moving with the ship on the front layer, they are supposed to be
 * attached to stars…"*. Nothing was screen-locked in code; the sky sat at
 * **0.05**, half the parallax of the farthest star layer (`deep`, 0.10), and at
 * that rate a discrete clot reads as a foreground overlay riding the ship.
 *
 * The reason half-speed reads as *attached to the camera* rather than as *twice
 * as far away* is grouping, not speed. The eye has no absolute ruler for how
 * fast a backdrop should move — it only has the other things in the frame. A
 * layer that visibly falls behind the star-field it is drawn among is not read
 * as "further than the stars"; it is read as **not part of the stars**, and the
 * only other thing in a cockpit view that a layer can be part of is the glass.
 * The developer's own words name the fix exactly: *attached to stars*.
 *
 * So the sky is moved to sit **just behind the far star layer** — near enough to
 * travel with it, still strictly slower, so the depth order stated in
 * {@link NebulaSpec.parallax} survives:
 *
 * ```
 *   layer          parallax   px/s at top speed   per screen-width flown (844 u)
 *   sky (was)        0.05           13                 42
 *   sky (now)        0.085          22                 72
 *   stars, deep      0.10           26                 84
 *   stars, mid       0.26           68                219
 *   stars, near      0.50          130                422
 *   the world        1.00          260                844
 * ```
 *
 * (Top speed is a stock Vanguard's 260 u/s; the camera is 1:1, so world units
 * per second are screen px per second.) The number that changed the *read* is
 * the last column against the deep stars': the sky used to fall **42 px behind
 * the far field for every screen-width flown — half of it**; it now falls 12 px
 * behind, so it travels with the stars and separates from them slowly, which is
 * what a nebula among those stars does. Over a whole arena crossing the far
 * field still slides past it by a real, measurable amount — 36 px on a square
 * board (2400 u), 47 px on the wide one (3200 u) — so the sky is still the
 * furthest thing in the frame, not a tie.
 *
 * **Why not further, why not nearer.**
 *  - **Nearer than 0.10** inverts the depth order: the sky would out-run the
 *    stars it is behind. 0.10 exactly is no better — it makes the sky and the
 *    far stars one plane, and the ordering above becomes a coincidence rather
 *    than an invariant a test can hold.
 *  - **Back toward 0.05** is the reported bug.
 *  - So the honest statement of the trade is that under the depth-order
 *    constraint the sky's drift is *bounded by the far star layer's*, and 0.085
 *    is 85% of that bound. There is no value that both drifts faster than the
 *    stars and stays behind them; if the void is ever wanted faster wholesale,
 *    the lever is {@link STAR_LAYERS} itself, not this.
 *
 * It costs one thing, and it is a build cost rather than a frame cost: a faster
 * layer must cover more ground, so {@link coverSpan} grows the field by ~22% of
 * its area on a wide arena, and per-screen authoring turns that into ~22% more
 * elements to bake **once**, at {@link VoidBackdrop.configure}. Per-frame fill —
 * {@link NebulaSpec.overdraw}, the number the mobile GPU actually pays — is
 * defined per screenful and does not move at all.
 *
 * Coalsack is deliberately not on this constant: it is dust *in front* of the
 * deep layer (0.14) and already out-runs the stars it eats, which is its look.
 */
export const SKY_PARALLAX = 0.085;

/**
 * **Bloom — the brightest stars, at the design's intensity** (a0-40). Re-exported
 * from {@link MOCKUP_STARS}`.bloom` so there is exactly one copy of it; see there
 * for the rule, its threshold and what it replaces.
 *
 * The rule this supersedes was a0-07's **seeded scatter** — which stars glow
 * drawn from the seed, at any magnitude — and the swap is not cosmetic, so it is
 * worth having the trade in front of whoever reads this next. Scatter makes bloom
 * a property of the *star*, so a faint far point can flare; a threshold makes it
 * a property of the *magnitude*, so the field carries a bright tier. A bright
 * tier is what an **orb** is, and all six reports on this backdrop ask for the
 * orbs back — most explicitly *"bloom orbs gone"* and *"there are no stars in
 * them"*. The developer's ruling on a0-40 is that the game matches the mockup:
 * *"not close enough — the same."* So the threshold ships.
 *
 * Both halves stay seeded and therefore stable across a match and a replay
 * (GDD §4.1): the magnitude is drawn from the layer's seeded stream, so two
 * players see the same sky and the frozen golden scene is byte-deterministic.
 *
 * The halo is **one soft-falloff disc**, not the two flat rings it replaces — a
 * quarter of the geometry, no Mach band at either ring's edge, and a mean of a
 * third of its peak (`./shapes` `falloffProfile`). `intensity` is that peak, as a
 * fraction of the star's own alpha: **0.48** against the shipped 0.16. It is the
 * design's number and it is not Art's to move.
 */
export const BLOOM = MOCKUP_STARS.bloom;

/** The diffraction cross a bloomed star carries — the same population as the
 *  halo, because a spike and a halo are one physical event ({@link MOCKUP_STARS}). */
export const SPIKE = MOCKUP_STARS.spike;

// ---------------------------------------------------------------------------
// The six skies (a0-07) — one per map, including NONE
// ---------------------------------------------------------------------------

/** The six ratified skies, as the developer named them off the compositor. The
 *  five with geometry are `./mockup-reference`'s, so a sky cannot exist here
 *  without a design entry — or exist there without a spec below. */
export type NebulaId = 'none' | MockupSkyId;

/**
 * **The floor under a shed sky (r9-01).** The auto-reducer may take at most
 * three quarters of a sky's elements; what is left is thin, and it is still
 * there. Stated as a rule rather than a taste, because the failure it prevents
 * is categorical: a layer that goes to zero *disappears*, and every value above
 * zero merely *thins*. There is no continuum across that boundary, which is why
 * `0` was never a tuning choice one notch below `0.1` — it was a different
 * behaviour wearing a number's clothes.
 *
 * A quarter is where the arithmetic stops meaning anything on a phone: Patina
 * Drift, the sky with the most parts, is 22 wisps per screenful and 0.25 of it is
 * five — below that a sky rounds toward one or two elements and is a shape, not
 * a field. If a sky is ever genuinely too expensive to keep at a quarter, the
 * honest fix is a cheaper sky on that map, not a vanishing one.
 *
 * This is a **backstop, not the mechanism**: every sky with geometry declares a
 * {@link NebulaSpec.reducedDensity} at or above it on its own measured merits,
 * and `backdrop.test.ts` asserts that, so the clamp should never bite. It exists
 * so that a future `0` — the exact edit that cost The Oval its sky — cannot
 * quietly reintroduce the cliff.
 */
export const SKY_REDUCED_FLOOR = 0.25;

/**
 * The density a sky is built at on a throttled device: its declared
 * {@link NebulaSpec.reducedDensity}, never below {@link SKY_REDUCED_FLOOR}.
 * Always > 0 — a sky's *presence* is not a function of the VFX tier.
 */
export function reducedSkyDensity(spec: NebulaSpec): number {
  return Math.max(spec.reducedDensity, SKY_REDUCED_FLOOR);
}

/**
 * One sky: what it looks like, where it sits in the stack, what it costs, and
 * what the auto-reducer leaves of it. A spec rather than six ad-hoc functions,
 * because the perf story has to be statable per sky (brief) and a table is the
 * only honest way to state it.
 */
export interface NebulaSpec {
  readonly id: NebulaId;
  /** The developer's own name for it. */
  readonly name: string;
  /** One line: what it does to the frame. */
  readonly blurb: string;
  /** Parallax factor — every sky sits further than the farthest stars, except
   *  the one that is *in front* of them (Coalsack), which sits nearer. The
   *  distant skies all take {@link SKY_PARALLAX}; see it for why the value is
   *  where it is (a0-07b). */
  readonly parallax: number;
  /**
   * True for a sky drawn **over** the star layers, so stars go missing behind
   * it. Only Coalsack: it is dust, and dust occludes. Everything else is light
   * and sits behind the field.
   */
  readonly occludes: boolean;
  /** True for an additive layer (`blendMode = 'add'`). The expensive kind. */
  readonly additive: boolean;
  /**
   * Coverage this sky paints, as a multiple of the field it covers — i.e. its
   * **overdraw**, the number the mobile GPU actually pays. Measured off the
   * generated geometry by `backdrop.test.ts`, which fails if a sky drifts more
   * than 15% from the figure declared here, so this table can never quietly rot.
   */
  readonly overdraw: number;
  /**
   * **How bright this sky ever gets**: the luma (Y′, 0..255) of the brightest
   * pixel it can composite over Floor **in a frame a player can actually see** —
   * the desktop control profile over the wide arena — measured by
   * `backdrop.test.ts` and pinned there to within 15%. This is the number
   * "subtle" means, and the ladder it makes is the whole art direction of the set:
   *
   * ```
   *                    shipped   a0-39      both columns measured the SAME way:
   *   None / Coalsack      1.9     1.9      a real 1280×800 frame over the wide
   *   Deep Ember           9.2     7.6      arena, read off the canvas by
   *   Patina Drift        19.1    14.9      evidence/a0-39-…/shoot.mjs
   *   Iron Veil           15.8    14.0
   *   Plasma Reef         17.9    17.0   ← the brightest, as the developer described it
   *   ----------------------------------------------------------------
   *   the ink outline     43.4            ← every sky stays under the line every sprite is drawn with
   *   the rock body       77.5
   * ```
   *
   * The invariant the test enforces is that last gap: **no sky is ever brighter
   * than `rockFissure`, the ink every sprite in the game is outlined in.** A
   * backdrop that out-values the linework is a backdrop competing with the fleet.
   *
   * **Two things about this column changed in a0-39, and they are different
   * kinds of change.**
   *
   * *The instrument changed.* It used to sample **one screenful** of a sky. A
   * peak is an extreme value, and the extreme over nine clots is not the extreme
   * over the sixty a real arena carries, so the old figures under-reported the
   * brightest pixel a player meets — by 22% on Patina Drift and enough on Plasma
   * Reef to hide a **contrast-tax breach that was already shipped**. It now
   * samples the window the camera can actually reach across a crossing
   * (`SKY_FIELD` / `visibleSpan` in the test). Because of that, the numbers here
   * are **not** comparable with the ones a0-07 pinned; the table above therefore
   * quotes the shipped build re-measured the new way, not a0-07's own column.
   *
   * *The drawing changed.* A sky is one gradient shape per element now rather
   * than a stack of four flat ones ({@link Falloff}). Every sky came out a
   * little quieter and **the order is unchanged**, which is the point: this was
   * a fix to the drawing, not a re-art-direction.
   *
   * **Deep Ember moved the most, and it is a rule that moved it, not a taste.**
   * Its bodies declared 0.030–0.045 and, as four-stop stacks, painted
   * **0.068–0.101** — up to 1.7× over `SKY_RESERVED_ALPHA_MAX`, the 0.06 that
   * style-guide §2.2 grants threat red on the backdrop. `compliance.ts` never
   * saw it because it audits one shape at a time and the stack was four; the
   * composite was never in front of it. A single gradient shape paints exactly
   * what it declares, so this sky is now capped at the ceiling and comes back
   * dimmer. Raising 0.06 is the Director's call; a0-39 did not take it.
   */
  readonly peakLuma: number;
  /**
   * What `VfxAutoQuality` leaves of this sky on a throttled device (GDD §4.3
   * risk 5): a multiplier on element count, floored at {@link SKY_REDUCED_FLOOR}
   * so it can **never mean "no layer"** (r9-01). The cheap skies keep their whole
   * selves — thinning an occluding dust lane would make a wall of stars appear,
   * which is a worse artefact than the cost it saves. The additive one thins
   * hardest, because additive overdraw *is* the cost, and it thins to a sky
   * rather than to nothing.
   *
   * It is read **once per sky, at build** ({@link VoidBackdrop.configure}), never
   * re-read while that sky is on the stage — so this number describes the sky a
   * throttled device *boots* into, not something that happens to a player who is
   * already looking at it.
   *
   * `none` declares 0 and means it: it has no geometry either way, and the
   * renderer skips the layer on the id, not on this number.
   */
  readonly reducedDensity: number;
  /**
   * The geometry, authored centred on the origin across a `width`×`height` box.
   *
   * `screen` is the viewport the sky will be *seen* through, and it is what the
   * look is authored against: feature size is a fraction of the screen's short
   * side, and the element count is `count × (field area / screen area)` — so the
   * developer's own numbers ("14 sheets", "22 soft blobs") mean **per screenful**,
   * which is how they were seen on the compositor board.
   *
   * That is not a detail. Sized to the *field* instead, a sky on a wide arena
   * spreads its nine clots over five screens' worth of parallax field and a given
   * frame shows one or none of them — which is exactly what the first build did:
   * the Plasma Reef evidence frame came back with no reef in it. Per-screen
   * sizing also makes {@link overdraw} a genuine per-frame constant instead of a
   * number that quietly falls with arena size.
   *
   * `density` scales element counts (1 = full, 0.5 = half); it never changes
   * feature size, so a reduced sky is the same sky with fewer parts.
   */
  build(
    seed: number,
    width: number,
    height: number,
    density: number,
    screenW: number,
    screenH: number,
  ): Shape[];
}

/**
 * A **soft blob: ONE ellipse, painted through the radial falloff** (a0-39;
 * ./shapes `Falloff`, `falloffProfile`).
 *
 * The path is the falloff's own zero rim, so the disc has no boundary: alpha
 * arrives at zero tangentially exactly where the geometry ends. `peakAlpha` is
 * what the centre paints, and — unlike the four-stop stack this replaced — it is
 * also what the shape *declares*, so `./compliance`'s sky ceilings bound what a
 * player actually sees rather than one quarter of it.
 *
 * Every sky is made of these and of nothing else since a0-40. One primitive is
 * what lets `backdrop.test.ts` compare a built sky element-for-element against
 * {@link MOCKUP_REFERENCE}: a blob is a blob whether it is a Coalsack lobe, an
 * Iron Veil stratum or a Plasma Reef clot, and the difference between the five
 * skies is entirely in the numbers the design states.
 */
function softBlob(
  out: Shape[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  color: number,
  peakAlpha: number,
): void {
  const ax = round(rx);
  const ay = round(ry);
  if (ax <= 0 || ay <= 0 || peakAlpha <= 0) return;
  out.push(
    poly(
      ellipsePoints(cx, cy, ax, ay, angle),
      softFill(color, 'sky', round(peakAlpha), { cx, cy, rx: ax, ry: ay, angle: round(angle) }),
    ),
  );
}

/**
 * **Every sky's geometry, from the design's own numbers.**
 *
 * There is one of these and it serves all five, which is the shape of the fix:
 * a sky is no longer a bespoke `build` with its own literals to drift, it is
 * {@link MOCKUP_REFERENCE}'s entry and nothing else. How many, how big, how
 * opaque, what colour, where — all of it comes from the design, including the
 * per-sky seed salt, and all of it is asserted against the design in CI.
 */
function skyBuild(ref: SkyReference): NebulaSpec['build'] {
  return (seed, width, height, density, screenW, screenH): Shape[] => {
    const out: Shape[] = [];
    for (const b of mockupBlobs(ref, seed, width, height, density, screenW, screenH)) {
      softBlob(out, b.cx, b.cy, b.rx, b.ry, b.angle, b.color, b.alpha);
    }
    return out;
  };
}

// --- NONE ------------------------------------------------------------------

/** **NONE** — "darker, nothing else." A legitimate assignment, not an absence:
 *  on the map every device boots into, the pick *is* the ground. */
const NONE: NebulaSpec = {
  id: 'none',
  name: 'None',
  blurb: 'Floor and the star-field. Nothing else — and it costs nothing else.',
  parallax: SKY_PARALLAX,
  occludes: false,
  additive: false,
  overdraw: 0,
  peakLuma: GROUND_LUMA,
  // The one honest 0 in the table: there is no geometry to thin, and the
  // renderer skips this layer on the id rather than on the density, so it is
  // never a sky that leaves — it is a sky that was never there.
  reducedDensity: 0,
  build: () => [],
};

// --- COALSACK --------------------------------------------------------------

/**
 * **Coalsack** — "dust that occludes: stars go missing behind it, no additive
 * blend." Nine large lobes walking one lane, drawn *over* the star layers, at the
 * highest alpha in the set by a factor of three.
 *
 * **a0-40 gave it a colour, and that is the one thing about this sky the design
 * could not simply be copied for.** It used to paint lobes of {@link
 * GROUND_COLOR} itself — pure occlusion, adding no light, measured lift **0.02**
 * — and a blob the colour of the ground is invisible against the ground by
 * construction, at any parameters. The design's Coalsack lifts **4.55**, so the
 * dust has to be dust: darker than the field it crosses, and not nothing. See
 * `./mockup-reference` for the pair and how it was picked.
 *
 * It still occludes, which is the whole read. At α up to 0.39 over the star
 * layer a star behind the lane's core keeps a fraction of its value and the faint
 * ones go missing entirely — a dark nebula is dark *against the field*, never
 * against the vacuum, and that is now what it draws instead of a hole.
 */
const COALSACK: NebulaSpec = {
  id: 'coalsack',
  name: 'Coalsack',
  blurb: 'A dust lane in front of the field — stars go missing behind it.',
  // Nearer than the deep star layer it eats, so it reads as foreground dust
  // rather than as a hole punched in the far sky. The one sky NOT on
  // SKY_PARALLAX: it already out-runs the stars it takes out of the frame,
  // which is the whole read, so a0-07b left it where it was.
  parallax: 0.14,
  occludes: true,
  additive: false,
  overdraw: 2.263,
  peakLuma: 46.3,
  // **Five lobes of nine, where it used to be kept whole (a0-40).** The reason it
  // was whole is gone twice over: the hazard was a wall of stars appearing
  // *mid-match*, and r9-01 closed that by pinning the density at build; and the
  // claim that it cost nothing to keep was true of a lane painted in the ground
  // colour and is not true of one that lifts 4.55. At 2.263 it is real fill, and
  // a lane of five lobes is still a lane.
  reducedDensity: 0.55,
  build: skyBuild(MOCKUP_REFERENCE.coalsack),
};

// --- IRON VEIL -------------------------------------------------------------

/**
 * **Iron Veil** — "a rust band, 14 sheets." **The control.** Fourteen thin
 * strata stacked along one band, iron-grey with rust through it, so the void
 * looks laminated rather than clouded.
 *
 * It is the one sky whose numbers never drifted — shipped 14 sheets at r 100–177
 * and α .047–.093 against the design's 14 at r 102–166 and α .045–.097 — and it
 * is the one sky the developer has never complained about. That coincidence is
 * the whole argument of a0-40: the renderer drew this one right because this one
 * was still asking it for the right thing. Everything it gains in this brief it
 * gains from the ground beneath it and the stars above it.
 *
 * The rust is threat red under the §2.2 sky carve-out (`./compliance`
 * `SKY_RESERVED_ALPHA_MAX`), which a0-40 re-derived from this sky rather than the
 * other way round.
 */
const IRON_VEIL: NebulaSpec = {
  id: 'ironVeil',
  name: 'Iron Veil',
  blurb: 'Fourteen strata in one band — iron with rust through it.',
  parallax: SKY_PARALLAX,
  occludes: false,
  additive: false,
  overdraw: 2.459,
  peakLuma: 43.9,
  // Half the sheets. A band with 7 sheets is still a band; the read survives.
  reducedDensity: 0.5,
  build: skyBuild(MOCKUP_REFERENCE.ironVeil),
};

// --- PATINA DRIFT ----------------------------------------------------------

/**
 * **Patina Drift** — "wispy teal from the palette's own green, 22 soft blobs."
 * The corroded void, in the one hue §1 already hands to corrosion. The count
 * never drifted; the radii and the alphas did, by about a third and about a half,
 * and the sky measured **0.92** against the design's **6.94**.
 */
const PATINA_DRIFT: NebulaSpec = {
  id: 'patinaDrift',
  name: 'Patina Drift',
  blurb: 'Twenty-two teal wisps on one drift — the corroded void.',
  parallax: SKY_PARALLAX,
  occludes: false,
  additive: false,
  overdraw: 3.174,
  peakLuma: 32.3,
  // Ten of twenty-two. The drift bearing and the hue pair are unchanged, so what
  // is left is the same sky thinned, not a different one.
  reducedDensity: 0.45,
  build: skyBuild(MOCKUP_REFERENCE.patinaDrift),
};

// --- PLASMA REEF -----------------------------------------------------------

/**
 * **Plasma Reef** — "clotted cyan, the brightest and the most expensive." The
 * only additive sky, and the sky a0-40 changes most: **39 shapes back to 9**.
 *
 * What shipped was three broad washes at α 0.0126 with thirty-six little nodes
 * at α 0.039 scattered over them, radii an eighth of the design's. It is a
 * structure that spends its fill on smear and never gets a clot bright enough to
 * see, and it measured lift **0.53** — the second-*darkest* sky in the game
 * wearing the name of the brightest. Nine large clots at 4–9× the alpha is the
 * design, and it measures 9.97.
 *
 * The reef is bright enough to see and nowhere near bright enough to be confused
 * with the thing it shares a hue with. `backdrop.test.ts` pins the owner beacon
 * ring's contrast over the reef's brightest clot; if that number ever fails, the
 * map gets a different sky.
 */
const PLASMA_REEF: NebulaSpec = {
  id: 'plasmaReef',
  name: 'Plasma Reef',
  blurb: 'Nine clots of additive cyan — the brightest sky and the only one that costs real fill.',
  parallax: SKY_PARALLAX,
  occludes: false,
  additive: true,
  overdraw: 2.175,
  peakLuma: 59,
  // **Thinned to a third of its parts, not dropped (r9-01).** The old value was
  // 0 — "a fraction of it saves a fraction of nothing" — and that claim was
  // never measured. It is wrong: 0.45 of the reef is 4 clots of 9, and on the
  // canonical screenful that is most of this sky's fill gone while it is still
  // a reef. Below 0.45 the saving stops arriving and the sky stops being one.
  reducedDensity: 0.45,
  build: skyBuild(MOCKUP_REFERENCE.plasmaReef),
};

// --- DEEP EMBER ------------------------------------------------------------

/**
 * **Deep Ember** — "sparse, low alpha, felt at the edges." The quietest sky, and
 * still four times what shipped: **5 bodies became 22**.
 *
 * Five discs at 5% alpha is not a sparse sky, it is an absent one — measured lift
 * **0.91** against the design's **3.80**. Sparse in the design means *small and
 * many*, not *few and faint*, which is the difference between warmth you catch at
 * the edge of the frame and a sky nobody can see. Threat red under the §2.2
 * carve-out, with ash through it.
 */
const DEEP_EMBER: NebulaSpec = {
  id: 'deepEmber',
  name: 'Deep Ember',
  blurb: 'Twenty-two dying coals — the warmth you notice at the edges of the frame.',
  parallax: SKY_PARALLAX,
  occludes: false,
  additive: false,
  overdraw: 3.033,
  peakLuma: 22.3,
  // **Eleven coals of twenty-two, where five bodies used to be kept whole.** At 22
  // elements it is the joint most expensive sky in the set (3.033) rather than the
  // cheapest coloured one, and half of a sparse sky is a sparse sky.
  reducedDensity: 0.5,
  build: skyBuild(MOCKUP_REFERENCE.deepEmber),
};

/** The six, by id. */
export const NEBULAE: Readonly<Record<NebulaId, NebulaSpec>> = {
  none: NONE,
  coalsack: COALSACK,
  ironVeil: IRON_VEIL,
  patinaDrift: PATINA_DRIFT,
  plasmaReef: PLASMA_REEF,
  deepEmber: DEEP_EMBER,
};

/** The six, in the order the developer listed them. */
export const NEBULA_IDS: readonly NebulaId[] = [
  'none',
  'coalsack',
  'ironVeil',
  'patinaDrift',
  'plasmaReef',
  'deepEmber',
];

// ---------------------------------------------------------------------------
// MAP_NEBULA — a map's sky is part of its identity
// ---------------------------------------------------------------------------

/**
 * The ratified map ids (`src/sim/maps.ts` `MAPS`), as art sees them. Stated as a
 * literal union so {@link MAP_NEBULA} cannot compile with a map missing, and
 * cross-checked against the sim's own registry by `backdrop.test.ts` — art does
 * not import the sim at runtime, but the test refuses to let the two drift.
 */
export type MapId = 'octagon' | 'compass' | 'oval' | 'diamond' | 'line' | 'crescents';

/**
 * **One entry per map. A map's sky is part of its identity, like its layout.**
 *
 * A named registry, deliberately — not a hash of the id and not `index % 6`. A
 * modulo would repeat a sky the moment a fifth map lands and would assign it
 * without anyone choosing; this way each line is a decision that can be argued
 * with. The six skies, ranked by measured per-screen overdraw, are NONE `0.000`
 * · Iron Veil `0.249` · Coalsack `0.399` · Deep Ember `0.416` · Patina Drift
 * `0.555` · Plasma Reef `0.627`, and the rule that placed them is: **the
 * cheapest sky goes on the board that runs on the most devices, and the
 * costliest on the board with the fewest entities.** Map by map:
 *
 * **a0-39 re-measured every one of those figures** (one gradient shape per
 * element instead of a stack of four flat ones) and **the ranking did not
 * move** — every sky got 44% cheaper and Iron Veil, which gained a soft edge it
 * never had, still comes first. So no assignment below is re-argued: the whole
 * column is smaller and the reasoning that placed it is untouched.
 *
 *  - **`octagon` → NONE.** The Ring is the default: it is what `?debug=1` boots,
 *    what a returning player finds pre-selected, and the first thing a phone
 *    meets. The map that runs on the most devices should cost the least, and
 *    "darker, nothing else" is the purest statement of the pick anyway.
 *  - **`compass` → Coalsack.** The Compass is corner-cover and edge-lanes, and
 *    it is a derelict-fill map, so at any roster below eight it also carries
 *    wrecks and their debris — one of the two busiest boards. It gets the
 *    cheapest sky that is not nothing (0.399), and the only one that **adds no
 *    light to the frame at all**: Coalsack is the ground colour in front of the
 *    stars, so it can never raise a pixel's value (measured peak Y′ 1.9 — the
 *    ground's own) and takes 0% off the contrast of the ring, the threat fill or
 *    the ore. A dust lane also suits a map about cover.
 *  - **`diamond` → Patina Drift.** Double Diamond is the other derelict-fill
 *    board and the most contested centre in the set — the exposed inner homes
 *    sit right on the commons — so it takes the next-cheapest (0.555). No
 *    reserved hue, no additive pass, and the "old system" tint is the right
 *    register for the veteran board with wrecks standing on it.
 *  - **`oval` → Plasma Reef.** The costly sky goes on the *thinnest* map. The
 *    Oval regenerates exactly `count` homes rather than filling to eight, so at
 *    every roster below eight it is the board with the fewest entities on it,
 *    and it is a wide arena whose stations sit spread around a rim with an empty
 *    middle. It is the one board with fill-rate to spare — and under
 *    `VfxAutoQuality` the reef is the sky that thins hardest, so a throttled
 *    phone pays 41% of it (r9-01: it used to pay none of it, by making the sky
 *    leave the frame mid-match).
 *  - **`crescents` → Iron Veil.** (a0-12, claiming one of the two skies this
 *    registry held open.) The Crescents is the busiest *frame* in the set: two
 *    arcs of four face each other across one small bowl, every home is the same
 *    short run from the commons, and it is derelict-fill, so below eight it also
 *    carries wrecks and their debris. Four stations, their turrets, the whole
 *    commons and eight ships can share one screen at the moment of contact —
 *    nowhere else does. By the rule above the busiest board takes the cheapest
 *    coloured sky, and Iron Veil is it at **0.249**, five eighths of Coalsack's. A
 *    laminated iron band with rust through it also suits a board that is a wall
 *    you stand inside.
 *  - **`line` → Deep Ember.** The Line is the thinnest board per screen and the
 *    exact complement of the reasoning above: eight homes strung down two picket
 *    lines 2027 u apart, so a screen holds a couple of stations and a great deal
 *    of empty corridor. Deep Ember at 0.416 is affordable there, and its shape is
 *    the argument — "five dying coals at the rim… the middle of the screen, where
 *    the fight is, stays clean" is a description of this map's contested corridor.
 *    The warmth sits out where the lines are and never over the ground being
 *    fought for.
 *
 * **Every sky now has a map** — the hole `UNASSIGNED_NEBULAE` stated is closed.
 * One consequence is worth naming rather than discovering: Iron Veil and Deep
 * Ember are the two skies that spend a RESERVED hue under the style-guide §2.2
 * carve-out, and until now no shipped board depended on it. Two boards do now,
 * so §2.2 is load-bearing rather than merely permitted. Nothing changed about
 * the ink — the audit's `SKY_RESERVED_ALPHA_MAX` still holds both to a whisper
 * (peak luma 9.1 and 6.9 of 255 over Floor, and since a0-39 it holds them on the
 * pixel a player sees rather than on one quarter of it) — but the Director's clean seam to
 * veto §2.2 is now a seam with two maps standing on it.
 */
export const MAP_NEBULA: Readonly<Record<MapId, NebulaId>> = {
  octagon: 'none',
  compass: 'coalsack',
  diamond: 'patinaDrift',
  oval: 'plasmaReef',
  crescents: 'ironVeil',
  line: 'deepEmber',
};

/**
 * The skies with no map yet — **named and unassigned, not guessed**.
 *
 * Empty since a0-12: six maps, six skies, one each. The list stays (and
 * `backdrop.test.ts` still asserts it equals the set of unassigned skies) so the
 * next sky or the next map lands in a registry that still states its own holes
 * rather than one that quietly stopped counting.
 */
export const UNASSIGNED_NEBULAE: readonly NebulaId[] = [];

/** The sky a map flies under. An unknown id falls back to the default map's, so
 *  a stale saved map key can never crash or blank the backdrop. */
export function nebulaForMap(mapId: string | undefined): NebulaSpec {
  const known = mapId === undefined ? undefined : (MAP_NEBULA as Record<string, NebulaId | undefined>)[mapId];
  return NEBULAE[known ?? MAP_NEBULA.octagon];
}

// ---------------------------------------------------------------------------
// Generators — plain SpriteDef data (deterministic, palette-audited)
// ---------------------------------------------------------------------------

/** A small, stable string hash → 32-bit int, to salt a layer's seed by its key. */
function keySalt(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One depth layer of stars as a {@link SpriteDef}, authored centred on the
 * origin across a `width`×`height` box. Deterministic in (`spec`, `seed`,
 * `width`, `height`): same inputs, deep-equal output (GDD §4.1). Star count is
 * area-scaled by the layer's density, so a bigger arena gets proportionally
 * more field rather than the same field stretched.
 *
 * **a0-40 rebuilt this against the design** ({@link MOCKUP_STARS}), and three
 * things changed together, because separately none of them is the defect:
 *
 *  1. **Sixteen times as many stars.** The design carries 560 a screenful; the
 *     three layers shipped 35 between them. At 35 the 99th percentile of a frame
 *     is still background — measured p99 7–9 against the design's 46–53 — which
 *     is a frame with specks in it, and *"these are all 1 color, there are no
 *     stars in them"* is the accurate description of one.
 *  2. **A magnitude curve, not three tiers.** A star draws one magnitude and its
 *     radius, its alpha and its place on the value ramp all follow from it.
 *  3. **Bloom on the brightest, with its spikes.** One soft-falloff halo instead
 *     of two flat rings, at 0.48 of the star's alpha instead of 0.16, on the
 *     `magnitude > 0.86` population — and the same population gets the
 *     diffraction cross, because a spike and a halo are one event.
 */
export function starFieldSprite(
  spec: StarLayerSpec,
  seed: number,
  width: number,
  height: number,
): SpriteDef {
  const rng = mulberry32((seed ^ keySalt(spec.key)) >>> 0);
  const count = Math.max(1, Math.round(((width * height) / 1e6) * spec.density));
  const hw = width / 2;
  const hh = height / 2;
  const shapes: Shape[] = [];
  for (let i = 0; i < count; i++) {
    const x = round(rng.next() * width - hw);
    const y = round(rng.next() * height - hh);
    const mag = starMagnitude(rng.next());
    const r = round(starRadius(mag));
    const alpha = round(starAlpha(mag));
    const ink = starInkFor(spec, mag);
    // Bloom first, so the star's own point sits on top of its halo — and the
    // halo takes the ink's tint if it has one, the ink's own colour if not
    // (a0-22; {@link BLOOM_TINTS}).
    if (starBlooms(mag)) {
      const haloAlpha = round(alpha * BLOOM.intensity);
      const haloR = round(r * BLOOM.radius);
      if (haloAlpha > 0 && haloR > 0) {
        shapes.push(
          circle(
            x,
            y,
            haloR,
            softFill(ink.halo ?? ink.color, 'material', haloAlpha, {
              cx: x,
              cy: y,
              rx: haloR,
              ry: haloR,
              angle: 0,
            }),
          ),
        );
      }
      // The diffraction cross. It is the point's own spike, not the scatter, so
      // it keeps the star's own colour even when the halo around it is tinted.
      const len = round(r * SPIKE.length);
      const a = round(alpha * SPIKE.intensity);
      shapes.push(polyline([x - len, y, x + len, y], stroke(ink.color, SPIKE.width, 'material', a)));
      shapes.push(polyline([x, y - len, x, y + len], stroke(ink.color, SPIKE.width, 'material', a)));
    }
    shapes.push(circle(x, y, r, fill(ink.color, 'material', alpha)));
  }
  return sprite(`backdrop/stars/${spec.key}/${round(width)}x${round(height)}`, Math.max(hw, hh), shapes);
}

/**
 * The ground plane: one opaque {@link GROUND_COLOR} quad the whole void is
 * composited over. Drawn rather than left to the canvas clear colour so the
 * backdrop is self-contained — the void looks the same whatever the application
 * background happens to be, and the play-field's ground is a decision that lives
 * in the art layer where it can be audited.
 */
export function groundSprite(width: number, height: number): SpriteDef {
  const hw = round(width / 2);
  const hh = round(height / 2);
  return sprite(`backdrop/ground/${hw}x${hh}`, Math.max(hw, hh), [
    poly([-hw, -hh, hw, -hh, hw, hh, -hw, hh], fill(GROUND_COLOR, 'sky', 1)),
  ]);
}

/**
 * One sky as a {@link SpriteDef}, authored centred on the origin over a
 * `width`×`height` parallax field, as seen through a `screenW`×`screenH`
 * viewport. Deterministic in all six arguments.
 *
 * The screen defaults to the field, which is the right default for a review tile
 * (one screenful, exactly the developer's declared element counts) and the wrong
 * one for the live backdrop — {@link VoidBackdrop.configure} passes the real
 * viewport, so a phone sees the sky at phone scale over any arena. NONE returns
 * an empty sprite rather than null, so every caller has one shape of code.
 */
export function nebulaSprite(
  id: NebulaId,
  seed: number,
  width: number,
  height: number,
  density = 1,
  screenW = width,
  screenH = height,
): SpriteDef {
  const spec = NEBULAE[id];
  return sprite(
    `backdrop/nebula/${id}/${round(width)}x${round(height)}@${round(density)}/${round(screenW)}x${round(screenH)}`,
    Math.max(width, height) / 2,
    spec.build(seed, width, height, density, screenW, screenH),
  );
}

/**
 * A sky as the art review surface sees it: **the whole stack**, in the order the
 * frame composites it — ground, two star layers, and the sky itself either
 * behind them or (Coalsack) in front. A nebula sample on its own would be a
 * near-invisible tile and would say nothing at all about the one sky whose
 * entire point is what it *removes*, so the catalogue shows the composite
 * (./catalogue, ./preview).
 */
export function nebulaTileSprite(id: NebulaId, seed: number, width: number, height: number): SpriteDef {
  const spec = NEBULAE[id];
  const stars: Shape[] = [];
  for (const layer of STAR_LAYERS) {
    if (layer.key === 'near') continue; // two layers is enough at tile scale
    stars.push(...starFieldSprite(layer, seed, width, height).shapes);
  }
  const sky = spec.build(seed, width, height, 1, width, height);
  // The tile is rendered in a SQUARE box of half-width `extent`, so the ground
  // has to fill that square rather than the authoring rectangle — otherwise the
  // review sheet shows the sky letterboxed on two bands of Vacuum, which is the
  // one background this whole brief replaced.
  const extent = Math.max(width, height) / 2;
  return sprite(`backdrop/tile/${id}/${round(width)}x${round(height)}`, extent, [
    ...groundSprite(extent * 2, extent * 2).shapes,
    ...(spec.occludes ? [...stars, ...sky] : [...sky, ...stars]),
  ]);
}

// ---------------------------------------------------------------------------
// Arena-wall integration — the void meets the boundary
// ---------------------------------------------------------------------------

/** One inset band of the arena wall's inner glow: a steel stroke, faded by
 *  distance from the edge, so the wall reads as a lit structure the void presses
 *  against rather than a hairline rectangle floating on black. */
export interface WallBand {
  /** Inset from the arena edge, world units. */
  readonly inset: number;
  readonly width: number;
  readonly alpha: number;
}

/**
 * The arena wall's look: a crisp double frame at the very edge, then a short
 * falloff of ever-fainter steel bands stepping inward — a soft inner glow that
 * ties the wall to the star-field behind it (the brief: "arena wall integrated
 * into the look"). Steel only (style-guide §3: structure is never a player
 * colour, §2: never signal yellow), so it is compliant by construction. The
 * renderer draws these against `world.bounds`; the *look* lives here.
 */
export const ARENA_WALL_BANDS: readonly WallBand[] = [
  { inset: 0, width: 4, alpha: 0.5 }, // the crisp outer frame — the world ends here
  { inset: 6, width: 1, alpha: 0.28 }, // the inner rule
  { inset: 16, width: 10, alpha: 0.05 }, // the glow's near band…
  { inset: 30, width: 14, alpha: 0.03 }, // …fading into the void
];

// ---------------------------------------------------------------------------
// VoidBackdrop — the composited, parallax-scrolling backdrop
// ---------------------------------------------------------------------------

interface Layer {
  readonly gfx: Graphics;
  readonly parallax: number;
}

/**
 * The area a field must span to cover the screen at any camera offset, given a
 * parallax factor `f`, the viewport size and the arena bound on that axis. The
 * field, positioned at `f·cameraOffset`, must overlap `[0, view]` for every
 * `cameraOffset ∈ [center − bound, center]`; the two extremes ask for
 * `view·(1 + f)` and `view·(1 − f) + 2·bound·f`, and this returns more than
 * both, plus a quarter-view of slack.
 *
 * Exported because it is the *reason* a faster sky costs anything at all: raise
 * `f` and the field grows, so `backdrop.test.ts` can hold both halves of that
 * trade — the field genuinely covers the screen at {@link SKY_PARALLAX}, and
 * what it costs to do so is the ~22% of build-time geometry a0-07b declares.
 */
export function coverSpan(f: number, view: number, bound: number): number {
  return (2 - f) * view + 2 * f * bound + view * 0.25; // + a quarter-view of slack
}

/**
 * The void backdrop: build once with {@link configure} (idempotent — it rebuilds
 * only when the arena bounds, the viewport or the map change), then call
 * {@link update} every frame with the camera offset the renderer already
 * computed. Add {@link view} to the scene graph *behind* the world container.
 *
 * The VFX tier is deliberately **not** on that list of rebuild triggers (r9-01).
 * It is read once per sky, when the sky is built, and pinned from then on —
 * see {@link skyDensity}.
 */
export class VoidBackdrop {
  /** The screen-space root — add behind the world container. */
  readonly view = new Container();

  private layers: Layer[] = [];
  private reduced = false;
  private nebula: NebulaSpec = NEBULAE[MAP_NEBULA.octagon];
  /**
   * **The pin (r9-01).** The density the sky on the stage was built at, decided
   * the first time this sky is built and then held for as long as it is the
   * sky — so the auto-reducer engaging (or releasing) at t+8 s changes nothing a
   * player is looking at. `null` = no sky committed yet, so the next
   * {@link configure} reads the tier.
   */
  private pinnedDensity: number | null = null;
  /** The config the current geometry was built for, so a no-op frame rebuilds
   *  nothing (GDD §4.3). `-1` = never built. */
  private builtW = -1;
  private builtH = -1;
  private builtBoundsW = -1;
  private builtBoundsH = -1;
  private builtDensity = -1;
  private builtNebula: NebulaId | '' = '';

  constructor(private readonly seed: number = VOID_SEED) {
    this.view.label = 'void-backdrop';
  }

  /**
   * Thin the *next* sky on a throttled device (GDD §4.3 risk 5). Each sky
   * declares what survives — {@link NebulaSpec.reducedDensity} — because "the
   * nebula" is no longer one thing with one cost. The stars, near-free once
   * baked, and the ground, which is one opaque quad, always stay.
   *
   * **This never touches the sky already on the stage** (r9-01). It records the
   * tier; {@link configure} reads it only when it has no sky committed, so this
   * call cannot rebuild, cannot re-scatter and cannot remove a layer a player is
   * looking at. It is free to be called every frame, in either direction, which
   * is exactly what the renderer does.
   *
   * The consequence, stated rather than discovered: a device that drops below
   * the fps floor *mid-match* buys back nothing from the backdrop — it buys it
   * from the impact glows, the spawn shimmer and the station halo, which are all
   * per-frame decisions and can flip mid-match without an artefact. The backdrop
   * pays on the next map instead. That is the trade, and it is the right way
   * round: a rebake of every layer's geometry at the moment frames are already
   * bad is a hitch on top of a stall, and it was buying the frame it interrupted.
   */
  setReduceVfx(on: boolean): void {
    this.reduced = on;
  }

  /** Point the backdrop at a map, which is what chooses its sky
   *  ({@link MAP_NEBULA}). Cheap and idempotent; the rebuild happens lazily in
   *  {@link configure}. An unknown id falls back to the default map's sky. A
   *  *different* sky releases the density pin — the new one is entitled to read
   *  the current VFX tier, since nobody is looking at it yet (r9-01). */
  setMap(mapId: string | undefined): void {
    const next = nebulaForMap(mapId);
    if (next.id !== this.nebula.id) this.pinnedDensity = null;
    this.nebula = next;
  }

  /** The sky currently built (or about to be) — the renderer's read-back, and
   *  what the perf/evidence probes report. */
  get nebulaId(): NebulaId {
    return this.nebula.id;
  }

  /**
   * The density this sky is (or will be) built at: 1 at full VFX, and
   * {@link reducedSkyDensity} if the tier was throttled when the sky was
   * committed. Always > 0 — the read-back for "the sky thinned" as against the
   * defect this replaced, "the sky left" (r9-01).
   */
  get skyDensity(): number {
    return this.pinnedDensity ?? (this.reduced ? reducedSkyDensity(this.nebula) : 1);
  }

  /**
   * Build (or rebuild) the field to cover a `viewW`×`viewH` viewport over a
   * `boundsW`×`boundsH` arena. Cheap no-op when nothing changed — safe to call
   * every frame. Geometry is played into static `Graphics` here and only moved
   * thereafter.
   */
  configure(boundsW: number, boundsH: number, viewW: number, viewH: number): void {
    // **Commit the tier here, once (r9-01.)** The sky's density is decided the
    // first time this sky is built and pinned; from then on the rebuild key
    // carries the pinned number rather than the live `reduced` flag, so the
    // reducer flipping mid-match is not a rebuild trigger at all. A resize that
    // *does* rebuild (a mobile URL-bar reflow, a rotate) re-bakes the same sky at
    // the same density rather than taking the chance to shed it.
    const density = (this.pinnedDensity ??= this.reduced ? reducedSkyDensity(this.nebula) : 1);
    if (
      this.builtW === viewW &&
      this.builtH === viewH &&
      this.builtBoundsW === boundsW &&
      this.builtBoundsH === boundsH &&
      this.builtDensity === density &&
      this.builtNebula === this.nebula.id &&
      this.layers.length > 0
    ) {
      return;
    }
    this.builtW = viewW;
    this.builtH = viewH;
    this.builtBoundsW = boundsW;
    this.builtBoundsH = boundsH;
    this.builtDensity = density;
    this.builtNebula = this.nebula.id;

    // Discard any prior build.
    for (const l of this.layers) l.gfx.destroy();
    this.layers = [];
    this.view.removeChildren();

    // The ground, first and always: one opaque Floor quad, fixed to the screen
    // (parallax 0, so it needs no cover slack at all).
    const ground = new Graphics();
    ground.label = 'void-ground';
    drawSprite(ground, groundSprite(viewW + 2, viewH + 2), 1);
    this.view.addChild(ground);
    this.layers.push({ gfx: ground, parallax: 0 });

    // A sky is drawn because the map has one, full stop. The VFX tier decides how
    // MUCH of it, never whether — `none` is the only sky that is no layer, and it
    // is no layer at every tier (r9-01).
    const drawSky = this.nebula.id !== 'none';
    const sky = (): void => {
      if (!drawSky) return;
      const nw = coverSpan(this.nebula.parallax, viewW, boundsW);
      const nh = coverSpan(this.nebula.parallax, viewH, boundsH);
      const g = new Graphics();
      g.label = `void-nebula-${this.nebula.id}`;
      drawSprite(g, nebulaSprite(this.nebula.id, this.seed, nw, nh, density, viewW, viewH), 1);
      if (this.nebula.additive) g.blendMode = 'add';
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: this.nebula.parallax });
    };

    // A sky of light sits behind the star-field; a sky of dust sits in front of
    // it and takes stars out of the frame. That ordering IS Coalsack's look.
    if (!this.nebula.occludes) sky();
    for (const spec of STAR_LAYERS) {
      const w = coverSpan(spec.parallax, viewW, boundsW);
      const h = coverSpan(spec.parallax, viewH, boundsH);
      const g = new Graphics();
      g.label = `void-stars-${spec.key}`;
      drawSprite(g, starFieldSprite(spec, this.seed, w, h), 1);
      this.view.addChild(g);
      this.layers.push({ gfx: g, parallax: spec.parallax });
    }
    if (this.nebula.occludes) sky();
  }

  /**
   * Position every layer for this frame. `offX`/`offY` are the world container's
   * screen offset (the renderer's camera offset). A layer at parallax `f` sits
   * at `f·offset`, plus the viewport centre so the origin-centred field lands
   * over the visible area. Allocation-free (GDD §4.3): only transforms move.
   */
  update(offX: number, offY: number, viewW: number, viewH: number): void {
    const cx = viewW / 2;
    const cy = viewH / 2;
    for (const l of this.layers) {
      l.gfx.position.set(cx + offX * l.parallax, cy + offY * l.parallax);
    }
  }

  /** Release every layer's geometry (context loss / teardown). The density pin
   *  goes with them: nothing is on the stage, so the next build is entitled to
   *  read the tier afresh (r9-01). */
  destroy(): void {
    for (const l of this.layers) l.gfx.destroy();
    this.layers = [];
    this.view.removeChildren();
    this.pinnedDensity = null;
    this.builtDensity = -1;
  }
}
