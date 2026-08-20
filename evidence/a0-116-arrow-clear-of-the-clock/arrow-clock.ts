/**
 * evidence/a0-116-arrow-clear-of-the-clock/arrow-clock.ts — the specimen bench
 * for a0-116. OWNER: UI Engineer.
 *
 * Dev-server only (`arrow-clock.html`; nothing imports it and it is not in the
 * shipped bundle), the same shape as a0-115's `counter-plate.ts` and
 * `sky-preview.html` at the repo root.
 *
 * **What it is for.** The defect is a *bearing* defect: the screen-edge arrow
 * home lands on a readout only while the player's station is off-screen in one
 * of the directions where the edge it rides is already occupied. A golden frame
 * of a ship two seconds into a match has no alarm and no arrow, and QA reached
 * theirs by playing until one. This bench reaches the same frame
 * deterministically — the arrow is computed from the ship/station world offset
 * alone (`src/ui/alarm.ts` `homeArrow`), so the station can simply be *placed* at
 * the bearing that produced a0-111's frame.
 *
 * **It is the real HUD.** `new Hud(...)`, the shipped class, on a real Pixi
 * `Application` with the two ratified faces loaded, fed two `HudFrame`s — one to
 * set the alarm's damage baseline, one that takes 12 HP off the core and rings
 * it. Nothing about the arrow, the clock or the keep-out is re-implemented here.
 * The only thing this file decides is where the station is standing.
 *
 * **Two stops, chosen for what they show:**
 *
 *  - `clock` — the station straight ahead, so the arrow lands top-centre. This is
 *    a0-111's frame: *"it covers the A of WAVE and most of the V, leaving 'W' on
 *    one side and 'E 1/5 · Outer Drift' on the other."*
 *  - `home` — the station off the top-right, so the arrow lands on the HOME
 *    cluster instead. The same rule, a different readout: the fix is not a
 *    special case for the clock, and a frame that only showed the clock could not
 *    say so.
 *
 * Both bearings are computed from the readout's OWN drawn rect — the clock's from
 * `Hud.debugWaveClock()`, HOME's from `Hud.describeLayout()` — aimed at the point
 * on the arrow's edge line that the readout is standing on. Nothing is hardcoded
 * to a corner, which is the same discipline the fix itself is held to.
 */
import { Application } from 'pixi.js';
import { Hud } from '../../src/ui/hud';
import type { HudFrame } from '../../src/ui/hud';
import type { Rect } from '../../src/platform/layout-registry';
import { ARROW_EDGE_INSET } from '../../src/ui/alarm';
import { FireMode } from '../../src/platform/actions';

/** The two profiles a0-111 shot on. */
const PROFILES = [
  { id: 'phone', label: 'phone landscape 798×384 dpr2', width: 798, height: 384, isTouch: true },
  { id: 'desktop', label: 'desktop 1280×800 dpr2', width: 1280, height: 800, isTouch: false },
];

/** Match time on the frame that is photographed. Fixed, so the alarm's pulse —
 *  and therefore the arrow's alpha — is the same in the before and the after. */
const SHOT_TIME = 41.6;

/** A siege frame. `coreHp` is the only thing that moves between the two: the
 *  alarm rings on the FALL in the pool, so the first frame sets the baseline and
 *  the second one takes the hit (`Hud.updateAlarm`). */
function frameFor(
  isTouch: boolean,
  time: number,
  coreHp: number,
  home: { x: number; y: number } | null,
): HudFrame {
  return {
    cargo: 0,
    cargoCap: 8,
    banked: 3,
    time,
    device: isTouch ? 'touch' : 'keyboard',
    fireMode: FireMode.AutoAim,
    controlScheme: isTouch ? 'tap' : 'sticks',
    isTouch,
    nearAsteroid: false,
    owner: 0,
    coreHp,
    maxCoreHp: 100,
    maxHull: 70,
    hull: 70,
    stationAlive: true,
    names: ['You'],
    viewZoom: 1,
    // The camera holds the local ship at the middle of the screen, so the ship's
    // own world position is arbitrary and the station's is the whole bearing.
    shipPos: { x: 0, y: 0 },
    ...(home ? { homePos: home } : {}),
  };
}

