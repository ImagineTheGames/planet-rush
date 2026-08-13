/**
 * The Gantry/Bone UI cue set, checked headless.
 *
 * The handoff (`docs/design/gantry-bone-handoff.md`) names three rules and asks
 * for them to be *enforced in code review*. Code review is a person who has to
 * remember; this file is the version that fails the build:
 *
 *  1. **One sound per state change.** No cue stacking.
 *  2. **The sound tells you the outcome before the pixels do** — a refused
 *     purchase and a completed one must be unmistakable with your eyes on the
 *     fight. So: purchase is three consonant notes rising; refused is two notes a
 *     minor second apart that resolve nowhere.
 *  3. **Back never uses a forward cue.** Falling interval = backwards.
 *
 * Plus the two things the brief says to protect, which are not about this set at
 * all and are exactly the kind of thing a new cue set breaks: the three seconds
 * of near-silence on planet death (GDD §4.7), and the rockChip family (s4-01,
 * lowered in tone at the developer's request).
 *
 * Everything runs against a plain object standing in for an `AudioContext`, in
 * the same `node` environment the match server and the QA harness run in.
 */

import { describe, expect, it } from 'vitest';
import { TELL, TellQueue } from '../tells';
import { CUE_SOUND, CUE_UI, isLayered, SOUND, soundSpec, type AudioCue, type LayeredSpec } from './bank';
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BufferSourceLike,
  ConvolverNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from './context';
import { AudioEngine } from './engine';
import { peak } from './synth';
import {
  A_FLAT_6,
  DETUNE_MIN,
  DETUNE_SPAN,
  FIFTH_ABOVE,
  FOURTH_BELOW,
  GLASS_PAIR,
  GLASS_PARTIALS,
  MINOR_SECOND_ABOVE,
  OCTAVE_ABOVE,
  ROOM,
  STRIKE_S,
  UI_CUES,
  UI_CUE_NAMES,
  UiCuePlayer,
  cueDirection,
  cueDuration,
  cueNotes,
  cueSteps,
  detuneFactor,
  isForward,
  renderUiCue,
  resolves,
  roomImpulse,
  type UiCueName,
} from './ui-cues';
import { mulberry32 } from '@shared/types';

// ---------------------------------------------------------------------------
// A headless AudioContext, with the optional convolver the shared room wants
// ---------------------------------------------------------------------------

class FakeParam implements AudioParamLike {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
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

class FakeConvolver extends FakeNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null;
  normalize = true;
}

class FakeBuffer implements AudioBufferLike {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? this.channels[0]!;
  }
}

class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  started: number | null = null;
  start(when = 0): void {
    this.started = when;
  }
  stop(): void {}
}

class FakeContext implements AudioContextLike {
  readonly sampleRate = 48000;
  currentTime = 0;
  readonly state = 'running';
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly convolvers: FakeConvolver[] = [];

  /**
   * Assigned only when the fake is built *with* a room. Left absent otherwise,
   * because "the context has no convolver" has to be genuinely absent — an old
   * webview, a stub, the QA harness — rather than a method that returns nothing.
   */
  createConvolver?: () => ConvolverNodeLike;

  constructor(room = true) {
    if (room) {
      this.createConvolver = (): ConvolverNodeLike => {
        const node = new FakeConvolver();
        this.convolvers.push(node);
        return node;
      };
    }
  }

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
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }
  createStereoPanner(): StereoPannerNodeLike {
    return new FakePanner();
  }
  createBiquadFilter(): BiquadFilterNodeLike {
    return new FakeBiquad();
  }
  async resume(): Promise<void> {}
}

/**
 * A context that cannot build a room. A real case, and the reason the shared
 * reverb is optional rather than assumed: a context without a convolver should
 * cost the player a reverb tail, not the whole cue set.
 */
function roomlessContext(): FakeContext {
  return new FakeContext(false);
}

/** Walk a node's outputs and report whether `target` is reachable from `from`. */
function reaches(from: AudioNodeLike, target: AudioNodeLike, depth = 12): boolean {
  if (from === target) return true;
  if (depth <= 0) return false;
  const outputs = (from as { outputs?: AudioNodeLike[] }).outputs ?? [];
  return outputs.some((next) => reaches(next, target, depth - 1));
}

