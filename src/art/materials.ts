/**
 * src/art/materials.ts — the Gantry/Bone material vocabulary. OWNER: Art Agent.
 *
 * The design handoff (`docs/design/gantry-bone-handoff.html`, written up in the
 * sibling `.md`) diagnoses the menus in one line:
 *
 * > *"The current UI is 1px hairlines on black, which reads as a wireframe
 * > rather than a product. The fix is **material**, not colour: every plate now
 * > has a lit top edge, a shadowed under-line, a cast shadow, an inner sheen on
 * > primaries, and rivets where plates meet. One tracking scale replaces the six
 * > that had drifted in."*
 *
 * Five screens follow that direction — title, build wheel, lobby, ship select,
 * settings. If each one invents its own bevel we ship five dialects of one
 * direction, which is the exact drift the handoff is fixing. So this module is
 * **the vocabulary, not the screens**: it adds primitives and applies none of
 * them. Nothing here changes a pixel until a screen brief calls it.
 *
 * ## What is in here
 *
 *  - {@link drawPlate} — *the* plate, one function parameterised by
 *    {@link PlateRole} (primary / secondary / inert), {@link PlateScale} and
 *    {@link PlateState}. Lit top edge, shadowed under-line, cast shadow, inner
 *    sheen, accent tick, chamfered "gantry" corners.
 *  - {@link drawRivetCluster} — the rivets where plates meet.
 *  - {@link TRACKING} — the one tracking scale, plus {@link trackingPx} because
 *    the handoff speaks `em` and PixiJS `letterSpacing` is pixels.
 *  - {@link BEAM} + {@link drawBeam} — the 44px margins and 92px header/footer
 *    beams the whole set shares.
 *
 * ## Bone is brightness, not a hue (style-guide §1, §2)
 *
 * The ratified accent is **Bone**: *"no accent hue at all, so the primary action
 * is simply the brightest metal on screen"*. Every tone below is therefore a
 * declared **value-ramp recipe on `hullSteel`** — the same discipline
 * `palette.ts` enforces for sprites ("no seventh hue"; a derived shade is a mix
 * toward `vacuum` or toward white and nothing else). {@link MATERIAL_RECIPES}
 * carries each recipe, {@link MATERIAL_SHADES} the literal result, and
 * `materials.test.ts` recomputes every one — so a hand-edited hex cannot
 * smuggle a colour in here any more than it can into a ship.
 *
 * Signal yellow and threat red never appear. **A plate is never red**: chrome is
 * steel, and the two warm hues stay reserved for ore and danger (§2). Player
 * identity colours are likewise absent — identity lives on a row bar and a
 * P-number, never as plate material.
 *
 * ## Zero per-frame allocation
 *
 * These primitives feed the batched, pooled Pixi layer, so they allocate
 * **nothing**, ever:
 *
 *  - every colour+alpha pair is a frozen {@link PlatePaint} built once at module
 *    load — {@link plateMaterial} returns the *same object* for the same
 *    (role, state) on every call, so a caller can compare by identity;
 *  - geometry is clipped into two module-scope scratch buffers that are reused,
 *    never re-created;
 *  - the draw functions take primitive arguments only — no options object, no
 *    rect object, nothing to churn.
 *
 * A plate's look changes only when its *state* does (hover, press), which is a
 * user event, not a frame. Call `clear()` + `drawPlate()` on state change; do
 * not rebuild geometry every frame.
 *
 * ## Talking to PixiJS without importing it
 *
 * {@link PlateCanvas} is the three-method structural slice of `Graphics` these
 * primitives need. Pixi's `Graphics` satisfies it as-is (the test pins that), so
 * a view passes its Graphics straight in — and this module stays numbers only,
 * testable headless with a recorder, exactly like the rest of `src/art/`
 * upstream of `vfx/layer.ts`.
 */

import { PALETTE, shade, tint, WHITE, type Recipe } from './palette';

// ---------------------------------------------------------------------------
// 1. The tones — every one a value-ramp recipe on hullSteel
// ---------------------------------------------------------------------------
//
// The handoff draws its plates in literal hex. Each of those hexes sits within a
// few units of a point on the `hullSteel` value ramp — it was drawn inside Cold
// Vacuum, just with a hair more blue in the shadows than a pure value operation
// gives. Our rule ("no seventh hue", palette.ts) forbids the literal, so every
// tone is declared as a recipe here and the handoff's hex is recorded beside it
// in `why`. The largest per-channel deviation across the whole table is 6/255,
// on `beamTop`; most are 2–4. None is visible on a near-black plate.

/** The plate tones, as recipes. `materials.test.ts` recomputes each one. */
export const MATERIAL_RECIPES = {
  // — the Bone accent ramp (handoff `--acc-hi / --acc / --acc-lo / --acc-fill`).
  // `boneHi` is the ramp's white endpoint itself, so it needs no recipe.
  bone: { base: 'hullSteel', toward: 'white', t: 0.46, why: 'Bone mid: primary sub-labels, a selected chip’s border (handoff --acc #b6bfca).' },
  boneLo: { base: 'hullSteel', toward: 'white', t: 0.11, why: 'Bone low: the beam accent rule, chip borders, the primary under-line (handoff --acc-lo #8b95a2).' },
  boneFill: { base: 'hullSteel', toward: 'vacuum', t: 0.47, why: 'The lit end of a primary plate face (handoff --acc-fill #454e5a).' },

  // — the bezel: the 2px band that makes a plate a plate.
  bezelLit: { base: 'hullSteel', toward: 'vacuum', t: 0.43, why: 'Lit top edge of a secondary bezel (handoff #4a5560).' },
  bezelShadow: { base: 'hullSteel', toward: 'vacuum', t: 0.81, why: 'The shadowed under-line beneath a secondary bezel (handoff #20262e).' },

  // — the face: the 100deg body gradient, lit end → shaded end.
  faceLit: { base: 'hullSteel', toward: 'vacuum', t: 0.83, why: 'Lit end of a secondary / inert plate face (handoff #1e242c).' },
  faceShade: { base: 'hullSteel', toward: 'vacuum', t: 0.94, why: 'Shaded end of a secondary plate face (handoff #12171d).' },
  facePrimaryShade: { base: 'hullSteel', toward: 'vacuum', t: 0.85, why: 'Shaded end of a primary plate face (handoff #1c222a).' },
  faceInertShade: { base: 'hullSteel', toward: 'vacuum', t: 0.93, why: 'Shaded end of an inert row face; also the header beam’s bottom stop (handoff #141920 / #13181f).' },
  chipFaceLit: { base: 'hullSteel', toward: 'vacuum', t: 0.75, why: 'Lit end of a chip face — a small plate runs a step hotter to read at 28px (handoff #262e38).' },
  chipFaceShade: { base: 'hullSteel', toward: 'vacuum', t: 0.9, why: 'Shaded end of a chip face (handoff #171c23).' },
  chipPrimaryLit: { base: 'hullSteel', toward: 'vacuum', t: 0.67, why: 'Lit end of a selected chip’s face — TEAMS, SOUND ON (handoff #2e3742).' },
  chipPrimaryShade: { base: 'hullSteel', toward: 'vacuum', t: 0.87, why: 'Shaded end of a selected chip’s face (handoff #1b212a).' },

  // — rules and hairlines.
  ruleLit: { base: 'hullSteel', toward: 'vacuum', t: 0.19, why: 'A chip / segmented-control border — the brightest hairline (handoff #65717e).' },
  rulePlate: { base: 'hullSteel', toward: 'vacuum', t: 0.56, why: 'The 1px rule that bounds an inert plate, which carries no bezel (handoff #3b444f).' },
  ruleDeep: { base: 'hullSteel', toward: 'vacuum', t: 0.7, why: 'An inert row’s border and the header beam’s top stop (handoff #2c343f / #29323e).' },
  hairline: { base: 'hullSteel', toward: 'vacuum', t: 0.32, why: 'Divider rules between sections (handoff #55616e).' },

  // — hardware.
  rivetBody: { base: 'hullSteel', toward: 'vacuum', t: 0.49, why: 'A rivet head where two plates meet (handoff #434c58).' },
  tickSteel: { base: 'hullSteel', toward: 'vacuum', t: 0.12, why: 'The 3px accent tick inside a secondary plate (handoff #6E7987).' },

  // — the beams.
  beamMid: { base: 'hullSteel', toward: 'vacuum', t: 0.88, why: 'Header beam mid stop, at 62% (handoff #181e26).' },
  beamFoot: { base: 'hullSteel', toward: 'vacuum', t: 0.97, why: 'Footer beam top stop (handoff #101419).' },
  beamFootDeep: { base: 'hullSteel', toward: 'vacuum', t: 0.98, why: 'Footer beam bottom stop (handoff #0e1216).' },
} as const satisfies Record<string, Recipe>;

