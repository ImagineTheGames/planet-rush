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
 *    own home — a mechanic, not a notification (GDD §2.2). It sounds **once per
 *    engagement** and does not repeat while the siege lasts (developer, s9-01);
 *    the screen-edge arrow is what sustains (GDD §2.2, amended 2026-08-07).
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
import {
  SOUND,
  TELL_SOUND,
  CUE_SOUND,
  CUE_UI,
  XP_TICK_SEMITONES,
  XP_TICK_STEPS_MAX,
  type SoundName,
  type AudioCue,
} from './bank';
import { UiCuePlayer, type UiCuePlayerOptions } from './ui-cues';
import { SustainedVoice } from './weapons';
import type { AudioContextLike } from './context';
import { AudioGraph, type Bus, type LoopHandle, type MixOptions, type Spatial } from './graph';
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
 *
 * Since s9-01 the duck lasts **the sting**, not the siege ({@link ALARM_DUCK_S}).
 * A one-shot alarm that left the mix pinned down for a two-minute siege would be
 * ducking under something no longer sounding — the whole game quiet with nothing
 * to show for it.
 */
const AMBIENT_DUCK = 0.25;
const MUSIC_DUCK = 0.3;
const SFX_DUCK = 0.7;

/**
 * How long the mix stays under the alarm, in seconds — one sting plus a short
 * tail for the release ramp.
 *
 * A constant rather than the rendered buffer's length, because the duck has to
 * run **headless** too (the server, the QA harness, every unit test) where there
 * is no buffer to measure. `audio.test.ts` asserts it still covers the alarm as
 * the bank renders it, so re-voicing the klaxon cannot silently leave the mix
 * ducked short of its own sound.
 */
export const ALARM_DUCK_S = 0.85;

/**
 * The end-of-match bar's bed (`./bank` {@link SOUND.xpBarFill}, plan §6.3 beat 3),
 * as the four numbers that make a still loop read as *filling*.
 *
 * The body does not rise on its own — a sweep inside a loop restarts every lap
 * and pulses — so the rise is here, ridden against the bar's own progress: the
 * level comes up from {@link XP_FILL_FLOOR} of its peak, and the rate climbs by
 * {@link XP_FILL_RISE} (a major third at the top, which is *opening* rather than
 * *transposing*). A bar that is nearly empty still sounds, because plan §6.3's
 * "almost no XP at all" case says the beat always plays for its full length,
 * however small the delta.
 */
export const XP_FILL_GAIN = 0.5;
export const XP_FILL_FLOOR = 0.55;
export const XP_FILL_RISE = 0.26;
/** Ramp seconds for a progress step, and for the fade the bar's end gets. */
const XP_FILL_RIDE_S = 0.08;
export const XP_FILL_RELEASE_S = 0.12;

/**
 * How far the bed steps aside for a level-up landing on top of it, and for how
 * long — plan §6.5: *"must duck cleanly under a `levelUp` landing on top of it."*
 *
 * Ducked rather than stopped, because beat 4 is a pause in the fill and not the
 * end of it: the bar resumes with whatever XP is left, and a bed that cut out and
 * restarted would announce the seam. The recovery is the same shape the alarm's
 * duck uses (`./engine` syncAlarm) — counted down in {@link AudioEngine.update},
 * so it works headless.
 */
export const XP_FILL_DUCK = 0.4;
export const XP_FILL_DUCK_S = 0.45;

