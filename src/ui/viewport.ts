/**
 * src/ui/viewport.ts — how much screen the HUD is allowed to use, and how much
 * world the camera shows. OWNER: UI Engineer (a0-74).
 *
 * Pure, DOM-free and unit-tested. Two answers live here because they are one
 * question — *the screen you get depends on the screen you have, and nobody
 * decided that* — arriving from three developer reports in a single session:
 *
 * > *"on pc i have the entire screen but im on mobile im confined to a very small
 * > portion of the world … what i'd probably prefer is add a zoom out button on
 * > mobile"*
 * > *"on pc we also need a way to handle UI locations because i have an ultra wide
 * > and all that UI goes to the edges of the screens"*
 *
 * ── 1. THE CONTENT BOX ───────────────────────────────────────────────────────
 *
 * {@link contentBox} is the centred region of the viewport the HUD anchors to.
 * The world still renders **full-bleed** behind it; only the chrome is bound. On
 * a 16:9 display it is the whole viewport and nothing moves at all.
 *
 * **Why 16:9 is the cap.** It is not a taste: `./instrument` scales every HUD
 * metric from `HUD_REFERENCE = 1280×720`, which is 16:9 exactly. Binding the HUD
 * to that aspect gives an ultrawide the HUD *as it was authored*, scaled — rather
 * than the same HUD pulled apart until the build wheel and the hold pips are a
 * head-turn away from each other. Anything wider is world, which is what an
 * ultrawide is for.
 *
 * **Why there is also a floor, and why it is not optional.** A bare aspect cap
 * gets phones badly wrong. A 844×390 landscape phone is aspect **2.16** — already
 * wider than 16:9 — so a pure cap would inset the one device with no horizontal
 * room to give away. {@link CONTENT_MIN_WIDTH} is therefore the width under which
 * nothing is ever inset, and it is `HUD_REFERENCE.width` rather than a new number:
 * below the frame the HUD was drawn for, every pixel is already spoken for.
 *
 * **Height is never capped.** All three reports are horizontal, and an ultrawide
 * is short rather than tall — capping the height would invent an inset nobody
 * asked for and would cost a 32:9 display the little vertical room it has.
 *
 * ── 2. THE VIEW ZOOM ─────────────────────────────────────────────────────────
 *
 * The camera is translate-only (`@platform/camera`), so **one world unit is one
 * CSS pixel** and the view is exactly `viewportWidth` world units wide. That is
 * the whole of the first report, stated as arithmetic: a 1707 px desktop sees
 * 1707 units of a 2400-unit arena (71 %); a 798 px phone sees 798 (33 %). Nobody
 * chose that ratio; it fell out of the pixel size of the glass.
 *
 * {@link VIEW_ZOOM_STEPS} is the ladder that closes it — **view-width
 * multipliers**, so `2` means "twice as much world across the same screen" and
 * the camera scale the renderer applies is `1 / step` ({@link cameraScale}).
 * Because a world unit is a CSS pixel at the shipped camera, the world-units-wide
 * a screen shows is just `viewportWidth × step`; there is no helper for that
 * product on purpose, since the only thing that should ever *report* the view
 * width is the renderer's own `visibleWorld` (the box the cull culls against),
 * which is what `evidence/a0-74-viewport` reads. It
 * is a short cycle rather than a slider because the developer asked for a
 * *button*, and it is touch-only because they explicitly did **not** choose the
 * other option they named (confining the desktop view).
 *
 * ── 3. THE SIGHTLINE FLOOR (a0-134) ─────────────────────────────────────────
 *
 * a0-131 put two real clients in one match and came back with a disagreement:
 *
 * > *"at the shipped VIEW 1× the phone player is being shot by an attacker its
 * > screen does not draw."*
 *
 * The desktop, same match, same instant, drew both ships. That is not the comfort
 * report §2 answers — it is the same arithmetic turned into a **fairness** bug,
 * because at the shipped default one player can see the fight and the other is
 * being hit from off-screen. §2 gave the phone a way to *ask* for a fair view;
 * this section makes it the only view it is offered.
 *
 * The property, once: **the disc of everything that can reach you fits inside the
 * world your camera draws.** Its radius is {@link SIGHTLINE_RADIUS}, read off the
 * sim rather than typed. Its consequence is {@link minViewZoom}, and the whole of
 * the fix is that {@link viewZoomSteps} drops every rung that cannot keep it — so
 * a device's ladder contains only fair views and the rung it boots at is simply
 * the first of them.
 *
 * **Why the ladder and not a new continuous scale.** A continuous floor works
 * arithmetically and lands the camera at 1.4375× on a 798×384 phone, which is a
 * view the `VIEW` readout has no label for; the control would then either print a
 * number nobody chose or grow a dialect. Dropping rungs keeps `1× / 1.5× / 2×`
 * exactly as they read today and costs one filter.
 *
 * **Why the floor and not the default alone.** The smaller, more honest fix would
 * be to boot a phone at 1.5× and leave 1× on the ladder — but the control cycles,
 * so 1× stays one tap away, and a property a tap can break is not a property.
 *
 * **Why range was not touched instead.** Expressing weapon range as a fraction of
 * the visible world is `src/sim/`'s to change and is the same bug from the other
 * end: a 32:9 player would out-range a phone *by construction*. Range stays
 * absolute at `WEAPON_RANGE` for every screen, so nothing here changes what an
 * ultrawide can reach — only whether a phone can see what reaches it.
 *
 * **What this is not.** It is not a second family of screen-edge markers: the
 * alarm arrow already owns that idiom for the off-screen station, and a second
 * one is how the HUD gets crowded (a0-116, a0-122, a0-125). A marker would tell
 * the player about the bug; this removes it.
 */

