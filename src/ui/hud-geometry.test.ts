/**
 * src/ui/hud-geometry.test.ts — the M2 HUD's LAYOUT CONTRACT, headless.
 *
 * QA's `tests/mobile/layout.spec.ts` asserts that every element the app
 * registers sits inside its declared anchor. It can only assert that for
 * elements the frozen golden scene actually *draws* — and the golden scene is a
 * ship two seconds into a match, so the Build & Upgrade wheel is closed, the
 * upgrade panel behind it is closed, and nothing has shot the player's planet.
 * The three loudest M2 elements are therefore invisible to it.
 *
 * This file closes that hole from the other side: it takes the same geometry the
 * views draw with ({@link ./hud-geometry}), resolves the same anchor zones the
 * registry publishes (`resolveAnchor`), and applies the registry's own
 * containment test (`rectContains`) — across every device profile in QA's matrix,
 * in both orientations. Same "should" geometry, same verdict function, no Pixi.
 *
 * If one of these fails, the element is out of its anchor on a real phone; the
 * fix is the element's placement or (argued, in `Hud.describeLayout`) its anchor
 * — never the tolerance.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnchor, rectContains } from '@platform/layout-registry';
import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
import { homeArrow, ARROW_EDGE_INSET } from './alarm';
import {
  wheelBounds,
  panelBounds,
  panelSize,
  planetHpBounds,
  alarmFrameBounds,
  arrowPoly,
  polyBounds,
  ARROW_SIZE,
  PANEL_MAX_WIDTH,
  PANEL_EDGE_PAD,
  HUD_PAD,
  HP_BAR_WIDTH,
  HP_BAR_TOP,
  SHIELD_BAR_HEIGHT,
  promptBounds,
  promptWrapWidth,
  PROMPT_CENTER_Y,
} from './hud-geometry';

// ---------------------------------------------------------------------------
// The device matrix — QA's playwright.config.ts profiles, both orientations,
// plus two narrow phones the matrix does not cover but real players carry.
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/portrait', vp: { width: 390, height: 844 } },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 } },
  { name: 'pixel/portrait', vp: { width: 412, height: 915 } },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 } },
  { name: 'desktop', vp: { width: 1280, height: 800 } },
  // Not in the emulation matrix; the smallest screens the game claims to run on
  // (GDD §4.3 "mobile-browser playability"). A thumb-scale overlay has to hold
  // here too, and the panel's viewport clamp exists because of this row.
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 } },
  { name: 'small/portrait', vp: { width: 320, height: 568 } },
];

/** The four upgrade tracks (GDD §2.5: beam, engine, cargo, hull). */
const UPGRADE_ROWS = 4;

const FULL: AnchorSpec = { region: 'full', margin: 0 };

