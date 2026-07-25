/**
 * src/main.ts — client bootstrap. OWNER: Platform Engineer.
 *
 * Wires the platform seam, the input funnel, the fixed-timestep loop, and the
 * PixiJS render layer into the playable build. All input becomes abstract
 * `Action`s here before it crosses into the sim — the sim never sees a device
 * (GDD §2.4).
 *
 * **M2 (GDD §4.6): this boots a real match, not a sandbox.** Eight planets in a
 * ring, the local player owning slot 0's home and do-nothing bots (`src/bots`)
 * filing input for the other seven through the same ordered-input protocol a
 * human uses; the wave metronome, the collapse phase and win/loss running off
 * `world.match`; the Build & Upgrade wheel opening at your own planet and
 * spending through the sim's own `buildOrder` / `upgradeOrder`; the under-attack
 * alarm and the own-planet HP bar fed from the real core, shields and turrets.
 *
 * Everything below is *wiring*. Every decision it feeds on belongs to the module
 * that owns it: the sim answers "am I docked" (`isDocked`) and "has the field
 * collapsed" (`isCollapsed`), the UI decides what the wheel says and whether the
 * alarm sounds, the bots decide what the other seven slots do. This file's job
 * is that none of those answers is invented here.
 */
import { Application, Container } from 'pixi.js';
import { ShipClass } from '@shared/types';
import type { Action, Beam, PlayerId, Vec2 } from '@shared/types';
import {
  BEAM_RANGE,
  combatBeams,
  isCollapsed,
  isDocked,
  planetOf,
  shieldCount,
  shieldPool,
  turretCount,
} from './sim';
import type { CombatBeam, Planet, Turret, World } from './sim';
import { bootOfflineMatch } from '@platform/match-boot';
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
import { TouchVisuals, buildButtonRect } from '@platform/touch-visuals';
import { WheelInput, writeWheelOrders } from '@platform/wheel-input';
import {
  computeRootTransform,
  applyRootTransform,
  physicalToLogical,
  logicalToPhysical,
} from '@platform/orientation';
import type { RootTransform } from '@platform/orientation';
import { createBrowserPlatform } from '@platform/platform';
import { FullscreenLifecycle } from '@platform/fullscreen';
import { InstallPromptController } from '@platform/install-prompt';
import { writeAffordanceRects } from '@platform/touch-visuals';
import type { TouchAffordanceRects } from '@platform/touch-visuals';
import {
  LayoutRegistry,
  installLayoutHook,
  parseDebugFlags,
  isLayoutContributor,
  resolveAnchor,
  rectContains,
} from '@platform/layout-registry';
import type { AnchorSpec, Rect, Viewport as LayoutViewport } from '@platform/layout-registry';
import { advanceToFreezeTick, hashWorld, FREEZE_TICK } from '@platform/freeze';
import { installDebugHook } from '@platform/debug-hook';
import { installCombatDebug } from '@platform/combat-debug';
import { BUILD_INFO, formatBootLine, formatBuildBadge } from '@platform/build-info';
import { requireWebGl, probeWebGl } from '@platform/gl-probe';
import { describeBootFailure, showBootError } from '@platform/boot-error';
import type { Viewport } from '@platform/camera';
import { BuildBadge, BADGE_ID, BADGE_ANCHOR } from '@render/build-badge';
import {
  FullscreenAffordance,
  FS_AFFORDANCE_ID,
  FS_AFFORDANCE_ANCHOR,
} from '@render/fullscreen-affordance';
import { Renderer, PLAYER_COLORS } from '@render/index';
import type { BeamView } from '@render/index';
import {
  Hud,
  PANEL_ROW_HEIGHT,
  TRACK_ORDER,
  WHEEL_ORDER,
  panelSize,
  wheelRadius,
  buildButtonVisible,
  BUILD_BUTTON_ID,
  BUILD_BUTTON_ANCHOR,
  MainMenuView,
  SettingsView,
  mainMenuModel,
  mainMenuLayout,
  MAIN_MENU_ITEMS,
  settingsModel,
  createSettings,
  toggleReduceVfx,
  adjustVolume,
} from './ui';
import type { HudFrame, Combatant, SettingsState, SettingsTarget, MainMenuOption } from './ui';

const LOCAL_PLAYER = 0;
const FIRE_MODE_KEY = 'planet-rush:fireMode';
/** Match seed. Deterministic and never time-derived (GDD §4.8) — the lobby
 *  picks it once rooms exist (M4); until then every offline match is the same
 *  arena, which is also what makes a bug report reproducible. */
const MATCH_SEED = 1;
/** The onboarding default hull (GDD §2.11) — the lobby's job from M4. */
const LOCAL_SHIP_CLASS = ShipClass.Vanguard;
/** Index of UPGRADE SHIP: the one segment that opens a screen instead of
 *  spending (GDD §2.5). Read from the wheel's own order so it cannot drift. */
const UPGRADE_SEGMENT = WHEEL_ORDER.indexOf('upgrade');

