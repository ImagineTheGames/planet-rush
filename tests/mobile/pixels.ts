/**
 * tests/mobile/pixels.ts — pixel analysis for the mobile-emulation suite.
 * OWNER: QA Agent.
 *
 * Planet Rush draws its entire presentation — HUD, controls strip, touch sticks,
 * FIRE button, ROTATE overlay — into a single PixiJS/WebGL canvas (no DOM nodes
 * per affordance). M1 phone verification caught *invisible* touch UI: a DOM
 * "is the element present" check would have passed on that broken build. So this
 * suite asserts the affordances are actually **rendered as pixels**, by decoding
 * a screenshot and counting colour-matching pixels inside screen regions.
 *
 * Regions are expressed as fractions of the image so they hold across every
 * device-pixel-ratio in the matrix (a 390×844 dpr-3 shot is 1170×2532). Colour
 * predicates key off the FROZEN palette (style-guide §1): plasma `#4DC3FF` for
 * interactive affordances, signal-yellow `#F2D24B` for ore/HUD, vacuum `#0D1015`
 * for background. Thin/faint strokes are counted, not ratio'd, so a hairline
 * ghost ring still registers.
 */
import { PNG } from 'pngjs';

/** A decoded RGBA image. `data` is row-major RGBA, 4 bytes per pixel. */
export interface Img {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

/** A rectangular region as fractions of the image, [0,1]. */
export interface Region {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Per-pixel colour predicate (channels 0..255). */
export type Pred = (r: number, g: number, b: number, a: number) => boolean;

/** Decode a PNG screenshot buffer into an {@link Img}. */
export function decode(buf: Buffer): Img {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

// --- Palette-keyed colour predicates (style-guide §1) ----------------------

/** Near-vacuum background `#0D1015` (13,16,21) — the empty canvas. */
export const isVacuum: Pred = (r, g, b) => r < 46 && g < 50 && b < 56;

/** Anything that is not background — field, HUD, affordances. */
export const isNonVacuum: Pred = (r, g, b, a) => !isVacuum(r, g, b, a);

/**
 * Bright plasma `#4DC3FF` (77,195,255): interactive affordances (FIRE ring,
 * controls-strip keys, stick knobs). Blue-dominant and vivid.
 */
export const isPlasma: Pred = (r, g, b) => b > 110 && b >= g && g >= r && b - r > 55;

/**
 * Any plasma-tinted blue, including the *faint* idle ghost ring (plasma at
 * alpha 0.18 over vacuum ≈ (25,48,63)). Superset of {@link isPlasma}: catches
 * the barely-there stick zone the M1 miss was about.
 */
export const isBlueGlow: Pred = (r, g, b) => b - r > 20 && g - r > 8 && b > 38;

/**
 * **Chalk-bright Bone** — the near-white top of the `hullSteel` value ramp that
 * Gantry/Bone uses for emphasis on a MENU (`src/art/materials.ts` `BONE.hi`).
 *
 * It exists because the ratified direction *"spends no colour on the menu — the
 * primary action is simply the brightest metal on screen"*, so the thing a menu
 * assertion has to count is brightness, not hue. Neutral by construction (the
 * ramp is a value operation on steel, so r≈g≈b), and well clear of the low Bone
 * step a resting menu line is drawn in (`#8C95A0` = 140,149,160): a resting
 * message slot counts ZERO of these and an emphasised one counts hundreds.
 */
export const isBoneLit: Pred = (r, g, b) => r > 170 && g > 170 && b > 170;

/**
 * **Faint Bone over the void** — the a0-23 counterpart of {@link isBlueGlow},
 * for the affordances that are deliberately barely there: an idle stick-zone
 * ring is `BONE.mid` at alpha 0.34 over vacuum, which lands near (68,71,74).
 *
 * The point of it is the *negative* half. Bone is a value ramp on steel, so it
 * is neutral by construction — `b - r` is 8 on the ramp itself and single digits
 * once it is laid over vacuum. Plasma at the same faintness is (25,48,63), a
 * `b - r` of 38. So this predicate counts the new ring and **rejects the blue one
 * it replaced**, which is what makes "the controls are drawn, in Bone" a single
 * assertion rather than two.
 *
 * It is not hue-blind enough to tell a ring from an asteroid — steel rock is
 * neutral too — so a caller must aim it at the affordance rather than at a
 * corner of the screen. `emulation.spec.ts` samples the ring's own arc, from the
 * bounds the layout registry publishes.
 */
export const isBoneGhost: Pred = (r, g, b) =>
  r > 28 && b - r < 18 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16;

/**
 * Signal-yellow `#F2D24B` (242,210,75): ore / the "ORE" banked total in the HUD
 * top-left. Used as the "game HUD is visible" anchor (proves no overlay covers).
 */
export const isYellow: Pred = (r, g, b) => r > 150 && g > 120 && b < 120 && r - b > 60;

// --- Region scanning -------------------------------------------------------

function clampRegion(img: Img, region: Region): { px0: number; py0: number; px1: number; py1: number } {
  const px0 = Math.max(0, Math.min(img.width, Math.floor(region.x0 * img.width)));
  const py0 = Math.max(0, Math.min(img.height, Math.floor(region.y0 * img.height)));
  const px1 = Math.max(0, Math.min(img.width, Math.ceil(region.x1 * img.width)));
  const py1 = Math.max(0, Math.min(img.height, Math.ceil(region.y1 * img.height)));
  return { px0, py0, px1, py1 };
}

/** Count pixels in `region` matching `pred`, with the region's total. */
export function count(img: Img, region: Region, pred: Pred): { matched: number; total: number; ratio: number } {
  const { px0, py0, px1, py1 } = clampRegion(img, region);
  let matched = 0;
  let total = 0;
  for (let y = py0; y < py1; y++) {
    const row = y * img.width;
    for (let x = px0; x < px1; x++) {
      const i = (row + x) * 4;
      const r = img.data[i] ?? 0;
      const g = img.data[i + 1] ?? 0;
      const b = img.data[i + 2] ?? 0;
      const a = img.data[i + 3] ?? 0;
      if (pred(r, g, b, a)) matched++;
      total++;
    }
  }
  return { matched, total, ratio: total === 0 ? 0 : matched / total };
}

/**
 * Fraction of pixels in `region` that changed between two same-size images by
 * more than `channelSum` (sum of absolute per-channel deltas). Returns 1 if the
 * dimensions differ. Used for the "did the field move?" screenshot diff.
 */
export function diffRatio(a: Img, b: Img, region: Region, channelSum = 60): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const { px0, py0, px1, py1 } = clampRegion(a, region);
  let changed = 0;
  let total = 0;
  for (let y = py0; y < py1; y++) {
    const row = y * a.width;
    for (let x = px0; x < px1; x++) {
      const i = (row + x) * 4;
      const dr = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
      const dg = Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0));
      const db = Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
      if (dr + dg + db > channelSum) changed++;
      total++;
    }
  }
  return total === 0 ? 0 : changed / total;
}

