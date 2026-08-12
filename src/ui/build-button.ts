/**
 * src/ui/build-button.ts — the open-build-wheel button's CONTRACT. OWNER: UI Engineer.
 *
 * The "BUILD" button is the touch E-equivalent (GDD §2.4) and, per the field
 * report that spawned this module, **a permanent HUD fixture whenever the player
 * is near their own station** (GDD §2.2). It is *drawn* by the touch layer
 * (`@platform/touch-visuals`, which owns the thumb-reachable affordance geometry),
 * but the two things that were unowned — *when it may vanish* and *how a test
 * proves it didn't* — are HUD contract, and live here.
 *
 * ── THE PERSISTENCE RULE (the whole point of this file) ─────────────────────
 * A developer reported the button disappearing "after building." The button must
 * survive the full cycle: open wheel → choose a structure → build completes →
 * button still there, clickable, opens the wheel again. So its visibility is
 * pinned to exactly one thing:
 *
 *   visible  ⇔  the ship is docked at its own station  (and this is a touch build).
 *
 * {@link buildButtonHighlighted} — the *lit* state a second field report asked
 * for (2026-08-05, "make it stand out") — is that same predicate, by the same
 * call, for the reason spelled out there.
 *
 * {@link buildButtonVisible} takes **neither** the wheel's open/closed state
 * **nor** any onboarding flag — not as a matter of style, but so that "the button
 * hid because the wheel opened" or "…because the first-build prompt fired once"
 * is *unrepresentable*: those aren't inputs. Docking is the sim's own `isDocked`
 * answer, the same signal that gates the wheel itself (GDD §2.5, "opened at your
 * own station and nowhere else"), so the button and the wheel appear and disappear
 * together at the station's edge, and building — which never undocks you — cannot
 * take the button away.
 *
 * ── THE LAYOUT CONTRACT ─────────────────────────────────────────────────────
 * {@link BUILD_BUTTON_ID} / {@link BUILD_BUTTON_ANCHOR} are what the button
 * registers with the layout registry (`@platform/layout-registry`) each frame it
 * is drawn, so QA's placement suite — and this module's own build-flow spec — can
 * assert "if it's supposed to appear, it appears" mechanically, instead of by
 * eye. See {@link BUILD_BUTTON_ANCHOR} for why the region is `full`.
 *
 * ── AND THE TYPE CONTRACT (a0-32) ───────────────────────────────────────────
 * {@link BUILD_BUTTON_LABEL} is the third unowned thing: *what size the two words
 * have to be to stay inside the circle.* It is here rather than in the view for
 * the same reason the rest of this file is — a button is a shape with a promise
 * attached, and "the words are inside it" is one of the promises. The view spells
 * the numbers out and `touch-visuals.test.ts` pins them to this module, exactly
 * as it already does for the two type stacks.
 *
 * Pure and PixiJS-free — like the rest of the HUD's decision layer
 * ({@link ./hud-geometry}, {@link ./build-wheel}) — so it unit-tests headless.
 */

import type { AnchorSpec } from '@platform/layout-registry';
import { DISPLAY_TRACKING, TRACKING } from '../art/materials';
import type { MetricFace } from './font-metrics';
import { textHeight, textWidth } from './font-metrics';

/** The layout-registry id for the open-build-wheel button. Stable — QA's
 *  placement suite and the build-flow spec both key on it. */
export const BUILD_BUTTON_ID = 'build-button';

/**
 * The button's declared anchor. **`full`, deliberately** — the same call
 * `alarm-arrow` and `onboarding` make, for the same reason.
 *
 * The button is a left-edge, thumb-height affordance: it sits directly above the
 * left thrust stick (touch-visuals), so on a short **landscape** phone (≈390 px
 * tall) its rect straddles the vertical midline. Every ratified lower-band region
 * in the vocabulary — `left-half-bottom`, `bottom-left` — begins at `H/2` or
 * `2H/3`, so none contains it there. The vocabulary has no "left edge, vertically
 * centred thumb zone" region, and inventing one is the Director's call, not a
 * placement fix (see `@platform/layout-registry`'s ratified-contract header).
 *
 * `full` asserts the honest, checkable promise the button *can* keep on every
 * profile in both orientations: it is on screen. Its finer placement (left edge,
 * lower-thumb reach) is asserted from the registry's published *bounds* in the
 * build-flow spec — via the layout contract's data, still never via raw pixels.
 */
export const BUILD_BUTTON_ANCHOR: AnchorSpec = { region: 'full', margin: 0 };

/** The inputs that decide whether the build button is on screen. Note what is
 *  **absent**: wheel state and onboarding flags. See the file header. */
export interface BuildButtonSignals {
  /** The ship is within `STATION.dockRange` of its own station — the sim's own
   *  `isDocked`. The button (and the wheel) live here and nowhere else. */
  readonly docked: boolean;
  /** This is a touch build — the button is the touch-only E-equivalent; on
   *  desktop/gamepad the controls strip names the "BUILD & UPGRADE" key instead
   *  (GDD §2.4). */
  readonly isTouch: boolean;
}

