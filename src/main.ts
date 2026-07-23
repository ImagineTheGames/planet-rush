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
import type { Action, Vec2 } from '@shared/types';
import { createWorld, step, BEAM_RANGE } from './sim';
import {
  createControlState,
  mapActions,
  defaultFireMode,
  resetControlState,
  FireMode,
} from '@platform/actions';
import type { ControlState, DeviceKind } from '@platform/actions';
import { GameLoop } from '@platform/loop';
import { KeyboardMouseSource, GamepadSource } from '@platform/input';
import type { InputSource } from '@platform/input';
import { TouchController } from '@platform/touch';
import { TouchVisuals } from '@platform/touch-visuals';
import { RotateOverlay, shouldShowRotateOverlay, requestLandscape } from '@platform/orientation';
import { createBrowserPlatform } from '@platform/platform';
import { writeAffordanceRects } from '@platform/touch-visuals';
import type { TouchAffordanceRects } from '@platform/touch-visuals';
import {
  LayoutRegistry,
  installLayoutHook,
  parseDebugFlags,
  isLayoutContributor,
} from '@platform/layout-registry';
import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
import { advanceToFreezeTick, hashWorld, FREEZE_TICK } from '@platform/freeze';
import { Renderer, PLAYER_COLORS } from '@render/index';
import type { BeamView } from '@render/index';
import { Hud } from './ui';
import type { HudFrame } from './ui';

const LOCAL_PLAYER = 0;
const PLAYER_COUNT = 8;
const FIRE_MODE_KEY = 'planet-rush:fireMode';

