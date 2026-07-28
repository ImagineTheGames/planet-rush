/**
 * src/art/audio/music.ts — the adaptive soundtrack. OWNER: Sound Agent.
 *
 * The ambient bed (`./bank` {@link SOUND.ambient}) is one loop that never
 * changes; this is the other kind of music the brief asks for — *a music layer
 * that follows match phase.* It does not play a fixed track and it is not a
 * playlist: it is four looping stems whose gains are driven, every frame, by
 * where the match is on its own arc:
 *
 * > *calm drone while mining · tension as the waves rise · the full theme during
 * > a siege · thinning dread through the collapse · a sting on the win or loss.*
 *
 * ## Two halves, for the same reason the rest of the module has two
 *
 *  - {@link MusicScore} is a **pure state machine** — numbers in, stem gains
 *    out, no audio at all. It reads the same tell queue the mix does (waves,
 *    combat, collapse, the end) plus the alarm's own "your home is under siege"
 *    state, and turns them into a phase and a set of target gains. It runs in
 *    the server and the QA harness like the alarm does (GDD §4.1), and it tests
 *    headless, which is where the "does the theme actually rise in a siege"
 *    question gets answered without a browser.
 *  - {@link MusicDirector} is the **audible half**: four {@link SustainedVoice}s
 *    (`./weapons`) on the `music` bus, crossfading slowly toward the score's
 *    targets, plus the win/loss sting. It exists only when there is a real mix.
 *
 * ## The three seconds are protected (d5-02, GDD §4.7)
 *
 * The soundtrack rides the same master → duck node as everything else, so the
 * station-death hush zeroes it automatically — no special case. The one place it
 * *would* have broken the quiet is the win/loss sting, which lands at match end,
 * right on top of the final station's death. So the sting is **held back until
 * the hush has lifted**: the beat a player remembers is the silence, and then
 * the sting after it. That delay is the whole reason the director is handed the
 * hush gain every frame.
 *
 * ## Cuttable, and its own slider (GDD §4.9 item 3)
 *
 * The soundtrack is music, not a mechanic — item 3 on the ranked cut list, the
 * same line the ambient bed sits on. So it is toggleable ({@link MusicDirector.
 * setEnabled}) and carries its own volume, the `music` bus, independent of the
 * SFX the alarm and every tell live on. Nothing in the mix depends on it.
 */

import { TELL, type TellKind } from '../tells';
import { SOUND } from './bank';
import type { AudioGraph } from './graph';
import { SustainedVoice } from './weapons';

// ---------------------------------------------------------------------------
// The score — a pure phase/intensity model
// ---------------------------------------------------------------------------

/**
 * How much one combat tell heats the soundtrack toward a full theme.
 *
 * Broader than the alarm's {@link WEIGHTS} on purpose: the alarm is *your home
 * under siege* and nothing else, but the music swells for any fight the player
 * is in — including the one where they are the attacker, cutting someone else's
 * core. Mining is pointedly **not** here: `mineHit` heats nothing, so a player
 * grinding rock in the calm gets the calm drone, which is the inversion the
 * whole game turns on (GDD §2.3) made audible.
 */
export const MUSIC_COMBAT: Readonly<Partial<Record<TellKind, number>>> = {
  [TELL.weaponHit]: 0.05, // a firing tick on hull/turret/shield/core — a fight
  [TELL.coreHit]: 0.1,
  [TELL.shieldHit]: 0.06,
  [TELL.shieldDown]: 0.5,
  [TELL.turretDown]: 0.5,
  [TELL.turretFire]: 0.03,
  [TELL.shotImpact]: 0.03,
  [TELL.shipExplode]: 0.35,
};

/** Heat lost per second. The leak the odd stray shot cannot out-deposit. */
export const HEAT_LEAK = 0.6;

/** Heat added per second while the local home is under the alarm — saturates fast. */
export const ALARM_HEAT = 2.5;

/** Heat at which the phase reads as a siege. Hysteresis pairs it with {@link SIEGE_OFF}. */
export const SIEGE_ON = 0.4;

/** Heat it must fall back under before the siege label releases. */
export const SIEGE_OFF = 0.2;

/**
 * Hush gain above which a held win/loss sting is allowed to sound.
 *
 * The gain climbs back through this point on the far side of the three-second
 * quiet ({@link DeathMoment}), so gating on it is what makes the sting land
 * *after* the silence rather than inside it (GDD §4.7).
 */
export const STING_GATE = 0.5;

