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
 * | axis | picked (a0-07) | now (a0-40) |
 * |---|---|---|
 * | Ground | **Floor `#010204`** — replaces Vacuum as the *backdrop* | **`#070910`**, the design's own (`./tokens` `FLOOR`) |
 * | Bloom rule | **seeded scatter** — a pure function of the seed, at any magnitude | **the brightest** — `magnitude > 0.86` ({@link BLOOM}) |
 * | Bloom intensity | **subtle** — the lowest of the three shown | **0.48**, the design's ({@link MOCKUP_STARS}) |
 * | Nebula | **all six, one per map** — including NONE | unchanged ({@link MAP_NEBULA}) |
 *
 * The right-hand column is a0-40, and both entries in it overturn a pick from
 * the left. That is not an art opinion re-litigating a ratification: the skies
 * on the left were picked off the developer's compositor, the game then drifted
 * five times darker than that compositor, and the ruling on the sixth report
 * about it is that the game **matches** the mockup — *"not close enough, the
 * same"*. Where the two disagree, the mockup is the ratification.
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
 * The skies are patina, plasma, steel, Floor itself — and, for Iron Veil and Deep
 * Ember, threat red at a whisper the audit enforces numerically (style-guide §2.2
 * / `./compliance` `SKY_RESERVED_ALPHA_MAX`). Signal yellow never appears on the
 * sky at any alpha. Every sky ink is painted on the `sky` role, which no entity
 * may wear.
 *
 * **The stars are the one exception to "no seventh hue", and a0-45 is where it
 * was granted.** They used to be the steel value ramp; the design gives each star
 * a temperature and colours it from that, so 78% of the field is blue-white and
 * 22% amber. `./compliance` admits exactly the colours `starColorFor` produces,
 * on role `material` of a `backdrop/` sprite, and refuses them everywhere else —
 * see {@link STAR_LAYERS} for what that costs and what is put to the Director.
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
import { FLOOR } from './palette';
import {
  MOCKUP_REFERENCE,
  MOCKUP_STARS,
  MOCKUP_STAR_DENSITY,
  mockupBlobs,
  starAlpha,
  starBlooms,
  starColorFor,
  starHaloAlpha,
  starMagnitude,
  starRadius,
  starSpikeAlpha,
  starTemperature,
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
}

/**
 * **Three depth layers, back to front.** A layer is a *depth* and nothing else:
 * one magnitude curve, one temperature distribution, three parallax factors.
 *
 * ## a0-45 removed the last thing a layer used to carry, and it is worth naming
 *
 * Until this brief each layer carried an **ink set** — a value ramp
 * (`hullSteel` → `hullLight` → white, chosen by magnitude) plus, on two of the
 * three, a `BLOOM_TINTS` hue its top band's halo was painted in. Both are gone,
 * and they went for the same reason: **the design colours a star from its
 * temperature** ({@link starColorFor}), and paints the star's point, its halo and
 * its cross all in that one colour. A ramp beside a temperature is the old
 * behaviour with somewhere to survive (LESSONS §14), and a tint beside it is a
 * second source for the one thing that now has exactly one.
 *
 * `BLOOM_TINTS` was a0-22's answer to *"our mockups had different colored blooms
 * these are all 1 color"* — reached, at the time, with the star's own colour
 * fixed on a grey ramp, so the only place a hue could go was the scatter around
 * it. The developer was describing the design's field, and the design's field is
 * coloured at the **star**, not at the halo around it. So the two ratified tints
 * are not overturned on taste; they are answered. Every bloom in the frame now
 * carries a hue, it is its own star's, and *"different colored blooms"* is
 * satisfied by 78% blue-white and 22% amber rather than by two accent hues on two
 * layers. The a0-22 invariant that outlived it — a halo may never be brighter
 * than its star's own colour composites to — is now true by identity.
 *
 * ## What a temperature field costs, stated rather than buried
 *
 * §1 says structure never takes a player colour, and **blue is a player identity
 * colour**. This paints 78% of the sky blue-white at Y′ ~200 before alpha. It is
 * the design the developer approved and re-approved and it is what ships, but the
 * question is real and it is put to the Director in the PR rather than answered
 * here by desaturating the sky again — which is precisely what a0-40 did and what
 * this brief exists to undo. The measurements that bound it, from
 * `backdrop.test.ts`:
 *
 *  - a star's **point** is 0.4–2.45 px across and paints at α 0.08–0.5, so the
 *    brightest star in the field composites to Y′ 105 against the beacon ring's
 *    189 and the roster trim's own values, at ΔE ≥ 40 from all eight roster hues;
 *  - the amber 22% is the other half of the same question — it is warm, and warm
 *    is where ore and danger live. It is not signal yellow (`#F2D24B`), it is not
 *    a declared shade of it, and `./compliance`'s `YELLOW_FAMILY` therefore does
 *    not fire; the ΔE from ore and from the station core is measured per test.
 *
 * Both are reported in the PR body as questions with numbers attached.
 */