async function boot(): Promise<void> {
  const platform = createBrowserPlatform();

  // Dev flags (?debug=1, ?freeze=1). Off in a normal build — everything gated on
  // `flags.debug` below is zero-cost when the query string is absent.
  const flags = parseDebugFlags(typeof window !== 'undefined' ? window.location.search : '');

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

  // --- HUD overlay: screen-space, added after the world root so it draws on top
  //     of the render layer in the same canvas (ui/hud.ts owns the layout).
  const hud = new Hud(app.screen.width, app.screen.height);
  app.stage.addChild(hud);

  // --- Input: per-device control states, merged into one each frame.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // --- Touch controls made visible (touch-visuals.ts) — the dynamic sticks and
  //     the fire-mode morph the player actually sees. On top of the HUD so the
  //     thumbs read clearly; the layer hides itself entirely on desktop.
  const touchVisuals = new TouchVisuals();
  app.stage.addChild(touchVisuals);

  // --- Portrait handling (orientation.ts): a ROTATE overlay where landscape
  //     lock is unsupported (iOS Safari). Added last so it covers everything.
  const rotateOverlay = new RotateOverlay(app.screen.width, app.screen.height);
  app.stage.addChild(rotateOverlay);
  let fireMode = readFireMode(platform, isTouch);
  // The active input device drives the controls strip + prompt wording (GDD
  // §2.4 auto device-switch); updated in sampleInput() by whichever device acts.
  let activeDevice: DeviceKind = isTouch ? 'touch' : 'keyboard';

  const merged = createControlState();
  const sources: { source: InputSource; state: ControlState; device: DeviceKind }[] = [
    {
      source: new KeyboardMouseSource(() => ({ x: app.screen.width / 2, y: app.screen.height / 2 })),
      state: createControlState(),
      device: 'keyboard',
    },
    { source: new GamepadSource(), state: createControlState(), device: 'gamepad' },
  ];

  const touch = new TouchController({ screenWidth: app.screen.width });
  touch.setFireMode(fireMode);
  const touchState = createControlState();
  bindTouch(app.canvas, touch);

  // --- HUD feed: one reusable mutable HudFrame, overwritten in place every frame
  //     so the feed path allocates nothing (GDD §4.3). All fields are primitives.
  const hudFrame: { -readonly [K in keyof HudFrame]: HudFrame[K] } = {
    cargo: 0,
    cargoCap: 0,
    banked: 0,
    time: 0,
    device: activeDevice,
    fireMode,
    isTouch,
    nearAsteroid: false,
  };

  // --- Freeze (?freeze=1, with ?debug=1): advance the sim to a fixed seeded
  //     tick, then hold it there so screenshots are deterministic across boots
  //     (GDD §4.8). The world is plain seeded data + a pure `step`, so pinning
  //     the entry point pins the frame (src/platform/freeze.ts).
  if (flags.freeze) advanceToFreezeTick(world, FREEZE_TICK);
  const frozenHash = flags.freeze ? hashWorld(world) : null;

  // --- Layout registry (?debug=1): every positioned visual element registers
  //     its declared anchor + actual rendered rect each frame, exposed READ-ONLY
  //     at window.__planetRush.layout (src/platform/layout-registry.ts). Null —
  //     and every registration below skipped — in a normal build.
  const registry = flags.debug ? new LayoutRegistry() : null;
  const touchRects: TouchAffordanceRects = { leftStickZone: null, aimZone: null, fireButton: null };
  const shipRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  if (registry) {
    installLayoutHook({
      registry,
      viewport: (): Viewport => ({ width: app.screen.width, height: app.screen.height }),
      frozen: () => flags.freeze,
      freezeTick: () => (flags.freeze ? FREEZE_TICK : null),
      worldHash: () => frozenHash,
    });
  }

  // --- Fixed-timestep loop: sample input → step sim → render (GDD §4.1).
  const loop = new GameLoop({
    update: () => {
      if (flags.freeze) return; // sim is pinned at the seeded freeze tick
      step(world, [{ id: LOCAL_PLAYER, actions: sampleInput() }]);
    },
    render: () => {
      renderer.draw(world, { cameraTarget: LOCAL_PLAYER, beams: currentBeams() });
      feedHud();
      hud.update(hudFrame);
      // Draw the visible touch controls from the live stick/button state (a
      // no-op layer on desktop). Reads the viewport each frame so the idle
      // affordances and FIRE button track resize/orientation flips.
      touchVisuals.update(touch, isTouch, app.screen.width, app.screen.height);
      // Refresh the layout registry from what was just drawn (debug only).
      if (registry) refreshLayout(registry);
    },
  });

  /** Merge every device's control state into one, then map to abstract actions.
   *  Also tracks the active device (latest to act wins) for the HUD (GDD §2.4). */
  function sampleInput(): Action[] {
    for (const s of sources) {
      resetControlState(s.state);
      s.source.update(s.state);
      if (controlActive(s.state)) activeDevice = s.device;
    }
    resetControlState(touchState);
    touch.writeInto(touchState);
    if (controlActive(touchState)) activeDevice = 'touch';

    resetControlState(merged);
    for (const s of sources) mergeControl(merged, s.state);
    mergeControl(merged, touchState);

    return mapActions(merged, fireMode);
  }

  /** Fill the reusable HudFrame from the local ship + world — no allocation
   *  (predicate hoisted; primitive fields overwritten in place). */
  function feedHud(): void {
    hudFrame.time = world.time;
    hudFrame.device = activeDevice;
    hudFrame.fireMode = fireMode;
    hudFrame.isTouch = isTouch;
    const ship = world.ships.find(isLocalShip);
    if (!ship) return;
    hudFrame.cargo = ship.cargo;
    hudFrame.cargoCap = ship.cargoCap;
    hudFrame.banked = ship.banked;
    hudFrame.nearAsteroid = nearAsteroid(ship.pos);
  }

  /** Refresh the layout registry from this frame's drawn state (debug only).
   *  Every positioned element registers its declared anchor + actual rendered
   *  rect, so a tool can assert "it appears where it's supposed to" (the whole
   *  point of the registry). Owned elements register precise, self-computed
   *  bounds; HUD-owned elements come through the public {@link isLayoutContributor}
   *  seam when the UI exposes it (see PR notes). */
  function refreshLayout(reg: LayoutRegistry): void {
    const w = app.screen.width;
    const h = app.screen.height;
    reg.beginFrame();

    // Local ship: the camera keeps it centred (GDD §2.2) → anchor `center`.
    const ship = world.ships.find(isLocalShip);
    if (ship && ship.alive) {
      const r = ship.radius;
      shipRect.x = w / 2 - r;
      shipRect.y = h / 2 - r;
      shipRect.width = 2 * r;
      shipRect.height = 2 * r;
      reg.register('ship-local', SHIP_ANCHOR, shipRect);
    }

    // Touch controls: anchored home rects from the same constants that draw them
    // (touch-visuals). All null on desktop, so nothing registers there.
    writeAffordanceRects(isTouch, fireMode, w, h, touchRects);
    if (touchRects.leftStickZone) reg.register('touch-left-stick', LEFT_STICK_ANCHOR, touchRects.leftStickZone);
    if (touchRects.aimZone) reg.register('touch-aim-stick', RIGHT_STICK_ANCHOR, touchRects.aimZone);
    if (touchRects.fireButton) reg.register('touch-fire-button', RIGHT_STICK_ANCHOR, touchRects.fireButton);

    // HUD-owned elements (ore HUD, banked total, wave clock, controls strip,
    // onboarding prompt): registered via the Hud's public describeLayout() seam
    // if present. Not implemented at M1 — see PR notes; no src/ui internals are
    // touched, and the registry lights them up the moment the seam lands.
    if (isLayoutContributor(hud)) {
      for (const e of hud.describeLayout({ width: w, height: h })) {
        reg.register(e.id, e.anchor, e.bounds);
      }
    }
  }

  /** True if any asteroid is within beam reach of `pos` — the mine prompt's
   *  trigger (GDD §2.10). Plain loop; allocates nothing. */
  function nearAsteroid(pos: Vec2): boolean {
    for (const a of world.asteroids) {
      const dx = a.pos.x - pos.x;
      const dy = a.pos.y - pos.y;
      const reach = BEAM_RANGE + a.radius;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
    return false;
  }

  /** The local ship's beam segment when firing (render is told; sim has no beam).
   *  Mutates one reusable scratch beam/array — no per-frame allocation while fire
   *  is held (mirrors EMPTY_BEAMS for the idle case; GDD §4.3b risk 5). */
  function currentBeams(): BeamView[] {
    if (!merged.fire) return EMPTY_BEAMS;
    const ship = world.ships.find((s) => s.id === LOCAL_PLAYER);
    if (!ship || !ship.alive) return EMPTY_BEAMS;
    SCRATCH_BEAM.from = ship.pos;
    SCRATCH_BEAM_TO.x = ship.pos.x + Math.cos(ship.angle) * BEAM_RANGE;
    SCRATCH_BEAM_TO.y = ship.pos.y + Math.sin(ship.angle) * BEAM_RANGE;
    SCRATCH_BEAM.color = PLAYER_COLORS[LOCAL_PLAYER] ?? 0x4dc3ff;
    return SCRATCH_BEAMS;
  }

  // --- Viewport: keep renderer, touch halves, HUD, and overlay in sync with the
  //     canvas. Re-run on both resize and orientationchange so the canvas
  //     re-layouts when a phone is turned (mobile amendment §2, gap #2).
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    renderer.resize(w, h);
    touch.setScreenWidth(w);
    hud.resize(w, h);
    rotateOverlay.resize(w, h);
    refreshOrientation();
  }

  /** Show the ROTATE overlay only on a touch device that cannot lock landscape
   *  (iOS Safari) while the viewport is portrait; hidden the moment it turns
   *  landscape (mobile amendment §2). Dimensions read at the DOM edge here. */
  function refreshOrientation(): void {
    const show =
      isTouch && shouldShowRotateOverlay(window.innerWidth, window.innerHeight, platform.canLockOrientation());
    rotateOverlay.setShown(show);
  }

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  refreshOrientation();

  // --- First touch gesture: enter fullscreen + lock to landscape (Android
  //     path; best-effort, never throws). Fullscreen/lock require a user
  //     gesture, so this fires once on the first touch (mobile amendment §2).
  if (isTouch) {
    app.canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        requestLandscape(platform);
      },
      { once: true },
    );
  }

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

