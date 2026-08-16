/**
 * src/art/audio/engine.test.ts — the station-death sting, measured in the mix.
 * OWNER: Sound Agent.
 *
 * *"when stations die all audio cuts off you dont hear like an explosion
 * effect"* — the developer, 2026-08-16 (a0-55).
 *
 * The bug was routing, not sound design. `SOUND.stationDeath` is a 1.1 s fall
 * that must *"not resolve, only run out"* (`./bank`), and it was summed into the
 * `sfx` bus — the same bus the three-second hush (`../vfx/death-moment`)
 * multiplies to zero over 0.12 s, one frame later. Firing the `play()` call
 * before `DeathMoment.trigger()` looked like the fix and could never be one: the
 * two are on the same wire. So the fall now takes `./graph`'s `sting` path,
 * which sums past the duck node into master.
 *
 * GDD §4.7 orders the beat — the death sound, **then** the quiet, the quiet
 * landing *on top of* the fall rather than replacing it. This file is that
 * sentence as arithmetic: at a moment when the whole mix is provably at zero,
 * the sting's own path to the destination is provably not.
 *
 * Everything is measured as a **relationship** — the sting's level against the
 * mix's at the same instant, and against its own level before the cut — never
 * against a hard-coded number that would have to be rewritten the day someone
 * moves a bus trim (LESSONS §26).
 *
 * Headless, like every other test in this directory: a plain object standing in
 * for an `AudioContext`, in the same `node` environment the match server and the
 * QA harness run in (GDD §4.1).
 */

import { describe, expect, it } from 'vitest';
import { TELL, TellQueue } from '../tells';
import { HUSH_CUT_S, HUSH_S } from '../vfx/death-moment';
import { SOUND } from './bank';
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BufferSourceLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from './context';
import { AudioEngine } from './engine';
import { AudioGraph } from './graph';
import { DEFAULT_SAMPLE_RATE } from './synth';

// ---------------------------------------------------------------------------
// A headless AudioContext that remembers what was wired to what
// ---------------------------------------------------------------------------

class FakeParam implements AudioParamLike {
  value: number;
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

  connect(destination: AudioNodeLike): void {
    this.outputs.push(destination);
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

class FakePanner extends FakeNode implements StereoPannerNodeLike {
  readonly pan = new FakeParam(0);
}

class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type = 'lowpass';
  readonly frequency = new FakeParam(20000);
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);

  start(): void {}
  stop(): void {}
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

class FakeContext implements AudioContextLike {
  sampleRate = DEFAULT_SAMPLE_RATE;
  currentTime = 0;
  state = 'running';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];

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

  createStereoPanner(): StereoPannerNodeLike {
    return new FakePanner();
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    return new FakeBiquad();
  }