// --- Named regions (fractions of the viewport) -----------------------------

/** The very-bottom left strip, where the desktop controls strip is anchored and
 *  no touch affordance sits — the "controls strip PRESENT" probe. */
export const REGION_STRIP_LEFT: Region = { x0: 0.015, y0: 0.95, x1: 0.32, y1: 1.0 };

/** Bottom-centre band, clear of the left stick zone and the right FIRE button —
 *  where a mistakenly-rendered strip would still show, so "strip ABSENT" is a
 *  meaningful negative on touch. */
export const REGION_STRIP_MID: Region = { x0: 0.46, y0: 0.95, x1: 0.68, y1: 1.0 };

/** Bottom-right corner: the Auto-aim hold-to-FIRE button. */
export const REGION_FIRE: Region = { x0: 0.7, y0: 0.8, x1: 1.0, y1: 1.0 };

/** Bottom-left corner: the left thrust-stick ghost zone. */
export const REGION_STICK: Region = { x0: 0.0, y0: 0.72, x1: 0.35, y1: 1.0 };

/** Top-left: the ore "ORE n" banked total + cargo squares (signal yellow). The
 *  ROTATE overlay covers this, so its yellow vanishing proves the overlay is up. */
export const REGION_ORE_HUD: Region = { x0: 0.0, y0: 0.0, x1: 0.34, y1: 0.18 };

/** The whole frame — for "how much of the screen is non-background" (overlay
 *  blackout detection). */
export const REGION_FULL: Region = { x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0 };

/** The central field, excluding the HUD top band and the controls/touch bottom
 *  band — the "field moved" diff area (brief: pixel-diff of the field). */
export const REGION_FIELD: Region = { x0: 0.12, y0: 0.24, x1: 0.88, y1: 0.66 };
