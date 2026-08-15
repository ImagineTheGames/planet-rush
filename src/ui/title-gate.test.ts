/**
 * Title-gate tests (`./title-gate`, a0-50).
 *
 * Two of these are named in the brief because they are the two failures that are
 * INVISIBLE in a passing render, and both cost design a round:
 *
 *  - **`the doorway is a hole, not a fade`** — a `clip-path` on a filled element
 *    yields a solid shape rather than a ring, so the shortcut paints the doorway
 *    shut. The door still animates, the screenshot still looks right, and the
 *    menu never shows through the one place the whole design says it must.
 *  - **`nothing sounds before the first press`** — browsers block audio until a
 *    gesture, so a screen that reaches for the cue engine (or an `AudioContext`)
 *    on mount is silent in every browser AND wrong.
 *
 * Everything else here holds the traps the handoff names: the frame may not fade
 * while it is still on screen, the ramp may not be painted with `text-shadow`,
 * and nothing on this screen may reach a CDN.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DOOR,
  FONT_URLS,
  GATE_OPEN_STEPS,
  GATE_RESEAL_STEPS,
  GAME_NAME,
  OPENING_SCALE,
  PROMPT,
  SEAL_CAP_MS,
  SEAL_FLOOR_MS,
  TITLE_GATE_ID,
  TRANSITION,
  TitleGate,
  doorBox,
  fieldAnimates,
  gateEnabled,
  gateVars,
  insidePolygon,
  makeStars,
  openingPolygon,
  paintSky,
  skyCoversPoint,
  throughScale,
  titleCss,
  titleGateHtml,
  titleRamp,
  type GateContext2D,
  type GateDom,
  type GateGradient,
  type GateListeners,
  type GatePhase,
  type GateView,
} from './title-gate';
import { extraTracking, splitWordmark } from './game-name';
import type { GateCue } from './sfx';
// The bank the gate's four beats are slots in — imported so the seam cannot
// dangle: a `GateCue` with no `UI_CUES` entry is a beat of the door that is
// silent, and it would be silent in a passing render.
import {
  A_FLAT_6,
  DOOR_CUE_NAMES,
  FIFTH_ABOVE,
  FOURTH_BELOW,
  OCTAVE_ABOVE,
  RATCHET_DETENTS,
  RATCHET_HZ,
  UI_CUES,
  renderUiCue,
} from '../art/audio/ui-cues';

/** A desktop and a phone — the two viewports whose binding dimension differs,
 *  which is the whole reason `throughScale` is measured rather than fixed. */
const DESKTOP: GateView = { width: 1920, height: 1080 };
const PHONE: GateView = { width: 844, height: 390 };

// ---------------------------------------------------------------------------
// A recording canvas and a recording DOM. There is no jsdom in this repo, and
// adding one to test a style write would be a poor trade (`../platform/boot-error`
// takes the same shape for the same reason).
// ---------------------------------------------------------------------------

type Op =
  | { readonly op: 'composite'; readonly value: string }
  | { readonly op: 'fillRect' }
  | { readonly op: 'beginPath' }
  | { readonly op: 'moveTo'; readonly x: number; readonly y: number }
  | { readonly op: 'lineTo'; readonly x: number; readonly y: number }
  | { readonly op: 'closePath' }
  | { readonly op: 'arc'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly op: 'fill'; readonly composite: string }
  | { readonly op: 'save' }
  | { readonly op: 'restore' };

class FakeGradient implements GateGradient {
  readonly stops: [number, string][] = [];
  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

class FakeContext implements GateContext2D {
  fillStyle: string | GateGradient = '#000';
  globalAlpha = 1;
  readonly ops: Op[] = [];
  private composite = 'source-over';

  get globalCompositeOperation(): string {
    return this.composite;
  }
  set globalCompositeOperation(value: string) {
    this.composite = value;
    this.ops.push({ op: 'composite', value });
  }
  fillRect(): void {
    this.ops.push({ op: 'fillRect' });
  }
  beginPath(): void {
    this.ops.push({ op: 'beginPath' });
  }
  closePath(): void {
    this.ops.push({ op: 'closePath' });
  }
  moveTo(x: number, y: number): void {
    this.ops.push({ op: 'moveTo', x, y });
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ op: 'lineTo', x, y });
  }
  arc(x: number, y: number, r: number): void {
    this.ops.push({ op: 'arc', x, y, r });
  }
  fill(): void {
    this.ops.push({ op: 'fill', composite: this.composite });
  }
  save(): void {
    this.ops.push({ op: 'save' });
  }
  restore(): void {
    this.ops.push({ op: 'restore' });
  }
  createRadialGradient(): GateGradient {
    return new FakeGradient();
  }
}

class FakeDom implements GateDom {
  html = '';
  mounted = false;
  visible = true;
  readonly vars = new Map<string, string>();
  readonly ctx = new FakeContext();
  listeners: GateListeners | null = null;
  doorScale: number | null = null;
  leafOffset: number | null = 0;
  frames = 0;
  /** Pending `setTimeout`s, so a test can advance the sequence deliberately. */
  readonly pending: { handle: number; at: number; cb: () => void }[] = [];
  private next = 1;
  private frameCb: ((ms: number) => void) | null = null;

  constructor(private readonly viewport: GateView = DESKTOP) {}