/** Where the match is on its arc — a label over the continuous model, for reads. */
export type MusicPhase = 'calm' | 'rising' | 'siege' | 'collapse' | 'over';

/** The target gain of each stem, 0..1. The score's whole output. */
export interface StemGains {
  /** The calm foundation drone. On through the whole match until it collapses. */
  readonly bed: number;
  /** The heartbeat that rises with the asteroid waves. */
  readonly pulse: number;
  /** The full theme, in during a siege. */
  readonly theme: number;
  /** The bleak drone that replaces the bed through the collapse. */
  readonly dread: number;
}

/** Options for {@link MusicScore}. */
export interface MusicScoreOptions {
  /** Heat lost per second. */
  readonly leak?: number;
}

/**
 * The soundtrack's phase model: match signals in, stem gains out.
 *
 * Pure and headless, exactly like {@link UnderAttackAlarm} and
 * {@link DeathMoment}: it advances only by the `dt` it is handed and touches no
 * audio, so a test can drive a whole match through it and assert that the theme
 * rose in the siege and thinned in the collapse — the design sentence, as
 * numbers.
 */
export class MusicScore {
  private heat = 0;
  private waveTension = 0;
  private collapsing = false;
  private ended = false;
  private outcomeWin = false;
  private underAttack = false;
  private siegeLabel = false;
  private pending: 'win' | 'loss' | null = null;
  private currentGains: StemGains = { bed: 1, pulse: 0, theme: 0, dread: 0 };

  private readonly leak: number;

  constructor(options: MusicScoreOptions = {}) {
    this.leak = Math.max(0, options.leak ?? HEAT_LEAK);
    this.recompute();
  }

  /** The current stem targets. Recomputed each {@link update}. */
  get gains(): StemGains {
    return this.currentGains;
  }

  /** The phase label — a read over the continuous model, for debug and tests. */
  get phase(): MusicPhase {
    if (this.ended) return 'over';
    if (this.collapsing) return 'collapse';
    if (this.siegeLabel) return 'siege';
    if (this.waveTension > 0.01) return 'rising';
    return 'calm';
  }

  /** Combat heat, 0..1 — how close the theme is to full. The test's eye. */
  get intensity(): number {
    return this.heat;
  }

  /** Wave tension, 0..1: rises stepwise with each asteroid wave and never falls. */
  get tension(): number {
    return this.waveTension;
  }

  /** A win/loss sting waiting for the hush to lift, or `null`. */
  get pendingSting(): 'win' | 'loss' | null {
    return this.pending;
  }

  /**
   * Feed one tell. Combat kinds heat the theme; everything else is a no-op here.
   *
   * @returns the heat deposited (0 for a kind that is not combat).
   */
  combat(kind: TellKind): number {
    const weight = MUSIC_COMBAT[kind] ?? 0;
    if (weight <= 0) return 0;
    this.heat = clamp01(this.heat + weight);
    return weight;
  }

  /** An asteroid wave arrived. `magnitude` is the wave number / 5 (`../tells`). */
  wave(magnitude: number): void {
    const t = clamp01(magnitude);
    if (t > this.waveTension) this.waveTension = t;
  }

  /** The collapse phase began: the bed thins to dread (GDD §2.3). */
  collapse(): void {
    this.collapsing = true;
  }

  /** The match resolved. `win` from the `matchEnd` magnitude (1 win, 0 loss). */
  end(win: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.outcomeWin = win;
    this.pending = win ? 'win' : 'loss';
  }

  /** The local home's alarm state, pushed every frame: a siege forces the theme. */
  setUnderAttack(active: boolean): void {
    this.underAttack = active;
  }

  /** Advance the leak, the alarm push, and recompute the stem targets. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.heat = Math.max(0, this.heat - this.leak * step);
    if (this.underAttack) this.heat = clamp01(this.heat + ALARM_HEAT * step);

    // Hysteresis on the siege *label*, so a lull mid-fight does not flicker it.
    if (this.siegeLabel) {
      if (this.heat < SIEGE_OFF) this.siegeLabel = false;
    } else if (this.heat >= SIEGE_ON) {
      this.siegeLabel = true;
    }

    this.recompute();
  }

  /** The director took the pending sting. Clears it so it fires once. */
  clearSting(): void {
    this.pending = null;
  }

  /** True once the match has resolved — a win or a loss. */
  get over(): boolean {
    return this.ended;
  }

  /** True when the resolved match was a win for the local player. */
  get won(): boolean {
    return this.ended && this.outcomeWin;
  }

