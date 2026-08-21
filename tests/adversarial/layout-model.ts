/**
 * tests/adversarial/layout-model.ts — **the rule, in one place.** OWNER: QA
 * Agent (a0-122).
 *
 * Six overlap defects shipped in four days — a0-97, a0-100, a0-114, a0-115,
 * a0-116, a0-119 — and every one of them was found by a person looking at a
 * screenshot. CI was green for all six, because a golden compares a frame to
 * yesterday's frame and a frame that was always wrong stays wrong quietly.
 *
 * a0-106 established the shape of the answer for bot behaviour: **one instrument,
 * run across a cross-product, finds the whole class instead of one instance.**
 * This module is that instrument's rule half; `./layout-frames` is its census
 * half; `./layout-overlap.test.ts` is the standing gate over both.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * > **An element a player must read or press may not be covered by another
 * > element drawn after it.**
 *
 * Three words in that sentence are load-bearing, and each one is a defect this
 * repo already shipped:
 *
 *  - **"must read or press"** — not every intersection is a bug. A scrim under a
 *    readout intersects it by design (a0-102's ground), the touch sticks sit
 *    under whatever the fight puts above them, and a nameplate passing behind
 *    the HUD is the world passing behind the HUD. So every painted thing
 *    declares a {@link Role}, and only `read` and `press` can be the *victim* of
 *    a cover. A blanket "no two rects may intersect" fails on all of the above
 *    and teaches everyone to ignore the gate — the argument
 *    `src/ui/layout-exclusions.ts` makes for keeping its own table short.
 *  - **"covered by"** — a rect test, never a point test. a0-98 asked
 *    `elementFromPoint` at one point per control and a button taking the top
 *    third of the HOST plate answered "clear" (a0-114 §2). {@link covers} is
 *    therefore the same rect-overlap convention `src/ui/refusal-strip.ts`
 *    `overlaps` and `src/ui/layout-exclusions.ts` `rectOverlap` use — touching
 *    edges are not a cover — imported from there rather than restated, so one
 *    suite cannot mean two things by "clear".
 *  - **"drawn after it"** — the asymmetry is the whole reason the rule can be
 *    stated once instead of as a table of pairs. A scrim drawn BEFORE a readout
 *    is a ground; the same rect drawn AFTER it is a cover. Draw order is what
 *    tells those two apart, and it is exactly what the layout registry does not
 *    record (see the header of `./layout-frames`).
 *
 * ── WHAT COUNTS AS A DECLARED EXCEPTION ─────────────────────────────────────
 *
 * a0-115 established that some elements legitimately sit inside others. That is
 * real and it is narrow, so it is declared per pair with an argument attached —
 * {@link LAYOUT_ALLOWANCES}, the same shape and the same motive as
 * `src/ui/layout-exclusions.ts` `LAYOUT_EXCLUSIONS` and `src/ui/anchor-reach.ts`
 * `LAYOUT_RESERVATIONS`: id, id, and the reason a future change has to beat
 * before it deletes the row. **Never a silent skip**: a coverage hole that is
 * not written down reads as coverage.
 *
 * ── THE DOM HALF ────────────────────────────────────────────────────────────
 *
 * Two of the six defects were DOM drawn over canvas — a0-97's corner DOWNLOAD
 * LOG over the settings screen's DONE plate, and a0-114's refusal panel over the
 * doors — and neither is in the layout registry at all, which is why a rect
 * sweep of registry entries alone would have scored both clean. So a {@link
 * Painted} carries a {@link Surface}, DOM paints above every canvas element
 * whatever the canvas draw order was, and {@link foreignTopmost} asks a0-114's
 * question at a0-114's nine points: *at the control's own reported coordinates,
 * what answers?* That is `elementFromPoint` reproduced headlessly, and it is the
 * check that catches a cover the registry cannot see.
 *
 * Pure and DOM-free: rects in, findings out. No Pixi, no browser, no sim.
 */