import { SHIP_RADIUS, WEAPON_RANGE } from '../sim/constants';
import { HUD_REFERENCE } from './instrument';
import type { Rect, Viewport } from '@platform/layout-registry';

// ---------------------------------------------------------------------------
// 1. The content box
// ---------------------------------------------------------------------------

/**
 * The widest the HUD's content box is allowed to get, as `width / height` — the
 * aspect of {@link HUD_REFERENCE}, derived rather than typed, so the cap cannot
 * drift from the frame every HUD metric is scaled off.
 */
export const CONTENT_MAX_ASPECT = HUD_REFERENCE.width / HUD_REFERENCE.height;

/**
 * The viewport width under which the content box is always the whole viewport,
 * CSS px — see the header. `HUD_REFERENCE.width`, because below the frame the HUD
 * was authored at there is no spare width to inset.
 */
export const CONTENT_MIN_WIDTH = HUD_REFERENCE.width;

/**
 * The centred region of `viewport` the HUD chrome anchors to, CSS px.
 *
 * Equal to the whole viewport whenever the display is 16:9 or narrower, or under
 * {@link CONTENT_MIN_WIDTH} wide — which is every phone, every tablet and every
 * ordinary desktop window, so this is a no-op on all of them. On a 21:9 or 32:9
 * display it is a centred box of reference aspect with the extra width left to the
 * world behind it.
 *
 * Allocates one Rect: this is called on resize and once per frame at most, never
 * per entity.
 */
export function contentBox(viewport: Viewport): Rect {
  const W = Math.max(0, viewport.width);
  const H = Math.max(0, viewport.height);
  const capped = H * CONTENT_MAX_ASPECT;
  // Never wider than the viewport, never narrower than the floor (and the floor
  // itself never wider than the viewport — a 320 px phone keeps all 320).
  const width = Math.min(W, Math.max(capped, Math.min(W, CONTENT_MIN_WIDTH)));
  return { x: (W - width) / 2, y: 0, width, height: H };
}

