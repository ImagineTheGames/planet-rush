/**
 * src/ui/hud-geometry.test.ts — the M2 HUD's LAYOUT CONTRACT, headless.
 *
 * QA's `tests/mobile/layout.spec.ts` asserts that every element the app
 * registers sits inside its declared anchor. It can only assert that for
 * elements the frozen golden scene actually *draws* — and the golden scene is a
 * ship two seconds into a match, so the Build & Upgrade wheel is closed, the
 * upgrade panel behind it is closed, and nothing has shot the player's station.
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
  stationHpBounds,
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
  respawnBounds,
  respawnWrapWidth,
  RESPAWN_CENTER_Y,
  wheelRadius,
  wedgeChordWidth,
  wedgeHitTarget,
  TOUCH_TARGET_MIN,
} from './hud-geometry';
import { wheelMetrics } from '../art/materials';
import { buildWheelModel, WHEEL_ORDER } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { buildWedgeLines, capWords, placeWedgeLines, statWords, targetWords, upgradeWedgeLines } from './wheel-stack';
import type { WedgeFace } from './wheel-stack';
import {
  upgradeWheelModel,
  upgradeWheelSlots,
  UPGRADE_LADDER,
  UpgradeTrack,
  WHEEL_TRACK_ORDER,
  STOCK_TIERS,
} from './upgrade-wheel';
import type { UpgradeLadder, UpgradeWheelSignals } from './upgrade-wheel';
import { ShipClass } from '@shared/types';

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

/** The four upgrade tracks (GDD §2.5: power, engine, cargo, hull). */
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

  it('is centred on the screen — where the follow camera puts your station', () => {
    // GDD §2.2: the wheel appears "near your own station". The camera keeps the
    // local ship centred, and the wheel opens only while docked at home, so
    // "near your station" is the screen centre.
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
// The upgrade WHEEL (GDD §2.5) — registered `full`, margin 0
// ---------------------------------------------------------------------------
//
// The upgrade screen was rebuilt from a table-panel into a radial wheel (field
// report v0.2), drawn by the same view as the Build wheel and so occupying the
// same centred `2r` square. Its DRAWN, registry-registered footprint is therefore
// `wheelBounds`, tested here as `upgrade-wheel`.

describe('upgrade-wheel placement', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(wheelBounds(vp.width, vp.height), FULL, vp, 'upgrade-wheel');
    });
  }

  it('shares the Build wheel\'s centred footprint — same component, same square', () => {
    for (const { name, vp } of PROFILES) {
      const b = wheelBounds(vp.width, vp.height);
      expect(b.x + b.width / 2, name).toBeCloseTo(vp.width / 2, 6);
      expect(b.y + b.height / 2, name).toBeCloseTo(vp.height / 2, 6);
    }
  });
});

