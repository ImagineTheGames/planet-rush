/**
 * The audible half of the mandate, checked headless.
 *
 * Two gates the brief names by hand, and one it implies:
 *
 *  1. **The audio graph builds headless.** Every test in this file runs against
 *     {@link FakeAudioContext} — a plain object implementing the small subset in
 *     `./context` — on a CI box with no audio hardware, in the same `node`
 *     environment the match server and the QA harness run in (GDD §4.1). A
 *     type-level assertion checks that a *real* `AudioContext` satisfies that
 *     same subset, so the fake cannot drift away from the thing it stands in for.
 *  2. **Every mechanic has an audible tell** (GDD §3.6): the routing is walked
 *     kind by kind, and a `null` in the map has to be one of the three
 *     documented held states rather than a mechanic someone forgot.
 *  3. **The alarm is sustained-damage only** (GDD §2.2): *"not a single stray
 *     shot — a taunt-tap must not trigger it."* That sentence is a test.
 */

import { describe, expect, it } from 'vitest';
import { TELL, TELL_NAMES, TellQueue, type TellKind } from '../tells';
import { DeathMoment, HUSH_S } from '../vfx/death-moment';
import { ENGAGE, LEAK, MIN_HOLD_S, UnderAttackAlarm, WEIGHTS } from './alarm';
import { WeaponVoices, SustainedVoice } from './weapons';
import {
  isLayered,
  loops,
  SOUND,
  SOUND_NAMES,
  SUSTAINED_TELLS,
  soundSpec,
  TELL_SOUND,
  type SoundName,
} from './bank';
import {
  openAudioContext,
  toAudioBuffer,
  type AudioBufferLike,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type BufferSourceLike,
  type GainNodeLike,
} from './context';
import { AudioEngine, EARSHOT_FAR, EARSHOT_NEAR } from './engine';
import { AudioGraph, MIX_DEFAULTS, renderSound } from './graph';
import { MusicDirector, MusicScore, MUSIC_COMBAT, SIEGE_ON, STING_GATE } from './music';
import { DEFAULT_SAMPLE_RATE, peak, renderVoice, rms, seamless, voiceDuration, type VoiceSpec } from './synth';
import { AudioUnlock, defaultUnlockTarget, UNLOCK_EVENTS, type UnlockTarget } from './unlock';

// ---------------------------------------------------------------------------
// A headless AudioContext
// ---------------------------------------------------------------------------