export type MaterialShadeKey = keyof typeof MATERIAL_RECIPES;

/**
 * The plate tones, as literal packed RGB. Literal on purpose — these are the
 * values the primitives actually paint, and the test proves each equals its
 * recipe, so the ramp is verified rather than asserted in a comment.
 */
export const MATERIAL_SHADES = {
  bone: 0xb9bfc5,
  boneLo: 0x8c95a0,
  boneFill: 0x495058,

  bezelLit: 0x4d545d,
  bezelShadow: 0x22272d,

  faceLit: 0x20242b,
  faceShade: 0x14171d,
  facePrimaryShade: 0x1e2228,
  faceInertShade: 0x15181e,
  chipFaceLit: 0x292e35,
  chipFaceShade: 0x181c22,
  chipPrimaryLit: 0x32383f,
  chipPrimaryShade: 0x1c2026,

  ruleLit: 0x69717c,
  rulePlate: 0x3f454d,
  ruleDeep: 0x2f343b,
  hairline: 0x5a626b,

  rivetBody: 0x474d56,
  tickSteel: 0x707a85,

  beamMid: 0x1b1e24,
  beamFoot: 0x101419,
  beamFootDeep: 0x0f1218,
} as const satisfies Record<MaterialShadeKey, number>;

/** Recompute a plate tone from its recipe. The test's oracle. */
export function deriveMaterialShade(key: MaterialShadeKey): number {
  const r: Recipe = MATERIAL_RECIPES[key];
  const base = PALETTE[r.base];
  return r.toward === 'white' ? tint(base, r.t) : shade(base, r.t);
}

/**
 * The Bone accent ramp, by role. Bone spends **no hue** on the menu — the
 * primary action is simply the brightest metal on screen — which is what leaves
 * plasma free to mean energy in the match and keeps ore yellow and threat red as
 * the only colour anywhere (handoff §"What's decided").
 *
 * The handoff's constraint travels with it: *"the primary action relies on
 * brightness and size rather than hue, so it must never share a screen with a
 * second bright plate."*
 */
export const BONE = {
  /** The brightest step — a primary bezel's lit edge, a primary label, the tick. */
  hi: WHITE,
  /** Primary sub-labels, and the border of a selected chip. */
  mid: MATERIAL_SHADES.bone,
  /** The beam accent rule, chip borders, a primary bezel's under-line. */
  lo: MATERIAL_SHADES.boneLo,
  /** The lit end of a primary plate's face. */
  fill: MATERIAL_SHADES.boneFill,
} as const;

// ---------------------------------------------------------------------------
// 2. The one tracking scale
// ---------------------------------------------------------------------------
//
// "One tracking scale replaces the six that had drifted in (.26em eyebrows /
// .16em labels / .1em names)." Three tiers, chosen by the *job* the text does,
// never by how a given screen felt on the day.

/**
 * The ratified tracking scale, in `em`. Three tiers, and only three.
 *
 *  - `eyebrow` — the uppercase tag above a thing: `DEEP FIELD MINING AUTHORITY`,
 *    `ROSTER`, `SPENDABLE`, `HOW IT PLAYS`. Oxanium 12px / 800.
 *  - `label` — a control's own word: `OPEN`, `TEAMS`, `MANUAL`, `HOST`, a wedge
 *    sub-line. Oxanium 12–13px / 700–800.
 *  - `name` — a proper noun or a value: a player name, `P1`, `FIRE MODE`,
 *    `VANGUARD`. Oxanium 13–17px / 800.
 *
 * `eyebrow` matches the already-ratified `TYPE.eyebrowTracking` in
 * {@link ./tokens}; the other two are new, and they retire the rest.
 */
export const TRACKING = {
  eyebrow: 0.26,
  label: 0.16,
  name: 0.1,
} as const;

/**
 * Audiowide tracks on its own axis — the letterforms are wider, so display type
 * takes *less* tracking as it grows, not more. Two tiers, both observed in the
 * handoff: the wordmark at 46px, every other heading at 17–27px.
 */
export const DISPLAY_TRACKING = {
  /** `PLANET RUSH`, 46px Audiowide. */
  wordmark: 0.06,
  /** `PLAY`, `SELECT SHIP`, `CREW MUSTER`, `BACK` — 17–27px Audiowide. */
  heading: 0.08,
} as const;

/**
 * The values the scale above retires. Recorded so a screen brief can recognise
 * a drifted number in an old view and know which tier replaces it, rather than
 * preserving it out of caution. `.03`–`.24em` in the handoff's own screens, and
 * the raw-pixel spread (`0`, `0.3`, `0.4`, `0.5`, `1`) our menus carry today.
 */
export const SUPERSEDED_TRACKING = {
  em: [0.03, 0.04, 0.08, 0.12, 0.14, 0.18, 0.2, 0.22, 0.24],
  px: [0, 0.3, 0.4, 0.5, 1],
} as const;

/**
 * `em` → PixiJS pixels. The handoff speaks CSS `em`; `TextStyle.letterSpacing`
 * is **pixels**, which is why the current menus carry a flat `0.5` everywhere
 * instead of a scale. Always spell tracking as `trackingPx(TRACKING.label, 13)`
 * rather than a bare number, so a size change carries its tracking with it.
 */
export function trackingPx(em: number, fontSizePx: number): number {
  return em * fontSizePx;
}

// ---------------------------------------------------------------------------
// 3. Beam metrics — the frame every screen in the set shares
// ---------------------------------------------------------------------------

/**
 * The shared frame: *"Type, spacing and beam treatment are consistent across all
 * five screens: 44px margins, 92px header/footer beams."* Values are px at the
 * handoff's 1280×720 reference; a screen scales them, but never re-picks them.
 *
 * The handoff's own title screen still draws a 100px header and a 72px footer —
 * the last of the drift. **92 is the number**, both ends, all five screens.
 */
export interface BeamStop {
  readonly color: number;
  readonly alpha: number;
  /** Where this stop sits, 0 at the beam's top edge and 1 at its bottom. */
  readonly at: number;
}

/** Header fill stops: colour + alpha at 0% / 62% / 100% of the beam height. */
const HEADER_STOPS: readonly BeamStop[] = [
  { color: MATERIAL_SHADES.ruleDeep, alpha: 0.97, at: 0 },
  { color: MATERIAL_SHADES.beamMid, alpha: 0.72, at: 0.62 },
  { color: MATERIAL_SHADES.faceInertShade, alpha: 0.12, at: 1 },
];

/** Footer fill stops: the header inverted — near-transparent at the top. */
const FOOTER_STOPS: readonly BeamStop[] = [
  { color: MATERIAL_SHADES.beamFoot, alpha: 0.1, at: 0 },
  { color: MATERIAL_SHADES.beamFootDeep, alpha: 0.96, at: 0.7 },
  { color: MATERIAL_SHADES.beamFootDeep, alpha: 0.96, at: 1 },
];

export const BEAM = {
  /** Left/right margin, and the beams' own horizontal padding. */
  margin: 44,
  /** Header and footer beam height. Superseded: the title screen's 100 / 72. */
  height: 92,
  /** Gap between a beam and the content band, so content starts at 120 from the edge. */
  gutter: 28,
  /** The 1px lit edge along the top of the header beam — white, centre-peaked. */
  litEdge: { width: 1, color: WHITE, alpha: 0.3 },
  /** The 2px Bone rule under the header / over the footer, held between 12% and 88%. */
  rule: { width: 2, color: BONE.lo, plateau: 0.12 },
  headerStops: HEADER_STOPS,
  footerStops: FOOTER_STOPS,
  /** Flat bands a beam's fill is stepped into. See the banding note on {@link drawPlate}. */
  bands: 8,
} as const;

