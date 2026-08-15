/**
 * src/ui/title-gate.ts — the menu is behind a door, and the door gets operated.
 * OWNER: UI Engineer. Design: `designs/Star Rush - Title Gate (offline).html`
 * and `designs/Title-gate handoff.txt` (read the handoff first — it records the
 * decisions, and every one of them is a shortcut that silently ruins the effect).
 *
 * ── THE IDEA ────────────────────────────────────────────────────────────────
 * The wordmark is not a logo on a background: it is **stamped into the leaves of
 * an airlock**, and the main menu is genuinely behind it. You do not watch a
 * transition; you watch a door get operated, and then you are inside. Four
 * beats, in the order a real pressure door does them — collapsing them into one
 * move reads as a page transition, which is the thing this screen exists to
 * avoid:
 *
 *  1. **the lock turns** — a chamfered rotor ratchets 135°, seven detent clicks.
 *     Nothing else is permitted to move until it has finished.
 *  2. **the leaves part** — the upper word lifts, the lower drops, each carrying
 *     its stamped type. The lock rides the upper leaf, because it is bolted
 *     through it.
 *  3. **we go through** — the frame grows until its OPENING exceeds the screen,
 *     so the hull leaves through the edges.
 *  4. **the menu is there** — it was behind the door the whole time.
 *
 * `Escape` reseals, staged in reverse: back through, the leaves drive shut, and
 * only once they are home does the lock throw.
 *
 * ── A DOM OVERLAY, NOT A PIXI PORT ──────────────────────────────────────────
 * The menu is Pixi (`./main-menu-view` `MainMenuView extends Container`). This
 * screen is DOM, CSS and one canvas, mounted ABOVE the game canvas inside `#app`
 * — and that is not a compromise, it is what makes the design's central claim
 * TRUE rather than simulated: the doorway punch reveals **the real menu**, not a
 * picture of one. When the gate is through it goes inert and the Pixi menu is
 * simply what is there.
 *
 * It is not ported into Pixi because `clip-path`, `background-clip:text`,
 * `-webkit-text-stroke` and `drop-shadow()` have no cheap Pixi equivalent, and
 * the port would be a rewrite of a finished screen.
 *
 * ── THE FIVE TRAPS, EACH OF WHICH COST DESIGN A ROUND ───────────────────────
 *
 *  1. **The doorway is a real hole, not a fade.** The hull is eight ring
 *     segments and the starfield is *punched* at the opening ({@link paintSky},
 *     `destination-out`). `clip-path` on a filled element yields a SOLID shape
 *     rather than a ring, so every shortcut here silently paints the doorway
 *     shut — which happened twice during design, and is invisible in a passing
 *     render. `title-gate.test.ts` holds {@link skyCoversPoint} to it by name.
 *  2. **The frame only fades once it is off screen**, measured from the real
 *     window ({@link throughScale}) rather than a fixed factor, because which
 *     dimension binds differs between a desktop and a phone. A fade while the
 *     frame is still visible is the cross-dissolve this screen exists to avoid.
 *  3. **The punch tracks the door's REAL scale, every frame.** The design could
 *     jump the punch straight to its final size because it had a second,
 *     identical starfield behind the menu, so an early punch revealed the same
 *     stars. Here the punch reveals the actual menu, so an early one is the
 *     cross-dissolve of trap 2 wearing a different hat. The scale is *measured*
 *     off the door element mid-transition ({@link GateDom.measureDoorScale}).
 *  4. **`background-clip:text` makes the ramp the element's BACKGROUND**, and
 *     `text-shadow` paints above a background. So outlines are a
 *     `-webkit-text-stroke` and glows are `drop-shadow()` filters
 *     ({@link titleCss}). Use shadows for either and the letters fill solid — a
 *     white title renders solid black with no gradient at all.
 *  5. **Audio is armed by the opening press.** Browsers block it until a
 *     gesture, so nothing here may call the cue seam — or construct an
 *     `AudioContext` — on mount. A screen that tries to play on load is silent
 *     in every browser AND wrong. `title-gate.test.ts` holds that by name too.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
 *  - **It does not synthesise anything.** The design's prototype carries a
 *    second cue engine — a few hundred lines that build `unlock`, `seated`,
 *    `hover`, `confirm` and `select` from scratch — while this game already has
 *    `src/art/audio`, a bank, buses and a tone audit. Two engines means two tone
 *    contracts and an audit that measures one of them. So the gate NAMES a cue
 *    ({@link GateCue}) and the audio module decides everything else, exactly as
 *    `./sfx` already does for every other control.
 *  - **It does not reimplement the menu.** The design's PLAY / JOIN BY CODE /
 *    SETTINGS are presentation; the real menu is `MainMenuView` and it stays.
 *    This screen reveals it.
 *  - **It does not name the game.** The wordmark reads {@link GAME_NAME} from
 *    `./game-name` and splits it across the two leaves, so a rename costs one
 *    constant and the door never gets re-cut.
 *
 * ── OFFLINE, LIKE EVERYTHING ELSE (GDD §4.3 / §4.8) ─────────────────────────
 * The design file pulls React from `unpkg.com` (viewer scaffolding — zero
 * `createElement`, zero hooks; not load-bearing) and its faces from
 * `fonts.googleapis.com`. Neither survives here. The two faces are the ones
 * already self-hosted in `public/fonts/`, bound by {@link FONT_FACE_CSS} to the
 * same URLs and the same weight ranges `index.html` declares, so the gate is a
 * duplicate declaration of the shipped faces rather than a competing one.
 */

import { mulberry32 } from '@shared/types';
import { FLOOR, PALETTE } from '../art/tokens';
import { GAME_NAME, extraTracking, splitWordmark } from './game-name';
import type { GateCue, GateSfx } from './sfx';
import { NO_GATE_SFX } from './sfx';

export { GAME_NAME } from './game-name';
export type { GateCue, GateSfx } from './sfx';

// ---------------------------------------------------------------------------
// 1. The palette this screen is allowed
// ---------------------------------------------------------------------------

/** `#rrggbb` for one of the frozen tokens (style-guide §1). */
function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** `r,g,b` for one of the frozen tokens, for use inside an `rgba()`. */
function rgb(value: number): string {
  return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
}

/**
 * The ground: **Floor `#070910`** (style-guide §1.1), not the design file's
 * `#010204`.
 *
 * This is not a liberty — it is the same correction a0-40 already made in the
 * play-field. The shipped stack ran at `#010204` while the design's own
 * compositor ground was `#070910` the whole time, measured ~5× darker at every
 * level, and the developer's verdict on the sixth report was *"the mockup still
 * looks a million times better."* Floor is the one hex in this game that means
 * "the ground the star-field is composited over", and that is exactly this
 * screen's job.
 */
const GROUND = hex(FLOOR);
/** Floor's channels, for the near-black shadow alphas the door is modelled with. */
const INK = rgb(FLOOR);
/**
 * The dark end of every derived shade, per style-guide §1.1: *"Vacuum `#0D1015`
 * … is still the dark endpoint of the value ramp every derived shade is mixed
 * toward."* The design mixed toward `#010204`, which is Floor's retired value.
 */
const RAMP_DARK = hex(PALETTE.vacuum);
/** The design's bone-white — a value shade of hull steel, not a new hue (§5.2). */
const BONE_WHITE = '#eef2f7';
/**
 * Signal yellow, spent on exactly one thing here: **hazard stripes** at the
 * leaves' meeting edges, which style-guide §2 names in so many words
 * (*"hazard/danger stripes"*). The design also paints the lock's open-position
 * index mark in it; that one is a machine marking rather than a hazard, so it is
 * drawn in steel here. Yellow is a controlled substance and this screen has no
 * ore on it.
 */
const HAZARD = rgb(PALETTE.signalYellow);
/** The nebula wash — patina at α ≤ 0.09, far under `SKY_ALPHA_MAX` (§2.2). */
const NEBULA = rgb(PALETTE.patina);

// ---------------------------------------------------------------------------
// 2. Geometry — one source for the CSS and for the punch
// ---------------------------------------------------------------------------

/**
 * The door box: `min(94vw, 136vh)` wide at 1.62:1.
 *
 * These four numbers are quoted in three places — the frame's CSS, the punch on
 * the canvas, and {@link throughScale} — so they are constants and the CSS is
 * built from them. A punch that drifts from the frame is a doorway with a rim of
 * stars around it, or a frame with a rim of menu.
 */
export const DOOR = {
  /** Fraction of the viewport WIDTH the door box may take. */
  widthOfVw: 0.94,
  /** Fraction of the viewport HEIGHT the door box may take, as a width. */
  widthOfVh: 1.36,
  /** Width ÷ height. */
  aspect: 1.62,
  /** The jamb ring's thickness, as a fraction of the door box. */
  frame: 0.094,
  /** The opening's chamfer, as fractions of the OPENING box. */
  chamferX: 0.13,
  chamferY: 0.22,
} as const;

/** The opening as a fraction of the door box: the box less the ring both sides. */
export const OPENING_SCALE = 1 - 2 * DOOR.frame;

/** A viewport, in CSS pixels. */
export interface GateView {
  readonly width: number;
  readonly height: number;
}

/** A point in CSS pixels, origin top-left of the viewport. */
export interface GatePoint {
  readonly x: number;
  readonly y: number;
}

