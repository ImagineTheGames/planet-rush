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
import { BEAM_RANGE } from './sim';
import { createLocalSession } from './net';
import {
  createControlState,
  mapActions,
  defaultFireMode,
  resetControlState,
  FireMode,
} from '@platform/actions';
import type { ControlState, DeviceKind } from '@platform/actions';
import { GameLoop } from '@platform/loop';
import { VfxAutoQuality } from '@platform/vfx-quality';
import { KeyboardMouseSource, GamepadSource } from '@platform/input';
import type { InputSource } from '@platform/input';
import { TouchController } from '@platform/touch';
import { bindTouchControls } from '@platform/touch-dom';
import { TouchVisuals } from '@platform/touch-visuals';
import { RotateOverlay, shouldShowRotateOverlay, requestLandscape } from '@platform/orientation';
import { createBrowserPlatform } from '@platform/platform';
import { InstallPromptController } from '@platform/install-prompt';
import { writeAffordanceRects } from '@platform/touch-visuals';
import type { TouchAffordanceRects } from '@platform/touch-visuals';
import {
  LayoutRegistry,
  installLayoutHook,
  parseDebugFlags,
  isLayoutContributor,
} from '@platform/layout-registry';
import type { AnchorSpec, Rect, Viewport as LayoutViewport } from '@platform/layout-registry';
import { advanceToFreezeTick, hashWorld, FREEZE_TICK } from '@platform/freeze';
import { installDebugHook } from '@platform/debug-hook';
import { BUILD_INFO, formatBootLine } from '@platform/build-info';
import type { Viewport } from '@platform/camera';
import { BuildBadge, BADGE_ID, BADGE_ANCHOR } from '@render/build-badge';
import { Renderer, PLAYER_COLORS } from '@render/index';
import type { BeamView } from '@render/index';
import { Hud } from './ui';
import type { HudFrame } from './ui';

const LOCAL_PLAYER = 0;
const PLAYER_COUNT = 8;
const FIRE_MODE_KEY = 'planet-rush:fireMode';

