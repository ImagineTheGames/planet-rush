/**
 * src/ui/anchor-reach.ts — "and it actually reaches the corner". OWNER: UI Engineer.
 *
 * The layout registry (`@platform/layout-registry`) asks one question per
 * element: *are the bounds inside the declared anchor's zone?* — `withinAnchor`.
 * a0-103 is the proof that the question is only half of the contract.
 *
 * QA measured the phone HUD off the client's own registry at 798×384:
 *
 *     minimap      (586, 292) 80×80  →  132 px from the right edge
 *     station-hp   ends at 782.5     →   15.5 px from the right edge
 *     zoom-control ends at 782       →   16 px from the right edge
 *
 * The minimap declares `bottom-right`. So does the desktop minimap, which sits
 * 12 px off the right edge. Same element, same declared anchor, an order of
 * magnitude apart — **and the anchor check was green on both.** It had to be:
 * `bottom-right`'s zone is the right HALF of the screen by the bottom THIRD, so
 * an 80 px square anywhere in a 383×116 region satisfies it. A check that a
 * sixth of the screen of drift cannot fail is not a check.
 *
 * ── WHAT THIS MODULE ADDS ──────────────────────────────────────────────────
 *
 * The other half: *does the element reach the edges its anchor names?* A region
 * called `bottom-right` promises two screen edges, and {@link reachViolations}
 * holds the element to both. Containment says "no further out than the margin";
 * reach says "no further IN than the margin". Together they pin an element to
 * its corner instead of to a quadrant. Neither implies the other, and this file
 * deliberately does not re-check containment — `withinAnchor` already owns it,
 * and a negative gap here (an element hanging off the screen) is that check's
 * finding, not this one's.
 *
 * ── THREE THINGS IT IS CAREFUL ABOUT ───────────────────────────────────────
 *
 * **1. Not every region names an edge** ({@link ANCHOR_EDGES}). `full` and
 * `center` name a zone, which is exactly why the onboarding prompt chose `full`
 * (`./hud` `describeLayout`'s table) — a centred prompt promises no bezel.
 * `bottom-strip` is a band `stripHeight` tall, so containment alone already pins
 * it to the bottom; adding a reach rule there would restate the zone. And
 * `left-half-bottom` / `right-half-bottom` are half-screen QUADRANTS naming a
 * thumb's reach, not a bezel: a stick is placed under a thumb. Only the six
 * corner-and-edge regions carry a promise, and the table says which.
 *
 * **2. The frame is not always the viewport** ({@link ReachOptions.frameFor}).
 * a0-74 bound the HUD's chrome to a centred reference-aspect content box
 * (`./viewport` `contentBox`) after the developer reported *"i have an ultra
 * wide and all that UI goes to the edges of the screens"*. On a 32:9 display
 * `station-hp` is ~336 px from the physical right edge **on purpose**, and a
 * reach check that measured to the glass would flag the fix as the bug. So
 * every element is measured against the frame it was laid out in, and
 * {@link CONTENT_BOUND_IDS} is the list of ids for which that frame is the
 * content box rather than the viewport. Since a0-125 that distinction has a
 * name — {@link LayoutSurface} — and a check of its own,
 * {@link cornerRivals}: an anchor says WHERE an element goes and cannot say
 * WHOSE BOX it goes in, and two elements reaching one corner from two boxes
 * satisfied both halves of this contract while covering each other.
 *
 * **3. A real gap is allowed only if something declares it**
 * ({@link LAYOUT_RESERVATIONS}). Some elements genuinely cannot touch their
 * edge: the desktop minimap lifts clear of the controls strip, the zoom control
 * hangs below the HOME cluster, the ping stamp stacks over the build stamp.
 * Those are reservations, and the brief that asked for this check asked that
 * they be *stated* rather than left as a number nothing explains. The table
 * below is that statement: an id, an edge, how many pixels, and the argument.
 * A gap with no row is a bug; a row with no argument is not a row.
 *
 * ── WHY IT LIVES HERE AND NOT UPSTAIRS ─────────────────────────────────────
 *
 * Same reasoning, verbatim, as `./layout-exclusions`: the natural home for a
 * placement contract is the registry itself, beside `resolveAnchor` and
 * `withinAnchor`. That file is Platform's and its anchor vocabulary is a
 * ratified contract; extending it is not a UI Engineer's unilateral call. So the
 * facility lives in a file this agent owns, written in the registry's own
 * vocabulary — {@link LayoutEntry} in, violations out, ids and `Rect`s
 * throughout — with a signature that takes the entries rather than reaching for
 * them. Move {@link ANCHOR_EDGES}, {@link LAYOUT_RESERVATIONS} and
 * {@link reachViolations} into the registry verbatim and every caller and every
 * test still compiles.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * registry's convention, unchanged.
 */

