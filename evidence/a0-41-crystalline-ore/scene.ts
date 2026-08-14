/**
 * evidence/a0-41-crystalline-ore/scene.ts — one frame of the ore field, drawn by
 * the SHIPPED `Renderer` against real WebGL.
 *
 * Everything here is the production path: `stressWorld()` is the GDD §4.3 scene
 * the perf harness uses, `Renderer` is the shipped class, and `app.renderer` is
 * passed in as the baker exactly as `main.ts` passes it — which matters, because
 * a0-41 is a change to a POOLED texture and a renderer with no baker draws over
 * blank ones. Nothing is re-implemented for the picture.
 *
 * Two captures, and the second is the point: the ore chunk is 6 world units, so
 * it is ~13 px on a 1:1 desktop frame — the size at which the developer said it
 * read as *"just a simple circle"*. `?zoom=N` scales the world root about the
 * camera centre so the same shipped frame can be looked at closely, without
 * drawing anything different.
 *
 * `?chunks=only` hides every other entity layer, so the before/after diff is the
 * ore and not the field it drifts through.
 */

import { Application, Container } from 'pixi.js';
import { stressWorld } from '../../harness/perf';
import { Renderer, type RenderView } from '../../src/render';

const params = new URLSearchParams(location.search);
const zoom = Number(params.get('zoom') ?? 1);
const only = params.get('chunks') === 'only';
const WIDTH = 1280;
const HEIGHT = 800;

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    width: WIDTH,
    height: HEIGHT,
    background: 0x0d1015,
    antialias: true,
    preference: 'webgl',
    autoStart: false,
    autoDensity: false,
    resolution: 1,
  });
  document.body.appendChild(app.canvas);

  const stage = new Container();
  app.stage.addChild(stage);
  const renderer = new Renderer(
    stage,
    { width: WIDTH, height: HEIGHT, originX: 0, originY: 0 },
    { baker: app.renderer, resolution: 1 },
  );

  const world = stressWorld();
  const view: RenderView = { cameraTarget: 0, muzzles: [] };
  renderer.draw(world, view);

  // The camera is translate-only, so a zoom is a scale on the world root —
  // applied AFTER `draw`, so the cull, the pooling and every sprite's own
  // transform are untouched and what is magnified is the real frame.
  //
  // It is centred on a CHUNK rather than on the screen centre, because the
  // screen centre is the camera target's own ship parked at its station, and a
  // magnified picture of that is not evidence about ore. The chunk chosen is the
  // one nearest the camera target that the renderer actually left visible, so
  // the frame is a real one and the subject is in it.
  const root = stage.getChildByLabel('boundary', true)?.parent as Container | undefined;
  if (root && zoom !== 1) {
    const me = world.ships.find((s) => s.id === 0) ?? world.ships[0]!;
    const drawn = (stage.getChildByLabel('chunks', true) as Container).children.filter((c) => c.visible);
    const focus = drawn
      .map((c) => ({ x: c.x, y: c.y, d: Math.hypot(c.x - me.pos.x, c.y - me.pos.y) }))
      .sort((a, b) => a.d - b.d)[0] ?? { x: me.pos.x, y: me.pos.y };
    root.scale.set(zoom);
    root.x = WIDTH / 2 - focus.x * zoom;
    root.y = HEIGHT / 2 - focus.y * zoom;
  }
  if (only && root) {
    for (const layer of root.children) {
      if (layer.label && layer.label !== 'chunks') layer.visible = false;
    }
  }

  app.renderer.render(app.stage);
  // The signal `capture.mjs` waits on: the frame is on the canvas.
  (window as unknown as { __oreScene?: boolean }).__oreScene = true;
}

void main();