/**
 * How long the ambient bed takes to reach full level after {@link AudioEngine.start}.
 *
 * The bed is the one voice in the mix that is never an event, so it may not have
 * an onset: {@link AudioGraph.startLoop} opens it at **silence** and this is the
 * ramp up from there. The bed's own layers fade in as well (`./bank`) — the two
 * are different jobs, and a0-48 needed both. A voice that begins at full level on
 * sample zero is a sound that *started*, whatever the mix does above it; a mix
 * ramp short enough to hear is a sound that *arrived*, whatever the voice does
 * below it.
 *
 * Six seconds, up from 2.5. The developer's report is *"when i press play im
 * immediately greeted"*, and 2.5 s is comfortably inside the window a player
 * spends looking at a match that has just opened.
 *
 * **Where the ramp starts is a separate question, and it is not settled here.**
 * `start()` is called from the {@link AudioUnlock} gesture (`../presenter`,
 * `src/main.ts`), which is the player's *first tap anywhere in the app* — for
 * most players, the PLAY button on the menu. So the bed does not begin when a
 * match begins; it begins on the first touch, and a menu that sits for a while
 * before RUSH! is a menu with the bed already under it. That is arguably the
 * larger half of "greeted immediately", and moving it means changing who calls
 * `start()` — outside this module and outside this lane. See the a0-48 note.
 */
