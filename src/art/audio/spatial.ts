/**
 * src/art/audio/spatial.ts — the listener model. OWNER: Art & Audio Agent.
 *
 * *"I can hear every single thing on the map."* Every world-sourced sound carries
 * its world position, and the listener is the **camera** — what you see is what
 * you hear (developer-ratified, a3-03). This file is the pure geometry that turns
 * an emission's position and the listener's into how the mix should PLACE it:
 *
 *  - a **gain falloff** — full within {@link R_NEAR}, a smooth line to silence at
 *    {@link R_FAR}, so an off-screen bot war is faint or gone while the rock under
 *    your own gun is not (GDD §2.6, "two beats one" — a siege one screen away is
 *    exactly the thing you are meant to notice, so the curve is linear, not the
 *    physically-correct inverse-square that would make it silent);
 *  - a **stereo pan** from the horizontal offset — a fight to your left is on your
 *    left, and the sign flips the instant it crosses the ship;
 *  - an optional distance **lowpass** — far things lose their highs, because that
 *    is what distance does to sound and it is a cheap cue that reads instantly;
 *    the mix only spends a filter node once it actually muffles ({@link LP_BYPASS_HZ}).
 *
 * All of it is arithmetic on two points, so it runs — and is unit-tested — with
 * no audio hardware anywhere near it (GDD §4.1). The mix (`./graph`) turns these
 * numbers into a `StereoPannerNode`, a lowpass and a gain; the engine (`./engine`)
 * owns the listener and the documented non-spatial exceptions (UI cues, the
 * under-attack alarm, the win/loss/death stings, own-ship voices).
 */

/** Distance in world units at which a sound is at full level. A named tunable. */
export const R_NEAR = 260;

/**
 * Distance beyond which a sound is inaudible and culled before synthesis — a bot
 * war on the far side of the claim costs zero. Roughly a screen and a half: the
 * visible arena portion plus a margin, as the ratified spec asks.
 */
export const R_FAR = 1400;

/**
 * Horizontal offset (world units) at which the pan reaches full hard left/right.
 * Smaller than {@link R_FAR} on purpose: distance should widen the stereo field,
 * so a fight near the edge of earshot is already firmly to one side.
 */
export const PAN_WIDTH = 900;

/** Lowpass cutoff at (and within) {@link R_NEAR}: wide open — nothing is filtered. */
export const LP_NEAR_HZ = 20000;

/** Lowpass cutoff at (and beyond) {@link R_FAR}: muffled, the far edge of earshot. */
export const LP_FAR_HZ = 1400;

/**
 * Above this cutoff the mix skips the filter node entirely — a near sound pays
 * nothing for a filter that would not colour it. So only genuinely-distant
 * emissions allocate a biquad, which keeps the per-voice cost at the listener's
 * feet where most sounds are.
 */
export const LP_BYPASS_HZ = 18000;

/** How the mix should place one emission relative to the listener. */
export interface Placement {
  /** Distance gain, 1 near the camera down to 0 past {@link R_FAR}. */
  readonly gain: number;
  /** Stereo pan, −1 (hard left) … 0 (centred) … +1 (hard right). */
  readonly pan: number;
  /** Lowpass cutoff in Hz — {@link LP_NEAR_HZ} when open, down to {@link LP_FAR_HZ}. */
  readonly cutoff: number;
  /** True once past {@link R_FAR}: cull before synthesis (perf). */
  readonly culled: boolean;
}

/**
 * At the listener's own position: full, centred, unfiltered. The placement for a
 * spectator or a test with no listener, and effectively the one an own-ship sound
 * lands on (the camera follows your ship, so your gun is always ~here).
 */
export const HERE: Placement = { gain: 1, pan: 0, cutoff: LP_NEAR_HZ, culled: false };

/** The distance gain, 1 within {@link R_NEAR}, a straight line to 0 at {@link R_FAR}. */
export function falloff(distance: number): number {
  if (!(distance > R_NEAR)) return 1; // handles NaN and anything inside the near radius
  if (distance >= R_FAR) return 0;
  return 1 - (distance - R_NEAR) / (R_FAR - R_NEAR);
}

/**
 * The stereo pan for a horizontal offset `dx = emissionX − listenerX`.
 *
 * Positive `dx` (to the right of the camera) pans right, matching a
 * `StereoPannerNode` where +1 is the right channel. Clamped, so a sound far off
 * to one side is hard-panned rather than running past the speaker.
 */
export function panFor(dx: number): number {
  const p = dx / PAN_WIDTH;
  if (!Number.isFinite(p)) return 0;
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/**
 * The lowpass cutoff for a distance: wide open within {@link R_NEAR}, then a
 * straight line down to {@link LP_FAR_HZ} at {@link R_FAR}. Linear in Hz keeps the
 * near field bright — most of the muffling only arrives at range, which is the
 * "gentle" the ratified spec asks for.
 */
export function cutoffFor(distance: number): number {
  if (!(distance > R_NEAR)) return LP_NEAR_HZ;
  if (distance >= R_FAR) return LP_FAR_HZ;
  const t = (distance - R_NEAR) / (R_FAR - R_NEAR);
  return LP_NEAR_HZ + (LP_FAR_HZ - LP_NEAR_HZ) * t;
}

/**
 * Place one emission against the listener — the whole falloff/pan/lowpass model
 * in one call. A `culled` result carries a pan (so a debug spy can still read the
 * direction) but the mix must not synthesise it.
 */
export function place(x: number, y: number, listenerX: number, listenerY: number): Placement {
  const dx = x - listenerX;
  const dy = y - listenerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const pan = panFor(dx);
  if (distance >= R_FAR) return { gain: 0, pan, cutoff: LP_FAR_HZ, culled: true };
  return { gain: falloff(distance), pan, cutoff: cutoffFor(distance), culled: false };
}