class FakeParam implements AudioParamLike {
  value: number;
  /** Every scheduled event, so a test can prove a fade was ramped, not jumped. */
  readonly events: { kind: string; value: number; time: number }[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.events.push({ kind: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.events.push({ kind: 'ramp', value, time: endTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.events.push({ kind: 'cancel', value: 0, time: startTime });
  }
}

class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  disconnected = 0;

  connect(destination: AudioNodeLike): void {
    this.outputs.push(destination);
  }

  disconnect(): void {
    this.disconnected++;
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  starts = 0;
  stops = 0;

  start(): void {
    this.starts++;
  }

  stop(): void {
    this.stops++;
  }
}

class FakeBuffer implements AudioBufferLike {
  readonly numberOfChannels = 1;
  private readonly data: Float32Array;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext implements AudioContextLike {
  sampleRate = DEFAULT_SAMPLE_RATE;
  currentTime = 0;
  state = 'running';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  resumes = 0;

  createGain(): GainNodeLike {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBufferSource(): BufferSourceLike {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
  }

  /** Move the clock, the way a browser would between frames. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }
}

/**
 * The compile-time half: a real `AudioContext` satisfies the subset the whole
 * module is written against. If a browser API shifts, this fails `tsc` rather
 * than failing silently on a phone (GDD risk 7).
 */
type RealSatisfiesSubset = AudioContext extends AudioContextLike ? true : false;
const REAL_CONTEXT_FITS: RealSatisfiesSubset = true;

const ALL_KINDS: TellKind[] = Object.values(TELL);

/** Drive an engine for `seconds` at 60 Hz, advancing the fake clock with it. */
function run(engine: AudioEngine, ctx: FakeAudioContext, seconds: number, each?: () => void): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    each?.();
    engine.update(dt);
    ctx.advance(dt);
  }
}

// ---------------------------------------------------------------------------

describe('the Web Audio seam (`./context`)', () => {
  it('is a subset a real AudioContext satisfies', () => {
    expect(REAL_CONTEXT_FITS).toBe(true);
  });

  it('returns null where there is no audio at all — Node, the server, the harness', () => {
    expect(openAudioContext({})).toBeNull();
  });

  it('prefers AudioContext, falls back to the webkit prefix (older iOS)', () => {
    const made: string[] = [];
    const Standard = class {
      constructor() {
        made.push('standard');
      }
    } as unknown as new () => AudioContextLike;
    const Webkit = class {
      constructor() {
        made.push('webkit');
      }
    } as unknown as new () => AudioContextLike;

    openAudioContext({ AudioContext: Standard, webkitAudioContext: Webkit });
    openAudioContext({ webkitAudioContext: Webkit });
    expect(made).toEqual(['standard', 'webkit']);
  });

  it('never throws when the browser refuses — sound is lost, the game is not', () => {
    const Broken = class {
      constructor() {
        throw new Error('nope');
      }
    } as unknown as new () => AudioContextLike;
    expect(openAudioContext({ AudioContext: Broken })).toBeNull();
  });

  it('copies rendered samples into a context buffer', () => {
    const ctx = new FakeAudioContext();
    const samples = new Float32Array([0.5, -0.5, 0.25]);
    const buffer = toAudioBuffer(ctx, samples, 44100);
    expect(buffer.length).toBe(3);
    expect([...buffer.getChannelData(0)]).toEqual([0.5, -0.5, 0.25]);
  });
});

describe('the synth (`./synth`) — sounds as numbers', () => {
  const bleep: VoiceSpec = {
    name: 'test',
    wave: 'square',
    attack: 0.01,
    hold: 0.05,
    decay: 0.1,
    freq: 440,
    freqEnd: 220,
    gain: 0.5,
    seed: 7,
  };

  it('renders the length the envelope adds up to', () => {
    expect(voiceDuration(bleep)).toBeCloseTo(0.16, 6);
    expect(renderVoice(bleep, 48000).length).toBe(Math.round(0.16 * 48000));
  });

  it('is pure — same spec, same samples, on any engine (GDD §4.1)', () => {
    expect([...renderVoice(bleep)]).toEqual([...renderVoice(bleep)]);
    const noisy: VoiceSpec = { ...bleep, wave: 'noise' };
    expect([...renderVoice(noisy)]).toEqual([...renderVoice(noisy)]);
    // …and a different seed is a different sound, so the seed is load-bearing.
    expect([...renderVoice(noisy)]).not.toEqual([...renderVoice({ ...noisy, seed: 8 })]);
  });

  it('never produces a NaN, an infinity or an out-of-range sample', () => {
    for (const name of SOUND_NAMES) {
      const samples = renderSound(soundSpec(name));
      expect(samples.length, name).toBeGreaterThan(0);
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i]!;
        if (!Number.isFinite(v) || v < -1 || v > 1) {
          throw new Error(`${name}[${i}] = ${v}`);
        }
      }
    }
  });

  it('starts and ends at silence, so no one-shot can click', () => {
    for (const name of SOUND_NAMES) {
      if (loops(soundSpec(name))) continue; // loops are joined instead — below
      const samples = renderSound(soundSpec(name));
      expect(Math.abs(samples[0]!), name).toBeLessThan(1e-6);
      expect(Math.abs(samples[samples.length - 1]!), name).toBeLessThan(1e-6);
    }
  });

  it('joins a loop tail to head, so the seam is not a click once per lap', () => {
    // A rendered loop's last sample and first sample are adjacent samples of the
    // source signal, so the step across the loop point is an ordinary one.
    const rate = 44100;
    const tone: VoiceSpec = { name: 'tone', wave: 'sine', attack: 0, hold: 0.5, decay: 0, freq: 100, gain: 1 };
    const flat = renderVoice(tone, rate, { edges: false });
    const looped = seamless(flat, rate, 0.05);
    expect(looped.length).toBe(flat.length - Math.floor(0.05 * rate));
    const seam = Math.abs(looped[0]! - looped[looped.length - 1]!);
    const biggestStepInside = (() => {
      let max = 0;
      for (let i = 1; i < looped.length; i++) max = Math.max(max, Math.abs(looped[i]! - looped[i - 1]!));
      return max;
    })();
    expect(seam).toBeLessThanOrEqual(biggestStepInside * 1.5);
  });

  it('leaves loops alone at the edges, so they do not pulse once per lap', () => {
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      if (!loops(spec)) continue;
      const samples = renderSound(spec);
      // A faded edge would put a near-zero sample at both ends of the loop.
      const ends = Math.abs(samples[0]!) + Math.abs(samples[samples.length - 1]!);
      expect(ends, name).toBeGreaterThan(1e-4);
    }
  });

  it('rolls off a low-pass and lets a high-pass through', () => {
    // The bug this guards: sharing one coefficient mapping between the two
    // filters, which costs ~25 dB on every sound that names a `highPass`.
    const bright: VoiceSpec = { name: 'b', wave: 'saw', attack: 0.001, hold: 0.05, decay: 0.05, freq: 2000, gain: 0.8 };
    const open = peak(renderVoice(bright));
    const muffled = peak(renderVoice({ ...bright, lowPass: 200 }));
    const thinned = peak(renderVoice({ ...bright, highPass: 400 }));
    expect(muffled).toBeLessThan(open * 0.6);
    expect(thinned).toBeGreaterThan(open * 0.4); // thinner, not silenced
  });

  it('glides pitch exponentially and floors it rather than reaching zero', () => {
    const fall: VoiceSpec = { name: 'f', wave: 'sine', attack: 0, hold: 0, decay: 0.3, freq: 800, freqEnd: 1, freqMin: 40, gain: 1 };
    const samples = renderVoice(fall);
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
    expect(peak(samples)).toBeGreaterThan(0.3);
  });

  it('survives a degenerate spec instead of producing garbage', () => {
    const nothing: VoiceSpec = { name: 'n', wave: 'sine', attack: 0, hold: 0, decay: 0, freq: 0, gain: 5 };
    const samples = renderVoice(nothing);
    expect(samples.length).toBe(1);
    expect(Number.isFinite(samples[0]!)).toBe(true);
    expect(peak(renderVoice({ ...nothing, gain: Number.NaN }))).toBe(0);
  });
});

describe('the bank (`./bank`) — a sound for every mechanic (GDD §3.6)', () => {
  it('maps every tell kind to a sound, or to a documented held state', () => {
    for (const kind of ALL_KINDS) {
      const sound = TELL_SOUND[kind];
      if (sound === null) {
        // The only legal silences: states whose voice is sustained elsewhere.
        expect(SUSTAINED_TELLS, `${TELL_NAMES[kind]} has no sound`).toContain(kind);
      } else {
        expect(SOUND_NAMES, `${TELL_NAMES[kind]} → ${sound}`).toContain(sound);
      }
    }
    expect(SUSTAINED_TELLS).toHaveLength(3);
  });

  it('names both firing voices, because the brief names them (GDD §3.6)', () => {
    expect(loops(soundSpec(SOUND.mineLoop))).toBe(true);
    expect(loops(soundSpec(SOUND.weaponLoop))).toBe(true);
  });

  it('makes rock and hull genuinely distinct, not two takes of one sound', () => {
    // A player mid-fight has to know which one they are doing without looking,
    // so the two are far apart in the one dimension that survives a bad phone
    // speaker: spectral centre. Zero crossings stand in for it, cheaply.
    const crossings = (samples: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < samples.length; i++) {
        if ((samples[i]! >= 0) !== (samples[i - 1]! >= 0)) n++;
      }
      return n / samples.length;
    };
    const rock = crossings(renderSound(soundSpec(SOUND.mineLoop)));
    const hull = crossings(renderSound(soundSpec(SOUND.weaponLoop)));
    expect(hull).toBeGreaterThan(rock * 1.8);
  });

  it('keeps every sound inside the headroom the mix assumes', () => {
    for (const name of SOUND_NAMES) {
      const samples = renderSound(soundSpec(name));
      expect(peak(samples), `${name} peak`).toBeLessThanOrEqual(1);
      expect(peak(samples), `${name} is silent`).toBeGreaterThan(0.01);
      expect(rms(samples), `${name} rms`).toBeLessThan(0.5);
    }
  });

  it('makes the alarm the loudest thing in the bank — it is a mechanic (§2.2)', () => {
    const alarm = rms(renderSound(soundSpec(SOUND.alarm)));
    const chatter = [SOUND.oreCollect, SOUND.repairTick, SOUND.spawnPulse, SOUND.shotImpact];
    for (const name of chatter) {
      expect(alarm, `alarm vs ${name}`).toBeGreaterThan(rms(renderSound(soundSpec(name))));
    }
  });

  it('gives the planet death the longest tail in the bank (GDD §4.7)', () => {
    const length = (name: SoundName) => renderSound(soundSpec(name)).length;
    const death = length(SOUND.planetDeath);
    for (const name of SOUND_NAMES) {
      const spec = soundSpec(name);
      if (loops(spec)) continue; // loops are bodies, not tails
      if (name === SOUND.planetDeath || name === SOUND.collapseBegin) continue;
      expect(death, `${name} outlasts the death`).toBeGreaterThanOrEqual(length(name));
    }
  });

  it('layers the sounds that are layered and keeps the rest single voices', () => {
    expect(isLayered(soundSpec(SOUND.rockCrack))).toBe(false);
    expect(isLayered(soundSpec(SOUND.shipExplode))).toBe(true);
    expect(loops(soundSpec(SOUND.rockCrack))).toBe(false);
  });
});

describe('the mix (`./graph`) — built headless', () => {
  it('builds four gain nodes wired to the destination and nothing else', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);

    expect(ctx.gains).toHaveLength(6); // duck, master, and the four buses
    expect((graph.duck as FakeGain).outputs).toEqual([ctx.destination]);
    expect((graph.master as FakeGain).outputs).toEqual([graph.duck]);
    for (const bus of Object.values(graph.buses)) {
      expect((bus as FakeGain).outputs).toEqual([graph.master]);
    }
    expect(graph.master.gain.value).toBe(MIX_DEFAULTS.master);
    expect(graph.buses.ambient.gain.value).toBe(MIX_DEFAULTS.ambient);
    expect(graph.buses.music.gain.value).toBe(MIX_DEFAULTS.music);
  });

