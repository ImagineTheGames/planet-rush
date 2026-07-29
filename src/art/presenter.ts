/**
 * src/art/presenter.ts — the one-object wiring. OWNER: Art & Audio Agent.
 *
 * `src/art/vfx/` and `src/art/audio/` are deliberately several small pieces —
 * an observer, a pool, emitters, a routing table, a synth, a mix, an alarm —
 * because each of them is testable alone and none of them needs the others to
 * be understood. That is good for the module and bad for the *caller*, who now
 * has six objects to construct in the right order and four calls to make in the
 * right sequence, every frame, forever.
 *
 * Which is how a milestone gets marked done with its features merged and never
 * wired in. So this file exists: **one object, two calls a frame.**
 *
 * ```ts
 * // once, at match start (the Platform Engineer's frame loop owns this):
 * const art = new ArtPresenter({ local: mySlot, context: openAudioContext() });
 * worldRoot.addChild(art.attach(textureCache));   // optional: skip for headless
 * art.unlock(defaultUnlockTarget());              // mobile audio gesture (risk 7)
 *
 * // every frame, after the sim has stepped:
 * art.observe(world, dt);      // derive tells, draw them, sound them
 * art.render();                // push the pool onto the GPU
 * ```
 *
 * Everything past that is optional: {@link ArtPresenter.setListener} for the
 * earshot falloff, {@link ArtPresenter.setQuality} for the "reduce VFX" escape
 * hatch (GDD §4.3), {@link ArtPresenter.setMasterVolume} and
 * {@link ArtPresenter.setMusicVolume} for the settings sliders,
 * {@link ArtPresenter.reset} for a rematch.
 *
 * The presenter owns **no** state of its own beyond the pieces — it is a
 * façade, not a layer. Anything it can do, the pieces can still do directly;
 * this is the path of least resistance, not a wall in front of them.
 */

import type { PlayerId } from '@shared/types';
import { AudioEngine, type AudioEngineOptions } from './audio/engine';
import { AudioUnlock, type UnlockTarget } from './audio/unlock';
import type { AudioContextLike } from './audio/context';
import { TellQueue, TELL_CAPACITY } from './tells';
import type { SpriteTextureCache } from './textures';
import { VfxField, type VfxFieldOptions } from './vfx/field';
import { VfxLayer } from './vfx/layer';
import { WorldObserver, type WorldView } from './vfx/observer';

/** Options for {@link ArtPresenter}. */
export interface ArtPresenterOptions {
  /** The player whose screen this is: their home rings their alarm (GDD §2.2). */
  readonly local?: PlayerId;
  /** Match seed, so a replay's scatter and jitter match the match (GDD §4.1). */
  readonly seed?: number;
  /** Effect density 0..1 — the "reduce VFX" setting (GDD §4.3). */
  readonly quality?: number;
  /** Audio context, or `null`/omitted to run silent (server, harness, tests). */
  readonly context?: AudioContextLike | null;
  /** Ambient bed on at start. Item 3 on the cut list (GDD §4.9). */
  readonly ambient?: boolean;
  /** Adaptive soundtrack on at start. Item 3 on the cut list (GDD §4.9). */
  readonly music?: boolean;
  /** Particle capacity, for a device that wants a smaller pool. */
  readonly capacity?: number;
}

/**
 * Everything visible and audible, behind two calls a frame.
 */
export class ArtPresenter {
  /** Derives tells by diffing world states. */
  readonly observer: WorldObserver;
  /** Particles, and the owner of the death moment. */
  readonly field: VfxField;
  /** The mix, the alarm, and the held voices. */
  readonly audio: AudioEngine;
  /** This frame's tells. Public so a debug overlay can count them. */
  readonly tells: TellQueue;

  private layer: VfxLayer | null = null;
  private unlocker: AudioUnlock | null = null;
  /** The local player slot — the alarm's "you". Kept so the presenter can derive
   *  the alarm's side (below) from world truth without another wiring seam. */
  private local: PlayerId;
  /** Cached owner slots on the local player's side — the under-attack alarm's
   *  roster (GDD §2.2, developer report s5). Teams are static for a match, so
   *  this is built once from the first world seen and reused; cleared on a new
   *  match or a `setLocal`. `null` = not yet derived. */
  private alarmAllies: Set<PlayerId> | null = null;

  constructor(options: ArtPresenterOptions = {}) {
    const vfx: VfxFieldOptions = {
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      ...(options.capacity !== undefined ? { capacity: options.capacity } : {}),
    };
    this.field = new VfxField(vfx);
    this.local = options.local ?? -1;
    this.observer = new WorldObserver(options.local !== undefined ? { local: options.local } : {});
    this.tells = new TellQueue(TELL_CAPACITY);

    const audio: AudioEngineOptions = {
      // The field owns the death moment; the mix reads the same object, so the
      // picture and the sound can never hold different beats (GDD §4.7).
      death: this.field.death,
      context: options.context ?? null,
      ...(options.local !== undefined ? { local: options.local } : {}),
      ...(options.ambient !== undefined ? { ambient: options.ambient } : {}),
      ...(options.music !== undefined ? { music: options.music } : {}),
      ...(options.seed !== undefined ? { mix: { seed: options.seed } } : {}),
    };
    this.audio = new AudioEngine(audio);
  }