export const AMBIENT_FADE_IN_S = 6;

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
  /** The UI cue set's own knobs (`./ui-cues`) — level, stacking window, seed. */
  readonly uiCues?: UiCuePlayerOptions;
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
  /**
   * The Gantry/Bone UI cue set (`./ui-cues`), or `null` when running silent.
   *
   * Public because the set is a *contract* the developer ratified by ear, not an
   * implementation detail: a live-stage run reads `playCount` / `stackedCount`
   * off it to prove the right cue fired, and exactly one of them.
   */
  readonly uiCues: UiCuePlayer | null;

  private readonly thruster: SustainedVoice | null;
  private readonly ownsDeath: boolean;
  private readonly wantsAmbient: boolean;
  private wantsMusic: boolean;

  private ambientLoop: LoopHandle | null = null;
  /** The end-of-match bar's bed while it is filling (p1-07), or `null`. */
  private xpFillLoop: LoopHandle | null = null;
  /** The bar's progress the bed is currently riding, 0..1. */
  private xpFillAt = 0;
  /** Seconds left of the level-up duck on the bed. Counted down in {@link update}. */
  private xpDuckLeft = 0;
  /**
   * The engagement number the last sting was raised for (`UnderAttackAlarm.count`).
   * The alarm is a one-shot per engagement, so this — not `alarm.active` — is what
   * `syncAlarm` compares against: the state machine can hold `active` for a whole
   * siege and this still fires exactly once (developer, s9-01).
   */
  private alarmSounded = 0;
  /** Seconds left of the current sting's duck. Counted down in {@link update}. */
  private alarmDuckLeft = 0;
  /** Stings raised since construction — one per engagement. The test's eye, and
   *  the live-stage seam's (`__alarmStage` in `src/main.ts`). */
  private alarmStings = 0;
  private local: PlayerId;
  /**
   * The player slots whose home damage rings THIS listener's alarm — the local
   * player and, in TEAMS, their allies (the sim's `sameSide` set, owner-keyed).
   * `null` means "no roster wired": the alarm falls back to the local player
   * alone, i.e. FFA / teams-of-one, which is exactly the pre-Teams behaviour.
   */
  private alarmAllies: ReadonlySet<PlayerId> | null = null;
  /**
   * True while the field is collapsing. During collapse every core decays on its
   * own (entropy, GDD §2.3) — that is not an attacker (GDD §2.2), so the core-hit
   * tells the decay emits must not ring the alarm out of nowhere. A real siege
   * still rings it: shields and turrets do not decay, so their tells are honest.
   */
  private collapsing = false;
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
    // Into the SFX bus, not the destination: the cue set rides the player's SFX
    // slider, ducks under the alarm with everything else, and — the one that
    // matters — sits upstream of the duck node, so the three seconds of quiet on
    // a station's death multiply it too (GDD §4.7). Protected in the mixer.
    this.uiCues = ctx && this.graph ? new UiCuePlayer(ctx, this.graph.buses.sfx, options.uiCues ?? {}) : null;
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
   * Alarm stings raised since construction — **one per engagement**, never one
   * per frame of a siege (developer, s9-01: *"it should only play once, and not
   * keep playing"*).
   *
   * Counted whether or not there is a mix behind the engine, like the alarm state
   * machine itself, so the "once per engagement" rule is testable in the headless
   * mode the server and the harness run in. A sting swallowed by the three-second
   * hush (GDD §4.7) is not counted here — it lands on {@link hushedCount}.
   */
  get alarmSounds(): number {
    return this.alarmStings;
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
    // The cue set too: the first press of the menu is the worst frame to spend a
    // render on, and it is also the first thing a player hears of the game.
    this.uiCues?.preload();
    if (this.wantsAmbient) this.startAmbient();
  }

  /** Which slot's home rings the alarm. Set on join, and on a rejoin. */
  setLocal(id: PlayerId): void {
    this.local = id;
  }

  /**
   * The slot this engine believes it is listening as. `-1` is a spectator.
   *
   * Public because it is the number s9-01 turned on: the engine took it as a
   * constructor argument at boot, before the server had seated the joiner, and
   * nothing ever corrected it — so the mix spent every online match convinced it
   * was slot 0. A live-stage test reads this back and compares it against the
   * seat the server actually welcomed the client into (`__alarmStage` in
   * `src/main.ts`). A wire is only proven by reading the far end of it.
   */
  get alarmLocal(): PlayerId {
    return this.local;
  }

  /**
   * Scope the under-attack alarm to a *side*, not just a slot (developer report
   * s5, "the alarm fires for ENEMY bases"). The alarm belongs to ownership, not
   * proximity: it rings only when a station on the local player's side takes
   * damage. Pass the owner slots on that side — in FFA a set of one (the local
   * player), in TEAMS the local player and their allies (the sim's `sameSide`
   * roster). Pass `collapsing` so the endgame's core entropy is not mistaken for
   * a siege. Called each frame by the presenter from live world truth; with it
   * never called the alarm falls back to the local player alone (FFA-identical).
   */
  setAlarmScope(allies: ReadonlySet<PlayerId>, collapsing: boolean): void {
    this.alarmAllies = allies;
    this.collapsing = collapsing;
  }

  /**
   * Does damage to a station owned by `player` ring THIS listener's alarm? Your
   * own home always does; a teammate's does in TEAMS; an enemy or neutral home
   * never does. With no roster wired, "your side" is just you (FFA).
   */
  private alarmRingsFor(player: PlayerId): boolean {
    if (this.alarmAllies) return this.alarmAllies.has(player);
    return player === this.local && this.local >= 0;
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

      // The alarm hears only YOUR SIDE's home taking sustained damage (GDD §2.2):
      // your own, and a teammate's in TEAMS — never an enemy's or a neutral's
      // (developer report s5). During collapse the core decays on its own, so a
      // core-hit is entropy, not an attacker (GDD §2.3 vs §2.2) and is not heard;
      // shields and turrets do not decay, so a real siege still rings it.
      if (this.alarmRingsFor(player) && !(this.collapsing && kind === TELL.coreHit)) {
        this.alarm.damage(kind);
      }

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
        case TELL.stationDeath:
          // Fire the sound *before* triggering the hush, so the fall is what
          // the quiet lands on top of rather than being cut off by it. The one
          // serious thing is a sting, not a located hit: full and centred, heard
          // wherever on the map a home dies (ratified a3-03).
          this.flat(SOUND.stationDeath, 1);
          if (this.ownsDeath) this.death.trigger();
          // Silence on the same SIDE the alarm rings for (developer report s5):
          // an alarm still ringing over a dead home tells the player to defend
          // what no longer exists (`alarm.silence`). Your own home and — in
          // TEAMS — a teammate's are what could have raised it, so either one
          // falling stops it; an enemy's or a neutral's never rang it, so its
          // death changes nothing. Mirrors the ring gate above, `alarmRingsFor`.
          if (this.alarmRingsFor(player)) this.alarm.silence();
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
   * **Since s6-01 most of these are the Gantry/Bone cue set** (`./ui-cues`) — the
   * struck-glass voices the developer chose themselves — routed by {@link CUE_UI}.
   * The UI's own three-word vocabulary (`press` / `confirm` / `reject`,
   * `src/ui/sfx.ts`) is untouched and now speaks in that set: a pick, a purchase,
   * a refusal. Cues the handoff does not cover — the deposit tick, the respawn
   * clock, the minimap ping — keep their bank voices.
   *
   * Non-diegetic, so it plays at full level with no earshot falloff — a menu is
   * not a place in the world. It still respects the three-second hush (GDD §4.7):
   * nothing sounds while a home is dying, cues included — the quiet is protected
   * here *and* in the mixer, since the cue player hangs off the SFX bus which is
   * upstream of the duck.
   *
   * @param index Slot index for a stepped cue (`join`): one semitone per seat.
   *   For `xpTick` it is the tick's ordinal, which is what the count-up rides up.
   */
  cue(kind: AudioCue, index = 0): void {
    const graph = this.graph;
    if (!graph) return;
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return;
    }
    const glass = CUE_UI[kind];
    if (glass && this.uiCues) {
      // One state change, one sound: the player refuses a cue that lands on top
      // of another (rule 1), and `played` counts the cue, not its two buffers.
      if (this.uiCues.play(glass, index)) this.played++;
      return;
    }
    // The bar's bed steps aside for the landing rather than stopping under it:
    // beat 4 is a pause in the fill, not the end of it (plan §6.3).
    if (kind === 'levelUp' && this.xpFillLoop?.alive) {
      this.xpDuckLeft = XP_FILL_DUCK_S;
      this.rideXpFill(0.04);
    }
    if (graph.play(CUE_SOUND[kind], 1, this.cueRate(kind, index))) this.played++;
  }

  /**
   * The bed under the level bar (`./bank` {@link SOUND.xpBarFill}), rode against
   * the bar's own progress — plan §6.3 beat 3, the beat the developer described.
   *
   * Call it every frame the bar is moving with `progress` 0..1; the first call
   * starts the loop and the rest ride it. It never *computes* anything about the
   * fill: the sequence owns the number, this owns the sound, which is §6.4 rule 2
   * applied one layer down.
   *
   * Nothing starts under the three-second hush (GDD §4.7) — a home dying outranks
   * a bar filling, and the next frame after the quiet lifts starts it cleanly.
   */
  xpFill(progress: number): void {
    const graph = this.graph;
    if (!graph) return;
    this.xpFillAt = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    if (this.death.gain <= HUSHED) return;
    if (!this.xpFillLoop?.alive) {
      this.xpFillLoop = graph.startLoop(SOUND.xpBarFill, 0, 'sfx');
    }
    this.rideXpFill(XP_FILL_RIDE_S);
  }

  /**
   * End the bar's bed — the settle, or a skip.
   *
   * A short fade rather than a cut, and a short one rather than a graceful one:
   * a player who skipped the sequence is telling you they do not want the beat
   * (plan §6.5), so the bed has to be *gone*, not tapering behind the buttons.
   */
  stopXpFill(fade = XP_FILL_RELEASE_S): void {
    this.xpFillLoop?.stop(fade);
    this.xpFillLoop = null;
    this.xpFillAt = 0;
    this.xpDuckLeft = 0;
  }

  /** True while the bar's bed is sounding. The sequence's eye, and a test's. */
  get xpFilling(): boolean {
    return this.xpFillLoop?.alive === true;
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

    if (this.xpDuckLeft > 0) {
      this.xpDuckLeft -= step;
      if (this.xpDuckLeft <= 0) {
        this.xpDuckLeft = 0;
        this.rideXpFill(XP_FILL_DUCK_S * 0.5); // back up under the level-up's tail
      }
    }

    this.graph?.setDuck(this.death.gain);
    this.syncAlarm(step);
  }

  /** Stop everything and drop the graph. A match teardown, or a page unload. */
  dispose(): void {
    this.thruster?.stop();
    this.music?.stop();
    this.ambientLoop?.stop(0.2);
    this.ambientLoop = null;
    this.stopXpFill(0.05);
    this.alarmDuckLeft = 0;
    this.uiCues?.dispose();
    this.graph?.dispose();
    this.started = false;
  }

  /** Back to the start of a match — a rematch, or a rejoin (GDD §4.2). */
  reset(): void {
    this.alarm.reset();
    // The state machine's engagement count went back to zero with it, so the
    // sting's memory has to as well — otherwise the new match's FIRST engagement
    // reads as "the one we already sounded" and the alarm opens the match mute.
    this.alarmSounded = 0;
    this.releaseAlarmDuck();
    if (this.ownsDeath) this.death.reset();
    this.thruster?.stop();
    this.musicScore.reset();
    this.music?.stop();
    // A rematch starts from the lobby, not from last match's summary screen: a
    // bed still filling under it would be the previous match's bar, held open.
    this.stopXpFill(0.05);
    this.lastSpatial = HERE;
    // Forget last match's side and phase; the presenter re-pushes them on the
    // first frame of the new one, and until then the alarm is the local player's.
    this.alarmAllies = null;
    this.collapsing = false;
  }

  // -------------------------------------------------------------------------

  /**
   * The playback rate a device cue sounds at.
   *
   * Everything gets the mix's deterministic pitch jitter, which is what keeps a
   * repeated sound from reading as a sample being retriggered — everything except
   * the count-up tick, which gets a **rise** instead (`./bank`
   * {@link XP_TICK_SEMITONES}). The two cannot be combined: jitter around a
   * climbing pitch is heard as the climb wobbling, and the plan asks for
   * *"pitched up slightly as the count rises"*, which is a line, not a cloud.
   */
  private cueRate(kind: AudioCue, index: number): number {
    const graph = this.graph;
    if (kind !== 'xpTick') return graph ? graph.jitter(0.04) : 1;
    const step = Math.min(Math.max(0, Math.floor(index)), XP_TICK_STEPS_MAX);
    return Math.pow(2, (step * XP_TICK_SEMITONES) / 12);
  }

  /** Push the bar's progress (and the level-up duck) onto the bed's live handle. */
  private rideXpFill(seconds: number): void {
    const loop = this.xpFillLoop;
    if (!loop?.alive) return;
    const duck = this.xpDuckLeft > 0 ? XP_FILL_DUCK : 1;
    const open = XP_FILL_FLOOR + (1 - XP_FILL_FLOOR) * this.xpFillAt;
    loop.setGain(XP_FILL_GAIN * open * duck, seconds);
    loop.setRate(1 + XP_FILL_RISE * this.xpFillAt, seconds);
  }

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
   *
   * @param bus Which bus to sum into. The under-attack alarm keeps its own
   *   (`./graph` — a mechanic that stays audible over everything else, §2.2, and
   *   one the SFX slider does not turn down); everything else is `sfx`.
   * @param rate Playback rate. Defaults to the mix's deterministic pitch jitter,
   *   which is what keeps a repeated sound from sounding cheap — but the alarm
   *   passes 1: an emergency signal that drifts in pitch is a worse signal, and
   *   §2.2's "unmistakable" is the same two tones every time.
   */
  private flat(sound: SoundName, level: number, bus: Bus = 'sfx', rate?: number): boolean {
    const graph = this.graph;
    if (!graph) return false;
    if (this.death.gain <= HUSHED) {
      this.skipped++;
      return false;
    }
    const started = graph.play(sound, clamp01(level), rate ?? graph.jitter(), bus);
    if (started) this.played++;
    return started;
  }

  /**
   * Sound the alarm **once per engagement**, and duck for the sting.
   *
   * *"Also for the alarm, it should only play once, and not keep playing"* —
   * the developer, 2026-08-07 (s9-01). This used to start a continuous loop
   * while `alarm.active` and stop it on release, so a siege that held the state
   * machine up for two minutes rang the klaxon for two minutes. It is now one
   * one-shot per **engagement**: {@link UnderAttackAlarm.count} bumps when the
   * pressure crosses `ENGAGE`, and nothing sounds again until the alarm has
   * released and re-engaged.
   *
   * `MIN_HOLD_S` and the separate lower `RELEASE` are why that is safe. They
   * were written as hysteresis against a *looping* alarm stuttering; with a
   * one-shot they do a better job — they are the **re-trigger guard**, the thing
   * that stops an attacker's dodge-and-return machine-gunning the klaxon. Same
   * constants, same numbers, new job. Do not delete them.
   *
   * The mechanic did not get quieter, it moved: GDD §2.2 pairs the alarm with a
   * screen-edge arrow, and the arrow (`src/ui/alarm.ts`, its own hold) is what
   * now carries the *duration* of the attack. The sound announces; the arrow
   * sustains (GDD §2.2, amended 2026-08-07).
   */
  private syncAlarm(dt: number): void {
    if (this.alarm.count !== this.alarmSounded) {
      // The klaxon is a cockpit alert, not a located hit: full and centred, like
      // the wave horn and the death fall. `flat` also enforces the three seconds
      // of quiet — nothing sounds over a dying home, the alarm included (§4.7).
      const hushed = this.death.gain <= HUSHED;
      const started = this.flat(SOUND.alarm, 1, 'alarm', 1);
      // The mix can REFUSE a one-shot: the voice cap is 24 and a fierce siege
      // frame spends them. A loop never had to survive that; a single sting does,
      // and a dropped one would silently cost a not-cuttable mechanic its whole
      // announcement (§4.9). So leave the engagement unclaimed and try again next
      // frame — it lands as soon as a voice frees, which is milliseconds. The
      // headless engine (no graph) and the death hush both fall through instead:
      // there is nothing to retry for, and retrying through the three seconds of
      // quiet would fire the klaxon on the far side of them.
      if (!started && !hushed && this.graph) return;
      this.alarmSounded = this.alarm.count;
      if (!hushed) {
        this.alarmStings++;
        this.alarmDuckLeft = ALARM_DUCK_S;
        // Your home is being taken apart; everything else gets out of the way —
        // for the length of the sting. The soundtrack and the ambience drop hard,
        // the SFX only step aside, because they are the mechanics the alarm is
        // about (GDD §2.2).
        const graph = this.graph;
        graph?.setBusDuck('ambient', AMBIENT_DUCK, 0.12);
        graph?.setBusDuck('music', MUSIC_DUCK, 0.12);
        graph?.setBusDuck('sfx', SFX_DUCK, 0.08);
      }
      return;
    }
    if (this.alarmDuckLeft > 0) {
      this.alarmDuckLeft -= dt;
      if (this.alarmDuckLeft <= 0) this.releaseAlarmDuck();
    }
  }

  /** Let the mix back up after a sting. Idempotent — a restore is a ramp to 1. */
  private releaseAlarmDuck(): void {
    this.alarmDuckLeft = 0;
    const graph = this.graph;
    if (!graph) return;
    graph.setBusDuck('ambient', 1, 0.6);
    graph.setBusDuck('music', 1, 0.6);
    graph.setBusDuck('sfx', 1, 0.3);
  }

  private startAmbient(): void {
    if (this.ambientLoop || !this.graph) return;
    this.ambientLoop = this.graph.startLoop(SOUND.ambient, 0, 'ambient');
    // A long fade in: the bed should arrive without anyone noticing it start.
    this.ambientLoop.setGain(1, AMBIENT_FADE_IN_S);
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
    case TELL.stationDeath:
      return 1;
    default:
      return 1;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
