/**
 * evidence/a0-53-bloom-radius/renderer-probe.ts — **the real `Renderer`.**
 * OWNER: Art Agent.
 *
 * `field-probe.ts` drives `VoidBackdrop` directly and the halos come out at the
 * design's radius. This crosses the next boundary: `src/render/index.ts`, the
 * class that OWNS the backdrop and draws the world over it, instantiated exactly
 * as `src/main.ts` instantiates it — a `Renderer` over a container, a real
 * `createWorld`, one `draw()`.
 *
 * `createWorld({seed: 7, …})` puts the ship at (1968, 1200) in a 2400² arena, so
 * `centerCamera` writes the same (-1328, -800) the shipped client publishes and
 * the frames register against each other star-for-star.
 *
 * **This frame is what `backdrop-bloom.test.ts` gates**: it is the last surface
 * that is entirely Art's and the renderer's, with none of the app shell on it.
 *
 * `/evidence/a0-53-bloom-radius/renderer-probe.html`
 */
import { Application, Container } from 'pixi.js';
import { Renderer } from '../../src/render/index';
import { createWorld } from '../../src/sim/state';
import { ShipClass } from '../../src/shared/types';

export const VIEW = { w: 1280, h: 800 };

export async function mountRendererProbe(root: HTMLElement): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const app = new Application();
  // The app's own init (`src/main.ts`), minus `resizeTo`, which a fixed-size
  // probe cannot use.
  await app.init({ width: VIEW.w, height: VIEW.h, background: 0x0d1015, antialias: true, resolution: 1 });

  const world = createWorld({ seed: 7, players: [{ id: 0, shipClass: ShipClass.Vanguard }] });
  const gameRoot = new Container();
  app.stage.addChild(gameRoot);
  const renderer = new Renderer(
    gameRoot,
    { width: VIEW.w, height: VIEW.h, originX: 0, originY: 0 },
    { baker: app.renderer, resolution: 1 },
  );
  if (q.get('reduce') === '1') renderer.setReduceVfx(true);
  renderer.draw(world, { cameraTarget: 0, muzzles: [], mapId: 'octagon' } as never);
  app.render();

  const canvas = app.canvas as HTMLCanvasElement;
  canvas.id = 'probe';
  root.appendChild(canvas);
  const ship = world.ships.find((s) => s.id === 0)!;
  (window as unknown as { __a0_53_renderer?: unknown }).__a0_53_renderer = {
    bounds: { w: world.bounds.width, h: world.bounds.height },
    ship: { x: ship.pos.x, y: ship.pos.y },
  };
}
