/**
 * Touch-visuals tests (GDD §2.4, mobile amendment §2; milestone-1 gap #1). Two
 * layers: the pure affordance-visibility *matrix* (what shows, by device + fire
 * mode), and an integration check that the real Pixi layer honours it — the
 * fire-mode switch actually swaps the FIRE button for the aim-zone hint, and the
 * whole layer draws nothing on desktop.
 */
import { describe, it, expect } from 'vitest';
import { Container, Graphics, Text } from 'pixi.js';
import {
  TouchVisuals,
  affordanceVisibility,
  writeAffordanceVisibility,
  affordanceRects,
  buildButtonRect,
  type TouchReadout,
} from './touch-visuals';
import { FireMode } from './actions';
import { TOUCH_CHROME } from './touch-chrome';
import { PALETTE } from '@render/index';
import { DISPLAY_TRACKING, TRACKING, trackingPx } from '../art/materials';
// Across the layer boundary on purpose, and only here: `src/platform/` does not
// import `src/ui/` at runtime, but a TEST may, and this is the one that stops
// the two spellings of the ratified font stacks from drifting apart.
import { FONT_BODY, FONT_HEADING } from '../ui/typography';

// A hand-built readout — TouchController satisfies TouchReadout structurally, but
// tests drive the visuals with plain data (no DOM, no controller).
function readout(over: Partial<TouchReadout> & { mode: FireMode }): TouchReadout {
  return {
    getFireMode: () => over.mode,
    left: over.left ?? { engaged: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } },
    right: over.right ?? { engaged: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } },
    rightButtonEngaged: over.rightButtonEngaged ?? false,
  };
}

function shown(v: TouchVisuals, label: string): boolean {
  const child = v.getChildByLabel(label) as Container | null;
  return !!child && child.visible;
}

describe('affordanceVisibility — the matrix (GDD §2.4)', () => {
  it('desktop shows nothing (no touch affordances at all)', () => {
    for (const mode of [FireMode.Manual, FireMode.AutoAim]) {
      const v = affordanceVisibility(false, mode);
      expect(v).toEqual({ leftStickZone: false, fireButton: false, aimHint: false });
    }
  });

  it('touch + Auto-aim shows the FIRE button (and the left stick zone), not the aim hint', () => {
    const v = affordanceVisibility(true, FireMode.AutoAim);
    expect(v.fireButton).toBe(true);
    expect(v.aimHint).toBe(false);
    expect(v.leftStickZone).toBe(true);
  });

  it('touch + Manual shows the aim-zone hint, not the FIRE button', () => {
    const v = affordanceVisibility(true, FireMode.Manual);
    expect(v.fireButton).toBe(false);
    expect(v.aimHint).toBe(true);
    expect(v.leftStickZone).toBe(true);
  });

  it('the fire-mode switch swaps the right-side affordance (button ⇄ aim hint)', () => {
    const auto = affordanceVisibility(true, FireMode.AutoAim);
    const manual = affordanceVisibility(true, FireMode.Manual);
    expect(auto.fireButton).toBe(true);
    expect(manual.fireButton).toBe(false);
    expect(auto.aimHint).toBe(false);
    expect(manual.aimHint).toBe(true);
  });

  it('writeAffordanceVisibility mutates in place (zero-alloc hot path)', () => {
    const out = { leftStickZone: false, fireButton: false, aimHint: false };
    const ret = writeAffordanceVisibility(true, FireMode.AutoAim, out);
    expect(ret).toBe(out); // same object, not a fresh one
    expect(out.fireButton).toBe(true);
  });
});

