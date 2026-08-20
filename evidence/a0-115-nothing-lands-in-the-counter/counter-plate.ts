/**
 * evidence/a0-115-nothing-lands-in-the-counter/counter-plate.ts — the specimen
 * bench for a0-115. OWNER: UI Engineer.
 *
 * Dev-server only (`counter-plate.html`; nothing imports it and it is not in the
 * shipped bundle), the same shape as `sky-preview.html` at the repo root.
 *
 * **What it is for.** The defect is a *camera-position* defect: a rival's
 * nameplate lands inside the ore counter's rect on roughly one stop in seven, and
 * a golden frame taken at one position cannot see it. QA reached theirs by real
 * taps and found 4 in 28. This bench reaches the same frame deterministically —
 * the nameplate feed is already in SCREEN space by the time the HUD sees it
 * (`src/ui/nameplates.ts` `Nameable.pos`), so a rival can be parked exactly where
 * the camera would have put it, without driving a match to get there.
 *
 * **It is the real HUD.** `new Hud(...)`, the shipped class, on a real Pixi
 * `Application` with the two ratified faces loaded, fed one `HudFrame`. Nothing
 * about the ore counter, the nameplate layer or the keep-out is re-implemented
 * here; the only thing this file decides is where the rival is standing.
 *
 * **Two stops, chosen for what they show:**
 *
 *  - `beside` — a rival just clear of the counter's right edge, its plate drawn
 *    ~21px into the counter's rect. This is QA's frame (they measured 20.3 × 16
 *    logical). After a0-115 the plate STEPS ASIDE and is still there.
 *  - `under` — a rival whose hull is behind the counter. There is no position that
 *    clears the counter while the plate still stands over the ship, so after
 *    a0-115 the plate STANDS DOWN. `window.__a0115.withheld()` reads back the
 *    receipt the layer keeps for it, which is the difference between a label that
 *    yielded and a label that broke.
 *
 * Both positions are computed from the counter's OWN registered rect
 * (`Hud.describeLayout`) and the plate's own row geometry, not from a hardcoded
 * corner — the same discipline the fix itself is held to.
 */
import { Application } from 'pixi.js';
import { Hud } from '../../src/ui/hud';
import type { HudFrame } from '../../src/ui/hud';
import type { Nameable, Nameplate } from '../../src/ui/nameplates';
import {
  NAMEPLATE_FONT_SIZE,
  nameplateRowLayout,
  nameplateClusterClearance,
} from '../../src/ui/nameplates-view';
import { textWidth, textHeight } from '../../src/ui/font-metrics';
import { HUD_TRACKING } from '../../src/ui/instrument';
import { FireMode } from '../../src/platform/actions';

/** The rival QA photographed, character for character. */
const RIVAL = { slot: 1 as const, name: 'Rusty', difficulty: 'easy', suffix: '(EASY)' };

/** The two profiles a0-111 shot on. */
const PROFILES = [
  { id: 'phone', label: 'phone landscape 798×384 dpr2', width: 798, height: 384, isTouch: true },
  { id: 'desktop', label: 'desktop 1280×800 dpr2', width: 1280, height: 800, isTouch: false },
];

const PLATE_TYPE = { face: 'body', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name } as const;

/** The rigid row this rival's plate draws, centred on x = 0. */
function rivalRow() {
  return nameplateRowLayout(0, {
    side: 0, // FFA — no side tag, exactly as QA's frame
    name: textWidth(RIVAL.name, PLATE_TYPE),
    suffix: textWidth(RIVAL.suffix, PLATE_TYPE),
  });
}

/** The clearance the view floats a ship's row by is a function of the plate, so
 *  the bench asks the view rather than restating the arithmetic. Only `kind`,
 *  `radius` and `local` are read by it. */
function plateFor(radius: number): Nameplate {
  return {
    owner: RIVAL.slot,
    kind: 'ship',
    text: RIVAL.name,
    suffix: RIVAL.suffix,
    teamLabel: '',
    teamColor: 0xffffff,
    color: 0xffffff,
    x: 0,
    y: 0,
    radius,
    alpha: 1,
    local: false,
  };
}