// The old table-panel geometry (`panelSize`/`panelBounds`/`PANEL_ROW_HEIGHT`)
// still backs the platform pointer hit-test for the upgrade screen
// (`@platform/wheel-input`'s `hitPanel`), pending its companion migration to
// angular `hitWheel` selection now that the screen is radial. It no longer
// describes anything DRAWN, so it is exercised as a plain geometry contract
// rather than a placement one.
describe('upgrade hit-region geometry (legacy panel — platform hit-test)', () => {
  for (const { name, vp } of PROFILES) {
    it(`stays on screen at ${name}`, () => {
      expectWithin(panelBounds(vp.width, vp.height, UPGRADE_ROWS), FULL, vp, 'upgrade-panel');
    });
  }

  it('clamps its width to a narrow phone instead of running off the side', () => {
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
// Your own station's HP (GDD §2.2) — registered `top-right`, margin HUD_PAD
// ---------------------------------------------------------------------------

describe('station-hp placement', () => {
  const TOP_RIGHT: AnchorSpec = { region: 'top-right', margin: HUD_PAD };
  /** Measured width of the widest label the element ever draws ("HOME LOST" at
   *  11px Audiowide ≈ 62px). Generous on purpose: the assertion should survive a
   *  font swap, and the footprint is the union of the label and the bar. */
  const LABEL_WIDTH = 80;

  for (const { name, vp } of PROFILES) {
    it(`stays in the top-right corner at ${name}`, () => {
      expectWithin(stationHpBounds(vp.width, LABEL_WIDTH), TOP_RIGHT, vp, 'station-hp');
    });
  }

  it('hugs the right margin exactly — a corner element, not a floating box', () => {
    for (const { name, vp } of PROFILES) {
      const b = stationHpBounds(vp.width, LABEL_WIDTH);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
      expect(b.y, name).toBeCloseTo(HUD_PAD, 6);
    }
  });

  it('never crosses the half-width line into the left half of the screen', () => {
    // This is the constraint that makes HP_BAR_WIDTH a decision rather than a
    // number. `top-right`'s zone starts at W/2, so the bar's budget is
    // W/2 − HUD_PAD: 144px on the narrowest screen the game claims (GDD §4.3),
    // against a 140px bar. Widen the bar and own-station HP silently leaves its
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

// The own-ship HULL readout that used to stack under HOME was removed (field
// report v0.2 — the over-ship bar is the truth now), so its top-right placement
// block went with it. The corner now carries only `station-hp`, tested above.

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
// The respawn countdown overlay (field request v0.2.2) — `full`, margin PAD
// ---------------------------------------------------------------------------

describe('respawn-countdown placement', () => {
  const FULL_PAD: AnchorSpec = { region: 'full', margin: HUD_PAD };

  /** A worst-case countdown: text wrapped to the widest line the wrap allows,
   *  over enough lines to cover "RESPAWNING N..." breaking on a narrow phone.
   *  Line box ≈ 30px at the countdown's 24px heading type. */
  const worstCase = (vp: Viewport, lines: number): { w: number; h: number } => ({
    w: respawnWrapWidth(vp.width),
    h: lines * 30,
  });

  for (const { name, vp } of PROFILES) {
    it(`stays on screen and inside the HUD margin at ${name}`, () => {
      const { w, h } = worstCase(vp, 2);
      expectWithin(respawnBounds(vp.width, vp.height, w, h), FULL_PAD, vp, 'respawn-countdown');
    });
  }

  it('lands exactly on the HUD margin at the wrap ceiling — the assertion that earns its keep', () => {
    // Same load-bearing check the prompt gets: if the wrap budget ever stops
    // paying for RESPAWN_PAD_X and the stroke, a countdown at the ceiling
    // registers wider than its own anchor zone on the narrowest phone.
    for (const { name, vp } of PROFILES) {
      const b = respawnBounds(vp.width, vp.height, respawnWrapWidth(vp.width), 30);
      expect(b.x, name).toBeCloseTo(HUD_PAD, 6);
      expect(b.x + b.width, name).toBeCloseTo(vp.width - HUD_PAD, 6);
    }
  });

  it('sits dead centre — the death location the camera stays on (field request)', () => {
    // The ship exploded here; a dead ship draws nothing under it, so centre is
    // clear and the overlay owns it.
    expect(RESPAWN_CENTER_Y).toBeCloseTo(0.5, 6);
    for (const { name, vp } of PROFILES) {
      const b = respawnBounds(vp.width, vp.height, 200, 30);
      const cy = b.y + b.height / 2;
      expect(cy, name).toBeCloseTo(vp.height / 2, 6);
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

  it('is not drawn at all once home is on screen — the station is its own tell', () => {
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

// ---------------------------------------------------------------------------
// The wedge, at the narrowest profile with the longest values (u7-02)
// ---------------------------------------------------------------------------
//
// The Gantry/Bone pass puts FOUR lines on a wedge — the name, what it spends on,
// `cost/held`, and the count over its cap — in a radial space that does not grow
// when they do. On a 390 px phone the wheel is 280 px across and one wedge is a
// 72° slice of it, so a line has ~100 px. l2-02 shipped copy that overflowed its
// chrome for exactly this reason, and only the phone profiles caught it.
//
// The oracle below is a *conservative* text metric, not a font: real advance
// widths for Audiowide and Oxanium at these sizes are narrower than these
// constants, so a string that passes here fits on the device with room to spare,
// and the goldens (tests/mobile/goldens.spec.ts) are what confirm the pixels.

/** Upper bound on a glyph's advance, as a fraction of the font size. Measured
 *  generously: Oxanium's widest digits and caps sit near .60em, Audiowide's near
 *  .82em. Tracking is added on top, per glyph, exactly as PixiJS applies it. */
const ADVANCE: Record<WedgeFace, number> = { numeral: 0.6, display: 0.82 };

function textWidth(s: string, size: number, tracking: number, face: WedgeFace): number {
  // The widest LINE of a wrapped string is what has to fit, not the whole string.
  const lines = s.split('\n');
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, line.length * (size * ADVANCE[face] + size * tracking));
  }
  return widest;
}

/**
 * The frame that makes every line as long as it can ever be at once: a
 * late-match hoard (a three-digit spendable total, so every `cost/held` is five
 * characters), every cap full (so every count is its widest), and a station
 * cooling down from a repair (so REPAIR REACTOR draws its longest string, the
 * live two-digit countdown, rather than a comfortable "+15 HP").
 */
const WORST_CASE: BuildWheelSignals = {
  requested: true,
  docked: true,
  shipAlive: true,
  stationAlive: true,
  cargo: 0,
  banked: 999,
  turrets: 4,
  shields: 2,
  satellites: 1,
  coreHp: 40,
  maxCoreHp: 100,
  repairGate: 15,
};

describe('a wedge at 390 px, with its longest values (u7-02)', () => {
  /** The narrowest profile the game claims, held in the play orientation. */
  const PHONE: Viewport = { width: 844, height: 390 };
  const SEGMENTS = WHEEL_ORDER.length;

  /** Walk one wheel's real wedges and assert every drawn line fits the arc AT
   *  ITS OWN RADIUS — the bottom line sits where the wedge is narrowest, which is
   *  the whole reason this exists. */
  function assertWedgesFit(vp: Viewport): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    for (const seg of buildWheelModel(WORST_CASE).segments) {
      const { placed, innerRadius } = placeWedgeLines(buildWedgeLines(seg, m), outer, m);
      for (const line of placed) {
        const budget = wedgeChordWidth(line.radius, SEGMENTS);
        const w = textWidth(line.text, line.size, line.tracking, line.face);
        expect(
          w,
          `${seg.id}/${line.slot}: "${line.text.replace('\n', ' ')}" is ${w.toFixed(0)}px at r=${line.radius.toFixed(0)}, where the wedge is only ${budget.toFixed(0)}px wide`,
        ).toBeLessThanOrEqual(budget);
      }
      // ...and the stack stays in the ring rather than running under the hub.
      expect(innerRadius, `${seg.id}: the stack runs past the hub`).toBeGreaterThanOrEqual(outer * m.hub);
    }
  }

  it('every line of every wedge fits, at the narrowest profile', () => {
    expect(wheelMetrics(wheelRadius(PHONE.width, PHONE.height)).copy).toBe('compact');
    assertWedgesFit(PHONE);
  });

  for (const { name, vp } of PROFILES) {
    it(`[${name}] every line of every wedge fits`, () => {
      assertWedgesFit(vp);
    });
  }

  it('the desktop profile takes the handoff\'s own numbers, not a scaled phone', () => {
    // The look is stated twice on purpose. At a desktop radius the wedge must be
    // drawing the handoff's 17/12/20/12 stack and its full copy — if this drifts,
    // the desktop screen has quietly become an upscaled phone.
    const m = wheelMetrics(wheelRadius(1280, 800));
    expect(m.copy).toBe('full');
    expect(m.name).toBeGreaterThanOrEqual(16);
    expect(m.cost).toBeGreaterThanOrEqual(19);
    const turret = buildWheelModel(WORST_CASE).segments.find((s) => s.id === 'turret')!;
    expect(capWords(turret, m)).toBe('4 / 4 BUILT');
  });

  it('the phone profile keeps the count, and spends the padding instead', () => {
    // What "compact" gives up is characters, never information: the count is
    // still there, and so is the target line — GDD §2.5 makes both load-bearing.
    const m = wheelMetrics(wheelRadius(390, 844));
    const turret = buildWheelModel(WORST_CASE).segments.find((s) => s.id === 'turret')!;
    expect(capWords(turret, m)).toBe('4/4 BUILT');
    expect(targetWords(turret)).toBe('YOUR STATION');
  });
});

describe('a wedge is a touch target first (GDD §2.4)', () => {
  for (const { name, vp } of PROFILES) {
    it(`[${name}] every wedge clears the 48 px floor in both directions`, () => {
      const m = wheelMetrics(wheelRadius(vp.width, vp.height));
      const t = wedgeHitTarget(vp.width, vp.height, WHEEL_ORDER.length, m.hub);
      expect(t.min, `wedge is ${t.arc.toFixed(0)}px of arc by ${t.depth.toFixed(0)}px deep`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_MIN,
      );
    });

    it(`[${name}] the hub BACK disc clears it too`, () => {
      const outer = wheelRadius(vp.width, vp.height);
      const m = wheelMetrics(outer);
      expect(2 * outer * m.hub).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// The UPGRADE wedge, at the narrowest profile with its longest values (u7-06)
// ---------------------------------------------------------------------------
//
// The upgrade wheel is the same radial control and takes the same four-slot
// stack (./wheel-stack), so it takes the same budget — but its hard case is a
// different one. The build wheel's is the count line; this wheel's is the STAT
// line, the densest text on any wheel in the game (`111% → 123%`, two formatted
// values and a glyph on one row), and it sits on this screen because a player
// comparing two upgrades reads it carefully.
//
// Two things make it fit where the build wheel's copy had to go compact, and
// both are worth stating because neither is a law:
//
//  1. the upgrade wheel has FOUR wedges to the build wheel's five, so a wedge is
//     a 90° slice rather than 72° and the arc under the words is wider; and
//  2. the ladder is DATA (`upgradeWheelModel` takes it as a parameter, and
//     p2-03's projectile tracks are due), so wedge count is not fixed.
//
// (2) is why the loop below runs a GROWN ladder as well as today's: the file
// promises new tracks appear "for free", and free has to include still fitting.

/** Every wedge on both levels of the upgrade wheel, for one frame. */
function upgradeWedgesOf(signals: UpgradeWheelSignals, ladder: UpgradeLadder, order: readonly UpgradeTrack[]) {
  return [false, true].flatMap((weaponOpen) => {
    const model = upgradeWheelModel({ ...signals, weaponOpen }, ladder, order);
    const count = upgradeWheelSlots(weaponOpen, ladder, order).length;
    return model.wedges.map((wedge) => ({ wedge, count, level: weaponOpen ? 'weapon' : 'main' }));
  });
}

/**
 * The frame that makes every upgrade line as long as it can be at once: the
 * HAULER (the widest class bases, so the biggest printed values), one tier off
 * the top of every ladder (so both a three-digit current AND a three-digit next
 * are printed side by side), and a late-match three-digit hoard so `cost/held`
 * is at its widest.
 */
const WORST_UPGRADE: UpgradeWheelSignals = {
  open: true,
  weaponOpen: false,
  shipClass: ShipClass.Hauler,
  tiers: {
    [UpgradeTrack.Power]: 2,
    [UpgradeTrack.Engine]: 2,
    [UpgradeTrack.Cargo]: 2,
    [UpgradeTrack.Hull]: 2,
    [UpgradeTrack.Speed]: 1,
  },
  ore: 999,
};

/**
 * Today's ladder with one more standalone track — a **fifth** main-wheel wedge,
 * the same 72° slice the build wheel already runs at every profile. The module
 * header promises new tracks appear "with no change to this file or the view",
 * and free has to include still fitting.
 *
 * ── THE TWO CEILINGS, MEASURED (for whoever grows this next) ────────────────
 * Growth is not unlimited, and the limits are worth writing down here rather
 * than discovering them in a screenshot:
 *
 *  1. **Seven main-wheel wedges.** At 390 px the WEAPON wedge's `OPEN ▸` is
 *     67 px at the phone profile's 16 px cost size, and a seventh of the wheel
 *     is a 59 px arc where that line sits. Six fit; seven needs a compact form
 *     for that line, or paging.
 *  2. **Four weapon tracks.** The WEAPON wedge draws one pip ROW per weapon
 *     track, so the sub-wheel growing pushes the main wheel's `OPEN ▸` inward
 *     to where the arc is narrowest — at four rows it lands at r≈50 on a phone
 *     and runs past it. p2-03's tracks are projectile tracks and so carry the
 *     WEAPON group, which makes this the ceiling that bites first: the third
 *     weapon track is the one to measure again.
 */
const GROWN_LADDER: UpgradeLadder = {
  ...UPGRADE_LADDER,
  ...(Object.fromEntries([
    ['shielding', { ...UPGRADE_LADDER[UpgradeTrack.Hull], label: 'SHIELDING' }],
  ]) as Record<string, unknown>),
} as unknown as UpgradeLadder;

/** The grown walk order: the weapon group stays contiguous and leading, exactly
 *  as `WHEEL_TRACK_ORDER` keeps it, so the collapse still finds one run. */
const GROWN_ORDER = [...WHEEL_TRACK_ORDER, 'shielding'] as unknown as UpgradeTrack[];

/** Tiers for the grown ladder: one off the top of every track, including the new
 *  one, so the longest current→next pair is printed on each. */
const GROWN_TIERS = { ...WORST_UPGRADE.tiers, shielding: 2 } as unknown as Record<string, number>;

describe('an upgrade wedge at 390 px, with its longest values (u7-06)', () => {
  function assertUpgradeWedgesFit(
    vp: Viewport,
    ladder: UpgradeLadder = UPGRADE_LADDER,
    order: readonly UpgradeTrack[] = WHEEL_TRACK_ORDER,
    tiersOver: Record<string, number> = {},
  ): void {
    const outer = wheelRadius(vp.width, vp.height);
    const m = wheelMetrics(outer);
    const signals = { ...WORST_UPGRADE, tiers: { ...WORST_UPGRADE.tiers, ...tiersOver } as never };
    for (const { wedge, count, level } of upgradeWedgesOf(signals, ladder, order)) {
      const { placed, innerRadius } = placeWedgeLines(upgradeWedgeLines(wedge, m), outer, m);
      for (const line of placed) {
        const budget = wedgeChordWidth(line.radius, count);
        const w = textWidth(line.text, line.size, line.tracking, line.face);
        expect(
          w,
          `${level}/${wedge.label}/${line.slot}: "${line.text.replace(/\n/g, ' ')}" is ${w.toFixed(0)}px ` +
            `at r=${line.radius.toFixed(0)}, where a wedge of ${count} is only ${budget.toFixed(0)}px wide`,
        ).toBeLessThanOrEqual(budget);
      }
      expect(
        innerRadius,
        `${level}/${wedge.label}: the stack runs past the hub`,
      ).toBeGreaterThanOrEqual(outer * m.hub);
    }
  }

  for (const { name, vp } of PROFILES) {
    it(`[${name}] every line of every upgrade wedge fits`, () => {
      assertUpgradeWedgesFit(vp);
    });
  }

  for (const { name, vp } of PROFILES) {
    it(`[${name}] still fits when the ladder GROWS by a track (p2-03)`, () => {
      assertUpgradeWedgesFit(vp, GROWN_LADDER, GROWN_ORDER, GROWN_TIERS);
    });
  }

  it('the phone takes the compact stat line, the desktop the padded one', () => {
    // The compact form is what buys the headroom at a grown ladder; both say the
    // same two values, and neither drops one.
    const phone = wheelMetrics(wheelRadius(390, 844));
    const desktop = wheelMetrics(wheelRadius(1280, 800));
    expect(phone.copy).toBe('compact');
    expect(desktop.copy).toBe('full');
    const wedge = upgradeWheelModel({ ...WORST_UPGRADE, tiers: STOCK_TIERS }).wedges.find(
      (w) => w.label === 'ENGINE',
    )!;
    // The HAULER's stock engine (GDD §2.11) and what the first tier buys.
    expect(statWords(wedge, desktop)).toBe('85% → 98%');
    expect(statWords(wedge, phone)).toBe('85%→98%');
  });
});

describe('an upgrade wedge is a touch target first (GDD §2.4)', () => {
  // Both LEVELS: the main wheel's four wedges and the sub-wheel's two. The
  // sub-wheel is the easier case (a 180° slice), but it is a level a thumb lands
  // on during a live fight and so is asserted rather than assumed.
  for (const { name, vp } of PROFILES) {
    for (const weaponOpen of [false, true]) {
      const level = weaponOpen ? 'weapon sub-wheel' : 'main wheel';
      it(`[${name}] every ${level} wedge clears the 48 px floor in both directions`, () => {
        const m = wheelMetrics(wheelRadius(vp.width, vp.height));
        const count = upgradeWheelSlots(weaponOpen).length;
        const t = wedgeHitTarget(vp.width, vp.height, count, m.hub);
        expect(
          t.min,
          `${level}: ${count} wedges, ${t.arc.toFixed(0)}px of arc by ${t.depth.toFixed(0)}px deep`,
        ).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
      });
    }
  }

  it('stays a target if the ladder grows by a track (p2-03)', () => {
    // Five main-wheel wedges — the build wheel's own count. The day a wedge
    // stops clearing the floor is the day the wheel needs paging, and this is
    // where that is found out.
    for (const { name, vp } of PROFILES) {
      const m = wheelMetrics(wheelRadius(vp.width, vp.height));
      const count = upgradeWheelSlots(false, GROWN_LADDER, GROWN_ORDER).length;
      // Five main-wheel wedges: the four of today plus SHIELDING, with the now
      // four-strong weapon run still collapsed into one WEAPON wedge.
      expect(count).toBe(5);
      expect(upgradeWheelSlots(true, GROWN_LADDER, GROWN_ORDER).length).toBe(2);
      const t = wedgeHitTarget(vp.width, vp.height, count, m.hub);
      expect(t.min, `${name}: ${t.arc.toFixed(0)}px arc × ${t.depth.toFixed(0)}px deep`).toBeGreaterThanOrEqual(
        TOUCH_TARGET_MIN,
      );
    }
  });
});