// ---------------------------------------------------------------------------
// 2. The view zoom
// ---------------------------------------------------------------------------

/**
 * The zoom ladder, as **view-width multipliers** — how many times more world sits
 * across the screen than at the shipped camera. `1` is the shipped view.
 *
 * Why it stops at 2, measured rather than guessed: a phone at 798 CSS px sees 798
 * world units, and 2× buys it 1596 against the 1707 a 1707×898 desktop sees —
 * 93 % of the desktop view, and more than a 1280-wide desktop window gets. The
 * step past it would have to buy the remaining 7 % by drawing a `SHIP_RADIUS = 16`
 * ship at under 8 px across, which is a ship the player can no longer read. The
 * gap closes here; it does not close by going further.
 */
export const VIEW_ZOOM_STEPS: readonly number[] = [1, 1.5, 2];

/** The shipped view — the ladder's first rung, and what a screen with room to
 *  spare gets. It is no longer what *every* screen gets: {@link viewZoomSteps}
 *  withholds it from a screen too short to keep the sightline (a0-134), so the
 *  rung a device boots at is {@link defaultViewZoom}, not this. Kept exported
 *  because the HUD wants a rung to draw before the host has fed it one. */
export const DEFAULT_VIEW_ZOOM = VIEW_ZOOM_STEPS[0] as number;

// ---------------------------------------------------------------------------
// 3. The sightline floor (a0-134)
// ---------------------------------------------------------------------------

/**
 * How far from the player's ship the camera must draw world, in world units, for
 * *"something that can shoot you is visible to you"* to hold — see the header §3.
 *
 * Both halves are read from the sim rather than typed here, so a balance pass
 * that moves either one moves this with it:
 *
 *  - `WEAPON_RANGE` (260) is the acquisition radius auto-aim engages within
 *    (`src/sim/step.ts` sizes its search at `WEAPON_RANGE²`), and it is the
 *    governing reach of anything in the game that shoots a ship: every turret
 *    tier is *strictly under* it by a stated design rail (`constants.ts` — Mk III
 *    reaches 250, and "the range rail is a design invariant, not a tuning knob").
 *  - `SHIP_RADIUS` (16) is added so what arrives on screen is the shooter's
 *    **hull**. A ship whose centre lands exactly on the edge is drawn as half a
 *    ship in the last pixel column, and half a ship at the edge of a phone is not
 *    an answer to "who is shooting me".
 */
export const SIGHTLINE_RADIUS = WEAPON_RANGE + SHIP_RADIUS;

/**
 * The smallest view-width multiplier at which `viewport` keeps the sightline —
 * `2 × SIGHTLINE_RADIUS / min(width, height)`.
 *
 * **The short axis is the whole of it.** The camera centres the ship, so the
 * world it draws reaches half the glass in each direction and the nearest edge is
 * always the short one. A landscape phone's *width* was never the problem — 798
 * CSS px is ±399 world units, comfortably past 276 — and its height is ±192. That
 * `min` is also why the answer does not change when a phone is turned: a rotation
 * swaps the two and `min` cannot tell.
 *
 * Returned unrounded and un-clamped: it can be **below 1** on a screen that
 * already has the room (a 1280×800 desktop needs 0.69), which is exactly what
 * lets {@link viewZoomSteps} leave such a screen's ladder untouched.
 */
export function minViewZoom(viewport: Viewport): number {
  const short = Math.min(viewport.width, viewport.height);
  // A degenerate viewport (0, NaN — a canvas measured mid-teardown) gets the
  // shipped ladder rather than a camera scale of 0 or Infinity.
  if (!Number.isFinite(short) || short <= 0) return DEFAULT_VIEW_ZOOM;
  return (2 * SIGHTLINE_RADIUS) / short;
}

