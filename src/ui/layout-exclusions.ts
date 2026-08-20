/**
 * src/ui/layout-exclusions.ts — "these two must never overlap". OWNER: UI Engineer.
 *
 * The layout registry (`@platform/layout-registry`) answers one question per
 * element: *is this where it is supposed to be?* — actual bounds against a
 * declared anchor zone. That question is necessary and it is not sufficient.
 * a0-100 is the proof: on a 798×384 phone the onboarding prompt was inside its
 * `full` + `PAD` zone and the build wheel was inside its `full` zone, both
 * green, and the prompt's first two lines were drawn through the REPAIR REACTOR
 * and RADAR wedges. Two elements can each be exactly where they belong and still
 * be in the same pixels, because nothing was arbitrating between them.
 *
 * So this module adds the second question: *do these two share pixels?* It is
 * deliberately written in the registry's own vocabulary — {@link LayoutEntry} in,
 * violations out, ids and {@link Rect}s throughout, no HUD types anywhere — for
 * two reasons.
 *
 * **One: the rule is data, not code.** The brief that asked for this asked for it
 * to be expressible once rather than re-litigated in each screen's layout
 * function. {@link LAYOUT_EXCLUSIONS} is that expression: a table of pairs, each
 * with the argument for why those two may not touch. A new pair is a row, not a
 * branch, and the row carries its own reason so the next person to read it does
 * not have to reconstruct one.
 *
 * **Two: it belongs upstairs, and this is the shape it lifts in.** The natural
 * home for a pairwise placement contract is `@platform/layout-registry` itself,
 * beside {@link resolveAnchor} and `withinAnchor` — the registry is the module
 * that already holds every element's rect, and a `registry.exclusions()` method
 * would need no argument at all. That file is Platform's, and its anchor
 * vocabulary is a ratified contract; extending it is not a UI Engineer's
 * unilateral call. So the facility lives here, in a file this agent owns, with a
 * signature that takes the entries rather than reaching for them — move the
 * table and {@link exclusionViolations} into the registry verbatim and every
 * caller and every test still compiles.
 *
 * All geometry is **screen space, CSS pixels, origin top-left, y-down** — the
 * registry's convention, unchanged.
 */

import type { LayoutEntry, Rect } from '@platform/layout-registry';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * A standing promise that two registered elements never share pixels.
 *
 * `a` and `b` are registry ids ({@link LayoutEntry.id}). The rule is symmetric —
 * `{a: 'onboarding', b: 'build-wheel'}` and its mirror mean the same thing — and
 * it only bites on frames where **both** ids are registered, which is what makes
 * "withdraw the element" a legal way to satisfy it: an element that is not drawn
 * is not registered, and a rule about two rects has nothing to say about one.
 */
export interface LayoutExclusion {
  readonly a: string;
  readonly b: string;
  /**
   * Clear air required between the two rects, CSS px. Default 0 — touching edges
   * satisfy a bare exclusion, because a rect that ends where the next begins is
   * not covering anything. Raise it where the two need visible separation rather
   * than mere non-overlap.
   */
  readonly gap?: number;
  /** Why these two may not touch. Not decoration: it is the argument a future
   *  change has to beat before it deletes the row. */
  readonly why: string;
}

