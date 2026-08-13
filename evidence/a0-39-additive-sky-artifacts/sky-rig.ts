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
import {
  coverSpan,
  MAP_NEBULA,
  NEBULAE,
  nebulaSprite,
  VOID_SEED,
  VoidBackdrop,
  type MapId,
} from '../../src/art/backdrop';
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
  show(shot: SkyShot): Promise<{
    nebula: string;
    boundsW: number;
    boundsH: number;
    /** Shapes the sky layer's `Graphics` was built from. */
    skyShapes: number;
    /** `WebGL2` `draw*` calls for one steady-state frame of this backdrop —
     *  the number `a1-16`'s budget is denominated in. */
    drawCalls: number;
  }>;
}

// ---------------------------------------------------------------------------
// The draw-call counter — patched before any context exists
// ---------------------------------------------------------------------------

let drawCalls = 0;

/**
 * Count every draw the page issues, on the prototype rather than on a context
 * instance, before `Application.init` makes one. Same instrument as
 * `tests/perf/draw-budget.rig.ts`, for the same reason a0-39 needs it at all:
 * the brief's one hard perf constraint is *"a fix that doubles submissions fails
 * the build"*, and the a1-16 gate's stress scene runs on `octagon`, whose sky is
 * NONE — so the gate never draws a nebula and cannot answer the question.
 */
function installDrawCallCounter(): void {
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, unknown>;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = proto[name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') continue;
    proto[name] = function patched(this: unknown, ...args: unknown[]): unknown {
      drawCalls++;
      return original.apply(this, args);
    };
  }
}

installDrawCallCounter();

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
      // One warm frame (the first uploads geometry and the ramp), then count the
      // steady-state one — which is the only frame the budget is about, because
      // `configure()` never runs again while the map and the viewport hold.
      app.render();
      const before = drawCalls;
      app.render();
      const id = MAP_NEBULA[shot.map];
      const spec = NEBULAE[id];
      return {
        nebula: id,
        boundsW: map.bounds.width,
        boundsH: map.bounds.height,
        // Re-derived rather than read off the `Graphics`: the layer holds baked
        // geometry, not the shape list it came from, and this is the same call
        // `VoidBackdrop.configure` makes with the same arguments.
        skyShapes: nebulaSprite(
          id,
          VOID_SEED,
          coverSpan(spec.parallax, shot.viewW, map.bounds.width),
          coverSpan(spec.parallax, shot.viewH, map.bounds.height),
          1,
          shot.viewW,
          shot.viewH,
        ).shapes.length,
        drawCalls: drawCalls - before,
      };
    },
  };
  document.title = 'sky-rig ready';
}

void boot();