  it('renders and caches every sound in the bank without a browser', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    expect(graph.cached).toBe(0);
    graph.preload();
    expect(graph.cached).toBe(SOUND_NAMES.length);
    graph.play(SOUND.rockCrack);
    expect(graph.cached).toBe(SOUND_NAMES.length); // shared, not re-rendered
  });

  it('plays a one-shot through a gain into the bus it was asked for', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    expect(graph.play(SOUND.turretFire, 0.5, 1.02)).toBe(true);

    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.starts).toBe(1);
    expect(source.loop).toBe(false);
    expect(source.playbackRate.value).toBeCloseTo(1.02, 6);
    const node = source.outputs[0] as FakeGain;
    expect(node.gain.value).toBe(0.5);
    expect(node.outputs).toEqual([graph.buses.sfx]);
  });

  it('refuses a repeat of the same sound inside the gap, and counts it', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0.05 });
    expect(graph.play(SOUND.oreCollect)).toBe(true);
    expect(graph.play(SOUND.oreCollect)).toBe(false); // eight ships, one frame
    expect(graph.play(SOUND.rockCrack)).toBe(true); // a different sound is fine
    expect(graph.refused).toBe(1);
    ctx.advance(0.06);
    expect(graph.play(SOUND.oreCollect)).toBe(true);
  });

  it('caps concurrent voices rather than letting a firefight open hundreds', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { maxVoices: 3, repeatGap: 0 });
    for (let i = 0; i < 3; i++) expect(graph.play(SOUND.shotImpact)).toBe(true);
    expect(graph.play(SOUND.shotImpact)).toBe(false);
    expect(graph.voiceCount).toBe(3);
  });

  it('retires finished voices by their known end time, with no callback', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0 });
    graph.play(SOUND.rockCrack);
    expect(graph.voiceCount).toBe(1);
    ctx.advance(5);
    expect(graph.voiceCount).toBe(0);
  });

  it('starts a loop looping, and fades it out on stop rather than cutting', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const loop = graph.startLoop(SOUND.ambient, 0, 'ambient');
    const source = ctx.sources[ctx.sources.length - 1]!;
    expect(source.loop).toBe(true);
    expect(source.loopEnd).toBeGreaterThan(0);
    expect(loop.alive).toBe(true);

    loop.setGain(0.8, 2);
    expect(loop.gain).toBe(0.8);
    const node = source.outputs[0] as FakeGain;
    expect(node.gain.events.some((e) => e.kind === 'ramp' && e.value === 0.8)).toBe(true);
    // …and nothing assigns `.value` after scheduling, which would cancel it.
    expect(node.gain.value).toBe(0);

    loop.stop(0.1);
    expect(loop.alive).toBe(false);
    expect(source.stops).toBe(1);
    loop.stop(); // idempotent
    expect(source.stops).toBe(1);
  });

  it('anchors a ramp at the current value so a fade cannot jump', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.setMaster(0.2, 0.5);
    const events = (graph.master.gain as FakeParam).events;
    expect(events.map((e) => e.kind)).toEqual(['cancel', 'set', 'ramp']);
    expect(events[1]!.value).toBe(MIX_DEFAULTS.master);
    expect(events[2]!.value).toBe(0.2);
  });

  it('puts the hush on its own node, downstream of master (GDD §4.7)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    graph.setDuck(0);
    expect(graph.duckGain).toBe(0);
    expect(graph.master.gain.value).toBe(MIX_DEFAULTS.master); // untouched
    graph.setDuck(1);
    expect(graph.duckGain).toBe(1);
  });

  it('jitters deterministically, so a replay sounds like the match', () => {
    const a = new AudioGraph(new FakeAudioContext(), { seed: 5 });
    const b = new AudioGraph(new FakeAudioContext(), { seed: 5 });
    const draws = Array.from({ length: 8 }, () => a.jitter(0.1));
    expect(draws).toEqual(Array.from({ length: 8 }, () => b.jitter(0.1)));
    for (const r of draws) expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.1);
  });

  it('tears down every node it made', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx, { repeatGap: 0 });
    graph.play(SOUND.rockCrack);
    graph.dispose();
    expect((graph.master as FakeGain).disconnected).toBe(1);
    expect((graph.duck as FakeGain).disconnected).toBe(1);
    expect(graph.play(SOUND.rockCrack)).toBe(false);
  });
});