async function boot(): Promise<void> {
  // Which build is this? One line, first thing in the console, every build —
  // so a bug report can carry the sha instead of "the version I had open"
  // (src/platform/build-info.ts; the corner badge says the same thing on screen).
  console.info(formatBootLine(BUILD_INFO));

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

  // --- Match session: the client does not step the sim any more. Input leaves
  //     here as ordered input ticks over a `Transport`, and the world comes back
  //     from whoever holds authority (GDD §4.2). Offline that is a LocalLoopback
  //     running the authoritative sim in this process — no server, no internet,
  //     same protocol as the online match. A full ring so the field reads; only
  //     LOCAL_PLAYER is driven until the bots and the online lobby land.
  const session = createLocalSession({
    match: {
      seed: 1,
      players: Array.from({ length: PLAYER_COUNT }, (_, id) => ({
        id,
        shipClass: ShipClass.Vanguard,
      })),
    },
    localPlayer: LOCAL_PLAYER,
    // Offline the renderer reads the authoritative world directly, so the
    // binary snapshot stream is off: it would cost encoding for a wire that
    // isn't there. It turns on with the WebSocket transport.
    snapshotIntervalTicks: 0,
  });
  const world = session.world;

  // --- Renderer. The camera centres on the *visual* viewport (URL-bar / notch /
  //     fullscreen aware), not the raw canvas — see camera.ts and readViewport().
  let viewport: Viewport = readViewport();
  const renderer = new Renderer(app.stage, viewport);

  // --- Auto VFX-reduction (vfx-quality.ts): watches real frame times and engages
  //     the "reduce VFX" setting on a sustained drop below the fps floor (GDD
  //     §4.3, risk 5), releasing again with hysteresis once the device recovers.
  //     Fed the measured frame delta each render; the flag drives renderer VFX.
  const vfxQuality = new VfxAutoQuality();
  let lastRenderMs = performance.now();

  // --- Debug instrument (debug-hook.ts): only when ?debug=1. Exposes the read-
  //     only window.__planetRush the QA suite asserts centring against. Inert
  //     (and skipped in the render loop) otherwise.
  const debug = installDebugHook(window.location.search);
  const shipScreenScratch: Vec2 = { x: 0, y: 0 };

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

  // --- Build badge (render/build-badge.ts): the always-on corner stamp naming
  //     the build on screen. Above the HUD/controls so a screenshot always
  //     carries it, below the ROTATE overlay (which owns the screen when up).
  const buildBadge = new BuildBadge();
  // ?freeze=1 exists so the frame is byte-deterministic across boots (golden
  // screenshots). The stamp is the one thing on screen that changes every
  // commit, so it is the one thing freeze must hide — and the only case where
  // the badge is not shown. Every real build carries it.
  buildBadge.visible = !flags.freeze;
  app.stage.addChild(buildBadge);

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

  // Gamepad connect/disconnect are logged so the end-to-end verification pass can
  // confirm the pad registered (GDD §2.4). Polling in GamepadSource does the real
  // work — it scans for the first connected pad — so play needs no event here.
  window.addEventListener('gamepadconnected', (e) => {
    console.info(`[gamepad] connected: ${(e as GamepadEvent).gamepad.id}`);
  });
  window.addEventListener('gamepaddisconnected', () => {
    console.info('[gamepad] disconnected');
  });

  const touch = new TouchController({ screenWidth: app.screen.width });
  touch.setFireMode(fireMode);
  const touchState = createControlState();
  // Route the canvas's touch pointer events into the twin sticks (touch-dom.ts —
  // the filter/decode/route edge, unit-tested headless). CSS-pixel samples, the
  // same space the controller's half-split lives in.
  bindTouchControls(app.canvas, touch, window);

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
      viewport: (): LayoutViewport => ({ width: app.screen.width, height: app.screen.height }),
      frozen: () => flags.freeze,
      freezeTick: () => (flags.freeze ? FREEZE_TICK : null),
      worldHash: () => frozenHash,
    });
  }

  /** Fixed sim steps executed since boot — the sim's own clock, exposed via the
   *  ?debug=1 instrument. Counts real steps only, so it does not advance while
   *  the sim is pinned by ?freeze=1. */
  let simTicks = 0;

  // --- Fixed-timestep loop: sample input → step sim → render (GDD §4.1).
  const loop = new GameLoop({
    update: () => {
      if (flags.freeze) return; // sim is pinned at the seeded freeze tick
      // One input tick per fixed step, in order — the pulse the whole protocol
      // is built on. The transport advances the authoritative sim (GDD §4.2).
      session.sendInput(sampleInput());
      simTicks++;
    },
    render: () => {
      // Measure this real frame and let the auto-reducer decide VFX quality. In
      // freeze mode the sim is pinned for byte-deterministic goldens, so VFX stay
      // full — a reduced glow would change the frame the screenshot captures.
      const nowMs = performance.now();
      const frameSeconds = (nowMs - lastRenderMs) / 1000;
      lastRenderMs = nowMs;
      renderer.setReduceVfx(flags.freeze ? false : vfxQuality.sample(frameSeconds));

      renderer.draw(world, { cameraTarget: LOCAL_PLAYER, beams: currentBeams() });
      feedHud();
      hud.update(hudFrame);
      // Draw the visible touch controls from the live stick/button state (a
      // no-op layer on desktop). Reads the viewport each frame so the idle
      // affordances and FIRE button track resize/orientation flips.
      touchVisuals.update(touch, isTouch, app.screen.width, app.screen.height);
      // Keep the build stamp cornered as the viewport changes (two writes).
      buildBadge.update(app.screen.width, app.screen.height);
      // Refresh the layout registry from what was just drawn (debug only).
      if (registry) refreshLayout(registry);
      // Feed the QA centring instrument, if armed (?debug=1) — no work otherwise.
      if (debug.enabled) updateDebug();
    },
  });

  /** Push this frame's local-ship screen position into the debug instrument, in
   *  visual-viewport space (visible centre = {viewport.width/2, height/2}), so QA
   *  can assert centring. Reads the *actual* worldRoot transform via the renderer
   *  so it measures what is really drawn, not a recomputed ideal. */
  function updateDebug(): void {
    const ship = world.ships.find(isLocalShip);
    if (!ship) return;
    renderer.projectToScreen(ship.pos, shipScreenScratch); // canvas-local CSS px
    debug.update(
      shipScreenScratch.x - viewport.originX, // → visual-viewport space
      shipScreenScratch.y - viewport.originY,
      viewport.width,
      viewport.height,
      ship.pos.x, // world space — moves as the ship flies (camera keeps it centred)
      ship.pos.y,
      performance.now(),
      simTicks, // sim-time base: lets QA divide movement by ticks, not seconds
    );
  }

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

    // Build badge: declared bottom-right, actual rect measured from the real
    // text metrics — so a font swap that pushes the stamp off-corner is caught
    // by the placement check rather than by squinting at a screenshot. Skipped
    // when frozen, where the badge is hidden (the registry records what is
    // actually drawn, never what would have been).
    if (buildBadge.visible) reg.register(BADGE_ID, BADGE_ANCHOR, buildBadge.layoutBounds(w, h));

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

  /** The local ship's beam segment this frame, read from the sim's published
   *  beam geometry (m2-00): the line ends at `hitPoint` (or full range when the
   *  beam misses) so it never draws through what it strikes, and the impact
   *  glow rides the same hit point. Mutates one reusable scratch beam/array — no
   *  per-frame allocation while fire is held (mirrors EMPTY_BEAMS for the idle
   *  case; GDD §4.3b risk 5). */
  function currentBeams(): BeamView[] {
    const ship = world.ships.find((s) => s.id === LOCAL_PLAYER);
    const beam = ship?.beam;
    if (!beam) return EMPTY_BEAMS; // sim clears `beam` unless the ship fired this tick
    SCRATCH_BEAM.from = beam.origin;
    // `length` is clamped to the first hit (or full range on a miss), so the
    // endpoint is the hit point when there is one — never through the object.
    SCRATCH_BEAM_TO.x = beam.origin.x + beam.dir.x * beam.length;
    SCRATCH_BEAM_TO.y = beam.origin.y + beam.dir.y * beam.length;
    SCRATCH_BEAM.hit = beam.hitPoint; // null on a clean miss → no impact glow
    SCRATCH_BEAM.color = PLAYER_COLORS[LOCAL_PLAYER] ?? 0x4dc3ff;
    return SCRATCH_BEAMS;
  }

  // --- Viewport: keep renderer, touch halves, HUD, and overlay in sync with the
  //     canvas. Re-run on both resize and orientationchange so the canvas
  //     re-layouts when a phone is turned (mobile amendment §2, gap #2).
  function relayout(): void {
    const w = app.screen.width;
    const h = app.screen.height;
    // Camera centres on the *visual* viewport (read fresh from the DOM here, so it
    // never uses a cached/stale size after a resize or orientation flip). HUD,
    // touch halves, and the overlay lay out in canvas space (app.screen).
    viewport = readViewport();
    renderer.setViewport(viewport);
    touch.setScreenWidth(w);
    hud.resize(w, h);
    rotateOverlay.resize(w, h);
    refreshOrientation();
  }

  /** Read the current *visual* viewport (what the player actually sees) in the
   *  canvas's own CSS-pixel space. On mobile the canvas is sized to the layout
   *  viewport (`resizeTo: window`) but the URL bar, a notch (`safe-area-inset`),
   *  and fullscreen transitions crop and shift the visible region — `visualViewport`
   *  plus the canvas's client rect give the visible size and its offset within the
   *  canvas. Desktop (and browsers without `visualViewport`) fall back to the whole
   *  canvas. This is the one DOM read the camera path depends on. */
  function readViewport(): Viewport {
    const vv = window.visualViewport;
    if (vv) {
      const rect = app.canvas.getBoundingClientRect();
      return {
        width: vv.width,
        height: vv.height,
        originX: vv.offsetLeft - rect.left,
        originY: vv.offsetTop - rect.top,
      };
    }
    return { width: app.screen.width, height: app.screen.height, originX: 0, originY: 0 };
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
  // Mobile URL-bar show/hide and pinch reflow the *visual* viewport without a
  // window resize — these fire then. Fullscreen enter/exit reshapes it too. All
  // route through relayout so the camera re-centres on what's actually visible.
  window.visualViewport?.addEventListener('resize', relayout);
  window.visualViewport?.addEventListener('scroll', relayout);
  document.addEventListener('fullscreenchange', relayout);
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

  // --- PWA install prompt (install-prompt.ts): capture and defer the browser's
  //     `beforeinstallprompt` so install is offered on our terms, not via the
  //     disruptive infobar (GDD §4.1, §4.9). The visible affordance is UI's to
  //     wire onto `installPrompt.prompt()`; here we own the plumbing and log the
  //     signal so the phone-verification pass can confirm the app is installable.
  const installPrompt = new InstallPromptController(window, () => {
    if (installPrompt.canInstall) console.info('[pwa] installable — Add to Home Screen available');
    if (installPrompt.isInstalled) console.info('[pwa] installed');
  });
  // Exposed for a future settings/menu "Install" button (UI layer) without a
  // bare global reaching across ownership lines.
  (window as unknown as { __planetRushInstall?: InstallPromptController }).__planetRushInstall =
    installPrompt;

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
const SCRATCH_BEAM: { from: Vec2; to: Vec2; color: number; hit: Vec2 | null } = {
  from: SCRATCH_BEAM_TO,
  to: SCRATCH_BEAM_TO,
  color: 0x4dc3ff,
  hit: null,
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

void boot();