/** A frame with `nameables` in it, or none, so the counter's own rect can be read
 *  before anything is parked on top of it. */
function frameFor(isTouch: boolean, nameables: readonly Nameable[]): HudFrame {
  return {
    cargo: 0,
    cargoCap: 8,
    // The bank QA's stop was carrying: a single figure, so the counter is at the
    // width they measured rather than at a late-match four-figure width.
    banked: 3,
    time: 42,
    device: isTouch ? 'touch' : 'keyboard',
    fireMode: FireMode.AutoAim,
    controlScheme: 'tap',
    isTouch,
    nearAsteroid: false,
    owner: 0,
    coreHp: 100,
    maxCoreHp: 100,
    maxHull: 70,
    hull: 70,
    nameables,
    names: ['You', RIVAL.name],
    difficulties: [undefined, RIVAL.difficulty],
    viewZoom: 1,
  };
}

export interface PlateReadback {
  profile: string;
  stop: string;
  counter: { x: number; y: number; width: number; height: number };
  ship: { x: number; y: number };
  /** The label the layer actually drew, if it drew one. */
  drawn: { text: string; left: number; right: number; y: number } | null;
  /** …or the receipt for the one it withheld, if the build keeps them (a0-115). */
  withheld: { text: string; reason: string } | null;
}

const readbacks: PlateReadback[] = [];

export async function mountCounterPlate(root: HTMLElement): Promise<void> {
  for (const profile of PROFILES) {
    for (const stop of ['beside', 'under'] as const) {
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

      // 1. Draw the HUD with nothing parked on it, and read the counter's rect out
      //    of the registry seam — the same rect QA measured.
      hud.update(frameFor(profile.isTouch, []));
      app.render();
      const counter = hud
        .describeLayout({ width: profile.width, height: profile.height })
        .find((e) => e.id === 'ore-hud')!.bounds;

      // 2. Park the rival so its plate lands in that rect. `beside` puts the row's
      //    left edge 21px inside the counter's right edge (QA measured 20.3);
      //    `under` puts the ship itself behind the counter.
      const row = rivalRow();
      const line = textHeight(RIVAL.name, PLATE_TYPE);
      const radius = 12;
      const rowLeft = stop === 'beside' ? counter.x + counter.width - 21 : counter.x + counter.width * 0.35;
      const x = rowLeft - row.left;
      // Drop the label's line into the middle of the counter's depth.
      const labelTop = counter.y + counter.height / 2 - line / 2;
      const y = labelTop + line + nameplateClusterClearance(plateFor(radius));

      hud.update(
        frameFor(profile.isTouch, [
          { owner: RIVAL.slot, kind: 'ship', alive: true, pos: { x, y }, radius },
        ]),
      );
      app.render();

      const plates = hud.debugNameplates();
      const held =
        typeof (hud as { debugWithheldNameplates?: unknown }).debugWithheldNameplates === 'function'
          ? (hud as unknown as { debugWithheldNameplates(): { text: string; reason: string }[] }).debugWithheldNameplates()
          : [];
      const mine = plates.find((p) => p.owner === RIVAL.slot) ?? null;
      readbacks.push({
        profile: profile.id,
        stop,
        counter,
        ship: { x, y },
        drawn: mine ? { text: mine.text, left: mine.left, right: mine.right, y: mine.y } : null,
        withheld: held.length > 0 ? { text: held[0]!.text, reason: held[0]!.reason } : null,
      });

      const fig = document.createElement('figure');
      fig.className = 'cell';
      fig.dataset.shot = `${profile.id}-${stop}`;
      fig.appendChild(app.canvas);
      const cap = document.createElement('figcaption');
      cap.textContent =
        `${profile.label} — rival parked ${stop} the counter ` +
        `(ship at ${x.toFixed(1)}, ${y.toFixed(1)}; counter ${counter.x.toFixed(1)},${counter.y.toFixed(1)} ` +
        `${counter.width.toFixed(1)}×${counter.height.toFixed(1)})`;
      fig.appendChild(cap);
      root.appendChild(fig);
    }
  }

  (window as unknown as { __a0115: unknown }).__a0115 = {
    readbacks: () => readbacks,
    ready: true,
  };
  document.body.dataset.ready = '1';
}