// --- Layout anchors (declared regions; ratified vocabulary — see
//     layout-registry.ts). The registry checks each element's actual bounds
//     against these zones.
const SHIP_ANCHOR: AnchorSpec = { region: 'center' };
const LEFT_STICK_ANCHOR: AnchorSpec = { region: 'left-half-bottom', margin: 8 };
const RIGHT_STICK_ANCHOR: AnchorSpec = { region: 'right-half-bottom', margin: 8 };

const EMPTY_BEAMS: BeamView[] = [];

// Reusable scratch beam for the firing case: mutated in place each frame so the
// hot render path allocates nothing while fire is held (GDD §4.3b risk 5). The
// `to` endpoint and `from`/`color` fields are overwritten per frame in
// currentBeams(); typed mutable here (BeamView's fields are readonly to callers).
const SCRATCH_BEAM_TO: Vec2 = { x: 0, y: 0 };
const SCRATCH_BEAM: { from: Vec2; to: Vec2; color: number } = {
  from: SCRATCH_BEAM_TO,
  to: SCRATCH_BEAM_TO,
  color: 0x4dc3ff,
};
const SCRATCH_BEAMS: BeamView[] = [SCRATCH_BEAM];

/** A control state carries a real intent this frame — used to pick the active
 *  device for the HUD. Mouse aim is excluded: it moves constantly and would peg
 *  the device to keyboard forever (GDD §2.4 auto device-switch). */
function controlActive(s: ControlState): boolean {
  return (
    s.thrust.x !== 0 ||
    s.thrust.y !== 0 ||
    s.fire ||
    s.boost ||
    s.build ||
    s.ping !== null
  );
}

/** Hoisted local-ship predicate so the per-frame lookup allocates no closure. */
function isLocalShip(s: { id: number }): boolean {
  return s.id === LOCAL_PLAYER;
}

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
