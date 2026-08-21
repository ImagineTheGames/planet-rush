/**
 * evidence/a0-125-the-corner-two-boxes-share/corner.ts — the specimen bench for
 * a0-125 D1. OWNER: UI Engineer.
 *
 * Dev-server only (`corner.html`; nothing imports it and it is not in the shipped
 * bundle), the same shape as a0-116's `arrow-clock.ts` and a0-115's
 * `counter-plate.ts`.
 *
 * **What it is for.** a0-122's D1 is the re-enter-fullscreen affordance drawn
 * over own-station HP: `fullscreen-reenter {738,12 48×48}` covering 31% of
 * `station-hp {642,16 140×30}` on a 798×384 phone, on 462 swept frames. It is
 * invisible to every golden in the repo for one reason — the button is drawn only
 * after the player has really *left fullscreen*, which a headless screenshot run
 * never does. This bench reaches the frame deterministically by drawing the
 * shipped `FullscreenAffordance` itself, visible, in `main.ts`'s own child order.
 *
 * **It is the real HUD and the real button.** `new Hud(...)` and
 * `new FullscreenAffordance()`, both shipped classes, on a real Pixi
 * `Application` with the two ratified faces loaded. `main.ts` adds them to
 * `gameRoot` in the order `hud`, `touchVisuals`, `fsAffordance` — so the button
 * is over the HUD here exactly as it is in the game, which is the half of the
 * defect a rect test cannot photograph. The only thing this file decides is that
 * the player has left fullscreen.
 *
 * **Two stops, chosen for what they show:**
 *
 *  - `quiet` — the HUD at rest with the button up. This is D1's own frame: the
 *    HOME readout and a 48×48 button in one corner.
 *  - `alarm` — the same corner with the station under attack and off-screen to
 *    the top-right, so the screen-edge arrow home is drawn into that corner too.
 *    That is the **D6 the a0-125 brief warned about**: the arrow had been kept out
 *    of the button's corner all along by HOME's own rect, and the moment HOME
 *    steps aside the arrow rides straight under the button unless the arrow's
 *    keep-out names it (`src/ui/layout-exclusions.ts` `ARROW_KEEPOUT_IDS`). One
 *    frame that shows the fix and the fix's own consequence.
 *
 * Nothing here is hardcoded to a corner: the bearing for the `alarm` stop is
 * computed from the BUTTON's own drawn rect, so the before and the after aim at
 * the same point on the glass.
 */
import { Application } from 'pixi.js';
import { Hud } from '../../src/ui/hud';
import type { HudFrame, HostChromeRect } from '../../src/ui/hud';
import type { Rect } from '../../src/platform/layout-registry';
import { ARROW_EDGE_INSET } from '../../src/ui/alarm';
import { stationHpBounds } from '../../src/ui/hud-geometry';
import { FireMode } from '../../src/platform/actions';
import {
  FullscreenAffordance,
  FS_AFFORDANCE_ID,
} from '../../src/render/fullscreen-affordance';

/** The profile every a0-122 number in §3a is read on, and the one a0-111,
 *  a0-114 and a0-118 all captured. D1 is phone-only by construction: the
 *  affordance is touch-only, and on the ultrawides the content box is nowhere
 *  near the glass corner the button hugs. */
const PROFILE = { id: 'phone', label: 'phone landscape 798×384 dpr2', width: 798, height: 384, isTouch: true };

/** Match time on the photographed frame. Fixed, so the alarm's pulse — and with
 *  it the arrow's alpha — is identical in the before and the after. */
const SHOT_TIME = 41.6;

function frameFor(
  time: number,
  coreHp: number,
  home: { x: number; y: number } | null,
  hostChrome: HostChromeRect[],
): HudFrame {
  return {
    cargo: 0,
    cargoCap: 8,
    banked: 3,
    time,
    device: 'touch',
    fireMode: FireMode.AutoAim,
    controlScheme: 'tap',
    isTouch: true,
    nearAsteroid: false,
    owner: 0,
    coreHp,
    maxCoreHp: 100,
    maxHull: 70,
    hull: 70,
    stationAlive: true,
    names: ['You'],
    viewZoom: 1,
    shipPos: { x: 0, y: 0 },
    // The player has backed out of fullscreen. This is the whole staging.
    fullscreenAffordance: true,
    hostChrome,
    ...(home ? { homePos: home } : {}),
  };
}

export interface CornerReadback {
  stop: string;
  /** The button, as `writeAffordanceRect` placed it on the GLASS. */
  affordance: Rect;
  /** The HOME cluster's whole drawn footprint, off the HUD's own registry seam. */
  stationDrawn: Rect;
  /** The HOME bar's INK — `stationHpBounds`, the 140×30 rect a0-122 measured. */
  stationInk: Rect;
  /** Shared pixels between the button and the ink rect, or null. THIS is D1. */
  overlap: Rect | null;
  /** How much of the ink rect is under the button, 0..1 — a0-122 read 0.31. */
  fraction: number;
  /** Clear air between the button and the ink rect, CSS px; 0 when they share. */
  air: number;
  /** The arrow home's drawn rect on this stop, or null when it is not drawn. */
  arrow: Rect | null;
  /** Shared pixels between the button and the arrow — the D6 half. */
  arrowOverlap: Rect | null;
}