  mount(html: string, on: GateListeners): void {
    this.html = html;
    this.listeners = on;
    this.mounted = true;
  }
  unmount(): void {
    this.mounted = false;
    this.listeners = null;
  }
  setVar(name: string, value: string): void {
    this.vars.set(name, value);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  sky(): GateContext2D {
    return this.ctx;
  }
  measureDoorScale(): number | null {
    return this.doorScale;
  }
  measureLeafOffset(): number | null {
    return this.leafOffset;
  }
  view(): GateView & { dpr: number } {
    return { ...this.viewport, dpr: 1 };
  }
  frame(cb: (ms: number) => void): number {
    this.frameCb = cb;
    return this.next++;
  }
  cancelFrame(): void {
    this.frameCb = null;
  }
  timer(cb: () => void, ms: number): number {
    const handle = this.next++;
    this.pending.push({ handle, at: ms, cb });
    return handle;
  }
  cancelTimer(handle: number): void {
    const i = this.pending.findIndex((p) => p.handle === handle);
    if (i >= 0) this.pending.splice(i, 1);
  }

  /** Fire every scheduled step at or before `ms`, in order. */
  advance(ms: number): void {
    const due = this.pending.filter((p) => p.at <= ms).sort((a, b) => a.at - b.at);
    for (const p of due) {
      const i = this.pending.indexOf(p);
      if (i >= 0) this.pending.splice(i, 1);
      p.cb();
    }
  }
  /** Drive one animation frame, the way a browser would. */
  tick(ms = 16): void {
    const cb = this.frameCb;
    this.frameCb = null;
    this.frames++;
    cb?.(ms);
  }
}

function gate(dom: FakeDom, sfx?: (cue: GateCue) => void): TitleGate {
  return sfx ? new TitleGate({ dom, sfx }) : new TitleGate({ dom });
}

// ---------------------------------------------------------------------------
// THE HOLE
// ---------------------------------------------------------------------------

describe('the doorway', () => {
  /**
   * THE named gate. The punched field must come out as a RING: covering the hull
   * and the vacuum around it, and NOT covering the doorway. This is the failure
   * that happened twice in design and it is invisible in a passing render.
   */
  it('the doorway is a hole, not a fade', () => {
    for (const view of [DESKTOP, PHONE]) {
      const centre = { x: view.width / 2, y: view.height / 2 };
      const box = doorBox(view);

      // A point at the doorway centre is NOT covered — the menu shows through.
      expect(skyCoversPoint(view, 1, centre)).toBe(false);

      // A point on the HULL is covered: the middle of the jamb's top band, which
      // is inside the door box but outside the opening.
      const hull = { x: centre.x, y: centre.y - box.height / 2 + box.height * DOOR.frame * 0.5 };
      expect(skyCoversPoint(view, 1, hull)).toBe(true);

      // …and so is every one of the door's four sides, which is what makes it a
      // ring rather than a shape with one edge that happens to be right.
      const sides = [
        { x: centre.x, y: centre.y - box.height / 2 + 1 },
        { x: centre.x, y: centre.y + box.height / 2 - 1 },
        { x: centre.x - box.width / 2 + 1, y: centre.y },
        { x: centre.x + box.width / 2 - 1, y: centre.y },
      ];
      for (const p of sides) expect(skyCoversPoint(view, 1, p)).toBe(true);

      // The chamfer proves the shape is the octagon and not its bounding box: a
      // point just inside the opening's corner is OUTSIDE the doorway, so the
      // field still covers it.
      const openW = box.width * OPENING_SCALE;
      const openH = box.height * OPENING_SCALE;
      const corner = { x: centre.x - openW / 2 + 2, y: centre.y - openH / 2 + 2 };
      expect(skyCoversPoint(view, 1, corner)).toBe(true);

      // And the doorway is genuinely open across its whole width, not a slit.
      for (const t of [0.3, 0.5, 0.7]) {
        expect(skyCoversPoint(view, 1, { x: centre.x - openW / 2 + openW * t, y: centre.y })).toBe(false);
      }
    }
  });

  it('erases the opening rather than painting over it', () => {
    // The shortcut that fails is a second filled shape in the ground colour:
    // identical in a screenshot, and a solid lid over the menu. So the punch is
    // asserted to be a `destination-out` fill of the doorway polygon, with the
    // composite mode put back afterwards.
    const ctx = new FakeContext();
    paintSky(ctx, DESKTOP, makeStars(DESKTOP), 0, 1, true);

    const punch = ctx.ops.filter((o) => o.op === 'fill' && o.composite === 'destination-out');
    expect(punch).toHaveLength(1);

    const poly = openingPolygon(DESKTOP, 1);
    const moves = ctx.ops.filter((o) => o.op === 'moveTo') as { x: number; y: number }[];
    const lines = ctx.ops.filter((o) => o.op === 'lineTo') as { x: number; y: number }[];
    const path = [moves[moves.length - 1]!, ...lines.slice(-7)];
    expect(path).toHaveLength(poly.length);
    path.forEach((p, i) => {
      expect(p.x).toBeCloseTo(poly[i]!.x, 6);
      expect(p.y).toBeCloseTo(poly[i]!.y, 6);
    });

    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('stops punching once we are through, and never before', () => {
    const withPunch = new FakeContext();
    paintSky(withPunch, DESKTOP, [], 0, 1, true);
    expect(withPunch.ops.some((o) => o.op === 'fill' && o.composite === 'destination-out')).toBe(true);

    const done = new FakeContext();
    paintSky(done, DESKTOP, [], 0, 1, false);
    expect(done.ops.some((o) => o.op === 'fill' && o.composite === 'destination-out')).toBe(false);
  });

  it('grows the hole with the door, so the menu is never revealed early', () => {
    // Trap 3: the design could jump the punch to its final size because it had a
    // second, identical field behind the menu. Here the punch reveals the real
    // menu, so a hole ahead of the frame IS the cross-dissolve this screen
    // exists to avoid.
    const mid = { x: DESKTOP.width * 0.08, y: DESKTOP.height / 2 };
    expect(skyCoversPoint(DESKTOP, 1, mid)).toBe(true);
    expect(skyCoversPoint(DESKTOP, throughScale(DESKTOP), mid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SILENCE UNTIL THE GESTURE
// ---------------------------------------------------------------------------

describe('audio is armed by the opening press', () => {
  /**
   * THE second named gate. Nothing may sound on load — not a cue, and not an
   * `AudioContext`, whose mere construction is the thing browsers refuse and the
   * thing an autoplay policy logs a warning for.
   */
  it('nothing sounds before the first press', () => {
    const constructed = vi.fn();
    class SpyAudioContext {
      constructor() {
        constructed();
      }
    }
    const globals = globalThis as Record<string, unknown>;
    const priorAudio = globals['AudioContext'];
    const priorWebkit = globals['webkitAudioContext'];
    globals['AudioContext'] = SpyAudioContext;
    globals['webkitAudioContext'] = SpyAudioContext;

    try {
      const cues: GateCue[] = [];
      const dom = new FakeDom();
      const g = gate(dom, (cue) => cues.push(cue));

      g.mount();
      // Everything a title screen does while it waits: paint, resize, paint again.
      dom.tick(16);
      dom.tick(32);
      g.resize();
      dom.tick(48);

      expect(cues).toEqual([]);
      expect(constructed).not.toHaveBeenCalled();
      expect(g.current).toBe('locked');

      // …and the press is what arms it.
      dom.listeners?.press();
      expect(cues).toEqual(['gateUnlock']);
    } finally {
      globals['AudioContext'] = priorAudio;
      globals['webkitAudioContext'] = priorWebkit;
    }
  });

  it('raises one cue per beat, and refuses a second press mid-sequence', () => {
    const cues: GateCue[] = [];
    const dom = new FakeDom();
    const g = gate(dom, (cue) => cues.push(cue));
    g.mount();

    dom.listeners?.press();
    expect(cues).toEqual(['gateUnlock']);

    // A press that lands while the machine is running changes nothing: the beats
    // are a sequence, not a toggle.
    dom.listeners?.press();
    dom.listeners?.enter();
    expect(cues).toEqual(['gateUnlock']);

    dom.advance(3460);
    expect(g.current).toBe('open');
    expect(cues).toEqual(['gateUnlock', 'gateSeated']);
  });

  it('sounds the reseal on ESC, and the lock only once the leaves are home', () => {
    const cues: GateCue[] = [];
    const dom = new FakeDom();
    const g = gate(dom, (cue) => cues.push(cue));
    g.mount();
    dom.listeners?.press();
    dom.advance(3460);
    cues.length = 0;

    dom.listeners?.escape();
    expect(cues).toEqual(['gateReseal']);
    expect(g.current).toBe('returning');

    dom.advance(1460);
    expect(g.current).toBe('closing');

    // The leaves are still travelling: the lock may not throw.
    dom.leafOffset = 220;
    for (let i = 0; i < 40; i++) dom.tick();
    expect(g.current).toBe('closing');
    expect(cues).toEqual(['gateReseal']);

    // They arrive; the lock throws, and only then.
    dom.leafOffset = 0;
    dom.tick();
    expect(g.current).toBe('locked');
    expect(cues).toEqual(['gateReseal', 'gateSealed']);
  });

  it('seals a throttled tab rather than leaving it stuck', () => {
    const dom = new FakeDom();
    const g = gate(dom);
    g.mount();
    dom.listeners?.press();
    dom.advance(3460);
    dom.listeners?.escape();
    dom.advance(1460);

    // A leaf that never reports home — a tab that never ran the transition.
    dom.leafOffset = 900;
    const frames = Math.ceil((SEAL_CAP_MS / 1000) * 60) + 2;
    for (let i = 0; i < frames; i++) dom.tick();
    expect(g.current).toBe('locked');
  });

  it('is silent with no audio module wired at all', () => {
    const dom = new FakeDom();
    const g = gate(dom);
    expect(() => {
      g.mount();
      dom.listeners?.press();
      dom.advance(3460);
      g.dispose();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE FOUR BEATS
// ---------------------------------------------------------------------------

describe('the four beats', () => {
  it('lets the lock finish before a leaf may move', () => {
    // Beat 1 is the whole reason this reads as machinery: nothing else is
    // permitted to move until the rotor has finished its 135°.
    const turning = gateVars('turning', 4);
    expect(turning['--pr-gate-hub-rot']).toBe('135deg');
    expect(turning['--pr-gate-leaf-top']).toBe('translateY(0)');
    expect(turning['--pr-gate-leaf-bot']).toBe('translateY(0)');
    expect(turning['--pr-gate-door-scale']).toBe('1');

    const parting = gateVars('parting', 4);
    expect(parting['--pr-gate-leaf-top']).toBe('translateY(-108%)');
    expect(parting['--pr-gate-leaf-bot']).toBe('translateY(108%)');
    // …and the frame has not begun to grow yet either.
    expect(parting['--pr-gate-door-scale']).toBe('1');
  });

  it('schedules the beats in the handoff order, with the lock alone at the front', () => {
    expect(GATE_OPEN_STEPS.map((s) => s.phase)).toEqual(['turning', 'parting', 'entering', 'open']);
    const at = Object.fromEntries(GATE_OPEN_STEPS.map((s) => [s.phase, s.at]));

    // BEAT 1 IS EXCLUSIVE. The rotor gets its whole transition before a leaf is
    // allowed to move — "nothing else is permitted to move until it has
    // finished" is the sentence that makes this read as machinery.
    expect(at['parting']).toBeGreaterThanOrEqual(TRANSITION.rotor);

    // BEAT 2 IS ALL BUT DONE before the frame starts growing. The overlap is
    // 40ms of a 1020ms travel — the frame picks the leaves up as they settle,
    // which is one continuous machine rather than a pause between two moves. It
    // is bounded here so it can never widen into "the leaves are still visibly
    // moving while the wall flies past".
    const leafOverlap = TRANSITION.leaf - (at['entering']! - at['parting']!);
    expect(leafOverlap).toBeGreaterThanOrEqual(0);
    expect(leafOverlap).toBeLessThan(TRANSITION.leaf * 0.06);

    // BEAT 3 FINISHES BEFORE BEAT 4 STARTS. The frame may not fade while it is
    // still on screen: the 1.5s scale has to complete first, or the fade is the
    // cross-dissolve this whole screen exists to replace.
    expect(at['open']! - at['entering']!).toBeGreaterThanOrEqual(TRANSITION.frame);
  });

  it('only fades the frame once it is through, never during the scale', () => {
    expect(gateVars('entering', 4)['--pr-gate-door-op']).toBe('1');
    expect(gateVars('entering', 4)['--pr-gate-door-scale']).toBe('4');
    expect(gateVars('open', 4)['--pr-gate-door-op']).toBe('0');
  });

  it('reads the reseal backwards rather than playing the open in reverse', () => {
    expect(GATE_RESEAL_STEPS.map((s) => s.phase)).toEqual(['returning', 'closing']);
    // Coming back through: the frame is at rest again, but the leaves are still
    // apart — if they shut on the same tick, every transition runs at once and
    // that is exactly what read as a rewind.
    const returning = gateVars('returning', 4);
    expect(returning['--pr-gate-door-scale']).toBe('1');
    expect(returning['--pr-gate-leaf-top']).toBe('translateY(-108%)');
    // Closing: leaves home, lock still thrown.
    const closing = gateVars('closing', 4);
    expect(closing['--pr-gate-leaf-top']).toBe('translateY(0)');
    expect(closing['--pr-gate-hub-rot']).toBe('135deg');
    // Only `locked` puts the rotor back.
    expect(gateVars('locked', 4)['--pr-gate-hub-rot']).toBe('0deg');
    expect(SEAL_FLOOR_MS).toBeLessThan(SEAL_CAP_MS);
  });

  it('shows the prompt only while the door will answer a press', () => {
    expect(gateVars('locked', 4)['--pr-gate-prompt-op']).toBe('1');
    expect(gateVars('locked', 4)['--pr-gate-cursor']).toBe('pointer');
    for (const phase of ['turning', 'parting', 'entering', 'open', 'returning', 'closing'] as GatePhase[]) {
      expect(gateVars(phase, 4)['--pr-gate-prompt-op']).toBe('0');
      expect(gateVars(phase, 4)['--pr-gate-cursor']).toBe('default');
    }
  });

  it('goes inert once we are through, and hands the screen to the menu', () => {
    const dom = new FakeDom();
    const through = vi.fn();
    const g = new TitleGate({ dom, onThrough: through });
    g.mount();
    expect(dom.visible).toBe(true);

    dom.listeners?.press();
    dom.advance(3460);

    expect(g.current).toBe('open');
    expect(through).toHaveBeenCalledTimes(1);
    // The overlay stops painting and stops taking presses — the Pixi menu is
    // simply what is there — but it is NOT unmounted, because ESC reseals and a
    // door that has been removed cannot come back.
    expect(dom.visible).toBe(false);
    expect(dom.mounted).toBe(true);

    const before = dom.ctx.ops.length;
    dom.tick();
    expect(dom.ctx.ops.length).toBe(before);
  });

  it('takes everything with it when disposed', () => {
    const dom = new FakeDom();
    const g = gate(dom);
    g.mount();
    dom.listeners?.press();
    expect(dom.pending.length).toBeGreaterThan(0);
    g.dispose();
    expect(dom.mounted).toBe(false);
    expect(dom.pending).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GOING THROUGH
// ---------------------------------------------------------------------------

describe('going through', () => {
  it('measures the through-scale from the real window, on both shapes of device', () => {
    for (const view of [DESKTOP, PHONE]) {
      const scale = throughScale(view);
      const box = doorBox(view, scale);
      const openW = box.width * OPENING_SCALE;
      const openH = box.height * OPENING_SCALE;
      // The OPENING — not the door box — must exceed the viewport, so the hull
      // leaves through the edges rather than shrinking into the middle.
      expect(openW).toBeGreaterThan(view.width);
      expect(openH).toBeGreaterThan(view.height);
    }
  });

  it('needs a different factor on a phone than on a desktop', () => {
    // The reason the scale is measured at all: which of `94vw` and `136vh` binds
    // differs, so a fixed factor leaves frame metal on screen on one of them.
    expect(throughScale(PHONE)).not.toBeCloseTo(throughScale(DESKTOP), 2);
  });

  it('cannot ask for an unbounded transform on a degenerate viewport', () => {
    expect(throughScale({ width: 1, height: 1 })).toBeLessThanOrEqual(16);
    expect(throughScale({ width: 0, height: 0 })).toBe(1);
  });

  it('keeps the punch on the door while the door is still growing', () => {
    // The paint reads the door's MEASURED scale, so a frame mid-transition
    // punches a mid-transition hole rather than the one it is heading for.
    const dom = new FakeDom();
    const g = gate(dom);
    g.mount();
    dom.listeners?.press();
    dom.advance(1880);
    expect(g.current).toBe('entering');

    dom.doorScale = 2;
    dom.ctx.ops.length = 0;
    dom.tick();
    const moves = dom.ctx.ops.filter((o) => o.op === 'moveTo') as { x: number }[];
    const expected = openingPolygon(DESKTOP, 2)[0]!;
    expect(moves[moves.length - 1]!.x).toBeCloseTo(expected.x, 6);
  });
});

// ---------------------------------------------------------------------------
// THE TYPE
// ---------------------------------------------------------------------------

describe('the wordmark', () => {
  it('is a token, not a string cut into the door', () => {
    const html = titleGateHtml();
    const { upper, lower } = splitWordmark(GAME_NAME);
    expect(html).toContain(`>${upper}<`);
    expect(html).toContain(`>${lower}<`);
    // What ships is what the browser tab and the manifest already say.
    expect(GAME_NAME).toBe('PLANET RUSH');
  });

  it('splits a renamed game across the two leaves without re-cutting the door', () => {
    expect(splitWordmark('STAR RUSH')).toEqual({ upper: 'STAR', lower: 'RUSH' });
    expect(splitWordmark('PLANET RUSH')).toEqual({ upper: 'PLANET', lower: 'RUSH' });
    expect(splitWordmark('THE LAST CLAIM')).toEqual({ upper: 'THE LAST', lower: 'CLAIM' });
    // A one-word name is cut at its midpoint, heavier half on the upper leaf —
    // not a nice reading, but never an empty leaf.
    expect(splitWordmark('RUSH')).toEqual({ upper: 'RU', lower: 'SH' });
    expect(splitWordmark('  ')).toEqual({ upper: '', lower: '' });
  });

  it('tracks the shorter word out so the two read as one column', () => {
    expect(extraTracking('PLANET', 'RUSH')).toBe(0);
    expect(extraTracking('RUSH', 'PLANET')).toBeGreaterThan(0);
    // Capped, or the letters stop being a word.
    expect(extraTracking('A', 'ABCDEFGHIJKLMNOP')).toBeLessThanOrEqual(0.17);
    // Equal-length words need no correction from length alone.
    expect(extraTracking('STAR', 'RUSH')).toBe(0);
  });
});

describe('the type is struck, not printed', () => {
  it('paints the ramp as a background and therefore outlines with a STROKE', () => {
    // THE trap that made a white title render solid black: with
    // `background-clip:text` the ramp is the element's BACKGROUND, and
    // `text-shadow` paints above a background — so a hard offset shadow lands
    // INSIDE the letters and a transparent fill lets it through.
    const css = titleCss(0.07);
    expect(css).toContain('background-clip:text');
    expect(css).toContain('-webkit-text-fill-color:transparent');
    expect(css).toContain('-webkit-text-stroke');
    expect(css).not.toContain('text-shadow');
  });

  it('glows with a drop-shadow filter, never a text-shadow', () => {
    const css = titleCss(0.07);
    expect(css).toContain('drop-shadow(');
    // A glow as a text-shadow bleeds straight through the transparent fill,
    // which is why the glow colour used to behave like the title colour.
    expect(/text-shadow/.test(css)).toBe(false);
  });

  it('falls back to a flat fill — never an invisible one — without clip support', () => {
    // Where the clip is not applied the fill stays transparent and the only
    // thing left is the outline: a flat title is a compromise, an invisible one
    // is a bug. So the fallback is opaque, and only then may it use shadows.
    const css = titleCss(0.07, false);
    expect(css).not.toContain('background-clip:text');
    expect(css).not.toContain('transparent');
    expect(css).toContain('text-shadow');
    expect(css).toMatch(/color:#[0-9a-f]{6}/);
  });

  it('builds a ramp with real value spread from one hue', () => {
    const [top, mid, bot] = titleRamp();
    const luma = (h: string): number => {
      const n = parseInt(h.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    expect(luma(top)).toBeGreaterThan(luma(mid));
    expect(luma(mid)).toBeGreaterThan(luma(bot));
    // Rotating the gradient angle has to be VISIBLE, which needs spread.
    expect(luma(top) - luma(bot)).toBeGreaterThan(80);
  });

  it('keeps both words on one advance so they cannot drift', () => {
    const css = titleCss(0.24);
    expect(css).toContain('letter-spacing:0.240em');
    // Letter-spacing adds a trailing space; an equal indent cancels it, or the
    // centred word sits one step left of the one above it.
    expect(css).toContain('text-indent:0.240em');
    expect(css).toContain('font-family:Audiowide');
  });
});

// ---------------------------------------------------------------------------
// OFFLINE, AND IN THE FROZEN PALETTE
// ---------------------------------------------------------------------------

describe('the screen ships offline', () => {
  it('reaches no CDN for anything at all', () => {
    // The design file pulls React from unpkg (viewer scaffolding — zero
    // createElement, zero hooks) and its faces from Google. Neither survives.
    const html = titleGateHtml();
    for (const host of ['unpkg', 'googleapis', 'gstatic', 'cdn.', 'http://', 'https://']) {
      expect(html).not.toContain(host);
    }
    expect(html).not.toContain('react');
  });

  it('does not so much as NAME a third-party host, in code or in a comment', () => {
    // The rendered markup being clean is the weaker half of this. The DoD greps
    // the SOURCE — `grep -qiE 'unpkg|googleapis|gstatic' && exit 1` — because a
    // hostname sitting in a comment is one careless copy away from being a URL,
    // and because a screen that has to explain which CDN it does not use has
    // kept the thing it was told to drop. It shipped failing this once: the
    // header prose named both hosts while describing their removal.
    const sources = ['title-gate.ts', 'game-name.ts'].map((file) =>
      readFileSync(resolve(__dirname, file), 'utf8').toLowerCase(),
    );
    for (const source of sources) {
      for (const host of ['unpkg', 'googleapis', 'gstatic']) {
        expect(source, `the source names ${host}`).not.toContain(host);
      }
    }
  });

  it('binds the two ratified faces to the files already in the repo', () => {
    const html = titleGateHtml();
    expect(html).toContain(FONT_URLS.audiowide);
    expect(html).toContain(FONT_URLS.oxanium);
    // Oxanium's default instance is ExtraLight: a face declared without the
    // variable range renders every line of this screen hairline-thin.
    expect(html).toContain('font-weight:200 800');
    // Wordmark in Audiowide, body in Oxanium — never the other way (§7).
    expect(html).toContain('font-family:Audiowide');
    expect(html).toContain('font-family:Oxanium');
  });

  it('spends signal yellow on hazard stripes and nothing else', () => {
    // Style-guide §2: yellow means ore or danger. There is no ore on this
    // screen, so the only yellow allowed is the hazard tape at the leaves'
    // meeting edges — which §2 names in so many words.
    const html = titleGateHtml();
    const yellow = html.match(/242,210,75/g) ?? [];
    expect(yellow).toHaveLength(2); // one hazard band per leaf, and nothing else
    // …and each one is genuinely hazard TAPE — a striped band on the leaves'
    // meeting edge, not an accent that happens to be warm.
    for (const stripe of html.match(/[^"]*rgba\(242,210,75,[^"]*/g) ?? []) {
      expect(stripe).toContain('repeating-linear-gradient');
      expect(stripe).toContain('--pr-gate-haz-op');
    }
    // The design also paints the lock's open-position index mark in it; a
    // position mark is a machine marking rather than a hazard, so it is steel.
    expect(html).toContain('rgba(198,205,214,.5)');
    // Threat red is reserved for damage and alarm; nothing here is either.
    expect(html).not.toContain('#B23A3A');
    expect(html).not.toContain('178,58,58');
  });

  it('is composited over Floor, the ground the star-field belongs on', () => {
    const html = titleGateHtml();
    // a0-40: the shipped stack ran ~5x darker than the design because Floor was
    // `#010204`. It is `#070910` now, and this screen is a star-field.
    expect(html).not.toContain('#010204');
    expect(html).not.toContain('1,2,4');
  });

  it('speaks register 2: it states the action and does not exclaim', () => {
    expect(PROMPT).toBe('PRESS ANYWHERE TO ENTER');
    expect(PROMPT).not.toContain('!');
    // A refusal or an instruction names its subject in the first three words.
    expect(PROMPT.split(' ').slice(0, 3).join(' ')).toBe('PRESS ANYWHERE TO');
  });

  it('mounts one overlay with one canvas, above the game and below nothing', () => {
    const html = titleGateHtml();
    expect(html.match(/<canvas/g)).toHaveLength(1);
    expect(TITLE_GATE_ID).toBe('pr-title-gate');
  });
});

// ---------------------------------------------------------------------------
// THE HULL IS A RING, IN THE MARKUP TOO
// ---------------------------------------------------------------------------

describe('the hull', () => {
  it('is eight ring segments, never one filled box with a hole clipped in it', () => {
    // `clip-path` on a filled element yields a SOLID shape. The jamb is built
    // from segments for the same reason the field is punched rather than
    // clipped, and this is the markup half of that invariant.
    const html = titleGateHtml();
    const jambSegments = html.match(/clip-path:polygon\(0 0,100% 0,90\.54% 100%|clip-path:polygon\(0 100%,100% 100%,90\.54% 0|clip-path:polygon\(0 0,100% 9\.39%|clip-path:polygon\(100% 0,0 9\.39%|clip-path:polygon\(0 80\.7%|clip-path:polygon\(100% 80\.7%|clip-path:polygon\(0 19\.3%|clip-path:polygon\(100% 19\.3%/g);
    expect(jambSegments).toHaveLength(8);
  });

  it('seats sixteen bolts on the ring, tracking the frame at any viewport', () => {
    const html = titleGateHtml();
    expect(html.match(/--pr-gate-bolt-scale/g)).toHaveLength(16);
    // Percentages, so they track the frame rather than floating in space.
    expect(html).not.toMatch(/left:\d+px;top:\d+px;width:min\(19px/);
  });

  it('pulls the bolts and holds the lock the moment the door is unsealed', () => {
    expect(gateVars('locked', 4)['--pr-gate-bolt-scale']).toBe('1');
    expect(gateVars('turning', 4)['--pr-gate-bolt-scale']).toBe('0.84');
    // It is bolted to the leaf and leaves with it — it does not fade out.
    expect(gateVars('parting', 4)['--pr-gate-hub-scale']).toBe('1');
  });

  it('shows the hazard stripes while the door is sealed and drops them once open', () => {
    expect(gateVars('locked', 4)['--pr-gate-haz-op']).toBe('0.5');
    expect(gateVars('turning', 4)['--pr-gate-haz-op']).toBe('1');
    expect(gateVars('parting', 4)['--pr-gate-haz-op']).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// THE PHONE
// ---------------------------------------------------------------------------

describe('a throttled device', () => {
  it('thins the field rather than dropping the punch', () => {
    // The handoff's own reduction — "a single field with the punch dropped" —
    // was right for a prototype with two identical fields. Here the punch is the
    // only thing making the doorway a hole.
    const full = makeStars(PHONE, false);
    const thin = makeStars(PHONE, true);
    expect(thin.length).toBeGreaterThan(0);
    expect(thin.length).toBeLessThan(full.length / 2);
  });

  it('freezes the twinkle but keeps painting while the door is growing', () => {
    expect(fieldAnimates(false, 'locked')).toBe(true);
    expect(fieldAnimates(true, 'locked')).toBe(false);
    // The hole is moving during `entering`, so this one frame band is not
    // optional at any quality tier.
    expect(fieldAnimates(true, 'entering')).toBe(true);
  });

  it('draws the same sky on every engine', () => {
    // `mulberry32`, never `Math.random` (GDD §4.1).
    expect(makeStars(DESKTOP)).toEqual(makeStars(DESKTOP));
  });

  it('lays the door out inside the viewport at every shape', () => {
    for (const view of [DESKTOP, PHONE, { width: 390, height: 844 }]) {
      const box = doorBox(view);
      expect(box.width).toBeLessThanOrEqual(view.width);
      expect(box.height).toBeLessThanOrEqual(view.height);
      expect(box.width / box.height).toBeCloseTo(DOOR.aspect, 6);
    }
  });
});

describe('the geometry itself', () => {
  it('agrees with the CSS about where the opening is', () => {
    // The frame is 9.4% of the box on every side, so the opening is 81.2% of it
    // — quoted once, used by the CSS, the punch and the through-scale alike.
    expect(OPENING_SCALE).toBeCloseTo(1 - 2 * DOOR.frame, 12);
    const poly = openingPolygon(DESKTOP, 1);
    const box = doorBox(DESKTOP);
    const width = Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
    expect(width).toBeCloseTo(box.width * OPENING_SCALE, 6);
  });

  it('reads a convex octagon, and rejects what is outside it', () => {
    const poly = openingPolygon(DESKTOP, 1);
    expect(poly).toHaveLength(8);
    expect(insidePolygon(poly, { x: DESKTOP.width / 2, y: DESKTOP.height / 2 })).toBe(true);
    expect(insidePolygon(poly, { x: 0, y: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NO SECOND SYNTHESISER
// ---------------------------------------------------------------------------

describe('the door names cues; the audio module owns the sound', () => {
  /**
   * The seam is only worth having if there is something behind it. The design
   * file ships a few-hundred-line cue engine of its own, and the whole reason
   * this screen does not is that a second engine means two tone contracts and a
   * `spikes/tone-audit/measure-bank-tone.ts` that measures one of them.
   *
   * So: every `GateCue` this screen can raise is a real slot in the ratified
   * bank, and the two lists are the same list. A cue added on one side and
   * forgotten on the other is a beat of the door that plays nothing.
   */
  it('has a bank slot for every cue it can raise, and no cue for a slot it cannot', () => {
    const raised: GateCue[] = ['gateUnlock', 'gateSeated', 'gateReseal', 'gateSealed'];
    expect([...DOOR_CUE_NAMES].sort()).toEqual([...raised].sort());
    for (const name of DOOR_CUE_NAMES) expect(UI_CUES[name].name).toBe(name);
  });

  it('builds the door out of the same instrument as the rest of the interface', () => {
    // Struck glass over one shared room, and the family's own root — not a
    // parallel palette that happens to be next door in the file.
    expect(UI_CUES.gateSeated.notes.map((n) => n.f)).toEqual([A_FLAT_6, FIFTH_ABOVE, OCTAVE_ABOVE]);
    expect(UI_CUES.gateSeated.notes.every((n) => n.at === 0)).toBe(true);
    // Going back through the door is going backwards, and rule 3 does not stop
    // applying because the control is a whole screen.
    expect(UI_CUES.gateReseal.notes.map((n) => n.f)).toEqual([A_FLAT_6, FOURTH_BELOW]);
    // Every press varies a little, one factor for the whole cue so the intervals
    // stay exact (the handoff's own line).
    for (const name of DOOR_CUE_NAMES) expect(UI_CUES[name].detuned).toBe(true);
  });

  it('makes pressure relief a FILTER that falls, not a tone', () => {
    // "A hiss is not a tone: it is broadband noise whose FILTER falls as the
    // pressure drops." Three stages on the way out, one climbing on the way back.
    const relief = UI_CUES.gateUnlock.air;
    expect(relief).toHaveLength(3);
    for (const stage of relief) {
      expect(stage.band).toBe(true);
      expect(stage.to).toBeDefined();
      expect(stage.to!).toBeLessThan(stage.freq); // falling: the compartment empties
    }
    expect(relief[0]!.freq).toBe(7600);
    expect(relief[0]!.to).toBe(3000);
    expect(relief[0]!.dur).toBeCloseTo(0.2, 6);
    expect(relief[1]!.freq).toBe(4800);
    expect(relief[1]!.to).toBe(620);
    expect(relief[1]!.dur).toBeCloseTo(1.7, 6);

    // Pressure RETURNING climbs, because the air is going back in.
    const back = UI_CUES.gateSealed.air[0]!;
    expect(back.to!).toBeGreaterThan(back.freq);
  });

  it('moves the door’s weight only once the lock has let go of it', () => {
    // The sub is the door's mass. Playing it early is what makes a pressure door
    // read as a sliding panel — so it arrives after the last ratchet detent.
    const detents = UI_CUES.gateUnlock.notes.filter((n) => n.f === RATCHET_HZ);
    expect(detents).toHaveLength(RATCHET_DETENTS);
    const lastDetent = Math.max(...detents.map((n) => n.at));
    const weight = UI_CUES.gateUnlock.sub[0]!;
    expect(weight.at).toBeGreaterThan(lastDetent);
  });

  it('renders every door cue to finite samples inside the set’s own level band', () => {
    for (const name of DOOR_CUE_NAMES) {
      const { dry, send } = renderUiCue(UI_CUES[name], 48000);
      let peak = 0;
      for (const v of dry) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      // Audible, and nowhere near the clamp — the same 0.03–0.30 band the nine
      // ratified cues occupy, so the door does not shout over the interface.
      expect(peak, `${name} peak`).toBeGreaterThan(0.03);
      expect(peak, `${name} peak`).toBeLessThan(0.3);
      expect(send.length).toBe(dry.length);
    }
  });
});

// ---------------------------------------------------------------------------
// THE PHONE'S FLOOR
// ---------------------------------------------------------------------------

describe('two full-screen canvases go behind the auto-reducer (GDD §4.3, risk 5)', () => {
  it('feeds the reducer real frame deltas, and never a first frame with no previous one', () => {
    const seen: number[] = [];
    const dom = new FakeDom();
    const g = new TitleGate({ dom, quality: { sample: (s) => (seen.push(s), false) } });
    g.mount();
    // The first frame has nothing to measure against: a delta computed from zero
    // is a 0 fps frame, and three of those would engage the reducer on a machine
    // that had not yet drawn anything.
    dom.tick(1000);
    expect(seen).toEqual([]);
    dom.tick(1016);
    dom.tick(1032);
    expect(seen).toEqual([0.016, 0.016]);
  });

  it('sheds the twinkle the moment the reducer engages, and gives it back', () => {
    let engaged = false;
    const dom = new FakeDom();
    const g = new TitleGate({ dom, quality: { sample: () => engaged } });
    g.mount();
    dom.tick(16);
    dom.tick(32);
    // Two identical clocks would be indistinguishable, so the assertion is on
    // the field: a still one draws every star at the same place every frame.
    const moving = [snapshotField(dom, 100), snapshotField(dom, 400)];
    expect(moving[0]).not.toEqual(moving[1]);

    engaged = true;
    const still = [snapshotField(dom, 700), snapshotField(dom, 1000)];
    expect(still[0]).toEqual(still[1]);

    engaged = false;
    const again = [snapshotField(dom, 1300), snapshotField(dom, 1600)];
    expect(again[0]).not.toEqual(again[1]);
  });

  it('does not carry the time spent through into the reseal as one slow frame', () => {
    const seen: number[] = [];
    const dom = new FakeDom();
    const g = new TitleGate({ dom, quality: { sample: (s) => (seen.push(s), false) } });
    g.mount();
    dom.tick(16);
    dom.tick(32);
    g.press();
    dom.advance(GATE_OPEN_STEPS[GATE_OPEN_STEPS.length - 1]!.at);
    expect(g.current).toBe('open'); // the loop stopped here
    seen.length = 0;
    g.reseal();
    // A minute on the menu is not a 60-second frame.
    dom.tick(62_000);
    expect(seen).toEqual([]);
    dom.tick(62_016);
    expect(seen).toEqual([0.016]);
  });
});

/** The stars this frame landed on, so "still" and "drifting" are comparable. */
function snapshotField(dom: FakeDom, ms: number): string {
  dom.ctx.ops.length = 0;
  dom.tick(ms);
  return JSON.stringify(dom.ctx.ops.filter((o) => o.op === 'arc'));
}

// ---------------------------------------------------------------------------
// THE DOOR IS MODAL, AND ESCAPE IS NOT ALWAYS THE DOOR'S
// ---------------------------------------------------------------------------

describe('what is behind the door cannot be operated through it', () => {
  it('reports itself modal until we are through, and never again', () => {
    const dom = new FakeDom();
    const g = gate(dom);
    // Not mounted is not modal: nothing is in front of anything.
    expect(g.modal).toBe(false);

    g.mount();
    expect(g.modal).toBe(true);
    g.press();
    for (const step of GATE_OPEN_STEPS) {
      dom.advance(step.at);
      expect(g.modal).toBe(step.phase !== 'open');
    }
    expect(g.current).toBe('open');
    expect(g.modal).toBe(false);

    // …and modal again the moment the door starts coming back, because the menu
    // is once more behind something.
    g.reseal();
    expect(g.modal).toBe(true);

    g.dispose();
    expect(g.modal).toBe(false);
  });

  it('leaves Escape alone on a screen where it already means BACK', () => {
    let atTopLevel = false;
    const dom = new FakeDom();
    const g = new TitleGate({ dom, canReseal: () => atTopLevel });
    g.mount();
    g.press();
    dom.advance(GATE_OPEN_STEPS[GATE_OPEN_STEPS.length - 1]!.at);
    expect(g.current).toBe('open');

    // Settings is open behind the gate: Escape is that screen's BACK, and a door
    // closing over an open panel is the wrong answer to the same key.
    dom.listeners?.escape();
    expect(g.current).toBe('open');

    atTopLevel = true;
    dom.listeners?.escape();
    expect(g.current).toBe('returning');
  });

  it('still reseals with no host opinion at all', () => {
    const dom = new FakeDom();
    const g = gate(dom);
    g.mount();
    g.press();
    dom.advance(GATE_OPEN_STEPS[GATE_OPEN_STEPS.length - 1]!.at);
    dom.listeners?.escape();
    expect(g.current).toBe('returning');
  });
});

// ---------------------------------------------------------------------------
// `?gate=0` — THE HARNESS'S WAY PAST A DOOR BUILT TO BE OPERATED
// ---------------------------------------------------------------------------

describe('?gate=0', () => {
  it('is off by default, and has to be asked for by name', () => {
    // The default is the product: a clean boot gets the door. Every one of these
    // is a boot a player could make, and none of them may lose it.
    for (const search of ['', '?', '?debug=1', '?gate=1', '?gate=', '?gates=0', '?ugate=0']) {
      expect(gateEnabled(search), `"${search}" should still build the door`).toBe(true);
    }
    for (const search of ['?gate=0', 'gate=0', '?debug=1&gate=0', '?gate=0&freeze=1']) {
      expect(gateEnabled(search), `"${search}" should skip the door`).toBe(false);
    }
  });

  it('turns off this screen and nothing else', () => {
    // The narrowness is the point, and it is what separates this from `?debug=1`:
    // a spec that opts out still boots the real menu, the real doors and the real
    // lobby — it just does not have to press through a door on the way. So the
    // flag is read at the MOUNT, not inside the screen, and a gate handed one
    // behaves exactly as a gate always has.
    const source = readFileSync(resolve(__dirname, 'title-gate.ts'), 'utf8');
    const body = source.slice(source.indexOf('export class TitleGate'));
    expect(body).not.toContain('gateEnabled');
    expect(body).not.toContain('location.search');
  });
});