describe('TouchVisuals — the Pixi layer honours the matrix', () => {
  it('draws nothing on desktop (whole layer hidden)', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.Manual }), /* isTouch */ false, 1280, 720);
    expect(v.visible).toBe(false);
  });

  it('is visible on a touch device', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(v.visible).toBe(true);
  });

  it('touch + Auto-aim: the FIRE button is shown, the aim hint is not', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(true);
    expect(shown(v, 'aim-hint')).toBe(false);
    expect(shown(v, 'left-stick-zone')).toBe(true);
  });

  it('fire-mode switch swaps the visuals on the live layer (button ⇄ aim hint)', () => {
    const v = new TouchVisuals();

    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(true);
    expect(shown(v, 'aim-hint')).toBe(false);

    // Switch to Manual — the same frame path must swap the affordances.
    v.update(readout({ mode: FireMode.Manual }), true, 1280, 720);
    expect(shown(v, 'fire-button')).toBe(false);
    expect(shown(v, 'aim-hint')).toBe(true);
  });

  it('the idle left ghost hides once a thumb engages the left stick (live base takes over)', () => {
    const v = new TouchVisuals();
    // Idle: ghost visible.
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720);
    expect(shown(v, 'left-stick-zone')).toBe(true);
    // Engaged: ghost gives way to the live base + knob at the landing point.
    v.update(
      readout({
        mode: FireMode.AutoAim,
        left: { engaged: true, origin: { x: 200, y: 600 }, current: { x: 240, y: 600 } },
      }),
      true,
      1280,
      720,
    );
    expect(shown(v, 'left-stick-zone')).toBe(false);
  });

  it('does not throw driving a full Manual engaged frame (knob clamp + placement)', () => {
    const v = new TouchVisuals();
    expect(() =>
      v.update(
        readout({
          mode: FireMode.Manual,
          left: { engaged: true, origin: { x: 150, y: 600 }, current: { x: 400, y: 600 } },
          right: { engaged: true, origin: { x: 1100, y: 600 }, current: { x: 1100, y: 300 } },
        }),
        true,
        1280,
        720,
      ),
    ).not.toThrow();
  });
});

// The anchored affordance rects the layout registry reads (touch controls are
// Platform-owned, so these register with precise, self-computed bounds).
describe('affordanceRects — anchored home rects for the layout registry', () => {
  it('yields nothing on desktop', () => {
    const r = affordanceRects(false, FireMode.AutoAim, 1280, 720);
    expect(r).toEqual({ leftStickZone: null, aimZone: null, fireButton: null });
  });

  it('touch + Auto-aim: left stick zone + FIRE button, no aim zone', () => {
    const r = affordanceRects(true, FireMode.AutoAim, 1280, 720);
    expect(r.leftStickZone).not.toBeNull();
    expect(r.fireButton).not.toBeNull();
    expect(r.aimZone).toBeNull();
    // FIRE button sits in the bottom-right (right half, lower band).
    expect(r.fireButton!.x).toBeGreaterThan(1280 / 2);
    expect(r.fireButton!.y + r.fireButton!.height).toBeLessThanOrEqual(720);
  });

  it('touch + Manual: left stick zone + aim zone, no FIRE button', () => {
    const r = affordanceRects(true, FireMode.Manual, 1280, 720);
    expect(r.leftStickZone).not.toBeNull();
    expect(r.aimZone).not.toBeNull();
    expect(r.fireButton).toBeNull();
    // Left zone in the left half, aim zone in the right half.
    expect(r.leftStickZone!.x).toBeLessThan(1280 / 2);
    expect(r.aimZone!.x).toBeGreaterThan(1280 / 2 - r.aimZone!.width);
  });
});

describe('the BUILD button — the touch E-equivalent (GDD §2.4, §2.5)', () => {
  it('is absent on desktop, where the key is the binding', () => {
    expect(buildButtonRect(false, true, 1280, 720)).toBeNull();
  });

  it('appears only at your own station — docked is the whole rule (GDD §2.5)', () => {
    expect(buildButtonRect(true, false, 1280, 720)).toBeNull();
    expect(buildButtonRect(true, true, 1280, 720)).not.toBeNull();
  });

  it('is thumb-scale (≥72px across) and stays on screen', () => {
    const r = buildButtonRect(true, true, 390, 720)!;
    expect(r.width).toBeGreaterThanOrEqual(72);
    expect(r.height).toBeGreaterThanOrEqual(72);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    expect(r.y + r.height).toBeLessThanOrEqual(720);
  });

  it('sits clear of the left stick zone it stands above', () => {
    const build = buildButtonRect(true, true, 1280, 720)!;
    const stick = affordanceRects(true, FireMode.AutoAim, 1280, 720).leftStickZone!;
    expect(build.y + build.height).toBeLessThanOrEqual(stick.y);
  });

  it('the four controls kept their footprints — a re-skin may not shrink a thumb target', () => {
    // a0-23 changed what the controls are painted in and nothing about where
    // they are or how big they are. These are the numbers QA's placement suite
    // and tests/mobile/build-flow.spec.ts both mirror; `R_BUILD` in particular
    // is a layout contract rather than a drawing detail (theme-coverage §6).
    const w = 844;
    const h = 390;
    const rects = affordanceRects(true, FireMode.AutoAim, w, h);
    expect(rects.leftStickZone).toEqual({ x: 28, y: 234, width: 128, height: 128 });
    expect(rects.fireButton).toEqual({ x: 732, y: 278, width: 84, height: 84 });
    expect(affordanceRects(true, FireMode.Manual, w, h).aimZone).toEqual({
      x: 688,
      y: 234,
      width: 128,
      height: 128,
    });
    expect(buildButtonRect(true, true, w, h)).toEqual({ x: 54, y: 140, width: 76, height: 76 });
  });

  it('the Pixi layer shows it only while docked, and where the rect says', () => {
    const v = new TouchVisuals();
    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720, /* docked */ false);
    expect(shown(v, 'build-button')).toBe(false);

    v.update(readout({ mode: FireMode.AutoAim }), true, 1280, 720, /* docked */ true);
    expect(shown(v, 'build-button')).toBe(true);
    const node = v.getChildByLabel('build-button')!;
    const rect = buildButtonRect(true, true, 1280, 720)!;
    expect(node.x).toBeCloseTo(rect.x + rect.width / 2);
    expect(node.y).toBeCloseTo(rect.y + rect.height / 2);
  });
});