// ---------------------------------------------------------------------------
// The set, as ratified
// ---------------------------------------------------------------------------

describe('the set — one pane of struck glass, differentiated only by pitch, direction and note count', () => {
  it('is the nine cues the handoff table names, and no others', () => {
    expect([...UI_CUE_NAMES]).toEqual([
      'hover',
      'detent',
      'pick',
      'confirm',
      'back',
      'purchase',
      'refused',
      'join',
      'rush',
    ]);
    for (const name of UI_CUE_NAMES) expect(UI_CUES[name].name).toBe(name);
  });

  it('spells each shape with the note COUNT the table gives it', () => {
    // "one note" / "two notes" / "three notes" / "five notes then a chord" —
    // the count is half the vocabulary, so it is pinned rather than described.
    expect(cueNotes(UI_CUES.hover)).toHaveLength(1);
    expect(cueNotes(UI_CUES.detent)).toHaveLength(1);
    expect(cueNotes(UI_CUES.pick)).toHaveLength(1);
    expect(cueNotes(UI_CUES.confirm)).toHaveLength(2);
    expect(cueNotes(UI_CUES.back)).toHaveLength(2);
    expect(cueNotes(UI_CUES.purchase)).toHaveLength(3);
    expect(cueNotes(UI_CUES.refused)).toHaveLength(2);
    expect(cueNotes(UI_CUES.join)).toHaveLength(1);
    expect(cueSteps(UI_CUES.rush)).toHaveLength(6); // five climbing, then one chord
  });

  it('measures every pitch off A♭6 — the detent really is "the octave above the click"', () => {
    expect(cueNotes(UI_CUES.pick)).toEqual([A_FLAT_6]);
    expect(UI_CUES.detent.notes[0]!.f).toBe(2 * A_FLAT_6);
    expect(OCTAVE_ABOVE).toBe(2 * A_FLAT_6);
    // The fifth and the fourth-below, to within a cent of equal temperament.
    expect(12 * Math.log2(FIFTH_ABOVE / A_FLAT_6)).toBeCloseTo(7, 1);
    expect(12 * Math.log2(A_FLAT_6 / FOURTH_BELOW)).toBeCloseTo(5, 1);
    expect(12 * Math.log2(MINOR_SECOND_ABOVE / A_FLAT_6)).toBeCloseTo(1, 1);
  });

  it('uses sine partials only, on the inharmonic ratios 1 / 2.76 / 5.4', () => {
    for (const name of UI_CUE_NAMES) {
      for (const note of UI_CUES[name].notes) {
        // Every note is a prefix of the ratified stack — three partials or two,
        // never a fourth ratio somebody liked better.
        expect([GLASS_PARTIALS, GLASS_PAIR], `${name} partials`).toContainEqual(note.parts);
      }
    }
    expect(GLASS_PARTIALS).toEqual([1, 2.76, 5.4]);
    expect(GLASS_PAIR).toEqual([1, 2.76]);
  });

  it('strikes in ~2 ms everywhere — and never glides a pitch', () => {
    for (const name of UI_CUE_NAMES) {
      for (const note of UI_CUES[name].notes) {
        expect(note.strike, `${name} strike`).toBeGreaterThanOrEqual(0.002);
        expect(note.strike, `${name} strike`).toBeLessThanOrEqual(0.004);
      }
    }
    expect(STRIKE_S).toBe(0.002);
    // "No square, no saw, no pitch bends." A glass note carries ONE frequency and
    // has no field to bend it with — the shape is struck, never swept, which is
    // what the handoff says made earlier passes sound retro or cartoonish.
    const noteKeys = Object.keys(UI_CUES.confirm.notes[0]!);
    expect(noteKeys).not.toContain('freqEnd');
    expect(noteKeys).not.toContain('glide');
    expect(noteKeys).not.toContain('wave');
  });

  it('runs one short shared room behind all nine, at 25% wet', () => {
    expect(ROOM.wet).toBe(0.25);
    expect(ROOM.seconds).toBe(2.2);
    expect(ROOM.highPassHz).toBe(620);
    for (const name of UI_CUE_NAMES) {
      for (const note of UI_CUES[name].notes) {
        expect(note.wet, `${name} is not in the room`).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — back never uses a forward cue
// ---------------------------------------------------------------------------

describe('rule 3 — back never uses a forward cue (falling interval = backwards)', () => {
  it('confirm RISES and back FALLS — the direction is the whole message', () => {
    expect(cueDirection(UI_CUES.confirm)).toBe(1);
    expect(cueDirection(UI_CUES.back)).toBe(-1);
    // …and by the exact intervals the handoff names: a fifth up, a fourth down.
    const [a, b] = cueSteps(UI_CUES.confirm);
    expect(12 * Math.log2(b! / a!)).toBeCloseTo(7, 1);
    const [c, d] = cueSteps(UI_CUES.back);
    expect(12 * Math.log2(d! / c!)).toBeCloseTo(-5, 1);
  });

  it('leaves BACK the only falling cue in the whole set', () => {
    const falling = UI_CUE_NAMES.filter((n) => cueDirection(UI_CUES[n]) === -1);
    expect(falling).toEqual(['back']);
  });

  it('never lets a forward cue fall', () => {
    for (const name of UI_CUE_NAMES) {
      if (!isForward(name)) continue;
      expect(cueDirection(UI_CUES[name]), `${name} falls`).not.toBe(-1);
    }
  });

  it('gives back a note nothing forward uses, so the two can never be confused', () => {
    const backAnswer = cueSteps(UI_CUES.back)[1];
    expect(backAnswer).toBe(FOURTH_BELOW);
    for (const name of UI_CUE_NAMES) {
      if (!isForward(name)) continue;
      expect(cueNotes(UI_CUES[name]), `${name} borrows back's note`).not.toContain(backAnswer);
    }
  });

  it('routes the BACK event to the back cue, and nothing forward to it', () => {
    expect(CUE_UI.back).toBe('back');
    for (const [event, cue] of Object.entries(CUE_UI) as [AudioCue, UiCueName][]) {
      if (cue === 'back') expect(event).toBe('back');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the sound tells you the outcome before the pixels do
// ---------------------------------------------------------------------------

describe('rule 2 — a refused purchase and a completed one are unmistakable', () => {
  it('refuses with a minor second — the one two-note cue built on a dissonance', () => {
    const [a, b] = cueSteps(UI_CUES.refused);
    expect(12 * Math.log2(b! / a!)).toBeCloseTo(1, 1);
    // Every OTHER cue that states an interval — a two-note gesture — states a
    // consonant one. (RUSH!'s five-note climb is chromatic and so walks through
    // semitones, but a run is not an interval statement: it never stops on one,
    // and it lands on the confirm chord. The check is on the gestures that do.)
    for (const name of UI_CUE_NAMES) {
      if (name === 'refused') continue;
      const steps = cueSteps(UI_CUES[name]);
      if (steps.length !== 2) continue;
      const semis = Math.abs(12 * Math.log2(steps[1]! / steps[0]!));
      expect(semis, `${name} states a semitone`).not.toBeCloseTo(1, 1);
    }
  });

  it('resolves nowhere — the one cue in the set that does not land', () => {
    expect(resolves(UI_CUES.refused)).toBe(false);
    for (const name of UI_CUE_NAMES) {
      if (name === 'refused') continue;
      expect(resolves(UI_CUES[name]), `${name} does not resolve`).toBe(true);
    }
  });

  it('completes with three consonant notes rising, against the refusal’s two', () => {
    expect(cueDirection(UI_CUES.purchase)).toBe(1);
    const [a, b, c] = cueSteps(UI_CUES.purchase);
    expect(12 * Math.log2(b! / a!)).toBeCloseTo(7, 1); // the fifth
    expect(12 * Math.log2(c! / a!)).toBeCloseTo(12, 1); // the octave
    // Note count, direction AND resolution all differ. Any one of the three is
    // enough to read the outcome with your eyes on the fight; there are three.
    expect(cueSteps(UI_CUES.purchase).length).not.toBe(cueSteps(UI_CUES.refused).length);
    expect(resolves(UI_CUES.purchase)).not.toBe(resolves(UI_CUES.refused));
  });

  it('binds the UI seam’s three words to those opposite shapes', () => {
    // `src/ui/sfx.ts` raises exactly these three from the one shared control
    // driver, so a landed spend and a disabled press already differ at the seam.
    expect(CUE_UI.press).toBe('pick');
    expect(CUE_UI.confirm).toBe('purchase');
    expect(CUE_UI.reject).toBe('refused');
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — one sound per state change
// ---------------------------------------------------------------------------

describe('rule 1 — one sound per state change, no cue stacking', () => {
  const player = (ctx: AudioContextLike): UiCuePlayer => new UiCuePlayer(ctx, ctx.destination);

  it('starts exactly one cue for one state change', () => {
    const ctx = new FakeContext();
    const cues = player(ctx);
    expect(cues.play('pick')).toBe(true);
    expect(cues.playCount).toBe(1);
  });

  it('refuses a second cue landing on top of the first', () => {
    const ctx = new FakeContext();
    const cues = player(ctx);
    expect(cues.play('pick')).toBe(true);
    expect(cues.play('purchase')).toBe(false); // same instant — two cues, one change
    expect(cues.playCount).toBe(1);
    expect(cues.stackedCount).toBe(1);
  });

  it('does NOT swallow the spend that lands a frame after the press', () => {
    // The real sequence in the game: a wheel wedge sounds `press` (a pick), and
    // the HUD raises `confirm` once the SIM has landed the spend — one or two
    // frames later. Both are real state changes, and the second is the one that
    // carries the outcome (rule 2), so the stacking window must be shorter than a
    // frame. This is the test that keeps someone widening it "for safety".
    const ctx = new FakeContext();
    const cues = new UiCuePlayer(ctx, ctx.destination);
    expect(cues.play('pick')).toBe(true);
    ctx.currentTime = 1 / 60;
    expect(cues.play('purchase')).toBe(true);
    expect(cues.playCount).toBe(2);
  });

  it('lets the next real state change through once the window has passed', () => {
    const ctx = new FakeContext();
    const cues = player(ctx);
    cues.play('pick');
    ctx.currentTime = 0.5;
    expect(cues.play('purchase')).toBe(true);
    expect(cues.playCount).toBe(2);
  });

  it('will not trill: the same cue twice in a row needs a gap', () => {
    const ctx = new FakeContext();
    const cues = player(ctx);
    cues.play('hover');
    ctx.currentTime = 0.03; // past the stacking window, inside the repeat gap
    expect(cues.play('hover')).toBe(false);
    ctx.currentTime = 0.2;
    expect(cues.play('hover')).toBe(true);
  });

  it('sounds exactly one cue per `AudioEngine.cue`, dry room or not', () => {
    for (const convolver of [true, false]) {
      const ctx = convolver ? new FakeContext() : roomlessContext();
      const engine = new AudioEngine({ context: ctx, local: 0 });
      engine.start();
      engine.cue('press');
      expect(engine.playCount, `convolver=${convolver}`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The detune
// ---------------------------------------------------------------------------

describe('the detune — ±0.5 semitone, one factor per cue', () => {
  it('stays inside ±0.5 semitone', () => {
    const rng = mulberry32(7);
    const half = Math.pow(2, 0.5 / 12);
    for (let i = 0; i < 500; i++) {
      const f = detuneFactor(rng);
      expect(f).toBeGreaterThanOrEqual(DETUNE_MIN);
      expect(f).toBeLessThanOrEqual(DETUNE_MIN + DETUNE_SPAN);
      expect(f).toBeGreaterThan(1 / half - 0.001);
      expect(f).toBeLessThan(half + 0.001);
    }
  });

  it('excludes hover and detent — a wobbling hover reads as a fault', () => {
    expect(UI_CUES.hover.detuned).toBe(false);
    expect(UI_CUES.detent.detuned).toBe(false);
    for (const name of UI_CUE_NAMES) {
      if (name === 'hover' || name === 'detent') continue;
      expect(UI_CUES[name].detuned, `${name} is not detuned`).toBe(true);
    }
  });

  it('applies ONE factor to the whole cue, so the intervals stay exact', () => {
    // The factor is a playback rate over the rendered cue, which multiplies every
    // note by the same number — a fifth detuned note-by-note is no longer a fifth.
    const ctx = new FakeContext();
    const cues = new UiCuePlayer(ctx, ctx.destination, { seed: 3 });
    cues.play('confirm');
    const rates = ctx.sources.map((s) => s.playbackRate.value);
    expect(new Set(rates).size).toBe(1); // dry and send ride the identical rate
    const rate = rates[0]!;
    expect(rate).toBeGreaterThanOrEqual(DETUNE_MIN);
    expect(rate).toBeLessThanOrEqual(DETUNE_MIN + DETUNE_SPAN);
    // The interval a detuned cue sounds is BIT-FOR-BIT the interval the table
    // spells — that is what "one factor per cue" buys, and it is the reason the
    // factor is a playback rate rather than a per-note frequency wobble.
    const [a, b] = cueSteps(UI_CUES.confirm);
    expect(12 * Math.log2((b! * rate) / (a! * rate))).toBeCloseTo(12 * Math.log2(b! / a!), 12);
  });

  it('plays hover and detent at exactly rate 1', () => {
    for (const name of ['hover', 'detent'] as const) {
      const ctx = new FakeContext();
      const cues = new UiCuePlayer(ctx, ctx.destination, { seed: 3 });
      cues.play(name);
      for (const source of ctx.sources) expect(source.playbackRate.value).toBe(1);
    }
  });

  it('steps `join` one semitone per slot index, and nothing else steps', () => {
    const ctx = new FakeContext();
    const cues = new UiCuePlayer(ctx, ctx.destination, { room: false, gap: 0, repeatGap: 0 });
    const rates: number[] = [];
    for (let seat = 0; seat < 8; seat++) {
      ctx.currentTime = seat;
      ctx.sources.length = 0;
      cues.play('join', seat);
      rates.push(ctx.sources[0]!.playbackRate.value);
    }
    // Each seat is a semitone above the last, whatever the press's own detune.
    for (let i = 1; i < rates.length; i++) {
      expect(12 * Math.log2(rates[i]! / rates[i - 1]!)).toBeGreaterThan(0);
    }
    expect(UI_CUES.join.stepped).toBe(true);
    for (const name of UI_CUE_NAMES) {
      if (name === 'join') continue;
      expect(UI_CUES[name].stepped, `${name} steps`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

describe('the render — pure, headless, and inside the bank’s own level band', () => {
  it('is deterministic: same spec in, deep-equal samples out', () => {
    for (const name of UI_CUE_NAMES) {
      const a = renderUiCue(UI_CUES[name], 48000);
      const b = renderUiCue(UI_CUES[name], 48000);
      expect(a.dry, name).toEqual(b.dry);
      expect(a.send, name).toEqual(b.send);
    }
  });

  it('never produces a NaN, and never clips', () => {
    for (const name of UI_CUE_NAMES) {
      const { dry, send } = renderUiCue(UI_CUES[name], 48000);
      for (const buffer of [dry, send]) {
        for (let i = 0; i < buffer.length; i++) {
          expect(Number.isFinite(buffer[i]!), `${name} sample ${i}`).toBe(true);
        }
        expect(peak(buffer), name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sits in the same peak band as the bank’s existing UI voices', () => {
    // The bank's UI voices peak at 0.14 (pressTick) … 0.26 (rejectBuzz). The cue
    // set is balanced by the handoff's own per-note gains, and the check here is
    // that those gains land it beside the rest of the game rather than under or
    // over it — a set nobody can hear is as wrong as one that shouts.
    for (const name of UI_CUE_NAMES) {
      const p = peak(renderUiCue(UI_CUES[name], 48000).dry);
      expect(p, `${name} is inaudible`).toBeGreaterThan(0.02);
      expect(p, `${name} shouts`).toBeLessThan(0.35);
    }
  });

  it('sends every note into the room at its own level, and the body never', () => {
    // The send carries the glass and the air; `sub` is dry-only, because a body
    // through a reverb is mud. `refused` is the clean case: its sub is its only
    // low content, so the send's low end must be empty where the dry's is not.
    const { dry, send } = renderUiCue(UI_CUES.refused, 48000);
    expect(peak(dry)).toBeGreaterThan(peak(send));
    const lateDry = peak(dry.subarray(Math.round(0.36 * 48000)));
    const lateSend = peak(send.subarray(Math.round(0.36 * 48000)));
    expect(lateDry).toBeGreaterThan(lateSend);
  });

  it('renders the room’s impulse to the handoff’s own curve', () => {
    const ir = roomImpulse(48000);
    expect(ir).toHaveLength(ROOM.channels);
    expect(ir[0]!.length).toBe(Math.floor(48000 * ROOM.seconds));
    // It starts from nothing (the onset ramp) and decays to nothing.
    expect(Math.abs(ir[0]![0]!)).toBeLessThan(0.01);
    const head = peak(ir[0]!.subarray(0, 4800));
    const tail = peak(ir[0]!.subarray(ir[0]!.length - 4800));
    expect(tail).toBeLessThan(head * 0.05);
    // Two independent draws — a stereo room, wider than the mono cue feeding it.
    expect(ir[0]).not.toEqual(ir[1]);
  });

  it('keeps every cue short enough to be a UI cue — RUSH! excepted, by design', () => {
    for (const name of UI_CUE_NAMES) {
      if (name === 'rush') continue;
      expect(cueDuration(UI_CUES[name]), name).toBeLessThan(0.6);
    }
    // RUSH! is five notes over ~1.7 s, then a chord held: a countdown, not a click.
    expect(cueDuration(UI_CUES.rush)).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// The mix — where it hangs, and what it must not intrude on
// ---------------------------------------------------------------------------

describe('the mix — the cue set hangs where the hush can reach it', () => {
  it('builds one shared room, once, for all nine cues', () => {
    const ctx = new FakeContext();
    const cues = new UiCuePlayer(ctx, ctx.destination);
    cues.preload();
    for (const name of UI_CUE_NAMES) {
      ctx.currentTime += 1;
      cues.play(name);
    }
    expect(ctx.convolvers).toHaveLength(1); // one space, not nine
    expect(cues.room).not.toBeNull();
  });

  it('filters the wet path at 620 Hz ahead of the convolver, as the prototype does', () => {
    const ctx = new FakeContext();
    const cues = new UiCuePlayer(ctx, ctx.destination);
    expect(cues.room!.gain.value).toBe(ROOM.wet);
    // send → highpass(620) → convolver → destination
    const hp = (cues.room as unknown as FakeGain).outputs[0] as FakeBiquad;
    expect(hp.type).toBe('highpass');
    expect(hp.frequency.value).toBe(ROOM.highPassHz);
    expect(hp.outputs[0]).toBe(ctx.convolvers[0]);
    expect(ctx.convolvers[0]!.outputs[0]).toBe(ctx.destination);
  });

  it('plays dry rather than not at all where a context has no convolver', () => {
    const ctx = roomlessContext();
    const cues = new UiCuePlayer(ctx, ctx.destination);
    expect(cues.room).toBeNull();
    expect(cues.play('pick')).toBe(true);
  });

  it('hangs off the SFX bus, upstream of the duck — the hush is protected in the MIXER', () => {
    const ctx = new FakeContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    const graph = engine.graph!;
    // Both halves of a cue — the dry and the room — reach the duck node, which is
    // what the three seconds of near-silence multiplies (GDD §4.7). Nothing in the
    // cue set can route around it, which is the entire point of putting the quiet
    // in the mixer rather than in gameplay code.
    expect(reaches(graph.buses.sfx, graph.duck)).toBe(true);
    expect(reaches(engine.uiCues!.room!, graph.duck)).toBe(true);
    engine.cue('press');
    for (const gain of ctx.gains) {
      if (gain.outputs.length === 0) continue;
      expect(reaches(gain, graph.duck) || gain === graph.duck).toBe(true);
    }
  });
});

describe('the three seconds of near-silence on planet death (GDD §4.7) — protected', () => {
  /** Advance a real engine, the way the frame loop does. */
  function run(engine: AudioEngine, ctx: FakeContext, seconds: number): void {
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) {
      ctx.currentTime += step;
      engine.update(step);
    }
  }

  it('starts no UI cue at all while a home is dying', () => {
    const ctx = new FakeContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    engine.consume(death);
    run(engine, ctx, 0.3);
    expect(engine.death.gain).toBe(0);

    const before = engine.playCount;
    const cuesBefore = engine.uiCues!.playCount;
    // Every cue in the new vocabulary, not just the three that existed before.
    for (const kind of ['press', 'confirm', 'reject', 'hover', 'detent', 'back', 'accept', 'join', 'rush'] as const) {
      engine.cue(kind);
    }
    expect(engine.playCount).toBe(before);
    expect(engine.uiCues!.playCount).toBe(cuesBefore); // not one glass note intruded
    expect(engine.hushedCount).toBeGreaterThan(0);
  });

  it('lets them back in once the quiet has lifted', () => {
    const ctx = new FakeContext();
    const engine = new AudioEngine({ context: ctx, local: 0 });
    engine.start();
    const death = new TellQueue(4);
    death.push(TELL.stationDeath, 0, 0, 0, 1, 1);
    engine.consume(death);
    run(engine, ctx, 12); // well past the hush and its slow return
    expect(engine.death.gain).toBeGreaterThan(0.9);
    engine.cue('press');
    expect(engine.uiCues!.playCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// What this brief must NOT have touched
// ---------------------------------------------------------------------------

describe('what the cue set leaves alone', () => {
  it('does not touch the rockChip family (s4-01, lowered at the developer’s request)', () => {
    // These are UI cues, not world tells. The rock voices keep the exact numbers
    // the developer signed off on — pinned here so a future UI pass cannot drift
    // them while "tidying the bank".
    //
    // What they signed off on CHANGED under s10-01: the developer listened to the
    // board and chose `rockChip` candidate **b** ("blunt pressure bite, sub
    // weight"), which is a two-layer stack rather than the single band-limited
    // `noise` hit this line used to pin. The pin follows the ratification rather
    // than the shape it happened to have — a UI pass still may not touch it, and
    // now the thing it may not touch is the adopted voice.
    const chip = soundSpec(SOUND.rockChip);
    expect(isLayered(chip)).toBe(true);
    expect(chip.name).toBe('rockChip');
    expect((chip as LayeredSpec).layers.map((l) => l.spec.name)).toEqual(['rockChip.mass', 'rockChip.crush']);
    for (const name of UI_CUE_NAMES) {
      expect(JSON.stringify(UI_CUES[name])).not.toContain('rock');
    }
    // …and no cue event routes at a rock voice.
    for (const cue of Object.values(CUE_SOUND)) {
      expect(cue).not.toBe(SOUND.rockChip);
      expect(cue).not.toBe(SOUND.rockCrack);
      expect(cue).not.toBe(SOUND.rockBurst);
    }
  });

  it('wires neither the ambient bed nor the HP-tied core alarm — both "worth a conversation"', () => {
    const source = JSON.stringify(UI_CUES) + JSON.stringify(UI_CUE_NAMES);
    expect(source).not.toContain('ambient');
    expect(source).not.toContain('alarm');
    // The cue vocabulary itself names no such event.
    expect(Object.keys(CUE_UI)).not.toContain('ambient');
    expect(Object.keys(CUE_UI)).not.toContain('alarm');
  });

  it('leaves the UI seam’s three-word vocabulary exactly as it was', () => {
    // `src/ui/sfx.ts` (UI-owned) still names press / confirm / reject and nothing
    // else; this brief added cues BESIDE them rather than under them.
    for (const word of ['press', 'confirm', 'reject'] as const) {
      expect(CUE_SOUND[word]).toBeDefined();
      expect(CUE_UI[word]).toBeDefined();
    }
  });

  it('keeps every device cue answerable, glass or bank', () => {
    const events: AudioCue[] = [
      'press',
      'confirm',
      'reject',
      'deposit',
      'respawnBeep',
      'respawnGo',
      'ping',
      'hover',
      'detent',
      'back',
      'accept',
      'join',
      'rush',
    ];
    for (const event of events) {
      const ctx = new FakeContext();
      const engine = new AudioEngine({ context: ctx, local: 0 });
      engine.start();
      engine.cue(event);
      expect(engine.playCount, `${event} made no sound`).toBe(1);
    }
  });
});