/** The door box in CSS pixels at `scale`, centred on the viewport. */
export function doorBox(view: GateView, scale = 1): { width: number; height: number } {
  const width = Math.min(DOOR.widthOfVw * view.width, DOOR.widthOfVh * view.height) * scale;
  return { width, height: width / DOOR.aspect };
}

/**
 * The eight points of the OPENING, in CSS pixels — the chamfered octagon the
 * leaves live inside, and the shape punched out of the starfield.
 *
 * Note it is the *opening*, not the door box: the design punches the outer
 * octagon and lets the opaque ring cover the difference, which works but makes
 * "the hull is covered by the field" false at every point on the ring. Punching
 * the opening erases strictly less, matches the handoff's own wording (*"the
 * starfield is punched at the opening"*), and makes the invariant the test
 * asserts a statement about the picture rather than about the z-order.
 */
export function openingPolygon(view: GateView, scale = 1): readonly GatePoint[] {
  const box = doorBox(view, scale);
  const w = box.width * OPENING_SCALE;
  const h = box.height * OPENING_SCALE;
  const x0 = view.width / 2 - w / 2;
  const y0 = view.height / 2 - h / 2;
  const { chamferX: cx, chamferY: cy } = DOOR;
  const unit: readonly (readonly [number, number])[] = [
    [0, cy],
    [cx, 0],
    [1 - cx, 0],
    [1, cy],
    [1, 1 - cy],
    [1 - cx, 1],
    [cx, 1],
    [0, 1 - cy],
  ];
  return unit.map(([px, py]) => ({ x: x0 + px * w, y: y0 + py * h }));
}

/** Is `point` inside the convex polygon `poly`? Edges count as inside. */
export function insidePolygon(poly: readonly GatePoint[], point: GatePoint): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * **THE DOORWAY IS A HOLE, NOT A FADE.** Does the punched starfield still cover
 * this point?
 *
 * This is the invariant that failed twice during design and is invisible in a
 * passing render: the field in front of the menu must come out as a **ring** —
 * covering the hull and the vacuum around it, and *not* covering the doorway. A
 * `clip-path` on a filled element yields a solid shape instead, and a solid
 * shape over the opening paints the doorway shut: the door still animates, the
 * screen still looks right in a screenshot, and the menu never shows through the
 * one place the whole design says it must.
 *
 * So the punch is a `destination-out` fill of {@link openingPolygon}, and this
 * predicate is the same geometry stated as a question a test can ask.
 */
export function skyCoversPoint(view: GateView, scale: number, point: GatePoint): boolean {
  if (point.x < 0 || point.y < 0 || point.x > view.width || point.y > view.height) return false;
  return !insidePolygon(openingPolygon(view, scale), point);
}

/**
 * How far the door must scale for its OPENING to clear the viewport entirely.
 *
 * Measured from the real window, because the door is `min(94vw, 136vh)` wide at
 * 1.62 and **which branch wins differs between a desktop and a phone** — a fixed
 * factor that works on one leaves frame metal on screen on the other, and metal
 * on screen while the frame dissolves is the cross-dissolve this screen exists
 * to replace. The 1.4 is margin past "exactly off screen"; the 16 is a ceiling,
 * so a 1×1 viewport cannot ask for an infinite transform.
 */
export function throughScale(view: GateView): number {
  const box = doorBox(view, 1);
  const openW = box.width * OPENING_SCALE;
  const openH = box.height * OPENING_SCALE;
  if (!(openW > 0) || !(openH > 0)) return 1;
  return Math.min(16, 1.4 * Math.max(view.width / openW, view.height / openH));
}

// ---------------------------------------------------------------------------
// 3. The four beats
// ---------------------------------------------------------------------------

/**
 * Where the door is. Four *facts* rather than one index — the lock is thrown,
 * the leaves are apart, the frame is passing the camera, we are through — so
 * opening and closing share one set of rules read in different orders.
 */
export type GatePhase =
  /** Sealed. The only phase that accepts a press. */
  | 'locked'
  /** Beat 1: the rotor ratchets 135°. Nothing else moves. */
  | 'turning'
  /** Beat 2: the leaves part, each carrying its stamped word. */
  | 'parting'
  /** Beat 3: the frame grows until its opening is bigger than the screen. */
  | 'entering'
  /** Beat 4: we are through; the overlay is inert and the menu is what is there. */
  | 'open'
  /** Reseal 1: back through — the frame comes toward us again. */
  | 'returning'
  /** Reseal 2: the leaves drive shut. The lock throws only once they are home. */
  | 'closing';

/**
 * Every transition on the screen, in ms — quoted once here and interpolated into
 * the CSS, so {@link GATE_OPEN_STEPS} can be checked against the motion it is
 * actually sequencing rather than against a second copy of these numbers.
 */
export const TRANSITION = {
  /** The rotor's 135°. Beat 1 owns the screen for exactly this long. */
  rotor: 860,
  /** A leaf travelling its own height, in or out. */
  leaf: 1020,
  /** The frame growing until its opening clears the viewport. */
  frame: 1500,
  /** The frame's fade — which may only START once the scale above has finished. */
  fade: 300,
  /** The bolts pulling. */
  bolt: 600,
  /** The lock taking up its seat. */
  hub: 500,
  /** The hazard stripes coming up and going out. */
  hazard: 340,
} as const;

/** One scheduled phase change, in ms from the start of its sequence. */
export interface GateStep {
  readonly at: number;
  readonly phase: GatePhase;
}

/**
 * Opening, as data.
 *
 * The four beats are the design, and the numbers are the handoff's: the lock
 * gets its full 900 ms before a leaf may move; the leaves get their 1.02 s
 * transition (plus a beat) before the frame starts growing; and the frame's own
 * 1.5 s scale must FINISH before the fade begins — `1880 + 1500 = 3380`, so the
 * fade at 3460 starts with the frame already past the edges of the screen. A
 * fade any earlier is a wash appearing over a visible frame.
 */
export const GATE_OPEN_STEPS: readonly GateStep[] = [
  { at: 0, phase: 'turning' },
  { at: 900, phase: 'parting' },
  { at: 1880, phase: 'entering' },
  { at: 3460, phase: 'open' },
];

/**
 * Resealing, as data — the same beats read backwards, which is not the same
 * thing as the animation played backwards.
 *
 * Snapping straight to `locked` ran every transition at once, and *that* is what
 * read as a rewind. So: we come back through (`returning`), then the leaves
 * drive shut (`closing`), and only once they are measurably home does the lock
 * throw — which is why the last step is not on this list. See {@link SEAL_FLOOR_MS}.
 */
export const GATE_RESEAL_STEPS: readonly GateStep[] = [
  { at: 0, phase: 'returning' },
  { at: 1460, phase: 'closing' },
];

/**
 * The lock may not throw until the leaves are **measurably** shut.
 *
 * Two earlier attempts failed for different reasons — a fixed dwell shorter than
 * the transition, then a `transitionend` gate that never fired — so the shipped
 * answer measures the leaf's own offset each frame, which depends on neither.
 * The floor stops it latching before the transition has begun; the cap means a
 * throttled tab ends up locked rather than stuck.
 */
export const SEAL_FLOOR_MS = 250;
/** Ceiling on the measured wait, so a background tab still finishes sealing. */
export const SEAL_CAP_MS = 3200;
/** Leaf offset, in px, at or under which the leaves count as home. */
export const SEAL_EPSILON_PX = 1;

/** The CSS custom properties the whole screen is driven by. */
export type GateVars = Readonly<Record<string, string>>;

/**
 * Every moving part of the screen, as ten CSS custom properties on the overlay
 * root.
 *
 * This is the port's one structural liberty and it earns its keep: the design is
 * a React render that re-emits ~180 inline styles per state change, and the four
 * beats only ever move ten numbers. Set them on the root, let CSS `var()` carry
 * them to the sixteen bolts and the two leaves, and a phase change is ten
 * property writes with no reconciliation and nothing to re-attach — which is
 * also why the leaf ref can be stable here in a way it was not in the prototype.
 */
export function gateVars(phase: GatePhase, scale: number): GateVars {
  // The lock is thrown for every phase but `locked`; the leaves are apart for
  // every phase in which we are past them; the frame is only scaled while we are
  // going through it; and `through` is the single phase in which the door is
  // behind us.
  const turned = phase !== 'locked';
  const parted =
    phase === 'parting' || phase === 'entering' || phase === 'open' || phase === 'returning';
  const scaled = phase === 'entering' || phase === 'open';
  const through = phase === 'open';
  return {
    '--pr-gate-door-scale': String(scaled ? scale : 1),
    '--pr-gate-door-op': through ? '0' : '1',
    '--pr-gate-leaf-top': parted ? 'translateY(-108%)' : 'translateY(0)',
    '--pr-gate-leaf-bot': parted ? 'translateY(108%)' : 'translateY(0)',
    // The rotor holds at 135° through the whole open sequence and all the way
    // back: it is the LAST thing to move on the way in and the last on the way
    // out, which is what makes the two sequences read as different events.
    '--pr-gate-hub-rot': turned ? '135deg' : '0deg',
    // It is bolted to the leaf and leaves with it — it does not fade.
    '--pr-gate-hub-scale': phase === 'turning' ? '1.03' : '1',
    '--pr-gate-bolt-scale': turned ? '0.84' : '1',
    '--pr-gate-haz-op': phase === 'locked' ? '0.5' : phase === 'turning' ? '1' : '0',
    '--pr-gate-prompt-op': turned ? '0' : '1',
    '--pr-gate-cursor': phase === 'locked' ? 'pointer' : 'default',
  };
}

