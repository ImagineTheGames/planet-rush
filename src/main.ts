/**
 * src/main.ts — client bootstrap. OWNER: Platform Engineer.
 *
 * Wires the platform seam, the input funnel, the fixed-timestep loop, and the
 * PixiJS render layer into the day-1 playable build (GDD §4.6 day 1: "ship
 * flies, shoots, mines … touch controls ship alongside keyboard/mouse and
 * gamepad"). All input becomes abstract `Action`s here before it crosses into
 * the sim — the sim never sees a device (GDD §2.4).
 */
import { Application } from 'pixi.js';
import { ShipClass } from '@shared/types';
import type { Action } from '@shared/types';
import { createWorld, step, BEAM_RANGE } from './sim';
import {
  createControlState,
  mapActions,
  defaultFireMode,
  resetControlState,
  FireMode,
} from '@platform/actions';
import type { ControlState } from '@platform/actions';
import { GameLoop } from '@platform/loop';
import { KeyboardMouseSource, GamepadSource } from '@platform/input';
import type { InputSource } from '@platform/input';
import { TouchController } from '@platform/touch';
import { createBrowserPlatform } from '@platform/platform';
import { Renderer, PLAYER_COLORS } from '@render/index';
import type { BeamView } from '@render/index';

const LOCAL_PLAYER = 0;
const PLAYER_COUNT = 8;
const FIRE_MODE_KEY = 'planet-rush:fireMode';

async function boot(): Promise<void> {
  const platform = createBrowserPlatform();

  const app = new Application();
  await app.init({
    background: 0x0d1015, // Cold Vacuum background (style-guide §1)
    resizeTo: window,
    antialias: true,
    // Respect device pixel ratio for crisp rendering on mobile (amendment §1).
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById('app');
  if (mount) mount.appendChild(app.canvas);
  app.canvas.style.touchAction = 'none'; // sticks own the gestures (amendment §2)

  // --- Sim world: a full ring so the field reads; only LOCAL_PLAYER is driven.
  const world = createWorld({
    seed: 1,
    players: Array.from({ length: PLAYER_COUNT }, (_, id) => ({
      id,
      shipClass: ShipClass.Vanguard,
    })),
  });

  // --- Renderer.
  const renderer = new Renderer(app.stage, app.screen.width, app.screen.height);

  // --- Input: per-device control states, merged into one each frame.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let fireMode = readFireMode(platform, isTouch);

  const merged = createControlState();
  const sources: { source: InputSource; state: ControlState }[] = [
    {
      source: new KeyboardMouseSource(() => ({ x: app.screen.width / 2, y: app.screen.height / 2 })),
      state: createControlState(),
    },
    { source: new GamepadSource(), state: createControlState() },
  ];

  const touch = new TouchController({ screenWidth: app.screen.width });
  touch.setFireMode(fireMode);
  const touchState = createControlState();
  bindTouch(app.canvas, touch);

  // --- Fixed-timestep loop: sample input → step sim → render (GDD §4.1).
  const loop = new GameLoop({
    update: () => {
      step(world, [{ id: LOCAL_PLAYER, actions: sampleInput() }]);
    },
    render: () => {
      renderer.draw(world, { cameraTarget: LOCAL_PLAYER, beams: currentBeams() });
    },
  });

  /** Merge every device's control state into one, then map to abstract actions. */
  function sampleInput(): Action[] {
    for (const s of sources) {
      resetControlState(s.state);
      s.source.update(s.state);
    }
    resetControlState(touchState);
    touch.writeInto(touchState);

    resetControlState(merged);
    for (const s of sources) mergeControl(merged, s.state);
    mergeControl(merged, touchState);

    return mapActions(merged, fireMode);
  }

  /** The local ship's beam segment when firing (render is told; sim has no beam). */
  function currentBeams(): BeamView[] {
    if (!merged.fire) return EMPTY_BEAMS;
    const ship = world.ships.find((s) => s.id === LOCAL_PLAYER);
    if (!ship || !ship.alive) return EMPTY_BEAMS;
    return [
      {
        from: ship.pos,
        to: {
          x: ship.pos.x + Math.cos(ship.angle) * BEAM_RANGE,
          y: ship.pos.y + Math.sin(ship.angle) * BEAM_RANGE,
        },
        color: PLAYER_COLORS[LOCAL_PLAYER] ?? 0x4dc3ff,
      },
    ];
  }

  // --- Viewport: keep renderer and touch halves in sync with the canvas.
  window.addEventListener('resize', () => {
    renderer.resize(app.screen.width, app.screen.height);
    touch.setScreenWidth(app.screen.width);
  });

  // --- Fire-mode toggle: single key for day-1 (UI owns the settings screen).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') {
      fireMode = fireMode === FireMode.Manual ? FireMode.AutoAim : FireMode.Manual;
      touch.setFireMode(fireMode);
      platform.storage.set(FIRE_MODE_KEY, fireMode);
    }
  });

  loop.start();

  // Register the service worker (PWA app-shell caching, GDD §4.1). Optional and
  // best-effort — mobile-browser play survives without it (§4.9).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline install is a nice-to-have; never block boot on it */
    });
  }
}

const EMPTY_BEAMS: BeamView[] = [];

/** Read the persisted fire mode, falling back to the platform default (§2.4). */
function readFireMode(platform: ReturnType<typeof createBrowserPlatform>, isTouch: boolean): FireMode {
  const stored = platform.storage.get(FIRE_MODE_KEY);
  if (stored === FireMode.Manual || stored === FireMode.AutoAim) return stored;
  return defaultFireMode(isTouch);
}

/** Combine one device's control state into the accumulator: strongest thrust
 *  wins, latest aim wins, held states OR together (GDD §2.4 auto device-switch). */
function mergeControl(dst: ControlState, src: ControlState): void {
  const dm = dst.thrust.x * dst.thrust.x + dst.thrust.y * dst.thrust.y;
  const sm = src.thrust.x * src.thrust.x + src.thrust.y * src.thrust.y;
  if (sm > dm) {
    dst.thrust.x = src.thrust.x;
    dst.thrust.y = src.thrust.y;
  }
  if (src.aim) dst.aim = src.aim;
  dst.fire = dst.fire || src.fire;
  dst.boost = dst.boost || src.boost;
  dst.build = dst.build || src.build;
  if (!dst.ping && src.ping) dst.ping = src.ping;
}

/** Route the canvas's touch pointer events into the twin-stick controller. */
function bindTouch(canvas: HTMLCanvasElement, touch: TouchController): void {
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerDown({ id: e.pointerId, x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerMove({ id: e.pointerId, x: e.clientX, y: e.clientY });
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    touch.onPointerUp(e.pointerId);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  window.addEventListener('blur', () => touch.clear());
}

void boot();