/** Top edge of the content band — below the header beam and its gutter. */
export function contentTop(): number {
  return BEAM.height + BEAM.gutter;
}

/** Height of the content band between the two beams, on a screen `height` px tall. */
export function contentHeight(height: number): number {
  return Math.max(0, height - 2 * (BEAM.height + BEAM.gutter));
}

/**
 * The 4px bar down a row's left edge. On the lobby and ship-select rows this is
 * where **identity colour** lives — *"identity colours live on the row bar and
 * P-number only, never as a background wash — that was making identity read as
 * chrome"*. The bar is a plain rect the screen fills itself, because the colour
 * in it is a player's, not a material.
 */
export const ROW_BAR_WIDTH = 4;

// ---------------------------------------------------------------------------
// 4. Rivets — where plates meet
// ---------------------------------------------------------------------------

/**
 * A rivet head: a 6px disc in half-shaded steel with a 1px lit cap on top (the
 * handoff's `inset 0 1px 0`). Rivets go in **pairs**, inset 20px from the beam's
 * end and 14px from its top edge — a fastener, not a decoration, so they sit
 * where two pieces of hardware would actually be bolted together.
 */
export const RIVET = {
  diameter: 6,
  radius: 3,
  /** Gap between the two heads of a cluster. */
  gap: 9,
  /** Centre-to-centre spacing (`diameter + gap`). */
  pitch: 15,
  /** Heads per cluster. */
  perCluster: 2,
  /** Inset from the beam's left/right end to the first head's left edge. */
  inset: 20,
  /** Inset from the beam's top edge to the head's top. */
  top: 14,
  /** How far the body sits below the lit cap, leaving a 1px crescent. */
  capInset: 0.5,
  cap: { color: WHITE, alpha: 0.34 },
  body: { color: MATERIAL_SHADES.rivetBody, alpha: 1 },
} as const;

// ---------------------------------------------------------------------------
// 5. Motion
// ---------------------------------------------------------------------------

/** The handoff's transitions. One duration for controls, one for the wheel. */
export const PLATE_MOTION = {
  /** Hover / press on any plate: `90ms ease-out`. */
  controlMs: 90,
  /** The build wheel's selection sweep: `140ms cubic-bezier(.2,.7,.2,1)`. */
  wheelMs: 140,
  wheelEasing: [0.2, 0.7, 0.2, 1],
} as const;

// ---------------------------------------------------------------------------
// 6. The plate
// ---------------------------------------------------------------------------

/**
 * The three plate roles. There are three because a screen only ever needs to say
 * three things: *this is the action*, *this is also actionable*, *this is a
 * surface*. Anything a fourth role would express is a {@link PlateScale}.
 */
export type PlateRole =
  /** The screen's one headline action — PLAY, RUSH!. The brightest plate, and there is only one. */
  | 'primary'
  /** Everything else the player can act on now — JOIN BY CODE, SETTINGS, BACK, a chip. */
  | 'secondary'
  /** A surface that holds content rather than inviting a press — a settings row, an unselected ship. */
  | 'inert';

/** Rest / hover / press. Applied as a value operation on the whole material. */
export type PlateState = 'rest' | 'hover' | 'press';

/** Plate sizes. Scale picks the geometry; role picks the material. */
export type PlateScale =
  /** 80px, chamfer 26 — the one hero action on the title screen. */
  | 'hero'
  /** 72px (also 64px), chamfer 22 — menu rows, RUSH!. */
  | 'standard'
  /** 56px (also 60px), chamfer 18 — footer actions, BACK. */
  | 'compact'
  /** 28px (also 40px), no chamfer, 1px bezel — T-chips, OPEN, segmented values. */
  | 'chip';

/** A colour + alpha the primitives hand straight to `Graphics.fill`. Frozen. */
export interface PlatePaint {
  readonly color: number;
  readonly alpha: number;
}

/** The geometry of a plate at one scale. All px at the 1280×720 reference. */
export interface PlateGeometry {
  /** Reference height. A screen may stretch a plate; the chamfer does not follow. */
  readonly height: number;
  /** The "gantry" corner cut — top-right and bottom-left only. Never all four. */
  readonly chamfer: number;
  /** The face's own chamfer, one px tighter than the outer (the handoff's optical choice). */
  readonly innerChamfer: number;
  /** Bezel band width — the lit top edge and shadowed under-line live in it. */
  readonly bezel: number;
  /** Horizontal padding from the face edge to the first content. */
  readonly padX: number;
  /** The accent tick's width and height; height 0 means the scale carries no tick. */
  readonly tickWidth: number;
  readonly tickHeight: number;
}

/**
 * The four scales, read out of the handoff. Where a scale is drawn at two
 * heights in the file, the taller is the reference and the shorter is noted.
 */
export const PLATE_SCALES = {
  hero: { height: 80, chamfer: 26, innerChamfer: 25, bezel: 2, padX: 32, tickWidth: 3, tickHeight: 38 },
  standard: { height: 72, chamfer: 22, innerChamfer: 21, bezel: 2, padX: 32, tickWidth: 3, tickHeight: 30 },
  compact: { height: 56, chamfer: 18, innerChamfer: 17, bezel: 2, padX: 24, tickWidth: 3, tickHeight: 24 },
  chip: { height: 28, chamfer: 0, innerChamfer: 0, bezel: 1, padX: 14, tickWidth: 0, tickHeight: 0 },
} as const satisfies Record<PlateScale, PlateGeometry>;

/**
 * Everything {@link drawPlate} paints, for one (role, state). Built once at
 * module load and frozen — {@link plateMaterial} hands back the same instance
 * every time, so drawing a plate allocates nothing.
 */
export interface PlateMaterial {
  readonly role: PlateRole;
  readonly state: PlateState;
  /** Which size family this material states the role at. */
  readonly family: PlateFamily;
  /**
   * Whether the plate wears the gantry corner cut. A *raised* plate is chamfered;
   * a surface is square — the handoff draws every settings row and every ship row
   * with plain corners, and cuts only the plates that stand off the screen.
   */
  readonly chamfered: boolean;
  /** The bezel's lit top edge. `null` on a role that carries a 1px rule instead. */
  readonly bezelLit: PlatePaint | null;
  /** The shadowed under-line along the bottom of the bezel. */
  readonly bezelShadow: PlatePaint | null;
  /**
   * The bezel as it is actually painted: `bezelLit` → `bezelShadow` stepped down
   * the plate, so the lit top edge, the shaded sides and the shadowed under-line
   * are one continuous piece of metal rather than three decisions.
   */
  readonly bezelBands: readonly PlatePaint[];
  /** The 1px rule that bounds a plate with no bezel. `null` when there is a bezel. */
  readonly rule: PlatePaint | null;
  /** The face's body gradient, stepped lit → shaded across the plate. */
  readonly faceBands: readonly PlatePaint[];
  /** The inner sheen, stepped top-down. Empty when the role carries none. */
  readonly sheenBands: readonly PlatePaint[];
  /** Fraction of the face height the sheen fades over. */
  readonly sheenStop: number;
  /** Cast-shadow bands, outermost (faintest) first. Empty when the plate casts none. */
  readonly shadowBands: readonly PlatePaint[];
  /** How far the cast shadow drops below the plate. */
  readonly shadowOffsetY: number;
  /** How far the cast shadow spreads past the plate's edge. */
  readonly shadowSpread: number;
  /** The 3px accent tick inside the face. `null` when the role carries none. */
  readonly tick: PlatePaint | null;
  /** How far a press sinks the plate. */
  readonly offsetY: number;
}

// --- banding -----------------------------------------------------------------
//
// PixiJS Graphics has no cheap gradient, so every gradient in the handoff is
// expressed here as flat bands — the same technique the sprites already use, and
// it batches. Two rules make banding invisible rather than merely cheap:
//
//  1. **Bands nest, they never abut.** Two adjacent polygons sharing an edge
//     antialias against each other and leave a visible seam at every joint. So
//     each band is drawn over the whole remainder of the shape rather than over
//     its own strip, and only the *last* band drawn shows in each strip. There
//     are no shared edges anywhere in a plate.
//  2. **Translucent bands carry the increment, not the target.** A nested
//     translucent band composites over the ones beneath it, so its alpha is
//     solved backwards from the coverage the strip is supposed to end up with
//     (see {@link nestedAlphas}). Painting `peak / count` per band instead is
//     how a stepped shadow ends up looking thin and a stepped sheen looking dirty.