// ---------------------------------------------------------------------------
// 4. The type, struck into the leaf
// ---------------------------------------------------------------------------

/**
 * The thirteen values the handoff says a developer can lift straight out rather
 * than re-derive. These are the shipped defaults — *"the agreed look"* — with
 * the design's five presets and its `−1 follows the preset` plumbing left in the
 * design tool where they belong: they are editor affordances, and a screen with
 * one ratified look does not need a control that changes it.
 */
export const TITLE = {
  /** The ramp is built from this one hue. */
  color: BONE_WHITE,
  /** `horizon` — a hard value break across the middle, which is what reads as
   *  polished plate; a plain ramp reads as coloured type. */
  mode: 'horizon' as 'horizon' | 'ramp' | 'flat',
  angle: 180,
  /** How much of the glyph the transition occupies, %. Small = a hard edge. */
  spread: 62,
  /** Size, as a percentage of the base scale. */
  size: 150,
  /** Letter spacing, in hundredths of an em. */
  tracking: 7,
  /** Outline weight, px, before it is scaled down to what a stroke can carry. */
  outline: 9,
  outlineColor: '#1c2027',
  /** Glow radius, px. */
  glow: 3,
  /** Black reads as a soft shadow halo, which is what this preset wants. */
  glowColor: GROUND,
  /** Seconds of pause between sheen passes; 0 is off. */
  sheen: 5,
  /** Clearance from the lock, as a % of the leaf. */
  lockGap: 3,
} as const;