/**
 * Whether the open-build-wheel button is drawn this frame.
 *
 * The whole persistence rule in one expression: **docked, on touch — and nothing
 * else.** Independent of whether the wheel is open, whether a build just
 * completed, or whether any onboarding prompt has fired, because none of those is
 * an input here (that is the point — see the file header).
 */
export function buildButtonVisible(signals: BuildButtonSignals): boolean {
  return signals.isTouch && signals.docked;
}

/**
 * Whether the button is drawn **lit** — the loud, plasma-glowing state that says
 * *building just became possible*.
 *
 * Field report, 2026-08-05: *"once you are in build distance it should highlight
 * the build button (make it stand out)"*. The button used to arrive wearing the
 * same weight as the always-present FIRE button next to it, so crossing
 * `STATION.dockRange` — the moment the whole Build & Upgrade loop opens up — went
 * by without announcing itself. Now it arrives lit, and the world says the same
 * thing at the same instant: the dashed plasma build ring you just flew across
 * (`@art/stations` `BUILD_RING_RADIUS`) is drawn at that exact radius, in that
 * exact colour.
 *
 * **Deliberately the same call as {@link buildButtonVisible}, not the same
 * expression written twice.** Both are the sim's `isDocked` answer — the one the
 * wheel's own availability gate uses (`src/main.ts` `updateBuildWheel`) — so a
 * highlight that promises building is possible while the wheel refuses to open is
 * unrepresentable rather than merely unlikely. A highlight that can disagree with
 * the wheel is worse than no highlight, so the two states are one predicate.
 */
export function buildButtonHighlighted(signals: BuildButtonSignals): boolean {
  return buildButtonVisible(signals);
}

// ---------------------------------------------------------------------------
// The words on the circle (a0-32)
// ---------------------------------------------------------------------------
//
// The developer, on a phone capture of `e0c160d`: *"have words clipping past
// menus upgrade ship and build and upgrade…"*. The second line of this button,
// `& UPGRADE`, was **wider than the button**, and broke its silhouette on both
// sides.
//
// ── WHY IT ONLY BROKE NOW ──────────────────────────────────────────────────
// The size it was drawn at was chosen against a stated budget: *"the chord of a
// 38px-radius circle at this baseline is ~68px"* (a0-23, `touch-visuals.ts`). The
// arithmetic was right and the number was measured — in the FALLBACK face, which
// is what every frame in this project was drawn in until u14-01 self-hosted
// Audiowide and Oxanium eleven days ago. In the real Oxanium the same nine glyphs
// at the same size and the same ratified tracking come to 67.8px, and they are
// not being measured against 68 anyway:
//
//   · a chord at the label's BASELINE is not the room the label has. A line of
//     type is a box, and what has to clear the circle is its widest point — the
//     corner at `|y| = centre + height/2`, not the middle of it;
//   · and the rim is 5px wide, stroked centred on the radius, so the interior a
//     word can sit in ends 2.5px INSIDE the circle, not at it.
//
// Measured properly the room is 63.6px and the word is 67.8px. It never fitted;
// the budget was just generous in the same direction twice.
//
// ── WHAT CHANGED, AND WHAT DID NOT ─────────────────────────────────────────
// **The copy did not.** `& UPGRADE` is player-facing and it is there on purpose
// (GDD §2.5: "a player who doesn't know upgrades exist will never look for
// them"), so shortening it was the last resort and was not needed.
// **The tracking did not** — `TRACKING.label` at its ratified .16em.
// **The button did not** — {@link BUILD_BUTTON_ANCHOR}'s rect is a layout
// contract QA's placement suite asserts against, and GDD §2.4 makes a touch
// target a floor rather than a preference, so growing the circle to fit a word
// was never on the table.
//
// **The type size did**, by one pixel: the sub-line is fitted to the room rather
// than to a guess ({@link fitRoundLabelSize}), and at the shipped geometry that
// lands it at 9px where a0-23 put it at 10. That is a shrink below a size that
// was already a stated exception to `TYPE_MIN`, so, per this brief, it is said
// out loud rather than slipped in: **9px of Oxanium 700 at dpr 3 is 27 device
// pixels of a face designed for game interfaces, and the alternative was a word
// that runs past the button drawing it.** The primary word `BUILD` is untouched
// at 15px — it was inside the circle all along, with 5% to spare, and this
// module now asserts that rather than assuming it.

/** One line of type on a round button, as the view will draw it. */
export interface RoundLabelLine {
  readonly text: string;
  readonly face: MetricFace;
  /** Tracking in `em` — the ratified scale (`../art/materials` TRACKING). */
  readonly tracking: number;
  /** Type size in CSS px, after fitting. */
  readonly size: number;
  /** The line's own centre, px from the button's centre, y down. */
  readonly centreY: number;
}

/**
 * The half-width available to a line of type inside a rimmed circle, CSS px.
 *
 * `yExtent` is the line's widest point — `|centreY| + height/2` — because a line
 * is a box and the corner is what clears the circle, not the baseline. The rim is
 * stroked *centred* on the radius (`touch-chrome` `drawRim`), so the interior ends
 * half a rim inside it: a word drawn to the radius itself would sit under the
 * ring, which is the "breaks the silhouette" half of the report.
 */
