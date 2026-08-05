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
 * Pure and PixiJS-free — like the rest of the HUD's decision layer
 * ({@link ./hud-geometry}, {@link ./build-wheel}) — so it unit-tests headless.
 */

import type { AnchorSpec } from '@platform/layout-registry';

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
