/**
 * src/art/audio/engine.ts — tells in, sound out. OWNER: Art & Audio Agent.
 *
 * The twin of `../vfx/field.ts`. That file switches over the frame's
 * {@link TellQueue} and *draws* every moment; this one switches over the same
 * queue and *sounds* them. Two exhaustive switches over one enum is what turns
 * the Art & Audio mandate — *"every mechanic in section 2 has a visible and
 * audible tell"* (GDD §3.6) — into something a test can check rather than
 * something a reviewer has to remember.
 *
 * ```ts
 * // per frame, in the Platform Engineer's loop:
 * tells.clear();
 * observer.observe(world, dt, tells);
 * field.consume(tells);          // draws
 * audio.consume(tells);          // sounds — the same queue, untouched
 * field.update(dt);
 * audio.update(dt);
 * ```
 *
 * ## Four things it owns beyond the routing
 *
 *  - **The hush.** `DeathMoment.gain` goes onto the duck node every frame, and
 *    one-shots are skipped outright while it is zero. That is the tone
 *    contract's three seconds (GDD §4.7) as two lines of code, in the one place
 *    they cannot be optimised away by someone tidying the mixer.
 *  - **The alarm** (`./alarm`), fed only by damage against the local player's
 *    own home — a mechanic, not a notification (GDD §2.2).
 *  - **The held voice** (`./weapons`): the thruster, a state rather than a moment.
 *    Firing is no longer one — since amendment v0.3 a shot is a discrete one-shot
 *    (`./bank` rockChip / hullHit), routed like any other tell.
 *  - **The device cues** ({@link AudioEngine.cue}): the p4-03 UI seams — a press,
 *    a purchase, a rejected buy, the ping, the respawn clock — raised by hand
 *    rather than derived from the world, and matched to the haptic vocabulary.
 *  - **Earshot.** Sounds fall off with distance from the camera, so a siege on
 *    the far side of the map is background and the rock you are actually cutting
 *    is not. Without this the mix is a flat wall on any frame with eight ships
 *    in it.
 *
 * ## Headless by default
 *
 * With no `AudioContext` — the match server, the QA harness, a bot-vs-bot CI run
 * (GDD §4.1) — the engine still runs: the alarm state machine, the death moment
 * and the earshot maths are all numbers, and every call that would touch audio
 * hardware is skipped. Nothing needs a stub, and the tests that matter run in
 * the same mode CI does.
 */

import type { PlayerId } from '@shared/types';
import { DeathMoment } from '../vfx/death-moment';
import { TELL, type TellKind, type TellQueue } from '../tells';
import { UnderAttackAlarm, type AlarmOptions } from './alarm';
import { SOUND, TELL_SOUND, CUE_SOUND, type SoundName, type AudioCue } from './bank';
import { SustainedVoice } from './weapons';
import type { AudioContextLike } from './context';
import { AudioGraph, type LoopHandle, type MixOptions, type Spatial } from './graph';
import { HERE, place, R_NEAR, R_FAR, type Placement } from './spatial';
import { MusicDirector, MusicScore, type MusicDirectorOptions } from './music';

/**
 * Distance in world units at which a sound is at full level. Re-exported from
 * `./spatial` (`R_NEAR`) under the earshot name the callers and tests grew up on.
 */
export const EARSHOT_NEAR = R_NEAR;

/** Distance beyond which a sound is inaudible (`./spatial` `R_FAR`). A screen and a half. */
export const EARSHOT_FAR = R_FAR;

/**
 * World tells heard from anywhere — the wave klaxon, the collapse, the match-end
 * fanfare. Emitted "at the arena centre", they would fall off (or be culled) for a
 * player at the rim of an eight-facility claim, yet the wave clock is a mechanic
 * everyone must hear (GDD §2.3). Like the alarm and the win/loss/death stings
 * (ratified a3-03), these are cockpit alerts, not located combat: no pan, no
 * falloff. Everything else the sim emits at a place is spatialised.
 */
const GLOBAL_TELLS: ReadonlySet<TellKind> = new Set<TellKind>([
  TELL.waveArrive,
  TELL.collapseBegin,
  TELL.matchEnd,
]);