/**
 * The rungs `viewport` is allowed to be on: {@link VIEW_ZOOM_STEPS} with every
 * view that cannot keep the sightline dropped. **This is the fix** — everything
 * else in this section reads its answer off this one list.
 *
 * Called with no viewport it is the shipped ladder unchanged, so a caller that
 * has no screen to reason about (a stored-value parse before boot) is exactly
 * where it was.
 *
 * What it returns on the matrix, measured (`src/ui/hud-geometry.test.ts`):
 *
 * | viewport            | short axis | floor  | ladder      |
 * |---------------------|-----------:|-------:|-------------|
 * | desktop 1280×800    |        800 | 0.690  | 1, 1.5, 2   |
 * | pixel 915×412       |        412 | 1.340  | 1.5, 2      |
 * | iphone 844×390      |        390 | 1.415  | 1.5, 2      |
 * | qa-phone 798×384    |        384 | 1.438  | 1.5, 2      |
 * | iphone-se 375×667   |        375 | 1.472  | 1.5, 2      |
 * | small 568×320       |        320 | 1.725  | 2           |
 *
 * Two things that table says out loud. **A desktop is untouched** — which is the
 * point, since the desktop client in a0-131 could already see everything and the
 * defect was only ever the phone's. And **the smallest screen the game claims to
 * run on (GDD §4.3) has exactly one fair view, and it is the widest rung the
 * ladder has**: fairness there consumes the whole of §2's cycle. That is a real
 * cost, stated rather than discovered — the ladder stops at 2 because a
 * `SHIP_RADIUS` ship drawn past it stops being readable, so a 320 px screen has
 * no headroom left at all and the next screen down would have nowhere to go.
 *
 * The fallback branch is for exactly that screen: where no shipped rung is wide
 * enough, the floor itself is the ladder, so the property holds on viewports
 * nobody enumerated (a 240 px-tall browser window) rather than failing silently
 * on them.
 */
export function viewZoomSteps(viewport?: Viewport): readonly number[] {
  if (!viewport) return VIEW_ZOOM_STEPS;
  const floor = minViewZoom(viewport);
  const fair = VIEW_ZOOM_STEPS.filter((step) => step >= floor);
  return fair.length > 0 ? fair : [floor];
}

/**
 * The rung a screen boots at — the first fair one. On a desktop that is the
 * shipped `1×` and nothing has changed; on a phone it is the smallest widening
 * that answers a0-131, never more.
 */
export function defaultViewZoom(viewport?: Viewport): number {
  return viewZoomSteps(viewport)[0] as number;
}

/**
 * Seat an arbitrary rung on `viewport`'s ladder — the public form of the guard
 * every function here runs, and what a host calls when the *screen* changed
 * rather than the player's choice.
 *
 * A resize, a rotation or a fullscreen flip can withdraw the rung a player is on
 * (a short desktop window crosses the floor at 552 px tall, and there is no zoom
 * control on desktop to put them back). Clamping is upward: the widening a screen
 * needs is never taken away by a later one that needs less.
 */
export function seatViewZoom(step: number, viewport?: Viewport): number {
  return normaliseZoom(step, viewport);
}

/**
 * The camera scale for a view-width multiplier: `1 / step`.
 *
 * The renderer scales its world root by this, so a step of 2 halves the drawn size
 * of everything and doubles the world on screen. Stated as a function rather than
 * left at each call site because the two are easy to invert by accident, and an
 * inverted zoom is a zoom *in* on the device that already sees least.
 */
export function cameraScale(step: number, viewport?: Viewport): number {
  const s = normaliseZoom(step, viewport);
  return 1 / s;
}

/**
 * The next rung of this screen's ladder, wrapping back to the first. The whole
 * behaviour of the control: one button, cycled, no slider.
 *
 * `steps` is the ladder to cycle — {@link viewZoomSteps} for the live screen,
 * defaulting to the shipped one. It is passed in rather than derived from a
 * viewport here because the HUD lays out in the *logical* frame while the camera
 * reads the *visual* one, and those differ by a URL bar: the host computes the
 * ladder once, off the camera's own viewport, and the two cannot drift (a0-134).
 * On a screen with a single fair rung this returns that rung, so the press
 * changes nothing rather than seating a view the player cannot be given.
 */