  /** Back to the opening drone — a new match, a rematch, or a rejoin. */
  reset(): void {
    this.heat = 0;
    this.waveTension = 0;
    this.collapsing = false;
    this.ended = false;
    this.outcomeWin = false;
    this.underAttack = false;
    this.siegeLabel = false;
    this.pending = null;
    this.recompute();
  }

  private recompute(): void {
    const gone = this.collapsing || this.ended;
    this.currentGains = {
      bed: gone ? 0 : 1,
      // The waves bring the pulse in; a siege leans on it too, so a fight before
      // the first wave is not silent underneath the theme.
      pulse: gone ? 0 : clamp01(Math.max(this.waveTension, 0.5 * this.heat)),
      theme: gone ? 0 : this.heat,
      // Dread is the collapse's own voice, and it stops when the match is over —
      // the sting owns the last beat, not a drone under it.
      dread: this.ended ? 0 : this.collapsing ? 1 : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// The director — the audible half
// ---------------------------------------------------------------------------

/** Options for {@link MusicDirector}. */
export interface MusicDirectorOptions {
  /** Ceiling on the four stems, 0..1 — headroom under the SFX. */
  readonly maxGain?: number;
}

/** Default per-stem ceiling. Music sits under the SFX, which are the mechanics. */
const STEM_MAX = 0.9;

/**
 * The soundtrack, playing. Reads a {@link MusicScore} and crossfades four
 * looping stems toward its targets, and fires the win/loss sting once the hush
 * has lifted.
 *
 * ```ts
 * // per frame, after the score has been fed and advanced:
 * director.update(dt, deathMoment.gain);
 * ```
 */
export class MusicDirector {
  private readonly bed: SustainedVoice;
  private readonly pulse: SustainedVoice;
  private readonly theme: SustainedVoice;
  private readonly dread: SustainedVoice;
  private enabled = true;
  private stings = 0;

  constructor(
    private readonly graph: AudioGraph,
    private readonly score: MusicScore,
    options: MusicDirectorOptions = {},
  ) {
    const maxGain = clamp01(options.maxGain ?? STEM_MAX);
    // Slow attacks and releases: a stem should swell and settle over seconds, so
    // no crossfade ever reads as a cut. The bed and the dread are the slowest —
    // they are the ground the rest of the mix stands on.
    this.bed = new SustainedVoice(graph, SOUND.musicBed, { bus: 'music', attack: 2, release: 2.5, maxGain });
    this.pulse = new SustainedVoice(graph, SOUND.musicPulse, { bus: 'music', attack: 0.8, release: 1.5, maxGain });
    this.theme = new SustainedVoice(graph, SOUND.musicTheme, { bus: 'music', attack: 1.4, release: 2, maxGain });
    this.dread = new SustainedVoice(graph, SOUND.musicDread, { bus: 'music', attack: 2.5, release: 2.5, maxGain });
  }

  /** True while the soundtrack is allowed to play — the slider/cut toggle. */
  get playing(): boolean {
    return this.enabled;
  }

  /** Win/loss stings fired since construction. A test's eye on the last beat. */
  get stingCount(): number {
    return this.stings;
  }

  /**
   * One frame: drive the stems toward the score, and fire a held sting once the
   * hush ({@link DeathMoment.gain}) has climbed back past {@link STING_GATE}.
   */
  update(dt: number, hushGain = 1): void {
    if (this.enabled) {
      const g = this.score.gains;
      this.bed.push(g.bed);
      this.pulse.push(g.pulse);
      this.theme.push(g.theme);
      this.dread.push(g.dread);
    }
    // Voices always advance, so a disabled soundtrack releases rather than cuts.
    this.bed.update(dt);
    this.pulse.update(dt);
    this.theme.update(dt);
    this.dread.update(dt);

    const sting = this.score.pendingSting;
    if (this.enabled && sting && hushGain > STING_GATE) {
      this.graph.play(sting === 'win' ? SOUND.musicWin : SOUND.musicLoss, 1, 1, 'music');
      this.score.clearSting();
      this.stings++;
    }
  }

  /**
   * Turn the soundtrack on or off — item 3 on the cut list (GDD §4.9), and the
   * bottom of the music slider. Off fades every stem out; on lets them swell
   * back to wherever the score currently is.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopVoices();
  }

  /** Stop every stem now. A match teardown, or the mix going away. */
  stop(): void {
    this.stopVoices();
  }

  private stopVoices(): void {
    this.bed.stop();
    this.pulse.stop();
    this.theme.stop();
    this.dread.stop();
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
