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
import { hudMetrics, hudType } from './instrument';
import { collapsedRect } from './minimap';
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
  promptBand,
  promptPad,
  promptWrapWidth,
  PROMPT_MIN_TEXT_WIDTH,
  PROMPT_STRIP_RESERVE,
  PROMPT_THUMB_COLUMN,
  respawnBounds,
  respawnWrapWidth,
  RESPAWN_CENTER_Y,
} from './hud-geometry';

// ---------------------------------------------------------------------------
// The device matrix — QA's playwright.config.ts profiles, both orientations,
// plus two narrow phones the matrix does not cover but real players carry.
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
  /** What this profile IS, for the assertions whose answer depends on the device
   *  rather than only on the viewport: the phones carry thumb sticks and no
   *  controls strip, the desktop carries the strip and no sticks (GDD §2.2/§2.4). */
  readonly isTouch: boolean;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/portrait', vp: { width: 390, height: 844 }, isTouch: true },
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, isTouch: true },
  { name: 'pixel/portrait', vp: { width: 412, height: 915 }, isTouch: true },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 }, isTouch: true },
  { name: 'desktop', vp: { width: 1280, height: 800 }, isTouch: false },
  // Not in the emulation matrix; the smallest screens the game claims to run on
  // (GDD §4.3 "mobile-browser playability"). A thumb-scale overlay has to hold
  // here too, and the panel's viewport clamp exists because of this row.
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 }, isTouch: true },
  { name: 'small/portrait', vp: { width: 320, height: 568 }, isTouch: true },
  // …and the same device the way the landscape lock actually hands it over. This
  // is the one row in the matrix where the bottom band cannot hold a prompt; the
  // degradation is asserted by name below rather than left to be discovered.
  { name: 'small/landscape', vp: { width: 568, height: 320 }, isTouch: true },
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

  /** Both device answers, because the band is different on each: desktop reserves
   *  the controls strip at the bottom, touch reserves the thumb columns at the
   *  sides. A prompt verified on one says nothing about the other. */
  const DEVICES: readonly { name: string; isTouch: boolean }[] = [
    { name: 'desktop-input', isTouch: false },
    { name: 'touch', isTouch: true },
  ];

  /** One line box of prompt type at this viewport — the HUD's own scaled 16px
   *  heading, times the ~1.3 leading Pixi lays a Text out with. Derived rather
   *  than pinned at 20, because the whole point of the frame scale is that a
   *  phone's prompt is smaller and the band arithmetic has to see that. */
  const lineBox = (vp: Viewport): number =>
    Math.ceil(hudType(16, hudMetrics(vp.width, vp.height)) * 1.3);

  /** The band's legibility floor: the narrowest it is ever allowed to be, however
   *  much of the screen the wheel, the sticks and the map have already taken. */
  const floorWidth = (vp: Viewport): number =>
    PROMPT_MIN_TEXT_WIDTH + promptPad(vp.width, vp.height).x;

  /** A worst-case prompt: text wrapped to the widest line the wrap allows, over
   *  enough lines to cover the longest authored string on the narrowest phone. */
  const worstCase = (vp: Viewport, isTouch: boolean, lines: number): { w: number; h: number } => ({
    w: promptWrapWidth(vp.width, vp.height, isTouch),
    h: lines * lineBox(vp),
  });

  for (const { name, vp } of PROFILES) {
    for (const dev of DEVICES) {
      it(`stays on screen and inside the HUD margin at ${name} / ${dev.name}`, () => {
        const { w, h } = worstCase(vp, dev.isTouch, 4);
        expectWithin(
          promptBounds(vp.width, vp.height, w, h, dev.isTouch),
          FULL_PAD,
          vp,
          'onboarding',
        );
      });
    }
  }

  it('lands exactly on its band at the wrap ceiling — the assertion that earns its keep', () => {
    // The prompt claims `full` + PAD *because* it is wrapped to fit inside it, and
    // since u7-07 it makes the stronger promise too: it fits the CLEAR BAND, which
    // is narrower. If the wrap budget ever stops paying for PROMPT_PAD_X and the
    // stroke, a prompt whose text reaches the ceiling registers wider than the band
    // it was measured for — and runs under a thumb stick on the one screen least
    // likely to be looked at by eye.
    for (const { name, vp } of PROFILES) {
      for (const dev of DEVICES) {
        const band = promptBand(vp.width, vp.height, dev.isTouch);
        const b = promptBounds(
          vp.width,
          vp.height,
          promptWrapWidth(vp.width, vp.height, dev.isTouch),
          20,
          dev.isTouch,
        );
        const label = `${name} / ${dev.name}`;
        expect(b.x, label).toBeGreaterThanOrEqual(band.x - 1e-6);
        expect(b.x + b.width, label).toBeLessThanOrEqual(band.x + band.width + 1e-6);
        expect(b.width, label).toBeCloseTo(band.width, 6);
      }
    }
  });

  it('hangs from the bottom of its band, clear of the strip and the safe margin', () => {
    for (const { name, vp } of PROFILES) {
      for (const dev of DEVICES) {
        const band = promptBand(vp.width, vp.height, dev.isTouch);
        const b = promptBounds(vp.width, vp.height, 200, 20, dev.isTouch);
        const label = `${name} / ${dev.name}`;
        expect(b.y + b.height, label).toBeCloseTo(band.y + band.height, 6);
        const reserve = dev.isTouch ? 0 : PROMPT_STRIP_RESERVE;
        expect(b.y + b.height, label).toBeLessThanOrEqual(vp.height - HUD_PAD - reserve + 1e-6);
      }
    }
  });

  it('CLEARS THE BUILD WHEEL at a one-line prompt — the collision u7-07 was written for', () => {
    // The regression this brief names: at 844×390 the wheel spans y 54.6 → 335.4
    // (72% of the screen) and the old `PROMPT_CENTER_Y = 0.72` put the prompt at
    // y 259 → 302, squarely over the REPAIR REACTOR and RADAR wedges — and the
    // SPEND prompt fires WHILE the wheel is open by design (GDD §2.10), so that
    // was its normal state, not an edge case.
    //
    // Asserted per profile against the device class that profile ACTUALLY IS: the
    // phones are touch (no controls strip, thumb columns instead) and the desktop
    // is not. The cross-product is deliberately not asserted here — a 844×390
    // window driven by a keyboard has to pay for BOTH a 280px-tall wheel and the
    // strip's reserve, and 390px of height cannot cover both. The prompt degrades
    // there exactly as documented: it keeps its bottom edge, grows up into the
    // wheel, and the wedge reads through it (SCRIM.prompt). The `full` + PAD
    // assertion above still covers that case, which is the promise that matters.
    //
    // A one-line prompt is the case that has to be clean, because it is the case
    // that happens: every authored prompt fits one line of the band on every
    // profile in the matrix.
    const degraded: string[] = [];
    for (const { name, vp, isTouch } of PROFILES) {
      const wheel = wheelBounds(vp.width, vp.height);
      const b = promptBounds(vp.width, vp.height, 200, lineBox(vp), isTouch);
      if (b.y < wheel.y + wheel.height) {
        degraded.push(
          `${name} (prompt top ${b.y.toFixed(1)}, wheel bottom ${(wheel.y + wheel.height).toFixed(1)})`,
        );
      }
    }

    // …and the screens where it CANNOT clear, named. The band is the room left
    // between the wheel's bottom edge and the HUD margin; on a 320px-tall screen
    // the wheel's own 120px minimum radius (hud-geometry `WHEEL_MIN_RADIUS`) takes
    // 240 of those 320 px, leaving 18px for a 33px prompt. So the prompt keeps its
    // bottom edge and grows 9px up into the bottom wedges, and reads through them
    // (SCRIM.prompt). Pinning the SET here means a change that makes a second
    // screen degrade fails this test instead of quietly shipping.
    expect(degraded, 'exactly one profile in the matrix cannot hold a prompt under the wheel')
      .toEqual(['small/landscape (prompt top 271.0, wheel bottom 280.0)']);
  });

  it('clears the touch thumb columns — or falls back to the legibility floor, never between', () => {
    // The other half of the fix: the band stops short of the columns
    // `@platform/touch-visuals` puts the sticks / FIRE in, so the wrap can never
    // produce a line that reaches them.
    //
    // There is one screen where it CANNOT: a 390px-wide logical viewport has
    // 390 − 2·16 − 2·156 = 46px left between the two thumb columns, which is not a
    // prompt, it is a word. The floor wins there and the prompt is drawn over a
    // stick — deliberately, because a legible prompt over a stick beats an
    // illegible one beside it (GDD §2.10: a prompt the player cannot read is a
    // prompt that did not fire). What this asserts is that those are the only two
    // answers: fully clear, or exactly at the floor.
    for (const { name, vp } of PROFILES) {
      const band = promptBand(vp.width, vp.height, true);
      const clearsLeft = band.x >= HUD_PAD + PROMPT_THUMB_COLUMN - 1e-6;
      const clearsRight = band.x + band.width <= vp.width - HUD_PAD - PROMPT_THUMB_COLUMN + 1e-6;
      const atFloor = Math.abs(band.width - floorWidth(vp)) < 1e-6;
      expect(
        (clearsLeft && clearsRight) || atFloor,
        `${name}: band ${fmt(band)} neither clears the thumb columns nor sits at the floor`,
      ).toBe(true);
    }
  });

  it('clears the minimap\'s collapsed corner square — or falls back to the floor', () => {
    // The prompt and the corner map share the bottom band. The band is limited by
    // the map's own `collapsedRect` rather than by a copy of its numbers, so the
    // two cannot drift apart the day the map's size or its FIRE-column clearance
    // changes. Same two-answer rule as the thumb columns above.
    for (const { name, vp } of PROFILES) {
      for (const isTouch of [false, true]) {
        const band = promptBand(vp.width, vp.height, isTouch);
        const map = collapsedRect(vp, isTouch);
        const clears = band.x + band.width <= map.x + 1e-6;
        const atFloor = Math.abs(band.width - floorWidth(vp)) < 1e-6;
        expect(
          clears || atFloor,
          `${name} / touch=${isTouch}: band right ${(band.x + band.width).toFixed(1)} vs map left ${map.x.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });

  it('never collapses below a legible line, however crowded the screen', () => {
    // The floor that stops the band arithmetic from producing a two-word prompt on
    // a small screen: a band is never narrower than the wrap floor plus its own
    // padding, whatever the wheel and the thumb columns have taken.
    for (const { name, vp } of PROFILES) {
      for (const isTouch of [false, true]) {
        const band = promptBand(vp.width, vp.height, isTouch);
        expect(band.width, `${name} / touch=${isTouch}`).toBeGreaterThanOrEqual(
          floorWidth(vp) - 1e-6,
        );
        expect(promptWrapWidth(vp.width, vp.height, isTouch), `${name} / touch=${isTouch}`)
          .toBeGreaterThanOrEqual(PROMPT_MIN_TEXT_WIDTH);
      }
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