describe('held voices (`./weapons`)', () => {
  it('starts on demand and stops itself when the state goes quiet', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const voice = new SustainedVoice(graph, SOUND.thruster, { release: 0.05, attack: 0 });

    expect(voice.playing).toBe(false);
    voice.push(1);
    voice.update(1 / 60);
    expect(voice.playing).toBe(true);
    expect(voice.gain).toBeGreaterThan(0.5);

    for (let i = 0; i < 60; i++) voice.update(1 / 60); // nothing pushed: release
    expect(voice.playing).toBe(false);
    expect(voice.gain).toBe(0);
  });

  it('takes the strongest source rather than summing them into a clip', () => {
    const graph = new AudioGraph(new FakeAudioContext());
    const voice = new SustainedVoice(graph, SOUND.thruster, { attack: 0 });
    for (let i = 0; i < 8; i++) voice.push(0.4);
    voice.push(0.9);
    voice.update(1 / 60);
    expect(voice.gain).toBeCloseTo(0.9, 5);
  });

  it('crossfades the two firing voices instead of switching between them', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const weapons = new WeaponVoices(graph);

    for (let i = 0; i < 20; i++) {
      weapons.onHit(false, 1); // mining
      weapons.update(1 / 60);
    }
    expect(weapons.levels.rock).toBeGreaterThan(0.5);
    expect(weapons.levels.hull).toBe(0);

    // A shot sweeps off the rock and onto a hull: rock falls, hull rises,
    // and for a moment both are sounding — that is the slide.
    weapons.onHit(true, 1);
    weapons.update(1 / 60);
    expect(weapons.levels.hull).toBeGreaterThan(0);
    expect(weapons.levels.rock).toBeGreaterThan(0);
    expect(weapons.levels.rock).toBeLessThan(0.7);

    for (let i = 0; i < 60; i++) {
      weapons.onHit(true, 1);
      weapons.update(1 / 60);
    }
    expect(weapons.levels.rock).toBe(0);
    expect(weapons.levels.hull).toBeGreaterThan(0.5);
  });

  it('rides pitch with weapon power — a heavier tool sounds like one', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const weapons = new WeaponVoices(graph);
    weapons.onHit(false, 1);
    weapons.update(1 / 60);
    const strong = ctx.sources[ctx.sources.length - 1]!.playbackRate.value;

    const ctx2 = new FakeAudioContext();
    const weapons2 = new WeaponVoices(new AudioGraph(ctx2));
    weapons2.onHit(false, 0);
    weapons2.update(1 / 60);
    const weak = ctx2.sources[ctx2.sources.length - 1]!.playbackRate.value;

    expect(strong).toBeGreaterThan(weak);
  });

  it('is a no-op when nothing ever fires — a quiet match makes no nodes', () => {
    const ctx = new FakeAudioContext();
    const weapons = new WeaponVoices(new AudioGraph(ctx));
    for (let i = 0; i < 120; i++) weapons.update(1 / 60);
    expect(weapons.playing).toBe(false);
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('the under-attack alarm (GDD §2.2) — sustained, not stray', () => {
  it('does not fire on a taunt-tap', () => {
    // "not a single stray shot — a taunt-tap must not trigger it". A rival who
    // taps your shield from across the map must not be able to pull you off a
    // full asteroid; if they could, the alarm would be the weapon.
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.coreHit);
    alarm.update(1 / 60);
    expect(alarm.active).toBe(false);

    for (let i = 0; i < 5; i++) {
      alarm.damage(TELL.shieldHit);
      alarm.update(1 / 60);
    }
    expect(alarm.active).toBe(false);

    for (let i = 0; i < 120; i++) alarm.update(1 / 60); // and it leaks away
    expect(alarm.pressure).toBe(0);
  });

  it('fires on sustained fire held on the core, in well under a second', () => {
    const alarm = new UnderAttackAlarm();
    let elapsed = 0;
    while (!alarm.active && elapsed < 3) {
      alarm.damage(TELL.coreHit); // the observer emits this every damaging tick
      alarm.update(1 / 60);
      elapsed += 1 / 60;
    }
    expect(alarm.active).toBe(true);
    expect(elapsed).toBeLessThan(1);
    expect(alarm.count).toBe(1);
  });

  it('fires immediately when a turret or a shield is picked off (GDD §2.6)', () => {
    // These are not ticks of damage, they are the siege *winning* — and the
    // whole point is that the owner hears about it while they are elsewhere.
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.turretDown);
    alarm.damage(TELL.shieldDown);
    alarm.update(1 / 60);
    expect(alarm.active).toBe(true);
  });

  it('holds through a lull rather than stuttering on and off', () => {
    const alarm = new UnderAttackAlarm();
    while (!alarm.active) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    // The attacker breaks off to dodge a turret. A flickering alarm is one a
    // player learns to ignore, which would cost the mechanic everything.
    for (let t = 0; t < MIN_HOLD_S - 0.1; t += 1 / 60) {
      alarm.update(1 / 60);
      expect(alarm.active).toBe(true);
    }
    for (let i = 0; i < 30; i++) alarm.update(1 / 60);
    expect(alarm.active).toBe(false);
  });

  it('keeps ringing while the siege continues', () => {
    const alarm = new UnderAttackAlarm();
    for (let t = 0; t < 10; t += 1 / 60) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    expect(alarm.active).toBe(true);
    expect(alarm.pressure).toBeLessThanOrEqual(2.5); // capped, not banked
  });

  it('weights only the three damage kinds the design names', () => {
    // "your core, shield, or turrets take sustained damage" — and nothing else.
    const alarm = new UnderAttackAlarm();
    for (const kind of ALL_KINDS) {
      const weight = alarm.damage(kind);
      if (weight > 0) expect(WEIGHTS[kind], TELL_NAMES[kind]).toBeGreaterThan(0);
    }
    expect(alarm.damage(TELL.oreCollect)).toBe(0);
    expect(alarm.damage(TELL.rockBurst)).toBe(0);
    expect(alarm.damage(TELL.thrust)).toBe(0);
  });

  it('goes quiet when the home it was defending is gone', () => {
    const alarm = new UnderAttackAlarm();
    while (!alarm.active) {
      alarm.damage(TELL.coreHit);
      alarm.update(1 / 60);
    }
    alarm.silence();
    expect(alarm.active).toBe(false);
    expect(alarm.pressure).toBe(0);
  });

  it('leaks at the documented rate, so the arithmetic is inspectable', () => {
    const alarm = new UnderAttackAlarm();
    alarm.damage(TELL.turretDown); // 0.8
    alarm.update(0.5);
    expect(alarm.pressure).toBeCloseTo(0.8 - LEAK * 0.5, 5);
    expect(ENGAGE).toBe(1);
  });
});