// ===========================================================================
// The thumb controls do not wear plasma (a0-23)
// ===========================================================================
//
// The developer, from two phone captures of the live build: *"look at blue
// buttons, not matching theme"*. The audit found all four controls drawn in
// plasma — the hue the match needs for energy, shields, the mining torch and
// weapon fire — so the player's own furniture was the same blue as the shield
// standing in front of an enemy reactor.
//
// These tests walk what the layer ACTUALLY draws rather than what it says it
// draws: every fill and every stroke recorded in each Graphics' context, and
// every Text style in the tree. A golden cannot do this — it shows a reviewer
// that a button looks fine, not that it is `BONE.hi` and not a hand-picked
// white — and `src/art/compliance.test.ts` cannot either, because it walks the
// sprite IR and never sees a view (theme-coverage §1).

interface DrawnStyle {
  color: number;
  alpha: number;
}

/** Every fill/stroke tone recorded in a Graphics' own context. */
function tonesOf(g: Graphics): DrawnStyle[] {
  return g.context.instructions
    .map((ins) => (ins.data as { style?: { color?: number; alpha?: number } }).style)
    .filter((s): s is { color: number; alpha: number } => typeof s?.color === 'number')
    .map((s) => ({ color: s.color, alpha: s.alpha ?? 1 }));
}

/** Walk the whole layer: every tone painted by every Graphics under it. */
function allTones(root: Container): DrawnStyle[] {
  const out: DrawnStyle[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Graphics) out.push(...tonesOf(node));
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}

/** Every Text in the tree, by its string. */
function textsOf(root: Container): Text[] {
  const out: Text[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Text) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}

/** A layer with every affordance built and both contextual controls on screen. */
function fullyDrawn(): TouchVisuals {
  const v = new TouchVisuals();
  v.update(
    readout({
      mode: FireMode.AutoAim,
      left: { engaged: true, origin: { x: 120, y: 300 }, current: { x: 150, y: 300 } },
      rightButtonEngaged: true,
    }),
    true,
    844,
    390,
    /* docked */ true,
  );
  return v;
}

