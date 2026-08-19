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

/** A violation as one line of failure message — `id ∩ id = {…}`, with the rects
 *  that produced it, so a red test says what to go and look at. */
export function describeViolation(v: ExclusionViolation): string {
  const fmt = (r: Rect): string =>
    `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;
  return (
    `${v.a} ${fmt(v.boundsA)} ∩ ${v.b} ${fmt(v.boundsB)} = ${fmt(v.overlap)} — ${v.why}`
  );
}
