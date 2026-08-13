/**
 * evidence/a0-39-additive-sky-artifacts/sky-rig.ts — the in-page half of a0-39's
 * reproduction. OWNER: Art Agent.
 *
 * It draws **only the backdrop**: the shipped `VoidBackdrop`, on the shipped
 * `MAP_NEBULA` assignment, at a real viewport, over each map's real arena
 * bounds. No ships, no rocks, no HUD — because the report is about the sky and
 * anything else in the frame is something for the eye to blame instead.
 *
 * The camera offset is a rig argument rather than zero: the sky is a parallax
 * layer, so "what a player sees" is a *window* onto the field, and the window at
 * the arena's centre is not the same window as the one at its rim. Every frame
 * this rig takes is at the arena centre unless the shot asks otherwise, so the
 * before/after pairs compare the same window.
 *
 * Served by the Vite dev server only (`./shoot.mjs` starts one); `vite build`
 * takes `index.html` alone, so nothing here reaches the bundle.
 */
import { Application } from 'pixi.js';
import { MAP_NEBULA, VoidBackdrop, type MapId } from '../../src/art/backdrop';
import { MAPS } from '../../src/sim/maps';

/** One shot: a map, the viewport it is seen through, and the camera offset. */
export interface SkyShot {
  readonly map: MapId;
  readonly viewW: number;
  readonly viewH: number;
  /** The world container's screen offset — the renderer's camera offset. */
  readonly offX: number;
  readonly offY: number;
  /**
   * Hide the three star layers, leaving the ground and the sky.
   *
   * The isolate, and the reason it exists: a star's core is white at alpha 0.88,
   * so the brightest pixel in any frame with stars in it is a star, and every
   * step across one is a hard edge. Measuring "is the sky banded?" on a frame
   * with stars in it measures the stars. a0-18 isolated a layer the same way, on
   * the same scene graph.
   */
  readonly starless?: boolean;
}

export interface SkyRig {
  /** Draw one shot and resolve when the frame is on the canvas. */
  show(shot: SkyShot): Promise<{ nebula: string; boundsW: number; boundsH: number }>;
}

declare global {
  interface Window {
    __skyRig?: SkyRig;
  }
}

const app = new Application();
const backdrop = new VoidBackdrop();

async function boot(): Promise<void> {
  await app.init({
    background: 0x010204,
    width: 1280,
    height: 800,
    antialias: true,
    // Deliberately 1, not devicePixelRatio: a ring count wants one texel per
    // pixel, and the artefact under investigation is not a resolution question.
    resolution: 1,
    autoDensity: false,
  });
  document.body.appendChild(app.canvas);
  app.stage.addChild(backdrop.view);

  window.__skyRig = {
    async show(shot) {
      const map = MAPS.find((m) => m.id === shot.map);
      if (!map) throw new Error(`unknown map ${shot.map}`);
      app.renderer.resize(shot.viewW, shot.viewH);
      backdrop.setMap(shot.map);
      backdrop.configure(map.bounds.width, map.bounds.height, shot.viewW, shot.viewH);
      backdrop.update(shot.offX, shot.offY, shot.viewW, shot.viewH);
      for (const child of backdrop.view.children) {
        child.visible = !(shot.starless === true && String(child.label).startsWith('void-stars-'));
      }
      app.render();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      app.render();
      return { nebula: MAP_NEBULA[shot.map], boundsW: map.bounds.width, boundsH: map.bounds.height };
    },
  };
  document.title = 'sky-rig ready';
}

void boot();