/** Below this the mix is treated as silent and one-shots are not started. */
const HUSHED = 0.001;

/**
 * How far each bus is pulled under the alarm — the mix pass the brief asks for,
 * *"music and SFX duck under the alarm."* The ambience all but disappears and the
 * soundtrack drops right back; the SFX only step aside, because they are the
 * mechanics (turret fire, a shield falling) the alarm is telling you about
 * (GDD §2.2). These are duck *factors*, not levels — the player's sliders survive
 * underneath them (`./graph` setBusDuck).
 */
const AMBIENT_DUCK = 0.25;
const MUSIC_DUCK = 0.3;
const SFX_DUCK = 0.7;

/** Options for {@link AudioEngine}. */
export interface AudioEngineOptions {
  /**
   * The audio context, or `null`/omitted for a silent engine. Silent is a
   * first-class mode, not a degraded one: the server and the harness run in it.
   */
  readonly context?: AudioContextLike | null;
  /** The player whose screen this is. Only their home rings their alarm. */
  readonly local?: PlayerId;
  /**
   * The death moment to read. Pass the `VfxField`'s so the picture and the
   * sound hold the same beat; omit and the engine keeps its own.
   */
  readonly death?: DeathMoment;
  readonly mix?: MixOptions;
  readonly alarm?: AlarmOptions;
  /** Start the ambient bed when the engine starts. Cuttable (GDD §4.9 item 3). */
  readonly ambient?: boolean;
  /** Run the adaptive soundtrack (`./music`). On by default; cuttable (§4.9 item 3). */
  readonly music?: boolean;
  readonly musicMix?: MusicDirectorOptions;
}

/**
 * The audible half of the tell system.
 */
export class AudioEngine {
  /** The under-attack alarm (GDD §2.2). Public: the HUD arrow reads the same state. */
  readonly alarm: UnderAttackAlarm;
  /** The three-second quiet (GDD §4.7). Shared with the VFX field when passed in. */
  readonly death: DeathMoment;
  /** The mix, or `null` when running silent. */
  readonly graph: AudioGraph | null;
  /**
   * The soundtrack's phase model (`./music`). Public and always present — a pure
   * state machine like the alarm, so it runs (and tests) headless, and the HUD
   * could read the same phase the mix is playing.
   */
  readonly musicScore: MusicScore;
  /** The soundtrack, playing, or `null` when running silent. */
  readonly music: MusicDirector | null;

  private readonly thruster: SustainedVoice | null;
  private readonly ownsDeath: boolean;
  private readonly wantsAmbient: boolean;
  private wantsMusic: boolean;

  private ambientLoop: LoopHandle | null = null;
  private alarmLoop: LoopHandle | null = null;
  private local: PlayerId;
  private listenerX = 0;
  private listenerY = 0;
  private hasListener = false;
  private started = false;
  private played = 0;
  private skipped = 0;
  private lastSpatial: Placement = HERE;

  constructor(options: AudioEngineOptions = {}) {
    const ctx = options.context ?? null;
    this.graph = ctx ? new AudioGraph(ctx, options.mix ?? {}) : null;
    this.thruster = this.graph
      ? new SustainedVoice(this.graph, SOUND.thruster, { maxGain: 0.45, release: 0.14, attack: 0.05 })
      : null;
    this.alarm = new UnderAttackAlarm(options.alarm ?? {});
    this.death = options.death ?? new DeathMoment();
    this.ownsDeath = options.death === undefined;
    this.local = options.local ?? -1;
    this.wantsAmbient = options.ambient ?? true;
    this.wantsMusic = options.music ?? true;
    this.musicScore = new MusicScore();
    this.music = this.graph ? new MusicDirector(this.graph, this.musicScore, options.musicMix ?? {}) : null;
    if (!this.wantsMusic) this.music?.setEnabled(false);
  }

  /** True when there is a real mix behind this engine. */
  get audible(): boolean {
    return this.graph !== null;
  }

  /** One-shots actually started since construction. A test's eye on the mix. */
  get playCount(): number {
    return this.played;
  }

  /** One-shots skipped because the hush had the mix at zero (GDD §4.7). */
  get hushedCount(): number {
    return this.skipped;
  }