export interface ArrowReadback {
  profile: string;
  stop: string;
  /** The readout this bearing aims the arrow at, as it was drawn. */
  readout: { id: string; x: number; y: number; width: number; height: number };
  /** The station's world position — i.e. the bearing, as fed in. */
  home: { x: number; y: number };
  /** The bearing itself, degrees, y-down (−90 is straight up the screen). */
  bearingDeg: number;
  /** The arrow's drawn rect, off the registry seam (`alarm-arrow`). */
  arrow: { x: number; y: number; width: number; height: number } | null;
  /** Clear air between the two rects, CSS px — 0 when they share pixels. THIS is
   *  the finding and the fix in one number. */
  air: number;
}

/** The largest per-axis gap between two rects, or 0 when they overlap. */
function clearAir(a: Rect, b: Rect): number {
  const x = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const y = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(0, Math.max(x, y));
}

const readbacks: ArrowReadback[] = [];

export async function mountArrowClock(root: HTMLElement): Promise<void> {
  for (const profile of PROFILES) {
    for (const stop of ['clock', 'home'] as const) {
      const app = new Application();
      await app.init({
        width: profile.width,
        height: profile.height,
        background: 0x0d1015, // Cold Vacuum (style-guide §1) — the game's own ground
        antialias: true,
        resolution: 2,
        autoDensity: true,
      });

      const hud = new Hud(profile.width, profile.height);
      app.stage.addChild(hud);
      const vp = { width: profile.width, height: profile.height };

      // 1. One quiet frame: it places the chrome, and it is the frame the alarm
      //    takes its damage baseline from.
      hud.update(frameFor(profile.isTouch, SHOT_TIME - 0.1, 100, null));
      app.render();

      // 2. The readout this stop aims at, as the HUD actually drew it.
      const clock = hud.debugWaveClock()!;
      const station = hud.describeLayout(vp).find((e) => e.id === 'station-hp')!.bounds;
      const readout = stop === 'clock' ? { id: 'wave-clock', ...clock } : { id: 'station-hp', ...station };

      // 3. The bearing that puts the arrow on it: aim at the point on the arrow's
      //    own edge line (ARROW_EDGE_INSET from the top) that this readout is
      //    standing over, and push the station far enough out that the arrow is
      //    clamped rather than drawn in place.
      const box = hud.debugContentBox();
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const aim = { x: readout.x + readout.width / 2, y: ARROW_EDGE_INSET };
      const dx = aim.x - centre.x;
      const dy = aim.y - centre.y;
      const home = { x: dx * 40, y: dy * 40 };

      // 4. …and the frame that rings the alarm and draws the arrow at it.
      hud.update(frameFor(profile.isTouch, SHOT_TIME, 88, home));
      app.render();

      const arrow = hud.describeLayout(vp).find((e) => e.id === 'alarm-arrow')?.bounds ?? null;
      readbacks.push({
        profile: profile.id,
        stop,
        readout,
        home,
        bearingDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
        arrow,
        air: arrow ? clearAir(arrow, readout) : Number.NaN,
      });

      const fig = document.createElement('figure');
      fig.className = 'cell';
      fig.dataset.shot = `${profile.id}-${stop}`;
      fig.appendChild(app.canvas);
      const cap = document.createElement('figcaption');
      cap.textContent =
        `${profile.label} — station at ${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}° ` +
        `(the bearing that puts the arrow on "${readout.id}"); ` +
        `${readout.id} ${readout.x.toFixed(1)},${readout.y.toFixed(1)} ` +
        `${readout.width.toFixed(1)}×${readout.height.toFixed(1)}`;
      fig.appendChild(cap);
      root.appendChild(fig);
    }
  }

  (window as unknown as { __a0116: unknown }).__a0116 = {
    readbacks: () => readbacks,
    ready: true,
  };
  document.body.dataset.ready = '1';
}