/** The rect two rects share, or null. Touching edges are not a cover — the
 *  convention `src/ui/layout-exclusions.ts` `rectOverlap` sets. */
function shared(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bt = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bt <= y) return null;
  return { x, y, width: r - x, height: bt - y };
}

/** The largest per-axis gap between two rects, or 0 when they overlap. */
function clearAir(a: Rect, b: Rect): number {
  const x = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const y = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(0, Math.max(x, y));
}

const readbacks: CornerReadback[] = [];

export async function mountCorner(root: HTMLElement): Promise<void> {
  for (const stop of ['quiet', 'alarm'] as const) {
    const app = new Application();
    await app.init({
      width: PROFILE.width,
      height: PROFILE.height,
      background: 0x0d1015, // Cold Vacuum (style-guide §1) — the game's own ground
      antialias: true,
      resolution: 2,
      autoDensity: true,
    });

    const hud = new Hud(PROFILE.width, PROFILE.height);
    app.stage.addChild(hud);
    // `main.ts`: `gameRoot.addChild(hud)` … `gameRoot.addChild(fsAffordance)`.
    // The button is the LAST child, so it is over the HUD — which is the half of
    // D1 that only a picture can show.
    const fsAffordance = new FullscreenAffordance();
    app.stage.addChild(fsAffordance);
    fsAffordance.update(true, PROFILE.width, PROFILE.height);
    const affordance = { ...fsAffordance.layoutBounds(PROFILE.width, PROFILE.height) };
    const hostChrome: HostChromeRect[] = [{ id: FS_AFFORDANCE_ID, bounds: affordance }];

    const vp = { width: PROFILE.width, height: PROFILE.height };

    // 1. One quiet frame: it places the chrome, and it is the frame the alarm
    //    takes its damage baseline from.
    hud.update(frameFor(SHOT_TIME - 0.1, 100, null, hostChrome));
    app.render();

    // 2. On the `alarm` stop, put the station off-screen at the bearing that aims
    //    the arrow at the BUTTON's own centre column, on the arrow's edge line.
    let home: { x: number; y: number } | null = null;
    if (stop === 'alarm') {
      const box = hud.debugContentBox();
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const aim = { x: affordance.x + affordance.width / 2, y: ARROW_EDGE_INSET };
      home = { x: (aim.x - centre.x) * 40, y: (aim.y - centre.y) * 40 };
    }

    // 3. …and the frame that is photographed. `coreHp` falls on the alarm stop,
    //    which is what rings it (`Hud.updateAlarm` reads the FALL in the pool).
    hud.update(frameFor(SHOT_TIME, stop === 'alarm' ? 88 : 100, home, hostChrome));
    app.render();

    const entries = hud.describeLayout(vp);
    const stationDrawn = entries.find((e) => e.id === 'station-hp')!.bounds;
    const box = hud.debugContentBox();
    const ink = stationHpBounds(box.width);
    // The ink rect as it was really drawn: the HOME group is right-anchored, so
    // the bar's left edge is the group's origin less the bar's width. Read off
    // the drawn group rather than recomputed, so the bench cannot disagree with
    // the view about where the column ended up.
    const stationInk: Rect = {
      x: stationDrawn.x + stationDrawn.width - ink.width,
      y: ink.y,
      width: ink.width,
      height: ink.height,
    };
    const arrow = entries.find((e) => e.id === 'alarm-arrow')?.bounds ?? null;
    const overlap = shared(affordance, stationInk);

    readbacks.push({
      stop,
      affordance,
      stationDrawn,
      stationInk,
      overlap,
      fraction: overlap
        ? (overlap.width * overlap.height) / (stationInk.width * stationInk.height)
        : 0,
      air: clearAir(affordance, stationInk),
      arrow,
      arrowOverlap: arrow ? shared(affordance, arrow) : null,
    });

    const fig = document.createElement('figure');
    fig.className = 'cell';
    fig.dataset.shot = `${PROFILE.id}-${stop}`;
    fig.appendChild(app.canvas);
    const cap = document.createElement('figcaption');
    cap.textContent =
      `${PROFILE.label} — ${stop} — fullscreen-reenter ` +
      `${affordance.x.toFixed(1)},${affordance.y.toFixed(1)} ` +
      `${affordance.width.toFixed(1)}×${affordance.height.toFixed(1)}; ` +
      `station-hp ink ${stationInk.x.toFixed(1)},${stationInk.y.toFixed(1)} ` +
      `${stationInk.width.toFixed(1)}×${stationInk.height.toFixed(1)}`;
    fig.appendChild(cap);
    root.appendChild(fig);
  }

  (window as unknown as { __a0125: unknown }).__a0125 = {
    readbacks: () => readbacks,
    ready: true,
  };
  document.body.dataset.ready = '1';
}
