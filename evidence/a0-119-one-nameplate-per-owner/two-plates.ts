/**
 * evidence/a0-119-one-nameplate-per-owner/two-plates.ts — the specimen bench for
 * a0-119. OWNER: UI Engineer.
 *
 * Dev-server only (`two-plates.html`; nothing imports it and it is not in the
 * shipped bundle), the same shape as a0-115's `counter-plate.ts` next door — and
 * deliberately so, because this brief is a0-115's rule with the blocker swapped
 * and the evidence should be readable side by side with it.
 *
 * **What it is for.** QA failed a0-118 on this:
 *
 *   > two nameplates for the same owner are drawn on each other and neither can
 *   > be read.
 *
 * The developer's own screenshot of 2026-08-19 has it — `Rusty (EASY)` printed
 * twice, one label across the other, on a station and a ship belonging to the
 * same character. Like a0-115's it is a *position* defect: it happens when the
 * hull is near its own home, which is most of the opening of a match and none of
 * a golden frame taken somewhere else.
 *
 * **It is the real HUD.** `new Hud(...)`, the shipped class, on a real Pixi
 * `Application` with the ratified faces loaded, fed one `HudFrame` carrying two
 * `Nameable`s for ONE owner: their station and their ship. The nameplate feed is
 * already in screen space by the time the HUD sees it (`src/ui/nameplates.ts`),
 * so the hull can be parked at an exact offset above its home without driving a
 * match there. Nothing about the layer, the row or the keep-out is reimplemented.
 *
 * **Three stops, chosen for what they show:**
 *
 *  - `on` — the hull 24px above its home, the offset at which the two rows land
 *    on the *same baseline*, because a station's row floats by `radius + 8` off a
 *    40px disc and a ship's by `radius + 5 + 4 + 3` off a 12px hull. This is the
 *    worst case and the frame QA failed: two identical strings in one place.
 *  - `across` — the hull 30px up and 26px across, the lopsided version in the
 *    developer's screenshot: one label lying over the other rather than under it.
 *  - `clear` — the hull out on patrol. BOTH plates draw, before and after, which
 *    is the control: this fix must not be "stop labelling ships."
 *
 * A fourth thing worth reading is in the JSON rather than the pixels: on `on` and
 * `across` the after-build reports the ship's plate as `withheld` with reason
 * `duplicate`, which is the receipt that keeps a plate that yielded
 * distinguishable from a plate that broke.
 */
import { Application } from 'pixi.js';
import { Hud } from '../../src/ui/hud';
import type { HudFrame } from '../../src/ui/hud';
import type { Nameable } from '../../src/ui/nameplates';
import { FireMode } from '../../src/platform/actions';

/** The character in the screenshot, character for character — a bot seat, so the
 *  plate carries the difficulty tag that makes it as wide as it is. */
const RUSTY = { slot: 3 as const, name: 'Rusty', difficulty: 'easy' };

/** The two profiles the a0-111/a0-118 sweeps were shot on. */
const PROFILES = [
  { id: 'phone', label: 'phone landscape 798×384 dpr2', width: 798, height: 384, isTouch: true },
  { id: 'desktop', label: 'desktop 1280×800 dpr2', width: 1280, height: 800, isTouch: false },
];

/** Screen radii, the two numbers that set how far apart the rows float. A home is
 *  a big disc and a hull is not (GDD §2.2). */
const STATION_RADIUS = 40;
const SHIP_RADIUS = 12;

/** Where the hull is, relative to its own station, at each stop. */
const STOPS = [
  { id: 'on', dx: 0, dy: -24 },
  { id: 'across', dx: 26, dy: -30 },
  { id: 'clear', dx: 210, dy: -150 },
];

function frameFor(isTouch: boolean, nameables: readonly Nameable[]): HudFrame {
  return {
    cargo: 0,
    cargoCap: 8,
    banked: 3,
    time: 42,
    device: isTouch ? 'touch' : 'keyboard',
    fireMode: FireMode.AutoAim,
    controlScheme: 'tap',
    isTouch,
    nearAsteroid: false,
    // The VIEWER is slot 0, so Rusty in slot 3 is a rival and both of their marks
    // are labelled — the local player's own ship plate is suppressed by default
    // and would have made the pair impossible to stage honestly.
    owner: 0,
    coreHp: 100,
    maxCoreHp: 100,
    maxHull: 70,
    hull: 70,
    nameables,
    names: ['You', undefined, undefined, RUSTY.name],
    difficulties: [undefined, undefined, undefined, RUSTY.difficulty],
    viewZoom: 1,
  };
}