describe('the touch controls are off plasma and on the Bone ramp (a0-23)', () => {
  it('paints no plasma anywhere in the layer', () => {
    for (const tone of allTones(fullyDrawn())) {
      expect(tone.color, 'a thumb control is wearing the energy hue').not.toBe(PALETTE.plasma);
    }
  });

  it('spends no RESERVED hue either — those mean ore and danger (style-guide §2)', () => {
    for (const tone of allTones(fullyDrawn())) {
      expect(tone.color).not.toBe(PALETTE.signalYellow);
      expect(tone.color).not.toBe(PALETTE.threatRed);
    }
  });

  it('paints ONLY declared chrome tones — a hand-picked hex cannot get in', () => {
    const allowed = new Set<number>(Object.values(TOUCH_CHROME));
    for (const tone of allTones(fullyDrawn())) {
      expect(allowed, `undeclared tone #${tone.color.toString(16)}`).toContain(tone.color);
    }
  });

  it('draws every word in a ratified tone, on a ratified face, at ratified tracking', () => {
    const texts = textsOf(fullyDrawn());
    expect(texts.map((t) => t.text).sort()).toEqual(['& UPGRADE', 'BUILD', 'FIRE']);
    for (const t of texts) {
      expect([TOUCH_CHROME.label, TOUCH_CHROME.sub]).toContain(Number(t.style.fill));
      expect(t.style.letterSpacing, `${t.text} still carries a flat letterSpacing`).toBeGreaterThan(0);
    }

    // The two words a thumb presses take the display face and its own tracking
    // axis; the sub-line is body copy and takes the label tier. Both spelled as
    // `trackingPx(...)` rather than as a bare number, so a size change carries
    // its tracking with it (materials.ts).
    const fire = texts.find((t) => t.text === 'FIRE')!;
    const build = texts.find((t) => t.text === 'BUILD')!;
    const sub = texts.find((t) => t.text === '& UPGRADE')!;
    expect(fire.style.fontFamily).toBe(FONT_HEADING);
    expect(build.style.fontFamily).toBe(FONT_HEADING);
    expect(sub.style.fontFamily).toBe(FONT_BODY);
    expect(fire.style.letterSpacing).toBeCloseTo(
      trackingPx(DISPLAY_TRACKING.heading, fire.style.fontSize as number),
    );
    expect(build.style.letterSpacing).toBeCloseTo(
      trackingPx(DISPLAY_TRACKING.heading, build.style.fontSize as number),
    );
    expect(sub.style.letterSpacing).toBeCloseTo(trackingPx(TRACKING.label, sub.style.fontSize as number));
  });

  it('keeps `& UPGRADE` — a player who does not know upgrades exist never looks for them', () => {
    expect(textsOf(fullyDrawn()).map((t) => t.text)).toContain('& UPGRADE');
  });

  it('BUILD announces itself by darkening, not by glowing (the plasma haloes are gone)', () => {
    const v = fullyDrawn();
    const build = v.getChildByLabel('build-button') as Container;
    const halo = build.children[0] as Graphics;
    const tones = tonesOf(halo);
    expect(tones.length).toBeGreaterThan(0);
    for (const t of tones) expect(t.color).toBe(PALETTE.vacuum);
  });

  it('the primary reads brighter than the always-there action — brightness, not hue', () => {
    // FIRE and BUILD can legitimately share a screen. The rule "never a second
    // bright plate" is kept by the HALO, which exactly one control ever carries,
    // not by dimming FIRE — a dim always-available control is the gray-active
    // button `src/ui/button-theme` exists to forbid.
    const v = fullyDrawn();
    const build = v.getChildByLabel('build-button') as Container;
    const fire = v.getChildByLabel('fire-button') as Container;
    const brightest = (c: Container): number =>
      Math.max(...allTones(c).filter((t) => t.color === TOUCH_CHROME.rimLit).map((t) => t.alpha));
    expect(brightest(build)).toBeGreaterThanOrEqual(brightest(fire));
    expect(brightest(fire)).toBeGreaterThanOrEqual(0.85); // …and FIRE never dims
  });
});

describe('the frame path still draws nothing (GDD §4.3)', () => {
  it('a press changes alpha, not geometry — no clear() in update()', () => {
    const v = new TouchVisuals();
    const frame = (pressed: boolean): void => {
      v.update(readout({ mode: FireMode.AutoAim, rightButtonEngaged: pressed }), true, 844, 390, true);
    };

    frame(false);
    const before = allTones(v).length;
    const release = allTones(v).map((t) => `${t.color}@${t.alpha}`).join('|');

    frame(true);
    expect(allTones(v).length, 'a press rebuilt geometry').toBe(before);
    expect(allTones(v).map((t) => `${t.color}@${t.alpha}`).join('|')).toBe(release);

    // What DID change: the pressed overlay's node alpha, and the button's give.
    const fire = v.getChildByLabel('fire-button') as Container;
    const press = fire.children[1] as Graphics;
    expect(press.alpha).toBeGreaterThan(0);
    expect(fire.scale.x).toBeCloseTo(0.94);

    frame(false);
    expect(press.alpha).toBe(0);
    expect(fire.scale.x).toBeCloseTo(1);
  });

  it('a hundred frames add no instructions to any Graphics in the layer', () => {
    const v = fullyDrawn();
    const before = allTones(v).length;
    for (let i = 0; i < 100; i++) {
      v.update(
        readout({
          mode: FireMode.Manual,
          left: { engaged: true, origin: { x: 120, y: 300 }, current: { x: 120 + i, y: 300 } },
          right: { engaged: true, origin: { x: 700, y: 300 }, current: { x: 700, y: 300 - i } },
        }),
        true,
        844,
        390,
        true,
      );
    }
    expect(allTones(v).length).toBe(before);
  });
});