const fmt = (r: Rect): string =>
  `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;

/** The registry's own verdict, with its own resolver — not a re-implementation. */
function withinAnchor(bounds: Rect, anchor: AnchorSpec, vp: Viewport): boolean {
  return rectContains(resolveAnchor(anchor, vp), bounds);
}

function expectWithin(bounds: Rect, anchor: AnchorSpec, vp: Viewport, label: string): void {
  const zone = resolveAnchor(anchor, vp);
  expect(
    withinAnchor(bounds, anchor, vp),
    `${label}: bounds ${fmt(bounds)} escape "${anchor.region}" zone ${fmt(zone)} ` +
      `for viewport ${vp.width}×${vp.height}`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// The Build & Upgrade wheel (GDD §2.5) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('build-wheel placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(wheelBounds(vp.width, vp.height), FULL, vp, 'build-wheel');
    });
  }

  it('is centred on the screen — where the follow camera puts your planet', () => {
    // GDD §2.2: the wheel appears "near your own planet". The camera keeps the
    // local ship centred, and the wheel opens only while docked at home, so
    // "near your planet" is the screen centre.
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      expect(b.x + b.width / 2, name).toBeCloseTo(vp.width / 2, 6);
      expect(b.y + b.height / 2, name).toBeCloseTo(vp.height / 2, 6);
    }
  });

  it('is a thumb-scale target on every phone — never a pinprick, never the screen', () => {
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      const shortSide = Math.min(vp.width, vp.height);
      // Big enough to hit with a thumb…
      expect(b.width, `${name} too small`).toBeGreaterThanOrEqual(200);
      // …and never so big it swallows the shorter screen dimension whole.
      expect(b.width, `${name} too big`).toBeLessThan(shortSide);
    }
  });
});

// ---------------------------------------------------------------------------
// The upgrade panel (GDD §2.5) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('upgrade-panel placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(panelBounds(vp.width, vp.height, UPGRADE_ROWS), FULL, vp, 'upgrade-panel');
    });
  }

  it('clamps its width to a narrow phone instead of running off the side', () => {
    // A fixed 360px stat table is wider than a 320px phone. The panel is the
    // ONLY place ship stats appear (GDD §2.5) — a row the player cannot read is
    // a spending decision they cannot make.
    const narrow = panelSize(320, 568, UPGRADE_ROWS);
    expect(narrow.width).toBe(320 - 2 * PANEL_EDGE_PAD);
    expect(narrow.width).toBeLessThan(PANEL_MAX_WIDTH);
  });

  it('never exceeds its readable maximum on a desktop', () => {
    expect(panelSize(2560, 1440, UPGRADE_ROWS).width).toBe(PANEL_MAX_WIDTH);
  });

  it('grows by exactly one row height per upgrade track', () => {
    const four = panelSize(1280, 800, 4).height;
    const five = panelSize(1280, 800, 5).height;
    expect(five - four).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Your own planet's HP (GDD §2.2) — registered `top-right`, margin HUD_PAD
// ---------------------------------------------------------------------------

describe('planet-hp placement', () => {
  const TOP_RIGHT: AnchorSpec = { region: 'top-right', margin: HUD_PAD };
  /** Measured width of the widest label the element ever draws ("HOME LOST" at
   *  11px Audiowide ≈ 62px). Generous on purpose: the assertion should survive a
   *  font swap, and the footprint is the union of the label and the bar. */
  const LABEL_WIDTH = 80;

  for (const { name, vp } of PROFILES) {
    it(`stays in the top-right corner at ${name}`, () => {
      expectWithin(planetHpBounds(vp.width, LABEL_WIDTH), TOP_RIGHT, vp, 'planet-hp');
    });
  }

  it('hugs the right margin exactly — a corner element, not a floating box', () => {
    for (const { name, vp } of PROFILES) {
      const b = planetHpBounds(vp.width, LABEL_WIDTH);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
      expect(b.y, name).toBeCloseTo(HUD_PAD, 6);
    }
  });

  it('never crosses the half-width line into the left half of the screen', () => {
    // This is the constraint that makes HP_BAR_WIDTH a decision rather than a
    // number. `top-right`'s zone starts at W/2, so the bar's budget is
    // W/2 − HUD_PAD: 144px on the narrowest screen the game claims (GDD §4.3),
    // against a 140px bar. Widen the bar and own-planet HP silently leaves its
    // anchor — and because the day-2 HUD fields are not fed at runtime yet, QA's
    // layout contract cannot see it happen. This assertion is that guard.
    const narrowest = Math.min(...PROFILES.map((p) => p.vp.width));
    expect(narrowest).toBe(320);
    expect(HP_BAR_WIDTH).toBeLessThanOrEqual(narrowest / 2 - HUD_PAD);
  });

  it('leaves room for the shield overbar above the core bar', () => {
    // The shield overbar is drawn SHIELD_BAR_HEIGHT + 2 above the core bar's top
    // edge; that has to stay below the label, i.e. inside the element's own
    // footprint rather than poking out above y = HUD_PAD.
    expect(SHIELD_BAR_HEIGHT + 2).toBeLessThanOrEqual(HP_BAR_TOP);
  });
});

// ---------------------------------------------------------------------------
// The onboarding prompt (GDD §2.10) — registered `full`, margin HUD_PAD
// ---------------------------------------------------------------------------

describe('onboarding placement', () => {
  const FULL_PAD: AnchorSpec = { region: 'full', margin: HUD_PAD };

  /** A worst-case prompt: text wrapped to the widest line the wrap allows, over
   *  enough lines to cover the longest authored string on the narrowest phone.
   *  Line box ≈ 20px at the prompt's 16px heading type. */
  const worstCase = (vp: Viewport, lines: number): { w: number; h: number } => ({
    w: promptWrapWidth(vp.width),
    h: lines * 20,
  });

  for (const { name, vp } of PROFILES) {
    it(`stays on screen and inside the HUD margin at ${name}`, () => {
      const { w, h } = worstCase(vp, 4);
      expectWithin(promptBounds(vp.width, vp.height, w, h), FULL_PAD, vp, 'onboarding');
    });
  }

  it('lands exactly on the HUD margin at the wrap ceiling — the assertion that earns its keep', () => {
    // The prompt claims `full` + PAD *because* it is wrapped to fit it. If the
    // wrap budget ever stops paying for PROMPT_PAD_X and the stroke, a prompt
    // whose text reaches the ceiling registers wider than its own anchor zone —
    // and it is the longest prompt on the narrowest phone that would do it, the
    // one case least likely to be looked at by eye.
    for (const { name, vp } of PROFILES) {
      const b = promptBounds(vp.width, vp.height, promptWrapWidth(vp.width), 20);
      expect(b.x, name).toBeCloseTo(HUD_PAD, 6);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
    }
  });

  it('sits below the ship it is talking about, and clear of the controls strip', () => {
    // GDD §2.10's prompts point at the ship and the world; a panel drawn over the
    // centre would cover the thing it names. PROMPT_CENTER_Y is below centre —
    // and still clear of the bottom edge once the panel has height.
    expect(PROMPT_CENTER_Y).toBeGreaterThan(0.5);
    for (const { name, vp } of PROFILES) {
      const b = promptBounds(vp.width, vp.height, promptWrapWidth(vp.width), 4 * 20);
      expect(b.y, name).toBeGreaterThan(vp.height / 2);
      expect(b.y + b.height, name).toBeLessThanOrEqual(vp.height - HUD_PAD);
    }
  });

  it('is wider than any band the vocabulary offers — which is why it is `full`', () => {
    // The same test the wheel gets, for the same reason: if a sentence ever does
    // fit a third-width band, revisit the anchor instead of keeping `full`.
    for (const { name, vp } of PROFILES) {
      const b = promptBounds(vp.width, vp.height, promptWrapWidth(vp.width), 20);
      const centerZone = resolveAnchor({ region: 'center', margin: HUD_PAD }, vp);
      expect(b.width, name).toBeGreaterThan(centerZone.width);
    }
  });
});

// ---------------------------------------------------------------------------
// The under-attack alarm frame (GDD §2.2) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('alarm-frame placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`frames the whole screen and nothing outside it at ${name}`, () => {
      const b = alarmFrameBounds(vp.width, vp.height);
      expectWithin(b, FULL, vp, 'alarm-frame');
      // It is a *screen* frame: flush with all four edges, not a box inside one.
      expect(b.x).toBeCloseTo(0, 6);
      expect(b.y).toBeCloseTo(0, 6);
      expect(b.width).toBeCloseTo(vp.width, 6);
      expect(b.height).toBeCloseTo(vp.height, 6);
    });
  }
});

// ---------------------------------------------------------------------------
// The screen-edge arrow home (GDD §2.2) — registered `full`, margin 0
// ---------------------------------------------------------------------------

describe('alarm-arrow placement', () => {
  /** Home in 32 directions, far enough out that the arrow is always clamped to
   *  an edge — the case the element exists for. */
  const DIRECTIONS = Array.from({ length: 32 }, (_, i) => (i * Math.PI * 2) / 32);
  const FAR = 4000;

  for (const { name, vp } of PROFILES) {
    it(`never leaves the screen at ${name}, from any direction`, () => {
      const ship = { x: 0, y: 0 };
      for (const angle of DIRECTIONS) {
        const home = { x: Math.cos(angle) * FAR, y: Math.sin(angle) * FAR };
        const arrow = homeArrow(ship, home, vp, ARROW_EDGE_INSET);
        expect(arrow.onScreen, `${name} @${angle.toFixed(2)}rad`).toBe(false);
        const b = polyBounds(arrowPoly(arrow, ARROW_SIZE));
        expectWithin(b, FULL, vp, `alarm-arrow @${angle.toFixed(2)}rad`);
      }
    });
  }

  it('clears the safe-area inset by its own tip length, so a notch never eats it', () => {
    // The arrow is clamped ARROW_EDGE_INSET from each edge and its tip reaches
    // ARROW_SIZE past that anchor — the inset has to cover the tip or the point
    // of the triangle lands under a notch / home indicator (alarm.ts).
    expect(ARROW_EDGE_INSET).toBeGreaterThan(ARROW_SIZE);
  });

  it('is not drawn at all once home is on screen — the planet is its own tell', () => {
    const vp: Viewport = { width: 844, height: 390 };
    const arrow = homeArrow({ x: 0, y: 0 }, { x: 20, y: 10 }, vp, ARROW_EDGE_INSET);
    expect(arrow.onScreen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The overlays do not collide with the anchors they are NOT claiming
// ---------------------------------------------------------------------------

describe('anchor honesty', () => {
  it('the wheel genuinely cannot fit a third-width band — which is why it is `full`', () => {
    // Documented in Hud.describeLayout: `center`/`top-center` zones are one
    // third of the viewport wide. A thumb-scale radial menu is wider than that
    // on every phone, so `full` is the honest region — not a convenience.
    // If this ever stops being true, revisit the anchor rather than keep `full`.
    const vp: Viewport = { width: 390, height: 844 };
    const centerZone = resolveAnchor({ region: 'center', margin: 0 }, vp);
    expect(wheelBounds(vp.width, vp.height).width).toBeGreaterThan(centerZone.width);
  });

  it('the alarm frame is by definition the whole viewport', () => {
    const vp: Viewport = { width: 412, height: 915 };
    const full = resolveAnchor(FULL, vp);
    const b = alarmFrameBounds(vp.width, vp.height);
    expect(b.width).toBeCloseTo(full.width, 6);
    expect(b.height).toBeCloseTo(full.height, 6);
  });
});