export function roundLabelHalfWidth(radius: number, rimWidth: number, yExtent: number): number {
  const interior = radius - rimWidth / 2;
  const y = Math.abs(yExtent);
  if (y >= interior) return 0;
  return Math.sqrt(interior * interior - y * y);
}

/**
 * Clearance a word keeps from the ring, on each side, CSS px.
 *
 * Small on purpose. The width model is already an upper bound — it sums per-glyph
 * advances where the browser kerns, which over-reports a nine-glyph line by about
 * a pixel — so this is the *stated* clearance on top of an unstated one, and it is
 * what stops a label that technically fits from optically touching the rim.
 */
export const ROUND_LABEL_PAD = 1;

/**
 * The largest size at or below `designSize` at which `text` fits the circle at
 * `centreY`, in half-pixel steps — or `null` if even `minSize` does.
 *
 * `null` rather than a clamped size on purpose: a caller that silently drew an
 * unreadable label would be doing the thing this whole brief is about. The one
 * caller ({@link BUILD_BUTTON_LABEL}) turns it into a thrown error at module load,
 * so "the words no longer fit the button" is a red unit test naming the string
 * rather than a screenshot somebody has to notice.
 */
export function fitRoundLabelSize(
  text: string,
  face: MetricFace,
  tracking: number,
  centreY: number,
  designSize: number,
  radius: number,
  rimWidth: number,
  minSize: number,
): number | null {
  for (let step = Math.round(designSize * 2); step >= Math.round(minSize * 2); step--) {
    const px = step / 2;
    const spec = { face, size: px, tracking };
    const yExtent = Math.abs(centreY) + textHeight(text, spec) / 2;
    const room = 2 * roundLabelHalfWidth(radius, rimWidth, yExtent) - 2 * ROUND_LABEL_PAD;
    if (textWidth(text, spec) <= room) return px;
  }
  return null;
}

/** The BUILD button's circle, as `@platform/touch-visuals` draws it: `R_BUILD`,
 *  and the `TOUCH_RIM.build` ring stroked centred on it. Restated here because
 *  this module may not import the platform layer at runtime; `touch-visuals.test.ts`
 *  pins the two together, the same discipline the type stacks are held to. */
export const BUILD_BUTTON_RADIUS = 38;
export const BUILD_BUTTON_RIM = 5;

/** Where the two lines' centres sit, px from the button's centre. a0-23's own
 *  numbers, unchanged: the pair reads as one label and moving it would be a
 *  second change riding along with the fix. */
const BUILD_WORD_Y = -10;
const BUILD_SUB_Y = 10;

/** The floor the sub-line may be fitted down to before this file refuses. Below
 *  this a nine-glyph line on a phone is decoration rather than copy, and the
 *  answer would be to change the words instead. */
const BUILD_SUB_MIN_SIZE = 8.5;

/** `BUILD`'s size. a0-23's, unchanged — and now asserted to fit rather than
 *  assumed to (`./build-button.test.ts`). */
const BUILD_WORD_SIZE = 15;

/** The sub-line's size before fitting: a0-23's 10px, which is what the circle
 *  gets asked for and what it would still get on a bigger button. */
const BUILD_SUB_DESIGN_SIZE = 10;

function fitOrThrow(
  text: string,
  face: MetricFace,
  tracking: number,
  centreY: number,
  designSize: number,
  minSize: number,
): number {
  const size = fitRoundLabelSize(
    text,
    face,
    tracking,
    centreY,
    designSize,
    BUILD_BUTTON_RADIUS,
    BUILD_BUTTON_RIM,
    minSize,
  );
  if (size === null) {
    throw new Error(
      `"${text}" does not fit the BUILD button at any size down to ${minSize}px — ` +
        `change the words, not the floor (src/ui/build-button.ts).`,
    );
  }
  return size;
}

/**
 * The two lines on the BUILD button, fitted to the circle that holds them.
 *
 * The view (`@platform/touch-visuals`) draws exactly this: same words, same
 * faces, same tracking tiers, same baselines, and the sizes this arithmetic
 * produced. See the block above for what a0-32 changed and what it did not.
 */
export const BUILD_BUTTON_LABEL: readonly RoundLabelLine[] = [
  {
    text: 'BUILD',
    face: 'headingBold',
    tracking: DISPLAY_TRACKING.heading,
    size: fitOrThrow('BUILD', 'headingBold', DISPLAY_TRACKING.heading, BUILD_WORD_Y, BUILD_WORD_SIZE, BUILD_WORD_SIZE),
    centreY: BUILD_WORD_Y,
  },
  {
    text: '& UPGRADE',
    face: 'bodyBold',
    tracking: TRACKING.label,
    size: fitOrThrow(
      '& UPGRADE',
      'bodyBold',
      TRACKING.label,
      BUILD_SUB_Y,
      BUILD_SUB_DESIGN_SIZE,
      BUILD_SUB_MIN_SIZE,
    ),
    centreY: BUILD_SUB_Y,
  },
];