  /**
   * The placement of the most recent spatial one-shot — the audio spy's readout.
   * Sound cannot screenshot, so the evidence is numbers: the gain a far siege was
   * heard at, the pan a shot flew in on (ratified a3-03, evidence note). A global
   * klaxon or a UI cue leaves it untouched.
   */
  get lastPlacement(): Placement {
    return this.lastSpatial;
  }

  /**
   * What the spatial model would do to a sound at world (x, y) right now, given
   * the current listener — pure, plays nothing. The `?debug=1` audio stage reads
   * this so a live-stage test can attest that a distant fight is near-silent and
   * that pan flips sign across the ship.
   */
  probe(x: number, y: number): Placement {
    return this.hasListener ? place(x, y, this.listenerX, this.listenerY) : HERE;
  }

  /**
   * Where the mix is listening from, in world units — the anchor a spatial probe
   * measures against. `has` is false before the first {@link setListener} (a
   * spectator, a test), where every sound plays centred and full.
   */
  get listener(): { readonly x: number; readonly y: number; readonly has: boolean } {
    return { x: this.listenerX, y: this.listenerY, has: this.hasListener };
  }

  /** True once {@link start} has run — after the unlock gesture (`./unlock`). */
  get running(): boolean {
    return this.started;
  }

  /**
   * Begin the standing voices. Call from the unlock callback: starting a loop
   * before the context is resumed leaves it inaudible but running, which is the
   * failure mode where a player hears nothing and everything looks fine.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.graph?.preload();
    if (this.wantsAmbient) this.startAmbient();
  }

  /** Which slot's home rings the alarm. Set on join, and on a rejoin. */
  setLocal(id: PlayerId): void {
    this.local = id;
  }

