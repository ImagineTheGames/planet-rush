/**
 * evidence/a0-98-corner-collisions-everywhere-else/pressable.mjs — OWNER: UI Engineer (a0-98).
 *
 * **Which of the things the client DRAWS in a match are things a player can PRESS.**
 *
 * The layout registry reports every positioned element, and most of them are
 * readouts: the ore squares, the banked total, the station HP bar, nameplates,
 * over-ship health bars, the build badge, the ping stamp, the onboarding prompt,
 * the controls strip. Chrome landing on one of those is worth noting and is not the
 * defect this brief is about — the brief says so in as many words: *"The bug is
 * chrome landing on a control."*
 *
 * The first pass of this table did not make that distinction and duly failed itself
 * on the desktop `controls-strip`, which the offer's box does overlap by about a
 * fifth — and which is a LEGEND. It has no `hitTest`, no `inRect`, and no line in
 * `main.ts`'s `pointerdown`. A player cannot press it, so nothing was taken from
 * them.
 *
 * So the list below is not a judgement call. It is `src/main.ts`'s own `pointerdown`
 * order, read off the file, with the line that routes each one:
 *
 *   | registry id                        | what routes a press to it                |
 *   |------------------------------------|-------------------------------------------|
 *   | `pause-button`                     | `inRect(pressPoint, pauseButtonRect(…))`  |
 *   | `fullscreen-reenter`               | `fsAffordance.hitTest(lp.x, lp.y, w, h)`  |
 *   | `build-button`                     | `inRect(pressPoint, buildButtonRect(…))`  |
 *   | `zoom-control`                     | `hud.zoomTap(pressPoint.x, pressPoint.y)` |
 *   | `minimap` / `minimap-expanded`     | `hud.minimapTap(pressPoint.x, …)`         |
 *   | `touch-left-stick` / `-aim-stick`  | the touch layer (`touch.writeInto`)       |
 *   | `touch-fire-button`                | the touch layer                           |
 *
 * Anything else the registry reports in a match is drawn, not pressed. If a future
 * affordance joins that list in `main.ts`, it has to join this one too — which is
 * the point of writing the routing down beside the ids rather than in a comment
 * somewhere else.
 *
 * The pause overlay's and the end screen's own plates are not here: they come from
 * `__pauseStage.controls` / `__cornerStage.endControls()`, which only ever report
 * controls, and only while their screen is up.
 */

/** Registry ids `main.ts` routes a press to while the match owns the pointer. */
export const PRESSABLE_IN_MATCH = new Set([
  'pause-button',
  'fullscreen-reenter',
  'build-button',
  'zoom-control',
  'minimap',
  'minimap-expanded',
  'touch-left-stick',
  'touch-aim-stick',
  'touch-fire-button',
]);

/**
 * Whether a swept row is a CONTROL the player could press, given what the capture
 * recorded about it.
 *
 * `live` from the capture answers a different and coarser question — "does the
 * match own the pointer this frame, or has an overlay taken it" — so both have to
 * hold. A `__cornerStage` row is additionally checked against the list above; rows
 * from the pause seam, the front-door seam, the lobby seam and the DOM are controls
 * by construction (those seams report nothing else).
 */
export function isPressable(row) {
  if (!row.live || !row.onScreen) return false;
  if (!row.control.startsWith('__cornerStage')) return true;
  const id = /<([^>:]+)/.exec(row.control)?.[1] ?? '';
  return PRESSABLE_IN_MATCH.has(id);
}
