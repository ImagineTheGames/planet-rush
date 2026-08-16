/**
 * evidence/a0-53-bloom-radius/field-probe.ts — **the shipping star-field, at an
 * offset that makes every star's screen position known.** OWNER: Art Agent.
 *
 * The real {@link VoidBackdrop}, through its real `configure`/`update` API, on
 * the real Pixi path — nothing re-implemented, exactly as `sky-preview.ts`'s
 * middle panel does it. Driven at the camera offset the client published, so the
 * same `starFieldSprite(spec, seed, w, h)` call in Node names every star in the
 * frame: its magnitude, its radius, and the halo it declared.
 *
 * Sky is NONE (`octagon`), which is also what the frozen desktop golden boots,
 * so nothing but ground and stars is in the frame.
 *
 * Every knob the app's own `Application.init` sets is overridable, so the probe
 * can be run AS THE GAME RUNS IT and the difference between the two frames is a
 * measurement rather than an argument.
 *
 * `/evidence/a0-53-bloom-radius/field-probe.html?offx=-1328&offy=-800`
 */
import { Application } from 'pixi.js';
import { VoidBackdrop } from '../../src/art/backdrop';

export const VIEW = { w: 1280, h: 800 };
/** `octagon`'s arena (`src/sim/constants` `WORLD_SIZE`). */
export const BOUNDS = { w: 2400, h: 2400 };

export async function mountFieldProbe(root: HTMLElement): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const app = new Application();
  await app.init({
    width: VIEW.w,
    height: VIEW.h,
    background: q.get('bg') === 'vacuum' ? 0x0d1015 : 0x000000,
    antialias: q.get('aa') === '1',
    // dpr 1: one canvas pixel is one device pixel, so a measured radius needs no
    // correction.
    resolution: Number(q.get('res') ?? 1),
    autoDensity: q.get('autoDensity') === '1',
    // The app passes no preference (`src/main.ts`), so forcing one here would be
    // a difference this probe invented.
    ...(q.get('pref') ? { preference: q.get('pref') as 'webgl' | 'webgpu' } : {}),
  });

  const backdrop = new VoidBackdrop();
  backdrop.setMap('octagon'); // sky NONE — ground + stars, nothing else
  // The app does not configure once: boot resizes the viewport and sets the map,
  // and each change runs `configure`'s destroy-and-replay path.
  if (q.get('rebuild') === '1') backdrop.configure(BOUNDS.w, BOUNDS.h, 800, 600);
  backdrop.configure(BOUNDS.w, BOUNDS.h, VIEW.w, VIEW.h);
  backdrop.update(Number(q.get('offx') ?? 0), Number(q.get('offy') ?? 0), VIEW.w, VIEW.h);
  app.stage.addChild(backdrop.view);
  for (let i = 0; i < Number(q.get('frames') ?? 1); i++) app.render();

  const canvas = app.canvas as HTMLCanvasElement;
  canvas.id = 'probe';
  root.appendChild(canvas);
  (window as unknown as { __a0_53_field?: unknown }).__a0_53_field = {
    view: VIEW,
    bounds: BOUNDS,
    nebula: backdrop.nebulaId,
    density: backdrop.skyDensity,
    rendererName: (app.renderer as unknown as { name?: string }).name,
  };
}