/** Flat bands a plate face's body gradient is stepped into. */
export const FACE_BANDS = 24;
/** Flat bands the inner sheen is stepped into. */
export const SHEEN_BANDS = 12;
/**
 * Flat bands the bezel's own top-to-bottom gradient is stepped into. The bezel
 * is only `bezel` px wide, so all a plate ever shows of this ramp is its lit
 * first band along the top, its shadowed last band along the under-line, and the
 * steps in between down each side — which is exactly the CSS gradient's read.
 */
export const BEZEL_BANDS = 8;
/**
 * Flat bands a cast shadow is stepped into. High, because a shadow's falloff is
 * the one place a step *does* show — it lands on the bare void with nothing to
 * hide in.
 */
export const FALLOFF_BANDS = 12;

// --- role definitions --------------------------------------------------------
//
// A role is defined twice: once at plate size and once at chip size. That is not
// two dialects of one role — it is the same role stated at the size it is
// actually drawn at. The handoff builds its chips out of brighter metal than its
// plates (#262e38 against #1e242c) for a physical reason: a 28px control has a
// tenth of a menu row's area to carry the same read, and it wears a bright
// hairline instead of a 2px bezel because a bezel would eat it. Hover, press and
// the accent ramp are identical, so a chip is still a plate.

/** The visual half of a role — the part that differs between plate and chip size. */
interface MaterialSpec {
  readonly bezelLit: number | null;
  readonly bezelShadow: number | null;
  readonly rule: number | null;
  readonly faceLit: number;
  readonly faceShade: number;
  readonly sheenAlpha: number;
  readonly sheenStop: number;
  readonly shadowAlpha: number;
  readonly shadowOffsetY: number;
  readonly shadowSpread: number;
  /** Hover deepens and widens the shadow — the handoff's `0 14px 40px`. */
  readonly hoverShadowOffsetY: number;
  readonly hoverShadowSpread: number;
  readonly tick: number | null;
}

interface RoleSpec {
  readonly chamfered: boolean;
  readonly pressOffsetY: number;
  readonly hoverBrightness: number;
  readonly pressBrightness: number;
  /** hero / standard / compact. */
  readonly plate: MaterialSpec;
  /** chip — a bordered control, no bezel and no cast shadow. */
  readonly chip: MaterialSpec;
}

/** A chip of any role: bordered, flat on the panel, sheen at 46%. */
function chipSpec(rule: number, faceLit: number, faceShade: number, sheenAlpha: number): MaterialSpec {
  return {
    bezelLit: null,
    bezelShadow: null,
    rule,
    faceLit,
    faceShade,
    sheenAlpha,
    sheenStop: 0.46,
    shadowAlpha: 0,
    shadowOffsetY: 0,
    shadowSpread: 0,
    hoverShadowOffsetY: 0,
    hoverShadowSpread: 0,
    tick: null,
  };
}

const ROLE_SPECS: Record<PlateRole, RoleSpec> = {
  // The PLAY / RUSH! plate: a white-to-bone bezel over a bone-filled face. It is
  // the brightest thing on the screen, and that brightness *is* the accent.
  primary: {
    chamfered: true,
    pressOffsetY: 2,
    hoverBrightness: 1.16,
    pressBrightness: 0.94,
    plate: {
      bezelLit: BONE.hi,
      bezelShadow: BONE.lo,
      rule: null,
      faceLit: BONE.fill,
      faceShade: MATERIAL_SHADES.facePrimaryShade,
      sheenAlpha: 0.2,
      sheenStop: 0.44,
      shadowAlpha: 0.6,
      shadowOffsetY: 12,
      shadowSpread: 34,
      hoverShadowOffsetY: 14,
      hoverShadowSpread: 40,
      tick: BONE.hi,
    },
    // TEAMS, SOUND ON — the selected chip. Bone-bordered, brightest metal.
    chip: chipSpec(BONE.mid, MATERIAL_SHADES.chipPrimaryLit, MATERIAL_SHADES.chipPrimaryShade, 0.16),
  },
  // JOIN BY CODE / SETTINGS / BACK: the same material one ramp step down, with
  // a shallower drop. Fully active — never the disabled costume.
  secondary: {
    chamfered: true,
    pressOffsetY: 2,
    hoverBrightness: 1.3,
    pressBrightness: 0.95,
    plate: {
      bezelLit: MATERIAL_SHADES.bezelLit,
      bezelShadow: MATERIAL_SHADES.bezelShadow,
      rule: null,
      faceLit: MATERIAL_SHADES.faceLit,
      faceShade: MATERIAL_SHADES.faceShade,
      sheenAlpha: 0.07,
      sheenStop: 0.4,
      shadowAlpha: 0.4,
      shadowOffsetY: 8,
      shadowSpread: 22,
      hoverShadowOffsetY: 10,
      hoverShadowSpread: 26,
      tick: MATERIAL_SHADES.tickSteel,
    },
    // T1, OPEN — an actionable chip, bordered in the low Bone step.
    chip: chipSpec(BONE.lo, MATERIAL_SHADES.chipFaceLit, MATERIAL_SHADES.chipFaceShade, 0.14),
  },
  // A settings row, an unselected ship: a surface. No bezel, no cast shadow — a
  // 1px rule and the faintest sheen, so it reads as *held down on the panel*
  // rather than raised off it.
  inert: {
    chamfered: false,
    pressOffsetY: 1,
    hoverBrightness: 1.3,
    pressBrightness: 1,
    plate: {
      bezelLit: null,
      bezelShadow: null,
      rule: MATERIAL_SHADES.rulePlate,
      faceLit: MATERIAL_SHADES.faceLit,
      faceShade: MATERIAL_SHADES.faceInertShade,
      sheenAlpha: 0.06,
      sheenStop: 0.38,
      shadowAlpha: 0,
      shadowOffsetY: 0,
      shadowSpread: 0,
      hoverShadowOffsetY: 0,
      hoverShadowSpread: 0,
      tick: null,
    },
    // A settings segmented value — the same metal as an actionable chip behind
    // the brightest hairline, which is what says "this is the current setting".
    chip: chipSpec(MATERIAL_SHADES.ruleLit, MATERIAL_SHADES.chipFaceLit, MATERIAL_SHADES.chipFaceShade, 0.14),
  },
};

/**
 * A hover/press brightness step. Scaling all three channels by one factor is the
 * most conservative value operation there is — the channel *ratios*, and so the
 * hue, are preserved exactly, which is stricter than a mix toward white would
 * be. This is what CSS `filter: brightness()` does, and it keeps a brightened
 * plate on the same ramp point it started from.
 */