export function nextViewZoom(step: number, steps: readonly number[] = VIEW_ZOOM_STEPS): number {
  const ladder = steps.length > 0 ? steps : VIEW_ZOOM_STEPS;
  const i = ladder.indexOf(snapTo(step, ladder));
  return ladder[(i + 1) % ladder.length] as number;
}

/**
 * The label a zoom step wears on the control — `1×`, `1.5×`, `2×`. Trailing
 * zeroes are dropped so 1.5 does not read as `1.50×`.
 *
 * It labels the rung it is HANDED rather than seating it on a ladder first
 * (a0-134). The caller is the HUD, drawing the rung the camera is actually on,
 * and a readout that quietly re-seats its own input is a readout that can print a
 * view the player is not looking at — which is the class of bug this whole file
 * is now about. The only guard left is against a number that is not one:
 * `undefined×` on a HUD whose host has not fed it a rung yet.
 */
export function viewZoomLabel(step: number): string {
  const s = Number.isFinite(step) && step > 0 ? step : DEFAULT_VIEW_ZOOM;
  return `${Number(s.toFixed(2))}×`;
}

/**
 * The storage key the chosen zoom persists under — the same
 * `planet-rush:` family as the fire mode and the control scheme, so a player's
 * view survives the match, the reload and the next match (brief: *"remembered
 * across matches"*).
 */
export const VIEW_ZOOM_STORAGE = 'planet-rush:viewZoom';

/** The string to persist for a step, seated on `viewport`'s ladder first so a
 *  rung the screen is not allowed to be on can never reach storage. */
export function storedViewZoom(step: number, viewport?: Viewport): string {
  return String(normaliseZoom(step, viewport));
}

/**
 * The step a stored value seats. Anything unrecognised — an absent key, a stale
 * one, a hand-edited save, or a rung a future build removes — folds to
 * {@link DEFAULT_VIEW_ZOOM}, so nothing a player ever saved can seat a zoom that
 * is not on the ladder.
 */
export function parseViewZoom(stored: string | null | undefined, viewport?: Viewport): number {
  // A player with nothing stored — and one whose stored value is not a number at
  // all — gets the rung their SCREEN boots at, which since a0-134 is not
  // necessarily the shipped `1×`.
  if (typeof stored !== 'string') return defaultViewZoom(viewport);
  const n = Number(stored);
  if (!Number.isFinite(n)) return defaultViewZoom(viewport);
  return snapTo(n, viewZoomSteps(viewport));
}

/** Snap an arbitrary number onto this screen's ladder — the guard every function
 *  above runs first, so a caller that hand-rolls a step can never produce a
 *  camera scale of 0, NaN or Infinity, and (since a0-134) can never seat a rung
 *  the screen it is on is not allowed to be on. */
function normaliseZoom(step: number, viewport?: Viewport): number {
  const ladder = viewZoomSteps(viewport);
  if (!Number.isFinite(step)) return ladder[0] as number;
  return snapTo(step, ladder);
}

/**
 * The rung of `ladder` a raw number seats: the **narrowest view at least as wide
 * as asked for**, or the widest rung when nothing on the ladder reaches it.
 *
 * Clamping *upward* rather than folding to a default is what a0-134 needs from a
 * stored value. A player who saved `1` before this shipped, or hand-edited one
 * in, is seated at their screen's first fair rung instead of the unfair view they
 * asked for — where the old fold-to-default would have handed them exactly the
 * rung the floor exists to withhold.
 */
function snapTo(step: number, ladder: readonly number[]): number {
  const widest = ladder[ladder.length - 1] as number;
  return ladder.find((rung) => rung >= step) ?? widest;
}