export interface TwoPlateReadback {
  profile: string;
  stop: string;
  station: { x: number; y: number };
  ship: { x: number; y: number };
  /** Every label the layer drew for this owner, in draw order. TWO of these on a
   *  before-build at the `on`/`across` stops is the defect. */
  drawn: { kind: string; text: string; left: number; right: number; y: number }[];
  /** …and every one it stood down, with the reason. `duplicate` is a0-119's. */
  withheld: { kind: string; text: string; reason: string }[];
  /** The shared rect of the two drawn rows, or null — the measurement the verdict
   *  is about, taken off the layer's own readback rather than off a screenshot. */
  overlap: { x: number; y: number; width: number; height: number } | null;
}

const readbacks: TwoPlateReadback[] = [];

export async function mountTwoPlates(root: HTMLElement): Promise<void> {
  for (const profile of PROFILES) {
    for (const stop of STOPS) {
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
      hud.enableNameplateDebug();
      app.stage.addChild(hud);

      // Rusty's home, mid-screen and clear of every readout so nothing but this
      // brief's rule is deciding anything in the frame.
      const sx = Math.round(profile.width * 0.42);
      const sy = Math.round(profile.height * 0.62);
      const hx = sx + stop.dx;
      const hy = sy + stop.dy;

      hud.update(
        frameFor(profile.isTouch, [
          { owner: RUSTY.slot, kind: 'ship', alive: true, pos: { x: hx, y: hy }, radius: SHIP_RADIUS },
          { owner: RUSTY.slot, kind: 'station', alive: true, pos: { x: sx, y: sy }, radius: STATION_RADIUS },
        ]),
      );
      app.render();

      const mine = hud.debugNameplates().filter((p) => p.owner === RUSTY.slot);
      const held = hud.debugWithheldNameplates().filter((p) => p.owner === RUSTY.slot);
      const rows = mine.map((p) => ({
        kind: p.kind,
        text: p.suffix ? `${p.text} ${p.suffix}` : p.text,
        left: p.left,
        right: p.right,
        y: p.y,
      }));
      let overlap: TwoPlateReadback['overlap'] = null;
      if (mine.length === 2) {
        const [a, b] = mine as [(typeof mine)[number], (typeof mine)[number]];
        const line = 16; // the drawn line's depth is not on the readback; a plate
        // row is one line of 12px Oxanium and this is only used to report the
        // shared box, never to decide anything.
        const x = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        const y = Math.max(a.y, b.y);
        const bottom = Math.min(a.y + line, b.y + line);
        if (right > x && bottom > y) overlap = { x, y, width: right - x, height: bottom - y };
      }

      readbacks.push({
        profile: profile.id,
        stop: stop.id,
        station: { x: sx, y: sy },
        ship: { x: hx, y: hy },
        drawn: rows,
        withheld: held.map((h) => ({ kind: h.kind, text: h.text, reason: h.reason })),
        overlap,
      });

      const fig = document.createElement('figure');
      fig.className = 'cell';
      fig.dataset.shot = `${profile.id}-${stop.id}`;
      fig.appendChild(app.canvas);
      const cap = document.createElement('figcaption');
      cap.textContent =
        `${profile.label} — Rusty's hull ${stop.dx},${stop.dy} from its own home ` +
        `(home ${sx},${sy}; hull ${hx},${hy}) — plates drawn: ${rows.length}` +
        (overlap ? `, sharing ${overlap.width.toFixed(1)}×${overlap.height.toFixed(1)}px` : '');
      fig.appendChild(cap);
      root.appendChild(fig);
    }
  }

  (window as unknown as { __a0119: unknown }).__a0119 = {
    readbacks: () => readbacks,
    ready: true,
  };
  document.body.dataset.ready = '1';
}