  /**
   * Where the camera is, in world units. Sounds fall off from here.
   *
   * Optional — with no listener every sound plays at full level, which is the
   * right behaviour for a test and for a spectator view with no ship to follow.
   */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
    this.hasListener = true;
  }

  /** The player's volume, 0..1. */
  setMasterVolume(value: number): void {
    this.graph?.setMaster(value);
  }

  /** Turn the ambient bed on or off — item 3 on the cut list (GDD §4.9). */
  setAmbient(on: boolean): void {
    if (on) {
      if (this.started) this.startAmbient();
      return;
    }
    this.ambientLoop?.stop(0.6);
    this.ambientLoop = null;
  }

  /** The SFX slider, 0..1 — every world tell and device cue rides this bus. */
  setSfxVolume(value: number): void {
    this.graph?.setBus('sfx', value);
  }

  /** The music slider, 0..1 — the soundtrack's own level (GDD §4.9 item 3). */
  setMusicVolume(value: number): void {
    this.graph?.setBus('music', value);
  }

  /** Turn the adaptive soundtrack on or off — item 3 on the cut list (GDD §4.9). */
  setMusic(on: boolean): void {
    this.wantsMusic = on;
    this.music?.setEnabled(on);
  }

  /**
   * Sound every tell in the queue.
   *
   * The queue is read, never consumed — the VFX field reads the same one — so
   * the caller clears it once per frame.
   */
  consume(tells: TellQueue): void {
    for (let i = 0; i < tells.length; i++) {
      const kind = tells.kindAt(i);
      const x = tells.x[i]!;
      const y = tells.y[i]!;
      const magnitude = tells.magnitude[i]!;
      const player = tells.player[i]!;

      // The alarm hears only your own home taking sustained damage (GDD §2.2).
      if (player === this.local && this.local >= 0) this.alarm.damage(kind);

      // The soundtrack reads the same queue: combat heats the theme, the waves
      // raise the tension, the collapse and the end turn the arc (`./music`).
      this.musicScore.combat(kind);
      if (kind === TELL.waveArrive) this.musicScore.wave(magnitude);
      else if (kind === TELL.collapseBegin) this.musicScore.collapse();
      else if (kind === TELL.matchEnd) this.musicScore.end(magnitude >= 0.5);

      switch (kind) {
        // --- Held states: a voice, not a hit --------------------------------
        case TELL.thrust:
          // Your own engine, and only yours: eight thruster loops is a drone,
          // and the one a player needs to feel is the one under their thumb.
          if (player === this.local) this.thruster?.push(magnitude);
          break;

        // --- The one serious thing -----------------------------------------
        case TELL.planetDeath:
          // Fire the sound *before* triggering the hush, so the fall is what
          // the quiet lands on top of rather than being cut off by it. The one
          // serious thing is a sting, not a located hit: full and centred, heard
          // wherever on the map a home dies (ratified a3-03).
          this.flat(SOUND.planetDeath, 1);
          if (this.ownsDeath) this.death.trigger();
          if (player === this.local) this.alarm.silence();
          break;

        // --- Everything else -----------------------------------------------
        default:
          this.routine(kind, x, y, magnitude);
          break;
      }
    }
  }

  /**
   * Sound a device cue — a press, a purchase, a rejected buy, the ping, the
   * respawn clock (`./bank` {@link CUE_SOUND}). The audible half of the p4-03
   * haptic seams: call it wherever the game already raises a haptic, so buzz and
   * blip land together.
   *
   * Non-diegetic, so it plays at full level with no earshot falloff — a menu is
   * not a place in the world. It still respects the three-second hush (GDD §4.7):
   * nothing sounds while a home is dying, cues included. A jitter keeps a rapid
   * menu walk from sounding like one machine part.
   */
  cue(kind: AudioCue): void {
    const graph = this.graph;
    if (!graph) return;
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return;
    }
    if (graph.play(CUE_SOUND[kind], 1, graph.jitter(0.04))) this.played++;
  }

  /** Advance the alarm, the held voice, the soundtrack, and the hush. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.alarm.update(step);
    if (this.ownsDeath) this.death.update(step);
    this.thruster?.update(step);

    // The soundtrack follows the local siege, then rides the same hush every
    // other voice does — and holds its win/loss sting until the quiet lifts.
    this.musicScore.setUnderAttack(this.alarm.active);
    this.musicScore.update(step);
    if (this.started) this.music?.update(step, this.death.gain);

    this.graph?.setDuck(this.death.gain);
    this.syncAlarm();
  }

  /** Stop everything and drop the graph. A match teardown, or a page unload. */
  dispose(): void {
    this.thruster?.stop();
    this.music?.stop();
    this.ambientLoop?.stop(0.2);
    this.ambientLoop = null;
    this.alarmLoop?.stop(0.1);
    this.alarmLoop = null;
    this.graph?.dispose();
    this.started = false;
  }

  /** Back to the start of a match — a rematch, or a rejoin (GDD §4.2). */
  reset(): void {
    this.alarm.reset();
    if (this.ownsDeath) this.death.reset();
    this.thruster?.stop();
    this.musicScore.reset();
    this.music?.stop();
    this.lastSpatial = HERE;
  }

  // -------------------------------------------------------------------------

  /**
   * The one-shot half of the routing: a kind, its sound, and how loud.
   *
   * Kinds whose {@link TELL_SOUND} entry is `null` are the held states handled
   * above; reaching here with one is a no-op rather than a silent bug, and the
   * coverage test asserts the mapping is complete either way.
   */
  private routine(kind: TellKind, x: number, y: number, magnitude: number): void {
    const sound = TELL_SOUND[kind];
    if (!sound) return;
    const level = levelFor(kind, magnitude);
    // A global klaxon plays flat; everything the sim placed is spatialised.
    if (GLOBAL_TELLS.has(kind)) this.flat(sound, level);
    else this.spatial(sound, x, y, level);
  }

  /**
   * A spatial one-shot: the mix places it against the listener (`./spatial`).
   * Culled before synthesis past {@link EARSHOT_FAR}, so a bot war on the far side
   * of the claim costs nothing (ratified a3-03, perf).
   */
  private spatial(sound: SoundName, x: number, y: number, level: number): void {
    const graph = this.graph;
    if (!graph) return;
    // The hush is the mechanic: while the mix is at zero, nothing is started at
    // all — not merely turned down (GDD §4.7, `../vfx/death-moment`).
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return;
    }
    const placement = this.hasListener ? place(x, y, this.listenerX, this.listenerY) : HERE;
    this.lastSpatial = placement;
    if (placement.culled) return; // over the horizon: synthesise nothing
    const gain = level * placement.gain;
    if (gain <= 0.004) return;
    const pan: Spatial = { pan: placement.pan, cutoff: placement.cutoff };
    if (graph.play(sound, gain, graph.jitter(), 'sfx', pan)) this.played++;
  }

  /**
   * A non-spatial one-shot: full level, centred, no falloff — a sting or a global
   * klaxon (the death fall, the wave horn, the match-end fanfare). Still obeys the
   * three-second hush like everything else (GDD §4.7).
   */
  private flat(sound: SoundName, level: number): void {
    const graph = this.graph;
    if (!graph) return;
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return;
    }
    if (graph.play(sound, clamp01(level), graph.jitter())) this.played++;
  }

  /** Start or stop the alarm loop to match the state machine. */
  private syncAlarm(): void {
    const graph = this.graph;
    if (!graph) return;
    if (this.alarm.active) {
      if (!this.alarmLoop) {
        this.alarmLoop = graph.startLoop(SOUND.alarm, 0, 'alarm');
        this.alarmLoop.setGain(1, 0.08);
        // Your home is being taken apart; everything else gets out of the way.
        // The soundtrack and the ambience drop hard, the SFX only step aside —
        // they are the mechanics the alarm is about (GDD §2.2).
        graph.setBusDuck('ambient', AMBIENT_DUCK, 0.3);
        graph.setBusDuck('music', MUSIC_DUCK, 0.3);
        graph.setBusDuck('sfx', SFX_DUCK, 0.2);
      }
      return;
    }
    if (this.alarmLoop) {
      this.alarmLoop.stop(0.12);
      this.alarmLoop = null;
      graph.setBusDuck('ambient', 1, 0.8);
      graph.setBusDuck('music', 1, 0.8);
      graph.setBusDuck('sfx', 1, 0.4);
    }
  }

  private startAmbient(): void {
    if (this.ambientLoop || !this.graph) return;
    this.ambientLoop = this.graph.startLoop(SOUND.ambient, 0, 'ambient');
    // A long fade in: the bed should arrive without anyone noticing it start.
    this.ambientLoop.setGain(1, 2.5);
  }
}