export function brightness(color: number, factor: number): number {
  if (factor === 1) return color;
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function paint(color: number, alpha: number): PlatePaint {
  return Object.freeze({ color, alpha });
}

function bandRamp(from: number, to: number, count: number, factor: number, alpha = 1): readonly PlatePaint[] {
  const out: PlatePaint[] = [];
  for (let i = 0; i < count; i++) {
    // Sample each band at its centre, so the ramp's ends stay true.
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    out.push(paint(brightness(mixChannels(from, to, t), factor), alpha));
  }
  return Object.freeze(out);
}

function mixChannels(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * t);
  const bl = Math.round(ab + ((b & 0xff) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Solve the per-band alpha for a set of **nested** translucent bands, given the
 * coverage each successive band should leave behind it. Band `i` paints over
 * everything bands `0..i-1` already laid down, so its own alpha is the increment
 * that carries the accumulated coverage from the previous target to this one.
 *
 * `targets` must ascend. Painting `peak / count` per band instead is how a
 * stepped shadow ends up looking thin and a stepped sheen looking dirty.
 */
function nestedAlphas(color: number, targets: readonly number[]): readonly PlatePaint[] {
  const out: PlatePaint[] = [];
  let covered = 0;
  for (const target of targets) {
    if (target <= covered || covered >= 1) continue;
    out.push(paint(color, (target - covered) / (1 - covered)));
    covered = target;
  }
  return Object.freeze(out);
}

/**
 * The inner sheen's coverage targets, outermost (the whole sheen band, faintest)
 * to innermost (the top strip, at `peak`). A linear fade down the sheen height.
 */
function sheenTargets(peak: number, count: number): number[] {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(peak * (1 - (i + 0.5) / count));
  return out;
}

/**
 * A cast shadow's coverage targets, outermost to innermost.
 *
 * A CSS `box-shadow: 0 Ypx Bpx rgba(c, A)` is the plate's silhouette blurred by
 * `B`, and a blurred edge sits at **half** the nominal alpha — the other half of
 * the energy has spread inward under the plate, where nothing can see it. So the
 * shadow reaches `A / 2` where it meets the plate and decays quadratically to
 * nothing at `B` out, which is a close enough stand-in for a Gaussian tail and a
 * great deal closer than a linear ramp to `A`.
 */
function shadowTargets(peak: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const outward = (count - i) / count; // 1 at the outer edge, 1/count at the plate
    out.push(peak * 0.5 * (1 - outward) * (1 - outward));
  }
  return out;
}

/** The two size families a role is stated at. `chip` is the odd one out. */
export type PlateFamily = 'plate' | 'chip';

/** Which family a scale belongs to. Only `chip` is a chip. */
export function plateFamily(scale: PlateScale): PlateFamily {
  return scale === 'chip' ? 'chip' : 'plate';
}

function buildMaterial(role: PlateRole, state: PlateState, family: PlateFamily): PlateMaterial {
  const r = ROLE_SPECS[role];
  const s = r[family];
  const f = state === 'hover' ? r.hoverBrightness : state === 'press' ? r.pressBrightness : 1;
  // Hover lifts the plate off the screen rather than lighting it up: the handoff
  // deepens the drop from `0 12px 34px` to `0 14px 40px` on the same hover that
  // brightens the metal. That widening is the whole hover cue here, because the
  // bloom the handoff pairs it with is not something Cold Vacuum can spend
  // (tokens.ts GLOW) — see the note on `drawPlate`.
  const hover = state === 'hover';
  return Object.freeze({
    role,
    state,
    family,
    // A chip is square whatever its role: the gantry cut needs room the chip
    // does not have, which is why the handoff draws chips with plain corners.
    chamfered: family === 'chip' ? false : r.chamfered,
    bezelLit: s.bezelLit === null ? null : paint(brightness(s.bezelLit, f), 1),
    bezelShadow: s.bezelShadow === null ? null : paint(brightness(s.bezelShadow, f), 1),
    bezelBands:
      s.bezelLit === null || s.bezelShadow === null
        ? Object.freeze([])
        : bandRamp(s.bezelLit, s.bezelShadow, BEZEL_BANDS, f),
    rule: s.rule === null ? null : paint(brightness(s.rule, f), 1),
    faceBands: bandRamp(s.faceLit, s.faceShade, FACE_BANDS, f),
    sheenBands: nestedAlphas(WHITE, sheenTargets(s.sheenAlpha, SHEEN_BANDS)),
    sheenStop: s.sheenStop,
    // The cast shadow does not brighten with the plate — a light does not move
    // because a cursor did. Vacuum stands in for the handoff's pure black: it is
    // the darkest colour we own, and it is the colour of what the shadow falls on.
    shadowBands: nestedAlphas(PALETTE.vacuum, shadowTargets(s.shadowAlpha, FALLOFF_BANDS)),
    shadowOffsetY: hover ? s.hoverShadowOffsetY : s.shadowOffsetY,
    shadowSpread: hover ? s.hoverShadowSpread : s.shadowSpread,
    tick: s.tick === null ? null : paint(brightness(s.tick, f), 1),
    offsetY: state === 'press' ? r.pressOffsetY : 0,
  });
}

const ROLES: readonly PlateRole[] = ['primary', 'secondary', 'inert'];
const STATES: readonly PlateState[] = ['rest', 'hover', 'press'];
const FAMILIES: readonly PlateFamily[] = ['plate', 'chip'];

const MATERIALS_BY_KEY: Record<string, PlateMaterial> = {};
for (const role of ROLES) {
  for (const state of STATES) {
    for (const family of FAMILIES) MATERIALS_BY_KEY[`${role}:${state}:${family}`] = buildMaterial(role, state, family);
  }
}

/**
 * The resolved material for a (role, state, family). Returns the **same frozen
 * object** on every call — eighteen of them exist, all built at module load — so
 * a view can cache by identity and a draw never allocates.
 */
export function plateMaterial(
  role: PlateRole,
  state: PlateState = 'rest',
  family: PlateFamily = 'plate',
): PlateMaterial {
  return MATERIALS_BY_KEY[`${role}:${state}:${family}`]!;
}

// ---------------------------------------------------------------------------
// 7. Drawing
// ---------------------------------------------------------------------------

/**
 * The slice of PixiJS `Graphics` these primitives use. `Graphics` satisfies it
 * structurally, so a view passes its own straight in and this module never
 * imports PixiJS — which is what keeps `src/art/` testable without a canvas.
 */
export interface PlateCanvas {
  poly(points: number[], close?: boolean): void;
  circle(x: number, y: number, radius: number): void;
  /**
   * **Must consume `style` synchronously.** These primitives hand the same
   * mutable object to every fill so a draw allocates nothing; `Graphics.fill`
   * copies its input into the geometry immediately, which is what makes that
   * safe. A test recorder must copy the object rather than retain it.
   */
  fill(style: { color: number; alpha: number }): void;
}

// Two scratch polygons, ping-ponged through the two chamfer clips, and one
// scratch fill style. Reused for every shape of every plate — this is why a draw
// allocates nothing.
const PA: number[] = [];
const PB: number[] = [];
const FILL = { color: 0, alpha: 1 };

/**
 * How far abutting bands overlap. Only the beam needs it — everything else
 * nests — but a shared edge at a fractional coordinate antialiases on both
 * sides and leaves a hairline of whatever is underneath showing through.
 */
const BAND_OVERLAP = 0.5;

function fillWith(canvas: PlateCanvas, color: number, alpha: number): void {
  FILL.color = color;
  FILL.alpha = alpha;
  canvas.fill(FILL);
}

/**
 * Sutherland–Hodgman clip of a convex polygon against the half-plane
 * `sign * ((x - y) - d) <= 0`. Both chamfer cuts are half-planes on `x - y`,
 * which is why a chamfered plate needs no path-building at all.
 */
function clipHalf(src: number[], dst: number[], sign: number, d: number): void {
  dst.length = 0;
  const n = src.length / 2;
  if (n === 0) return;
  let px = src[2 * (n - 1)]!;
  let py = src[2 * (n - 1) + 1]!;
  let pf = -sign * (px - py - d);
  for (let i = 0; i < n; i++) {
    const qx = src[2 * i]!;
    const qy = src[2 * i + 1]!;
    const qf = -sign * (qx - qy - d);
    if (qf >= 0) {
      if (pf < 0) {
        const t = pf / (pf - qf);
        dst.push(px + (qx - px) * t, py + (qy - py) * t);
      }
      dst.push(qx, qy);
    } else if (pf >= 0) {
      const t = pf / (pf - qf);
      dst.push(px + (qx - px) * t, py + (qy - py) * t);
    }
    px = qx;
    py = qy;
    pf = qf;
  }
}

/**
 * Fill the box `(bx, by, bw, bh)` cut back to a chamfer described by the two
 * diagonals `d1` (top-right cut) and `d2` (bottom-left cut). Passing a sub-box
 * of a plate's face yields exactly that band of the face, chamfer and all —
 * which is how the body gradient and the sheen stay inside the silhouette.
 */
function fillChamfered(
  canvas: PlateCanvas,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  d1: number,
  d2: number,
  color: number,
  alpha: number,
): void {
  if (bw <= 0 || bh <= 0 || alpha <= 0) return;
  PA.length = 0;
  PA.push(bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh);
  clipHalf(PA, PB, 1, d1);
  clipHalf(PB, PA, -1, d2);
  if (PA.length < 6) return;
  canvas.poly(PA, true);
  fillWith(canvas, color, alpha);
}

/** Fill an axis-aligned box with no corner cut at all. */
function fillBox(
  canvas: PlateCanvas,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  color: number,
  alpha: number,
): void {
  if (bw <= 0 || bh <= 0 || alpha <= 0) return;
  PA.length = 0;
  PA.push(bx, by, bx + bw, by, bx + bw, by + bh, bx, by + bh);
  canvas.poly(PA, true);
  fillWith(canvas, color, alpha);
}

/** The top-right cut's diagonal for a box with corner cut `c`. */
function cutTopRight(bx: number, by: number, bw: number, c: number): number {
  return bx + bw - c - by;
}

/** The bottom-left cut's diagonal for a box with corner cut `c`. */
function cutBottomLeft(bx: number, by: number, bh: number, c: number): number {
  return bx - (by + bh - c);
}

/**
 * Draw one plate: cast shadow, bezel (lit top edge + shadowed under-line), face,
 * inner sheen, accent tick. Everything the handoff's diagnosis names, in one
 * call, from one vocabulary — which is the point of this module.
 *
 * **One adaptation, and it is the only one in this file that drops something.**
 * The handoff gives a primary plate a `box-shadow: 0 0 26px` bloom, widening to
 * `46px` on hover. Cold Vacuum forbids exactly that: `tokens.ts` GLOW is *"no
 * bloom — glow is a brighter inner pass on a crisp silhouette, never a gaussian
 * blur"*, and a stepped stand-in for it read as a grey slab behind the plate
 * rather than as light. So there is no halo. A primary is already the brightest
 * plate on the screen by construction, and its hover cue is the handoff's own
 * `0 12px 34px` → `0 14px 40px`: it lifts further off the screen instead of
 * lighting up the void around it.
 *
 * ```ts
 * plate.clear();
 * drawPlate(plate, r.x, r.y, r.width, r.height, 'primary', 'hero', hovered ? 'hover' : 'rest');
 * ```
 *
 * `x`/`y`/`width`/`height` are the plate's *outer* box; the press offset is
 * applied inside, so a caller never moves the rect itself. Allocates nothing.
 * Call it when the state changes, not every frame.
 */
export function drawPlate(
  canvas: PlateCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  role: PlateRole,
  scale: PlateScale,
  state: PlateState = 'rest',
): void {
  if (width <= 0 || height <= 0) return;
  const m = plateMaterial(role, state, plateFamily(scale));
  const g = PLATE_SCALES[scale];
  // A raised plate is chamfered, a surface is square; and the cut can never eat
  // more than half the plate, however small a screen shrinks it.
  const c = m.chamfered ? Math.min(g.chamfer, Math.min(width, height) / 2) : 0;
  const py = y + m.offsetY;

  // 1. The cast shadow — the plate stands off the screen, so it drops one. The
  //    bands nest outermost-first and their alphas are already solved for that
  //    stacking (see shadowTargets), so the falloff reads as a soft edge rather
  //    than as concentric rectangles.
  for (let i = 0; i < m.shadowBands.length; i++) {
    const grow = (m.shadowSpread * (m.shadowBands.length - i)) / m.shadowBands.length;
    const bx = x - grow;
    const by = py + m.shadowOffsetY - grow;
    const bw = width + grow * 2;
    const bh = height + grow * 2;
    const band = m.shadowBands[i]!;
    fillChamfered(canvas, bx, by, bw, bh, cutTopRight(bx, by, bw, c), cutBottomLeft(bx, by, bh, c), band.color, band.alpha);
  }

  const d1 = cutTopRight(x, py, width, c);
  const d2 = cutBottomLeft(x, py, height, c);

  // 3. The bezel, lit at the top and shading to the under-line at the bottom.
  //    That lit top edge and shadowed under-line are the whole difference
  //    between a plate and the 1px outline it replaces. Bands nest downward, so
  //    the ring reads as one continuous bevel with no seam down its sides.
  const nb = m.bezelBands.length;
  for (let i = 0; i < nb; i++) {
    const by = py + (height * i) / nb;
    const band = m.bezelBands[i]!;
    fillChamfered(canvas, x, by, width, py + height - by, d1, d2, band.color, band.alpha);
  }
  // A bezel-less role is bounded by a 1px rule instead. Filling the whole box
  // and insetting the face by 1px leaves exactly that ring showing.
  if (m.rule) fillChamfered(canvas, x, py, width, height, d1, d2, m.rule.color, m.rule.alpha);

  // 4. The face, inset inside the bezel (or inside the 1px rule).
  const inset = m.rule ? 1 : g.bezel;
  const fx = x + inset;
  const fy = py + inset;
  const fw = width - inset * 2;
  const fh = height - inset * 2;
  if (fw <= 0 || fh <= 0) return;
  const ic = m.chamfered ? Math.min(g.innerChamfer, Math.min(fw, fh) / 2) : 0;
  const fd1 = cutTopRight(fx, fy, fw, ic);
  const fd2 = cutBottomLeft(fx, fy, fh, ic);

  // The body gradient runs lit → shaded across the plate (the handoff's 100deg,
  // which on a wide plate is all but horizontal). Each opaque band covers the
  // whole remainder of the face to the right rather than just its own strip, so
  // no two bands ever share an edge to antialias a seam along.
  const bandW = fw / m.faceBands.length;
  for (let i = 0; i < m.faceBands.length; i++) {
    const bx = fx + i * bandW;
    const band = m.faceBands[i]!;
    fillChamfered(canvas, bx, fy, fx + fw - bx, fh, fd1, fd2, band.color, band.alpha);
  }

  // 5. The inner sheen: white, fading out down the top of the face. This is the
  //    lit-from-above cue, and it is what a primary has that a surface has not.
  //    Nested the other way — faintest and tallest first, so each band's own
  //    alpha only has to carry the increment (see sheenTargets).
  const sheenH = fh * m.sheenStop;
  const n = m.sheenBands.length;
  for (let i = 0; i < n; i++) {
    const band = m.sheenBands[i]!;
    fillChamfered(canvas, fx, fy, fw, (sheenH * (n - i)) / n, fd1, fd2, band.color, band.alpha);
  }

  // 6. The accent tick — the 3px bar at the head of the plate's content.
  if (m.tick && g.tickHeight > 0 && g.tickWidth > 0) {
    const th = Math.min(g.tickHeight, fh);
    fillBox(canvas, fx + g.padX, fy + (fh - th) / 2, g.tickWidth, th, m.tick.color, m.tick.alpha);
  }
}

/**
 * Draw one rivet head centred on `(cx, cy)`: the lit cap, then the body dropped
 * {@link RIVET.capInset} px so a 1px crescent of light survives along the top.
 */
export function drawRivet(canvas: PlateCanvas, cx: number, cy: number): void {
  canvas.circle(cx, cy, RIVET.radius);
  fillWith(canvas, RIVET.cap.color, RIVET.cap.alpha);
  canvas.circle(cx, cy + RIVET.capInset, RIVET.radius - RIVET.capInset);
  fillWith(canvas, RIVET.body.color, RIVET.body.alpha);
}

/**
 * Draw a cluster of rivets running right from `(x, y)` — the coordinates of the
 * first head's **top-left corner**, matching the handoff's `left: 20px;
 * top: 14px` inside a beam. Use {@link beamRivetX} / {@link beamRivetY} to place
 * one against a beam without re-deriving the insets.
 */
export function drawRivetCluster(canvas: PlateCanvas, x: number, y: number, count = RIVET.perCluster): void {
  for (let i = 0; i < count; i++) {
    drawRivet(canvas, x + i * RIVET.pitch + RIVET.radius, y + RIVET.radius);
  }
}

/** Left edge of a beam's leading rivet cluster, for a beam starting at `beamX`. */
export function beamRivetX(beamX: number): number {
  return beamX + RIVET.inset;
}

/**
 * Left edge of a beam's trailing rivet cluster, for a beam of `width` starting
 * at `beamX`. Mirrors the leading cluster about the beam's centre.
 */
export function beamRivetTrailingX(beamX: number, width: number, count = RIVET.perCluster): number {
  return beamX + width - RIVET.inset - (count * RIVET.pitch - RIVET.gap);
}

/** Top edge of a beam's rivet cluster, for a beam whose top edge is `beamY`. */
export function beamRivetY(beamY: number): number {
  return beamY + RIVET.top;
}

// ---------------------------------------------------------------------------
// 8. The build wheel — TWO profiles of one look (u7-02)
// ---------------------------------------------------------------------------
//
// The handoff draws the build wheel once, at 1280×720, at an outer radius of
// 235 px. Verified before this table was written: the file has **no `@media`
// query, no viewport meta and no occurrence of the words mobile, touch, phone or
// portrait** — its metrics are one desktop sample of the look, not the look
// itself. The wheel is the sharpest case in the set, because unlike a menu it is
// a radial control operated by a thumb over a live fight: at 390 px the whole
// wheel is 280 px across, and the handoff's 17/12/20/12 px type stack does not
// fit inside a 72° wedge at that size.
//
// So the look is stated **twice** — once at the radius the handoff drew it, once
// at the radius a 390 px phone gives it — and {@link wheelMetrics} interpolates
// between them for every radius in between. The desktop column is the handoff's
// own numbers, verbatim; the phone column is derived, and every number that is
// NOT a pure scale of its desktop twin is marked `⤺` with the reason.
//
// Why not simply scale? A radial menu shrinks in two dimensions but its text
// only shrinks in one, and the arc a wedge's words sit in shrinks faster than
// the words do. Pure scaling of the desktop column at 140/235 = 0.596 gives a
// 7.2 px target line and a 7.2 px cap count — under the 12 px legibility floor
// style-guide §7 sets for Oxanium, and unreadable under a thumb. The phone
// column therefore floors the type and buys the room back from the gaps, the
// label inset, and the two-word copy (see {@link WheelCopyScale}).

/**
 * How much room a wedge's words have, which decides which copy they carry.
 *
 *  - `full` — the handoff's own copy: `YOUR STATION`, `2 / 4 BUILT`.
 *  - `compact` — the same lines with the padding words gone: `STATION`,
 *    `2/4 BUILT`. Nothing is *dropped* — a wedge still names its target and
 *    still shows its count, because GDD §2.5 makes both load-bearing — it is
 *    said in fewer characters, which is the only lever a fixed arc leaves.
 */
export type WheelCopyScale = 'full' | 'compact';

/** One profile of the build wheel's look. All px at that profile's own
 *  {@link WheelProfile.radius}; fractions are of that radius. */
export interface WheelProfile {
  /** The outer-ring radius this profile's px are stated at. */
  readonly radius: number;
  /** Hub disc radius, as a fraction of the outer radius. The wedge ring starts
   *  here, so it is also the inner edge of a wedge. */
  readonly hub: number;
  /** Gap between the outer edge and the top of a wedge's word stack, as a
   *  fraction of the outer radius. */
  readonly labelInset: number;
  /** The wedge's own name — Audiowide, the one display face on the wheel. */
  readonly name: number;
  /** The target line ("YOUR STATION") — Oxanium, `TRACKING.label`. */
  readonly sub: number;
  /** The `cost/held` numeral — Oxanium, the wheel's one number. */
  readonly cost: number;
  /** The count/cap line ("2 / 4 BUILT") and repair's effect line — Oxanium. */
  readonly detail: number;
  /** Leading below the name / the target line / the cost, px. */
  readonly gapName: number;
  readonly gapSub: number;
  readonly gapCost: number;
  /** The hub's live ore total, its `ORE` caption, and its BACK word. */
  readonly hubOre: number;
  readonly hubCaption: number;
  readonly hubBack: number;
  /** Width of the hairline rule between the hub's caption and its BACK word. */
  readonly hubRule: number;
  /** The 2 px ring that bounds the disc, and the hub's own ring. */
  readonly ring: number;
  /** The faint halo ring outside the disc, and how far out it sits. */
  readonly haloRing: number;
  readonly haloOffset: number;
  /** The hairline spokes between wedges. */
  readonly spoke: number;
  /** The index diamond at twelve o'clock — the wheel's "you are here" mark. */
  readonly detent: number;
  /** How far the inner vignette reaches in from the rim. */
  readonly vignette: number;
  /** Which copy the wedges carry at this size. */
  readonly copy: WheelCopyScale;
}

/**
 * The two profiles. `desktop` is read straight off the handoff's build-wheel
 * screen; `phone` is the same look re-derived for a 390 px-wide device, where
 * the wheel's radius is 140 px (`wheelRadius(844, 390)` — the play orientation).
 */
export const WHEEL_PROFILES = {
  /** The handoff, verbatim: 470 px disc, 150 px hub, 17/12/20/12 type. */
  desktop: {
    radius: 235,
    hub: 0.319, //  75 / 235
    labelInset: 0.094, //  22 / 235
    name: 17,
    sub: 12,
    cost: 20,
    detail: 12,
    gapName: 4,
    gapSub: 7,
    gapCost: 5,
    hubOre: 40,
    hubCaption: 12,
    hubBack: 12,
    hubRule: 38,
    ring: 2,
    haloRing: 1,
    haloOffset: 26,
    spoke: 1.5,
    detent: 8,
    vignette: 56,
    copy: 'full',
  },
  /**
   * 390 px wide, held in the play orientation: a 280 px wheel. Derived.
   *
   *  - `name` 12 ⤺ (scale would give 10.1) — Audiowide is the wedge's identity
   *    and the first thing a thumb reads; it takes the floor rather than the
   *    ramp, and long names wrap to two lines exactly as the handoff wraps
   *    `REPAIR / CORE`.
   *  - `sub` / `detail` 9 ⤺ (scale would give 7.2) — the size the shipped wheel
   *    already draws its second line at, so this is the proven floor rather than
   *    a new guess. Paired with `compact` copy, which is what actually buys the
   *    room: `STATION` is 7 characters where `YOUR STATION` is 12, and a wedge's
   *    words sit on a 72° arc that is only ~115 px wide at this radius.
   *  - `cost` 16 ⤺ (scale would give 11.9) — the cost is the one number on the
   *    wedge and the only thing on it that is read *while* a fight is running.
   *  - `labelInset` 0.06 ⤺ (scale-invariant would be 0.094) — the stack is
   *    proportionally taller at this size, so it starts closer to the rim, where
   *    the arc is widest, rather than centring in the ring.
   *  - `gapName/gapSub/gapCost` 2/3/2 ⤺ — leading is the cheapest thing to give
   *    back, and giving it back is what keeps a four-line stack inside a 95 px
   *    ring without shrinking a word.
   *  - `hubOre` 26 ⤺ (scale would give 23.8) — the hub number is the same
   *    "spendable" total the HUD prints; it holds its shipped size.
   *  - `vignette` 30, `detent` 6, `spoke` 1, `ring` 1.5 — geometry, scaled.
   */
  phone: {
    radius: 140,
    hub: 0.32,
    labelInset: 0.06,
    name: 12,
    sub: 9,
    cost: 16,
    detail: 9,
    gapName: 2,
    gapSub: 3,
    gapCost: 2,
    hubOre: 26,
    hubCaption: 9,
    hubBack: 9,
    hubRule: 26,
    ring: 1.5,
    haloRing: 1,
    haloOffset: 14,
    spoke: 1,
    detent: 6,
    vignette: 30,
    copy: 'compact',
  },
} as const satisfies Record<'desktop' | 'phone', WheelProfile>;

/**
 * The radius at or above which a wedge carries the handoff's `full` copy. Set
 * midway between the two profiles: below it the arc is closer to the phone's
 * than to the desktop's, and `YOUR STATION` is the first thing that stops
 * fitting on it.
 */
export const WHEEL_FULL_COPY_RADIUS = 188;

/**
 * The wheel's look at an arbitrary radius: the two profiles, interpolated, and
 * then re-scaled so that a radius past the desktop reference keeps growing with
 * the wheel rather than freezing at 235 px of type.
 *
 * Below the phone reference the numbers scale *down* with the radius, so a
 * viewport narrower than 390 px shrinks the look rather than overflowing it.
 */
export function wheelMetrics(radius: number): WheelProfile {
  const lo = WHEEL_PROFILES.phone;
  const hi = WHEEL_PROFILES.desktop;
  if (radius <= lo.radius) {
    const k = Math.max(0, radius) / lo.radius;
    return scaleWheelProfile(lo, k, radius);
  }
  if (radius >= hi.radius) {
    const k = radius / hi.radius;
    return scaleWheelProfile(hi, k, radius);
  }
  const t = (radius - lo.radius) / (hi.radius - lo.radius);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  return {
    radius,
    hub: mix(lo.hub, hi.hub),
    labelInset: mix(lo.labelInset, hi.labelInset),
    name: mix(lo.name, hi.name),
    sub: mix(lo.sub, hi.sub),
    cost: mix(lo.cost, hi.cost),
    detail: mix(lo.detail, hi.detail),
    gapName: mix(lo.gapName, hi.gapName),
    gapSub: mix(lo.gapSub, hi.gapSub),
    gapCost: mix(lo.gapCost, hi.gapCost),
    hubOre: mix(lo.hubOre, hi.hubOre),
    hubCaption: mix(lo.hubCaption, hi.hubCaption),
    hubBack: mix(lo.hubBack, hi.hubBack),
    hubRule: mix(lo.hubRule, hi.hubRule),
    ring: mix(lo.ring, hi.ring),
    haloRing: mix(lo.haloRing, hi.haloRing),
    haloOffset: mix(lo.haloOffset, hi.haloOffset),
    spoke: mix(lo.spoke, hi.spoke),
    detent: mix(lo.detent, hi.detent),
    vignette: mix(lo.vignette, hi.vignette),
    copy: radius >= WHEEL_FULL_COPY_RADIUS ? 'full' : 'compact',
  };
}

/** One profile scaled by `k`, for radii outside the two references. Fractions
 *  (`hub`, `labelInset`) and the copy scale are scale-invariant and do not move. */
function scaleWheelProfile(p: WheelProfile, k: number, radius: number): WheelProfile {
  return {
    radius,
    hub: p.hub,
    labelInset: p.labelInset,
    name: p.name * k,
    sub: p.sub * k,
    cost: p.cost * k,
    detail: p.detail * k,
    gapName: p.gapName * k,
    gapSub: p.gapSub * k,
    gapCost: p.gapCost * k,
    hubOre: p.hubOre * k,
    hubCaption: p.hubCaption * k,
    hubBack: p.hubBack * k,
    hubRule: p.hubRule * k,
    ring: p.ring * k,
    haloRing: p.haloRing * k,
    haloOffset: p.haloOffset * k,
    spoke: p.spoke * k,
    detent: p.detent * k,
    vignette: p.vignette * k,
    copy: radius >= WHEEL_FULL_COPY_RADIUS ? 'full' : 'compact',
  };
}

/**
 * The dark halo the wheel sits in, as coverage targets outermost-first — the
 * handoff's `radial-gradient(rgba(13,16,21,.7) 52%, transparent 78%)` on a box
 * inset by −120 px, i.e. a soft pool of void that reaches `peak` under the wheel
 * and is gone by 1.18× its radius.
 *
 * **This is the whole "no plates over gameplay" mechanism.** The wheel does not
 * get a rectangle; it gets a pool of darkness with no edge, so the fight it is
 * drawn over stays visible right up to the disc and the wheel still has
 * something to read against. A plate would give it a corner, and a corner is
 * what makes a HUD read as a panel.
 */
export const WHEEL_HALO = {
  /** Peak coverage, under the disc. */
  peak: 0.7,
  /** Where the falloff starts, as a multiple of the wheel radius. */
  holdTo: 0.79,
  /** Where it reaches zero, as a multiple of the wheel radius. */
  fadeTo: 1.18,
  /** Rings the falloff is stepped into. Bare void behind it, so it steps high. */
  bands: 14,
} as const;

/** Which end of the screen a beam frames. */
export type BeamKind = 'header' | 'footer';

/**
 * Draw a header or footer beam across `width`, from `(x, y)` at its top-left.
 *
 * A header carries, top to bottom: the 1px lit edge, the stepped fill, the 2px
 * Bone accent rule along its underside, and two rivet clusters. A footer is the
 * same beam inverted — the accent rule sits on top, the fill falls away
 * downward, and it wears no rivets (nothing is bolted to the bottom of a frame).
 *
 * Pass `rivets = false` on a screen whose header carries a control where the
 * fasteners would sit. Allocates nothing.
 */
export function drawBeam(
  canvas: PlateCanvas,
  x: number,
  y: number,
  width: number,
  kind: BeamKind,
  rivets = true,
): void {
  if (width <= 0) return;
  const h = BEAM.height;
  const stops = kind === 'header' ? BEAM.headerStops : BEAM.footerStops;
  const bandH = h / BEAM.bands;

  for (let i = 0; i < BEAM.bands; i++) {
    const t = (i + 0.5) / BEAM.bands;
    let lo = stops[0]!;
    let hi = stops[stops.length - 1]!;
    for (let s = 1; s < stops.length; s++) {
      if (t <= stops[s]!.at) {
        lo = stops[s - 1]!;
        hi = stops[s]!;
        break;
      }
    }
    const span = hi.at - lo.at;
    const k = span <= 0 ? 0 : (t - lo.at) / span;
    // A beam's bands cannot nest the way a plate's do — its gradient runs in
    // *alpha*, and stacking translucent bands would drive the far end opaque
    // instead of transparent. They abut, and overlap by a hair so the join has no
    // sub-pixel gap for the void to show through.
    const by = y + i * bandH;
    fillBox(canvas, x, by, width, bandH + BAND_OVERLAP, mixChannels(lo.color, hi.color, k), lo.alpha + (hi.alpha - lo.alpha) * k);
  }

  // The 1px lit edge along a header's top: white, peaking at the centre and
  // falling to nothing at both ends. At 1px, stepped segments read as a fade.
  if (kind === 'header') {
    drawFadedRule(canvas, x, y, width, BEAM.litEdge.width, BEAM.litEdge.color, LIT_EDGE_ALPHAS, LIT_EDGE_CORE);
  }

  // The 2px Bone rule: held flat between 12% and 88%, fading out at the ends.
  const ruleY = kind === 'header' ? y + h - BEAM.rule.width : y;
  drawFadedRule(canvas, x, ruleY, width, BEAM.rule.width, BEAM.rule.color, ACCENT_RULE_ALPHAS, ACCENT_RULE_CORE);

  if (kind === 'header' && rivets) {
    drawRivetCluster(canvas, beamRivetX(x), beamRivetY(y));
    drawRivetCluster(canvas, beamRivetTrailingX(x, width), beamRivetY(y));
  }
}

/** Segments a faded rule is stepped into, widest (faintest) first. */
const RULE_STEPS = 24;

// The segments nest, so their alphas are solved the same way the cast shadow's
// are — see nestedAlphas. Precomputed at module load; drawing one allocates nothing.
function rampTargets(peak: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((peak * (i + 1)) / count);
  return out;
}
const ACCENT_RULE_ALPHAS: readonly number[] = nestedAlphas(0, rampTargets(1, RULE_STEPS)).map((p) => p.alpha);
const LIT_EDGE_ALPHAS: readonly number[] = nestedAlphas(0, rampTargets(BEAM.litEdge.alpha, RULE_STEPS)).map(
  (p) => p.alpha,
);

/** The accent rule holds full strength between 12% and 88% — the handoff's plateau. */
const ACCENT_RULE_CORE = 1 - BEAM.rule.plateau * 2;
/** The lit edge has no plateau: it peaks at the centre and falls away both ways. */
const LIT_EDGE_CORE = 0.2;

/**
 * A horizontal rule that fades out at both ends, drawn as `RULE_STEPS` nested
 * segments centred on the same line: the outermost spans the full width at the
 * faintest alpha, the innermost spans `core` of it at full strength.
 */
function drawFadedRule(
  canvas: PlateCanvas,
  x: number,
  y: number,
  width: number,
  thickness: number,
  color: number,
  alphas: readonly number[],
  core: number,
): void {
  const last = Math.max(1, alphas.length - 1);
  for (let i = 0; i < alphas.length; i++) {
    const segW = width * (1 + (core - 1) * (i / last));
    if (segW <= 0) continue;
    fillBox(canvas, x + (width - segW) / 2, y, segW, thickness, color, alphas[i]!);
  }
}