async function boot(): Promise<void> {
  // Which build is this? One line, first thing in the console, every build —
  // so a bug report can carry the sha instead of "the version I had open"
  // (src/platform/build-info.ts; the corner badge says the same thing on screen).
  console.info(formatBootLine(BUILD_INFO));

  // Is there a GPU to draw on? Asked BEFORE Pixi is touched (gl-probe.ts), because
  // the day Chrome's GPU process wedged, `Application.init()` threw
  // `autoDetectRenderer: CanvasRenderer is not yet implemented` and the game died
  // to a black screen with only that stack. Throwing here routes the failure
  // through the one catch below and onto the friendly screen instead.
  const gl = requireWebGl();
  console.info(`WebGL available: ${gl.api}`);

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

  // The game root DOM element — the #app mount, which the canvas lives inside. It
  // is what we make fullscreen on PLAY (field request v0.1.1), so the whole game
  // takes the screen and the browser chrome (title bar) disappears.
  const mount = document.getElementById('app');
  if (mount) mount.appendChild(app.canvas);
  app.canvas.style.touchAction = 'none'; // sticks own the gestures (amendment §2)

  // Touch device? Drives the fire-mode default, the visible controls, AND the
  // landscape lock: a portrait mobile viewport is rotated to landscape (below).
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // --- Fullscreen lifecycle (field request v0.1.1; fullscreen.ts). On PLAY (a
  //     user gesture) on mobile, enter fullscreen on the game root and take the
  //     native landscape lock; handle the whole lifecycle after — a system-gesture
  //     exit keeps the game running and offers a re-enter affordance, a rejection
  //     (iPhone Safari) falls silently back to today's behaviour, and desktop is
  //     never auto-fullscreened. Reads/writes only through the platform seam.
  const fullscreen = new FullscreenLifecycle(platform, isTouch, mount ?? undefined);

  // --- The landscape lock (field report v0.1.1; orientation.ts). Planet Rush IS
  //     landscape on mobile, always: the whole game draws into ONE root container
  //     (`gameRoot`), and when a mobile viewport is held portrait that root is
  //     rotated 90° with width/height swapped, so the player sees a landscape game
  //     regardless of how the phone is held — no more asking them to rotate. Every
  //     module below lays out in the LOGICAL (always-landscape) viewport; only the
  //     pointer edge (`toLogical`) and this one transform touch physical space.
  const gameRoot = new Container();
  gameRoot.label = 'game-root';
  app.stage.addChild(gameRoot);
  let transform: RootTransform = computeRootTransform(app.screen.width, app.screen.height, isTouch);
  applyRootTransform(gameRoot, transform);

  /** Recompute the root transform from the live canvas size and re-apply it
   *  (resize / orientationchange). Called first in every relayout.
   *
   *  Pixi debounces `resizeTo: window` to the next animation frame, so on a
   *  synchronous resize/orientationchange event `app.screen` is still the OLD
   *  size — which would leave the transform (and the whole logical layout) a frame
   *  behind and, mid-rotation, read the wrong orientation entirely. `app.resize()`
   *  forces the pending resize to run now, so `app.screen` is fresh before we read
   *  it. This is what makes the rotate-and-back sequence re-layout every time. */
  function recomputeTransform(): void {
    app.resize();
    transform = computeRootTransform(app.screen.width, app.screen.height, isTouch);
    applyRootTransform(gameRoot, transform);
  }

  /** Map a raw physical pointer coordinate (`clientX/Y`) to the logical landscape
   *  point the game lays out in — un-rotating the tap so it lands on the control
   *  the player actually sees (the part that silently breaks). Reads the live
   *  transform, so it tracks orientation flips. */
  function toLogical(clientX: number, clientY: number): Vec2 {
    const rect = app.canvas.getBoundingClientRect();
    return physicalToLogical(clientX - rect.left, clientY - rect.top, transform);
  }

  /** Convert a rect measured in GLOBAL (physical canvas) space — as Pixi's
   *  `getBounds()` reports it, e.g. the UI's `describeLayout` — into the LOGICAL
   *  (landscape) space the layout registry reports in. Under the 90° root rotation
   *  an axis-aligned rect stays axis-aligned, so this maps two opposite corners
   *  and rebuilds the box; identity when un-rotated. Elements this file lays out
   *  itself (ship, sticks, badge) are already computed in logical space and skip it. */
  function physicalBoundsToLogical(b: Rect): Rect {
    if (!transform.rotated) return b;
    // physicalToLogical(px,py) = {x: py, y: physW − px}; applied to the rect's
    // corners this collapses to: x = top, y = physW − right, w = height, h = width.
    return { x: b.y, y: transform.x - b.x - b.width, width: b.height, height: b.width };
  }

  // --- Main menu (field report P1; GDD §4.6 M7). A clean boot opens the MAIN
  //     MENU and builds NO match world until the player presses PLAY — the bug
  //     the field report caught was that boot dropped the player straight into a
  //     match, the merged menus never wired into the boot path. `?debug=1` skips
  //     the menu and boots straight into a match exactly as before, so every
  //     existing live / live-stage / mobile harness and the frozen goldens keep
  //     the immediate-match boot they assert against (field report §3, §5). PLAY
  //     is the only path here that reaches `bootOfflineMatch`; SETTINGS reuses
  //     the Day-7 settings screen. The whole screen is `src/ui`'s; this awaits it.
  const mainMenu = flags.debug
    ? null
    : openMainMenu(app, platform, {
        root: gameRoot,
        logicalSize: () => ({ w: transform.logicalWidth, h: transform.logicalHeight }),
        toLogical,
        toPhysical: (lx, ly) => logicalToPhysical(lx, ly, transform),
        recomputeTransform,
        isRotated: () => transform.rotated,
        // PLAY is a valid user gesture (field request v0.1.1): enter fullscreen +
        // native landscape lock here. A no-op on desktop and where unsupported.
        enterImmersive: () => fullscreen.enter(),
      });
  if (mainMenu) await mainMenu.untilPlay();

  // --- The match. Eight slots, eight planets (GDD §2.1): this client flies one
  //     and the seven empty seats are filled by the cast (`src/bots`), each
  //     bringing its character's hull. The bots are an *action source*, not a
  //     special kind of player — they file input through the same ordered queue
  //     this client does, so the sim cannot tell a bot's tick from a human's
  //     (GDD §2.9). Offline the authority is a `LocalLoopback` in this process:
  //     no server, no internet, same protocol as the online match (GDD §4.2).
  //
  //     The composition lives in `@platform/match-boot` rather than here, so
  //     "does the client actually assemble a match" is a headless test rather
  //     than something only a browser can answer — which is the exact gap this
  //     milestone was retracted for.
  const match = bootOfflineMatch({
    seed: MATCH_SEED,
    localPlayer: LOCAL_PLAYER,
    shipClass: LOCAL_SHIP_CLASS,
  });
  const world = match.world;

  // The match world now exists — flip the menu's test seam so a clean-boot
  // live-stage run can prove it did NOT exist a moment ago, while the menu was up
  // (a no-op under ?debug=1, where there is no menu and this is null).
  mainMenu?.matchStarted();

  // --- Renderer. Added to `gameRoot` (not the raw stage) so the world rotates
  //     with everything else under the landscape lock. The camera centres on the
  //     LOGICAL viewport (landscape), URL-bar / notch / fullscreen aware on the
  //     un-rotated path — see camera.ts and readViewport().
  let viewport: Viewport = readViewport();
  const renderer = new Renderer(gameRoot, viewport);

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

  // --- Combat-visuals instrument (combat-debug.ts): only when ?debug=1. Exposes
  //     window.__planetRush.beams (the beam set actually drawn this frame, one per
  //     firing emitter) and .stageCombat() so a live-boot suite can prove the
  //     enemy/turret beam WIRING the m2-11 unit suite cannot reach. Inert otherwise.
  const combatDebug = installCombatDebug(window.location.search);
  if (combatDebug.enabled) combatDebug.setStager(() => stageCombatFor(world));

  // --- HUD overlay: screen-space, added after the world root so it draws on top
  //     of the render layer in the same canvas (ui/hud.ts owns the layout).
  const hud = new Hud(transform.logicalWidth, transform.logicalHeight);
  gameRoot.addChild(hud);

  // --- Health-bar live-stage seam (?debug=1 only). The enemy over-ship health
  //     bars shipped dead twice: the model was green but nothing on a real boot
  //     proved a *drawn* bar tracked a damaged enemy. This exposes a read-only
  //     `window.__healthbarStage` that a Playwright test drives to stage a bot
  //     taking damage and read back the bars the real layer drew. It arms the
  //     HUD's drawn-bar capture and, when a static frame is pinned (?freeze=1),
  //     parks an enemy beside the local ship at a chosen fill so a bar must
  //     appear. Behind ?debug=1, never present in a normal build, and it mutates
  //     only the plain sim data the boot path already reads — it does not reach
  //     into src/sim.
  if (flags.debug) {
    hud.enableHealthBarDebug();
    installHealthbarStage();
  }

  // --- Touch controls made visible (touch-visuals.ts) — the dynamic sticks and
  //     the fire-mode morph the player actually sees. On top of the HUD so the
  //     thumbs read clearly; the layer hides itself entirely on desktop.
  const touchVisuals = new TouchVisuals();
  gameRoot.addChild(touchVisuals);

  // --- Build badge (render/build-badge.ts): the always-on corner stamp naming
  //     the build on screen. Above the HUD/controls so a screenshot always
  //     carries it. Under the landscape lock it rides `gameRoot`, so it stays in
  //     the logical bottom-right corner however the phone is held.
  const buildBadge = new BuildBadge();
  // ?freeze=1 exists so the frame is byte-deterministic across boots (golden
  // screenshots). The stamp is the one thing on screen that changes every
  // commit, so it is the one thing freeze must hide — and the only case where
  // the badge is not shown. Every real build carries it.
  buildBadge.visible = !flags.freeze;
  gameRoot.addChild(buildBadge);

  // --- Re-enter-fullscreen affordance (fullscreen-affordance.ts): the small
  //     top-right button that appears only when the player has backed out of
  //     fullscreen on a device that can re-enter (field request v0.1.1). On
  //     gameRoot so it rides the landscape-lock rotation; above the HUD so a
  //     thumb can reach it. Hidden until `fullscreen.affordanceVisible()` says so.
  const fsAffordance = new FullscreenAffordance();
  gameRoot.addChild(fsAffordance);

  let fireMode = readFireMode(platform, isTouch);
  // The active input device drives the controls strip + prompt wording (GDD
  // §2.4 auto device-switch); updated in sampleInput() by whichever device acts.
  let activeDevice: DeviceKind = isTouch ? 'touch' : 'keyboard';

  const merged = createControlState();
  const sources: { source: InputSource; state: ControlState; device: DeviceKind }[] = [
    {
      source: new KeyboardMouseSource(() => ({ x: transform.logicalWidth / 2, y: transform.logicalHeight / 2 })),
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

  const touch = new TouchController({ screenWidth: transform.logicalWidth });
  touch.setFireMode(fireMode);
  const touchState = createControlState();
  // --- The Build & Upgrade wheel (GDD §2.5). `buildWheel` holds the two bits of
  //     screen state the pure UI models deliberately don't — is it up, is the
  //     upgrade panel in front of it — and turns a press into a segment. What
  //     the wheel *says* is `src/ui`'s; what a press *lands on* is here.
  const buildWheel = new WheelInput();
  /** The sim's own docking answer, refreshed each input tick. Read by the touch
   *  BUILD button (which exists only at your own planet) and the HUD. */
  let docked = false;
  /** Whether the open-build-wheel button is on screen this frame — the UI's own
   *  persistence rule (`buildButtonVisible`, src/ui/build-button.ts): docked, on
   *  touch, and nothing else. Pinning it here (not to wheel/onboarding state) is
   *  what makes building unable to take the button away (the field-report fix).
   *  One source drives the drawing, the hit target, and the layout registration. */
  let buildVisible = false;
  /** Rising-edge trackers: the wheel toggles on a *press* of `build`, and a
   *  press of `fire` confirms the pointed-at segment — neither on the hold. */
  let buildHeld = false;
  let fireHeld = false;
  /** Any wheel order placed this match — retires the SPEND onboarding prompt. */
  let hasOrdered = false;

  // Drawn-geometry scratch, overwritten per press (never per frame): the hit
  // targets are computed from the very functions `src/ui` draws the wheel and
  // the panel with, so a press lands on the wedge the player actually sees.
  const buildWheelLayout = { centerX: 0, centerY: 0, radius: 0, segments: WHEEL_ORDER.length };
  const panelLayout = {
    centerX: 0,
    centerY: 0,
    width: 0,
    height: 0,
    rowHeight: PANEL_ROW_HEIGHT,
    rows: TRACK_ORDER.length,
  };
  const pressPoint: Vec2 = { x: 0, y: 0 };

  // Wheel presses are bound **before** the twin sticks, and consume the event
  // when they land: at the target element listeners run in registration order,
  // so an open wheel gets first refusal on a tap and a thumb buying a turret
  // never also flies the ship. Mouse and touch are one gesture here (GDD §2.4).
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const w = transform.logicalWidth;
    const h = transform.logicalHeight;
    // Un-rotate the tap into logical space (landscape lock) so it lands on the
    // wheel/BUILD-button geometry drawn in that same space.
    const lp = toLogical(e.clientX, e.clientY);
    pressPoint.x = lp.x;
    pressPoint.y = lp.y;

    // The re-enter-fullscreen affordance — present only after the player backed
    // out of fullscreen (field request v0.1.1). This tap IS a fresh user gesture,
    // so re-entering fullscreen from here is legal. Consumes the event so the tap
    // doesn't also engage a stick under it.
    if (fsAffordance.visible && fsAffordance.hitTest(lp.x, lp.y, w, h)) {
      fullscreen.enter();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // The touch BUILD button — the E-equivalent, on screen only at your own
    // planet (GDD §2.4). Toggles the wheel exactly as E and Y do. The hit target
    // comes from the same `buildVisible` that draws it, so a tap can only land on
    // a button that is actually there.
    const build = buildButtonRect(isTouch, buildVisible, w, h);
    if (build && inRect(pressPoint, build)) {
      buildWheel.toggle();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    buildWheelLayout.centerX = w / 2;
    buildWheelLayout.centerY = h / 2;
    buildWheelLayout.radius = wheelRadius(w, h);
    const size = panelSize(w, h, TRACK_ORDER.length);
    panelLayout.centerX = w / 2;
    panelLayout.centerY = h / 2;
    panelLayout.width = size.width;
    panelLayout.height = size.height;

    if (buildWheel.press(pressPoint.x, pressPoint.y, buildWheelLayout, panelLayout, UPGRADE_SEGMENT)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  });

  // Route the canvas's touch pointer events into the twin sticks (touch-dom.ts —
  // the filter/decode/route edge, unit-tested headless). Samples are remapped
  // through the landscape lock (`toLogical`) so a physical portrait tap reaches
  // the controller as the rotated logical point — the half-split, sticks and
  // FIRE button all live in logical (landscape) space.
  bindTouchControls(app.canvas, touch, window, toLogical);

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

  // --- Over-entity health-bar feed: a reused pool of mutable combatant records
  //     and the frame array `feedCombatants()` fills each render, so the enemy
  //     hull bars allocate nothing after warm-up (GDD §4.3). See feedCombatants.
  const combatantPool: MutCombatant[] = [];
  const combatantFrame: Combatant[] = [];

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
      // The layout contract speaks the LOGICAL (landscape) viewport — the space
      // every element lays out in under the landscape lock (orientation.ts).
      viewport: (): LayoutViewport => ({ width: transform.logicalWidth, height: transform.logicalHeight }),
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
      // is built on. Every bot seat files for the same tick first, then this
      // client's input advances the authoritative sim (GDD §4.2, §2.9).
      match.tick(sampleInput());
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
      // Health bars over every non-local combat entity (GDD §2.2). Fed AFTER
      // renderer.draw so the camera transform is current: each combatant's world
      // position is projected to the same screen space the bars draw in. This is
      // the wiring the M2 field report caught missing — the model and the layer
      // were both right, but nothing ever handed the layer the enemies.
      feedCombatants();
      hud.update(hudFrame);
      // Draw the visible touch controls from the live stick/button state (a
      // no-op layer on desktop). Reads the LOGICAL viewport each frame so the
      // idle affordances and FIRE button track resize/orientation flips.
      touchVisuals.update(touch, isTouch, transform.logicalWidth, transform.logicalHeight, buildVisible);
      // Keep the build stamp cornered (logical bottom-right) as the viewport changes.
      buildBadge.update(transform.logicalWidth, transform.logicalHeight);
      // Fullscreen: fold in the live state (a system-gesture/ESC exit can happen
      // any frame) and show the re-enter affordance only once we've been fullscreen
      // and no longer are (field request v0.1.1). Corner it in logical space.
      fullscreen.sync();
      fsAffordance.update(fullscreen.affordanceVisible(), transform.logicalWidth, transform.logicalHeight);
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

    updateBuildWheel();
    return mapActions(merged, fireMode);
  }

  /**
   * Fold this frame's merged input into the Build & Upgrade wheel, then turn
   * whatever was bought into the one-shot order fields the funnel maps
   * (`@platform/actions`).
   *
   * Availability is the sim's answer, not a distance re-derived here: alive
   * ship, live core, `isDocked`. The wheel opens at your own planet and nowhere
   * else (GDD §2.5), and it closes itself the moment you fly off — so undocking
   * is always a way out of it.
   *
   * While it is open the ship holds still and holds fire. That is deliberate
   * rather than incidental: it frees the thrust stick to *point* the wheel and
   * the fire button to *confirm*, which is what gives the gamepad and the
   * keyboard a complete path to a purchase without inventing a binding the
   * controls strip would then have to explain (GDD §2.4).
   */
  function updateBuildWheel(): void {
    const ship = world.ships.find(isLocalShip);
    const planet = planetOf(world, LOCAL_PLAYER);
    docked = ship !== undefined && planet !== null && isDocked(ship, planet);
    buildVisible = buildButtonVisible({ docked, isTouch });
    buildWheel.setAvailable(docked && planet !== null && planet.alive && ship !== undefined && ship.alive);

    // E / Y / the BUILD button: one press opens, the next closes.
    if (merged.build && !buildHeld && (docked || buildWheel.open)) buildWheel.toggle();
    buildHeld = merged.build;

    const confirmPressed = merged.fire && !fireHeld;
    fireHeld = merged.fire;

    if (buildWheel.open) {
      buildWheel.aim(merged.thrust.x, merged.thrust.y, WHEEL_ORDER.length);
      if (confirmPressed) buildWheel.confirm(UPGRADE_SEGMENT);
      merged.thrust.x = 0;
      merged.thrust.y = 0;
      merged.fire = false;
    }

    // Four segments spend on the spot; the fifth opened a screen and never
    // reaches here (GDD §2.5). The sim validates every one of them again —
    // ownership, docking, cost, caps — and refuses on its own terms.
    if (writeWheelOrders(buildWheel, merged, WHEEL_ORDER, TRACK_ORDER)) hasOrdered = true;
  }

  /**
   * Fill the reusable HudFrame from the local ship, its home, and the match —
   * no allocation (predicate hoisted; every field a primitive or a reference to
   * live sim data the HUD only reads).
   *
   * Three of the M2 elements are fed here and nowhere else, and each is a
   * mechanic rather than a readout (GDD §2.2):
   *
   *  - **Own-planet HP** comes off the real core, with the shield pool over it.
   *  - **The under-attack alarm** derives its damage from the fall in
   *    core + shields + turrets between frames, so a turret being picked off at
   *    the edge of its range rings it exactly as a beam on the core does — and a
   *    single stray shot does not (the sustained-damage trigger is `src/ui`'s).
   *  - **The wave clock and the collapse state** are `world.time` and the sim's
   *    own `isCollapsed`, so the clock on screen is the clock the match runs on.
   */
  function feedHud(): void {
    hudFrame.time = world.time;
    hudFrame.device = activeDevice;
    hudFrame.fireMode = fireMode;
    hudFrame.isTouch = isTouch;
    hudFrame.owner = LOCAL_PLAYER;
    hudFrame.collapsed = isCollapsed(world);
    hudFrame.buildRequested = buildWheel.open;
    hudFrame.upgradePanelOpen = buildWheel.panelOpen;
    hudFrame.hasOrdered = hasOrdered;
    hudFrame.docked = docked;

    const planet = planetOf(world, LOCAL_PLAYER);
    if (planet) {
      hudFrame.coreHp = planet.coreHp;
      hudFrame.maxCoreHp = planet.maxCoreHp;
      hudFrame.shieldHp = shieldPool(planet);
      hudFrame.maxShieldHp = shieldPoolMax(planet);
      hudFrame.turretHp = turretPool(planet);
      hudFrame.planetAlive = planet.alive;
      hudFrame.turrets = turretCount(planet);
      hudFrame.shields = shieldCount(planet);
      hudFrame.homePos = planet.pos;
    }

    const ship = world.ships.find(isLocalShip);
    if (!ship) return;
    hudFrame.cargo = ship.cargo;
    hudFrame.cargoCap = ship.cargoCap;
    hudFrame.banked = ship.banked;
    hudFrame.nearAsteroid = nearAsteroid(ship.pos);
    hudFrame.shipAlive = ship.alive;
    hudFrame.shipClass = ship.shipClass;
    hudFrame.upgradeTiers = ship.tiers;
    hudFrame.shipPos = ship.pos;
  }

  /**
   * Build this frame's over-entity health-bar feed from live sim state and hand
   * it to the HUD (GDD §2.2 — the hull bar over every non-local ship, plus enemy
   * turrets and hostile wave units). This is the boot-path wiring the field
   * report caught missing: `src/ui/healthbar` decides *which* entities get a bar
   * and what fill, but only if someone feeds it the entities — and until now
   * nobody did, so the bars were dead on a real boot even though the model tests
   * were green.
   *
   * Every enemy ship and every turret is offered; the pure model filters out the
   * local player's own (by ownership) and anything full-and-idle, so passing them
   * all is both correct and simplest. Positions are projected world → screen via
   * the renderer's *actual* camera transform (`projectToScreen`, called after
   * `renderer.draw`), so a bar sits exactly over the sprite and is a fixed screen
   * size regardless of zoom — the camera renders 1:1, so a world radius is a
   * screen radius.
   *
   * Allocation-free after warm-up (GDD §4.3): the combatant records are pooled
   * and overwritten in place, and the frame array is reused. The count is bounded
   * by the entity caps (≤8 ships, ≤32 turrets).
   */
  function feedCombatants(): void {
    let n = 0;
    for (const ship of world.ships) {
      if (ship.id === LOCAL_PLAYER) continue; // the local ship never gets a bar
      const c = combatantSlot(n++);
      c.owner = ship.id;
      c.hp = ship.hull;
      c.maxHp = ship.maxHull;
      c.alive = ship.alive;
      c.inCombat = ship.beam !== null; // firing this tick (sim publishes the beam)
      renderer.projectToScreen(ship.pos, c.pos);
      c.radius = ship.radius;
    }
    for (const planet of world.planets) {
      for (const turret of planet.turrets) {
        if (turret.owner === LOCAL_PLAYER) continue; // own turrets: read off HOME HP
        const c = combatantSlot(n++);
        c.owner = turret.owner;
        c.hp = turret.hp;
        c.maxHp = turret.maxHp;
        c.alive = turret.hp > 0;
        c.inCombat = turret.muzzle != null; // loosing a shot this tick
        renderer.projectToScreen(turret.pos, c.pos);
        c.radius = turret.radius;
      }
    }
    combatantFrame.length = 0;
    for (let i = 0; i < n; i++) combatantFrame.push(combatantPool[i]!);
    hudFrame.combatants = combatantFrame;
  }

  /** Pooled combatant record `i`, grown to fit and reused across frames so the
   *  feed allocates nothing after warm-up (GDD §4.3). */
  function combatantSlot(i: number): MutCombatant {
    let c = combatantPool[i];
    if (!c) {
      c = { owner: 0, hp: 0, maxHp: 0, alive: false, inCombat: false, pos: { x: 0, y: 0 }, radius: 0 };
      combatantPool[i] = c;
    }
    return c;
  }

  /**
   * Install `window.__healthbarStage` — the ?debug=1 live-stage seam a Playwright
   * test drives to prove the enemy health bars are wired on a real boot. Two
   * methods:
   *
   *  - `damageEnemy(fraction)` — park a live enemy ship a fixed offset from the
   *    local ship and set its hull to `fraction` of max, so the health-bar model
   *    must draw a bar over it (damaged ⇒ a bar). Best paired with `?freeze=1`,
   *    which pins the sim so the staged frame holds still. Returns the staged
   *    enemy's slot and the exact fill it was left at, or null if there is no
   *    enemy to stage.
   *  - `bars()` — the bars the real layer actually drew last frame (owner, fill,
   *    screen position), read back so the test can assert one tracks the enemy.
   *
   * Mutating `hull`/`pos` here is a debug-only staging affordance, not gameplay:
   * it writes the same plain sim data the render loop already reads every frame,
   * and lives entirely behind ?debug=1.
   */
  function installHealthbarStage(): void {
    const stage = {
      damageEnemy(fraction: number): { owner: PlayerId; fraction: number } | null {
        const local = world.ships.find(isLocalShip);
        const enemy = world.ships.find((s) => s.id !== LOCAL_PLAYER && !s.eliminated);
        if (!local || !enemy) return null;
        // Beside the local ship, which the camera holds centred, so the bar is on
        // screen and un-culled for any sane viewport.
        enemy.pos.x = local.pos.x + 120;
        enemy.pos.y = local.pos.y;
        enemy.alive = true;
        const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        enemy.hull = f * enemy.maxHull;
        return { owner: enemy.id, fraction: enemy.hull / enemy.maxHull };
      },
      bars(): ReturnType<typeof hud.debugHealthBars> {
        return hud.debugHealthBars();
      },
    };
    try {
      Object.defineProperty(window, '__healthbarStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /** Refresh the layout registry from this frame's drawn state (debug only).
   *  Every positioned element registers its declared anchor + actual rendered
   *  rect, so a tool can assert "it appears where it's supposed to" (the whole
   *  point of the registry). Owned elements register precise, self-computed
   *  bounds; HUD-owned elements come through the public {@link isLayoutContributor}
   *  seam when the UI exposes it (see PR notes). */
  function refreshLayout(reg: LayoutRegistry): void {
    // Logical (landscape) viewport — the space every registered element lays out
    // in under the landscape lock, and the space the registry contract reports.
    const w = transform.logicalWidth;
    const h = transform.logicalHeight;
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

    // The open-build-wheel button — a permanent HUD fixture at your own planet
    // (GDD §2.2, §2.4). Registered from the SAME `buildVisible`/`buildButtonRect`
    // that draw it, so the registry records what is really on screen: present
    // exactly while docked, and unaffected by opening the wheel or building —
    // which is the field-report bug made mechanically checkable. Null (and so
    // unregistered) off-touch and away from the planet. Its id + anchor are the
    // UI's contract (`@ui` build-button.ts); see there for why the region is
    // `full` on a short landscape phone.
    const buildBtn = buildButtonRect(isTouch, buildVisible, w, h);
    if (buildBtn) reg.register(BUILD_BUTTON_ID, BUILD_BUTTON_ANCHOR, buildBtn);

    // Build badge: declared bottom-right, actual rect measured from the real
    // text metrics — so a font swap that pushes the stamp off-corner is caught
    // by the placement check rather than by squinting at a screenshot. Skipped
    // when frozen, where the badge is hidden (the registry records what is
    // actually drawn, never what would have been).
    if (buildBadge.visible) reg.register(BADGE_ID, BADGE_ANCHOR, buildBadge.layoutBounds(w, h));

    // Re-enter-fullscreen affordance: declared top-right, actual rect measured
    // from the same corner math that draws it — so "no dead corners" (field
    // request v0.1.1) is a placement assertion, not a hope. Registered only while
    // it is actually on screen (the player has backed out of fullscreen).
    if (fsAffordance.visible) reg.register(FS_AFFORDANCE_ID, FS_AFFORDANCE_ANCHOR, fsAffordance.layoutBounds(w, h));

    // HUD-owned elements (ore HUD, banked total, wave clock, controls strip,
    // onboarding prompt): registered via the Hud's public describeLayout() seam
    // if present. Not implemented at M1 — see PR notes; no src/ui internals are
    // touched, and the registry lights them up the moment the seam lands.
    if (isLayoutContributor(hud)) {
      for (const e of hud.describeLayout({ width: w, height: h })) {
        // The HUD reports bounds via Pixi getBounds() — GLOBAL (physical) space,
        // which the root rotation offsets from the logical viewport. Convert so the
        // registry sees every HUD element in the same logical space it resolves
        // anchors against (a no-op when un-rotated).
        reg.register(e.id, e.anchor, physicalBoundsToLogical(e.bounds));
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

  /** Every combat beam to draw this frame — read from the sim's published combat
   *  state for EVERY shooter, never from local fire input. `combatBeams` walks the
   *  world and emits one record per firing emitter: each live ship with a `beam`
   *  (local, bot, remote alike) and each turret with a `muzzle` this tick (GDD §2.3,
   *  §2.6). This is the round-2 field fix: the old path handed the renderer only
   *  `LOCAL_PLAYER`'s beam, so an enemy carving your core and a turret spitting fire
   *  were both invisible. Now each beam draws in its shooter's colour (style-guide
   *  §3), ending at the same clamp-to-hit endpoint the sim publishes. The bounded
   *  `combatBeams` array (≤ ships + turrets, GDD §4.3) is the sim's blessed render
   *  helper; the BeamView mapping is pooled so it adds no per-frame allocation. */
  function currentBeams(): readonly BeamView[] {
    const combat = combatBeams(world);
    // Reflect the drawn set for the live-boot suite (?debug=1 only, else a no-op).
    if (combatDebug.enabled) combatDebug.update(combat);
    if (combat.length === 0) return EMPTY_BEAMS;
    return fillBeamViews(combat);
  }

  // --- Viewport: keep renderer, touch halves, HUD, and overlay in sync with the
  //     canvas. Re-run on both resize and orientationchange so the canvas
  //     re-layouts when a phone is turned (mobile amendment §2, gap #2).
  function relayout(): void {
    // Landscape lock first: recompute the root transform from the live canvas
    // size and re-apply it, so a portrait phone stays a landscape game and the
    // layout NEVER strands after an orientation flip (the field-report bug). Then
    // everything below lays out in the LOGICAL (landscape) viewport.
    recomputeTransform();
    const w = transform.logicalWidth;
    const h = transform.logicalHeight;
    viewport = readViewport();
    renderer.setViewport(viewport);
    touch.setScreenWidth(w);
    hud.resize(w, h);
  }

  /** The camera's LOGICAL (landscape) viewport, in the space the world is drawn
   *  in under the root transform.
   *
   *  When rotated (portrait phone) the logical viewport fills the rotated root
   *  exactly, so the camera centres on the full landscape frame (origin 0). When
   *  un-rotated (desktop, or a landscape phone) this is the *visual* viewport —
   *  the URL bar, a notch (`safe-area-inset`), and fullscreen transitions crop and
   *  shift the visible region, so `visualViewport` plus the canvas client rect give
   *  the visible size and its offset. Browsers without `visualViewport` fall back
   *  to the whole canvas. */
  function readViewport(): Viewport {
    if (transform.rotated) {
      return { width: transform.logicalWidth, height: transform.logicalHeight, originX: 0, originY: 0 };
    }
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

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  // Mobile URL-bar show/hide and pinch reflow the *visual* viewport without a
  // window resize — these fire then. Fullscreen enter/exit reshapes it too. All
  // route through relayout so the camera re-centres on what's actually visible.
  window.visualViewport?.addEventListener('resize', relayout);
  window.visualViewport?.addEventListener('scroll', relayout);
  // Fullscreen enter/exit reshapes the visual viewport too — relayout re-centres
  // the camera, and the render loop's `fullscreen.sync()` folds the new state in.
  document.addEventListener('fullscreenchange', relayout);

  // Entering fullscreen + the native landscape lock now fires on PLAY (a valid
  // user gesture — see the menu's `enterImmersive`) rather than on the first
  // touch anywhere, so the request is tied to the moment the player commits to a
  // match and desktop keyboard/mouse boots are never auto-fullscreened (field
  // request v0.1.1 requirements 1 & 3). Mid-match re-entry is the affordance's job.

  // --- Read-only `window.__fullscreen` live-stage seam: the whole fullscreen
  //     lifecycle as plain, structured-cloneable truth, so the live-stage suite
  //     can prove PLAY entered fullscreen, that a system-gesture exit keeps the
  //     game running with the re-enter affordance at its registered anchor, and
  //     that a rejection boots normally — none of which a headless unit test can
  //     reach. Always installed (both boots); mutates nothing.
  installFullscreenSeam({
    get supported(): boolean {
      return fullscreen.supported;
    },
    get active(): boolean {
      return fullscreen.active;
    },
    get everEntered(): boolean {
      return fullscreen.everEntered;
    },
    get affordanceVisible(): boolean {
      return fullscreen.affordanceVisible();
    },
    // The DOM element actually fullscreen right now, by id — 'app' (the game root)
    // once PLAY's request is granted, null otherwise. Lets the suite assert
    // `document.fullscreenElement` is the game root without a brittle ref compare.
    get activeElementId(): string | null {
      const el = document.fullscreenElement;
      return el ? el.id || null : null;
    },
    // The game root we target for fullscreen — the assertion that survives even a
    // headless browser that won't actually grant it.
    rootId: mount?.id ?? null,
    anchor: { region: FS_AFFORDANCE_ANCHOR.region, margin: FS_AFFORDANCE_ANCHOR.margin ?? 0 },
    get bounds(): Rect | null {
      if (!fullscreen.affordanceVisible()) return null;
      const b = fsAffordance.layoutBounds(transform.logicalWidth, transform.logicalHeight);
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    // Does the affordance's actual rect sit inside its declared anchor zone? The
    // "no dead corners" contract, checkable on a clean boot without ?debug=1.
    get withinAnchor(): boolean {
      if (!fullscreen.affordanceVisible()) return false;
      const vp = { width: transform.logicalWidth, height: transform.logicalHeight };
      const zone = resolveAnchor(FS_AFFORDANCE_ANCHOR, vp);
      return rectContains(zone, fsAffordance.layoutBounds(vp.width, vp.height));
    },
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

/** A mutable {@link Combatant} — the pooled records `feedCombatants()` overwrites
 *  in place each frame. A `Combatant`'s fields are readonly to the consumer, so
 *  the writable pool is typed here and handed over as `Combatant`. */
interface MutCombatant {
  owner: PlayerId;
  hp: number;
  maxHp: number;
  alive: boolean;
  inCombat: boolean;
  pos: Vec2;
  radius: number;
}

const EMPTY_BEAMS: BeamView[] = [];

/** A mutable BeamView the pool owns and overwrites each frame — its fields are
 *  readonly only to the renderer (which treats a BeamView as a value). */
interface MutableBeamView {
  from: Vec2;
  to: Vec2;
  color: number;
  hit: Vec2 | null;
}

// A grow-once pool: one scratch BeamView per concurrent beam. Bounded by the sim's
// entity caps (≤ ships + turrets), so after the busiest frame this never allocates
// again — the render hot path stays allocation-free (GDD §4.3b risk 5). `beamViewList`
// is the array handed to the renderer; its length is set to the live beam count.
const beamViewPool: MutableBeamView[] = [];
const beamViewList: BeamView[] = [];

/** Map every combat beam this tick into the pooled BeamView list the renderer
 *  draws. Endpoint `to` = origin + dir·length (the sim's clamp to the first hit,
 *  or full range on a miss); colour is the shooter's identity hue (style-guide §3),
 *  so an enemy's beam and a rival turret's muzzle each read in their own colour. */
function fillBeamViews(combat: readonly CombatBeam[]): readonly BeamView[] {
  const n = combat.length;
  for (let i = 0; i < n; i++) {
    const b = combat[i]!;
    let v = beamViewPool[i];
    if (!v) {
      v = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, color: 0x4dc3ff, hit: null };
      beamViewPool[i] = v;
    }
    v.from = b.origin; // alias the sim's origin (read synchronously this frame)
    v.to.x = b.origin.x + b.dir.x * b.length;
    v.to.y = b.origin.y + b.dir.y * b.length;
    v.hit = b.hitPoint; // null on a clean miss → no impact glow
    v.color = PLAYER_COLORS[b.shooter % PLAYER_COLORS.length] ?? 0x4dc3ff;
    beamViewList[i] = v;
  }
  beamViewList.length = n; // reuse the objects; just retract the tail
  return beamViewList;
}

/** One staged emitter as the live-boot suite reads it back: identity + the same
 *  clamped world-space geometry {@link fillBeamViews} draws from. */
interface StagedBeam {
  readonly shooter: number;
  readonly source: 'ship' | 'turret';
  readonly origin: { x: number; y: number };
  readonly end: { x: number; y: number };
  readonly hit: { x: number; y: number } | null;
}

/** What `__planetRush.stageCombat()` hands the test: the two NON-LOCAL emitters it
 *  staged, so the test can assert the client actually drew both of them. */
export interface StagedCombat {
  readonly ship: StagedBeam;
  readonly turret: StagedBeam;
}

const STAGE_BEAM_LEN = 140;
const STAGE_MUZZLE_LEN = 90;

/** Debug-only (`?debug=1`) deterministic firefight, driven by the live-boot suite
 *  under `?freeze=1` so the sim never steps to clear it: publish a `beam` on a
 *  non-local ship (an enemy laser) and a `muzzle` on a fresh turret owned by a
 *  non-local planet (a rival turret firing) — the two combat tells the round-2
 *  field report found invisible. Returns both so the test asserts the client put
 *  them on stage. Touches only render-tell fields the sim itself publishes each
 *  tick; it changes no sim logic and runs only behind the debug flag. */
function stageCombatFor(world: World): StagedCombat {
  // A non-local, living ship carries the enemy beam (the offline match seats the
  // local player + seven bots), so its `shooter` is provably not LOCAL_PLAYER.
  const botShip = world.ships.find((s) => s.id !== LOCAL_PLAYER && s.alive) ?? world.ships[0]!;
  const botBeam: Beam = {
    origin: { x: botShip.pos.x, y: botShip.pos.y },
    dir: { x: 1, y: 0 },
    hitPoint: { x: botShip.pos.x + STAGE_BEAM_LEN, y: botShip.pos.y },
    length: STAGE_BEAM_LEN,
  };
  botShip.beam = botBeam;

  // A turret with a live muzzle, mounted on a non-local planet so its owner (the
  // beam's shooter) is also non-local — a rival turret loosing a shot.
  const planet = world.planets.find((p) => p.owner !== LOCAL_PLAYER) ?? world.planets[0]!;
  const muzzleBeam: Beam = {
    origin: { x: planet.pos.x, y: planet.pos.y - planet.radius - 12 },
    dir: { x: 0, y: -1 },
    hitPoint: { x: planet.pos.x, y: planet.pos.y - planet.radius - 12 - STAGE_MUZZLE_LEN },
    length: STAGE_MUZZLE_LEN,
  };
  const turret: Turret = {
    id: world.nextEntityId++,
    owner: planet.owner,
    slot: planet.turrets.length,
    pos: { x: muzzleBeam.origin.x, y: muzzleBeam.origin.y },
    radius: 6,
    hp: 10,
    maxHp: 10,
    angle: -Math.PI / 2,
    cooldown: 0,
    targetId: null,
    muzzle: muzzleBeam,
  };
  planet.turrets.push(turret);

  return {
    ship: describeStaged(botShip.id, 'ship', botBeam),
    turret: describeStaged(turret.owner, 'turret', muzzleBeam),
  };
}

function describeStaged(shooter: number, source: 'ship' | 'turret', beam: Beam): StagedBeam {
  return {
    shooter,
    source,
    origin: { x: beam.origin.x, y: beam.origin.y },
    end: { x: beam.origin.x + beam.dir.x * beam.length, y: beam.origin.y + beam.dir.y * beam.length },
    hit: beam.hitPoint ? { x: beam.hitPoint.x, y: beam.hitPoint.y } : null,
  };
}

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

/** Whether a point is inside a screen rect (CSS px). */
function inRect(p: Vec2, r: { x: number; y: number; width: number; height: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Shield HP at full over a planet's core — 0 with no generator built, so the
 *  HUD's shield overbar appears the frame the first one finishes (GDD §2.5).
 *  The sim publishes the *current* pool (`shieldPool`); this is its ceiling. */
function shieldPoolMax(planet: Planet): number {
  let hp = 0;
  for (const s of planet.shields) hp += s.maxHp;
  return hp;
}

/** Summed HP of a planet's live turrets — the third term in the alarm's
 *  "your planet is being hurt" signal (GDD §2.2). */
function turretPool(planet: Planet): number {
  let hp = 0;
  for (const t of planet.turrets) hp += t.hp;
  return hp;
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

/** What `boot()` holds the main menu by: a promise that resolves when the player
 *  presses PLAY, and a one-shot `matchStarted()` the boot path calls once the
 *  world is actually built (it flips the live-stage test seam). */
interface MainMenuHandle {
  /** Resolves the moment PLAY is pressed — `boot()` builds the world only after. */
  untilPlay(): Promise<void>;
  /** Mark the world as built (drives `window.__mainMenu.matchStarted`). */
  matchStarted(): void;
}

/** The landscape-lock context `boot()` hands the menu so it lays out in the same
 *  logical (landscape) viewport the match does and remaps its own taps. */
interface MenuContext {
  /** The root container the menu attaches to (rotates under the landscape lock). */
  readonly root: Container;
  /** The current logical (landscape) viewport size, read live. */
  logicalSize(): { w: number; h: number };
  /** Physical `clientX/Y` → logical point (un-rotate a tap). */
  toLogical(clientX: number, clientY: number): Vec2;
  /** Logical point → physical canvas point (place a logical rect back on screen). */
  toPhysical(lx: number, ly: number): Vec2;
  /** Recompute + re-apply the root transform (orientation flip). */
  recomputeTransform(): void;
  /** Whether the root is currently rotated (portrait phone). */
  isRotated(): boolean;
  /** Enter fullscreen + native landscape lock — called on PLAY, the user gesture
   *  that makes both legal (field request v0.1.1). No-op on desktop / where
   *  unsupported, so the menu can call it unconditionally. */
  enterImmersive(): void;
}

/** One menu control as the landscape-lock seam reports it: its logical rect (for
 *  the "inside the logical viewport" assertion) and the physical point a tap must
 *  land on to hit it (for the CDP touch-remap assertion). */
interface MenuControlReport {
  readonly kind: MainMenuOption;
  readonly logical: Rect;
  readonly physicalCenter: { x: number; y: number };
}

/** The read-only `window.__mainMenu` seam, extended for the landscape lock. */
interface MainMenuSeam {
  visible: boolean;
  screen: 'menu' | 'settings';
  matchStarted: boolean;
  /** The LOGICAL (landscape) viewport the menu laid out against. */
  logicalViewport: { width: number; height: number };
  /** Whether the game root is rotated (portrait phone under the landscape lock). */
  rotated: boolean;
  /** The menu buttons, logical rect + physical tap point (see {@link MenuControlReport}). */
  controls: readonly MenuControlReport[];
  play(): void;
}

/**
 * The main menu (field report P1; GDD §4.6 M7). Shown on a clean boot only —
 * `boot()` skips it under `?debug=1`, which drops straight into a match so the
 * live / live-stage / mobile harnesses keep the world they assert against.
 *
 * The match world is built only when PLAY is pressed: `untilPlay()` resolves
 * then, and `boot()` calls `bootOfflineMatch` *after* it. Until then no world
 * exists — the whole point of the fix. SETTINGS reuses the Day-7 settings screen
 * ({@link SettingsView}); a fire-mode change is persisted to the same key
 * `readFireMode` reads when the match boots, so the choice carries into the game.
 *
 * A read-only `window.__mainMenu` seam lets the live-stage suite drive PLAY and
 * observe that the world is built only after it
 * (tests/live-stage/main-menu.spec.ts). The screen models/views are `src/ui`'s;
 * this function is the *wiring* — screen state, input routing, and teardown.
 */
function openMainMenu(
  app: Application,
  platform: ReturnType<typeof createBrowserPlatform>,
  ctx: MenuContext,
): MainMenuHandle {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let fireMode = readFireMode(platform, isTouch);
  let settings: SettingsState = createSettings();
  let screen: 'menu' | 'settings' = 'menu';
  let played = false;

  // Lay the menu out in the LOGICAL (landscape) viewport and hang it off the
  // rotating game root — so a portrait phone gets a landscape menu that can never
  // strand itself off-screen (the field-report bug), and re-layouts on every flip.
  const menu0 = ctx.logicalSize();
  const menuView = new MainMenuView(menu0.w, menu0.h, isTouch);
  const settingsView = new SettingsView(menu0.w, menu0.h, isTouch);
  ctx.root.addChild(menuView, settingsView);

  // The read-only test seam. `matchStarted` is flipped by `handle.matchStarted()`
  // once the real world is built, never here — so the suite's "no sim on the
  // menu" assertion reads the truth, not a hopeful flag set on PLAY. It also
  // reports the LOGICAL viewport + the buttons' logical rects and physical tap
  // points, so the landscape-lock suite can assert the menu re-layouts on rotation
  // and that a physical tap lands on the logical control (landscape-lock.spec.ts).
  const seam: MainMenuSeam = {
    visible: true,
    screen,
    matchStarted: false,
    logicalViewport: { width: menu0.w, height: menu0.h },
    rotated: ctx.isRotated(),
    controls: [],
    play: (): void => play(),
  };

  let resolvePlay: () => void = () => {};
  const playPromise = new Promise<void>((resolve) => {
    resolvePlay = resolve;
  });

  /** Refresh the seam's logical viewport, rotation flag, and per-button reports
   *  (logical rect + physical tap point) from the live transform — the executable
   *  form of "the menu lays out in landscape and a tap lands where it's drawn." */
  function updateSeamLayout(): void {
    const { w, h } = ctx.logicalSize();
    const layout = mainMenuLayout({ width: w, height: h }, { isTouch });
    seam.logicalViewport = { width: w, height: h };
    seam.rotated = ctx.isRotated();
    seam.controls = MAIN_MENU_ITEMS.map((item, i) => {
      const r = layout.buttons[i] ?? { x: 0, y: 0, width: 0, height: 0 };
      const center = ctx.toPhysical(r.x + r.width / 2, r.y + r.height / 2);
      return { kind: item.kind, logical: { ...r }, physicalCenter: center };
    });
  }

  /** Redraw the live screen from current state. Static content, so this runs on
   *  a state change or a resize — Pixi's own ticker keeps painting between. */
  function render(): void {
    menuView.visible = screen === 'menu';
    settingsView.visible = screen === 'settings';
    if (menuView.visible) menuView.update(mainMenuModel());
    if (settingsView.visible) settingsView.update(settingsModel(settings, fireMode));
    seam.screen = screen;
    updateSeamLayout();
  }

  /** PLAY: tear the menu down and hand `boot()` the go-ahead to build the world. */
  function play(): void {
    if (played) return;
    played = true;
    // PLAY is a valid user gesture: take fullscreen + the native landscape lock
    // now, synchronously within the gesture, before anything else (field request
    // v0.1.1). Fire-and-forget and self-gating — a no-op on desktop / iPhone.
    ctx.enterImmersive();
    teardown();
    seam.visible = false;
    resolvePlay();
  }

  function openSettings(): void {
    screen = 'settings';
    render();
  }

  function closeSettings(): void {
    screen = 'menu';
    render();
  }

  /** Apply a tap on the settings screen — the same targets `flowTapSettings`
   *  routes, but pre-match there is no lobby or renderer to tell, so each change
   *  just folds into local state (and fire mode is persisted for the match). */
  function applySettings(target: SettingsTarget): void {
    switch (target.kind) {
      case 'back':
        closeSettings();
        return;
      case 'fireMode':
        fireMode = fireMode === FireMode.AutoAim ? FireMode.Manual : FireMode.AutoAim;
        platform.storage.set(FIRE_MODE_KEY, fireMode);
        break;
      case 'reduceVfx':
        settings = toggleReduceVfx(settings);
        break;
      case 'volume':
        settings = adjustVolume(settings, target.channel, target.dir);
        break;
    }
    render();
  }

  function onPointerDown(e: PointerEvent): void {
    // Un-rotate the physical tap into the logical space the menu is laid out in
    // (landscape lock) — the remap that keeps a portrait tap on the button drawn
    // under the thumb (the part that silently breaks; tested explicitly).
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    if (screen === 'menu') {
      const hit = menuView.hitTest(x, y);
      if (hit === 'play') play();
      else if (hit === 'settings') openSettings();
    } else {
      const hit = settingsView.hitTest(x, y);
      if (hit) applySettings(hit);
    }
    e.preventDefault();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (screen === 'settings') {
      if (e.code === 'Escape') closeSettings();
      return;
    }
    // On the menu, Enter or Space is PLAY — a keyboard player never has to reach
    // for the mouse to start a match.
    if (e.code === 'Enter' || e.code === 'Space') play();
  }

  function relayout(): void {
    // Landscape lock first: re-apply the root transform for the new canvas size,
    // then re-lay the menu in the resulting logical (landscape) viewport — the
    // re-layout the field report found missing (rotate → menu stranded).
    ctx.recomputeTransform();
    const { w, h } = ctx.logicalSize();
    menuView.resize(w, h, isTouch);
    settingsView.resize(w, h, isTouch);
    render();
  }

  function teardown(): void {
    app.canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', relayout);
    window.removeEventListener('orientationchange', relayout);
    window.visualViewport?.removeEventListener('resize', relayout);
    ctx.root.removeChild(menuView, settingsView);
    menuView.destroy({ children: true });
    settingsView.destroy({ children: true });
  }

  app.canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  window.visualViewport?.addEventListener('resize', relayout);

  installMainMenuSeam(seam);
  render();

  return {
    untilPlay: () => playPromise,
    matchStarted: () => {
      seam.matchStarted = true;
    },
  };
}

/** Install the read-only `window.__mainMenu` live-stage seam (see
 *  {@link openMainMenu}). Present only on a clean boot; absent under `?debug=1`,
 *  where the menu never runs — which is itself what that spec asserts. */
function installMainMenuSeam(seam: object): void {
  try {
    Object.defineProperty(window, '__mainMenu', {
      value: seam,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already defined (double install / HMR) — leave the existing one in place.
  }
}

/** The read-only `window.__fullscreen` live-stage seam: the fullscreen lifecycle
 *  as plain, structured-cloneable truth (see the install site in `boot()`). */
interface FullscreenSeam {
  /** Can this platform enter fullscreen at all (false on iPhone Safari). */
  readonly supported: boolean;
  /** Is the game fullscreen right now. */
  readonly active: boolean;
  /** Has the game been fullscreen at least once this boot. */
  readonly everEntered: boolean;
  /** Is the re-enter affordance on screen (backed out of fullscreen). */
  readonly affordanceVisible: boolean;
  /** The id of the element that is fullscreen now, or null. */
  readonly activeElementId: string | null;
  /** The id of the game-root element we target for fullscreen. */
  readonly rootId: string | null;
  /** The affordance's declared layout anchor. */
  readonly anchor: { readonly region: string; readonly margin: number };
  /** The affordance's actual rendered rect, or null when hidden. */
  readonly bounds: Rect | null;
  /** Does the affordance sit inside its declared anchor zone ("no dead corners"). */
  readonly withinAnchor: boolean;
}

/** Install the read-only `window.__fullscreen` seam. Best-effort, like the menu
 *  seam — a double install (HMR) leaves the first in place. */
function installFullscreenSeam(seam: FullscreenSeam): void {
  try {
    Object.defineProperty(window, '__fullscreen', {
      value: seam,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already defined (double install / HMR) — leave the existing one in place.
  }
}

/**
 * Present a boot failure as the friendly DOM screen (boot-error.ts): plain words,
 * things to try, the raw error text, the build stamp, and a Retry button. This is
 * the *only* way a failed boot ends — never a black page, never a console-only
 * stack (the incident that produced this code).
 *
 * Retry semantics differ by kind, and deliberately do not lie:
 *   - **no WebGL** — re-probe on the spot. A wedged GPU process almost never
 *     recovers without a browser restart, so a reload would just repaint the same
 *     screen; only reload when the probe actually says yes. Otherwise the status
 *     line reports that nothing changed.
 *   - **any other init failure** — reload, since a one-off start-up error often
 *     does not repeat.
 */
function presentBootFailure(err: unknown): void {
  const build = formatBuildBadge(BUILD_INFO);
  // The console still gets the truth — this screen is *in addition to* the stack,
  // not instead of it. One clear line first, so the cryptic part has a caption.
  console.error(`Planet Rush failed to boot (build ${build})`, err);
  try {
    const content = describeBootFailure(err, build);
    const mounted = showBootError({
      dom: document,
      content,
      onRetry: () => {
        if (content.kind !== 'no-webgl') {
          window.location.reload();
          return true;
        }
        if (!probeWebGl().ok) return false; // still no GL — say so, don't reload
        window.location.reload();
        return true;
      },
    });
    // No #app and no body to write into is the one case the screen cannot rescue.
    if (!mounted) console.error('Planet Rush: no element to mount the boot-error screen into.');
  } catch (screenErr) {
    // The failure path must not fail silently on top of the original failure.
    console.error('Planet Rush: could not render the boot-error screen', screenErr);
  }
}

// The whole of boot() runs inside one catch, so ANY init failure — no WebGL, a
// bad asset, a thrown constructor — lands on the friendly screen with its error
// text, rather than on a black canvas (GDD §4.3b risk 7).
void boot().catch(presentBootFailure);