describe('the engine (`./engine`) — tells in, sound out', () => {
  const engineOn = (options = {}) => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0, ...options });
    engine.start();
    return { ctx, engine };
  };

  it('sounds every tell kind that is not a held state', () => {
    for (const kind of ALL_KINDS) {
      if (SUSTAINED_TELLS.includes(kind)) continue;
      const { engine } = engineOn();
      const tells = new TellQueue(8);
      tells.push(kind, 0, 0, 0, 0.7, 0);
      engine.consume(tells);
      expect(engine.playCount, `${TELL_NAMES[kind]} made no sound`).toBe(1);
    }
  });

  it('sustains the three held states instead of retriggering them', () => {
    const { ctx, engine } = engineOn();
    const tells = new TellQueue(8);
    tells.push(TELL.mineHit, 0, 0, 0, 1, 0);
    tells.push(TELL.thrust, 0, 0, 0, 1, 0);

    for (let i = 0; i < 60; i++) {
      engine.consume(tells);
      engine.update(1 / 60);
      ctx.advance(1 / 60);
    }
    // A whole second of held fire and throttle: two looping sources, not 120
    // one-shots. (`preload` makes no sources, so every source here is a loop.)
    expect(engine.playCount).toBe(0);
    // Four loops: the two firing voices, the ambient bed, and the soundtrack's
    // calm drone — mining is not combat, so the theme never joins them here.
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(4);
  });

  it('goes quiet for three seconds when a home dies (GDD §4.7)', () => {
    const { ctx, engine } = engineOn();
    const death = new TellQueue(4);
    death.push(TELL.planetDeath, 0, 0, 0, 1, 1);
    const noise = new TellQueue(4);
    noise.push(TELL.turretFire, 0, 0, 0, 1, 1);

    engine.consume(death);
    expect(engine.playCount).toBe(1); // the fall itself plays…

    // …the mix takes HUSH_CUT_S to reach zero, which is a shaped cut and not an
    // instant mute, so a few sounds are still starting during it.
    run(engine, ctx, 0.3, () => engine.consume(noise));
    const atSilence = engine.playCount;
    expect(engine.death.gain).toBe(0);

    // From here to the end of the three seconds: nothing starts at all. Not
    // turned down — not started (GDD §4.7).
    run(engine, ctx, HUSH_S - 0.5, () => engine.consume(noise));
    expect(engine.playCount).toBe(atSilence);
    expect(engine.hushedCount).toBeGreaterThan(50);
    expect(engine.death.silent).toBe(true);

    run(engine, ctx, 1.5, () => engine.consume(noise));
    expect(engine.playCount).toBeGreaterThan(atSilence); // the mix comes back
  });

  it('shares one death moment with the VFX field when handed one', () => {
    const death = new DeathMoment();
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, death });
    engine.start();

    const tells = new TellQueue(4);
    tells.push(TELL.planetDeath, 0, 0, 0, 1, 1);
    engine.consume(tells);
    // The field owns the trigger in that arrangement; the engine must not
    // double-count it, and must not advance it either.
    expect(death.count).toBe(0);

    death.trigger();
    death.update(0.5);
    engine.update(1 / 60);
    expect(engine.graph!.duckGain).toBe(0); // it still reads the shared object
  });

  it('rings the alarm only for the home the local player owns', () => {
    const mine = engineOn({ local: 3 });
    const theirs = engineOn({ local: 3 });
    const at = (owner: number) => {
      const q = new TellQueue(4);
      q.push(TELL.coreHit, 0, 0, 0, 0.5, owner);
      return q;
    };
    run(mine.engine, mine.ctx, 1.5, () => mine.engine.consume(at(3)));
    run(theirs.engine, theirs.ctx, 1.5, () => theirs.engine.consume(at(5)));

    expect(mine.engine.alarm.active).toBe(true);
    expect(theirs.engine.alarm.active).toBe(false);
  });

  it('starts one alarm loop and ducks the ambience under it', () => {
    // Music off here so the loop count is just the two this test is about — the
    // soundtrack's own ducking has its own test below.
    const { ctx, engine } = engineOn({ local: 0, music: false });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));

    expect(engine.alarm.active).toBe(true);
    const loops = ctx.sources.filter((s) => s.loop);
    expect(loops.length).toBe(2); // the bed, and the alarm — one of each
    const ambientRamps = (engine.graph!.buses.ambient.gain as FakeParam).events;
    expect(ambientRamps.some((e) => e.kind === 'ramp' && e.value < 1)).toBe(true);
  });

  it('ducks the soundtrack and the SFX under the alarm, not just the ambience', () => {
    // The brief's mix pass: "music and SFX duck under the alarm." The soundtrack
    // and ambience drop hard; the SFX only step aside, because they are the
    // mechanics the alarm is telling you about (GDD §2.2).
    const { ctx, engine } = engineOn({ local: 0 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.5, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true);

    const ducked = (bus: 'music' | 'sfx' | 'ambient') =>
      (engine.graph!.buses[bus].gain as FakeParam).events.some((e) => e.kind === 'ramp' && e.value < 1);
    expect(ducked('music')).toBe(true);
    expect(ducked('sfx')).toBe(true);
    expect(ducked('ambient')).toBe(true);

    // …and the SFX are ducked *less* than the soundtrack — they must stay heard.
    const lowest = (bus: 'music' | 'sfx') => {
      const ramps = (engine.graph!.buses[bus].gain as FakeParam).events.filter((e) => e.kind === 'ramp');
      return Math.min(...ramps.map((e) => e.value));
    };
    expect(lowest('sfx')).toBeGreaterThan(lowest('music'));
  });

  it('stops the alarm when the home it was defending dies', () => {
    const { ctx, engine } = engineOn({ local: 2 });
    const hits = new TellQueue(4);
    hits.push(TELL.coreHit, 0, 0, 0, 0.1, 2);
    run(engine, ctx, 1, () => engine.consume(hits));
    expect(engine.alarm.active).toBe(true);

    const death = new TellQueue(4);
    death.push(TELL.planetDeath, 0, 0, 0, 1, 2);
    engine.consume(death);
    engine.update(1 / 60);
    // An alarm over a dead planet would tell a player to defend a wreck — and
    // it would ring straight through the three seconds nobody jokes in.
    expect(engine.alarm.active).toBe(false);
  });

  it('falls off with distance so a far siege is background, not a wall', () => {
    const { engine } = engineOn();
    engine.setListener(0, 0);
    const near = new TellQueue(4);
    near.push(TELL.turretFire, EARSHOT_NEAR / 2, 0, 0, 1, 1);
    const far = new TellQueue(4);
    far.push(TELL.turretFire, EARSHOT_FAR * 2, 0, 0, 1, 1);

    engine.consume(far);
    expect(engine.playCount).toBe(0); // over the horizon
    engine.consume(near);
    expect(engine.playCount).toBe(1);
  });

  it('plays everything at full level with no listener — a spectator, or a test', () => {
    const { engine } = engineOn();
    const q = new TellQueue(4);
    q.push(TELL.turretFire, 99999, 99999, 0, 1, 1);
    engine.consume(q);
    expect(engine.playCount).toBe(1);
  });

  it('runs silent with no context at all — the server, the harness (GDD §4.1)', () => {
    const engine = new AudioEngine({ local: 0 });
    expect(engine.audible).toBe(false);
    expect(engine.graph).toBeNull();

    const q = new TellQueue(64);
    // Every kind except the death — a planet dying every frame would silence
    // the alarm every frame, which is correct behaviour and a useless test.
    for (const kind of ALL_KINDS) {
      if (kind !== TELL.planetDeath) q.push(kind, 0, 0, 0, 0.5, 0);
    }
    for (let i = 0; i < 120; i++) {
      engine.consume(q);
      engine.update(1 / 60);
    }
    // The numbers still run: the alarm state machine is not an audio feature.
    expect(engine.alarm.active).toBe(true);
    expect(engine.playCount).toBe(0);
    engine.dispose();
  });

  it('can drop the ambient bed without touching anything else (GDD §4.9)', () => {
    const { ctx, engine } = engineOn();
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(1);
    engine.setAmbient(false);
    const q = new TellQueue(4);
    q.push(TELL.rockCrack, 0, 0, 0, 1, 1);
    engine.consume(q);
    expect(engine.playCount).toBe(1); // SFX are mechanics; they stay
  });

  it('resets for a rematch and disposes cleanly', () => {
    const { ctx, engine } = engineOn({ local: 0 });
    const q = new TellQueue(4);
    q.push(TELL.coreHit, 0, 0, 0, 0.2, 0);
    run(engine, ctx, 1, () => engine.consume(q));
    expect(engine.alarm.active).toBe(true);

    engine.reset();
    expect(engine.alarm.active).toBe(false);
    engine.dispose();
    expect(engine.running).toBe(false);
  });
});