import type { AnchorRegion, AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { rectOverlap } from './layout-exclusions';
import { glassCornerReserve, ORE_LABEL_LEADING, stationChromeHeight } from './hud-geometry';
import { hudMetrics, hudSpace, SCRIM_CORE } from './instrument';
import { MINIMAP_FIRE_COLUMN, MINIMAP_STRIP_CLEARANCE } from './minimap';
import { ZOOM_CONTROL_GAP } from './zoom-control';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** A side of the frame an element is laid out in. */
export type ScreenEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * The screen edges each anchor region PROMISES its element will reach.
 *
 * Read it as the second half of the region's meaning: `bottom-right` does not
 * merely mean "somewhere in the bottom-right quadrant", it means "in the
 * bottom-right CORNER" — and a corner is two edges. The empty rows are argued in
 * the file header; they are exemptions with reasons, not omissions.
 */
export const ANCHOR_EDGES: Readonly<Record<AnchorRegion, readonly ScreenEdge[]>> = {
  'top-left': ['left', 'top'],
  'top-center': ['top'],
  'top-right': ['right', 'top'],
  'bottom-left': ['left', 'bottom'],
  'bottom-center': ['bottom'],
  'bottom-right': ['right', 'bottom'],
  // A band `stripHeight` tall along the bottom: being inside the zone already
  // means being within that band of the bottom edge, so a reach rule here would
  // only restate `withinAnchor`. The strip's own content is centred text and
  // does not span the width, so 'left'/'right' would be wrong as well.
  'bottom-strip': [],
  // Half-screen quadrants. They name where a THUMB can reach, not a bezel — the
  // sticks are drawn under the thumb by design (`@platform/touch-visuals`), and
  // the engaged stick is dynamic besides.
  'left-half-bottom': [],
  'right-half-bottom': [],
  // Interior zones. `center` is the middle third both ways, and `full` is the
  // whole viewport — the anchor an overlay takes precisely because it is making
  // no claim about an edge (`./hud` `describeLayout`, the onboarding row).
  center: [],
  full: [],
};

/** The edges a declared region promises, or `[]` when it promises none. */
export function anchorEdges(region: AnchorRegion): readonly ScreenEdge[] {
  return ANCHOR_EDGES[region] ?? [];
}

/**
 * Clear space between one edge of `bounds` and the same edge of `frame`, CSS px.
 *
 * Positive is the normal case (the element sits inside). **Negative means the
 * element hangs off that side**, which is `withinAnchor`'s finding rather than
 * this module's — see the header.
 */
export function edgeGap(bounds: Rect, frame: Rect, edge: ScreenEdge): number {
  switch (edge) {
    case 'left':
      return bounds.x - frame.x;
    case 'right':
      return frame.x + frame.width - (bounds.x + bounds.width);
    case 'top':
      return bounds.y - frame.y;
    case 'bottom':
      return frame.y + frame.height - (bounds.y + bounds.height);
  }
}

// ---------------------------------------------------------------------------
// Reservations — the only legal reason a gap is bigger than the margin
// ---------------------------------------------------------------------------

/** What a reservation gets to look at when it decides how much it claims. */
export interface ReservationContext {
  /** The frame the element was laid out in — viewport, or the HUD content box. */
  readonly frame: Rect;
  /** Touch build? Decides whether the desktop controls strip is on screen at
   *  all (`./controls-strip` `showControlsStrip`), which is what two of the rows
   *  below are clearing. */
  readonly isTouch: boolean;
  /**
   * Is a touch FIRE button drawn in the bottom-right corner this frame?
   * (`./live-controls` `liveOnGlassControls`.) Not `isTouch`: since a0-30 the
   * default scheme on every platform is Tap Commander, which draws no FIRE at
   * all, and Manual mode trades the button for an aim stick. Default `false` —
   * an unreserved corner is the honest default, exactly as it is in `./minimap`
   * `collapsedRect`.
   */
  readonly fireCorner?: boolean;
  /**
   * Is the re-enter-fullscreen affordance drawn this frame
   * (`FullscreenLifecycle.affordanceVisible`)? Not `isTouch`: the button appears
   * only after a real exit from fullscreen, and a0-103's ruling about the FIRE
   * column — *"reserved when the button is there and not otherwise"* — is the
   * same ruling one corner over. Default `false`, the honest default for an
   * unreserved corner.
   */
  readonly affordanceUp?: boolean;
  /** The GLASS width, CSS px — the frame the affordance is laid out in, which is
   *  deliberately not the content box (see {@link LayoutSurface}). Defaults to
   *  the frame's own width, which is correct on every display where the two are
   *  the same rect. */
  readonly glassWidth?: number;
  /**
   * The rect another element registered this frame, or `undefined` when it did
   * not register at all.
   *
   * Some elements are ROWS INSIDE another element rather than free-standing
   * corner chrome — the banked-ore numeral sits inside the ore counter's ground
   * (a0-102 `oreCounterLayout`), which hugs the corner on its behalf. A row like
   * that reserves whatever its container inset it by, and the only honest way to
   * state that is to read the container's own rect rather than to restate the
   * arithmetic that produced it. Populated by {@link reachViolations} from the
   * entries it was handed.
   */
  readonly boundsOf?: (id: string) => Rect | undefined;
}

/**
 * A declared, argued reason one element's edge sits further in than its margin.
 *
 * The rule is data, not code — same shape and same motive as
 * `./layout-exclusions` `LAYOUT_EXCLUSIONS`. A new reservation is a row; the row
 * carries the argument a future change has to beat before it deletes it.
 */
export interface EdgeReservation {
  /** Registry id ({@link LayoutEntry.id}). */
  readonly id: string;
  /** Which edge is held off. */
  readonly edge: ScreenEdge;
  /** Extra clearance beyond the declared anchor margin, CSS px. A function of
   *  the context because two of these scale with the frame's HUD metrics and
   *  two only exist on the platform that draws the controls strip. */
  readonly px: (ctx: ReservationContext) => number;
  /** What reserved it. Not decoration: the brief asked that a gap nothing
   *  explains stop being possible, and this is the explanation. */
  readonly why: string;
}

/**
 * Every gap in this build that is bigger than its element's margin ON PURPOSE.
 *
 * Seven rows, and every one of them was found by running {@link reachViolations}
 * over the registry rather than by being remembered — which is the point.
 *
 * **A row never restates a number it can import.** Five of the seven read the
 * drawing constant itself — `MINIMAP_STRIP_CLEARANCE`, `stationChromeHeight`,
 * `ZOOM_CONTROL_GAP` — so a change at the drawing end moves the reservation with
 * it and cannot drift. The two badge lifts live in `@render` and `@net` modules
 * that carry PixiJS, and this file is Pixi-free on purpose (like `./hud-geometry`
 * and `./layout-exclusions`), so those two are mirrored as constants and
 * `./anchor-reach.test.ts` pins each against its source — the same
 * mirror-a-platform-constant discipline `./minimap` already uses for
 * `MINIMAP_FIRE_COLUMN`.
 */
export const LAYOUT_RESERVATIONS: readonly EdgeReservation[] = [
  {
    id: 'banked-total',
    edge: 'top',
    px: ({ frame, boundsOf }) =>
      scrimPad(boundsOf?.('ore-hud')?.height) +
      hudSpace(ORE_LABEL_LEADING, hudMetrics(frame.width, frame.height)),
    why:
      'The banked numeral is the second row of the top-left ore cluster: the word ' +
      'ORE is above it, one eyebrow leading up (`./hud-geometry` ' +
      '`ORE_LABEL_LEADING`, scaled with the frame), and since a0-102 the whole ' +
      'cluster sits on a scrim ground whose falloff is padding around the ink ' +
      '(`./instrument` `scrimGround`). Both rows register `top-left`; the GROUND ' +
      'reaches the corner and the numeral reserves the ground plus the eyebrow.',
  },
  {
    id: 'banked-total',
    edge: 'left',
    px: ({ boundsOf }) => scrimPad(boundsOf?.('ore-hud')?.width),
    why:
      'The same ground, on the other axis. a0-102 argues at length why the ' +
      "falloff is padding rather than bleed past the group origin: `ore-hud`'s " +
      'registered footprint is what it DRAWS, so a ground reaching left of the ' +
      'margin fails the containment half of this very contract. The cost is that ' +
      'ORE starts a third of the ink box in from the margin — deliberately, and ' +
      'now declared.',
  },
  {
    id: 'minimap',
    edge: 'right',
    px: ({ fireCorner }) => (fireCorner ? MINIMAP_FIRE_COLUMN : 0),
    why:
      'The hold-to-FIRE button owns the extreme bottom-right corner on the frames ' +
      'it is drawn (GDD §2.4; `@platform/touch-visuals`), and the bottom-right ' +
      'band is too short to stack the map above it, so the square sits left of ' +
      'the fire column — `./minimap` `MINIMAP_FIRE_COLUMN`. **This row is a0-103.** ' +
      'The column used to be taken on every touch frame off `isTouch` alone, ' +
      'including under Tap Commander, which draws no FIRE: a 132 px gap on a ' +
      '798x384 phone with nothing in it. It is reserved when the button is there ' +
      'and not otherwise, and the registry now says which.',
  },
  {
    id: 'minimap',
    edge: 'bottom',
    px: ({ isTouch }) => (isTouch ? 0 : MINIMAP_STRIP_CLEARANCE),
    why:
      'The desktop controls strip runs along the bottom edge (GDD §2.4), and a ' +
      'corner map drawn on the bindings legend is unreadable over it. `./minimap` ' +
      '`MINIMAP_STRIP_CLEARANCE`. Touch draws no strip, so touch reserves nothing ' +
      'and the square takes the true corner.',
  },
  {
    id: 'zoom-control',
    edge: 'top',
    px: ({ frame }) => {
      const m = hudMetrics(frame.width, frame.height);
      return stationChromeHeight(m.scale) + hudSpace(ZOOM_CONTROL_GAP, m);
    },
    why:
      'It shares the top-right corner with own-station HP, which GDD §2.2 puts ' +
      'there, and hangs directly under that cluster\'s chrome — `./zoom-control` ' +
      'reads the depth from `./hud-geometry` `stationChromeHeight` rather than ' +
      'copying it. Two elements in one corner: the first reaches it, the second ' +
      'reserves the first.',
  },
  {
    id: 'station-hp',
    edge: 'right',
    px: ({ frame, glassWidth, affordanceUp }) =>
      glassCornerReserve(glassWidth ?? frame.width, frame.x + frame.width, affordanceUp === true),
    why:
      'The re-enter-fullscreen affordance (`@render/fullscreen-affordance`) declares ' +
      'the SAME `top-right` and hugs the top-right of the GLASS at margin 12, while ' +
      'this cluster hugs the top-right of the CONTENT BOX at `HUD_PAD` 16. On a phone ' +
      'those are the same corner, and the button took 44x30 px of a 140x30 px readout ' +
      '— 31% of the own-station HP GDD §2.2 puts there, on 462 swept frames (a0-125 D1). ' +
      'The affordance is the OUTER of the two, so it reaches the corner and HOME reserves ' +
      'it: the same ruling the zoom-control row above makes one axis across. The number ' +
      'is `./hud-geometry` `glassCornerReserve` — a rect intersection, so it is 0 on the ' +
      'ultrawides by arithmetic, and 0 on every frame the button is not drawn.',
  },
  {
    id: 'zoom-control',
    edge: 'right',
    px: ({ frame, glassWidth, affordanceUp }) =>
      glassCornerReserve(glassWidth ?? frame.width, frame.x + frame.width, affordanceUp === true),
    why:
      'The VIEW chip hangs off the HOME cluster (see the `zoom-control`/`top` row) and ' +
      'is right-aligned with it, so it takes whatever HOME took: a column whose two rows ' +
      'are 46 px out of line is not a column. Same call, same number, so the two cannot ' +
      'disagree.',
  },
  {
    id: 'build-badge',
    edge: 'bottom',
    px: ({ isTouch }) => (isTouch ? 0 : BADGE_STRIP_LIFT_MIRROR),
    why:
      'Same strip, same argument as the minimap row: `@render/build-badge` ' +
      '`BADGE_STRIP_LIFT` raises the build stamp above the bindings legend when ' +
      'the strip is drawn, and by nothing at all when it is not.',
  },
  {
    id: 'net-ping',
    edge: 'bottom',
    px: ({ isTouch }) =>
      (isTouch ? 0 : BADGE_STRIP_LIFT_MIRROR) + PING_BADGE_STACK_LIFT_MIRROR,
    why:
      'The ping stamp stacks directly above the build stamp — `@net/ping-badge` ' +
      'sets its lift to `buildBadge.lift + PING_BADGE_STACK_LIFT`, so it reserves ' +
      'whatever the build badge reserved plus its own row.',
  },
];

/**
 * How much of a scrim-grounded element's extent is the falloff padding around
 * its ink, on ONE side — `scrimGround` inflates by `1 / SCRIM_CORE` about the
 * ink's centre, so each side takes `(1 - SCRIM_CORE) / 2` of the GROUND. Derived
 * from the container's drawn rect rather than from the ink, because the drawn
 * rect is the one thing the registry actually holds.
 *
 * `undefined` (the container did not register this frame) reserves nothing: a
 * row about two elements has nothing to say when only one of them is there,
 * exactly as `./layout-exclusions` treats a missing half.
 */
function scrimPad(groundExtent: number | undefined): number {
  if (!groundExtent || groundExtent <= 0) return 0;
  return (groundExtent * (1 - SCRIM_CORE)) / 2;
}

/**
 * Mirror of `@render/build-badge` `BADGE_STRIP_LIFT` (26). Mirrored rather than
 * imported: that module carries PixiJS and this one is deliberately Pixi-free.
 * `./anchor-reach.test.ts` asserts the two are equal.
 */
const BADGE_STRIP_LIFT_MIRROR = 26;
/** Mirror of `@net/ping-badge` `PING_BADGE_STACK_LIFT` (15). Pinned, as above. */
const PING_BADGE_STACK_LIFT_MIRROR = 15;

/** How many px beyond its margin `id` is allowed to hold off `edge`. */
export function reservedPx(
  id: string,
  edge: ScreenEdge,
  ctx: ReservationContext,
  table: readonly EdgeReservation[] = LAYOUT_RESERVATIONS,
): number {
  let total = 0;
  for (const r of table) {
    if (r.id === id && r.edge === edge) total += Math.max(0, r.px(ctx));
  }
  return total;
}

/** The reservation rows that speak for `id` on `edge` — for a failure message
 *  that can say *what* claimed the space, not just how much. */
export function reservationsFor(
  id: string,
  edge: ScreenEdge,
  table: readonly EdgeReservation[] = LAYOUT_RESERVATIONS,
): readonly EdgeReservation[] {
  return table.filter((r) => r.id === id && r.edge === edge);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** One element that did not reach an edge its anchor promised. */
export interface ReachViolation {
  readonly id: string;
  readonly region: AnchorRegion;
  readonly edge: ScreenEdge;
  /** Clear space actually left between the element and that edge, CSS px. */
  readonly gap: number;
  /** The most it was allowed: declared margin + everything reserved. */
  readonly allowed: number;
  /** The element's declared margin, CSS px. */
  readonly margin: number;
  /** The part of `allowed` that came from {@link LAYOUT_RESERVATIONS}. */
  readonly reserved: number;
  /** The rect as registered, and the frame it was measured against. */
  readonly bounds: Rect;
  readonly frame: Rect;
}

/** Knobs for {@link reachViolations}. */
export interface ReachOptions {
  /** Touch build — handed to the reservations (see {@link ReservationContext}). */
  readonly isTouch?: boolean;
  /** Is a touch FIRE button drawn in the bottom-right this frame? See
   *  {@link ReservationContext.fireCorner}. */
  readonly fireCorner?: boolean;
  /** Is the re-enter-fullscreen affordance drawn this frame? See
   *  {@link ReservationContext.affordanceUp}. */
  readonly affordanceUp?: boolean;
  /** The glass width, CSS px, when it is not the frame's. See
   *  {@link ReservationContext.glassWidth} and {@link LayoutSurface}. */
  readonly glassWidth?: number;
  /** Sub-pixel slop, matching `rectContains`'s own default. */
  readonly tolerance?: number;
  /** The frame an element was laid out in, when it is not the viewport. Return
   *  `undefined` (or omit the option) for the viewport. See the header, §2 —
   *  a0-74's content box is what this exists for. */
  readonly frameFor?: (id: string) => Rect | undefined;
  /** Override the reservation table (tests; a what-if at the console). */
  readonly reservations?: readonly EdgeReservation[];
}

/**
 * Every element that declares an edge and does not reach it.
 *
 * One row per (element, edge) — an element short of both edges of its corner
 * reports twice, on purpose: "the minimap is 132 px off the right AND 52 px off
 * the bottom" is two different arguments with two different fixes, and collapsing
 * them to one line has already cost this element one round trip.
 *
 * Empty array ⇒ every declared anchor is reached. Elements whose region promises
 * no edge are skipped entirely rather than passed vacuously.
 */
export function reachViolations(
  entries: readonly LayoutEntry[],
  viewport: Viewport,
  opts: ReachOptions = {},
): ReachViolation[] {
  const tolerance = opts.tolerance ?? 0.5;
  const isTouch = opts.isTouch ?? false;
  const fireCorner = opts.fireCorner ?? false;
  const affordanceUp = opts.affordanceUp ?? false;
  const glassWidth = opts.glassWidth ?? viewport.width;
  const table = opts.reservations ?? LAYOUT_RESERVATIONS;
  const viewportRect: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const out: ReachViolation[] = [];
  // A row may need a sibling's rect (see ReservationContext.boundsOf); the
  // entries handed in ARE the frame's registry, so the lookup is over them.
  const byId = new Map<string, Rect>();
  for (const e of entries) byId.set(e.id, e.bounds);
  const boundsOf = (id: string): Rect | undefined => byId.get(id);

  for (const entry of entries) {
    const edges = anchorEdges(entry.anchor.region);
    if (edges.length === 0) continue;
    const frame = opts.frameFor?.(entry.id) ?? viewportRect;
    const margin = Math.max(0, entry.anchor.margin ?? 0);
    for (const edge of edges) {
      const reserved = reservedPx(
        entry.id,
        edge,
        { frame, isTouch, fireCorner, affordanceUp, glassWidth, boundsOf },
        table,
      );
      const allowed = margin + reserved;
      const gap = edgeGap(entry.bounds, frame, edge);
      if (gap > allowed + tolerance) {
        out.push({
          id: entry.id,
          region: entry.anchor.region,
          edge,
          gap,
          allowed,
          margin,
          reserved,
          bounds: { ...entry.bounds },
          frame: { ...frame },
        });
      }
    }
  }
  return out;
}

/** A one-line account of a violation, for a test failure message. */
export function describeReachViolation(v: ReachViolation): string {
  // `reasons`, not a word the copy audit sweeps for (a0-108 `copy-audit.test.ts`
  // scans every string literal under src/ui, and this file's are developer-facing
  // but it cannot know that).
  const reasons = reservationsFor(v.id, v.edge)
    .map((r) => r.why)
    .join(' ');
  const reserved = v.reserved > 0 ? ` (margin ${v.margin} + reserved ${v.reserved})` : '';
  return (
    `"${v.id}" declares "${v.region}" but stops ${v.gap.toFixed(1)} px short of its ` +
    `${v.edge} edge; at most ${v.allowed.toFixed(1)} px is allowed${reserved}. ` +
    `bounds {x:${v.bounds.x.toFixed(1)}, y:${v.bounds.y.toFixed(1)}, ` +
    `w:${v.bounds.width.toFixed(1)}, h:${v.bounds.height.toFixed(1)}} in frame ` +
    `{x:${v.frame.x.toFixed(1)}, y:${v.frame.y.toFixed(1)}, ` +
    `w:${v.frame.width.toFixed(1)}, h:${v.frame.height.toFixed(1)}}` +
    (reasons ? ` — reserved because: ${reasons}` : '')
  );
}

// ---------------------------------------------------------------------------
// Which elements are bound to the HUD's content box (a0-74)
// ---------------------------------------------------------------------------

/**
 * **Whose box does this element go in?** — the word the registry does not have,
 * and a0-125's finding that it is missing.
 *
 * An {@link AnchorSpec} says `top-right`. It does not say *the top-right of
 * what*, and since a0-74 this game has had two answers on the same screen:
 *
 *  - `glass`   — the logical viewport, edge to edge. `main.ts` lays the build
 *                stamp, the ping stamp and the re-enter-fullscreen affordance out
 *                against it (`layoutBounds(logicalWidth, logicalHeight)`).
 *  - `content` — the centred, reference-aspect content box (`./viewport`
 *                `contentBox`), which the HUD's corner chrome is bound to so that
 *                on a 32:9 display the instruments stay within one glance of each
 *                other instead of a head-turn apart.
 *
 * On every 16:9-or-narrower display the two are the same rect, which is exactly
 * why the gap went unnoticed for so long: a0-103 asserted that each element
 * reaches the corner its anchor names, and **nobody asked whether two elements
 * were reaching the same one**. On a 798x384 phone `fullscreen-reenter` (glass,
 * margin 12) and `station-hp` (content, margin 16) both reached the top-right and
 * the button took 31% of the readout, on 462 swept frames, with both halves of
 * the placement contract green. {@link cornerRivals} is the question nobody
 * asked, made mechanical.
 */
export type LayoutSurface = 'glass' | 'content';

/**
 * The registry ids whose frame is the HUD's content box rather than the raw
 * viewport (`./viewport` `contentBox`, `./hud` `layout`) — the data behind
 * {@link surfaceOf}.
 *
 * On every 16:9-or-narrower display — and everything under the reference width,
 * so every phone — the two are the same rect and this list changes nothing. It
 * exists so an ultrawide's deliberate inset reads as the fix it is rather than as
 * five new violations.
 *
 * The badges and the fullscreen affordance are absent on purpose: `main.ts`
 * lays those out against the logical viewport (`layoutBounds(w, h)`), so the
 * viewport is the frame they promised. That absence used to be a fact only
 * {@link reachViolations} consulted; since a0-125 it is also what tells
 * {@link cornerRivals} that those three are in a different box from the HUD
 * chrome they share a corner with.
 */
export const CONTENT_BOUND_IDS: readonly string[] = [
  'ore-hud',
  'banked-total',
  'station-hp',
  'zoom-control',
  'minimap',
];

/** Which box `id` was laid out in. `glass` unless {@link CONTENT_BOUND_IDS} says
 *  otherwise — the honest default, since an element that has not declared itself
 *  bound to the content box was laid out against the viewport. */
export function surfaceOf(id: string, ids: readonly string[] = CONTENT_BOUND_IDS): LayoutSurface {
  return ids.includes(id) ? 'content' : 'glass';
}

/** The frame `id` was laid out in, given both boxes — what
 *  {@link ReachOptions.frameFor} needs, spelled with {@link surfaceOf} instead of
 *  with an inline `includes`. */
export function anchorFrame(
  id: string,
  glass: Rect,
  content: Rect,
  ids: readonly string[] = CONTENT_BOUND_IDS,
): Rect {
  return surfaceOf(id, ids) === 'content' ? content : glass;
}

/** Two elements that declare the same anchor region in two different boxes, and
 *  whose rects really meet. */
export interface CornerRival {
  /** The region both of them declared. */
  readonly region: AnchorRegion;
  readonly a: LayoutEntry;
  readonly b: LayoutEntry;
  /** Which box each was laid out in — always two different ones. */
  readonly surfaceA: LayoutSurface;
  readonly surfaceB: LayoutSurface;
  /** The pixels they share. Never zero-area. */
  readonly overlap: Rect;
}

/**
 * **Every pair of elements that reach the same corner from two different boxes.**
 * a0-125 D1's whole class, in one check.
 *
 * Not "every pair that overlaps" — that is `tests/adversarial/layout-overlap`'s
 * job and it needs draw order and roles to say anything useful. This is the
 * narrower question the *registry* can answer on its own and could not: two
 * elements declaring one region while being measured against two different
 * rectangles is a bug generator, because the day the two rectangles converge (a
 * narrower display, a smaller content box) the two elements land on each other
 * and **both halves of the placement contract stay green**. Containment passes:
 * each is inside its own zone. Reach passes: each is at its own margin. a0-103
 * asserted both, and D1 shipped anyway.
 *
 * A pair whose rects do not actually meet is not reported: `top-right` on the
 * glass and `top-right` in a 32:9 content box are hundreds of px apart, and a
 * check that flagged them would be telling the ultrawide fix that it is the bug.
 *
 * @param entries The frame's registry entries.
 * @param glass   The logical viewport rect, `{0, 0, W, H}`.
 * @param content The HUD's content box (`./viewport` `contentBox`).
 */
export function cornerRivals(
  entries: readonly LayoutEntry[],
  glass: Rect,
  content: Rect,
  ids: readonly string[] = CONTENT_BOUND_IDS,
): CornerRival[] {
  const out: CornerRival[] = [];
  // Only regions that promise an edge can be "the same corner": `full` and
  // `center` name a zone and make no claim to a bezel, so two of them sharing a
  // region says nothing (ANCHOR_EDGES, and the header's §1).
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    if (anchorEdges(a.anchor.region).length === 0) continue;
    const sa = surfaceOf(a.id, ids);
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (b.anchor.region !== a.anchor.region) continue;
      const sb = surfaceOf(b.id, ids);
      if (sa === sb) continue;
      const overlap = rectOverlap(a.bounds, b.bounds);
      if (!overlap) continue;
      out.push({ region: a.anchor.region, a, b, surfaceA: sa, surfaceB: sb, overlap });
    }
  }
  // `glass`/`content` are named in the signature so a caller cannot forget which
  // box is which, and so a future check here can measure against them.
  void glass;
  void content;
  return out;
}

/** One rival pair as a line a human can act on. */
export function describeCornerRival(r: CornerRival): string {
  return (
    `"${r.a.id}" (${r.surfaceA}) and "${r.b.id}" (${r.surfaceB}) both declare ` +
    `"${r.region}" and reach the same one: they share ` +
    `{x:${r.overlap.x.toFixed(1)}, y:${r.overlap.y.toFixed(1)}, ` +
    `w:${r.overlap.width.toFixed(1)}, h:${r.overlap.height.toFixed(1)}}. ` +
    `An anchor names a region, not a box — see LayoutSurface.`
  );
}