import type { Rect } from '@platform/layout-registry';
import { rectOverlap } from '../../src/ui/layout-exclusions';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * What a painted thing is FOR — and therefore whether being covered is a defect.
 *
 *  - `read`  — type a player has to read: a readout, a headline, a failure line,
 *              a name. Covering it is the defect a0-114, a0-115, a0-116 and
 *              a0-119 all are.
 *  - `press` — a control a player has to hit: a plate, a door, a key, a wedge.
 *              Covering it is a0-97 and a0-100. Note that a control drawn over
 *              the control you are aiming at is the bug **whether or not it
 *              swallows the press** — a0-97's ruling, re-affirmed by a0-114's
 *              two-press fork, so this sweep never asks about `pointer-events`.
 *  - `ground` — decoration and structure: scrims, beams, backdrops, rules,
 *              frames. It cannot be the victim of a cover (that is what makes a
 *              scrim under a readout legal by construction rather than by
 *              exception) but it is still painted, so it can be the *coverer* —
 *              an opaque beam drawn over a live plate is a real defect.
 *  - `world` — a mark that belongs to the world rather than to the HUD: an
 *              over-ship health bar, a minimap dot. It is not the victim of HUD
 *              chrome passing over it (a0-102's whole argument), and it is not
 *              type, so it is not a0-115 either.
 */
export type Role = 'read' | 'press' | 'ground' | 'world';

/** Which layer the thing is painted on. DOM is over canvas, always and
 *  everywhere: it is a `position:fixed` element at the top of the stacking
 *  context (`src/net/playtest-log-button.ts` uses the platform's own maximum
 *  z-index, `src/net/connect-trace-view.ts` one below it), so no canvas draw
 *  order can put anything above it. */
export type Surface = 'canvas' | 'dom';

/** One thing this frame puts on the glass. */
export interface Painted {
  /** Stable id — a layout-registry id where one exists, so a finding here and a
   *  `?debug=1` readback name the same thing. */
  readonly id: string;
  readonly role: Role;
  readonly surface: Surface;
  /** Where it was drawn, screen space CSS px, origin top-left, y-down — the
   *  registry's convention throughout. */
  readonly bounds: Rect;
  /** Paint order within the frame: bigger is later, and later is on top.
   *  Assigned by {@link layer}; never typed by hand. */
  readonly z: number;
  /** What it is, in words, for the failure message and the report. */
  readonly note: string;
}

/** A {@link Painted} before it has been given its paint order. */
export type Unlayered = Omit<Painted, 'z'>;

/** One frame of one state at one viewport: everything on the glass, in order. */
export interface Frame {
  /** The state's id (`./layout-frames` `STATES`). */
  readonly state: string;
  /** The viewport's id (`./layout-frames` `VIEWPORTS`). */
  readonly viewport: string;
  readonly painted: readonly Painted[];
}

/**
 * Stamp paint order onto a state's element list.
 *
 * `canvas` elements take their order from the array — the order the scene graph
 * draws them, which the census builds in the order `src/ui`'s views add their
 * children. Every `dom` element is then lifted above all of them, keeping its
 * own relative order. The lift is what encodes a0-97 and a0-114: the corner log
 * button and the refusal panel are on top of whatever the canvas drew there, on
 * every viewport, and no amount of canvas re-ordering changes that.
 */
export function layer(items: readonly Unlayered[]): Painted[] {
  const canvas = items.filter((p) => p.surface === 'canvas');
  const dom = items.filter((p) => p.surface === 'dom');
  const out: Painted[] = [];
  canvas.forEach((p, i) => out.push({ ...p, z: i }));
  dom.forEach((p, i) => out.push({ ...p, z: DOM_FLOOR + i }));
  return out;
}

/** The z every DOM element starts above. Larger than any plausible canvas list,
 *  so "DOM is on top" is arithmetic rather than a comparison special case. */
export const DOM_FLOOR = 1_000_000;

// ---------------------------------------------------------------------------
// The declared exceptions
// ---------------------------------------------------------------------------

/**
 * `over` may be drawn on top of `under`, in these states, for this reason.
 *
 * The table is short on purpose and every row is an argument, not a mute. The
 * two kinds of row here are the two kinds a0-115 identified:
 *
 *  1. **Nested by design** — a control drawn inside its own surface (the wheel's
 *     hub disc, a settings row's `?` square, a browse row's JOIN button). These
 *     are one thing at two levels of detail, and the inner one being on top is
 *     the design.
 *  2. **A part registered in its own right** — `banked-total` is the numeral
 *     inside the `ore-hud` cluster and `describeLayout` publishes both, so the
 *     cluster's own rect "covers" its own numeral. That is a fact about the
 *     registry's id list, not about the screen.
 *
 * `states` narrows a row to the screens whose design actually argues for it; a
 * row with no `states` holds everywhere. Anything not in this table and not
 * excluded by {@link Role} is a defect, including things that look obviously
 * fine — the six briefs above all looked obviously fine in the code.
 *
 * **Every row here fires.** `./layout-overlap.test.ts` asserts it, the same
 * discipline `src/ui/anchor-reach.ts`'s reservations keep: a row that excuses
 * nothing is a row nobody can tell is wrong, and the way this table rots is by
 * accumulating speculative permissions for pairs the sweep never sees. A pair
 * that stops overlapping is a row to delete, and the test says so by name.
 */
export interface Allowance {
  /** The id drawn later. */
  readonly over: string;
  /** The id it may sit on top of. */
  readonly under: string;
  /** The state ids this holds on, or every state when absent. */
  readonly states?: readonly string[];
  /** Why. The argument a future change must beat before deleting the row. */
  readonly why: string;
}

export const LAYOUT_ALLOWANCES: readonly Allowance[] = [
  {
    over: 'banked-total',
    under: 'ore-hud',
    why:
      'the banked numeral IS the ore cluster’s second row — `Hud.describeLayout` registers ' +
      'the cluster and the numeral inside it as two ids (a0-115 lists both in HUD_READOUT_IDS ' +
      'for exactly this reason), so the pair overlapping is the id list, not the screen',
  },
  {
    over: 'settings-help',
    under: 'settings-row',
    why:
      'the `?` square is hung off its own row’s leading edge (a0-77) — one control nested in ' +
      'the row it explains, and the row is not a press target where the square is',
  },
  {
    over: 'alarm-arrow',
    under: 'minimap',
    // The a0-116 fix pulls the arrow off `HUD_READOUT_IDS`, and that list leaves
    // the minimap out ON PURPOSE and says why: *"a map of the world is a world
    // surface, and a name over it is a name over the thing it names."* The arrow
    // is a world mark by the same argument — it says where the world is. Measured
    // across all 360 bearings the sweep runs: it reaches at most 3% of the map's
    // rect and never its centre, so the tap that expands the map is untouched.
    why: 'the minimap is deliberately not a keep-out (a0-115’s list, reused by a0-116) — a world mark over a world surface',
  },
  {
    over: 'alarm-frame-bottom',
    under: 'controls-strip',
    // `ALARM_FRAME_STROKE` is 4px hard against the viewport edge, and the strip's
    // band runs to that same edge, so the two meet by construction on every
    // viewport that draws a strip. What the border crosses is the band's outermost
    // 4px — the scrim's bleed, not its type, which sits a row up. Modelled as four
    // bars rather than one filled rect precisely so this stays a claim about 4px
    // and never becomes "the alarm frame may cover anything".
    why: 'the frame is the screen’s own 4px border and the strip’s band runs to the same glass edge — it crosses the scrim’s bleed, not the type',
  },
  {
    over: 'alarm-frame-left',
    under: 'controls-strip',
    why: 'the alarm frame IS the screen’s border — 4px of stroke on the glass edge (see alarm-frame-bottom)',
  },
  {
    over: 'alarm-frame-right',
    under: 'controls-strip',
    why: 'the alarm frame IS the screen’s border — 4px of stroke on the glass edge (see alarm-frame-bottom)',
  },
  {
    over: 'entry-eyebrow',
    under: 'entry-title',
    // Both rects are allocations of ONE header beam, not two drawn things:
    // `lobby-geometry` `entryLayout` gives the eyebrow cluster the beam's left
    // share and centres the wordmark across the WHOLE beam, *"and the view shrinks
    // the wordmark (never the cluster) if the two would collide."* The shrink is
    // in `lobby-entry-view`, measured against real text, so a headless model that
    // treats `title` as an ink box is asking the wrong question about it. This is
    // the one row here that is a limit of the MODEL rather than a fact about the
    // screen, and it is called out as such in the report.
    why: 'EntryLayout.title is the beam the wordmark is centred IN, not the wordmark’s ink; the view shrinks the wordmark if the two would really collide',
  },
];

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** Does `over` share pixels with `under`? Touching edges are not a cover — the
 *  convention `src/ui/layout-exclusions.ts` `rectOverlap` sets and this imports
 *  rather than restates. */
export function covers(over: Rect, under: Rect): Rect | null {
  return rectOverlap(over, under);
}

/** One element covering another it may not cover. */
export interface Cover {
  readonly state: string;
  readonly viewport: string;
  /** The element that must be read or pressed, and is not fully visible. */
  readonly victim: Painted;
  /** The element drawn after it, on top of it. */
  readonly coverer: Painted;
  /** The shared rect. Never zero-area. */
  readonly overlap: Rect;
  /** How much of the victim's own box is under the coverer, 0..1. */
  readonly fraction: number;
}

/** Is this pair declared? */
export function allowed(
  state: string,
  over: string,
  under: string,
  rules: readonly Allowance[] = LAYOUT_ALLOWANCES,
): Allowance | undefined {
  return rules.find(
    (r) => r.over === over && r.under === under && (r.states === undefined || r.states.includes(state)),
  );
}

/**
 * Every cover in a frame — the rule, applied.
 *
 * Ordered pairs, not unordered ones: `(A, B)` and `(B, A)` are different
 * questions and only one of them can be a defect, because only one of the two
 * was drawn later. That is what lets a scrim sit under a readout without a row
 * in {@link LAYOUT_ALLOWANCES} to excuse it.
 */
export function coversInFrame(
  frame: Frame,
  rules: readonly Allowance[] = LAYOUT_ALLOWANCES,
): Cover[] {
  const out: Cover[] = [];
  for (const victim of frame.painted) {
    if (victim.role !== 'read' && victim.role !== 'press') continue;
    const area = Math.max(0, victim.bounds.width) * Math.max(0, victim.bounds.height);
    for (const coverer of frame.painted) {
      if (coverer === victim || coverer.z <= victim.z) continue;
      if (allowed(frame.state, coverer.id, victim.id, rules)) continue;
      const overlap = covers(coverer.bounds, victim.bounds);
      if (!overlap) continue;
      out.push({
        state: frame.state,
        viewport: frame.viewport,
        victim,
        coverer,
        overlap,
        fraction: area > 0 ? (overlap.width * overlap.height) / area : 1,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The elementFromPoint half (a0-98's mistake, a0-114's fix)
// ---------------------------------------------------------------------------

/**
 * The nine points a0-114 probes on a control: its centre, its four edge
 * midpoints, and its four corners — off the box **the client itself reported**,
 * not off numbers typed into the probe.
 *
 * Nine and not one because one is what a0-98 asked. HOST is
 * `{x:403,y:141.5,w:372,h:62}`, the refusal's buttons ended at `y≈160`, and the
 * centre is at `y=172.5`: `elementFromPoint(589,173)` answered `CANVAS#app`,
 * correctly, on a frame where the top of the word HOST was under an opaque
 * button. Its `top-left` answers `BUTTON#pr-connect-trace-download`.
 *
 * The corners are pulled a hair inside the box so a point exactly on the shared
 * edge of two abutting plates does not answer "the neighbour" — the same
 * touching-is-not-covering convention {@link covers} keeps.
 */
export function probePoints(r: Rect): Array<{ readonly name: string; readonly x: number; readonly y: number }> {
  const e = 0.5;
  const l = r.x + e;
  const cx = r.x + r.width / 2;
  const rt = r.x + r.width - e;
  const t = r.y + e;
  const cy = r.y + r.height / 2;
  const b = r.y + r.height - e;
  return [
    { name: 'centre', x: cx, y: cy },
    { name: 'top', x: cx, y: t },
    { name: 'bottom', x: cx, y: b },
    { name: 'left', x: l, y: cy },
    { name: 'right', x: rt, y: cy },
    { name: 'top-left', x: l, y: t },
    { name: 'top-right', x: rt, y: t },
    { name: 'bottom-left', x: l, y: b },
    { name: 'bottom-right', x: rt, y: b },
  ];
}

/** `elementFromPoint`, headless: the last-painted thing containing the point. */
export function topmostAt(frame: Frame, x: number, y: number): Painted | null {
  let best: Painted | null = null;
  for (const p of frame.painted) {
    const r = p.bounds;
    if (r.width <= 0 || r.height <= 0) continue;
    if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
    if (best === null || p.z > best.z) best = p;
  }
  return best;
}

/** A control whose own reported coordinates answer something else. */
export interface Foreign {
  readonly state: string;
  readonly viewport: string;
  readonly control: Painted;
  /** Which of the nine points answered somebody else. */
  readonly points: ReadonlyArray<{ readonly name: string; readonly answered: string }>;
}

/**
 * a0-114's `Verdict.foreign`, over a whole frame: for every element a player
 * must read or press, probe its own nine points and report the ones that answer
 * a **foreign** element — anything that is neither the control itself nor
 * something it is declared to sit under.
 *
 * Deliberately not a list of ids on the cover side. a0-98's `collides` asked
 * "is the topmost element the corner affordance, by id", so the refusal panel's
 * second DOWNLOAD LOG — a different element with different ids — went into the
 * readback truthfully and was then scored `false`. A cover is anything foreign.
 */
export function foreignTopmost(
  frame: Frame,
  rules: readonly Allowance[] = LAYOUT_ALLOWANCES,
): Foreign[] {
  const out: Foreign[] = [];
  for (const control of frame.painted) {
    if (control.role !== 'read' && control.role !== 'press') continue;
    const hits: Array<{ name: string; answered: string }> = [];
    for (const pt of probePoints(control.bounds)) {
      const top = topmostAt(frame, pt.x, pt.y);
      if (!top || top === control) continue;
      if (top.z < control.z) continue; // behind it: a ground, not a cover
      if (allowed(frame.state, top.id, control.id, rules)) continue;
      hits.push({ name: pt.name, answered: top.id });
    }
    if (hits.length > 0) out.push({ state: frame.state, viewport: frame.viewport, control, points: hits });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** `{x, y, w×h}` at one decimal — the format a0-100's violations print in. */
export function fmt(r: Rect): string {
  const n = (v: number): string => (Math.round(v * 10) / 10).toString();
  return `{${n(r.x)},${n(r.y)} ${n(r.width)}×${n(r.height)}}`;
}

/** The stable key a pinned defect is listed under: `state | viewport | over | under`. */
export function coverKey(c: Cover): string {
  return `${c.state} | ${c.viewport} | ${c.coverer.id} | ${c.victim.id}`;
}

/** One cover as a line a human can act on. */
export function coverLine(c: Cover): string {
  return (
    `${coverKey(c)} — ${c.coverer.id} ${fmt(c.coverer.bounds)} [${c.coverer.surface}] ` +
    `covers ${Math.round(c.fraction * 100)}% of ${c.victim.id} ${fmt(c.victim.bounds)} ` +
    `(${c.victim.role}) at ${fmt(c.overlap)} — ${c.victim.note} under ${c.coverer.note}`
  );
}

/** The stable key a pinned probe finding is listed under. */
export function foreignKey(f: Foreign): string {
  return `${f.state} | ${f.viewport} | ${f.control.id}`;
}

/** One foreign-topmost finding as a line, with the points that answered. */
export function foreignLine(f: Foreign): string {
  return (
    `${foreignKey(f)} — ${f.control.id} ${fmt(f.control.bounds)} answers foreign at ` +
    f.points.map((p) => `${p.name}→${p.answered}`).join(', ')
  );
}