describe('the adaptive soundtrack (`./music`) — following the match', () => {
  /** Advance a pure score for `seconds`, optionally doing something each frame. */
  const drive = (score: MusicScore, seconds: number, each?: () => void): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      each?.();
      score.update(1 / 60);
    }
  };

  it('opens on the calm drone — bed only, no theme, no pulse', () => {
    const score = new MusicScore();
    expect(score.phase).toBe('calm');
    expect(score.gains).toEqual({ bed: 1, pulse: 0, theme: 0, dread: 0 });
  });

  it('raises the pulse as the waves arrive, and never lowers it again', () => {
    const score = new MusicScore();
    score.wave(0.4); // wave 2 of 5
    score.update(1 / 60);
    expect(score.phase).toBe('rising');
    expect(score.tension).toBeCloseTo(0.4, 5);
    expect(score.gains.pulse).toBeCloseTo(0.4, 5);

    // A later, *smaller* magnitude must not walk the tension back down — the
    // waves only ever pull the match tighter (GDD §2.3).
    score.wave(0.2);
    score.update(1 / 60);
    expect(score.tension).toBeCloseTo(0.4, 5);
  });

  it('heats the theme in a fight, but not while mining — the inversion (GDD §2.3)', () => {
    const fighting = new MusicScore();
    drive(fighting, 0.6, () => fighting.combat(TELL.weaponHit));
    expect(fighting.gains.theme).toBeGreaterThan(0);

    const mining = new MusicScore();
    drive(mining, 0.6, () => mining.combat(TELL.mineHit));
    expect(mining.gains.theme).toBe(0);
    expect(mining.phase).toBe('calm');
  });

  it('forces the full theme fast when the local home is under siege (GDD §2.6)', () => {
    const score = new MusicScore();
    score.setUnderAttack(true); // the alarm is ringing
    drive(score, 0.5);
    expect(score.intensity).toBeGreaterThan(SIEGE_ON);
    expect(score.phase).toBe('siege');
    expect(score.gains.theme).toBeGreaterThan(SIEGE_ON);
  });

  it('lets the theme recede once the shooting stops', () => {
    const score = new MusicScore();
    score.setUnderAttack(true);
    drive(score, 1);
    const peak = score.gains.theme;
    score.setUnderAttack(false);
    drive(score, 3); // the leak takes over
    expect(score.gains.theme).toBeLessThan(peak);
    expect(score.gains.theme).toBeLessThan(0.1);
  });

  it('thins the bed to dread through the collapse (GDD §2.3)', () => {
    const score = new MusicScore();
    score.wave(0.6);
    score.collapse();
    score.update(1 / 60);
    expect(score.phase).toBe('collapse');
    expect(score.gains.bed).toBe(0);
    expect(score.gains.pulse).toBe(0);
    expect(score.gains.theme).toBe(0);
    expect(score.gains.dread).toBe(1);
  });

  it('goes silent and queues a sting on the win or the loss', () => {
    const win = new MusicScore();
    win.collapse();
    win.end(true);
    win.update(1 / 60);
    expect(win.phase).toBe('over');
    expect(win.gains).toEqual({ bed: 0, pulse: 0, theme: 0, dread: 0 }); // the sting owns the last beat
    expect(win.pendingSting).toBe('win');
    expect(win.won).toBe(true);

    const loss = new MusicScore();
    loss.end(false);
    expect(loss.pendingSting).toBe('loss');
    expect(loss.won).toBe(false);
  });

  it('weights combat broadly but leaves mining and the clock out of it', () => {
    const score = new MusicScore();
    expect(score.combat(TELL.mineHit)).toBe(0);
    expect(score.combat(TELL.waveArrive)).toBe(0);
    expect(score.combat(TELL.coreHit)).toBeGreaterThan(0);
    for (const kind of ALL_KINDS) {
      const w = MUSIC_COMBAT[kind];
      if (w !== undefined) expect(w).toBeGreaterThan(0);
    }
  });

  it('resets to the opening drone for a rematch', () => {
    const score = new MusicScore();
    score.wave(1);
    score.setUnderAttack(true);
    drive(score, 1);
    score.collapse();
    score.end(false);
    score.reset();
    expect(score.phase).toBe('calm');
    expect(score.gains).toEqual({ bed: 1, pulse: 0, theme: 0, dread: 0 });
    expect(score.pendingSting).toBeNull();
  });

  it('starts its stems lazily and crossfades them in — no cut', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);

    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(0); // nothing until driven
    for (let i = 0; i < 120; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 1);
      ctx.advance(1 / 60);
    }
    // The calm bed came up on its own, and it came up ramped, not snapped on.
    expect(ctx.sources.filter((s) => s.loop).length).toBeGreaterThanOrEqual(1);
    const bed = ctx.sources.find((s) => s.loop)!;
    const node = bed.outputs[0] as FakeGain;
    expect(node.gain.events.some((e) => e.kind === 'ramp')).toBe(true);
  });

  it('holds the win sting until the three-second quiet has lifted (GDD §4.7)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);
    score.end(true);

    // Through the hush — the mix is at (or near) zero — nothing sounds.
    for (let i = 0; i < 60; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 0);
      ctx.advance(1 / 60);
    }
    expect(director.stingCount).toBe(0);
    expect(score.pendingSting).toBe('win');

    // The quiet lifts (gain climbs back past the gate): the sting lands, once.
    director.update(1 / 60, STING_GATE + 0.1);
    expect(director.stingCount).toBe(1);
    expect(score.pendingSting).toBeNull();
    director.update(1 / 60, 1);
    expect(director.stingCount).toBe(1); // not again
  });

  it('stops its stems when the soundtrack is switched off (GDD §4.9 item 3)', () => {
    const ctx = new FakeAudioContext();
    const graph = new AudioGraph(ctx);
    const score = new MusicScore();
    const director = new MusicDirector(graph, score);
    for (let i = 0; i < 30; i++) {
      score.update(1 / 60);
      director.update(1 / 60, 1);
      ctx.advance(1 / 60);
    }
    const started = ctx.sources.filter((s) => s.loop).length;
    expect(started).toBeGreaterThanOrEqual(1);

    director.setEnabled(false);
    expect(director.playing).toBe(false);
    director.update(1 / 60, 1);
    // Every loop it started has been asked to stop, and nothing new is pushed.
    for (const s of ctx.sources.filter((x) => x.loop)) expect(s.stops).toBeGreaterThan(0);
  });

  it('drives the whole arc through the engine, sting and all', () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    const step = () => {
      engine.update(1 / 60);
      ctx.advance(1 / 60);
    };
    const feed = (kind: TellKind, magnitude = 1, player = 0) => {
      const q = new TellQueue(4);
      q.push(kind, 0, 0, 0, magnitude, player);
      engine.consume(q);
    };

    expect(engine.musicScore.phase).toBe('calm');

    feed(TELL.waveArrive, 0.4, -1);
    step();
    expect(engine.musicScore.phase).toBe('rising');

    for (let i = 0; i < 40; i++) {
      feed(TELL.coreHit, 0.5, 0); // a siege on my own home
      step();
    }
    expect(engine.musicScore.phase).toBe('siege');
    expect(engine.alarm.active).toBe(true);

    feed(TELL.collapseBegin, 1, -1);
    step();
    expect(engine.musicScore.phase).toBe('collapse');

    feed(TELL.matchEnd, 1, -1); // a win
    // No planet death in this synthetic arc, so the hush is not down: the sting
    // lands on the next frame.
    step();
    expect(engine.musicScore.phase).toBe('over');
    expect(engine.music!.stingCount).toBe(1);
  });
});