export const STAR_LAYERS: readonly StarLayerSpec[] = [
  {
    key: 'deep',
    parallax: 0.1,
    share: 0.61,
    density: round(MOCKUP_STAR_DENSITY * 0.61),
  },
  {
    key: 'mid',
    parallax: 0.26,
    share: 0.3,
    density: round(MOCKUP_STAR_DENSITY * 0.3),
  },
  {
    key: 'near',
    parallax: 0.5,
    share: 0.09,
    density: round(MOCKUP_STAR_DENSITY * 0.09),
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

/**
 * The diffraction cross a bloomed star carries — the same population as the
 * halo, because a spike and a halo are one physical event ({@link MOCKUP_STARS}).
 *
 * **One event, therefore one rule** (a0-45). Both alphas are absolute and the
 * cross's is the smaller: `0.22 × intensity` against the halo's `0.42 ×
 * intensity`, so a spike is 0.52 of the glow it is drawn inside. It was a
 * *fraction of the star's own alpha* until a0-45, measuring 0.2427–0.2728 — up
 * to 1.35× its own halo — and a bloom you cannot see under its own spikes is a
 * bloom the developer reports as absent, which is exactly what happened after
 * a0-44 fixed the halo alone.
 */
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
 * with. The rule that placed them is: **the cheapest sky goes on the board that
 * runs on the most devices, and the costliest on the board with the fewest
 * entities**, against the per-screen overdraw ranking NONE `0.000` · Iron Veil
 * `0.249` · Coalsack `0.399` · Deep Ember `0.416` · Patina Drift `0.555` ·
 * Plasma Reef `0.627`. Map by map:
 *
 * ## **a0-40 reshuffled that ranking completely, and did NOT re-assign any map**
 *
 * Porting to the design (`./mockup-reference`) changed every count and every
 * alpha, and the column came out in a different order:
 *
 * ```
 *                  a0-39    a0-40
 *   None           0.000    0.000
 *   Iron Veil      0.249    2.459
 *   Coalsack       0.399    2.263
 *   Deep Ember     0.416    3.033
 *   Patina Drift   0.555    3.174   ← now the costliest
 *   Plasma Reef    0.627    2.175   ← now the cheapest coloured one
 * ```
 *
 * So the sentence above no longer describes this registry: Plasma Reef, placed
 * on the thinnest map *because* it was the most expensive, is now the cheapest
 * coloured sky in the set, and Patina Drift, placed on a contested board because
 * it was mid-priced, is the dearest. Only the first line still holds, and it is
 * the one the default map depends on — NONE is still free.
 *
 * **Nothing below is re-assigned, deliberately.** A map's sky is part of that
 * map's identity, which is the whole reason this is a hand-written registry and
 * not `index % 6`; re-sorting it silently to satisfy a cost rule would be the
 * modulo wearing a different hat. `backdrop.test.ts` prints the new ranking every
 * run so the decision is in front of whoever makes it, and the argument each
 * assignment rests on is left standing below with its old number, marked, rather
 * than quietly corrected. **Director's call.**
 *
 *  - **`octagon` → NONE.** The Ring is the default: it is what `?debug=1` boots,
 *    what a returning player finds pre-selected, and the first thing a phone
 *    meets. The map that runs on the most devices should cost the least, and
 *    "darker, nothing else" is the purest statement of the pick anyway.
 *  - **`compass` → Coalsack.** The Compass is corner-cover and edge-lanes, and
 *    it is a derelict-fill map, so at any roster below eight it also carries
 *    wrecks and their debris — one of the two busiest boards. It gets the
 *    cheapest sky that is not nothing (0.399 then; **2.263 since a0-40**), and
 *    the only one that **adds no light to the frame at all**: Coalsack was the
 *    ground colour in front of the stars, so it could never raise a pixel's
 *    value (measured peak Y′ 1.9 — the ground's own) and took 0% off the
 *    contrast of the ring, the threat fill or the ore. **Both of those stopped
 *    being true in a0-40**, which found that a blob the colour of the ground
 *    cannot lift a panel the 4.55 the design measures at any parameters: the dust
 *    is now vacuum-and-dark-steel, it peaks at Y′ 46.3, and it costs 2.263. A
 *    dust lane still suits a map about cover; the *cost* half of this line no
 *    longer holds, and the reshuffle above is where that is dealt with.
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
 *     radius and its alpha follow from it. Its COLOUR does not: that is a second,
 *     independent draw — the star's temperature (a0-45).
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
    // **The star's own two draws, and its colour comes from the SECOND one**
    // (a0-45). Magnitude sets how bright and how big; temperature sets what
    // colour, and neither reaches into the other's half. Drawn here, per star,
    // from the same seeded stream, so the field stays byte-deterministic
    // (GDD §4.1) and the design's 78/22 split falls out of the stream itself.
    const color = starColorFor(starTemperature(rng));
    const r = round(starRadius(mag));
    const alpha = round(starAlpha(mag));
    // Bloom first, so the star's own point sits on top of its halo — and the
    // halo is the star's OWN colour, as the design's gradient is
    // (`starColor(s.temp, …)`). There is no second colour source since a0-45.
    if (starBlooms(mag)) {
      // The halo's peak is the design's own absolute alpha — the SAME wash on
      // every bloomed star, whatever its own alpha (a0-44; `starHaloAlpha`). The
      // star's magnitude is carried by the halo's RADIUS, which is the design's
      // arrangement and not the one that shipped.
      const haloAlpha = round(starHaloAlpha());
      const haloR = round(r * BLOOM.radius);
      if (haloAlpha > 0 && haloR > 0) {
        shapes.push(
          circle(
            x,
            y,
            haloR,
            softFill(color, 'material', haloAlpha, {
              cx: x,
              cy: y,
              rx: haloR,
              ry: haloR,
              angle: 0,
              // A glow, not a body: the design's own three-stop gradient
              // (`./shapes` `haloProfile`). It is the one falloff in the art
              // that is not `(1 − t²)²`, and the measurement that earns the
              // exception is on that curve.
              curve: 'halo',
            }),
          ),
        );
      }
      // The diffraction cross — the point's own light, in the point's own
      // colour, which is now the same sentence as the halo's.
      //
      // And at the design's own ABSOLUTE alpha (a0-45; `starSpikeAlpha`), which
      // is the other end of the correction a0-44 started one line up. This was a
      // fraction of the star's own alpha until a0-45 — measuring 0.2427–0.2728
      // where the halo around it peaks at a flat 0.2016 — so every bloom was
      // drawn correctly and then buried under its own spikes.
      const len = round(r * SPIKE.length);
      const a = round(starSpikeAlpha());
      shapes.push(polyline([x - len, y, x + len, y], stroke(color, SPIKE.width, 'material', a)));
      shapes.push(polyline([x, y - len, x, y + len], stroke(color, SPIKE.width, 'material', a)));
    }
    shapes.push(circle(x, y, r, fill(color, 'material', alpha)));
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
  /** The display object this layer moves each frame. A `Graphics` for the ground
   *  and the star layers; a cached `Container` for the sky ({@link
   *  SKY_CACHE_RESOLUTION}). */
  readonly gfx: Container;
  readonly parallax: number;
}

/**
 * **The sky is baked once into a texture at a third of linear resolution, and
 * that is the whole of a0-75's fill fix.**
 *
 * The developer, having bisected it themselves: *"i think it gets worse the
 * larger the playing area is on my screen … if i resize to a small window the
 * game plays much better."* Counted off the shipped geometry
 * (`evidence/a0-75-fill-rate/overdraw.txt`), a desktop frame over the wide arena
 * blends **4.4 screenfuls** of backdrop, and **3.0 of them are the sky** — nine
 * clots each covering ~40% of the frame, stacked. The ground is 1.0 and the
 * whole star field, halos and diffraction crosses included, is 0.33.
 *
 * ## Why a texture is free here and would not be anywhere else
 *
 * Two properties of *this* layer, and both are load-bearing:
 *
 *  1. **It only ever translates.** The geometry is played into a static
 *     `Graphics` at {@link VoidBackdrop.configure} and thereafter only its
 *     `position` moves ({@link VoidBackdrop.update}). Pixi's cached render group
 *     re-renders only when its contents change, and a parallax offset is not a
 *     change — so the bake happens **once per (map, viewport, tier)**, exactly
 *     where the geometry build already happens, and never in a frame.
 *  2. **Its smallest feature is enormous.** The smallest radius any sky declares
 *     is Patina Drift's `0.10` of `./mockup-reference` `featureSpan` — 128 px at 1280×720, 297
 *     at 3440×1440 — and the alpha across it is a radial ramp. Linear
 *     interpolation error on `(1 − t²)²` sampled every third pixel is
 *     `(Δt²/8)·max|f″|` = **5.5 × 10⁻⁴ of peak alpha**; at Patina Drift's own
 *     peak (0.086) over its own colour delta (151 codes) that is **0.007 of one
 *     8-bit code value**. The sky cannot tell the difference and neither can the
 *     frame it is quantised into.
 *
 * So the layer that was 3.0 blended screenfuls becomes **one textured quad at
 * 1.0**, and its thousands of triangles become two. Nothing about what the sky
 * *is* changes: same shapes, same counts, same alphas, same colours, same seed.
 * `./compliance` and `backdrop.test.ts` audit the `SpriteDef`, which is
 * untouched — this is a decision about where the pixels are rasterised, not
 * about the art.
 *
 * ## Why a third, and not a half or a quarter
 *
 * The error above is negligible at every one of them, so a third is not chosen
 * for fidelity — everything from a half to an eighth is invisible on this
 * content. It is chosen because it is where the *other* two constraints stop
 * arguing:
 *
 *  - **Below a third buys nothing.** The baked layer costs one textured pass
 *    whatever resolution it holds; only the one-off bake and the texture get
 *    cheaper, and both are already small. There is no per-frame saving past
 *    this point, so there is no reason to spend look on it.
 *  - **A third is where the ramp's dither survives.** `./textures` `rampPixels`
 *    carries noise specifically to stop the sky contouring at 8 bits, and a0-39
 *    is the brief that put it there. At a third the largest blob in the set
 *    still lands better than one cache texel per ramp texel, so the noise is
 *    resampled rather than averaged into the flat mush it exists to prevent.
 *
 * **TUNABLE** — but not downward without re-measuring the dither
 * (`evidence/a0-75-fill-rate/cache-diff.json` measures exactly that, as the
 * largest single-pixel luma step along a scanline), and not upward without
 * re-measuring the memory.
 */
export const SKY_CACHE_RESOLUTION = 1 / 3;

/**
 * **The cache's memory budget, in texels — and the reason the resolution above
 * is a ceiling rather than a setting.**
 *
 * The cache is the size of the parallax **field**, not of the screen, and
 * `coverSpan` builds a field about 2.1× wider than the screen ever needs (see
 * it). At a flat third that puts a 3440×1440 ultrawide's cache at 2664×1153,
 * which Pixi's texture pool rounds up to 4096×2048 = **32 MB** — a lot of a
 * phone's texture budget spent on field nobody can see. So the budget is stated
 * and the resolution follows from it, rather than the other way round.
 *
 * `2²¹` is 2048×1024 = **8 MB** at RGBA8. Both of those numbers matter: 2048 is
 * the WebGL2 *guaranteed* `MAX_TEXTURE_SIZE`, so a cache inside this budget fits
 * every device the game claims to run on with no capability query and no
 * fallback path that only fires on hardware we do not own; and 8 MB is one
 * texture, once per (map, viewport, tier), against the three blended screenfuls
 * a frame it replaces.
 *
 * Measured across the whole sweep it lands at 8 MB **flat** — phone to 32:9 —
 * because the resolution absorbs the difference (`backdrop-fill.test.ts` prints
 * the column).
 */
export const SKY_CACHE_MAX_TEXELS = 2 ** 21;

/**
 * **The floor.** Below this a blob's own gradient is carried by too few texels
 * to be sure of, and the sky is better off expensive than approximated: the
 * layer draws directly, exactly as it did before a0-75. A guard against a
 * viewport nobody has thought of yet, not a path any shipping screen takes — the
 * widest in the sweep (32:9 over the wide arena) asks for a sixth, where the
 * smallest blob in the set is still 60 texels across.
 */
export const SKY_CACHE_MIN_RESOLUTION = 1 / 8;

/**
 * The resolution this field's cache is baked at: {@link SKY_CACHE_RESOLUTION},
 * or the first coarser whole fraction whose texture fits
 * {@link SKY_CACHE_MAX_TEXELS} **after** the power-of-two rounding Pixi's
 * texture pool applies. `null` when even {@link SKY_CACHE_MIN_RESOLUTION} would
 * not fit, which means *draw the sky directly* — correct and expensive, never
 * absent (the r9-01 rule, in a new place).
 *
 * Whole fractions rather than a continuous fit, because the pow2 rounding makes
 * the cost a staircase: between 1/3 and 1/4 there is nothing to buy, and a
 * continuous `min()` would happily return 1/3.38 and land on the same texture as
 * 1/4 while looking like a considered number.
 *
 * Exported so the gate can assert a real number at every viewport the game is
 * played at. An uncached sky is invisible to the eye and costs three blended
 * screenfuls a frame, which is the whole of a0-75 — not a thing to discover from
 * a frame-time regression months later.
 */
export function skyCacheResolution(fieldW: number, fieldH: number): number | null {
  const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
  for (let d = Math.round(1 / SKY_CACHE_RESOLUTION); d <= Math.round(1 / SKY_CACHE_MIN_RESOLUTION); d++) {
    const r = 1 / d;
    if (pow2(Math.ceil(fieldW * r)) * pow2(Math.ceil(fieldH * r)) <= SKY_CACHE_MAX_TEXELS) return r;
  }
  return null;
}

/**
 * The area a field must span to cover the screen at any camera offset, given a
 * parallax factor `f`, the viewport size and the arena bound on that axis. The
 * field, positioned at `f·cameraOffset`, must overlap `[0, view]` for every
 * `cameraOffset ∈ [view/2 − bound, view/2]`; the two extremes ask for
 * `view·(1 + f)` and `view·(1 − f) + 2·bound·f`, and this returns the larger of
 * them plus a quarter-view of slack.
 *
 * Exported because it is the *reason* a faster sky costs anything at all: raise
 * `f` and the field grows, so `backdrop.test.ts` can hold both halves of that
 * trade — the field genuinely covers the screen at {@link SKY_PARALLAX}, and
 * what it costs to do so is the ~20% of build-time geometry a0-07b declares.
 *
 * ## a0-75 found it over-provisions by a whole viewport, and did NOT take it
 *
 * `(2 − f)·view + 2·f·bound` is `[view·(1 − f) + 2·f·bound] + view` — the second
 * requirement with an entire viewport added on top, which then has the
 * documented quarter-view of slack added to *that*. `Math.max(…) + view/4` is
 * what the paragraph above describes, and against it every field in the void is
 * built about **2.1× too wide and 2.3× too tall — 4.9× the area.** It costs no
 * per-frame fill (the rasteriser clips what is off screen) and it costs
 * everything else: the deep star layer bakes **49,378 shapes at 3440×1440**
 * where 15,560 would cover the screen and every one of them is submitted every
 * frame; the a0-75 sky cache is field-sized, so it wants 4× the texels; and
 * every rebuild — which is every resize frame while a window is being dragged —
 * pays all of it. Measured with `Math.max`: 3.2× less star geometry, and the
 * cache at 3440×1440 falls from 32 MB to 8.
 *
 * **It is left alone here, deliberately, and that is a finding rather than a
 * deferral.** The field is not only a cover margin: a `lane` sky's `reach` and a
 * `band` sky's spread are fractions of it (`./mockup-reference` `mockupBlobs`),
 * so shrinking it makes Coalsack's dust lane physically shorter and re-packs
 * every structure that spans the field. Measured, three ratified declarations
 * move out of tolerance at once — Coalsack's peak luma 46.3 → 35.2, Patina
 * Drift's 32.3 → 35.4, and a0-07b's own build-cost claim. Buying memory by
 * re-shaping three skies is the exact trade a0-40 exists to refuse, and the
 * honest fix is a brief that re-derives the sky measurements against a corrected
 * field — not a0-75 doing it on the way past. **Director's call.**
 *
 * a0-75 therefore pays for the over-provision where it can be paid without
 * touching a sky: {@link skyCacheResolution} sizes the cache to a memory budget
 * instead of to the field, so an oversized field costs resolution nobody can see
 * rather than megabytes everybody does.
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
  /** Whether the sky on the stage is the baked quad or the raw geometry — false
   *  when there is no sky, and when the field was too big to cache
   *  ({@link skyCacheResolution}). The read-back for the a0-75 fill fix. */
  private skyCached = false;
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
   * Whether the sky on the stage is the **baked quad** rather than its raw
   * geometry ({@link SKY_CACHE_RESOLUTION}). False when the map's sky is `none`,
   * and false when the parallax field was too large to cache
   * ({@link skyCacheResolution}) — in which case the sky is correct and expensive
   * rather than absent.
   *
   * Exported as a read-back because "did the fill fix engage" is otherwise
   * invisible: an uncached sky looks identical and costs three screenfuls a
   * frame, which is precisely the failure mode a0-75 was reported as.
   */
  get skyIsCached(): boolean {
    return this.skyCached;
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
    this.releaseLayers();

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
      drawSprite(g, nebulaSprite(this.nebula.id, this.seed, nw, nh, density, viewW, viewH), 1);
      if (this.nebula.additive) g.blendMode = 'add';

      // **Bake it (a0-75; {@link SKY_CACHE_RESOLUTION}).** Three screenfuls of
      // stacked gradient become one textured quad. The wrapper carries the
      // label, so every read-back that finds this layer by name still does
      // (`backdrop-reducer.test.ts`, `render/reduce-vfx.test.ts`).
      const holder = new Container();
      holder.label = `void-nebula-${this.nebula.id}`;
      holder.addChild(g);
      const resolution = skyCacheResolution(nw, nh);
      if (resolution !== null) {
        // The blend goes on BOTH: on the `Graphics` so the clots composite with
        // each other inside the cache exactly as they did on the frame buffer,
        // and on the wrapper so the finished cache composites onto the ground
        // the same way. Source-over is associative and additive is too, so the
        // two-step result is the one-step result — which is the whole reason a
        // cache is allowed to stand in for the layer.
        if (this.nebula.additive) holder.blendMode = 'add';
        // `antialias: false` deliberately. Every edge in this layer is the zero
        // rim of a falloff, where the alpha has already arrived at 0 — there is
        // no edge to smooth, and MSAA on a cache is 4× the bake for nothing.
        holder.cacheAsTexture({ resolution, antialias: false });
        this.skyCached = true;
      } else {
        this.skyCached = false;
      }
      this.view.addChild(holder);
      this.layers.push({ gfx: holder, parallax: this.nebula.parallax });
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

  /**
   * Drop every layer, and drop the sky's **cache texture** with them.
   *
   * `cacheAsTexture(false)` before `destroy()` is not tidiness: a cached render
   * group holds a pooled `RenderTexture`, and destroying the container without
   * disabling the cache first leaves that texture in the pool keyed to a render
   * group that no longer exists. At 8 MB a sky and one rebuild per resize, a
   * window being dragged is the exact input that turns that into a leak.
   */
  private releaseLayers(): void {
    for (const l of this.layers) {
      if (l.gfx.isCachedAsTexture) l.gfx.cacheAsTexture(false);
      l.gfx.destroy({ children: true });
    }
    this.layers = [];
    this.skyCached = false;
    this.view.removeChildren();
  }

  /** Release every layer's geometry (context loss / teardown). The density pin
   *  goes with them: nothing is on the stage, so the next build is entitled to
   *  read the tier afresh (r9-01). */
  destroy(): void {
    this.releaseLayers();
    this.pinnedDensity = null;
    this.builtDensity = -1;
  }
}
