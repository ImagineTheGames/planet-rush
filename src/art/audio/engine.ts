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
 *  - **The held voices** (`./weapons`): the two firing voices and the thruster,
 *    which are states rather than moments.
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
import { SOUND, TELL_SOUND, type SoundName } from './bank';
import { WeaponVoices, SustainedVoice } from './weapons';
import type { AudioContextLike } from './context';
import { AudioGraph, type LoopHandle, type MixOptions } from './graph';

/** Distance in world units at which a sound is at full level. */
export const EARSHOT_NEAR = 260;

/** Distance beyond which a sound is inaudible. Roughly a screen and a half. */
export const EARSHOT_FAR = 1400;

/** Below this the mix is treated as silent and one-shots are not started. */
const HUSHED = 0.001;

/** Ambient bus level while the alarm is sounding — it must never compete. */
const AMBIENT_DUCK = 0.25;

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

  private readonly weapons: WeaponVoices | null;
  private readonly thruster: SustainedVoice | null;
  private readonly ownsDeath: boolean;
  private readonly wantsAmbient: boolean;

  private ambientLoop: LoopHandle | null = null;
  private alarmLoop: LoopHandle | null = null;
  private local: PlayerId;
  private listenerX = 0;
  private listenerY = 0;
  private hasListener = false;
  private started = false;
  private played = 0;
  private skipped = 0;

  constructor(options: AudioEngineOptions = {}) {
    const ctx = options.context ?? null;
    this.graph = ctx ? new AudioGraph(ctx, options.mix ?? {}) : null;
    this.weapons = this.graph ? new WeaponVoices(this.graph) : null;
    this.thruster = this.graph
      ? new SustainedVoice(this.graph, SOUND.thruster, { maxGain: 0.45, release: 0.14, attack: 0.05 })
      : null;
    this.alarm = new UnderAttackAlarm(options.alarm ?? {});
    this.death = options.death ?? new DeathMoment();
    this.ownsDeath = options.death === undefined;
    this.local = options.local ?? -1;
    this.wantsAmbient = options.ambient ?? true;
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

      switch (kind) {
        // --- Held states: a voice, not a hit --------------------------------
        case TELL.mineHit:
          this.weapons?.onHit(false, magnitude);
          break;
        case TELL.weaponHit:
          this.weapons?.onHit(true, magnitude);
          break;
        case TELL.thrust:
          // Your own engine, and only yours: eight thruster loops is a drone,
          // and the one a player needs to feel is the one under their thumb.
          if (player === this.local) this.thruster?.push(magnitude);
          break;

        // --- The one serious thing -----------------------------------------
        case TELL.planetDeath:
          // Fire the sound *before* triggering the hush, so the fall is what
          // the quiet lands on top of rather than being cut off by it.
          this.oneShot(SOUND.planetDeath, x, y, 1);
          if (this.ownsDeath) this.death.trigger();
          if (player === this.local) this.alarm.silence();
          this.weapons?.stop();
          break;

        // --- Everything else -----------------------------------------------
        default:
          this.routine(kind, x, y, magnitude);
          break;
      }
    }
  }

  /** Advance the alarm, the held voices, and the hush. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.alarm.update(step);
    if (this.ownsDeath) this.death.update(step);
    this.weapons?.update(step);
    this.thruster?.update(step);
    this.graph?.setDuck(this.death.gain);
    this.syncAlarm();
  }

  /** Stop everything and drop the graph. A match teardown, or a page unload. */
  dispose(): void {
    this.weapons?.stop();
    this.thruster?.stop();
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
    this.weapons?.stop();
    this.thruster?.stop();
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
    this.oneShot(sound, x, y, levelFor(kind, magnitude));
  }

  private oneShot(sound: SoundName, x: number, y: number, level: number): void {
    const graph = this.graph;
    if (!graph) return;
    // The hush is the mechanic: while the mix is at zero, nothing is started at
    // all — not merely turned down (GDD §4.7, `../vfx/death-moment`).
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return;
    }
    const gain = level * this.earshot(x, y);
    if (gain <= 0.004) return;
    if (graph.play(sound, gain, graph.jitter())) this.played++;
  }

  /**
   * Distance falloff, 1 near the camera down to 0 past {@link EARSHOT_FAR}.
   *
   * Linear in distance rather than inverse-square: inverse-square is physically
   * right and dramatically wrong here, because it makes anything a screen away
   * effectively silent — and a siege one screen away is exactly the thing a
   * player is supposed to notice (GDD §2.6, "two beats one").
   */
  private earshot(x: number, y: number): number {
    if (!this.hasListener) return 1;
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= EARSHOT_NEAR) return 1;
    if (d >= EARSHOT_FAR) return 0;
    return 1 - (d - EARSHOT_NEAR) / (EARSHOT_FAR - EARSHOT_NEAR);
  }

  /** Start or stop the alarm loop to match the state machine. */
  private syncAlarm(): void {
    const graph = this.graph;
    if (!graph) return;
    if (this.alarm.active) {
      if (!this.alarmLoop) {
        this.alarmLoop = graph.startLoop(SOUND.alarm, 0, 'alarm');
        this.alarmLoop.setGain(1, 0.08);
        // Your home is being taken apart; the ambience gets out of the way.
        graph.setBus('ambient', AMBIENT_DUCK, 0.3);
      }
      return;
    }
    if (this.alarmLoop) {
      this.alarmLoop.stop(0.12);
      this.alarmLoop = null;
      graph.setBus('ambient', 1, 0.8);
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
    case TELL.shotImpact:
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
