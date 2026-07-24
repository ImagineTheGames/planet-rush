/**
 * src/art/vfx/death-moment.ts — the three seconds. OWNER: Art & Audio Agent.
 *
 * The tone paragraph is quoted into the GDD (§4.7) and into `style-guide.md`
 * (§8) as a contract, and one sentence of it is a *mechanic*:
 *
 * > *"But homes are the one serious thing in it — when a planet dies, the game
 * > goes briefly quiet, the wreck stays on the map all match, and **nobody jokes
 * > for three seconds**."*
 *
 * The style guide's operational reading spells out what that costs the audio:
 * *"the planet-death moment goes briefly quiet — audio drops out, the beat holds
 * for ~3 seconds … This quiet is a mechanic of tone, not polish, and cannot be
 * cut."* So it is not a mixer preference living in the audio engine where a
 * later optimisation could quietly disable it. It is this: a tiny state machine
 * with a name, its own test, and one number the whole mix multiplies by.
 *
 * ## The shape of the quiet
 *
 * ```
 * gain 1 ┐
 *        │╲                                            ╭─────
 *        │ ╲                                          ╱
 *      0 └──╰──────────────────────────────────────╯───────► t
 *          ↑ 0.12 s cut          3 s of silence      ↑ 0.9 s back
 * ```
 *
 * The drop is fast because a slow fade reads as a mixing accident; the return is
 * slow because coming back at full volume would make the quiet feel like a bug
 * being fixed rather than a beat being held. The alarm is not exempt — during
 * these three seconds nothing plays, which is the entire point.
 *
 * Overlapping deaths **refresh** rather than stack: two planets dying a second
 * apart is one long quiet, not six seconds of it.
 */

/** Seconds of quiet after a planet dies. The tone contract's number (GDD §4.7). */
export const HUSH_S = 3;

/** Seconds to cut the mix. Fast — a slow drop reads as a mistake. */
export const HUSH_CUT_S = 0.12;

/** Seconds to bring the mix back afterwards. Slow, so the beat lands. */
export const HUSH_RETURN_S = 0.9;

/**
 * The planet-death moment: fire it when a home dies, multiply the mix by
 * {@link gain} every frame.
 *
 * Pure and headless — it advances only by the `dt` it is handed, with no timers
 * and no wall clock, so it tests deterministically and behaves the same in a
 * replay as in a live match (GDD §4.1).
 */
export class DeathMoment {
  /** Seconds since the most recent planet death, or -1 when nothing is held. */
  private elapsed = -1;
  private deaths = 0;

  /** A home just died: hold the beat (GDD §4.7). Re-triggering refreshes it. */
  trigger(): void {
    this.elapsed = 0;
    this.deaths++;
  }

  /** Advance the moment. */
  update(dt: number): void {
    if (this.elapsed < 0) return;
    this.elapsed += dt > 0 ? dt : 0;
    if (this.elapsed >= HUSH_S + HUSH_RETURN_S) this.elapsed = -1;
  }

  /** True while the mix is still being held down or brought back. */
  get active(): boolean {
    return this.elapsed >= 0;
  }

  /** True during the silent window itself — the three seconds nobody jokes in. */
  get silent(): boolean {
    return this.elapsed >= 0 && this.elapsed < HUSH_S;
  }

  /** Seconds of quiet left before the mix starts coming back. */
  get remaining(): number {
    return this.elapsed < 0 ? 0 : Math.max(0, HUSH_S - this.elapsed);
  }

  /** Seconds since the death being held, or -1 when nothing is held. */
  get since(): number {
    return this.elapsed;
  }

  /** How many deaths this moment has held. Debug and tests. */
  get count(): number {
    return this.deaths;
  }

  /**
   * The factor the whole mix is multiplied by: 1 normally, 0 through the quiet.
   * See the diagram in the module doc.
   */
  get gain(): number {
    const t = this.elapsed;
    if (t < 0) return 1;
    if (t < HUSH_CUT_S) return 1 - t / HUSH_CUT_S;
    if (t < HUSH_S) return 0;
    return Math.min(1, (t - HUSH_S) / HUSH_RETURN_S);
  }

  /** Back to normal — a new match, or a rejoin. */
  reset(): void {
    this.elapsed = -1;
    this.deaths = 0;
  }
}