/** One broken promise, with the evidence attached. */
export interface ExclusionViolation {
  readonly a: string;
  readonly b: string;
  /** The shared rect — or, when the rule carries a `gap`, the shared rect of the
   *  two bounds each grown by half the gap. Never zero-area: a violation that
   *  reported `0×0` would be a rule satisfied. */
  readonly overlap: Rect;
  /** The two rects as registered, for the failure message. */
  readonly boundsA: Rect;
  readonly boundsB: Rect;
  readonly why: string;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * The pairs that must never share pixels, and the argument for each.
 *
 * **This table is short on purpose, and the reason it is short matters.** Most
 * pairs of registered elements overlapping is *correct*: `alarm-frame` is the
 * screen and therefore overlaps everything; `wheel-hub-back` is drawn inside the
 * wheel's own hub; `upgrade-wheel` is the same centred square one level deeper;
 * `ship-local`, the over-ship health bars and the nameplates are world-space and
 * pass under the HUD by design; the touch sticks sit under whatever the fight
 * puts above them. A blanket "no two registered rects may intersect" would fail
 * on all of those and teach everyone to ignore it. An exclusion is a claim about
 * two specific elements, and it is added when there is a reason.
 */
export const LAYOUT_EXCLUSIONS: readonly LayoutExclusion[] = [
  {
    a: 'onboarding',
    b: 'build-wheel',
    // a0-100. The prompt is ambient — it fires on a trigger the player did not
    // ask for — and the wheel is the thing the player deliberately opened, so
    // the prompt is the one that yields. The wedges carry the only numbers GDD
    // §2.5 permits on the wheel (the costs), and a sentence laid across them is
    // a spending decision made through text. See ./hud-geometry `promptBand`
    // for how the prompt honours this, and `promptWithdraws` for the screens
    // where honouring it means not being drawn at all.
    why: 'the wheel is deliberate and its costs are load-bearing; the prompt is ambient (a0-100)',
  },
  {
    a: 'onboarding',
    b: 'upgrade-wheel',
    // The same square, one level deeper (GDD §2.5) — and since field report v0.2
    // the upgrade screen IS a radial wheel sharing `wheelBounds`. Listed in its
    // own right rather than left to the fact that the two wheels coincide: the
    // day one of them moves, the prompt still has to clear both.
    why: 'the upgrade wheel is the same deliberate surface one level deeper (a0-100)',
  },
];

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * The rect two rects share, or `null` when they do not overlap.
 *
 * Touching edges are not an overlap: a zero-width or zero-height intersection is
 * two things meeting, not one covering the other. This is the same convention
 * `hud-geometry.test.ts` has used since a0-24 for the clock's clearance, kept
 * identical here so one suite cannot mean two things by "clear".
 */
export function rectOverlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** A rect grown by `m` on every side. Negative `m` shrinks it; a rect grown
 *  below zero extent is clamped, never inverted. */
function grow(r: Rect, m: number): Rect {
  return {
    x: r.x - m,
    y: r.y - m,
    width: Math.max(0, r.width + 2 * m),
    height: Math.max(0, r.height + 2 * m),
  };
}

/**
 * Every exclusion the given frame breaks — the whole point of the module.
 *
 * `entries` is a frame's worth of registry entries: `registry.entries()` in the
 * live client under `?debug=1`, `Hud.describeLayout(viewport)` in a Pixi test, or
 * rects computed from the pure geometry in a headless one. A rule whose ids are
 * not both present this frame is skipped rather than failed — the registry
 * records what is drawn, and an element that withdrew is not in the frame.
 *
 * Returns `[]` when the frame is clean, so a caller reads
 * `expect(exclusionViolations(entries)).toEqual([])` and gets the offending
 * rects in the failure message rather than a bare `false`.
 */
export function exclusionViolations(
  entries: readonly LayoutEntry[],
  rules: readonly LayoutExclusion[] = LAYOUT_EXCLUSIONS,
): ExclusionViolation[] {
  const byId = new Map<string, Rect>();
  for (const e of entries) byId.set(e.id, e.bounds);

  const out: ExclusionViolation[] = [];
  for (const rule of rules) {
    const boundsA = byId.get(rule.a);
    const boundsB = byId.get(rule.b);
    if (!boundsA || !boundsB) continue;
    const gap = Math.max(0, rule.gap ?? 0);
    const overlap = rectOverlap(grow(boundsA, gap / 2), grow(boundsB, gap / 2));
    if (!overlap) continue;
    out.push({ a: rule.a, b: rule.b, overlap, boundsA, boundsB, why: rule.why });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The keep-out (a0-115) — a world-anchored label vs the fixed readouts
// ---------------------------------------------------------------------------
//
// The table above pairs two elements that are each *somewhere in particular*.
// a0-115 is the other shape of the same problem, and a table cannot express it:
// a nameplate follows a ship, so it is not anywhere in particular — it is
// wherever the ship is, which on roughly one camera position in seven is inside
// the ore counter. QA measured it: the grey word `ORE` and the teal `Rusty
// (EASY)` on the same pixels, the R drawn across the E, legible only because the
// two are different colours (a0-111, 4 of 28 sampled stops).
//
// **Why the two texts collide even though one is drawn after the other.** The
// nameplate layer is added to the HUD *before* every piece of corner chrome
// (`./hud`'s `addChild` list), so the ore counter already wins the z-order and
// already draws over the label. That is the "readout wins" option, shipped, and
// QA photographed the collision anyway — because type is mostly holes. A 22 px
// numeral covers perhaps a third of its own box; the label underneath shows
// through the counters and the sidebearings, and the eye reads two overlapping
// words rather than one word over a texture. Draw order separates a readout from
// the WORLD (that is what a0-102's ground is for); it cannot separate a readout
// from other TEXT. So the label has to not be there.
//
// **Which one yields.** The label. The readout is fixed furniture the player
// looks *to* — the counter is at (contentX + PAD, PAD) on every frame of every
// match, and a player who wants their banked total looks at that corner without
// searching. The label is attached to something that can simply be somewhere
// else a second later. Moving the readout was ruled out by the brief and would
// not help anyway: the next world-anchored thing finds it wherever it goes.
//
// **What happens to the label, exactly** — and this matters, because a nameplate
// that silently vanishes is its own bug:
//
//  1. It **steps aside**, horizontally, by the smallest distance that clears
//     every readout it touches. Horizontally and not vertically because the
//     label's bottom edge is not free: it is pinned just above its entity's
//     health-bar cluster ({@link ./nameplates-view} `nameplateClusterClearance`),
//     and pushing a label DOWN puts it on the bar it exists to stay off
//     (nameplates rule 3). Sideways keeps the whole stack intact.
//  2. It steps aside **only as far as the hull it names** — the row must still
//     overlap the entity's own span on screen, `x ± radius`. Past that the plate
//     is captioning open space, and a name floating beside an unrelated ship is a
//     worse lie than no name. The bound is the entity's OWN size rather than a
//     constant, so a station's plate — which is a long way above a big disc — gets
//     the reach its subject actually has.
//  3. If no such position exists, it is **withheld for that frame** — the same
//     answer the layer has always given a label that would spill off the canvas
//     ("a partial label reads worse than none"), and it comes back the instant
//     the camera moves. It is withheld *visibly*: the layer records every
//     withheld plate and why, on the ?debug=1 seam, so "it vanished" is a
//     readback and not a rumour.
//
// This lives here rather than in ./nameplates-view for the same reason the table
// does: it is a rule about rects and registry ids, it names no HUD type, and it
// lifts into `@platform/layout-registry` unchanged on the day that file's owner
// wants it.

/**
 * The registry ids of the **fixed readouts** — the HUD elements a player looks
 * *to*, at a place they do not have to search for, and which therefore no
 * world-anchored label may be drawn inside.
 *
 * Every one of these is screen-space chrome pinned to the content box's corners
 * or its top-centre by `./hud` `layout()`:
 *
 *  - `ore-hud` — the banked-ore cluster, top-left. The rect a0-111 photographed.
 *  - `banked-total` — the numeral inside it, registered in its own right by
 *    `./hud` `describeLayout`. Inside `ore-hud`, and listed anyway: the ids are
 *    the contract, and a table that quietly relied on containment would stop
 *    covering the numeral the day the cluster is re-arranged.
 *  - `wave-clock` — top-centre. **a0-116 was this same defect on this element**,
 *    and is now the second consumer of this list: the screen-edge arrow home
 *    yields to these same rects (`./hud-geometry` `arrowClearOfReadouts`), so
 *    the table names what a readout is for every mark on the screen and not for
 *    world labels alone.
 *    Not currently registered by `describeLayout` (argued at length there: its
 *    `top-center` zone is a third of the viewport and the strip is intrinsically
 *    wider, so registering it would turn QA's suite red on a finding nobody has
 *    ruled on). Named here regardless — this list is what a label must clear,
 *    not what the registry happens to publish today, and the caller feeds the
 *    strip's drawn rect straight in.
 *  - `station-hp` — the HOME cluster, top-right (GDD §2.2).
 *  - `zoom-control` — the VIEW chip under HOME on touch (a0-74).
 *
 * Deliberately NOT here: `minimap` (a map of the world is a world surface, and a
 * name over it is a name over the thing it names), `controls-strip` and the
 * touch affordances (furniture the thumb finds, not type the eye reads),
 * `healthbars` and `nameplates` themselves (both world-anchored — see the note
 * on the over-ship bar in the a0-115 PR: two things that travel together cannot
 * be separated by a keep-out).
 */
export const HUD_READOUT_IDS: readonly string[] = [
  'ore-hud',
  'banked-total',
  'wave-clock',
  'station-hp',
  'zoom-control',
];

/**
 * Clear air a mark keeps from a readout's rect, CSS px.
 *
 * Not zero, unlike {@link LayoutExclusion.gap}'s default. A bare exclusion is
 * about two rects covering each other, and edge-to-edge is enough for that; this
 * is about two runs of TEXT being told apart, and glyphs that end exactly where
 * the next begins read as one word. Two pixels is the smallest gap that survives
 * antialiasing on a 1× display.
 *
 * A world label (a0-115) and the screen-edge arrow home (a0-116) keep the same
 * two, from here rather than from a constant each: the rule is about what HUD
 * type needs around it, not about what happened to land on it.
 */
export const READOUT_KEEPOUT_PAD = 2;

/** The readout rects out of a frame's registry entries, in the order
 *  {@link HUD_READOUT_IDS} names them — the "use the registry rather than
 *  hard-code the counter's corner" the brief asks for. Ids the frame does not
 *  carry are skipped: an element that is not drawn is not in the way. */
export function readoutRects(
  entries: readonly LayoutEntry[],
  ids: readonly string[] = HUD_READOUT_IDS,
): Rect[] {
  const out: Rect[] = [];
  for (const id of ids) {
    for (const e of entries) if (e.id === id) out.push(e.bounds);
  }
  return out;
}

/** What a world label does about the readouts this frame. */
export interface LabelYield {
  /**
   * How far the label steps sideways, CSS px — `0` when it was already clear,
   * negative left, positive right. Meaningless when {@link withheld}.
   */
  readonly dx: number;
  /** True when no position clears the readouts within the label's reach, so the
   *  label is not drawn at all this frame. */
  readonly withheld: boolean;
}

/** Already clear, nothing to do — the answer on the overwhelming majority of
 *  frames, allocated once so the common path costs nothing. */
const STANDS: LabelYield = { dx: 0, withheld: false };

/**
 * Decide what a world-anchored label does about the fixed readouts: stand where
 * it is, step aside by the least it can, or stand down for this frame.
 *
 * `row` is the label's drawn span in screen space — for a nameplate, the rigid
 * side/name/tag row ({@link ./nameplates-view} `nameplateRowLayout`) with its own
 * top and bottom. `anchorX` / `anchorRadius` are the screen centre and radius of
 * the thing the label names, and they are what bounds the step: the row must still
 * overlap that span afterwards (see the note above). `viewportWidth` bounds it the
 * other way — a step that pushes the row off the canvas is not a step, it is the
 * cull. The two are passed as numbers rather than as an entity object on purpose:
 * this runs once per label per frame, and a per-plate object literal is garbage
 * the pooled layer above it goes to some trouble not to make.
 *
 * The search is exhaustive rather than iterative, because it is tiny: the only
 * positions worth trying are "flush left of readout *i*" and "flush right of
 * readout *i*" for each readout in the way, plus standing still. Five readouts
 * make eleven candidates; each is checked against ALL of them, so a step out of
 * the ore counter that would land in the wave clock is simply not offered. The
 * smallest surviving |dx| wins, and a tie goes to the rightward step so the
 * choice is deterministic rather than dependent on the readouts' order.
 */
export function labelYieldsToReadouts(
  row: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  anchorX: number,
  anchorRadius: number,
  readouts: readonly Rect[],
  viewportWidth: number,
  pad: number = READOUT_KEEPOUT_PAD,
): LabelYield {
  if (readouts.length === 0) return STANDS;

  const width = row.right - row.left;
  const height = row.bottom - row.top;
  const clears = (dx: number): boolean => {
    const shifted: Rect = {
      x: row.left + dx - pad,
      y: row.top - pad,
      width: width + 2 * pad,
      height: height + 2 * pad,
    };
    for (const r of readouts) if (rectOverlap(shifted, r)) return false;
    return true;
  };

  if (clears(0)) return STANDS;

  // How far it may go, in each direction, and still stand over its entity.
  const reach = Math.max(0, anchorRadius);
  const maxRight = anchorX + reach - row.left;
  const maxLeft = anchorX - reach - row.right;

  let best: number | null = null;
  for (const r of readouts) {
    for (const dx of [r.x - pad - row.right, r.x + r.width + pad - row.left]) {
      if (dx < maxLeft || dx > maxRight) continue;
      if (row.left + dx < 0 || row.right + dx > viewportWidth) continue;
      if (!clears(dx)) continue;
      if (best === null || Math.abs(dx) < Math.abs(best) || (Math.abs(dx) === Math.abs(best) && dx > best)) {
        best = dx;
      }
    }
  }
  return best === null ? { dx: 0, withheld: true } : { dx: best, withheld: false };
}