  /**
   * Build the draw layer and return it to add to the scene.
   *
   * Optional and separate from the constructor, because everything else here
   * works with no renderer at all — which is what lets the QA harness and the
   * match server construct a presenter without importing PixiJS (GDD §4.1).
   */
  attach(cache: SpriteTextureCache): VfxLayer {
    this.layer ??= new VfxLayer(cache);
    return this.layer;
  }

  /**
   * Arm the mobile audio unlock on the first user gesture (GDD risk 7).
   *
   * Pass `defaultUnlockTarget()`; a `null` target (Node, the server) is a no-op,
   * so this is safe to call unconditionally.
   */
  unlock(target: UnlockTarget | null): void {
    if (!target || !this.audio.audible || this.unlocker) return;
    const ctx = this.audio.graph?.ctx;
    if (!ctx) return;
    this.unlocker = new AudioUnlock(ctx, target, { onUnlock: () => this.audio.start() });
    this.unlocker.arm();
  }

  /**
   * One frame: diff the world into tells, then draw and sound them.
   *
   * The first call primes and emits nothing — a fresh match must not open with
   * eight spawn bangs, and a client joining mid-match must not replay the siege
   * it missed (GDD §4.2).
   */
  observe(world: WorldView, dt: number): void {
    this.tells.clear();
    this.observer.observe(world, dt, this.tells);
    this.field.consume(this.tells);
    // Scope the alarm to the local player's SIDE before the audio hears the tells:
    // your home and (in TEAMS) a teammate's ring it; an enemy's or a neutral's
    // never does, and the collapse's core entropy is not an attacker (GDD §2.2,
    // developer report s5). Teams are static, so the roster is derived once.
    this.alarmAllies ??= deriveAlarmAllies(world, this.local);
    this.audio.setAlarmScope(this.alarmAllies, world.match.phase === 'collapse');
    this.audio.consume(this.tells);
    this.field.update(dt);
    this.audio.update(dt);
    // Phones lock and tabs get backgrounded mid-match; the context comes back
    // suspended and the game is silent from then on unless something rechecks.
    this.unlocker?.recheck();
  }

  /** Push the particle pool onto the GPU. A no-op until {@link attach}. */
  render(): void {
    this.layer?.draw(this.field.pool);
  }

  /** Where the camera is, in world units — drives the audio earshot falloff. */
  setListener(x: number, y: number): void {
    this.audio.setListener(x, y);
  }

  /**
   * The "reduce VFX" setting (GDD §4.3): thins every burst, removes no effect.
   * Sounds are untouched, so a phone dropping frames never loses a tell.
   */
  setQuality(quality: number): void {
    this.field.quality = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  }

  /** The volume slider, 0..1. */
  setMasterVolume(value: number): void {
    this.audio.setMasterVolume(value);
  }

  /** Turn the ambient bed on or off (GDD §4.9 item 3). */
  setAmbient(on: boolean): void {
    this.audio.setAmbient(on);
  }

  /** The music slider, 0..1 — the adaptive soundtrack's own level (GDD §4.9 item 3). */
  setMusicVolume(value: number): void {
    this.audio.setMusicVolume(value);
  }

  /** Turn the adaptive soundtrack on or off (GDD §4.9 item 3). */
  setMusic(on: boolean): void {
    this.audio.setMusic(on);
  }

  /** Which slot's home rings the alarm. Set on join, and on a rejoin. */
  setLocal(id: PlayerId): void {
    this.local = id;
    this.alarmAllies = null; // the side changed — rebuild it from the next world
    this.audio.setLocal(id);
  }

  /** Live particles — the debug overlay's number, and a perf-gate assertion. */
  get particleCount(): number {
    return this.field.count;
  }

  /** True while the under-attack alarm is sounding (GDD §2.2). */
  get underAttack(): boolean {
    return this.audio.alarm.active;
  }

  /** True during the three seconds nobody jokes in (GDD §4.7). */
  get hushed(): boolean {
    return this.field.death.silent;
  }

  /** A new match, a rematch, or a rejoin: forget everything, keep the buffers. */
  reset(): void {
    this.observer.reset();
    this.field.reset();
    this.audio.reset();
    this.tells.clear();
    this.alarmAllies = null; // a new match may re-team the board
  }

  /** Drop the mix. The draw layer is the caller's to remove from the scene. */
  dispose(): void {
    this.audio.dispose();
  }
}

/**
 * The owner slots on the local player's SIDE — the under-attack alarm's roster
 * (GDD §2.2, developer report s5). A structural mirror of the sim's `teamOf` /
 * `sameSide`: art is a leaf and cannot import `src/sim`, but the rule is the same
 * plain-int `team` table (`ship.team ?? id`, `station.team ?? owner`). In FFA
 * every player is a team of one, so this is just `{local}` — your home and no
 * other rings. In TEAMS it also holds each ally's owning slot, so a teammate's
 * siege rings your klaxon while both enemies' sieges stay silent. A spectator
 * (`local < 0`) has no side, so the set is empty and nothing rings.
 */
function deriveAlarmAllies(world: WorldView, local: PlayerId): Set<PlayerId> {
  const allies = new Set<PlayerId>();
  if (local < 0) return allies;
  allies.add(local); // a player is always on their own side, even with no station left

  const teamOf = (id: number): number => {
    for (const s of world.ships) if (s.id === id) return s.team ?? s.id;
    for (const st of world.stations) if (st.owner === id) return st.team ?? st.owner;
    return id;
  };
  const localTeam = teamOf(local);
  for (const st of world.stations) {
    if ((st.team ?? st.owner) === localTeam) allies.add(st.owner);
  }
  return allies;
}