describe('the first gesture (`./unlock`) — GDD risk 7', () => {
  class FakeTarget implements UnlockTarget {
    readonly handlers = new Map<string, (() => void)[]>();

    addEventListener(type: string, listener: () => void): void {
      const list = this.handlers.get(type) ?? [];
      list.push(listener);
      this.handlers.set(type, list);
    }

    removeEventListener(type: string, listener: () => void): void {
      const list = (this.handlers.get(type) ?? []).filter((l) => l !== listener);
      this.handlers.set(type, list);
    }

    get count(): number {
      let n = 0;
      for (const list of this.handlers.values()) n += list.length;
      return n;
    }

    fire(type: string): void {
      for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
    }
  }

  it('listens for every gesture a player could make first', () => {
    const target = new FakeTarget();
    const unlock = new AudioUnlock(new FakeAudioContext(), target);
    unlock.arm();
    expect(target.count).toBe(UNLOCK_EVENTS.length);
    unlock.arm(); // idempotent
    expect(target.count).toBe(UNLOCK_EVENTS.length);
  });

  it('resumes and starts a silent source inside the gesture (the iOS half)', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    const ok = await unlock.unlockNow();

    expect(ok).toBe(true);
    expect(ctx.resumes).toBe(1);
    // resume() alone is not sufficient on iOS Safari: a buffer source must have
    // been started from inside a real user-gesture task.
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.starts).toBe(1);
    expect(unlock.unlocked).toBe(true);
  });

  it('detaches its listeners once, and calls back once', async () => {
    const ctx = new FakeAudioContext();
    const target = new FakeTarget();
    let unlocked = 0;
    const unlock = new AudioUnlock(ctx, target, { onUnlock: () => unlocked++ });
    unlock.arm();

    target.fire('pointerdown');
    await Promise.resolve();
    await Promise.resolve();

    expect(unlock.gestures).toBe(1);
    expect(target.count).toBe(0);
    expect(unlocked).toBe(1);
  });

  it('re-arms when the context is suspended again — a phone that locked', async () => {
    const ctx = new FakeAudioContext();
    const target = new FakeTarget();
    const unlock = new AudioUnlock(ctx, target);
    await unlock.unlockNow();
    expect(unlock.listening).toBe(false);

    ctx.state = 'suspended'; // screen lock, tab backgrounded, a phone call
    unlock.recheck();
    expect(unlock.listening).toBe(true);
    expect(target.count).toBe(UNLOCK_EVENTS.length);
  });

  it('reports failure rather than throwing when a browser refuses', async () => {
    const ctx = new FakeAudioContext();
    ctx.resume = async () => {
      throw new Error('denied');
    };
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    await expect(unlock.unlockNow()).resolves.toBe(false);
    expect(unlock.unlocked).toBe(false);
  });

  it('stays suspended-aware: a resume that did not take is not an unlock', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = async () => {
      ctx.resumes++; // some engines resolve without actually resuming
    };
    const unlock = new AudioUnlock(ctx, new FakeTarget());
    expect(await unlock.unlockNow()).toBe(false);
    expect(unlock.unlocked).toBe(false);
  });

  it('finds no target in Node, where there is no gesture to wait for', () => {
    // `globalThis` in Node has no addEventListener; the game runs silent and
    // says so, rather than throwing on the server (GDD §4.1).
    const target = defaultUnlockTarget();
    if (target !== null) expect(typeof target.addEventListener).toBe('function');
  });
});