  createBuffer(_channels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * The gain a signal entering `from` arrives at `to` with — the product of every
 * gain node on the way, summed over every route between them, and 0 when there
 * is no route at all.
 *
 * This is the whole point of the file: "audible" is not a property of a node, it
 * is a property of the *path* from that node to the speaker. The old bug was
 * invisible at the node (the sting's own gain was 1 the entire time) and obvious
 * on the path (it ran through a duck node holding zero).
 */
function pathGain(from: AudioNodeLike, to: AudioNodeLike): number {
  if (from === to) return 1;
  const own = from instanceof FakeGain ? from.gain.value : 1;
  let downstream = 0;
  for (const out of (from as FakeNode).outputs) downstream += pathGain(out, to);
  return own * downstream;
}

/** The one-shot gain nodes currently summing into `into` — a voice's own level. */
function voicesInto(ctx: FakeContext, into: AudioNodeLike): FakeGain[] {
  return ctx.gains.filter((gain) => gain !== into && gain.outputs.includes(into));
}

function engineOn(): { ctx: FakeContext; engine: AudioEngine; graph: AudioGraph } {
  const ctx = new FakeContext();
  const engine = new AudioEngine({ context: ctx, local: 0 });
  engine.start();
  return { ctx, engine, graph: engine.graph! };
}

/** A home dying, at the centre, owned by player 1. */
function stationDeath(owner = 1): TellQueue {
  const q = new TellQueue(4);
  q.push(TELL.stationDeath, 0, 0, 0, 1, owner);
  return q;
}

/** Advance engine and clock together, the way the frame loop does. */
function run(engine: AudioEngine, ctx: FakeContext, seconds: number, each?: () => void): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    each?.();
    ctx.currentTime += step;
    engine.update(step);
  }
}

// ---------------------------------------------------------------------------

describe('the station-death sting (a0-55) — the fall the quiet lands on top of', () => {
  it('the death sting outlives the hush', () => {
    const { ctx, engine, graph } = engineOn();

    engine.consume(stationDeath());
    // One voice, and it is on the exempt path rather than in the mix.
    const sting = voicesInto(ctx, graph.sting);
    expect(sting).toHaveLength(1);
    expect(engine.playCount).toBe(1);

    // Before the cut: the sting is audible, and so is everything else.
    const stingBefore = pathGain(sting[0]!, ctx.destination);
    const mixBefore = pathGain(graph.buses.sfx, ctx.destination);
    expect(stingBefore).toBeGreaterThan(0);
    expect(mixBefore).toBeGreaterThan(0);

    // Past the 0.12 s cut, well inside the three seconds.
    run(engine, ctx, HUSH_CUT_S + 0.1);
    expect(engine.death.silent).toBe(true);
    expect(graph.duckGain).toBe(0);

    // The mix is gone — that is the hush doing its job, and it is the same
    // instant the old code lost the sting.
    expect(pathGain(graph.buses.sfx, ctx.destination)).toBe(0);
    expect(pathGain(graph.buses.alarm, ctx.destination)).toBe(0);
    expect(pathGain(graph.buses.music, ctx.destination)).toBe(0);
    expect(pathGain(graph.buses.ambient, ctx.destination)).toBe(0);

    // The sting is NOT gone: it reaches the destination at exactly the level it
    // had before the quiet began. The relationship, not a number — the duck did
    // not touch it, whatever the bus trims happen to be today (LESSONS §26).
    const stingAfter = pathGain(sting[0]!, ctx.destination);
    expect(stingAfter).toBeGreaterThan(0);
    expect(stingAfter).toBe(stingBefore);

    // And it is still *sounding*, not merely still connected: the fall is longer
    // than the cut it has to survive, and the mix still counts it in flight.
    const fall = ctx.sources.find((source) => source.buffer !== null && !source.loop);
    expect(fall!.buffer!.duration).toBeGreaterThan(HUSH_CUT_S);
    expect(graph.voiceCount).toBeGreaterThan(0);
  });

  it('is still the only thing left in the room — nothing else survives with it', () => {
    const { ctx, engine, graph } = engineOn();
    engine.consume(stationDeath());

    const noise = new TellQueue(4);
    noise.push(TELL.turretFire, 0, 0, 0, 1, 1);
    noise.push(TELL.shieldHit, 0, 0, 0, 0.5, 1);

    // The cut is 0.12 s of shaped fall, not an instant mute, so a few things do
    // still start during it — that is the mixer being honest, and the baseline
    // is taken on the far side of it.
    run(engine, ctx, HUSH_CUT_S + 0.1, () => engine.consume(noise));
    const played = engine.playCount;
    run(engine, ctx, HUSH_S - 0.8, () => engine.consume(noise));

    // Everything the match kept doing was refused, not merely turned down. The
    // exemption is one voice wide; if this ever passes with a larger number, the
    // three seconds have sprung a leak (GDD §4.7).
    expect(engine.playCount).toBe(played);
    expect(engine.hushedCount).toBeGreaterThan(50);
    expect(voicesInto(ctx, graph.sting)).toHaveLength(1);
  });

  it('rides the SFX slider — exempt from the hush, not from the player', () => {
    const { ctx, engine, graph } = engineOn();
    // Sliders move instantly here so the fake's gain values are readable; the
    // engine's own 50 ms ramp is `./graph`'s business and is tested there.
    graph.setBus('sfx', 0.4, 0);
    expect(graph.sting.gain.value).toBe(graph.buses.sfx.gain.value);

    engine.consume(stationDeath());
    const sting = voicesInto(ctx, graph.sting)[0]!;
    const quiet = pathGain(sting, ctx.destination);

    graph.setBus('sfx', 1, 0);
    expect(pathGain(sting, ctx.destination)).toBeGreaterThan(quiet);

    // The master volume is on its path too — a player who mutes the game mutes
    // the death fall with it. The exemption is from the QUIET, nothing else.
    graph.setMaster(0, 0);
    expect(pathGain(sting, ctx.destination)).toBe(0);
  });

  it('sounds for a second home dying inside the first one’s quiet', () => {
    const { ctx, engine, graph } = engineOn();
    engine.consume(stationDeath(1));
    run(engine, ctx, 1); // deep inside the silence

    expect(graph.duckGain).toBe(0);
    const before = engine.playCount;
    const hushedBefore = engine.hushedCount;
    engine.consume(stationDeath(2));

    // Two homes dying a second apart is one long quiet (`../vfx/death-moment`),
    // but it is still two deaths — and a station destroyed in total silence is
    // the bug this brief exists to kill, one death later.
    expect(engine.playCount).toBe(before + 1);
    expect(engine.hushedCount).toBe(hushedBefore);
    const stings = voicesInto(ctx, graph.sting);
    expect(stings).toHaveLength(2);
    expect(pathGain(stings[1]!, ctx.destination)).toBeGreaterThan(0);
  });

  it('is wired past the duck and nowhere else — the mix has exactly one exemption', () => {
    const ctx = new FakeContext();
    const graph = new AudioGraph(ctx);

    // sting → master → destination, with no duck node in between…
    expect((graph.sting as FakeGain).outputs).toEqual([graph.master]);
    expect((graph.master as FakeGain).outputs).toEqual([ctx.destination]);
    expect((graph.duck as FakeGain).outputs).toEqual([graph.master]);
    // …and every bus still goes through it.
    for (const bus of Object.values(graph.buses)) {
      expect((bus as FakeGain).outputs).toEqual([graph.duck]);
    }

    graph.setDuck(0);
    expect(pathGain(graph.sting, ctx.destination)).toBeGreaterThan(0);
    for (const bus of Object.values(graph.buses)) {
      expect(pathGain(bus, ctx.destination)).toBe(0);
    }
  });

  it('plays the death fall itself, not some other voice', () => {
    const { ctx, engine, graph } = engineOn();
    graph.preload();
    const bytes = ctx.gains.length;
    engine.consume(stationDeath());
    expect(ctx.gains.length).toBe(bytes + 1); // one node for one one-shot

    // The buffer on the exempt path is the bank's stationDeath, at its rendered
    // length — the "longest-tail invariant" (`./bank`), not a stand-in.
    const source = ctx.sources.at(-1)!;
    const spec = graph.play(SOUND.stationDeath, 1, 1, 'sting'); // refused: repeat gap
    expect(spec).toBe(false);
    expect(source.buffer!.duration).toBeGreaterThan(1.1);
  });
});