/**
 * How loud a moment is, from its normalised magnitude.
 *
 * `TELL_PAYLOAD` (`../tells`) already fixes what `magnitude` means per kind, so
 * this is the one place that turns those meanings into gain — and it is a
 * deliberate mix decision per kind rather than a blanket `gain = magnitude`,
 * because the meanings differ: a shield's magnitude is how much is *left* (a
 * failing shield should sound thinner), while an explosion's is how big it was.
 */
function levelFor(kind: TellKind, magnitude: number): number {
  const m = clamp01(magnitude);
  switch (kind) {
    // Bigger is louder.
    case TELL.shipExplode:
    case TELL.rockBurst:
    case TELL.bankOre:
    case TELL.waveArrive:
      return 0.6 + 0.4 * m;
    // Projectile fire and impact carry weapon power / damage (GDD §2.5: mining
    // speed and weapon damage are one stat) with a floor, so a tier-0 shot is
    // clearly audible and a tier-4 tool lands heavier — the per-tier variation
    // the brief asks for, in the mix.
    case TELL.mineHit:
    case TELL.weaponHit:
    case TELL.shotImpact:
      return 0.55 + 0.45 * m;
    // A failing shield flickers thin — the audible half of "pressure beats
    // regeneration" (GDD §2.6), and the attacker's cue that it is working.
    case TELL.shieldHit:
      return 0.45 + 0.45 * m;
    // Magnitude is core fraction *remaining*: the closer to death, the louder.
    case TELL.coreHit:
      return 0.65 + 0.35 * (1 - m);
    // Fixed-level moments: their magnitude means something other than size.
    case TELL.rockCrack:
    case TELL.oreCollect:
    case TELL.holdFull:
    case TELL.turretFire:
    case TELL.shieldDown:
    case TELL.turretDown:
    case TELL.shipSpawn:
    case TELL.spawnPulse:
    case TELL.buildPlaced:
    case TELL.buildComplete:
    case TELL.repairTick:
    case TELL.upgradeBought:
    case TELL.collapseBegin:
    case TELL.matchEnd:
    case TELL.planetDeath:
      return 1;
    default:
      return 1;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
