/**
 * src/ui/wheel-geometry.ts — where a wedge SITS, for every radial menu in the
 * game. OWNER: UI Engineer.
 *
 * ── WHY THIS FILE EXISTS (a0-51) ────────────────────────────────────────────
 * The developer reported the wheel's selection *"doesnt have the selection
 * animation or graphics only the top most one has it"*. Half of that was a
 * missing draw call; the other half was this:
 *
 * ```ts
 * export const SEGMENT_ARC = (2 * Math.PI) / WHEEL_ORDER.length;   // five wedges
 * export function segmentAngle(index: number): number {
 *   return -Math.PI / 2 + index * SEGMENT_ARC;                     // …always five
 * }
 * ```
 *
 * {@link ./wheel-selection.WheelSelection} — the one selection machine both
 * wheels drive — computed every angle it swept to through that function, so it
 * stepped in fifths of a turn on a wheel laid out in quarters. **Index 0 is the
 * only index where 2π/5 and 2π/4 agree** (both are `-π/2`, twelve o'clock), which
 * is exactly the shape of the report: right on the top wedge, further off on
 * every wedge after it.
 *
 * The rule "wedge `i` of `n` sits at `-π/2 + i · 2π/n`, clockwise" was written
 * out three times — here as the Build wheel's five, in `./upgrade-wheel` as
 * {@link ./upgrade-wheel.upgradeWedgeAngle}'s `count`, and in `@platform`'s
 * `segmentIndexAt` as the inverse a press is hit-tested with. Two of those agreed
 * and one was hard-coded, and a rule stated twice is how the cost-format drift in
 * `./affordability` happened (style-guide §2.1). So it is stated HERE, once, in
 * terms of the wedge count it is given, and both wheels' own helpers are thin
 * wrappers that supply their count.
 *
 * Pure arithmetic: no Pixi, no model, no opinion about what a wedge *says*. It is
 * imported by both wheel models, by the selection machine and by the view, and it
 * imports nothing, so nothing here can drag a wheel's copy into another wheel.
 */

/** Twelve o'clock, in the wheels' own screen-space radians (y-down). Wedge 0 sits
 *  here on every wheel and at every count — which is precisely why a wheel laid
 *  out in the wrong number of wedges still looks correct at index 0, and why the
 *  a0-51 test walks EVERY index rather than the first. */
export const WHEEL_TOP = -Math.PI / 2;

/** Angular width of one wedge (radians) on a wheel of `count` wedges — a fifth of
 *  a turn on the Build wheel's five, a quarter on the Upgrade wheel's four. `0`
 *  for a wheel with no wedges, which is a wheel that draws nothing rather than a
 *  division by zero. */
export function wedgeArc(count: number): number {
  return count > 0 ? (2 * Math.PI) / count : 0;
}

/** Screen-space angle of wedge `index`'s centre on a wheel of `count` wedges
 *  (radians, y-down: {@link WHEEL_TOP} is up). Wedge 0 sits at twelve o'clock and
 *  the rest run clockwise — the layout both wheels draw and both hit-test. */
export function wedgeAngle(index: number, count: number): number {
  return WHEEL_TOP + index * wedgeArc(count);
}

/**
 * A wedge index a wheel of `count` wedges can honour, or `null` — the guard on
 * every wheel's `selected`.
 *
 * `null` is a real, resting state and not a missing value: on desktop it is "the
 * pointer is not over the wheel", on touch it is "no thumb is down", on a gamepad
 * it is "the stick has not been pushed". The design's prototype opens with
 * `sel: 0` because it is a prototype and something has to be lit; a live wheel
 * that opens with TURRET pre-selected is claiming a choice the player has not
 * made — and on a gamepad the confirm button is then one press away from acting
 * on it, which would turn "the wheel came up" into "you bought a turret".
 *
 * Anything that is not an in-range integer is `null` rather than clamped to an
 * end: a caller with an off-by-one would otherwise light its neighbour, and a
 * highlight on the wrong wedge is worse than no highlight. That is also what
 * makes a selection taken on one wheel level safe to hand to another — a build
 * wedge's index 4 simply goes dark on a four-wedge upgrade wheel.
 */
export function clampSelection(index: number | null | undefined, count: number): number | null {
  if (index === null || index === undefined) return null;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  return index;
}