/** Blend two `#rrggbb` toward `b` by `t`. */
function mix(a: string, b: string, t: number): string {
  const px = (h: string): number[] => {
    const s = h.replace('#', '');
    const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = px(a);
  const B = px(b);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(A[i]! + (B[i]! - A[i]!) * t).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** `rgba()` from a `#rrggbb` and an alpha. */
function rgba(color: string, alpha: number): string {
  const s = color.replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The three-stop ramp, derived from ONE colour rather than handed in as three.
 *
 * Every three-hex ramp the design tried began with a near-white tint, so
 * whichever end the swatch moved, the visible result barely did — six palettes
 * that all read the same. One hue, lightened for the top and driven into the
 * dark end for the bottom, gives a ramp that is unmistakably that colour, and
 * anchoring the mid a fixed step DOWN from the hue guarantees three separated
 * stops for a light hue as well as a dark one.
 */
export function titleRamp(color: string = TITLE.color): readonly [string, string, string] {
  return [mix(color, '#ffffff', 0.3), mix(color, RAMP_DARK, 0.26), mix(color, RAMP_DARK, 0.68)];
}

/** Everything that affects glyph ADVANCE, in one place so the two words cannot
 *  drift: slicing these out of a formatted string is what doubled the letters in
 *  the prototype. */
function titleFont(track: number): string {
  const size = TITLE.size / 100;
  return (
    'font-family:Audiowide,system-ui,sans-serif;' +
    `font-size:min(clamp(20px,${(8.2 * size).toFixed(2)}vw,${Math.round(108 * size)}px),${(11.4 * size).toFixed(2)}vh);` +
    'line-height:.92;white-space:nowrap;' +
    `letter-spacing:${track.toFixed(3)}em;` +
    // Letter-spacing adds a trailing space the browser then centres, so the
    // glyph run sits left of centre by exactly one step. An equal indent
    // cancels it — applied to BOTH words here, where the design only needed it
    // on the one it had tracked out.
    `text-indent:${track.toFixed(3)}em;`
  );
}

/**
 * The title's CSS, assembled from {@link TITLE}.
 *
 * **PAINT ORDER IS THE WHOLE REASON A GRADIENT TITLE LOOKED BLACK.** With
 * `background-clip:text` the ramp is the element's *background*, and
 * `text-shadow` paints ABOVE a background — so every hard offset shadow lands
 * inside the letters, and a transparent fill lets it through: four near-black
 * offsets at ±1px fill a glyph completely. So when the fill is clipped, the
 * outline is a text-STROKE (part of the glyph, ordered behind the fill) and the
 * only shadows allowed are `drop-shadow()` filters, which key off the element's
 * rendered alpha and can therefore only ever appear OUTSIDE the glyph. A flat
 * fill is opaque and can take the cheaper shadow-based outline.
 *
 * @param track Letter spacing in em, including this word's share of
 *   {@link extraTracking}.
 * @param canClip Whether `background-clip:text` is supported. Without it the
 *   ramp collapses to a solid colour: a flat title is a compromise, an invisible
 *   one is a bug.
 */
export function titleCss(track: number, canClip = true): string {
  const [top, mid, bot] = titleRamp();
  const mode = canClip ? TITLE.mode : 'flat';

  if (mode === 'flat') {
    const shadows = [
      `${-TITLE.outline}px 0 0 ${TITLE.outlineColor}`,
      `${TITLE.outline}px 0 0 ${TITLE.outlineColor}`,
      `0 ${-TITLE.outline}px 0 ${TITLE.outlineColor}`,
      `0 ${TITLE.outline}px 0 ${TITLE.outlineColor}`,
      `0 0 ${TITLE.glow}px ${rgba(TITLE.glowColor, 0.85)}`,
      `0 5px 0 rgba(${INK},.8)`,
      `0 13px 28px rgba(${INK},.62)`,
    ];
    return `${titleFont(track)}color:${mid};text-shadow:${shadows.join(',')};`;
  }

  const size = TITLE.size / 100;
  const half = Math.max(1, Math.min(50, TITLE.spread / 2));
  const stops =
    mode === 'horizon'
      ? `${top} 0%,${mid} ${(50 - half).toFixed(1)}%,${bot} 50%,${mid} ${(50 + half * 0.6).toFixed(1)}%,${bot} 100%`
      : `${top} ${Math.max(0, 50 - half).toFixed(1)}%,${mid} 50%,${bot} ${Math.min(100, 50 + half).toFixed(1)}%`;
  const ramp = `linear-gradient(${TITLE.angle}deg,${stops})`;

  // A stroke is centred on the outline, so it grows the glyph on BOTH sides and
  // eats into the counters: at the slider's own 9px the letterforms close up and
  // the title reads as mush. Halved and capped at the ~4px Audiowide can carry.
  const strokeW = Math.min(4, TITLE.outline * 0.5);
  const stroke =
    strokeW > 0 ? `-webkit-text-stroke:${strokeW.toFixed(2)}px ${TITLE.outlineColor};paint-order:stroke fill;` : '';

  const filters = [
    `drop-shadow(0 0 ${TITLE.glow}px ${rgba(TITLE.glowColor, 0.8)})`,
    `drop-shadow(0 0 ${Math.round(TITLE.glow * 2.4)}px ${rgba(TITLE.glowColor, 0.4)})`,
    // The drop that lifts the type off the leaf — likewise outside the glyph.
    `drop-shadow(0 ${Math.round(4 * size)}px ${Math.round(7 * size)}px rgba(${INK},.7))`,
  ];

  // Two background layers, and only the FIRST one's position is animated. That
  // is the whole trick: with a transparent text fill, wherever the background
  // image is absent there is no fill at all, so scrolling the only layer out of
  // the box made the title vanish for a fifth of every cycle. The ramp holds
  // still; just the glint travels.
  const sheen =
    TITLE.sheen > 0
      ? `background-image:linear-gradient(102deg, transparent 38%, ${rgba(top, 0.6)} 50%, transparent 62%),${ramp};` +
        'background-size:230% 100%,100% 100%;background-repeat:no-repeat,no-repeat;' +
        'background-position:150% 50%,0 0;' +
        `animation:pr-gate-sheen ${(TITLE.sheen / 0.64).toFixed(2)}s linear infinite;`
      : `background-image:${ramp};background-size:100% 100%;background-repeat:no-repeat;`;

  return (
    stroke +
    sheen +
    titleFont(track) +
    '-webkit-background-clip:text;background-clip:text;' +
    'color:transparent;-webkit-text-fill-color:transparent;' +
    `filter:${filters.join(' ')};`
  );
}

/**
 * The lower word's sheen delay: 55% of a sweep, not a whole one.
 *
 * A full-sweep delay only lines up the two START times; what has to line up is
 * the upper word's glint LEAVING and the lower word's ARRIVING, and each pass
 * spends its first stretch travelling in from outside the letters.
 */
export function sheenDelaySeconds(): number {
  return (TITLE.sheen / 0.64) * 0.18 * 0.55;
}

// ---------------------------------------------------------------------------
// 5. The markup
// ---------------------------------------------------------------------------

/** The overlay root's element id — the handle a live test asserts on. */
export const TITLE_GATE_ID = 'pr-title-gate';
/** The punched starfield's element id. */
export const TITLE_GATE_SKY_ID = 'pr-title-gate-sky';
/** The door box's element id — measured mid-transition for the punch. */
export const TITLE_GATE_DOOR_ID = 'pr-title-gate-door';
/** The upper leaf's element id — measured to decide when the door is home. */
export const TITLE_GATE_LEAF_ID = 'pr-title-gate-leaf';

/** The self-hosted faces, byte-identical to `index.html`'s declarations. */
export const FONT_URLS = {
  audiowide: '/fonts/Audiowide-Regular-latin.woff2',
  oxanium: '/fonts/Oxanium-Variable-latin.woff2',
} as const;

/**
 * The two ratified faces, self-hosted (style-guide §7, GDD §4.3 / §4.8).
 *
 * The design file's `src` values are the design tool's UUID placeholders and its
 * `@font-face` block came with a `preconnect` to `fonts.googleapis.com`. Both
 * are gone. These declarations repeat `index.html`'s exactly — same family, same
 * weight range, same URL — so they resolve to the already-preloaded files and
 * cost no second download. Oxanium's `200 800` range is not optional: the file's
 * own default instance is ExtraLight, and a face declared without it renders
 * every line of this screen hairline-thin.
 */
export const FONT_FACE_CSS =
  `@font-face{font-family:'Audiowide';font-style:normal;font-weight:400;font-display:block;src:url('${FONT_URLS.audiowide}') format('woff2');}` +
  `@font-face{font-family:'Oxanium';font-style:normal;font-weight:200 800;font-display:block;src:url('${FONT_URLS.oxanium}') format('woff2');}`;

/** Options for {@link titleGateHtml}. */
export interface GateHtmlOptions {
  /** The wordmark, split across the leaves. Defaults to {@link GAME_NAME}. */
  readonly name?: string;
  /** Whether `background-clip:text` is available (trap 4). */
  readonly canClip?: boolean;
}

const OPENING_CLIP = (() => {
  const { chamferX: cx, chamferY: cy } = DOOR;
  const pc = (v: number): string => `${(v * 100).toFixed(0)}%`;
  return (
    `polygon(0 ${pc(cy)},${pc(cx)} 0,${pc(1 - cx)} 0,100% ${pc(cy)},` +
    `100% ${pc(1 - cy)},${pc(1 - cx)} 100%,${pc(cx)} 100%,0 ${pc(1 - cy)})`
  );
})();

/** One machined fastener, seated in the jamb ring at `x`/`y` percent. */
function bolt(x: string, y: string): string {
  return (
    `<div style="position:absolute;left:${x};top:${y};width:min(19px,1.6vw);aspect-ratio:1;` +
    'transform:translate(-50%,-50%) scale(var(--pr-gate-bolt-scale));' +
    `transition:transform ${TRANSITION.bolt}ms cubic-bezier(.4,0,.2,1);">` +
    '<div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(160deg,#7e8894,#2d3239);' +
    `box-shadow:inset 0 1px 0 rgba(238,242,247,.32), 0 2px 5px rgba(${INK},.75);"></div>` +
    `<div style="position:absolute;left:22%;right:22%;top:46%;height:2px;background:rgba(${INK},.7);"></div>` +
    '</div>'
  );
}

/** The six screws that hold the lock's flange down. */
function flangeScrews(): string {
  let out = '';
  for (let deg = 0; deg < 360; deg += 60) {
    out +=
      `<div style="position:absolute;left:50%;top:50%;width:6.4%;height:6.4%;margin:-3.2% 0 0 -3.2%;transform:rotate(${deg}deg) translateY(-43%);">` +
      '<div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(155deg,#8b939b,#3a4047);' +
      `box-shadow:inset 0 .5px 0 rgba(238,242,247,.45), 0 1px 2px rgba(${INK},.8);"></div>` +
      `<div style="position:absolute;left:24%;right:24%;top:47%;height:1px;background:rgba(${INK},.75);"></div>` +
      '</div>';
  }
  return out;
}

/**
 * THE LOCK.
 *
 * What made an earlier version read as a toy was flat fills, high contrast
 * between a few big shapes, and sitting ON the door. Real machined steel is the
 * opposite: it sits IN a bored pocket, its value range is narrow, and it earns
 * its realism from small things — turning marks from the lathe, a specular
 * streak that crosses the form, a hex drive a tool would actually engage, index
 * marks that say which way it has turned, and screws that hold the flange on.
 */
function lock(): string {
  const facet = `clip-path:${OPENING_CLIP};`;
  return (
    '<div style="position:absolute;left:50%;bottom:0;width:min(148px,17vh);aspect-ratio:1;' +
    `transform:translate(-50%,50%) scale(var(--pr-gate-hub-scale));transition:transform ${TRANSITION.hub}ms ease-out;">` +
    // the bored pocket the mechanism is recessed into
    `<div style="position:absolute;inset:-9%;border-radius:50%;background:radial-gradient(circle,#1a1e24 62%,#2b3138 100%);box-shadow:inset 0 3px 7px rgba(${INK},.95), inset 0 -1px 0 rgba(238,242,247,.14), 0 1px 0 rgba(238,242,247,.1);"></div>` +
    // the flange, and the fasteners holding it down
    `<div style="position:absolute;inset:-4%;border-radius:50%;background:linear-gradient(158deg,#697179,#343a41 72%);box-shadow:inset 0 1px 0 rgba(238,242,247,.3), 0 2px 5px rgba(${INK},.8);"></div>` +
    `<div style="position:absolute;inset:-4%;border-radius:50%;background:repeating-conic-gradient(from 0deg, rgba(${INK},.1) 0deg 1.6deg, transparent 1.6deg 6deg);"></div>` +
    flangeScrews() +
    // index marks cut into the flange: closed at the top, open a third round.
    // The open mark is STEEL, not the design's signal yellow — a position mark
    // is a machine marking, and yellow means ore or danger here (§2).
    `<div style="position:absolute;left:50%;top:-7%;width:1.6%;height:7%;margin-left:-.8%;background:rgba(${INK},.8);box-shadow:.5px 0 0 rgba(238,242,247,.22);"></div>` +
    '<div style="position:absolute;left:50%;top:50%;width:1.6%;height:7%;margin-left:-.8%;transform:rotate(135deg) translateY(-57%);transform-origin:50% 0;background:rgba(198,205,214,.5);"></div>' +
    // the seat the rotor sits in
    `<div style="position:absolute;inset:4%;border-radius:50%;background:linear-gradient(158deg,#2b3138,#1c2027);box-shadow:inset 0 2px 5px rgba(${INK},.9);"></div>` +
    // THE ROTOR — the only thing that moves in beat 1
    `<div style="position:absolute;inset:13%;transform:rotate(var(--pr-gate-hub-rot));transition:transform ${TRANSITION.rotor}ms cubic-bezier(.32,0,.18,1);">` +
    `<div style="position:absolute;inset:0;${facet}background:linear-gradient(154deg,#6d757e 0%,#565e66 40%,#474e56 62%,#3b4148 100%);box-shadow:inset 0 1px 0 rgba(238,242,247,.34);"></div>` +
    // turned from bar stock: fine concentric tool marks
    `<div style="position:absolute;inset:0;${facet}background:repeating-radial-gradient(circle at 50% 50%, rgba(238,242,247,.06) 0 1px, rgba(${INK},.07) 1px 3px);"></div>` +
    // one specular streak crossing the whole form, which is what tells the eye
    // this is metal and not paint
    `<div style="position:absolute;inset:0;${facet}background:linear-gradient(116deg, transparent 26%, rgba(238,242,247,.2) 44%, rgba(238,242,247,.05) 52%, transparent 66%);"></div>` +
    `<div style="position:absolute;inset:0;${facet}box-shadow:inset 0 -2px 0 rgba(${INK},.45), inset 0 2px 0 rgba(238,242,247,.16);"></div>` +
    // drive slots: shallow, chamfered, with a lit lower lip
    `<div style="position:absolute;left:50%;top:5%;width:3.6%;height:28%;margin-left:-1.8%;background:linear-gradient(180deg,rgba(${INK},.66),rgba(${INK},.3));box-shadow:1px 0 0 rgba(238,242,247,.2);"></div>` +
    `<div style="position:absolute;left:50%;bottom:5%;width:3.6%;height:28%;margin-left:-1.8%;background:linear-gradient(0deg,rgba(${INK},.66),rgba(${INK},.3));box-shadow:1px 0 0 rgba(238,242,247,.2);"></div>` +
    `<div style="position:absolute;top:50%;left:5%;height:3.6%;width:28%;margin-top:-1.8%;background:linear-gradient(90deg,rgba(${INK},.66),rgba(${INK},.3));box-shadow:0 1px 0 rgba(238,242,247,.2);"></div>` +
    `<div style="position:absolute;top:50%;right:5%;height:3.6%;width:28%;margin-top:-1.8%;background:linear-gradient(270deg,rgba(${INK},.66),rgba(${INK},.3));box-shadow:0 1px 0 rgba(238,242,247,.2);"></div>` +
    // raised boss, then the hex socket a tool actually engages
    `<div style="position:absolute;left:50%;top:50%;width:36%;height:36%;margin:-18% 0 0 -18%;border-radius:50%;background:linear-gradient(154deg,#7e8894 0%,#5a626b 46%,#40464e 100%);box-shadow:inset 0 1px 0 rgba(238,242,247,.42), 0 1px 3px rgba(${INK},.7);"></div>` +
    `<div style="position:absolute;left:50%;top:50%;width:34%;height:34%;margin:-17% 0 0 -17%;border-radius:50%;background:repeating-radial-gradient(circle at 50% 50%, rgba(${INK},.06) 0 1px, transparent 1px 2px);"></div>` +
    '<div style="position:absolute;left:50%;top:50%;width:15%;height:16.5%;margin:-8.25% 0 0 -7.5%;background:#171b21;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);box-shadow:0 1px 0 rgba(238,242,247,.2);"></div>' +
    `<div style="position:absolute;left:50%;top:50%;width:15%;height:16.5%;margin:-8.25% 0 0 -7.5%;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);box-shadow:inset 0 1.5px 1px rgba(${INK},.9);"></div>` +
    // engraved witness line: which way it has been turned
    `<div style="position:absolute;left:50%;top:6%;width:1.4%;height:14%;margin-left:-.7%;background:rgba(${INK},.7);box-shadow:.5px 0 0 rgba(238,242,247,.26);"></div>` +
    '</div>' +
    // grime in the crevice, and the rim highlight over everything
    `<div style="position:absolute;inset:4%;border-radius:50%;pointer-events:none;box-shadow:inset 0 0 5px rgba(${INK},.6);"></div>` +
    `<div style="position:absolute;inset:-4%;border-radius:50%;pointer-events:none;background:linear-gradient(158deg, rgba(238,242,247,.14) 0%, transparent 34%, transparent 70%, rgba(${INK},.3) 100%);"></div>` +
    '</div>'
  );
}

/** The jamb: eight ring segments, outer edge to opening edge. Never one filled
 *  box with a hole "clipped" out of it — see {@link skyCoversPoint}. */
function jamb(): string {
  const lit = `box-shadow:inset 0 3px 0 rgba(238,242,247,.34), inset 0 4px 0 rgba(${INK},.45), inset 0 -2px 0 rgba(${INK},.5);`;
  const shade = `box-shadow:inset 0 -3px 0 rgba(${INK},.75), inset 0 -4px 0 rgba(238,242,247,.14), inset 0 2px 0 rgba(${INK},.4);`;
  const side = `box-shadow:inset 3px 0 0 rgba(238,242,247,.28), inset 4px 0 0 rgba(${INK},.4), inset -2px 0 0 rgba(${INK},.5);`;
  return (
    `<div style="position:absolute;left:13%;right:13%;top:0;height:9.4%;clip-path:polygon(0 0,100% 0,90.54% 100%,9.46% 100%);background:linear-gradient(180deg,#6d757e,#40464e);${lit}"></div>` +
    `<div style="position:absolute;left:13%;right:13%;bottom:0;height:9.4%;clip-path:polygon(0 100%,100% 100%,90.54% 0,9.46% 0);background:linear-gradient(0deg,#575e66,#2b3138);${shade}"></div>` +
    `<div style="position:absolute;left:0;width:9.4%;top:22%;height:56%;clip-path:polygon(0 0,100% 9.39%,100% 90.61%,0 100%);background:linear-gradient(90deg,#5a626b,#383e45);${side}"></div>` +
    `<div style="position:absolute;right:0;width:9.4%;top:22%;height:56%;clip-path:polygon(100% 0,0 9.39%,0 90.61%,100% 100%);background:linear-gradient(270deg,#5a626b,#383e45);${side}"></div>` +
    `<div style="position:absolute;left:0;top:0;width:20%;height:27.26%;clip-path:polygon(0 80.7%,65% 0,100% 34.5%,47% 100%);background:linear-gradient(150deg,#727a83,#434a52);${lit}"></div>` +
    `<div style="position:absolute;right:0;top:0;width:20%;height:27.26%;clip-path:polygon(100% 80.7%,35% 0,0 34.5%,53% 100%);background:linear-gradient(210deg,#6d757e,#3f4650);${lit}"></div>` +
    `<div style="position:absolute;left:0;bottom:0;width:20%;height:27.26%;clip-path:polygon(0 19.3%,65% 100%,100% 65.5%,47% 0);background:linear-gradient(30deg,#575e66,#2f353c);${shade}"></div>` +
    `<div style="position:absolute;right:0;bottom:0;width:20%;height:27.26%;clip-path:polygon(100% 19.3%,35% 100%,0 65.5%,53% 0);background:linear-gradient(330deg,#525a62,#2c3239);${shade}"></div>`
  );
}

/** One leaf, with its stamped word riding inside the opening's clip. */
function leaf(word: string, track: number, canClip: boolean, upper: boolean): string {
  const edge = upper ? 'bottom' : 'top';
  const far = upper ? 'top' : 'bottom';
  const body = upper
    ? 'linear-gradient(158deg,#5a626b 0%,#40464e 44%,#2d3239 100%)'
    : 'linear-gradient(22deg,#515861 0%,#383e45 44%,#262a31 100%)';
  const lip = upper ? 'linear-gradient(180deg,#7e8894,#40464e)' : 'linear-gradient(0deg,#7e8894,#383e45)';
  const sheenDelay = canClip && TITLE.sheen > 0 && !upper ? `animation-delay:${sheenDelaySeconds().toFixed(2)}s;` : '';
  return (
    `<div${upper ? ` id="${TITLE_GATE_LEAF_ID}"` : ''} style="position:absolute;left:0;right:0;${far}:0;height:50%;` +
    `transform:var(--pr-gate-leaf-${upper ? 'top' : 'bot'});transition:transform ${TRANSITION.leaf}ms cubic-bezier(.62,.02,.28,1);background:${body};">` +
    // the leaf's own plate seams
    `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg, rgba(${INK},.22) 0 1px, transparent 1px 12.5%);"></div>` +
    `<div style="position:absolute;left:6%;right:6%;${far}:14%;height:2px;background:linear-gradient(90deg,transparent,rgba(${INK},.5) 12%,rgba(${INK},.5) 88%,transparent);"></div>` +
    `<div style="position:absolute;left:6%;right:6%;${far}:calc(14% + 2px);height:1px;background:linear-gradient(90deg,transparent,rgba(238,242,247,.14) 12%,rgba(238,242,247,.14) 88%,transparent);"></div>` +
    // the meeting edge, and the hazard stripes on it (§2: hazard stripes are the
    // one sanctioned signal yellow on this screen)
    `<div style="position:absolute;left:0;right:0;${edge}:0;height:6.5%;background:${lip};"></div>` +
    `<div style="position:absolute;left:0;right:0;${edge}:6.5%;height:2px;background:rgba(238,242,247,.26);"></div>` +
    `<div style="position:absolute;left:0;right:0;${edge}:0;height:2.4%;opacity:var(--pr-gate-haz-op);transition:opacity ${TRANSITION.hazard}ms ease-out;background:repeating-linear-gradient(115deg, rgba(${HAZARD},.44) 0 9px, rgba(38,42,49,.94) 9px 18px);"></div>` +
    // the type, struck into the leaf and travelling with it
    `<div style="position:absolute;left:6%;right:6%;${edge}:calc(min(74px,8.5vh) + ${TITLE.lockGap}%);display:flex;justify-content:center;isolation:isolate;">` +
    `<span style="${titleCss(track, canClip)}${sheenDelay}">${escapeHtml(word)}</span>` +
    '</div>' +
    '</div>'
  );
}

/** The bolt seats, measured on the jamb ring: five along each straight run, one
 *  in each chamfer, one each side. Percentages of the door box, so they track
 *  the frame at any viewport instead of floating in space. */
function bolts(): string {
  let out = '';
  for (const x of [26, 38, 50, 62, 74]) {
    out += bolt(`${x}%`, '2.6%');
    out += bolt(`${x}%`, '97.4%');
  }
  out += bolt('7.4%', '13%') + bolt('92.6%', '13%') + bolt('7.4%', '87%') + bolt('92.6%', '87%');
  out += bolt('1.5%', '50%') + bolt('98.5%', '50%');
  return out;
}

/**
 * The one instruction on the screen. The authority states the action; it does
 * not cheer, hype, or exclaim (style-guide §8, register 2).
 */
export const PROMPT = 'PRESS ANYWHERE TO ENTER';
/** The status under it: a condition, in the nouns of work. */
export const STATUS_LINE = 'OUTER DOOR SEALED · PRESSURE EQUALISED';

/** Escape a string for interpolation into markup. The wordmark is a constant
 *  today, but it is the one value here a rename moves, so it is escaped. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The whole screen as one markup string — pure, so the wording, the palette and
 * the paint order are all assertable headless (there is no jsdom in this repo;
 * `../platform/boot-error` takes the same shape for the same reason).
 */
export function titleGateHtml(options: GateHtmlOptions = {}): string {
  const canClip = options.canClip !== false;
  const { upper, lower } = splitWordmark(options.name ?? GAME_NAME);
  const base = TITLE.tracking / 100;
  const upperTrack = base + extraTracking(upper, lower);
  const lowerTrack = base + extraTracking(lower, upper);

  return (
    `<style>${FONT_FACE_CSS}` +
    '@keyframes pr-gate-prompt{0%,100%{opacity:.4}50%{opacity:1}}' +
    '@keyframes pr-gate-sheen{0%{background-position:150% 50%,0 0}18%{background-position:-60% 50%,0 0}100%{background-position:-60% 50%,0 0}}' +
    '</style>' +
    // The vacuum this all sits in. One canvas, punched at the doorway — the
    // design's SECOND field (the one behind the menu, never punched) is the real
    // Pixi menu here, which is the whole point of mounting this as an overlay.
    `<canvas id="${TITLE_GATE_SKY_ID}" style="position:absolute;left:0;top:0;width:100%;height:100%;display:block;z-index:0;"></canvas>` +
    // THE VAULT DOOR. A chamfered octagon rather than a circle, so it belongs to
    // the same family as the plates in the menu behind it. The leaves live
    // inside the frame's clip, which is why they read as retracting INTO the
    // hull instead of sliding across it.
    `<div id="${TITLE_GATE_DOOR_ID}" style="position:absolute;z-index:3;left:50%;top:50%;` +
    `width:min(${DOOR.widthOfVw * 100}vw,${DOOR.widthOfVh * 100}vh);aspect-ratio:${DOOR.aspect};` +
    'transform:translate(-50%,-50%) scale(var(--pr-gate-door-scale));opacity:var(--pr-gate-door-op);' +
    `transition:transform ${TRANSITION.frame}ms cubic-bezier(.42,0,.5,1), opacity ${TRANSITION.fade}ms linear;pointer-events:none;">` +
    jamb() +
    bolts() +
    // the opening: everything inside is clipped by it
    `<div style="position:absolute;inset:${DOOR.frame * 100}%;clip-path:${OPENING_CLIP};overflow:hidden;">` +
    leaf(upper, upperTrack, canClip, true) +
    leaf(lower, lowerTrack, canClip, false) +
    // the lock rides the upper leaf, because it is bolted through it
    `<div style="position:absolute;left:0;right:0;top:0;height:50%;transform:var(--pr-gate-leaf-top);transition:transform ${TRANSITION.leaf}ms cubic-bezier(.62,.02,.28,1);pointer-events:none;">` +
    lock() +
    '</div>' +
    '</div>' +
    '</div>' +
    // The prompt. Register 2 (style-guide §8): procedural, unglamorous, present
    // tense, and it names the action in its first three words.
    '<div style="position:absolute;z-index:4;left:0;right:0;bottom:max(3.4vh,22px);display:flex;flex-direction:column;align-items:center;gap:9px;' +
    `opacity:var(--pr-gate-prompt-op);transition:opacity ${TRANSITION.hazard}ms ease-out;pointer-events:none;">` +
    `<div style="display:flex;align-items:center;padding:10px 24px;border:1px solid #515861;background:linear-gradient(180deg,rgba(198,205,214,.1),rgba(198,205,214,0) 50%),linear-gradient(#383e45,#20252c);box-shadow:0 6px 20px rgba(${INK},.75);animation:pr-gate-prompt 2.1s ease-in-out infinite;">` +
    `<span style="font-family:Oxanium,system-ui,sans-serif;font-weight:800;font-size:clamp(10px,1.2vw,13px);letter-spacing:.3em;color:${BONE_WHITE};">${PROMPT}</span>` +
    '</div>' +
    `<span style="font-family:Oxanium,system-ui,sans-serif;font-weight:700;font-size:clamp(9px,1vw,11px);letter-spacing:.24em;color:#a5acb4;text-shadow:0 1px 3px rgba(${INK},.9);">${STATUS_LINE}</span>` +
    '</div>'
  );
}

// ---------------------------------------------------------------------------
// 6. The starfield
// ---------------------------------------------------------------------------

/** One star. Depth drives both drift speed and size, so the field reads as
 *  parallax rather than as confetti. */
interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
  readonly bloom: boolean;
  readonly tw: number;
  readonly tws: number;
  readonly depth: number;
  /** Flicker period, seconds, and this star's offset into it. */
  readonly fp: number;
  readonly fo: number;
}

/** Screen area per star at full quality. */
const STAR_AREA = 5200;
/** …and on a device `VfxAutoQuality` has throttled (GDD §4.3). */
const STAR_AREA_REDUCED = 14000;
/** The field's seed. `mulberry32`, never `Math.random` — the same rule the rest
 *  of the art follows, so the sky is the same sky on every engine (GDD §4.1). */
const STAR_SEED = 0x1a0501;

/** Build the field for a viewport. Deterministic. */
export function makeStars(view: GateView, reduced = false): readonly Star[] {
  const rnd = mulberry32(STAR_SEED);
  const area = reduced ? STAR_AREA_REDUCED : STAR_AREA;
  const n = Math.max(0, Math.round((view.width * view.height) / area));
  const stars: Star[] = [];
  for (let i = 0; i < n; i++) {
    const m = rnd.next();
    stars.push({
      x: rnd.next(),
      y: rnd.next(),
      r: 0.35 + m * m * 1.5,
      a: 0.22 + m * 0.62,
      bloom: rnd.next() < 0.045,
      tw: rnd.next() * 6.283,
      tws: 0.5 + rnd.next(),
      depth: 0.25 + m * m,
      fp: 5 + rnd.next() * 22,
      fo: rnd.next() * 25,
    });
  }
  return stars;
}

/** A colour stop sink — `CanvasGradient`'s one method. */
export interface GateGradient {
  addColorStop(offset: number, color: string): void;
}

/**
 * The slice of `CanvasRenderingContext2D` this screen uses.
 *
 * Declared rather than imported so the paint is testable with a recording fake
 * and so the module has no hard dependency on `lib.dom`; {@link browserGateDom}
 * does the one cast, in one place.
 */
export interface GateContext2D {
  fillStyle: string | GateGradient;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  fill(): void;
  save(): void;
  restore(): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): GateGradient;
}

/**
 * Paint the field and **punch the doorway out of it**.
 *
 * The field is painted OVER the menu so that the vacuum around the hull is
 * vacuum and not UI; erasing the opening is what makes the doorway the one place
 * the interior shows. `destination-out` is the erase — a second filled shape in
 * the ground colour would look identical in a screenshot and be a solid lid over
 * the menu, which is trap 1 exactly.
 */
export function paintSky(
  g: GateContext2D,
  view: GateView,
  stars: readonly Star[],
  ms: number,
  scale: number,
  punched: boolean,
): void {
  const { width: w, height: h } = view;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = GROUND;
  g.fillRect(0, 0, w, h);

  const nb = g.createRadialGradient(w * 0.74, h * 0.26, 0, w * 0.74, h * 0.26, Math.max(w, h) * 0.6);
  nb.addColorStop(0, `rgba(${NEBULA},0.09)`);
  nb.addColorStop(0.5, `rgba(${NEBULA},0.03)`);
  nb.addColorStop(1, `rgba(${INK},0)`);
  g.fillStyle = nb;
  g.fillRect(0, 0, w, h);

  for (const s of stars) {
    let tw = 0.82 + 0.18 * Math.sin(ms * 0.0009 * s.tws + s.tw);
    // An occasional hard flicker on top of the slow twinkle. Rare and short — a
    // field where everything shimmers reads as noise; one star catching now and
    // then is what makes it feel like a real sky being travelled through.
    const f = ((ms / 1000 + s.fo) % s.fp) / s.fp;
    if (f < 0.035) tw += 1.5 * Math.sin((f / 0.035) * Math.PI);
    const x = ((((s.x + ms * 0.0000042 * s.depth) % 1) + 1) % 1) * w;
    const y = s.y * h;
    if (s.bloom) {
      g.globalAlpha = s.a * tw * 0.22;
      g.fillStyle = '#cfd8e3';
      g.beginPath();
      g.arc(x, y, s.r * 5.5, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = Math.min(1, s.a * tw);
    g.fillStyle = '#e6ecf4';
    g.beginPath();
    g.arc(x, y, s.r * (tw > 1 ? 1.5 : 1), 0, 6.283);
    g.fill();
  }
  g.globalAlpha = 1;

  if (!punched) return;
  const poly = openingPolygon(view, scale);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  poly.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.closePath();
  g.fill();
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// 7. The DOM seam
// ---------------------------------------------------------------------------

/** What the gate needs the outside world to tell it about. */
export interface GateListeners {
  /** A press anywhere on the overlay. */
  readonly press: () => void;
  /** `Enter` or `Space` — the keyboard's version of the same press. */
  readonly enter: () => void;
  /** `Escape` — reseal. */
  readonly escape: () => void;
  /** The viewport changed shape. */
  readonly resize: () => void;
}

/**
 * The gate's whole DOM edge: **eight operations**, so the screen is one
 * `innerHTML` write plus ten CSS variables, and every one of them is fakeable in
 * a headless test. `../platform/boot-error` is the precedent — there is no jsdom
 * in this repo, and adding one to test a style write would be a poor trade.
 */
export interface GateDom {
  /** Create the overlay above the game canvas and write `html` into it. */
  mount(html: string, on: GateListeners): void;
  /** Take the overlay back out, and every listener with it. */
  unmount(): void;
  /** Set one CSS custom property on the overlay root. */
  setVar(name: string, value: string): void;
  /** Show or hide the overlay without unmounting it — how `open` goes inert. */
  setVisible(visible: boolean): void;
  /** Size the sky canvas and hand back its 2D context, or `null` if there is none. */
  sky(view: GateView, dpr: number): GateContext2D | null;
  /**
   * The door's CURRENT scale, mid-transition — measured off the element, never
   * assumed, because the punch has to track the frame while it grows (trap 3).
   */
  measureDoorScale(): number | null;
  /** The upper leaf's current vertical offset in px — measured, for the seal. */
  measureLeafOffset(): number | null;
  /** The live viewport and device pixel ratio. */
  view(): GateView & { readonly dpr: number };
  frame(cb: (ms: number) => void): number;
  cancelFrame(handle: number): void;
  timer(cb: () => void, ms: number): number;
  cancelTimer(handle: number): void;
}

/**
 * The one method the gate needs off `VfxAutoQuality`: feed it a frame's elapsed
 * seconds, get back whether reduce-VFX is engaged. Structural, so the screen
 * unit-tests against three lines and the platform passes the real reducer.
 */
export interface GateQuality {
  sample(seconds: number): boolean;
}

/** Everything the gate is wired to. */
export interface TitleGateOptions {
  readonly dom: GateDom;
  /**
   * The sound seam. The gate names an event; `src/art/audio` decides which cue,
   * the gain, the ducking and the ±0.5-semitone detune. **Nothing calls it on
   * mount** — the opening press is what arms audio (trap 5).
   */
  readonly sfx?: GateSfx;
  /**
   * Whether this device is already known to be throttled — a setting, a debug
   * flag, a host that has measured before. Read **per paint**, so a device that
   * recovers gets its field back.
   */
  readonly reduced?: () => boolean;
  /**
   * The auto-reducer this screen goes behind (GDD §4.3, risk 5) — structurally
   * `../platform/vfx-quality` `VfxAutoQuality`.
   *
   * The gate feeds it **its own** frame deltas rather than reading a shared
   * instance, because on a clean boot there is not one yet: the match's reducer
   * is constructed on the way into a world, and this screen is what the player
   * is looking at before there is a world. Two full-screen canvases repainting
   * every frame is fine on a desktop and is exactly the thing that needs a floor
   * on a phone, so the floor is the same class, sampled on the same signal.
   */
  readonly quality?: GateQuality;
  /** Whether `background-clip:text` is available (trap 4). */
  readonly canClip?: boolean;
  /**
   * May `Escape` reseal right now?
   *
   * On every screen the menu can be on — settings, the doors, the codex, the
   * hangar — `Escape` already means BACK, and a door closing over an open
   * settings panel is the wrong answer to the same key. The host is the only
   * thing that knows which screen is up, so the host answers. Absent, the gate
   * assumes it may (which is what a test and a standalone preview want).
   */
  readonly canReseal?: () => boolean;
  /** Called the moment we are through — the menu takes the screen from here. */
  readonly onThrough?: () => void;
  /** Called when a reseal has finished and the door is locked again. */
  readonly onSealed?: () => void;
}

// ---------------------------------------------------------------------------
// 8. The gate
// ---------------------------------------------------------------------------

/**
 * The title gate: mount it, and it operates a door.
 *
 * Everything it draws is decided by {@link gateVars} and {@link paintSky}, both
 * pure; this class owns the four beats' *timing*, the two measurements the
 * handoff insists on, and nothing else.
 */
export class TitleGate {
  private readonly dom: GateDom;
  private readonly sfx: GateSfx;
  private readonly opts: TitleGateOptions;

  private phase: GatePhase = 'locked';
  private mounted = false;
  private stars: readonly Star[] = [];
  private ctx: GateContext2D | null = null;
  private viewport: GateView = { width: 0, height: 0 };
  private raf: number | null = null;
  private readonly timers: number[] = [];
  /** Frames spent waiting for the leaves to come home — see {@link pollSeal}. */
  private sealFrames = 0;
  /**
   * Whether reduce-VFX is engaged **right now**. Two different things read it,
   * and they are not the same read:
   *
   *  - the **star count** is fixed at {@link resize}, because rebuilding the
   *    field mid-flight would pop half the sky out of existence in one frame;
   *  - the **clock** is read per paint ({@link fieldAnimates}), so a device that
   *    drops below the floor sheds the twinkle immediately, and one that
   *    recovers gets it back.
   */
  private reducedNow = false;
  /** The previous frame's timestamp, so the reducer is fed real deltas. */
  private lastFrameMs: number | null = null;

  constructor(options: TitleGateOptions) {
    this.opts = options;
    this.dom = options.dom;
    this.sfx = options.sfx ?? NO_GATE_SFX;
  }

  /** Where the door is. */
  get current(): GatePhase {
    return this.phase;
  }

  /**
   * Is the door in front of the screen and shut?
   *
   * The overlay already takes every POINTER — it covers the canvas the menu
   * listens on. Keys are the case that does not solve itself: both screens
   * listen on the same `window` and the menu registered first, so `Enter` behind
   * a closed door booted a match nobody could see. The host reads this and
   * ignores input while it is true.
   *
   * It is answered rather than enforced with `stopImmediatePropagation`, because
   * the window's keydown is ALSO what arms audio (`../art/audio/unlock`, risk 7)
   * — swallowing the event to protect the menu would cost a keyboard player the
   * sound of the door they just opened.
   */
  get modal(): boolean {
    return this.mounted && this.phase !== 'open';
  }

  /**
   * Put the door on the screen, sealed.
   *
   * **Silent by construction.** No cue is raised and no `AudioContext` is
   * constructed here or on any path reachable from here — browsers block audio
   * until a gesture, so a screen that tries to play on load is silent in every
   * browser AND wrong. `title-gate.test.ts` asserts it by name.
   */
  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.dom.mount(titleGateHtml(this.htmlOptions()), {
      press: () => this.press(),
      enter: () => this.press(),
      escape: () => this.reseal(),
      resize: () => this.resize(),
    });
    this.apply();
    this.resize();
    this.startLoop();
  }

  /** Take the whole screen back out — listeners, timers, frame loop and all. */
  dispose(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopLoop();
    this.clearTimers();
    this.ctx = null;
    this.dom.unmount();
  }

  /**
   * The opening press: **beat 1**.
   *
   * Refused unless the door is sealed, so a second press mid-sequence cannot
   * restart the machine half-way through — and so the press that lands on the
   * menu after we are through does not re-open a door that is no longer there.
   */
  press(): void {
    if (this.phase !== 'locked') return;
    this.clearTimers();
    // The one place a sound starts, and it starts on a gesture.
    this.sfx('gateUnlock');
    this.run(GATE_OPEN_STEPS, (phase) => {
      if (phase === 'open') this.through();
    });
  }

  /**
   * `Escape`: the same four beats, read backwards.
   *
   * Refused while already sealed or sealing. The last step is deliberately not
   * on {@link GATE_RESEAL_STEPS}: the lock may only throw once the leaves are
   * measurably home ({@link SEAL_FLOOR_MS}).
   */
  reseal(): void {
    if (this.phase === 'locked' || this.phase === 'closing' || this.phase === 'returning') return;
    if (!(this.opts.canReseal?.() ?? true)) return;
    this.clearTimers();
    this.dom.setVisible(true);
    this.sfx('gateReseal');
    this.startLoop();
    this.run(GATE_RESEAL_STEPS, (phase) => {
      if (phase === 'closing') this.beginSeal();
    });
  }

  /** Re-measure the viewport and rebuild the field. The through-scale is derived
   *  from the window, so a resize must recompute it. */
  resize(): void {
    if (!this.mounted) return;
    // A host that already knows (a setting, a debug flag) is honoured before the
    // first frame; the reducer's own verdict can only arrive after one.
    this.reducedNow = this.reducedNow || (this.opts.reduced?.() ?? false);
    const v = this.dom.view();
    this.viewport = { width: v.width, height: v.height };
    // The star COUNT is fixed here and only here — see `reducedNow`.
    this.stars = makeStars(this.viewport, this.reducedNow);
    this.ctx = this.dom.sky(this.viewport, v.dpr);
    // Sizing a canvas clears it, so paint here rather than waiting on a frame:
    // the field must be complete on the first one.
    this.paint(0);
    this.apply();
  }

  /** One animation frame. Public so a host can drive it, and so the loop is one
   *  line either way. */
  tick(ms: number): void {
    if (!this.mounted) return;
    this.sampleQuality(ms);
    if (this.phase === 'closing') this.pollSeal();
    if (this.phase === 'open') return;
    this.paint(ms);
  }

  /**
   * Feed the auto-reducer this frame's elapsed seconds and take its verdict.
   *
   * The first frame has no previous one to measure against, so it samples
   * nothing: a delta computed from zero is a 0 fps frame, and three of those
   * would engage the reducer on a machine that had not yet drawn anything.
   */
  private sampleQuality(ms: number): void {
    const previous = this.lastFrameMs;
    this.lastFrameMs = ms;
    const measured =
      previous !== null && ms > previous ? (this.opts.quality?.sample((ms - previous) / 1000) ?? false) : false;
    this.reducedNow = measured || (this.opts.reduced?.() ?? false);
  }

  // --- the beats ----------------------------------------------------------

  private run(steps: readonly GateStep[], after: (phase: GatePhase) => void): void {
    for (const step of steps) {
      if (step.at === 0) {
        this.setPhase(step.phase);
        after(step.phase);
        continue;
      }
      this.timers.push(
        this.dom.timer(() => {
          this.setPhase(step.phase);
          after(step.phase);
        }, step.at),
      );
    }
  }

  private setPhase(phase: GatePhase): void {
    this.phase = phase;
    this.apply();
  }

  /** Push {@link gateVars} at the root. Ten writes, no reconciliation. */
  private apply(): void {
    const vars = gateVars(this.phase, throughScale(this.viewport));
    for (const [name, value] of Object.entries(vars)) this.dom.setVar(name, value);
  }

  /** Beat 4. The overlay stops painting and stops taking input; the menu behind
   *  it is simply what is there. It is not unmounted, because `Escape` reseals
   *  and a door that has been removed cannot come back. */
  private through(): void {
    this.stopLoop();
    this.dom.setVisible(false);
    this.sfx('gateSeated');
    this.opts.onThrough?.();
  }

  /**
   * Wait for the leaves to be MEASURABLY shut before throwing the lock.
   *
   * Two earlier attempts failed for different reasons — a fixed dwell shorter
   * than the transition, then a `transitionend` gate that never fired. Reading
   * the leaf's actual offset each frame depends on neither: it is the thing we
   * care about, measured directly.
   */
  private beginSeal(): void {
    this.sealFrames = 0;
  }

  private pollSeal(): void {
    // Frames, not wall-clock: the host owns the clock, and a test that drives
    // `tick` by hand should not have to fake a monotonic one as well. At 60 Hz
    // the floor and the cap are the handoff's own numbers.
    this.sealFrames++;
    const elapsed = (this.sealFrames * 1000) / 60;
    const offset = this.dom.measureLeafOffset();
    const home = offset === null || offset <= SEAL_EPSILON_PX;
    if ((elapsed > SEAL_FLOOR_MS && home) || elapsed > SEAL_CAP_MS) {
      this.setPhase('locked');
      // The lock throwing back, and pressure returning to the compartment.
      this.sfx('gateSealed');
      this.opts.onSealed?.();
    }
  }

  // --- painting -----------------------------------------------------------

  private paint(ms: number): void {
    const g = this.ctx;
    if (!g || this.viewport.width <= 0 || this.viewport.height <= 0) return;
    // The punch tracks the door's REAL scale, measured mid-transition. Falling
    // back to the phase's target is right for every phase but `entering`, where
    // the target is where the door is GOING and the hole must be where it IS.
    const target = this.phase === 'entering' ? throughScale(this.viewport) : 1;
    const scale = this.dom.measureDoorScale() ?? target;
    // A throttled device gets a STILL field: the twinkle and the drift are the
    // only things a frozen clock costs, and they are the only things on this
    // screen that are decoration. See {@link fieldAnimates} for what is not.
    const clock = fieldAnimates(this.reducedNow, this.phase) ? ms : 0;
    paintSky(g, this.viewport, this.stars, clock, scale, this.phase !== 'open');
  }

  private startLoop(): void {
    if (this.raf !== null) return;
    const step = (ms: number): void => {
      this.raf = null;
      if (!this.mounted) return;
      this.tick(ms);
      // A device the auto-reducer has throttled gets a still field: the stars
      // stop twinkling and drifting, and the frame loop only survives to keep
      // the PUNCH tracking the door. Dropping the punch instead — the design's
      // own suggested reduction — would paint the doorway shut, which is the one
      // thing this screen may never do.
      if (this.phase === 'open') return;
      this.raf = this.dom.frame(step);
    };
    this.raf = this.dom.frame(step);
  }

  private stopLoop(): void {
    this.lastFrameMs = null; // a reseal must not measure the time we spent through
    if (this.raf === null) return;
    this.dom.cancelFrame(this.raf);
    this.raf = null;
  }

  private clearTimers(): void {
    for (const t of this.timers) this.dom.cancelTimer(t);
    this.timers.length = 0;
  }

  private htmlOptions(): GateHtmlOptions {
    return this.opts.canClip === undefined ? {} : { canClip: this.opts.canClip };
  }
}

/**
 * Whether a paint should animate, or hold still and only keep the punch true.
 *
 * **The honest reduction, and what it is NOT.** The handoff's own suggestion for
 * a throttled phone is *"a single field with the punch dropped"* — which was the
 * right answer for a prototype with two identical starfields, where dropping the
 * front one changed nothing you could see. Here the punch is the only thing
 * making the doorway a hole, and dropping it paints the menu shut: the reduction
 * would break the invariant the screen exists for. So what goes instead is the
 * twinkle and the drift — the two things on this canvas that are decoration —
 * plus most of the stars ({@link STAR_AREA_REDUCED}). The frame loop survives at
 * a fixed clock purely so the hole keeps tracking the door while it grows, which
 * is one and a half seconds, once.
 */
export function fieldAnimates(reduced: boolean, phase: GatePhase): boolean {
  if (!reduced) return true;
  return phase === 'entering';
}

// ---------------------------------------------------------------------------
// 9. The browser adapter
// ---------------------------------------------------------------------------

/** The handful of globals {@link browserGateDom} needs, so a caller can pass a
 *  stand-in and so this file names its dependency on `lib.dom` in one place. */
export interface GateBrowser {
  readonly document: Document;
  readonly window: Window & typeof globalThis;
  /** Where the overlay goes: `#app`, above the game canvas. */
  readonly mount: HTMLElement;
}

/**
 * The real DOM, wired to {@link GateDom}.
 *
 * This is the only function in the file that touches a browser, and it is the
 * only place a cast happens: `CanvasRenderingContext2D` is narrowed to
 * {@link GateContext2D} — a mutable `fillStyle` and a
 * `GlobalCompositeOperation` union do not structurally match a hand-declared
 * slice, and widening the slice to match `lib.dom` would put the whole of it in
 * every test's way for no assertion gained.
 */
export function browserGateDom(browser: GateBrowser): GateDom {
  const { document: doc, window: win, mount: host } = browser;
  let root: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let door: HTMLElement | null = null;
  let leaf: HTMLElement | null = null;
  let unbind: (() => void)[] = [];

  /** A CSS transform's `translateY`/`scale`, read off the live computed style —
   *  which is what "measured, never assumed" means in a browser. */
  const matrix = (el: HTMLElement | null): DOMMatrixReadOnly | null => {
    if (!el || typeof win.getComputedStyle !== 'function') return null;
    const t = win.getComputedStyle(el).transform;
    if (!t || t === 'none') return null;
    try {
      return new win.DOMMatrixReadOnly(t);
    } catch {
      return null;
    }
  };

  return {
    mount(html, on) {
      const el = doc.createElement('div');
      el.id = TITLE_GATE_ID;
      // `fixed`, not `absolute`: the overlay is measured against the real window
      // exactly as `throughScale` is, and `#app` carries the safe-area padding.
      el.style.cssText =
        `position:fixed;inset:0;overflow:hidden;z-index:20;background:${GROUND};` +
        'font-family:Oxanium,system-ui,sans-serif;cursor:var(--pr-gate-cursor,pointer);' +
        'touch-action:none;-webkit-tap-highlight-color:transparent;';
      el.innerHTML = html;
      host.appendChild(el);
      root = el;
      canvas = el.querySelector<HTMLCanvasElement>(`#${TITLE_GATE_SKY_ID}`);
      door = el.querySelector<HTMLElement>(`#${TITLE_GATE_DOOR_ID}`);
      leaf = el.querySelector<HTMLElement>(`#${TITLE_GATE_LEAF_ID}`);

      const press = (): void => on.press();
      const key = (e: KeyboardEvent): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          on.enter();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          on.escape();
        }
      };
      const resize = (): void => on.resize();
      el.addEventListener('pointerdown', press);
      win.addEventListener('keydown', key);
      win.addEventListener('resize', resize);
      unbind = [
        () => el.removeEventListener('pointerdown', press),
        () => win.removeEventListener('keydown', key),
        () => win.removeEventListener('resize', resize),
      ];
    },
    unmount() {
      for (const off of unbind) off();
      unbind = [];
      root?.remove();
      root = null;
      canvas = null;
      door = null;
      leaf = null;
    },
    setVar(name, value) {
      root?.style.setProperty(name, value);
    },
    setVisible(visible) {
      if (!root) return;
      root.style.opacity = visible ? '1' : '0';
      // Not `display:none`: `Escape` has to reach the window listener, and the
      // overlay must stop eating the menu's presses the instant we are through.
      root.style.pointerEvents = visible ? 'auto' : 'none';
      root.style.visibility = visible ? 'visible' : 'hidden';
    },
    sky(view, dpr) {
      if (!canvas) return null;
      canvas.width = Math.max(1, Math.round(view.width * dpr));
      canvas.height = Math.max(1, Math.round(view.height * dpr));
      const g = canvas.getContext('2d');
      if (!g) return null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return g as unknown as GateContext2D;
    },
    measureDoorScale() {
      const m = matrix(door);
      return m ? Math.abs(m.a) : null;
    },
    measureLeafOffset() {
      const m = matrix(leaf);
      return m ? Math.abs(m.f) : null;
    },
    view() {
      return {
        width: win.innerWidth,
        height: win.innerHeight,
        dpr: Math.min(2, win.devicePixelRatio || 1),
      };
    },
    frame: (cb) => win.requestAnimationFrame(cb),
    cancelFrame: (h) => win.cancelAnimationFrame(h),
    timer: (cb, ms) => win.setTimeout(cb, ms),
    cancelTimer: (h) => win.clearTimeout(h),
  };
}
