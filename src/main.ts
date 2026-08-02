/**
 * src/main.ts — client bootstrap. OWNER: Platform Engineer.
 *
 * Wires the platform seam, the input funnel, the fixed-timestep loop, and the
 * PixiJS render layer into the playable build. All input becomes abstract
 * `Action`s here before it crosses into the sim — the sim never sees a device
 * (GDD §2.4).
 *
 * **M2 (GDD §4.6): this boots a real match, not a sandbox.** Eight stations in a
 * ring, the local player owning slot 0's home and do-nothing bots (`src/bots`)
 * filing input for the other seven through the same ordered-input protocol a
 * human uses; the wave metronome, the collapse phase and win/loss running off
 * `world.match`; the Build & Upgrade wheel opening at your own station and
 * spending through the sim's own `buildOrder` / `upgradeOrder`; the under-attack
 * alarm and the own-station HP bar fed from the real core, shields and turrets.
 *
 * Everything below is *wiring*. Every decision it feeds on belongs to the module
 * that owns it: the sim answers "am I docked" (`isDocked`) and "has the field
 * collapsed" (`isCollapsed`), the UI decides what the wheel says and whether the
 * alarm sounds, the bots decide what the other seven slots do. This file's job
 * is that none of those answers is invented here.
 */
import { Application, Container } from 'pixi.js';
import { ShipClass, mulberry32 } from '@shared/types';
import type { Action, Muzzle, PlayerId, Vec2 } from '@shared/types';
import {
  WEAPON_RANGE,
  TRACTOR_PICKUP_RADIUS,
  muzzleFlashes,
  damageStation,
  damageShip,
  killShip,
  destroyCore,
  isCollapsed,
  isDocked,
  isOver,
  stationOf,
  satelliteCount,
  shieldCount,
  shieldPool,
  turretCount,
  sensorSources,
} from './sim';
import type { MuzzleFlash, MiningStation, Turret, World, SensorSource } from './sim';
// The sim's real, validated upgrade purchase — used only by the ?debug=1
// upgrade-wheel live-stage seam below, the exact call a real upgrade order makes.
import { buyUpgrade, turretTier, satelliteOrbitPos } from './sim/buildings';
// Match-config bounds + types for the lobby's variable-size / mode / abundance
// controls (variable-slots Milestone E) — persisted and threaded into the world.
import { MAX_MATCH_SIZE, MIN_MATCH_SIZE, configToPlayers } from './sim/match-config';
import type { MatchMode } from './sim/match-config';
import type { Abundance } from './sim/constants';
// SATELLITE tunables — used only by the ?debug=1 minimap-fog live-stage seam to
// stage a radar satellite (build → coverage appears; kill → coverage collapses).
import { SATELLITE } from './sim';
import { bootOfflineMatch } from '@platform/match-boot';
import type { MatchBoot } from '@platform/match-boot';
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
import { TapPilot, pickTapTarget } from '@platform/tap-pilot';
import type { TapCandidate, ResolvedTarget, TargetKind } from '@platform/tap-pilot';
import { bindTouchControls } from '@platform/touch-dom';
import { TouchVisuals, buildButtonRect } from '@platform/touch-visuals';
import { WheelInput, writeWheelOrders, hitWheel } from '@platform/wheel-input';
import {
  computeRootTransform,
  applyRootTransform,
  physicalToLogical,
  logicalToPhysical,
} from '@platform/orientation';
import type { RootTransform } from '@platform/orientation';
import { createBrowserPlatform } from '@platform/platform';
import { createBrowserHaptics } from '@platform/haptics';
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
import { advanceToFreezeTick, hashWorld, stampDefenseShowcase, FREEZE_TICK } from '@platform/freeze';
import { installDebugHook, installDebugStage, installInputProbe } from '@platform/debug-hook';
import { installCombatDebug } from '@platform/combat-debug';
import { BUILD_INFO, formatBootLine, formatBuildBadge } from '@platform/build-info';
import { buildIdentity } from '@platform/build-identity';
import { requireWebGl, probeWebGl } from '@platform/gl-probe';
import { describeBootFailure, showBootError } from '@platform/boot-error';
import { writeCameraOffset } from '@platform/camera';
import type { Viewport } from '@platform/camera';
import { BuildBadge, BADGE_ID, BADGE_ANCHOR, BADGE_STRIP_LIFT } from '@render/build-badge';
import {
  FullscreenAffordance,
  FS_AFFORDANCE_ID,
  FS_AFFORDANCE_ANCHOR,
} from '@render/fullscreen-affordance';
import { Renderer, PLAYER_COLORS } from '@render/index';
import type { MuzzleView } from '@render/index';
import {
  Hud,
  PANEL_ROW_HEIGHT,
  TRACK_ORDER,
  UpgradeTrack,
  upgradeWheelSlots,
  upgradeWedgeAngle,
  WHEEL_ORDER,
  segmentAngle,
  wheelRadius,
  buildButtonVisible,
  BUILD_BUTTON_ID,
  BUILD_BUTTON_ANCHOR,
  MainMenuView,
  SettingsView,
  mainMenuModel,
  mainMenuLayout,
  MAIN_MENU_ITEMS,
  // THE DOORS (ratified: one play flow) — the room-code screen the menu's one PLAY
  // button opens: PLAY SOLO, CREATE a room, or JOIN one by code. All three land in
  // the same lobby below. The transport that opens on a successful allocate is
  // m9-09's; this file only wires the screen and turns the allocator's refusals
  // into the right words.
  LobbyEntryView,
  entryLayout,
  DOOR_OPTIONS,
  createEntry,
  entryModel,
  entryFailed,
  entryErrorFor,
  chooseDoor,
  typeEntryCode,
  eraseEntryCode,
  backToDoors,
  submitJoin,
  DOOR_ORDER,
  KEYPAD_KEYS,
  regionPickerVisible,
  CodexView,
  codexModel,
  codexLayout,
  createCodex,
  normalizeCodex,
  selectCodexTab,
  selectCodexEntry,
  activeEntries,
  CODEX_TABS,
  CodexHintView,
  codexBotHint,
  codexShipHint,
  mapIdAt,
  normalizeMapId,
  registryStations,
  VETERAN_MAP_ID,
  MAP_ORDER,
  MAP_STORAGE_KEY,
  settingsModel,
  settingsLayout,
  SETTINGS_ROWS,
  createSettings,
  toggleReduceVfx,
  adjustVolume,
  DEFAULT_VOLUMES,
  EndOfMatchView,
  endOfMatchModel,
  LobbyView,
  createLobby,
  lobbyModel,
  lobbyLayout,
  tickLobby,
  pressRush,
  // The wire half of the ONE lobby (ratified: CREATE ROOM opens the same lobby,
  // online): a `lobbyState` broadcast folds in through `applyLobbySlots` so joiners
  // appear in their seats live, `startLobbyMatch` is authority ending the lobby, and
  // the host's per-seat difficulties ride `botDifficulties` in empty-seat order.
  applyLobbySlots,
  botDifficulties,
  // The one authored `MatchConfig` the lobby produces (`src/ui/lobby`) — the
  // single handoff to BOTH the wire (the host's `lobbyChoice.teams`) and the world
  // (`bootOfflineMatch`'s dense team table). Reading the same object for both is
  // what makes an offline TEAMS match and an online one the same match (m10).
  lobbyMatchConfig,
  startLobbyMatch,
  wireFireMode,
  selectShipClass,
  selectMap,
  cycleBotDifficulty,
  cycleSeatState,
  cycleSeatTeam,
  toggleMode,
  cycleAbundance,
  matchSizeOf,
  DEFAULT_SHIP_CLASS,
  CLASS_ORDER,
  normalizePlayerName,
  MINIMAP_TOGGLE_KEY,
  PauseMenuView,
  pauseMenuModel,
  pauseButtons,
  pauseButtonRect,
  pauseButtonVisible,
  pauseLayout,
  nextPauseScreen,
  isPauseOpen,
  shouldFreezeSim,
  // Whether the bottom edge carries the controls strip — the one piece of screen
  // furniture the build badge has to make room for (see `buildBadge.lift`).
  showControlsStrip,
} from './ui';
import type {
  HudFrame,
  Combatant,
  DifficultyTable,
  MinimapStation,
  MinimapShip,
  MinimapSatellite,
  MinimapCoverage,
  MinimapFog,
  Nameable,
  NameTable,
  TeamTable,
  SettingsState,
  SettingsTarget,
  MainMenuOption,
  CodexState,
  CodexTarget,
  EndButton,
  MatchOutcome,
  DeathCause,
  LobbyState,
  PauseScreen,
  PauseButton,
  UiCue,
  EntryState,
  EntryTarget,
  EntryDoor,
  EntryNarration,
  RegionInfo,
} from './ui';
import {
  OFFLINE_ROOM,
  allocatorUrlFromEnv,
  allocateRoom,
  joinRoom,
  createOnlineSession,
  allocatorTransport,
  attachSessionLog,
  // The verbose connecting screen (M10): every step of the join named as it
  // happens **in the screen's own title**, or the exact refusal there with RETRY
  // and COPY LOG under it.
  beginConnect,
  connectDialing,
  connectFailed,
  connectJoined,
  connectRefused,
  connectTicketed,
  connectTitleFailed,
  connectTitleLine,
  connectTraceLogEntry,
  connectTraceModel,
  connectTransportState,
  hideConnectTrace,
  installConnectTraceView,
  showConnectTrace,
  // The connection dying LOUDLY (m10 disconnect honesty): the overlay that names
  // what was detected and offers RECONNECT / ABANDON MATCH.
  installLinkLossView,
  showLinkLoss,
  copyLogButton,
  describeEnvironment,
  disconnectOfferHint,
  ERROR_OFFER_HINT,
  hideCopyLog,
  installConsoleCapture,
  installCopyLogButton,
  installErrorCapture,
  installPlaytestLog,
  playtestLog,
  showCopyLog,
  // Your own ping, one mono line above the build stamp (ratified developer).
  PingBadge,
  PING_BADGE_ID,
  PING_BADGE_ANCHOR,
  PING_BADGE_STACK_LIFT,
} from './net';
import type {
  ResolveFailure,
  OnlineSession,
  ResolvedConnection,
  AllocatorClientConfig,
  ConnectTrace,
  ConnectStep,
  SessionLogHandle,
  // The room code the doors resolved and the lobby opens on — one code, end to end
  // (the unified play flow; `./ui/lobby-flow` rule 1).
  RoomCode,
} from './net';
// The CODEX content (GDD §2.10), regenerated by the codex pipeline and living
// outside src/ — imported here (Vite inlines the JSON) and handed to the pure
// codex model as a value, the seam ./ui/codex documents. The screen never
// reaches across the compile boundary; this file does it once, at boot.
import codexBots from '../content/codex/codex-bots.json';
import codexShips from '../content/codex/codex-ships.json';
import codexSystems from '../content/codex/codex-systems.json';
import codexStrategy from '../content/codex/codex-strategy.json';
import { personality } from './bots';
import { AudioEngine, AudioUnlock, defaultUnlockTarget, openAudioContext } from './art/audio';
import { TellQueue, TELL_CAPACITY } from './art/tells';
import { WorldObserver } from './art/vfx/observer';

// The slot this client flies. Offline (and for the room CREATOR online, who is
// always seated first) this is 0; a JOINER online is seated by the server at the
// next free slot, so `boot()` reassigns this to `session.you` before the render/
// input loop reads it. A `let` because the local seat is only known once online —
// every closure below reads the live binding, so a joiner controls its own ship.
let LOCAL_PLAYER = 0;

/** The parsed CODEX content (GDD §2.10), vetted once at module load — shared by
 *  the main-menu reference screen ({@link openMainMenu}) and the lobby's codex
 *  tooltips ({@link openLobby}). The JSON is imported above (Vite inlines it);
 *  the pure model normalises it. */
const CODEX_DATA = normalizeCodex({
  bots: codexBots,
  ships: codexShips,
  systems: codexSystems,
  strategy: codexStrategy,
});

// Haptics feel tuning (field request v0.2.2; TUNABLE — feel owns these). A hull
// change under this many HP is noise, not a hit. `hit` debounces to one knock per
// cooldown under sustained fire; `alarm` accumulates base damage into a pressure
// gauge that decays each frame, rings once the assault outpaces the decay, and
// re-arms on a cadence so it pulses rather than chatters.
const HAPTIC_HP_EPSILON = 0.001;
const HAPTIC_HIT_COOLDOWN_MS = 250;
const HAPTIC_ALARM_DECAY = 0.9;
const HAPTIC_ALARM_TRIGGER = 40;
const HAPTIC_ALARM_REARM_MS = 2500;

const FIRE_MODE_KEY = 'planet-rush:fireMode';
/** Where the chosen control scheme is remembered (developer's ratified
 *  tap/click-to-move scheme). Same storage seam as the fire mode, so both survive
 *  a reload identically. `'sticks'` (the existing twin-stick / keyboard / gamepad
 *  scheme) is the default; `'tap'` is Tap Commander. The existing schemes are
 *  untouched and default — Tap Commander is an OPTIONAL layer. */
const CONTROL_SCHEME_KEY = 'planet-rush:controlScheme';
/** The two control schemes (developer ratification §3). Sticks is default. */
type ControlScheme = 'sticks' | 'tap';
/** Surface-gap standoff (world units) the Tap Commander pilot holds a fly-to at
 *  its OWN station — the "fly to atmosphere" order (developer §2). Sits the ship in
 *  its home's atmosphere, near docking range (STATION.dockRange), without slamming
 *  the core. TUNABLE feel value; not a sim constant. */
const STATION_STANDOFF = 60;
/** The Tap Commander order markers (developer §4) — the waypoint marker and the
 *  lock-on reticle. The UI seam (p6-02) owns the DRAWN visual; the Platform lane
 *  owns the state and this registered layout contract: a stable id + anchor + the
 *  projected screen rect, so the affordance the pilot adds is a first-class,
 *  placement-checkable element like every other on-screen affordance. They track a
 *  WORLD position (the waypoint, the locked entity), so their anchor is `full` —
 *  there is no fixed corner to hug. */
const TAP_WAYPOINT_ID = 'tap-waypoint-marker';
const TAP_RETICLE_ID = 'tap-lock-reticle';
const TAP_MARKER_ANCHOR: AnchorSpec = { region: 'full' };
/** Waypoint marker box side (logical px). */
const TAP_MARKER_SIZE = 28;
/** Extra diameter the reticle box adds around the locked entity (logical px). */
const TAP_RETICLE_PAD = 20;
/** Where the last hull picked in the lobby is remembered, so a returning player
 *  finds their choice pre-selected (GDD §2.11 — "persist last choice"). Same
 *  storage seam as the fire mode, so both survive a reload identically. */
const SHIP_CLASS_KEY = 'planet-rush:shipClass';
/** Where the local player's name is remembered (field request v0.2.1) — the same
 *  storage seam as the hull and fire mode, so a returning player finds their
 *  callsign over their ship and station. */
const PLAYER_NAME_KEY = 'planet-rush:playerName';
/** Where the lobby's match MODE, ore ABUNDANCE, and last SIZE are remembered
 *  (variable-slots Milestone E) — the same `planet-rush:` storage seam as the hull
 *  and the arena, so a returning host finds the whole match shape they last set.
 *  Each is folded to a legal value on read ({@link readMatchMode} etc.), so a
 *  stale or hand-edited key can never reach the sim. */
const MATCH_MODE_KEY = 'planet-rush:matchMode';
const ABUNDANCE_KEY = 'planet-rush:abundance';
const MATCH_SIZE_KEY = 'planet-rush:matchSize';
/** Match seed. Deterministic and never time-derived (GDD §4.8) — the lobby
 *  picks it once rooms exist (M4); until then every offline match is the same
 *  arena, which is also what makes a bug report reproducible. */
/**
 * Describe the page for the playtest log's header (`src/net/playtest-log`): the build
 * stamp, the session instant, the viewport it laid out for, whether there is a touch
 * screen, and how the browser says it is connected.
 *
 * Deliberately nothing more. Every field here is something the game already knows and
 * already shows — no user agent string, no device id, no location (the brief's "no PII
 * beyond what the game already knows"). The browser probing lives here rather than in
 * `src/net` so that module stays DOM-free and node-testable.
 */
function describePage(): Parameters<typeof describeEnvironment>[0] {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  return {
    // The badge string the corner is about to draw (`@platform/build-identity`) —
    // build-only here, since nothing has connected yet; `boot()` keeps it current
    // for the rest of the session, so a log and a screenshot always agree (M10).
    build: buildIdentity().tag,
    sha: BUILD_INFO.sha,
    buildTime: BUILD_INFO.time,
    dirty: BUILD_INFO.dirty,
    startedAt: new Date().toISOString(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    connectionType: nav.connection?.effectiveType,
    online: navigator.onLine,
  };
}

/** The page's own origin, so console capture can tell our bundle's stack frames from
 *  a browser extension's (`src/net/playtest-log-capture`). Empty off a real page. */
function pageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/** Host of a URL, for the log — which server was dialled, without the ticket query
 *  string that rides on it (a ticket is a signed credential; it stays out of a log
 *  that gets pasted into a chat window). */
function logHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

/** How often the playtest log samples a live session (`startSessionLog`). Four times
 *  a second: free, and fine-grained enough for a timeline a human reads. */
const SESSION_LOG_POLL_MS = 250;

const MATCH_SEED = 1;
/** Index of UPGRADE SHIP: the one segment that opens a screen instead of
 *  spending (GDD §2.5). Read from the wheel's own order so it cannot drift. */
const UPGRADE_SEGMENT = WHEEL_ORDER.indexOf('upgrade');

async function boot(): Promise<void> {
  // --- The playtest log (developer ratification, M10). FIRST, before anything can
  //     fail: a bounded local-only record of this session — build identity, the whole
  //     connection lifecycle, per-second net telemetry, match events, and our own
  //     console errors — that the developer exports with one tap and pastes into
  //     chat (src/net/playtest-log*). It is what turns "it wouldn't connect" into a
  //     line naming the build, the machine and the server's own refusal.
  //
  //     Unconditional, not behind ?debug=1: a playtest bug that reproduces once must
  //     not require the developer to have guessed beforehand that logging was needed.
  const playtest = installPlaytestLog({ env: describeEnvironment(describePage()) });
  // Console capture wraps `console.error`/`warn` (always forwarding to the real one)
  // and listens for uncaught errors — the console a phone has no way to show.
  installConsoleCapture({ log: playtest, origin: pageOrigin() });
  installErrorCapture({ log: playtest });
  // And the one affordance that gets the log out: hidden until a screen offers it
  // (the pause menu, or an error screen — see `syncCopyLog` and `failOnline`).
  installCopyLogButton({ dom: document, log: playtest });

  // --- Build identity → the log's env (ratified, M10 §3). The badge string and
  //     the log header are ONE string: whenever the identity changes — a welcome
  //     onto a Machine, a socket that closed — the log's `env.build` is rewritten
  //     to whatever the corner is now drawing, and the change lands on the
  //     timeline as its own event. So "logs and screen always agree" is a wire,
  //     not a discipline. Fires once immediately, seating the offline tag.
  //
  //     The log takes the STABLE half (`identityTag`: build + server, no rtt).
  //     The badge's third field renumbers every ~2 s now (ratified: "badge grows
  //     connection stats"), and `setBuild` records an event per change — piping
  //     the live tag here would file ~360 `build tag` lines in a twelve-minute
  //     match and evict the 600-slot ring with a number the telemetry samples
  //     already carry per second. The subscription still fires on every tick of
  //     the rtt; `setBuild` drops the ones where the identity half did not move.
  const identity = buildIdentity();
  identity.subscribe(() => playtest.setBuild(identity.identityTag));

  // Which build is this? One line, first thing in the console, every build —
  // so a bug report can carry the sha instead of "the version I had open"
  // (src/platform/build-info.ts; the corner badge says the same thing on screen).
  console.info(formatBootLine(BUILD_INFO));
  playtest.recordNote(formatBootLine(BUILD_INFO));

  // Is there a GPU to draw on? Asked BEFORE Pixi is touched (gl-probe.ts), because
  // the day Chrome's GPU process wedged, `Application.init()` threw
  // `autoDetectRenderer: CanvasRenderer is not yet implemented` and the game died
  // to a black screen with only that stack. Throwing here routes the failure
  // through the one catch below and onto the friendly screen instead.
  const gl = requireWebGl();
  console.info(`WebGL available: ${gl.api}`);
  playtest.recordNote('webgl', { api: gl.api });

  const platform = createBrowserPlatform();

  // Vibration (field request v0.2.2; haptics.ts). One service behind the seam —
  // gameplay names an event (`haptic('hit')`), the platform decides whether a
  // motor exists, whether the player left it on, and what pattern to play. A silent
  // no-op on desktop/iOS. Persists its toggle through the same storage seam as
  // every other setting; the settings screen reads `haptics.isSupported()` to hide
  // the toggle where a motor can't exist.
  const haptics = createBrowserHaptics(platform.storage);

  // Dev flags (?debug=1, ?freeze=1). Off in a normal build — everything gated on
  // `flags.debug` below is zero-cost when the query string is absent.
  const flags = parseDebugFlags(typeof window !== 'undefined' ? window.location.search : '');

  // --- Audio (src/art/audio): the game's whole synthesized voice, finally wired.
  //     The SFX bank has existed since d5 and the adaptive soundtrack merged in
  //     #132, yet the booted client never opened a context, never armed the
  //     unlock, and never fed the graph a single tell — merged-but-never-called,
  //     the exact "dark matter" the presenter file warns about — so the developer
  //     heard total silence (field report v0.2.4). Three moving parts, all live
  //     from here:
  //       1. Open a context. `null` in Node / the QA harness (no `AudioContext`),
  //          which makes `audio` a silent no-op rather than an error (GDD §4.1).
  //       2. Arm the unlock NOW, before the menu opens, so the FIRST real gesture
  //          — the tap on PLAY included — resumes the context (browsers hold it
  //          `suspended` until then) and starts the standing voices. It re-arms
  //          whenever the context is found asleep again (backgrounded tab, an
  //          answered phone call); the frame loop rechecks it once a frame (risk 7,
  //          ./art/audio/unlock).
  //       3. Derive tells off the SAME live world the renderer draws, and sound
  //          them — the audible twin of the VFX field (GDD §3.6), fed in the loop.
  //     The starting mix is the settings screen's own DEFAULT_VOLUMES, so what the
  //     player hears matches what the sliders show, and every default is audible.
  const audioCtx = openAudioContext();
  const audio = new AudioEngine({
    context: audioCtx,
    local: LOCAL_PLAYER,
    mix: { master: DEFAULT_VOLUMES.master, sfx: DEFAULT_VOLUMES.sfx, music: DEFAULT_VOLUMES.music },
  });
  const audioTells = new TellQueue(TELL_CAPACITY);
  const audioObserver = new WorldObserver({ local: LOCAL_PLAYER });
  const unlockTarget = defaultUnlockTarget();
  const audioUnlock =
    audioCtx && unlockTarget
      ? new AudioUnlock(audioCtx, unlockTarget, { onUnlock: () => audio.start() })
      : null;
  audioUnlock?.arm();

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

  // --- The badge layer (render/build-badge.ts): the persistent build stamp, on
  //     EVERY screen (ratified, M10 §1 — "shown on every single page"). Its own
  //     root, a SIBLING of `gameRoot` and added after it, for one reason: every
  //     screen in this game — menu, doors, keypad, lobby, codex, settings, match,
  //     match-end — is a child of `gameRoot`, so a badge inside it would be buried
  //     by whichever screen was added last. Out here it is unconditionally on top,
  //     for the whole life of the page, and no screen has to remember it exists.
  //     It carries the same landscape-lock transform, so it stays in the logical
  //     bottom-left corner however the phone is held.
  const badgeRoot = new Container();
  badgeRoot.label = 'badge-root';
  app.stage.addChild(badgeRoot);
  applyRootTransform(badgeRoot, transform);

  // ?freeze=1 exists so the frame is byte-deterministic across boots (golden
  // screenshots). The stamp is the one thing on screen that changes every commit
  // — and now also every server — so it is the one thing freeze must hide, and
  // the only case where the badge is not shown. Every real build carries it.
  const buildBadge = new BuildBadge(identity);
  buildBadge.visible = !flags.freeze;
  badgeRoot.addChild(buildBadge);
  buildBadge.update(transform.logicalWidth, transform.logicalHeight);

  // Your own ping (ratified developer), stacked one mono line above the build
  // stamp in the same corner and on the same root, so it rides the landscape-lock
  // rotation identically. It shows itself only when there is a measurement to show
  // — offline, in the menus, and before the first second of a match there is none,
  // so this is invisible everywhere except a live online match. Never under
  // `?freeze=1`: a number that changes with the weather is exactly what a
  // byte-deterministic golden screenshot cannot have.
  const pingBadge = new PingBadge();
  badgeRoot.addChild(pingBadge);
  pingBadge.update(transform.logicalWidth, transform.logicalHeight);

  // --- Read-only `window.__buildBadge` live-stage seam. The badge is Pixi text on
  //     a canvas, so a Playwright run cannot read it any other way — and "it is on
  //     every screen" is precisely the claim no unit test can make, because it is a
  //     claim about the boot path, not about a component. Installed HERE, before
  //     the menu exists, and on BOTH boots (no `?debug=1` gate: the front screens
  //     only exist on the clean boot). Reports what is actually drawn, straight off
  //     the layer — never a re-derived string, so a green run cannot mean a seam
  //     agreeing with itself while the corner says something else.
  installBuildBadgeSeam({
    get text(): string {
      return buildBadge.text;
    },
    get visible(): boolean {
      return buildBadge.visible;
    },
    get server(): { machine: string; region: string } | null {
      const s = identity.server;
      return s ? { machine: s.machine, region: s.region } : null;
    },
    get rttMs(): number | null {
      return identity.rttMs;
    },
    get bounds(): Rect | null {
      if (!buildBadge.visible) return null;
      const b = buildBadge.layoutBounds(transform.logicalWidth, transform.logicalHeight);
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    },
    /** Does the drawn stamp sit inside its declared bottom-left zone? */
    get withinAnchor(): boolean {
      if (!buildBadge.visible) return false;
      const vp = { width: transform.logicalWidth, height: transform.logicalHeight };
      return rectContains(resolveAnchor(BADGE_ANCHOR, vp), buildBadge.layoutBounds(vp.width, vp.height));
    },
  });

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
    // The badge rides the same rotation, and re-corners for the new logical size.
    // Done here rather than only in the match loop, because the front screens
    // (menu, doors, lobby) have no loop of their own — and a badge stranded
    // off-screen after an orientation flip is the field bug this file keeps re-learning.
    applyRootTransform(badgeRoot, transform);
    buildBadge.update(transform.logicalWidth, transform.logicalHeight);
    pingBadge.update(transform.logicalWidth, transform.logicalHeight);
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
  // The landscape-lock context both front-of-match screens (menu, then lobby)
  // lay out against: they attach to the rotating game root, read the live logical
  // (landscape) viewport, and remap their own taps through it.
  const frontCtx: MenuContext = {
    root: gameRoot,
    logicalSize: () => ({ w: transform.logicalWidth, h: transform.logicalHeight }),
    toLogical,
    toPhysical: (lx, ly) => logicalToPhysical(lx, ly, transform),
    recomputeTransform,
    isRotated: () => transform.rotated,
    // PLAY is a valid user gesture (field request v0.1.1): enter fullscreen +
    // native landscape lock here. A no-op on desktop and where unsupported.
    enterImmersive: () => fullscreen.enter(),
  };

  const mainMenu = flags.debug ? null : openMainMenu(app, platform, frontCtx);
  // The doors tell `boot()` WHICH game to run: an offline `LocalLoopback` (PLAY SOLO,
  // and the ?debug=1 harness boot) or a live online session a CREATE / JOIN opened
  // and the server WELCOMED us into (M10). Either way the lobby comes next — the
  // ratified flow puts one lobby between every door and every match — and only after
  // RUSH! does a world exist (GDD §4.2).
  const launch: LaunchPlan = mainMenu ? await mainMenu.untilPlay() : { kind: 'offline' };
  const onlineSession = launch.kind === 'online' ? launch.session : null;
  // A JOINER is seated by the server at whatever slot was free, so the local seat
  // is only known now — bind it before any closure below reads it (a creator, and
  // every offline match, stays seat 0).
  if (launch.kind === 'online') LOCAL_PLAYER = launch.you;

  // --- The lobby (GDD §2.1, §2.11; M4) — ONE component, EVERY door (ratified: the
  //     unified play flow). Every way in lands here, not in the match: the 8-slot
  //     roster (your seat plus the bot cast, hulls and personalities visible), the
  //     four hull tiles, the four ARENA cards, the MODE / ORE rows, the slot editor,
  //     and RUSH!. The hull you pick here is the hull you fly and the arena you pick
  //     is the arena the sim builds — both are threaded into `bootOfflineMatch`
  //     below, so the world IS the choice, not a hardcoded default (the M4
  //     dark-matter bug: the lobby merged in #39 and PLAY never reached it).
  //
  //     Offline flavour (PLAY SOLO): the room-code UI is hidden (`online: false`) —
  //     the empty seats are the bot cast, not seats a second player can join.
  //
  //     Online flavour (CREATE ROOM / JOIN ROOM): the SAME lobby with the room code
  //     up top, seats filling live as joiners arrive, the slot editor for the room's
  //     creator, and RUSH! sending `startMatch`. This is the ratified fix for CREATE
  //     ROOM having had no lobby at all — a room you could not pick a map, a mode or
  //     a bot in, because the doors screen went straight to the match.
  //
  //     `?debug=1` skips the lobby exactly as it skips the menu (harness contract):
  //     the match boots straight in with the persisted-or-default hull and map, so
  //     the frozen goldens and every existing harness keep their immediate boot on
  //     the default `octagon` board.
  const lobby = flags.debug
    ? null
    : openLobby(
        app,
        platform,
        frontCtx,
        launch.kind === 'online'
          ? { session: launch.session, code: launch.room, you: launch.you, host: launch.host }
          : undefined,
      );
  // The lobby resolves with BOTH choices the player locked in at RUSH!: the hull
  // AND the arena (p2 field rule — the map picker moved into the lobby, so PLAY
  // goes menu → doors → LOBBY → RUSH! with no separate picker step). Online it
  // resolves on the server's `matchStart` instead, carrying the same local choices.
  // Under ?debug=1 there is no lobby, so both fall back to the persisted-or-default
  // values.
  const debugSize = readMatchSize(platform);
  const chosen: LobbyChoice = lobby
    ? await lobby.untilRush()
    : {
        shipClass: readShipClass(platform),
        mapId: readMapId(platform),
        name: readPlayerName(platform),
        mode: readMatchMode(platform),
        abundance: readAbundance(platform),
        ...(debugSize !== undefined ? { size: debugSize } : {}),
      };
  const chosenShipClass = chosen.shipClass;
  // The name shown over the local ship and station (field request v0.2.1) — the
  // lobby's, or the persisted-or-default "YOU" under ?debug=1 where there is none.
  const chosenName = normalizePlayerName(chosen.name);
  // Persist all three picks so a returning player finds them pre-selected (GDD
  // §2.11; p2 + field request v0.2.1 — same storage seam as the fire mode).
  if (lobby) {
    platform.storage.set(SHIP_CLASS_KEY, chosenShipClass);
    platform.storage.set(PLAYER_NAME_KEY, chosenName);
    // The match SHAPE is the room's, not the player's — mode, abundance, size and
    // arena. Offline (or as a host) those are this client's own picks and worth
    // remembering; in an online room a JOINER's local values were never the ones the
    // match was built from, so writing them back would teach a returning solo player
    // somebody else's settings.
    if (!onlineSession) {
      platform.storage.set(MAP_STORAGE_KEY, chosen.mapId);
      platform.storage.set(MATCH_MODE_KEY, chosen.mode);
      platform.storage.set(ABUNDANCE_KEY, chosen.abundance);
      if (chosen.size !== undefined) platform.storage.set(MATCH_SIZE_KEY, String(chosen.size));
    }
  }

  // --- The match. Eight slots, eight stations (GDD §2.1): this client flies one
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
  // Fresh matches are re-bootable, because REMATCH (below) tears the current one
  // down and stands a new one up in place — "straight to a fresh match" (GDD
  // §2.7). The seed advances each time so a rematch is a *different* arena, still
  // deterministic (GDD §4.8). `matchId` counts every world this boot builds — the
  // live-stage seam reads it to prove REMATCH constructed a new one, not re-showed
  // the old. `match`/`world` are `let`: every closure below reads the live binding,
  // so a rematch redirects the whole render/input path onto the new world at once.
  // The hull AND the arena are the LOBBY's choices (p2) — rematches keep both the
  // class and the map you picked; the seed advances, the layout does not. Under
  // `?debug=1` there is no lobby, so this is the persisted-or-default map and every
  // existing harness keeps its `octagon` board unless a test opts out.
  const chosenMapId = chosen.mapId;
  // The match SIZE the lobby resolved (variable-slots Milestone E). Threads into
  // `bootOfflineMatch` as the seat count, so closing seats in the lobby actually
  // builds a smaller world (local + N-1 bots). Undefined = the design's eight.
  // (Mode/abundance/team also ride the resolved config, but their offline
  // world-build wiring is Task C4 — Netcode — so only size takes effect here.)
  const chosenSize = chosen.size;
  // The sides the lobby authored, in the sim's dense player order (m10 teams-wire).
  // THIS is the offline half of teams: without it the roster reached `createWorld`
  // with no `team` at all, every ship defaulted to its own side, and a TEAMS lobby
  // built a free-for-all — the developer's "everyone attacked me and I could attack
  // everyone," reproduced offline through the unified lobby. In FFA the table is
  // `[0,1,2,…]`, which is exactly what the world defaulted to, so nothing moves.
  const chosenTeams = chosen.teams;
  let matchSeed = MATCH_SEED;
  let matchId = 0;
  function bootMatch(seed: number): MatchBoot {
    matchId += 1;
    return bootOfflineMatch({
      seed,
      localPlayer: LOCAL_PLAYER,
      shipClass: chosenShipClass,
      mapId: chosenMapId,
      ...(chosenSize !== undefined ? { slots: chosenSize } : {}),
      ...(chosenTeams !== undefined ? { teams: chosenTeams } : {}),
    });
  }
  // Online the match is already running on the server: present the live session as
  // the same {@link ClientMatch} the loop consumes, so the renderer, HUD, input
  // funnel and end screen are all shared with the offline game — the one
  // difference is that `tick` files input over the wire instead of stepping a
  // local `LocalLoopback` (GDD §4.2). Offline, `bootMatch` builds the loopback.
  let match: ClientMatch = onlineSession ? onlineMatchAdapter(onlineSession) : bootMatch(matchSeed);
  let world = match.world;

  // Reconnect grace, the render half (GDD §4.2). When a dropped client redials
  // inside the window and reclaims its seat, the server replays `matchStart` at
  // the live tick, so the session throws away its stale predicted world and
  // builds a fresh one from the reclaim seed + the static-entity re-teach
  // (`src/net/session` beginPredicting). That new world is a NEW object, so the
  // loop's captured `world` binding would otherwise render the frozen pre-drop
  // arena forever — re-point it here, exactly as `rematch` re-points on a fresh
  // match, and every render/input closure follows onto the reclaimed world at
  // once. The seat, hull, cargo and bank ride along untouched (the server never
  // removed the ship); this only reconnects the camera to it. The menu's own
  // `matchStart` observer already handed `boot()` this session, so by the time
  // this observer is attached the only `matchStart` left to see is a reclaim.
  if (onlineSession) {
    const session = onlineSession;
    session.observe((message) => {
      if (message.type === 'matchStart' && session.world) world = session.world;
    });
  }

  // --- Disconnect honesty (m10; the developer's zombie-match report) ---------
  //     *"Left browser, came back, disconnected — bots frozen but I could still
  //     move. I should get kicked out and presented reconnect / abandon buttons."*
  //
  //     The three halves of that, wired: the page tells the session when it goes
  //     away and comes back (the browser event nothing else in the match reads),
  //     the session's watchdog decides whether the link survived it
  //     (`src/net/link-loss`), and the DOM overlay says which and offers the two
  //     doors. The freeze itself needs no wiring here — it lives in `sendInput`,
  //     so a lost link stops the world wherever the loop happens to be.
  //
  //     Offline none of this exists: there is no wire to lose.
  let linkLossTimer: ReturnType<typeof setInterval> | null = null;
  if (onlineSession) {
    const session = onlineSession;
    installLinkLossView({
      dom: document,
      onReconnect: () => {
        session.reconnect();
        syncLinkLoss();
      },
      // ABANDON MATCH: say it on the wire so the seat is freed rather than held
      // for a minute (`src/net/transport` LeaveMessage), then leave the way every
      // other exit leaves — `exitToMenu` is the one teardown.
      onAbandon: () => {
        session.leave();
        exitToMenu();
      },
      onMenu: () => exitToMenu(),
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) session.linkHidden();
      else session.linkShown();
      syncLinkLoss();
    });
    // The render loop is not enough on its own: a throttled tab stops painting, and
    // a countdown nobody looks at does not tick. A quarter second is free.
    linkLossTimer = setInterval(syncLinkLoss, SESSION_LOG_POLL_MS);
    window.addEventListener('pagehide', () => {
      if (linkLossTimer !== null) clearInterval(linkLossTimer);
    });
  }

  /** Sample the link and draw (or withdraw) the overlay. Cheap by construction:
   *  while the link is live this is one clock read and one string comparison. */
  function syncLinkLoss(): void {
    if (!onlineSession) return;
    showLinkLoss(onlineSession.pollLink());
  }

  // The match world now exists — flip the menu's test seam so a clean-boot
  // live-stage run can prove it did NOT exist a moment ago, while the menu was up
  // (a no-op under ?debug=1, where there is no menu and this is null).
  mainMenu?.matchStarted();
  // Wire the menu seam's live match readback to the running world — the live ship
  // position and active scheme, read fresh each access (so a rematch that rebinds
  // `world` is tracked). Lets a clean-boot live-stage run prove the CONTROLS
  // setting it flipped through the front door actually flies the ship on a tap,
  // with no ?debug=1 seam. A no-op under ?debug=1, where there is no menu.
  mainMenu?.bindMatch(() => {
    const local = world.ships.find(isLocalShip);
    return { scheme: controlScheme, shipPos: local ? { x: local.pos.x, y: local.pos.y } : null };
  });
  // Hand the lobby seam the hull AND the arena the sim ACTUALLY built, read back
  // off the world itself — the hull off the local ship, the arena off the world's
  // own home-station positions. This is the proof BOTH lobby picks reached the sim
  // (GDD §2.11 "the ship you fly IS the hull you picked"; p2 "the booted world
  // matches that registry entry" — the live-stage spec compares these stations to
  // the bundled registry). A no-op under ?debug=1, where there was no lobby.
  lobby?.matchStarted(
    world.ships.find(isLocalShip)?.shipClass ?? chosenShipClass,
    chosenMapId,
    world.stations.map((p) => ({ x: p.pos.x, y: p.pos.y })),
  );

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

  // --- Input probe (debug-hook.ts `installInputProbe`): only when ?debug=1.
  //     Exposes window.__planetRush.input — the abstract actions the sim received
  //     this frame — so the input-parity live-stage suite can fire each control via
  //     CDP touch and prove it crossed into the sim. Inert otherwise.
  const inputProbe = installInputProbe(window.location.search);

  // --- Combat-visuals instrument (combat-debug.ts): only when ?debug=1. Exposes
  //     window.__planetRush.muzzles (the muzzle-flash set actually drawn this frame,
  //     one per firing turret) and .stageCombat() so a live-boot suite can prove the
  //     non-local turret WIRING the m2-11 unit suite cannot reach. Inert otherwise.
  const combatDebug = installCombatDebug(window.location.search);
  if (combatDebug.enabled) combatDebug.setStager(() => stageCombatFor(world));

  // --- Debug WRITE seams (debug-hook.ts `installDebugStage`): only when ?debug=1.
  //     The round-9 QA unblock — damage any owner's ship, damage any player's core,
  //     read any core's HP — merged onto the same window.__planetRush handle. The
  //     two damage seams do NOT poke world state: they queue a debug Action kind
  //     that `debugStage.drain()` applies once per fixed step (below), on a tick
  //     boundary, through the sim's OWN damage functions. So the write rides the
  //     same ordered pulse real input does — determinism and the net wire intact.
  //     The bridge holds the sim-touching logic here (main.ts owns `world`), the
  //     way combat-debug's stager does. Inert (and never drained) otherwise.
  const debugStage = installDebugStage(window.location.search);
  if (debugStage.enabled) {
    debugStage.setBridge({
      damageShip(owner: PlayerId, amount: number): void {
        const ship = world.ships.find((s) => s.id === owner);
        if (ship) damageShip(world, ship, amount);
      },
      damageCore(player: PlayerId, amount: number): void {
        const station = stationOf(world, player);
        if (station) damageStation(world, station, amount);
      },
      coreHp(player: PlayerId): number | null {
        const station = stationOf(world, player);
        return station ? station.coreHp : null;
      },
    });
  }

  // --- HUD overlay: screen-space, added after the world root so it draws on top
  //     of the render layer in the same canvas (ui/hud.ts owns the layout).
  // The UI sound seam (field report v0.2.4+): the HUD's one shared press/confirm
  // driver names an event — press, confirm, reject — and the audio engine decides
  // the sound, the SFX-slider gain and the death-hush ducking (`art/audio` cue()).
  // So every wheel/menu control is heard from the same state that draws its tell,
  // and a disabled press gets the buzzer main.ts alone could never fire (it does
  // not know a wedge's `ready` state — the HUD does).
  //
  // Under ?debug=1 the seam also tallies the cue KIND, which `__audioStage` reads
  // back so a live-stage test can attribute a sound to the exact interaction
  // (a live wedge → press, a disabled one → reject, a landed spend → confirm) —
  // proof the RIGHT sound fired, not just that the one-shot count moved. Zero-cost
  // (null) in a normal build.
  const uiSfxLog: { press: number; confirm: number; reject: number; last: UiCue | null } | null = flags.debug
    ? { press: 0, confirm: 0, reject: 0, last: null }
    : null;
  const hud = new Hud(transform.logicalWidth, transform.logicalHeight, (cue) => {
    if (uiSfxLog) {
      uiSfxLog[cue]++;
      uiSfxLog.last = cue;
    }
    audio.cue(cue);
  });
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
    hud.enableNameplateDebug();
    hud.enableTapMarkerDebug();
    hud.enableMinimapDebug();
    installHealthbarStage();
    installNameplateStage();
    installOreDepositStage();
    installOreHudStage();
    installEndScreenStage();
    installUpgradeWheelStage();
    installPressStage();
    installRepairStage();
    installTapCommanderStage();
    installTapMarkerStage();
    installMinimapStage();
    installAudioStage();
  }

  // The pause seam is installed on BOTH boots, unlike the debug stages above, and
  // for the same reason `installBuildBadgeSeam` is: the thing it has to prove only
  // exists on the CLEAN boot. `?debug=1` drops straight into an offline match with
  // no menu (`mainMenu` is null above), so an online match is reachable only
  // through the front door — and "an online pause must NOT pause the sim" (GDD
  // §4.2, ratified M10) is exactly a claim about an online match. Gated, the
  // ratified rule would be unprovable in a real browser, which is where the M2
  // dark-matter class of bug lives.
  //
  // It is safe to ship for the same reason `__lobby` and `__mainMenu` are: pure
  // read-back plus the physical points the client itself drew, no mutators, and it
  // computes nothing until something calls `read()`.
  installPauseStage();

  // --- Touch controls made visible (touch-visuals.ts) — the dynamic sticks and
  //     the fire-mode morph the player actually sees. On top of the HUD so the
  //     thumbs read clearly; the layer hides itself entirely on desktop.
  const touchVisuals = new TouchVisuals();
  gameRoot.addChild(touchVisuals);

  // --- Build badge: already on screen (it was created with `badgeRoot`, before
  //     the menu, and has been drawing on every screen since). The match is the
  //     one place with furniture in the bottom-left corner — the desktop controls
  //     strip along the bottom edge — so this is where the badge is lifted clear
  //     of it. Nothing may cover a control (m10-14), and the strip's labels are
  //     no exception to that in the other direction either.
  buildBadge.lift = showControlsStrip(isTouch) ? BADGE_STRIP_LIFT : 0;
  // …and the ping rides one line above the stamp, so the pair clears the strip
  // together rather than the ping landing on top of the sha.
  pingBadge.lift = buildBadge.lift + PING_BADGE_STACK_LIFT;

  // --- Re-enter-fullscreen affordance (fullscreen-affordance.ts): the small
  //     top-right button that appears only when the player has backed out of
  //     fullscreen on a device that can re-enter (field request v0.1.1). On
  //     gameRoot so it rides the landscape-lock rotation; above the HUD so a
  //     thumb can reach it. Hidden until `fullscreen.affordanceVisible()` says so.
  const fsAffordance = new FullscreenAffordance();
  gameRoot.addChild(fsAffordance);

  // --- End-of-match / DEFEATED overlay (field report v0.1.2; GDD §2.7, §4.7).
  //     The two ways a player's match can end, each with its own screen:
  //       - Your core dies while the others fight on → the DEFEATED overlay,
  //         with SPECTATE (free the camera, watch the rest) or REMATCH.
  //       - The last core falls (you win, or you're a spectator when it does) →
  //         the result screen: winner, and REMATCH / BACK TO MENU.
  //     The screen the field report caught missing entirely: the developer's home
  //     died and NOTHING happened, because these views (PR #45) were never wired
  //     into the boot path. Topmost so its backdrop covers the live match under
  //     it; hidden until `syncEndScreen()` (fed off `world.match`) says otherwise.
  //     The UI decides presentation; the sim decides truth; this file only wires.
  const endOverlay = new EndOfMatchView(transform.logicalWidth, transform.logicalHeight, isTouch);
  endOverlay.visible = false;
  gameRoot.addChild(endOverlay);
  /** Which end screen is up, if any — driven each frame from sim state. */
  let endScreen: 'none' | 'defeated' | 'result' = 'none';
  /** The player chose SPECTATE: suppress the DEFEATED overlay and let the live
   *  match play on under a freed camera — until it ends and the result screen
   *  takes over. Reset on rematch. */
  let spectating = false;
  /** The buttons the overlay is currently offering — the live-stage seam reads
   *  these back to prove SPECTATE/REMATCH are present on the DEFEATED screen. */
  let endButtonsShown: EndButton[] = [];
  /** Who the camera follows. Your own ship until you're eliminated and SPECTATE
   *  frees it onto a survivor (GDD §2.7 "watch the rest"). Reset on rematch. */
  let cameraTarget: PlayerId = LOCAL_PLAYER;

  let fireMode = readFireMode(platform, isTouch);
  // The active control scheme (developer §3): the twin-stick/keyboard/gamepad
  // 'sticks' scheme (default, untouched) or 'tap' — Tap Commander, where a
  // tap/click places a move or a lock and the local pilot flies the ship. Read
  // through the same storage seam as the fire mode; a stale value folds to
  // 'sticks', so nothing a player ever saved can seat an unknown scheme.
  let controlScheme = readControlScheme(platform);
  // The active input device drives the controls strip + prompt wording (GDD
  // §2.4 auto device-switch); updated in sampleInput() by whichever device acts.
  let activeDevice: DeviceKind = isTouch ? 'touch' : 'keyboard';

  // --- Pause menu (developer ratification, p10) ------------------------------
  //     ESC (desktop) or a touch corner button opens an overlay over a match in
  //     progress: RESUME / SETTINGS / EXIT TO MENU — EXIT behind a "Leave the
  //     match?" confirm so one stray tap can never kill a match. The overlay is
  //     ignorant of HOW a match pauses: `pausable` is the transport's flag —
  //     offline (this in-process LocalLoopback) the sim FREEZES while it is up
  //     (the loop below skips its tick and resumes seamlessly); online (m9) it
  //     shows over a running sim. The whole distinction lives in `shouldFreezeSim`;
  //     the flag path is built now, offline `true`, so the networked-`false`
  //     branch is testable before that transport exists (developer §2). Topmost,
  //     so it draws over the live match and HUD; its visibility is driven by
  //     `syncPause()` each frame.
  // Offline the in-process LocalLoopback can freeze; online the authoritative sim
  // runs on the server and cannot be paused, so the overlay shows over a live
  // match (the networked-`false` branch this flag was built for — developer §2).
  const pausable = onlineSession === null;
  let pauseScreen: PauseScreen = 'closed';
  // The match's live settings, so the pause SETTINGS screen shows and changes the
  // real values mid-match (reduce-VFX floors the auto-reducer, the volumes drive
  // the mixer). Seeded to the same DEFAULT_VOLUMES the audio engine booted with.
  let matchSettings = createSettings();
  const pauseView = new PauseMenuView(transform.logicalWidth, transform.logicalHeight, isTouch);
  gameRoot.addChild(pauseView);
  // The pause SETTINGS screen reuses the real settings view (one settings UI, not
  // two), shown in the overlay's place while `pauseScreen === 'settings'`.
  const pauseSettings = new SettingsView(transform.logicalWidth, transform.logicalHeight, isTouch);
  pauseSettings.visible = false;
  gameRoot.addChild(pauseSettings);

  const merged = createControlState();
  const sources: { source: InputSource; state: ControlState; device: DeviceKind }[] = [
    {
      source: new KeyboardMouseSource(() => ({ x: transform.logicalWidth / 2, y: transform.logicalHeight / 2 })),
      state: createControlState(),
      device: 'keyboard',
    },
    {
      source: new GamepadSource(),
      state: createControlState(),
      device: 'gamepad',
    },
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

  // --- Tap Commander (developer's ratified tap/click-to-move, tap/click-to-attack
  //     scheme). A LOCAL PILOT, not a new protocol: it writes the SAME thrust/aim/
  //     fire the sticks do into a scratch control state, from the player's standing
  //     order (a waypoint, or a locked target). It fires no new Action and touches
  //     no sim/wire — it files input the way a bot does. Firing range is fed from
  //     the sim's own `WEAPON_RANGE` so the pilot carries no sim constant; it holds
  //     comfortably inside range (`fireRange`) and closes to a standoff (`engageRange`).
  const tapPilot = new TapPilot({
    fireRange: WEAPON_RANGE * 0.82,
    engageRange: WEAPON_RANGE * 0.5,
    // The tractor pickup radius (GDD §2.3), so a mined-rock lock holds INSIDE the
    // grab range and its chipped ore reaches the hold (developer p9-02 range fix) —
    // fed from the sim's single source, never a copied literal.
    pickupRadius: TRACTOR_PICKUP_RADIUS,
  });
  const pilotState = createControlState();
  /** Reused per-frame resolved-target record, so re-resolving a lock allocates
   *  nothing on the input path (GDD §4.3). */
  const resolvedTarget: {
    pos: Vec2;
    radius: number;
    hostile: boolean;
    standoff?: number;
    mineable?: boolean;
  } = {
    pos: { x: 0, y: 0 },
    radius: 0,
    hostile: false,
  };
  /** Reused per-frame ship kinematics handed to the pilot (zero-alloc). */
  const pilotShip: { pos: Vec2; radius: number } = { pos: { x: 0, y: 0 }, radius: 0 };
  /** Reused per-frame marker records handed to the HUD's tap-marker layer, so the
   *  order-marker feed allocates nothing while an order stands (GDD §4.3). The
   *  waypoint mark doubles as the projection scratch; the lock mark carries the
   *  target's projected centre + its screen radius. */
  const tapWaypointMark: Vec2 = { x: 0, y: 0 };
  const tapLockMark: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 0 };
  const tapLockScreen: Vec2 = { x: 0, y: 0 };
  /** Reused candidate list + records for tap hit-testing, grown once and refilled
   *  on each tap (a tap is rare; this still avoids per-tap garbage). */
  const tapCandidatePool: MutTapCandidate[] = [];
  const tapCandidates: TapCandidate[] = [];
  const worldTapPoint: Vec2 = { x: 0, y: 0 };
  /** Camera-inverse scratch (screen → world for a tap), reused per tap. */
  const camTargetScratch: Vec2 = { x: 0, y: 0 };
  const camOffsetScratch: Vec2 = { x: 0, y: 0 };

  // --- The Build & Upgrade wheel (GDD §2.5). `buildWheel` holds the two bits of
  //     screen state the pure UI models deliberately don't — is it up, is the
  //     upgrade panel in front of it — and turns a press into a segment. What
  //     the wheel *says* is `src/ui`'s; what a press *lands on* is here.
  const buildWheel = new WheelInput();
  /** The sim's own docking answer, refreshed each input tick. Read by the touch
   *  BUILD button (which exists only at your own station) and the HUD. */
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
  /** The upgrade wheel has drilled into the WEAPON sub-wheel (RATIFIED v0.2.2).
   *  Held here — the two bits of wheel screen state (`up`, `panel`) live in
   *  `WheelInput`; the third level (the nested weapon wheel) is UI navigation, so
   *  it lives with the other UI wiring and feeds the HUD. Reset whenever the
   *  upgrade panel closes, so re-opening always lands on the main wheel. */
  let weaponWheelOpen = false;
  /** A track wedge pressed on the OPEN upgrade wheel this frame, latched here for
   *  one tick and drained into the input funnel by `updateBuildWheel` (RATIFIED
   *  v0.2.2 fix). The upgrade wheel is drawn as a RADIAL wheel; a press is
   *  hit-tested radially in the pointer handler (like the Build wheel), never as a
   *  row panel — the mismatch that silently bought the wrong track, or nothing
   *  (field report v0.2.2: "most of the ship upgrades weren't working"). Nav wedges
   *  (WEAPON, BACK) set no track — they flip `weaponWheelOpen` instead. `null` on
   *  every other frame. */
  let pendingUpgrade: UpgradeTrack | null = null;

  /**
   * Pop exactly one wheel LEVEL, the BACK affordance the hub tap and ESC share
   * (field report v0.2.4 — {@link @ui/wheel-nav}). WEAPON sub-wheel → upgrade
   * wheel → Build wheel → closed, one step per call, mirroring the level stack
   * `wheelLevel` derives. Returns whether anything was open to back out of, so the
   * caller can consume the event only when it did something. The three bits of
   * state are the platform `WheelInput.open`/`.panelOpen` and the UI's
   * `weaponWheelOpen`, exactly as the HUD reads them, so there is no fourth copy.
   */
  function wheelBackOneLevel(): boolean {
    if (!buildWheel.open) return false;
    if (buildWheel.panelOpen) {
      if (weaponWheelOpen) weaponWheelOpen = false; // WEAPON sub-wheel → upgrade wheel
      else buildWheel.closePanel(); // upgrade wheel → Build wheel
    } else {
      buildWheel.close(); // Build wheel → closed
    }
    return true;
  }

  // --- Haptics event detection (field request v0.2.2). `feedHaptics` derives the
  //     three combat vibrations — you-were-hit, base-under-attack, core-lost — from
  //     the same live sim values the HUD reads, once per rendered frame. State here,
  //     the function down by `feedHud`. `null` means "no baseline yet" (first frame
  //     of a match / after a rematch), so a fresh full-HP world never false-fires.
  let hapticPrevHull: number | null = null;
  let hapticPrevDefense: number | null = null;
  let hapticWasEliminated = false;
  /** Last time a `hit` fired — debounces sustained fire into one knock, not a buzz
   *  every frame. `alarmPressure` accumulates base damage and decays, so a stray
   *  shot never rings the alarm but a sustained assault does (mirrors the audio
   *  alarm's intent; the pattern is the tactile half of it). */
  let hapticLastHitMs = 0;
  let hapticAlarmPressure = 0;
  let hapticLastAlarmMs = 0;

  // Drawn-geometry scratch, overwritten per press (never per frame): the hit
  // targets are computed from the very functions `src/ui` draws the wheel and
  // the panel with, so a press lands on the wedge the player actually sees.
  const buildWheelLayout = { centerX: 0, centerY: 0, radius: 0, segments: WHEEL_ORDER.length };
  // The open upgrade wheel's hit target — same geometry as the Build wheel, but
  // its slot count changes with the level (main wheel vs. WEAPON sub-wheel), so
  // `segments` is set per press. Hit-tested radially, like the Build wheel.
  const upgradeWheelLayout = { centerX: 0, centerY: 0, radius: 0, segments: TRACK_ORDER.length };
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

    // The pause overlay (developer p10) owns the whole screen while it's up, like
    // the end overlay: a tap lands on a pause control or on nothing, but never
    // falls through to the frozen match under it. First refusal, always consumes.
    if (isPauseOpen(pauseScreen)) {
      handlePausePointer(lp.x, lp.y);
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // The touch corner pause button — the ESC-equivalent on a device with no
    // keyboard. On screen only while the match owns it (`pauseAvailable`), so a tap
    // can only land on a button that is actually there. Opens the overlay.
    if (isTouch && pauseButtonVisible({ isTouch, available: pauseAvailable() })) {
      const pb = pauseButtonRect({ width: transform.logicalWidth, height: transform.logicalHeight });
      if (inRect(pressPoint, pb)) {
        haptics.haptic('tap');
        audio.cue('press');
        pauseScreen = nextPauseScreen(pauseScreen, 'toggle');
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
    }

    // The end-of-match / DEFEATED overlay owns the whole screen while it's up: a
    // tap either lands on REMATCH / SPECTATE / BACK TO MENU or on nothing, but it
    // NEVER falls through to fly a dead ship or open the wheel. First refusal,
    // and it always consumes the event.
    if (endOverlay.visible) {
      const target = endOverlay.hitTest(lp.x, lp.y);
      if (target) {
        haptics.haptic('tap');
        audio.cue('press'); // the audible twin of the press haptic (engine.ts)
        handleEndTarget(target.kind);
      }
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // The re-enter-fullscreen affordance — present only after the player backed
    // out of fullscreen (field request v0.1.1). This tap IS a fresh user gesture,
    // so re-entering fullscreen from here is legal. Consumes the event so the tap
    // doesn't also engage a stick under it.
    if (fsAffordance.visible && fsAffordance.hitTest(lp.x, lp.y, w, h)) {
      haptics.haptic('tap');
      audio.cue('press');
      fullscreen.enter();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // The touch BUILD button — the E-equivalent, on screen only at your own
    // station (GDD §2.4). Toggles the wheel exactly as E and Y do. The hit target
    // comes from the same `buildVisible` that draws it, so a tap can only land on
    // a button that is actually there.
    const build = buildButtonRect(isTouch, buildVisible, w, h);
    if (build && inRect(pressPoint, build)) {
      haptics.haptic('tap');
      audio.cue('press'); // the BUILD button opened/closed the wheel — a press tick
      buildWheel.toggle();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    buildWheelLayout.centerX = w / 2;
    buildWheelLayout.centerY = h / 2;
    buildWheelLayout.radius = wheelRadius(w, h);

    // --- The OPEN upgrade wheel is a RADIAL wheel, not a row panel -----------
    // It is drawn by the SAME wedge routine as the Build wheel (one wedge per
    // slot, clockwise from twelve o'clock), so a press must be hit-tested the
    // SAME way — radially, against the drawn wedge — and NEVER against a stack of
    // panel rows. Mapping a radial wedge onto a vertical row index is what bought
    // the wrong track (or nothing) and made "most of the ship upgrades weren't
    // working" (field report v0.2.2). Its slot count changes with the level (the
    // main wheel vs. the WEAPON sub-wheel), so the hit target is built per press.
    if (buildWheel.open && buildWheel.panelOpen) {
      const upgradeSlots = upgradeWheelSlots(weaponWheelOpen);
      upgradeWheelLayout.centerX = w / 2;
      upgradeWheelLayout.centerY = h / 2;
      upgradeWheelLayout.radius = wheelRadius(w, h);
      upgradeWheelLayout.segments = upgradeSlots.length;

      const hit = hitWheel(pressPoint.x, pressPoint.y, upgradeWheelLayout);
      // A wedge sounds itself through the HUD's shared driver (`pressWheelSegment`
      // → the sfx seam): a live wedge ticks, a disabled one buzzes — matched to
      // its own drawn state. Only the BACK/dismiss tap (hub or off-wheel) needs a
      // press tick fired here, so track whether a wedge already sounded.
      let wedgeSounded = false;
      if (hit.kind === 'outside' || hit.kind === 'hub') {
        // The hub is the BACK affordance (field report v0.2.4), and a tap off the
        // wheel dismisses too — both pop exactly ONE level: WEAPON sub-wheel →
        // upgrade wheel, upgrade wheel → Build wheel. Consistent with ESC and the
        // Build wheel's own hub, so "go up a level" is one gesture everywhere.
        wheelBackOneLevel();
      } else if (hit.kind === 'segment') {
        const slot = upgradeSlots[hit.index];
        if (slot?.kind === 'weapon') {
          // Open the nested WEAPON sub-wheel — it must OPEN, not fall through and
          // close the upgrade wheel back to the Build wheel (field report v0.2.2).
          weaponWheelOpen = true;
          hud.pressWheelSegment('upgrade', hit.index);
          wedgeSounded = true;
        } else if (slot?.kind === 'track') {
          // Latch the pressed track; `updateBuildWheel` drains it into the funnel
          // as an `upgradeOrder` on the next tick, exactly like a Build segment.
          pendingUpgrade = slot.track;
          hud.pressWheelSegment('upgrade', hit.index);
          wedgeSounded = true;
        }
      }
      // The open wheel consumes every press, so a tap on it never also flies the
      // ship or opens a stick under it.
      haptics.haptic('tap');
      if (!wedgeSounded) audio.cue('press'); // the BACK/dismiss tick (a wedge sounded itself)
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // Pressed-state tell (field report v0.2.2): before the press is consumed,
    // tell the HUD which Build-wheel wedge the finger landed on, so it flashes the
    // pressed (scale + glow) or rejected (shake + red flash) visual. The HUD
    // decides which from the wedge's own drawn state.
    let buildWedgeSounded = false;
    if (buildWheel.open && !buildWheel.panelOpen) {
      const wheelHit = hitWheel(pressPoint.x, pressPoint.y, buildWheelLayout);
      if (wheelHit.kind === 'hub') {
        // The hub is the BACK affordance (field report v0.2.4): on the top-level
        // Build wheel, backing out closes it. Consume so the same tap doesn't fall
        // through to fly the ship or engage a stick under it.
        wheelBackOneLevel();
        haptics.haptic('tap');
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      // A Build wedge sounds itself through the HUD's shared driver (press tick,
      // or the buzzer if it is disabled) — so a press here does not also cue one.
      if (wheelHit.kind === 'segment') {
        hud.pressWheelSegment('build', wheelHit.index);
        buildWedgeSounded = true;
      }
    }

    if (buildWheel.press(pressPoint.x, pressPoint.y, buildWheelLayout, panelLayout, UPGRADE_SEGMENT)) {
      haptics.haptic('tap'); // a wedge/segment was pressed — the lightest press tell
      if (!buildWedgeSounded) audio.cue('press'); // …and its audible twin, unless the wedge sounded itself
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // The minimap (field request v0.2.2): a click/tap on the corner square opens
    // the centred overlay; a tap anywhere on the overlay collapses it again. The
    // SAME gesture on PC and mobile — `pressPoint` is already in logical space,
    // where the minimap lays out, and `hud.minimapTap` runs the same pure hit test
    // both platforms use (docs/input-parity.md). Checked LAST among the interactive
    // surfaces — after the end/fullscreen overlays, the BUILD button and the open
    // wheel — so the glance map is the lowest-priority claim:
    // a control drawn near or over it always wins the press, and the map only takes
    // one that lands on nothing else. When it does claim a press we consume the
    // event so the same press never also flies the ship or engages a stick under it.
    if (hud.minimapTap(pressPoint.x, pressPoint.y)) {
      haptics.haptic('tap');
      audio.cue('ping'); // the glance map — a rising sonar blip (locate, not alarm)
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    // --- Tap Commander (developer §1–2, p10): a primary tap no affordance claimed
    //     places the ship's next order — OR opens the build wheel. Empty space → move
    //     there; a rival ship / turret / core or an asteroid → LOCK it ("a rock is
    //     just a target"); YOUR OWN STATION within build range → open the Build wheel
    //     (developer p10 §1), and too far → a plain move toward it (a second tap when
    //     close opens). `pressPoint` is already un-rotated into logical space (the
    //     landscape lock); project it back to WORLD space through the live camera and
    //     hit-test the world. The pilot is the one place these semantics live
    //     ({@link TapPilot.resolveTap}) — it applies the move/lock to its own order and
    //     hands back the wheel intent, which is carried out here. Consumes the event so
    //     the same tap never also engages a stick under it. A no-op in the default
    //     'sticks' scheme, so that path is byte-for-byte unchanged.
    //
    //     The open wheel claims its own taps FIRST (its `press` closes on an outside
    //     tap, its wedges consume inside ones — the returns above), so a tap reaching
    //     here has the wheel closed; `inBuildRange` is the SAME `docked` answer the
    //     wheel gates on, reused rather than re-derived (developer p10 §1).
    if (controlScheme === 'tap' && e.button === 0) {
      logicalToWorld(pressPoint, worldTapPoint);
      const hit = pickTapTarget(buildTapCandidates(), worldTapPoint);
      const cmd = tapPilot.resolveTap(hit, worldTapPoint, {
        wheelOpen: buildWheel.open,
        insideWheel: false,
        inBuildRange: docked,
      });
      if (cmd.kind === 'openWheel') {
        // Tap your station in build range → open the same wheel E / Y / BUILD open.
        if (!buildWheel.open) buildWheel.toggle();
        audio.cue('press'); // the wheel came up — a press tick, like the BUILD button
      } else if (cmd.kind === 'closeWheel') {
        // Defensive: the wheel's own `press` already closes on an outside tap before
        // this block, so this only fires if that path is ever bypassed — pop one
        // level the wheel family's own way, never a re-derived close.
        wheelBackOneLevel();
      }
      // move / lock: the pilot has already taken the order; passThrough: nothing.
      haptics.haptic('tap');
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

  // --- Name-label feed (field request v0.2.1): the per-slot name table and a
  //     reused pool of mutable label-bearing entities `feedNameplates()` fills
  //     each render, so labelling every ship + owned station allocates nothing
  //     after warm-up (GDD §4.3). The table is (re)built from the match's own
  //     seated cast each boot — local name + each bot's personality name.
  const nameablePool: MutNameable[] = [];
  const nameableFrame: Nameable[] = [];
  let playerNames: NameTable = [];
  let playerDifficulties: DifficultyTable = [];
  /** Each slot's side, and whether the match has sides worth naming (m10 teams).
   *  Rebuilt with the name table, from the same live world, on every boot and
   *  rematch — so a rematch that changed the split relabels with it. */
  let playerTeams: TeamTable = [];
  let teamsMode = false;

  // --- Minimap feed (field request v0.2.2): the sim-driven dots in MAP space —
  //     stations, ships, ore-field hints, the collapse ring — pooled and reused so
  //     the corner map allocates nothing after warm-up (GDD §4.3). The minimap
  //     does its own fit (map → rect), so unlike the bars/labels this feed is NOT
  //     projected to screen; it hands the HUD live world positions. Redraw cadence
  //     is the VIEW's job (throttled to a cached texture, ./minimap-view).
  const minimapStationPool: MutMinimapStation[] = [];
  const minimapStations: MinimapStation[] = [];
  const minimapShipPool: MutMinimapShip[] = [];
  const minimapShips: MinimapShip[] = [];
  const minimapSatellitePool: MutMinimapSatellite[] = [];
  const minimapSatellites: MinimapSatellite[] = [];
  const minimapOrePool: { x: number; y: number }[] = [];
  const minimapOre: { x: number; y: number }[] = [];
  const minimapCollapse: { x: number; y: number; radius: number } = { x: 0, y: 0, radius: 0 };
  // --- Fog of war (feature f1): the viewer's current sensor-coverage discs +
  //     the remembered-station bitmask, fed each frame so the minimap renders ONLY
  //     the sensed-state (`../sim/sensing`). Discs are pooled; the mask is a plain
  //     number. The fog GATING (what's dark / dimmed / live) is the pure model's
  //     job (src/ui/minimap.ts) — main only supplies the raw coverage geometry.
  const minimapCoveragePool: MutMinimapCoverage[] = [];
  const minimapCoverage: MinimapCoverage[] = [];
  const minimapFog: { -readonly [K in keyof MinimapFog]: MinimapFog[K] } = {
    coverage: minimapCoverage,
    rememberedMask: 0,
  };
  const minimapFrame: {
    bounds: { width: number; height: number };
    stations: MinimapStation[];
    ships: MinimapShip[];
    satellites: MinimapSatellite[];
    oreHints: { x: number; y: number }[];
    collapse: { x: number; y: number; radius: number } | null;
    fog: MinimapFog | null;
  } = {
    bounds: { width: 0, height: 0 },
    stations: minimapStations,
    ships: minimapShips,
    satellites: minimapSatellites,
    oreHints: minimapOre,
    collapse: null,
    fog: null,
  };
  /** Rebuild the per-slot name table (and its mirror difficulty table) from the
   *  live match: the local player's chosen name (from the lobby, or persisted
   *  default under ?debug=1) plus each seated bot's personality name (GDD §2.9),
   *  and each bot seat's difficulty tier (field request v0.2.2 — shown as a
   *  recessive nameplate suffix). The local (human) seat is left out of the
   *  difficulty table so it never shows a tag. Data-driven — when online lands
   *  (m9) the room's remote names/difficulties populate these same tables with no
   *  other change. */
  function rebuildNameTable(): void {
    const table: string[] = [];
    const tiers: (string | undefined)[] = [];
    table[LOCAL_PLAYER] = chosenName;
    for (const bot of match.bots) {
      table[bot.seat.id] = personality(bot.seat.personality).name;
      tiers[bot.seat.id] = bot.difficulty;
    }
    playerNames = table;
    playerDifficulties = tiers;
    rebuildTeamTable();
  }

  /**
   * Rebuild the per-slot side table from the LIVE WORLD (m10 teams).
   *
   * The world is the authority on allegiance in both form factors — offline it is
   * the loopback's own authoritative world, online it is the predicted world
   * `matchStart` built from the server's roster — so reading `ship.team` here means
   * the `TEAM A` a player reads over a hull is the same number `areEnemies` uses to
   * decide whether they can shoot it. Reading the lobby instead would let the label
   * drift from the simulation, which is the exact class of bug this milestone is
   * fixing.
   *
   * Sides are worth *naming* only when there are fewer sides than players: FFA is
   * teams-of-one, where `ship.team === ship.id` for everyone and a label would just
   * repeat the nameplate.
   */
  function rebuildTeamTable(): void {
    const sides: (number | undefined)[] = [];
    const distinct = new Set<number>();
    for (const ship of world.ships) {
      const side = ship.team ?? ship.id;
      sides[ship.id] = side;
      distinct.add(side);
    }
    playerTeams = sides;
    teamsMode = distinct.size > 0 && distinct.size < world.ships.length;
  }
  rebuildNameTable();

  // --- Freeze (?freeze=1, with ?debug=1): advance the sim to a fixed seeded
  //     tick, then hold it there so screenshots are deterministic across boots
  //     (GDD §4.8). The world is plain seeded data + a pure `step`, so pinning
  //     the entry point pins the frame (src/platform/freeze.ts).
  if (flags.freeze) {
    advanceToFreezeTick(world, FREEZE_TICK);
    // Stage the defence showcase so the frozen golden reviews the structure art
    // (a2-05): structures never appear in a natural 2-second opening, so without
    // this the golden could never show a turret, scaffold or shield bubble.
    stampDefenseShowcase(world, LOCAL_PLAYER);
  }
  const frozenHash = flags.freeze ? hashWorld(world) : null;

  // --- Layout registry (?debug=1): every positioned visual element registers
  //     its declared anchor + actual rendered rect each frame, exposed READ-ONLY
  //     at window.__planetRush.layout (src/platform/layout-registry.ts). Null —
  //     and every registration below skipped — in a normal build.
  const registry = flags.debug ? new LayoutRegistry() : null;
  const touchRects: TouchAffordanceRects = { leftStickZone: null, aimZone: null, fireButton: null };
  const shipRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  // Tap Commander order-marker rects + a projection scratch, reused each frame.
  const waypointRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const reticleRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const markerScreen: Vec2 = { x: 0, y: 0 };
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
      // Offline pause (developer §2): while the pause overlay is up over a
      // `pausable` (offline) match the sim FREEZES — skip the tick entirely, so
      // no time passes and RESUME picks up exactly where it left off. Render still
      // runs below, so the overlay is live. Online (m9, not pausable) this is
      // false and the sim keeps ticking under the overlay.
      if (shouldFreezeSim(pauseScreen, pausable)) return;
      // One input tick per fixed step, in order — the pulse the whole protocol
      // is built on. Every bot seat files for the same tick first, then this
      // client's input advances the authoritative sim (GDD §4.2, §2.9).
      match.tick(sampleInput());
      simTicks++;
      // Apply any queued ?debug=1 write-seam actions (damageShip/damageCore) for
      // this tick, in FIFO order — a no-op in a normal build. Drained HERE, right
      // after the authoritative step, so a debug write lands on a tick boundary
      // like real input rather than mid-frame (debug-hook.ts `installDebugStage`).
      if (debugStage.enabled) debugStage.drain();
    },
    render: () => {
      // Measure this real frame and let the auto-reducer decide VFX quality. In
      // freeze mode the sim is pinned for byte-deterministic goldens, so VFX stay
      // full — a reduced glow would change the frame the screenshot captures.
      const nowMs = performance.now();
      const frameSeconds = (nowMs - lastRenderMs) / 1000;
      lastRenderMs = nowMs;
      // Reduce VFX when the auto-reducer engages on a sustained fps drop OR the
      // player set the floor by hand in settings (GDD §4.8 risk 5 — one flag, two
      // ways to flip it). `sample` is evaluated first so the frame-time tracker
      // keeps running even while the manual floor is on. Freeze keeps full VFX so
      // the golden frame is byte-deterministic.
      renderer.setReduceVfx(flags.freeze ? false : vfxQuality.sample(frameSeconds) || matchSettings.reduceVfx);

      renderer.draw(world, { cameraTarget, muzzles: currentMuzzles() });
      // Audio (src/art/audio): sound this frame the same way it is drawn. Derive
      // tells off the live world (the audible twin of the VFX field, GDD §3.6),
      // sound them, then advance the standing voices, the alarm, the adaptive
      // soundtrack and the death hush. The listener follows the SAME camera the
      // renderer just used, so a siege on the far side of the map stays background
      // (earshot falloff, engine.ts). A no-op when running silent (no context).
      const heard = world.ships.find((s) => s.id === cameraTarget);
      if (heard) audio.setListener(heard.pos.x, heard.pos.y);
      audioTells.clear();
      audioObserver.observe(world, frameSeconds, audioTells);
      audio.consume(audioTells);
      audio.update(frameSeconds);
      // Phones lock and tabs get backgrounded mid-match; the context comes back
      // suspended and the rest of the game is silent unless something re-arms the
      // unlock. Cheap, and a no-op while the context is running (risk 7).
      audioUnlock?.recheck();
      feedHud();
      // Combat haptics (field request v0.2.2): read the same core/shield/hull
      // values feedHud just pulled and buzz on hit / under-attack / core-lost. A
      // silent no-op where there's no motor or the player switched it off.
      feedHaptics(nowMs);
      // Health bars over every non-local combat entity (GDD §2.2). Fed AFTER
      // renderer.draw so the camera transform is current: each combatant's world
      // position is projected to the same screen space the bars draw in. This is
      // the wiring the M2 field report caught missing — the model and the layer
      // were both right, but nothing ever handed the layer the enemies.
      feedCombatants();
      // Name labels over every ship + owned station (field request v0.2.1), fed
      // AFTER renderer.draw so the camera transform is current — projected to the
      // same screen space the labels draw in, stacked above the health bars.
      feedNameplates();
      // Tap Commander order markers (developer §4): the waypoint pulse + lock-on
      // reticle, projected to screen the same way, drawn UNDER the bars/labels.
      feedTapMarkers();
      // Minimap content (field request v0.2.2): map-space dots — stations, ships,
      // ore hints, the collapse ring. Not projected to screen (the minimap fits
      // the arena itself), so its placement in the feed order is free.
      feedMinimap();
      hud.update(hudFrame);
      // Draw the visible touch controls from the live stick/button state (a
      // no-op layer on desktop). Reads the LOGICAL viewport each frame so the
      // idle affordances and FIRE button track resize/orientation flips.
      touchVisuals.update(
        touch,
        isTouch,
        transform.logicalWidth,
        transform.logicalHeight,
        buildVisible,
      );
      // Keep the build stamp cornered (logical bottom-left) as the viewport
      // changes, and keep the server half of it honest: a socket that has closed
      // is no longer a server this client is on, so the tag collapses back to
      // build-only exactly when the connection does (ratified, M10 §2).
      // (Guarded on `server`, not just on the state: a closed socket stays closed
      // for every remaining frame, and `formatBuildTag` builds a string. One call
      // on the edge, none after — the frame loop allocates nothing here, GDD §4.3.)
      if (identity.server !== null && onlineSession?.state === 'closed') identity.disconnected();
      // The badge's third field (ratified, M10 — "3cb36f5 · d891dd0a (gru) ·
      // 62ms") is NOT fed from here. It rides the session's own poll timer
      // instead (`startSessionLog`), which is the only thing that spans the whole
      // life of a connection — the lobby before this loop exists, and the drop
      // after the menu is gone. Feeding it here left the lobby, the screen the
      // region is actually read off, with no number on it at all.
      //
      // The one thing this loop still owes the badge is `?freeze=1`: a stamp that
      // changes with the weather is exactly what a byte-deterministic golden
      // screenshot cannot have. (Freeze implies `?debug=1`, which has no online
      // session, so this is belt and braces — and cheap: one boolean, and the
      // sample is a no-op once the field is already empty.)
      if (flags.freeze) identity.sampleRtt(null, nowMs);
      buildBadge.update(transform.logicalWidth, transform.logicalHeight);
      // The standalone ping stamp is SUPERSEDED by the badge line above it, and is
      // fed null rather than a second opinion (ratified, M10 — the badge carries
      // the connection stats now, on every screen, not just in-match).
      //
      // Two reasons it cannot simply keep drawing. It sits one mono line directly
      // above the badge, so a match would show two `ms` readings stacked in one
      // corner; and it reads `telemetry.hudRttMs`, which is the COMPOSITE the same
      // ratification rules out — the two lines would disagree, by a factor of
      // eight on a healthy connection, about one connection. `@net/ping-badge` is
      // left installed and untouched (it is the netcode lane's module) so that
      // lane can re-point or retire it; this is the wiring's call, not the
      // component's. See the PR body.
      pingBadge.setRtt(null);
      pingBadge.update(transform.logicalWidth, transform.logicalHeight);
      // Fullscreen: fold in the live state (a system-gesture/ESC exit can happen
      // any frame) and show the re-enter affordance only once we've been fullscreen
      // and no longer are (field request v0.1.1). Corner it in logical space.
      fullscreen.sync();
      fsAffordance.update(fullscreen.affordanceVisible(), transform.logicalWidth, transform.logicalHeight);
      // End-of-match / DEFEATED overlay: read the sim's own result off `world.match`
      // and show the screen that fits — nothing, the DEFEATED overlay, or the final
      // result. The whole "your station died and nothing happened" fix (field report
      // v0.1.2) lives on this one call, fed truth the sim decides.
      syncEndScreen();
      // Pause overlay (developer p10): draw whichever pause screen is up and the
      // touch corner button. Runs every rendered frame, including while the sim is
      // frozen above — so the overlay stays live over a stopped world.
      syncPause();
      // The connection, watched (m10 disconnect honesty). Also on a timer of its
      // own — a dead link is detected by *nothing happening*, and a tab that stops
      // being rendered is exactly the case this exists for.
      syncLinkLoss();
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

  /**
   * Show the end screen the match's own state calls for — the presentation half
   * of the win/loss the sim decides (`world.match`). Two distinct moments, two
   * screens (GDD §2.7, §4.7):
   *
   *  - **The whole match is over** (`isOver`): the result screen — winner + the
   *    d7-01 REMATCH / BACK TO MENU. Shown whether you won or were long since
   *    eliminated and watching.
   *  - **You're eliminated but the match goes on**: the DEFEATED overlay, unless
   *    you chose SPECTATE (then it holds off until the match itself ends).
   *
   * Runs every rendered frame; cheap and idempotent — it only touches the view
   * when the desired screen changes or its model does. The screen is derived, not
   * latched, so a match that resolves while you're staring at DEFEATED rolls the
   * overlay straight over to the result screen on its own.
   */
  function syncEndScreen(): void {
    const over = isOver(world);
    const eliminatedLocal = world.match.eliminated.includes(LOCAL_PLAYER);
    const desired: typeof endScreen = over ? 'result' : eliminatedLocal && !spectating ? 'defeated' : 'none';

    endScreen = desired;
    if (desired === 'none') {
      if (endOverlay.visible) endOverlay.visible = false;
      if (endButtonsShown.length) endButtonsShown = [];
      return;
    }
    if (!endOverlay.visible) endOverlay.visible = true;
    const model = endOfMatchModel(currentOutcome(over));
    endButtonsShown = model.buttons.map((b) => b.id);
    endOverlay.update(model);
  }

  /**
   * Read a plain {@link MatchOutcome} off the sim — truth in, presentation out.
   * On an elimination it works out placement (first core to fall places last; the
   * lone survivor is 1st, so a seat eliminated `k`-th of `N` places `N − k`) and a
   * coarse cause of death: the collapse if the field had closed over the core by
   * the time it fell, otherwise a rival destroyed it (the sim tracks no killer, so
   * this is the honest limit of what it can say — field report v0.1.2).
   */
  function currentOutcome(over: boolean): MatchOutcome {
    const total = world.stations.length;
    if (over) return { you: LOCAL_PLAYER, winner: world.match.winner, matchOver: true };

    const k = world.match.eliminated.indexOf(LOCAL_PLAYER);
    const station = stationOf(world, LOCAL_PLAYER);
    const byCollapse =
      isCollapsed(world) && station !== null && station.deathTime >= world.match.collapseTime;
    const cause: DeathCause = byCollapse ? 'collapse' : 'destroyed';
    const base: MatchOutcome = { you: LOCAL_PLAYER, winner: null, matchOver: false, totalPlayers: total, cause };
    // First core to fall places last; the survivor is 1st — so `N − k`. Present
    // only when we actually found the seat in the elimination order.
    return k >= 0 ? { ...base, placement: total - k } : base;
  }

  /** Route a tap on the end overlay: REMATCH → a fresh match, SPECTATE → free the
   *  camera onto the live match, BACK TO MENU → a clean boot (which lands back on
   *  the main menu). */
  function handleEndTarget(kind: EndButton): void {
    if (kind === 'rematch') rematch();
    else if (kind === 'spectate') startSpectate();
    else if (kind === 'menu') window.location.reload();
  }

  /** SPECTATE (GDD §2.7 "spectate if they want to watch"): drop the DEFEATED
   *  overlay and let the live match play on, camera freed onto a survivor so
   *  there is something to watch. The sim never stopped — the loop keeps ticking
   *  every seat — so this is purely a camera + overlay change. */
  function startSpectate(): void {
    spectating = true;
    endOverlay.visible = false;
    cameraTarget = firstSurvivor() ?? LOCAL_PLAYER;
  }

  /** A living opponent to watch after you're out — its ship if it's flying, else
   *  any owner whose station still stands. Null if nobody is left (the match is
   *  about to end, and the result screen takes the camera's place anyway). */
  function firstSurvivor(): PlayerId | null {
    for (const s of world.ships) {
      if (s.id !== LOCAL_PLAYER && !s.eliminated && s.alive) return s.id;
    }
    for (const p of world.stations) {
      if (p.alive && p.owner !== LOCAL_PLAYER) return p.owner;
    }
    return null;
  }

  /** REMATCH (GDD §2.7 / §4.7): tear the current match down and stand a fresh one
   *  up in place — straight to a new match, not back to the menu. Every render/
   *  input closure reads the live `world`/`match` binding, so re-pointing them
   *  here redirects the whole client onto the new world at once. */
  function rematch(): void {
    // Online, a fresh match means a fresh room off the allocator — there is no
    // in-place reboot of a server world, so REMATCH returns to the menu (which
    // drops the socket on the clean reload), where the player can CREATE / JOIN
    // again. `exitToMenu` closes `match` for us.
    if (onlineSession) {
      exitToMenu();
      return;
    }
    match.close();
    matchSeed += 1;
    match = bootMatch(matchSeed);
    world = match.world;
    rebuildNameTable();
    spectating = false;
    cameraTarget = LOCAL_PLAYER;
    endScreen = 'none';
    endButtonsShown = [];
    endOverlay.visible = false;
    hasOrdered = false;
    tapPilot.clear(); // a fresh match has no standing order (developer §2)
    if (buildWheel.open) buildWheel.toggle();
    // Forget the old world's tell baseline and reset the standing voices, so the
    // new arena does not open with a phantom burst of the siege the last one
    // ended on (the observer's first post-reset frame primes and emits nothing).
    audioObserver.reset();
    audio.reset();
    pauseScreen = 'closed'; // a fresh match is never mid-pause
  }

  // --- Pause menu wiring (developer ratification, p10) -----------------------

  /** Whether the match currently owns the screen — nothing else claiming it — so
   *  ESC / the touch corner button may open the pause overlay, and that button may
   *  be drawn (developer §1: "clear of everything"). False while a wheel, the end
   *  overlay, or the pause overlay itself is up. */
  function pauseAvailable(): boolean {
    return !isPauseOpen(pauseScreen) && !buildWheel.open && endScreen === 'none';
  }

  /** ESC on the keyboard: while a wheel is up it pops one wheel level (unchanged,
   *  field report v0.2.4); otherwise it opens the pause overlay, or backs it out
   *  one level — the same "one press, one level" gesture, now spanning the wheel
   *  and the pause menu. Never opens over the end screen (that overlay owns its own
   *  exits). */
  function handlePauseKey(): void {
    if (buildWheel.open) {
      wheelBackOneLevel();
      return;
    }
    if (!isPauseOpen(pauseScreen) && endScreen !== 'none') return;
    pauseScreen = nextPauseScreen(pauseScreen, 'toggle');
  }

  /** Route a tap while the pause overlay (or its settings screen) is up — it owns
   *  the screen, like the end overlay, so the tap lands on a pause control or on
   *  nothing, never on the match under it. */
  function handlePausePointer(lx: number, ly: number): void {
    if (pauseScreen === 'settings') {
      const hit = pauseSettings.hitTest(lx, ly);
      if (hit) applyPauseSettings(hit);
      return;
    }
    const target = pauseView.hitTest(lx, ly);
    if (target) handlePauseButton(target.kind);
  }

  /** Apply a pause-overlay button. RESUME/STAY back out; SETTINGS/EXIT step in;
   *  LEAVE tears the match down to the menu (the confirm is the guard). */
  function handlePauseButton(kind: PauseButton): void {
    haptics.haptic('tap');
    audio.cue('press');
    switch (kind) {
      case 'resume':
        pauseScreen = nextPauseScreen(pauseScreen, 'resume');
        break;
      case 'settings':
        pauseScreen = nextPauseScreen(pauseScreen, 'openSettings');
        break;
      case 'exit':
        pauseScreen = nextPauseScreen(pauseScreen, 'requestExit');
        break;
      case 'stay':
        pauseScreen = nextPauseScreen(pauseScreen, 'cancelExit');
        break;
      case 'leave':
        exitToMenu();
        break;
    }
  }

  /** Apply a tap on the pause SETTINGS screen. Unlike the pre-match menu's copy,
   *  these fold into the LIVE match: the fire mode and control scheme take effect
   *  at once and persist, reduce-VFX and the volumes drive the running renderer
   *  and mixer through {@link applyAudioMix}. DONE steps back to the pause menu. */
  function applyPauseSettings(target: SettingsTarget): void {
    switch (target.kind) {
      case 'back':
        pauseScreen = nextPauseScreen(pauseScreen, 'closeSettings');
        return;
      case 'fireMode':
        fireMode = fireMode === FireMode.AutoAim ? FireMode.Manual : FireMode.AutoAim;
        touch.setFireMode(fireMode);
        platform.storage.set(FIRE_MODE_KEY, fireMode);
        break;
      case 'controls':
        controlScheme = controlScheme === 'tap' ? 'sticks' : 'tap';
        tapPilot.clear();
        platform.storage.set(CONTROL_SCHEME_KEY, controlScheme);
        break;
      case 'reduceVfx':
        matchSettings = toggleReduceVfx(matchSettings);
        break;
      case 'volume':
        matchSettings = adjustVolume(matchSettings, target.channel, target.dir);
        applyAudioMix();
        break;
    }
    haptics.haptic('tap');
    audio.cue('press');
  }

  /** Push the live match volumes into the mixer (engine.ts). A no-op set of calls
   *  when running silent (no audio context), so it is safe on every platform. */
  function applyAudioMix(): void {
    audio.setMasterVolume(matchSettings.volumes.master);
    audio.setSfxVolume(matchSettings.volumes.sfx);
    audio.setMusicVolume(matchSettings.volumes.music);
  }

  /** EXIT TO MENU (developer §3): tear the world down — the rematch machinery's own
   *  teardown step ({@link MatchBoot.close}) — and return to the main menu. A clean
   *  reload is the maximal teardown: no half-dead world and no stale seam can
   *  survive it, and it lands on the real main menu (which only a clean boot shows),
   *  where PLAY boots a genuinely fresh match. It mirrors BACK TO MENU on the end
   *  screen, which reloads for the same reason — the two "go to the menu" exits are
   *  one mechanism. The target drops any `?debug=1` flag so the menu appears even
   *  from a harness boot (which otherwise skips it), preserving the app's base path. */
  function exitToMenu(): void {
    match.close();
    const menuUrl = window.location.origin + window.location.pathname;
    window.location.assign(menuUrl);
  }

  /** Draw whichever pause screen is up and the touch corner button, once per
   *  rendered frame. Offline the loop has already frozen the sim; render keeps
   *  running, so the overlay is live and RESUME picks the sim back up seamlessly. */
  function syncPause(): void {
    // The pause overlay: the menu or the confirm. While the settings screen is up
    // the overlay hides (the real settings view takes its place), so feed 'closed'.
    pauseView.update(pauseMenuModel(pauseScreen === 'settings' ? 'closed' : pauseScreen));
    const settingsUp = pauseScreen === 'settings';
    pauseSettings.visible = settingsUp;
    if (settingsUp) pauseSettings.update(settingsModel(matchSettings, fireMode, controlScheme));
    pauseView.updateButton(pauseButtonVisible({ isTouch, available: pauseAvailable() }));
    syncCopyLog();
  }

  /**
   * Offer COPY LOG in the match, and only where the brief puts it (§2, §3):
   *
   *   1. **A lost or losing connection first.** Online, `reconnecting` and `closed`
   *      are the two states a "it kept dropping" report is about, and the offer names
   *      which one it was — with the transport's own close reason when it has given
   *      one, so "the room ended" and "your grace ran out" do not arrive as the same
   *      sentence (`src/net/websocket-transport` `CloseReason`).
   *   2. **The pause menu**, whenever it is up: the log is simply available there.
   *
   * Anything else hides it. During play the match owns the screen, and a floating
   * button over the HUD would be exactly the kind of chrome the HUD budget refuses.
   * Called once per rendered frame from {@link syncPause}; a repeated identical offer
   * costs one comparison and no DOM work (`src/net/playtest-log-button`).
   */
  function syncCopyLog(): void {
    // A silently-killed socket never leaves `open` (m10 disconnect honesty), so the
    // state check below would miss the exact failure the developer reported. The
    // watchdog's verdict is checked first, and it covers the state cases too — but
    // they stay, because a session with no watchdog (offline) still has states.
    if (onlineSession?.frozen) {
      showCopyLog({ reason: 'error', hint: 'COPY LOG to report this disconnect.' });
      return;
    }
    const state = onlineSession?.state;
    if (state === 'reconnecting' || state === 'closed') {
      showCopyLog({
        reason: 'error',
        hint: disconnectOfferHint(state, onlineSession?.closeReason ?? null),
      });
      return;
    }
    if (isPauseOpen(pauseScreen)) {
      showCopyLog({ reason: 'pause' });
      return;
    }
    hideCopyLog();
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

    // Tap Commander (developer §1–2): the pilot REPLACES the sticks. In this scheme
    // the human devices no longer thrust/aim/fire — the pilot flies the ship from
    // the standing order — but BUILD stays on its own affordance, so `merged.build`
    // is left as the devices wrote it. The wheel is tap-operated here (its taps are
    // claimed before the sticks), so while it is open the ship holds and the pilot
    // stands down; `updateBuildWheel` zeroes thrust/fire for the wheel's own
    // aim/confirm exactly as it does for the sticks.
    const tap = controlScheme === 'tap';
    if (tap) {
      merged.thrust.x = 0;
      merged.thrust.y = 0;
      merged.aim = null;
      merged.fire = false;
      if (!buildWheel.open) {
        resetControlState(pilotState);
        const ship = world.ships.find(isLocalShip);
        if (ship && ship.alive) {
          pilotShip.pos = ship.pos;
          pilotShip.radius = ship.radius;
          tapPilot.writeInto(pilotState, pilotShip, resolvePilotTarget());
          merged.thrust.x = pilotState.thrust.x;
          merged.thrust.y = pilotState.thrust.y;
          merged.aim = pilotState.aim;
          merged.fire = pilotState.fire;
          // The pilot is not a device: it never claims `activeDevice`, so the HUD
          // controls strip keeps naming whatever real device last acted.
        } else {
          // No living ship to fly (dead / respawning): drop the order so a fresh
          // tap after respawn starts clean, and coast.
          tapPilot.clear();
        }
      }
    }

    updateBuildWheel();
    // Tap Commander's fire mode depends on the pilot's order (developer p9-02 §1). On
    // a LOCK the pilot aims explicitly at the tapped target, so map that frame in
    // Manual — an Auto-aim map would let the sim pick the nearest target instead of
    // the one the player locked. With NO lock the pilot AUTO-ENGAGES (holds the
    // trigger while flying/idling), so map Auto-aim and let the sim's own ladder pick
    // the best target — enemies first, hittability + full-hold rock suppression built
    // in (p9-01), never re-derived in the platform layer. The sticks scheme keeps the
    // player's fire-mode. Read after `writeInto`, so a lock that died this frame has
    // already cleared and correctly falls to auto-engage.
    const tapMode = tapPilot.lockedRef ? FireMode.Manual : FireMode.AutoAim;
    const actions = mapActions(merged, tap ? tapMode : fireMode);
    if (inputProbe.enabled) inputProbe.update(actions); // ?debug=1 parity seam
    return actions;
  }

  /**
   * Re-resolve the pilot's locked target to its live position each frame (developer
   * §1–2). The lock is a stable `{kind,id}` handle; here we find the entity it names
   * in the live world and fill the reused {@link resolvedTarget} with its current
   * centre, radius, and hostility — a moving ship tracks, a besieged core tracks,
   * a mined-out rock vanishes. Returns `null` when the order is a waypoint (no
   * target) or the entity is gone (dead ship, destroyed core, exhausted rock),
   * which is exactly what tells the pilot to drop the lock. Own station resolves as
   * a friendly fly-to that holds at its atmosphere and never fires.
   */
  function resolvePilotTarget(): ResolvedTarget | null {
    const ref = tapPilot.lockedRef;
    if (!ref) return null;
    switch (ref.kind) {
      case 'ship': {
        const s = world.ships.find((sh) => sh.id === ref.id);
        if (!s || !s.alive) return null;
        return fillResolved(s.pos, s.radius, true);
      }
      case 'asteroid': {
        const a = world.asteroids.find((r) => r.id === ref.id);
        if (!a) return null; // mined out → the rock is gone, drop the lock
        // A rock is `mineable`: the pilot holds INSIDE the tractor pickup radius so
        // its chipped ore reaches the hold (developer p9-02 range fix).
        return fillResolved(a.pos, a.radius, true, undefined, true);
      }
      case 'turret': {
        for (const p of world.stations) {
          const t = p.turrets.find((tt) => tt.id === ref.id);
          if (t) return t.hp > 0 ? fillResolved(t.pos, t.radius, true) : null;
        }
        return null;
      }
      case 'core':
      case 'station': {
        const p = world.stations.find((pl) => pl.id === ref.id);
        if (!p || !p.alive) return null;
        // The player's own station is a friendly fly-to (hold at atmosphere, no
        // fire); a rival's core is an attack.
        const own = p.owner === LOCAL_PLAYER;
        return fillResolved(p.pos, p.radius, !own, own ? STATION_STANDOFF : undefined);
      }
    }
  }

  /** Fill the reused resolved-target record (zero-alloc) and return it. */
  function fillResolved(
    pos: Vec2,
    radius: number,
    hostile: boolean,
    standoff?: number,
    mineable = false,
  ): ResolvedTarget {
    resolvedTarget.pos = pos;
    resolvedTarget.radius = radius;
    resolvedTarget.hostile = hostile;
    // exactOptionalPropertyTypes: an own-station fly-to sets a standoff, every other
    // target omits it (the pilot then uses its config engage range).
    if (standoff === undefined) delete resolvedTarget.standoff;
    else resolvedTarget.standoff = standoff;
    // A rock holds inside the tractor pickup radius; every other target omits this.
    if (mineable) resolvedTarget.mineable = true;
    else delete resolvedTarget.mineable;
    return resolvedTarget;
  }

  /**
   * Project a LOGICAL (landscape) screen point back to WORLD space — the inverse
   * of the renderer's world→screen. The renderer centres the camera target on the
   * viewport by offsetting its world root (`writeCameraOffset`, camera.ts); this
   * recomputes the SAME offset from the live camera target + viewport and subtracts
   * it, so a tap lands on the world point under the thumb. Reuses `worldTapPoint`
   * via `out` (zero-alloc). Mirrors the renderer's own `?? world.ships[0]` fallback
   * so a spectating camera and the render agree on centre.
   */
  function logicalToWorld(logical: Vec2, out: Vec2): Vec2 {
    const cam = world.ships.find((s) => s.id === cameraTarget) ?? world.ships[0];
    camTargetScratch.x = cam ? cam.pos.x : world.bounds.width / 2;
    camTargetScratch.y = cam ? cam.pos.y : world.bounds.height / 2;
    writeCameraOffset(camOffsetScratch, camTargetScratch, viewport);
    out.x = logical.x - camOffsetScratch.x;
    out.y = logical.y - camOffsetScratch.y;
    return out;
  }

  /**
   * The forward of {@link logicalToWorld}: a WORLD point to the LOGICAL screen point
   * it draws at, through the SAME live camera offset — so a `?debug=1` stage can hand
   * a Playwright test the exact place to REAL-tap an entity (the p10 station-wheel
   * front door). Reuses the same camera-inverse scratch, so it allocates nothing but
   * the small returned record it is asked for. Only ever called off the input path.
   */
  function worldToLogical(wx: number, wy: number): { x: number; y: number } {
    const cam = world.ships.find((s) => s.id === cameraTarget) ?? world.ships[0];
    camTargetScratch.x = cam ? cam.pos.x : world.bounds.width / 2;
    camTargetScratch.y = cam ? cam.pos.y : world.bounds.height / 2;
    writeCameraOffset(camOffsetScratch, camTargetScratch, viewport);
    return { x: wx + camOffsetScratch.x, y: wy + camOffsetScratch.y };
  }

  /**
   * Build the tap hit-test candidate list from the live world (developer §2, p10):
   * every enemy ship, every asteroid (mine), every enemy turret, every standing core,
   * and the player's own station (kind `station` — a tap on it opens the Build wheel in
   * range, or moves toward it when too far, developer p10 §1). The local ship and the
   * player's own turrets are not lock targets, and a wreck (dead station) is neither
   * attackable nor a build target. Pooled records overwritten in place, so a tap
   * allocates nothing.
   */
  function buildTapCandidates(): TapCandidate[] {
    let n = 0;
    for (const s of world.ships) {
      if (s.id === LOCAL_PLAYER || !s.alive) continue;
      const c = tapCandidateSlot(n++);
      c.kind = 'ship';
      c.id = s.id;
      c.pos = s.pos;
      c.radius = s.radius;
      c.hostile = true;
    }
    for (const a of world.asteroids) {
      const c = tapCandidateSlot(n++);
      c.kind = 'asteroid';
      c.id = a.id;
      c.pos = a.pos;
      c.radius = a.radius;
      c.hostile = true;
    }
    for (const p of world.stations) {
      for (const t of p.turrets) {
        if (t.hp <= 0 || t.owner === LOCAL_PLAYER) continue; // own turrets aren't targets
        const c = tapCandidateSlot(n++);
        c.kind = 'turret';
        c.id = t.id;
        c.pos = t.pos;
        c.radius = t.radius;
        c.hostile = true;
      }
      if (!p.alive) continue; // a wreck is not a lock target
      const own = p.owner === LOCAL_PLAYER;
      const c = tapCandidateSlot(n++);
      c.kind = own ? 'station' : 'core';
      c.id = p.id;
      c.pos = p.pos;
      c.radius = p.radius;
      c.hostile = !own; // your own station is a friendly fly-to, a rival's is an attack
    }
    tapCandidates.length = 0;
    for (let i = 0; i < n; i++) tapCandidates.push(tapCandidatePool[i]!);
    return tapCandidates;
  }

  /** Pooled candidate record `i`, grown to fit and reused across taps (GDD §4.3). */
  function tapCandidateSlot(i: number): MutTapCandidate {
    let c = tapCandidatePool[i];
    if (!c) {
      c = { kind: 'ship', id: 0, pos: { x: 0, y: 0 }, radius: 0, hostile: false };
      tapCandidatePool[i] = c;
    }
    return c;
  }

  /**
   * Fold this frame's merged input into the Build & Upgrade wheel, then turn
   * whatever was bought into the one-shot order fields the funnel maps
   * (`@platform/actions`).
   *
   * Availability is the sim's answer, not a distance re-derived here: alive
   * ship, live core, `isDocked`. The wheel opens at your own station and nowhere
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
    const station = stationOf(world, LOCAL_PLAYER);
    docked = ship !== undefined && station !== null && isDocked(ship, station);
    buildVisible = buildButtonVisible({ docked, isTouch });
    buildWheel.setAvailable(docked && station !== null && station.alive && ship !== undefined && ship.alive);

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
    // ownership, docking, cost, caps — and refuses on its own terms. The upgrade
    // rows map to the CURRENT level's tracks; the WEAPON nav wedge never sets a row
    // (consumed at press), so its position is never drained as a buy. BACK is not a
    // wedge any more — it lives on the hub (field report v0.2.4).
    const rowTracks = upgradeWheelSlots(weaponWheelOpen).map((s) =>
      s.kind === 'track' ? s.track : UpgradeTrack.Power,
    );
    let ordered = writeWheelOrders(buildWheel, merged, WHEEL_ORDER, rowTracks);

    // Drain a track pressed on the open upgrade wheel this frame (radial hit-test
    // in the pointer handler). It rides the SAME funnel as a Build segment — the
    // sim validates docking, affordability and max tier again and refuses on its
    // own terms — and appears only on the tick it was pressed (`merged.upgrade` is
    // one-shot). Drained unconditionally so a stale latch never re-fires: it only
    // becomes an order while the upgrade wheel is actually up.
    if (pendingUpgrade !== null) {
      if (buildWheel.panelOpen) {
        merged.upgrade = pendingUpgrade;
        ordered = true;
      }
      pendingUpgrade = null;
    }

    if (ordered) {
      hasOrdered = true;
      haptics.haptic('confirm'); // a build/upgrade order committed — the "done" beat
      // The confirm CHIME is no longer fired here: an order submitted is not an
      // order the sim ACCEPTED (it re-validates docking, affordability and max
      // tier — comment above). The HUD sounds `confirm` off the sim's own state
      // change (a turret/shield/tier count or core HP actually rising), so a
      // refused order can never fake the chime (`ui/press-feedback` confirm()).
    }
  }

  /**
   * Fill the reusable HudFrame from the local ship, its home, and the match —
   * no allocation (predicate hoisted; every field a primitive or a reference to
   * live sim data the HUD only reads).
   *
   * Three of the M2 elements are fed here and nowhere else, and each is a
   * mechanic rather than a readout (GDD §2.2):
   *
   *  - **Own-station HP** comes off the real core, with the shield pool over it.
   *  - **The under-attack alarm** derives its damage from the fall in
   *    core + shields + turrets between frames, so a turret being picked off at
   *    the edge of its range rings it exactly as a shot on the core does — and a
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
    // The nested weapon wheel only exists inside the open upgrade panel; drop it
    // the instant the panel closes, so re-opening always lands on the main wheel.
    if (!buildWheel.panelOpen) weaponWheelOpen = false;
    hudFrame.weaponWheelOpen = weaponWheelOpen;
    hudFrame.hasOrdered = hasOrdered;
    hudFrame.docked = docked;

    const station = stationOf(world, LOCAL_PLAYER);
    if (station) {
      hudFrame.coreHp = station.coreHp;
      hudFrame.maxCoreHp = station.maxCoreHp;
      // The repair COOLDOWN remaining (the sim's `repairGate`), straight off sim
      // state so the wheel counts "REPAIR in Ns" down without a UI timer (p4-17).
      hudFrame.repairGate = station.repairGate ?? 0;
      hudFrame.shieldHp = shieldPool(station);
      hudFrame.maxShieldHp = shieldPoolMax(station);
      hudFrame.turretHp = turretPool(station);
      hudFrame.stationAlive = station.alive;
      hudFrame.turrets = turretCount(station);
      hudFrame.shields = shieldCount(station);
      hudFrame.satellites = satelliteCount(station);
      hudFrame.homePos = station.pos;
    }

    const ship = world.ships.find(isLocalShip);
    if (!ship) return;
    hudFrame.cargo = ship.cargo;
    hudFrame.cargoCap = ship.cargoCap;
    hudFrame.banked = ship.banked;
    hudFrame.nearAsteroid = nearAsteroid(ship.pos);
    hudFrame.shipAlive = ship.alive;
    // Respawn countdown (field request v0.2.2): the HUD renders the ceiling of
    // this timer while the ship is dead — unless the seat is eliminated, where
    // the DEFEATED flow owns the screen and the countdown stands down. Both come
    // straight off the sim, so the number on screen is the one the sim counts.
    hudFrame.respawnTimer = ship.respawnTimer;
    hudFrame.eliminated = ship.eliminated;
    hudFrame.shipClass = ship.shipClass;
    hudFrame.upgradeTiers = ship.tiers;
    hudFrame.shipPos = ship.pos;
    // Own-ship health (field request v0.1.1): the HUD floats a bar over the local
    // ship (at screen centre, where the follow camera holds it) and shows a HUD
    // hull readout, both from this one hull value so they agree. `shipFiring` is
    // the same firing signal the enemy bars use for "in combat" (mining or fighting —
    // one weapon, GDD §2.5). `radius` matches the projected 1:1 world radius.
    hudFrame.hull = ship.hull;
    hudFrame.maxHull = ship.maxHull;
    hudFrame.shipRadius = ship.radius;
    hudFrame.shipFiring = ship.firing;
  }

  /**
   * Derive the three combat haptics from live sim state, once per rendered frame
   * (field request v0.2.2). The service owns *whether* the motor fires (support,
   * the toggle, visibility, the post-death hush); this only decides *when* an
   * event happened, from the same core/shield/turret/hull values the HUD reads:
   *
   *  - **death** — your seat entered the elimination list this frame. Fires once
   *    on the rising edge; the service then holds the motor quiet for three
   *    seconds, so no `hit`/`alarm` stutters over the top.
   *  - **hit** — your ship's hull fell since last frame, debounced so a stream of
   *    shots is one knock, not a per-frame buzz.
   *  - **alarm** — your base's defence (core + shields + turrets) is falling in a
   *    *sustained* way. Damage feeds a pressure gauge that decays each frame, so a
   *    lone stray shot bleeds off before it triggers but a real assault rings it —
   *    the tactile half of the under-attack audio alarm (GDD §2.2), re-armed on a
   *    cadence. This is a feel heuristic (framerate-sensitive by design), never the
   *    authoritative alarm — that stays `src/ui`'s.
   */
  function feedHaptics(nowMs: number): void {
    const eliminated = world.match.eliminated.includes(LOCAL_PLAYER);
    if (eliminated && !hapticWasEliminated) haptics.haptic('death');
    hapticWasEliminated = eliminated;
    if (eliminated) {
      // Nothing left to feel; drop baselines so a rematch starts clean (a full-HP
      // world would otherwise read as a giant heal, harmless, but reset is tidier).
      hapticPrevHull = null;
      hapticPrevDefense = null;
      hapticAlarmPressure = 0;
      return;
    }

    const ship = world.ships.find(isLocalShip);
    if (ship) {
      if (
        hapticPrevHull !== null &&
        ship.hull < hapticPrevHull - HAPTIC_HP_EPSILON &&
        nowMs - hapticLastHitMs >= HAPTIC_HIT_COOLDOWN_MS
      ) {
        haptics.haptic('hit');
        hapticLastHitMs = nowMs;
      }
      hapticPrevHull = ship.hull;
    } else {
      hapticPrevHull = null;
    }

    const station = stationOf(world, LOCAL_PLAYER);
    if (station) {
      const defense = station.coreHp + shieldPool(station) + turretPool(station);
      if (hapticPrevDefense !== null && defense < hapticPrevDefense - HAPTIC_HP_EPSILON) {
        hapticAlarmPressure += hapticPrevDefense - defense;
      }
      hapticAlarmPressure *= HAPTIC_ALARM_DECAY; // stray shots bleed off before they ring
      if (hapticAlarmPressure >= HAPTIC_ALARM_TRIGGER && nowMs - hapticLastAlarmMs >= HAPTIC_ALARM_REARM_MS) {
        haptics.haptic('alarm');
        hapticLastAlarmMs = nowMs;
        hapticAlarmPressure = 0;
      }
      hapticPrevDefense = defense;
    } else {
      hapticPrevDefense = null;
    }
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
      // The local ship's over-bar is synthesised by the HUD from the sim hull (at
      // the centred camera position), not fed here — so skip it in the enemy feed.
      if (ship.id === LOCAL_PLAYER) continue;
      const c = combatantSlot(n++);
      c.owner = ship.id;
      c.hp = ship.hull;
      c.maxHp = ship.maxHull;
      c.alive = ship.alive;
      c.inCombat = ship.firing; // firing this tick (sim publishes the tell)
      renderer.projectToScreen(ship.pos, c.pos);
      c.radius = ship.radius;
      c.turret = false;
    }
    for (const station of world.stations) {
      for (const turret of station.turrets) {
        // Field request v0.2.2: EVERY turret gets a bar when damaged, the local
        // player's own included (they used to read off the HOME HP readout). The
        // model still hides a full, idle turret, so passing them all is correct.
        const c = combatantSlot(n++);
        c.owner = turret.owner;
        c.hp = turret.hp;
        c.maxHp = turret.maxHp;
        c.alive = turret.hp > 0;
        c.inCombat = turret.muzzle != null; // loosing a shot this tick
        // `turret.pos` is derived from the orbit angle each tick, so the bar rides
        // along as the turret slides around its station's rim (sim orbit, P1).
        renderer.projectToScreen(turret.pos, c.pos);
        c.radius = turret.radius;
        c.turret = true;
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
      c = { owner: 0, hp: 0, maxHp: 0, alive: false, inCombat: false, pos: { x: 0, y: 0 }, radius: 0, turret: false };
      combatantPool[i] = c;
    }
    return c;
  }

  /**
   * Build this frame's name-label feed and hand it to the HUD (field request
   * v0.2.1): a label over **every ship** and **every owned station**, tinted the
   * owner's identity colour and captioned from {@link playerNames}. The pure model
   * ({@link ./ui} `nameplateModel`) decides who is labelled (a dead ship, a
   * destroyed station — a wreck — and the local ship's own label are all dropped)
   * and fades a label under combat clutter; here we only project world → screen
   * (via the same camera transform the bars use, after `renderer.draw`) and pass
   * the sim liveness/combat facts through. Stations carry no HP/combat signal, so a
   * rival station's label never leaks its scouted-only HP (GDD §2.2).
   *
   * Allocation-free after warm-up (GDD §4.3): the records are pooled and the frame
   * array reused, bounded by the entity caps (≤8 ships, ≤8 stations).
   */
  function feedNameplates(): void {
    let n = 0;
    for (const ship of world.ships) {
      const c = nameableSlot(n++);
      c.owner = ship.id;
      c.kind = 'ship';
      c.alive = ship.alive && !ship.eliminated;
      c.local = ship.id === LOCAL_PLAYER;
      c.inCombat = ship.firing;
      c.hpFraction = ship.maxHull > 0 ? ship.hull / ship.maxHull : 1;
      renderer.projectToScreen(ship.pos, c.pos);
      c.radius = ship.radius;
    }
    for (const station of world.stations) {
      const c = nameableSlot(n++);
      c.owner = station.owner;
      c.kind = 'station';
      // A standing (owned) station is labelled; a wreck (`alive` false) is not.
      c.alive = station.alive;
      c.local = false;
      // No combat signal on a station: a rival's HP is scouted only (GDD §2.2), so
      // the fade never becomes a back-door HP readout. Full alpha, always.
      c.inCombat = false;
      c.hpFraction = 1;
      renderer.projectToScreen(station.pos, c.pos);
      c.radius = station.radius;
    }
    nameableFrame.length = 0;
    for (let i = 0; i < n; i++) nameableFrame.push(nameablePool[i]!);
    hudFrame.nameables = nameableFrame;
    hudFrame.names = playerNames;
    hudFrame.difficulties = playerDifficulties;
    // The side each slot fights for, and whether to say it out loud (m10 teams).
    // Read straight off the live world's ships rather than off the lobby, so the
    // label and the friend/foe predicate can never disagree — the nameplate says
    // exactly what `areEnemies` will act on.
    hudFrame.playerTeams = playerTeams;
    hudFrame.teamsMode = teamsMode;
  }

  /** Pooled nameable record `i`, grown to fit and reused across frames (GDD §4.3). */
  function nameableSlot(i: number): MutNameable {
    let c = nameablePool[i];
    if (!c) {
      c = { owner: 0, kind: 'ship', alive: false, local: false, inCombat: false, hpFraction: 1, pos: { x: 0, y: 0 }, radius: 0 };
      nameablePool[i] = c;
    }
    return c;
  }

  /**
   * Feed this frame's Tap Commander order markers to the HUD (developer §4): the
   * waypoint marker (the pilot's move target) and the lock-on reticle (the locked
   * entity), each projected world → screen via the renderer's *actual* camera
   * transform (`projectToScreen`, called after `renderer.draw`), so a marker sits
   * exactly where the order is and is a fixed screen size regardless of zoom.
   *
   * Only the tap scheme carries these — the sticks scheme has no standing order —
   * so anything else clears the fields, dropping the reticle/waypoint the instant
   * the player switches away (the layer then fades the last waypoint out). The
   * pilot re-resolves the lock to a live position through the SAME
   * {@link resolvePilotTarget} the input path uses, so the reticle tracks a moving
   * ship / shrinking rock and vanishes the frame the target dies. Reuses pooled
   * mark records, so an order standing frame after frame allocates nothing (§4.3).
   */
  function feedTapMarkers(): void {
    if (controlScheme !== 'tap') {
      delete hudFrame.tapWaypoint;
      delete hudFrame.tapLock;
      hudFrame.tapFiring = false;
      return;
    }

    const wp = tapPilot.waypoint;
    if (wp) {
      renderer.projectToScreen(wp, tapWaypointMark);
      hudFrame.tapWaypoint = tapWaypointMark;
    } else {
      delete hudFrame.tapWaypoint;
    }

    const locked = resolvePilotTarget();
    if (locked) {
      renderer.projectToScreen(locked.pos, tapLockScreen);
      tapLockMark.x = tapLockScreen.x;
      tapLockMark.y = tapLockScreen.y;
      tapLockMark.radius = locked.radius;
      hudFrame.tapLock = tapLockMark;
    } else {
      delete hudFrame.tapLock;
    }

    // The line of intent draws only while the ship is actually loosing its weapon
    // (the sim's own firing tell) AND a lock stands — the marker layer gates on
    // `firing && lock` (src/ui/tap-markers.ts). Auto-engage (p9-02) fires with no
    // lock, so this tell can now rise without a reticle; the layer draws no phantom
    // line for it. A lighter auto-reticle over the ladder's current pick is flagged
    // for ui/gameplay in the PR (the sim owns that pick; it is not surfaced here).
    const ship = world.ships.find(isLocalShip);
    hudFrame.tapFiring = ship?.firing ?? false;
  }

  /**
   * Feed this frame's minimap content to the HUD (field request v0.2.2; GDD §2.2):
   * arena bounds, stations (owner-coloured, a wreck neutral), ships (own
   * highlighted, spawn-protected dimmed), the collapse ring while it is active
   * (GDD §2.3), and faint ore-field hints — all in **map (world) space**, because
   * the minimap does its own fit (unlike the bars/labels, which arrive projected).
   * The minimap's presentation is the UI's; the sim decides the truth this reads.
   *
   * Pooled + reused (GDD §4.3): station/ship/ore records and the frame arrays are
   * overwritten in place, bounded by the entity caps (≤8 stations, ≤8 ships, and
   * the asteroid field). `hudFrame.tick` drives the view's low-frequency redraw.
   */
  function feedMinimap(): void {
    minimapFrame.bounds.width = world.bounds.width;
    minimapFrame.bounds.height = world.bounds.height;

    let pn = 0;
    let satn = 0;
    for (const p of world.stations) {
      const r = minimapStationSlot(pn++);
      r.owner = p.owner;
      r.x = p.pos.x;
      r.y = p.pos.y;
      r.alive = p.alive;
      r.id = p.id;
      // Radar satellites orbiting this station (feature f1): enemy ones are fog-
      // gated by the pure model, the viewer's own always show (local flag).
      for (const sat of p.satellites ?? []) {
        const sr = minimapSatelliteSlot(satn++);
        sr.owner = sat.owner;
        sr.x = sat.pos.x;
        sr.y = sat.pos.y;
        sr.alive = sat.hp > 0;
        sr.local = sat.owner === LOCAL_PLAYER;
      }
    }
    minimapStations.length = 0;
    for (let i = 0; i < pn; i++) minimapStations.push(minimapStationPool[i]!);
    minimapSatellites.length = 0;
    for (let i = 0; i < satn; i++) minimapSatellites.push(minimapSatellitePool[i]!);

    let sn = 0;
    for (const s of world.ships) {
      const r = minimapShipSlot(sn++);
      r.owner = s.id;
      r.x = s.pos.x;
      r.y = s.pos.y;
      r.alive = s.alive && !s.eliminated;
      r.local = s.id === LOCAL_PLAYER;
      r.spawnProtected = s.spawnProtect > 0;
    }
    minimapShips.length = 0;
    for (let i = 0; i < sn; i++) minimapShips.push(minimapShipPool[i]!);

    // Faint ore-field hints: the asteroid centres. Bounded by the field size and
    // drawn dim (the view throttles the redraw), so the whole field is honest hint
    // rather than a sampled guess.
    let on = 0;
    for (const a of world.asteroids) {
      const r = minimapOreSlot(on++);
      r.x = a.pos.x;
      r.y = a.pos.y;
    }
    minimapOre.length = 0;
    for (let i = 0; i < on; i++) minimapOre.push(minimapOrePool[i]!);

    // The collapse ring (GDD §2.3): while collapse is active, a threat-red ring at
    // the contested field's extent, centred on the arena — the closing space made
    // legible on the glance map. `fieldRadius` is the field's outer disc; there is
    // no shrinking kill-ring in the sim, so this marks the danger zone's boundary.
    if (isCollapsed(world)) {
      minimapCollapse.x = world.bounds.width / 2;
      minimapCollapse.y = world.bounds.height / 2;
      minimapCollapse.radius = world.fieldRadius;
      minimapFrame.collapse = minimapCollapse;
    } else {
      minimapFrame.collapse = null;
    }

    // Fog of war (feature f1): the minimap renders ONLY the local player's sensed-
    // state. Consume the sim's own sensing truth — the CURRENT coverage discs
    // (`sensorSources`, the union of the ship / stations / alive satellites the
    // player projects this tick) and the persistent remembered-station bitmask.
    // The pure model (src/ui/minimap.ts) does the gating from these; a killed
    // satellite simply stops appearing here, collapsing its disc the same tick.
    feedMinimapFog();

    hudFrame.minimap = minimapFrame;
    hudFrame.tick = world.tick;
  }

  /** Fill the fog feed for the local player (feature f1): copy the sim's current
   *  coverage discs into the pooled array and read the remembered-station mask. A
   *  short-lived `sensorSources` allocation (≤ ~17 tiny records) each frame is the
   *  honest cost of consuming the ratified seam rather than duplicating its
   *  three-source union here — the same off-hot-path selector pattern as
   *  `muzzleFlashes`. */
  function feedMinimapFog(): void {
    const sources: SensorSource[] = sensorSources(world, LOCAL_PLAYER);
    let cn = 0;
    for (const s of sources) {
      const r = minimapCoverageSlot(cn++);
      r.x = s.pos.x;
      r.y = s.pos.y;
      r.radius = s.range;
    }
    minimapCoverage.length = 0;
    for (let i = 0; i < cn; i++) minimapCoverage.push(minimapCoveragePool[i]!);
    minimapFog.rememberedMask = world.sensory?.seenStations[LOCAL_PLAYER] ?? 0;
    minimapFrame.fog = minimapFog;
  }

  /** Pooled minimap station record `i`, grown to fit and reused (GDD §4.3). */
  function minimapStationSlot(i: number): MutMinimapStation {
    let r = minimapStationPool[i];
    if (!r) {
      r = { owner: 0, x: 0, y: 0, alive: true, id: 0 };
      minimapStationPool[i] = r;
    }
    return r;
  }

  /** Pooled minimap ship record `i`, grown to fit and reused (GDD §4.3). */
  function minimapShipSlot(i: number): MutMinimapShip {
    let r = minimapShipPool[i];
    if (!r) {
      r = { owner: 0, x: 0, y: 0, alive: false, local: false, spawnProtected: false };
      minimapShipPool[i] = r;
    }
    return r;
  }

  /** Pooled minimap ore-hint point `i`, grown to fit and reused (GDD §4.3). */
  function minimapOreSlot(i: number): { x: number; y: number } {
    let r = minimapOrePool[i];
    if (!r) {
      r = { x: 0, y: 0 };
      minimapOrePool[i] = r;
    }
    return r;
  }

  /** Pooled minimap satellite record `i`, grown to fit and reused (feature f1). */
  function minimapSatelliteSlot(i: number): MutMinimapSatellite {
    let r = minimapSatellitePool[i];
    if (!r) {
      r = { owner: 0, x: 0, y: 0, alive: false, local: false };
      minimapSatellitePool[i] = r;
    }
    return r;
  }

  /** Pooled minimap coverage-disc record `i`, grown to fit and reused (feature f1). */
  function minimapCoverageSlot(i: number): MutMinimapCoverage {
    let r = minimapCoveragePool[i];
    if (!r) {
      r = { x: 0, y: 0, radius: 0 };
      minimapCoveragePool[i] = r;
    }
    return r;
  }

  /**
   * Install `window.__healthbarStage` — the ?debug=1 live-stage seam a Playwright
   * test drives to prove the health bars are wired on a real boot. Methods:
   *
   *  - `damageEnemy(fraction)` — park a live enemy ship a fixed offset from the
   *    local ship and set its hull to `fraction` of max, so the health-bar model
   *    must draw a bar over it (damaged ⇒ a bar). Best paired with `?freeze=1`,
   *    which pins the sim so the staged frame holds still. Returns the staged
   *    enemy's slot and the exact fill it was left at, or null if there is no
   *    enemy to stage.
   *  - `damageLocal(fraction)` — the field-request v0.1.1 counterpart: set the
   *    LOCAL ship's hull to `fraction` of max so its own over-ship bar must draw
   *    (and the HUD hull readout drop to match). The camera holds it centred, so
   *    no repositioning is needed. Returns its slot and exact fill, or null.
   *  - `damageTurret(fraction)` — the field-request v0.2.2 counterpart: park a
   *    turret (preferring one of the LOCAL player's, to prove own turrets now show
   *    a bar) beside the centred local ship so it is on-screen and un-culled, and
   *    set its hp to `fraction` of max. Its `pos` IS its orbit position (P1), so
   *    the drawn bar must track it. Returns the turret's owner slot, exact fill,
   *    and the screen position its orbit projects to, or null if none exists.
   *  - `bars()` — the bars the real layer actually drew last frame (owner, fill,
   *    `local` flag, screen position), read back so the test can assert one
   *    tracks the staged ship.
   *  - `hullReadout()` — the hull fraction the HUD readout last drew, so the test
   *    can assert the over-ship own bar and the readout agree (one source).
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
      // Field request v0.1.1: damage the LOCAL ship so its own over-ship bar must
      // appear (damaged ⇒ a bar), and the HUD hull readout drops to match. The
      // ship is already at screen centre (the camera follows it), so the bar is
      // un-culled. Returns the slot and exact fill it was left at.
      damageLocal(fraction: number): { owner: PlayerId; fraction: number } | null {
        const local = world.ships.find(isLocalShip);
        if (!local) return null;
        local.alive = true;
        const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        local.hull = f * local.maxHull;
        return { owner: local.id, fraction: local.hull / local.maxHull };
      },
      // Field request v0.2.2: damage a turret so its bar must draw (damaged ⇒ a
      // bar), proving own turrets are no longer suppressed. Prefer a LOCAL-owned
      // turret; park it beside the centred local ship so it is on-screen (its
      // station may be off-frame at spawn) and un-culled. `turret.pos` is its orbit
      // position — the same value feedCombatants projects — so the bar rides it.
      damageTurret(fraction: number): { owner: PlayerId; fraction: number; x: number; y: number } | null {
        const local = world.ships.find(isLocalShip);
        if (!local) return null;
        let target: (typeof world.stations)[number]['turrets'][number] | null = null;
        for (const station of world.stations) {
          for (const t of station.turrets) {
            if (t.owner === LOCAL_PLAYER) { target = t; break; }
            if (!target) target = t; // remember any turret as a fallback
          }
          if (target && target.owner === LOCAL_PLAYER) break;
        }
        if (!target) return null;
        target.pos.x = local.pos.x + 120;
        target.pos.y = local.pos.y;
        const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        target.hp = f * target.maxHp;
        const at: Vec2 = { x: 0, y: 0 };
        renderer.projectToScreen(target.pos, at);
        return { owner: target.owner, fraction: target.hp / target.maxHp, x: at.x, y: at.y };
      },
      bars(): ReturnType<typeof hud.debugHealthBars> {
        return hud.debugHealthBars();
      },
      // The hull fraction the HUD readout last drew — so a test can assert the
      // over-ship bar and the readout agree (one source: sim hull).
      hullReadout(): number {
        return hud.debugHullReadout();
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

  /**
   * Install `window.__nameplateStage` — the ?debug=1 live-stage seam a Playwright
   * test drives to prove the player-name labels are wired on a real boot (field
   * request v0.2.1), the same discipline as `__healthbarStage`. Methods:
   *
   *  - `stageBot()` — park the first bot's SHIP and its HOME STATION on-screen
   *    beside the centred local ship, so both must draw a label (a full-ring-away
   *    rival is off-screen and culled in the frozen frame). Returns the bot's slot,
   *    the name the table resolved for it, and its difficulty tier (v0.2.2), or
   *    null if there is no bot.
   *  - `plates()` — the labels the real layer actually drew last frame (owner,
   *    text, suffix, colour, kind, position), so the test can assert a drawn label
   *    with the lobby's name and difficulty suffix tracks that bot's ship and station.
   *  - `names()` — the per-slot name table the match built, so the test can match a
   *    drawn label's text against the data-driven source.
   *  - `difficulties()` — the per-slot difficulty table (its mirror), so the test
   *    can match a bot's drawn suffix against the same data seam.
   *
   * Mutating `pos` here is a debug-only staging affordance (identical to the
   * health-bar stage), not gameplay: it writes the plain sim data the render loop
   * already reads every frame, entirely behind ?debug=1.
   */
  function installNameplateStage(): void {
    const stage = {
      stageBot(): { owner: PlayerId; name: string; difficulty: string | undefined } | null {
        const local = world.ships.find(isLocalShip);
        const bot = world.ships.find((s) => s.id !== LOCAL_PLAYER && !s.eliminated);
        if (!local || !bot) return null;
        const station = world.stations.find((p) => p.owner === bot.id);
        // Beside the centred local ship so both labels are on-screen and un-culled.
        bot.pos.x = local.pos.x + 120;
        bot.pos.y = local.pos.y - 120;
        bot.alive = true;
        if (station) {
          station.pos.x = local.pos.x + 120;
          station.pos.y = local.pos.y + 140;
        }
        return {
          owner: bot.id,
          name: playerNames[bot.id] ?? `P${bot.id + 1}`,
          difficulty: playerDifficulties[bot.id],
        };
      },
      plates(): ReturnType<typeof hud.debugNameplates> {
        return hud.debugNameplates();
      },
      names(): readonly (string | undefined)[] {
        return playerNames.slice();
      },
      difficulties(): readonly (string | undefined)[] {
        return playerDifficulties.slice();
      },
    };
    try {
      Object.defineProperty(window, '__nameplateStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__oreDepositStage` — the ?debug=1 live-stage seam for the
   * v0.1.2 ore-deposit field report ("there's no way to deposit ore … it just
   * stays on my ship"). The sim now auto-transfers a docked, parked ship's hold
   * into the bank and flies ore couriers ship→station to show it; this seam lets
   * a Playwright test prove that on a REAL boot, the same way `__healthbarStage`
   * proved the bars. Unlike that one it runs WITHOUT ?freeze=1, because the whole
   * point is to watch the live sim drain the hold over a second or so. Methods:
   *
   *  - `stage(ore)` — park the LOCAL ship at rest at its own station with `ore` in
   *    the hold (widening the bay if needed), so the deposit drain starts. Returns
   *    the staged hold/bank, or null if there is no local ship/station.
   *  - `readout()` — the live hold and bank the sim holds this frame: the two
   *    numbers the HUD ticks down/up. The test watches the hold fall and the bank
   *    rise off the same source.
   *  - `flights()` — how many ore-flight couriers are in the world this frame. The
   *    renderer draws every chunk by position, so these deposit couriers ARE drawn
   *    flight sprites — reusing the already-wired chunk layer, no new render path.
   *
   * Like its sibling it mutates only the plain sim data the boot path already
   * reads every frame, lives entirely behind ?debug=1, and does not reach into
   * src/sim (the rule itself is sim-owned; this only stages inputs to it).
   */
  function installOreDepositStage(): void {
    const stage = {
      stage(ore: number): { cargo: number; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        ship.alive = true;
        // Settle clear of the station's collider, at rest, inside dock range.
        ship.pos.x = station.pos.x + (station.radius + ship.radius + 30);
        ship.pos.y = station.pos.y;
        ship.vel.x = 0;
        ship.vel.y = 0;
        if (ore > ship.cargoCap) ship.cargoCap = ore; // widen the bay to fit the stage
        ship.cargo = ore;
        return { cargo: ship.cargo, banked: ship.banked };
      },
      readout(): { cargo: number; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        return ship ? { cargo: ship.cargo, banked: ship.banked } : null;
      },
      flights(): number {
        let n = 0;
        for (const c of world.chunks) if (c.deposit) n++;
        return n;
      },
    };
    try {
      Object.defineProperty(window, '__oreDepositStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__oreHudStage` — the ?debug=1 live-stage seam for the ore-HUD
   * split field rule (*"show ore held on ship under the ship, not top left — top
   * left is to show total ore"*). The held-ore squares moved under the ship as a
   * pooled, screen-space indicator; the top-left now shows only the banked TOTAL.
   * The pure models are unit-green, but only booting the real bundle proves the
   * HUD *draws* a hold indicator that tracks the ship and a total that rises as
   * the hold deposits — the same reason `__healthbarStage` and `__oreDepositStage`
   * exist. It runs WITHOUT ?freeze=1, because the deposit phase watches the LIVE
   * sim drain the hold into the bank. Methods:
   *
   *  - `mine(ore)` — stage a carried hold *away from home* so the deposit rule
   *    does not touch it: park the LOCAL ship at rest far from its station with
   *    `ore` in the hold (widening the bay to fit). The camera still holds it at
   *    screen centre, so the under-ship indicator must appear there. Returns the
   *    staged hold/cap/bank, or null if there is no local ship/station.
   *  - `dock(ore)` — park the LOCAL ship at rest *at* its own station with `ore` in
   *    the hold, starting the sim's auto-deposit drain (the same staging the
   *    ore-deposit seam uses). Returns the staged hold/bank.
   *  - `hold()` — the under-ship hold indicator the HUD actually drew this frame
   *    (screen position + pip counts), or null when hidden — read back to assert
   *    the indicator tracks the ship's screen position and its filled count
   *    matches sim hold.
   *  - `total()` — the banked TOTAL the top-left actually drew this frame.
   *  - `readout()` — the live hold and bank the sim holds this frame.
   *
   * Like its siblings it mutates only the plain sim data the boot path already
   * reads every frame, lives entirely behind ?debug=1, and never reaches into
   * src/sim — the deposit rule is sim-owned; this only stages inputs to it and
   * reads back what the HUD (src/ui) drew.
   */
  function installOreHudStage(): void {
    const stage = {
      mine(ore: number): { cargo: number; cargoCap: number; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        ship.alive = true;
        // Far from home and at rest, so the docked-and-parked deposit rule leaves
        // the staged hold intact — the mine phase asserts the indicator appears
        // with the hold it was given, not one that is already draining.
        ship.pos.x = station.pos.x + 900;
        ship.pos.y = station.pos.y + 900;
        ship.vel.x = 0;
        ship.vel.y = 0;
        if (ore > ship.cargoCap) ship.cargoCap = ore; // widen the bay to fit the stage
        ship.cargo = ore;
        return { cargo: ship.cargo, cargoCap: ship.cargoCap, banked: ship.banked };
      },
      dock(ore: number): { cargo: number; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        ship.alive = true;
        // Settle clear of the station's collider, at rest, inside dock range — the
        // sim's auto-deposit rule takes it from here (same staging as ore-deposit).
        ship.pos.x = station.pos.x + (station.radius + ship.radius + 30);
        ship.pos.y = station.pos.y;
        ship.vel.x = 0;
        ship.vel.y = 0;
        if (ore > ship.cargoCap) ship.cargoCap = ore;
        ship.cargo = ore;
        return { cargo: ship.cargo, banked: ship.banked };
      },
      hold(): ReturnType<typeof hud.debugOreHold> {
        return hud.debugOreHold();
      },
      total(): number {
        return hud.debugBankedTotal();
      },
      readout(): { cargo: number; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        return ship ? { cargo: ship.cargo, banked: ship.banked } : null;
      },
    };
    try {
      Object.defineProperty(window, '__oreHudStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__endScreenStage` — the ?debug=1 live-stage seam for the
   * v0.1.2 end-screen field report ("there was no end match screen after my station
   * died"). The DEFEATED overlay and the result screen (PR #45) were merged and
   * unit-green but never wired into boot; this seam lets a Playwright test prove
   * they now show on a REAL boot, the same way `__healthbarStage` proved the bars.
   *
   * Like the ore-deposit seam it runs WITHOUT ?freeze=1, because SPECTATE must be
   * watched letting the LIVE match play on. Methods stage the two moments through
   * the sim's OWN elimination path (`destroyCore`, the exported rule) and read the
   * wired screen state back — they never fake the UI, only the deaths that drive it:
   *
   *  - `eliminateLocal()` — destroy the LOCAL core while the others stand, so the
   *    DEFEATED overlay must appear (match continues). Returns whether it staged.
   *  - `endMatch()` — destroy every core but one non-local survivor, so the next
   *    tick resolves a winner and the result screen must appear (you, a spectator,
   *    watching someone else take the system). Returns whether it staged.
   *  - `screen()` — which end screen the wiring has up this frame ('none' |
   *    'defeated' | 'result'), read off the same `endScreen` the render loop sets.
   *  - `buttons()` — the buttons that screen is offering, so the test asserts
   *    SPECTATE + REMATCH on DEFEATED and REMATCH + BACK TO MENU on the result.
   *  - `spectate()` / `rematch()` — drive those actions exactly as a tap would.
   *  - `matchId()` — how many worlds this boot has built; REMATCH bumps it, which
   *    is the proof a NEW world booted rather than the old one being re-shown.
   *  - `ticks()` — the sim's own step count, so the test proves the match keeps
   *    advancing while spectating (the loop never stopped ticking).
   *
   * It drives the sim's public `destroyCore` rather than faking screen state: the
   * rule stays sim-owned (GDD §2.7), and this only stages the input to it. Behind
   * ?debug=1, absent in every normal build.
   */
  function installEndScreenStage(): void {
    const stage = {
      eliminateLocal(): boolean {
        const station = stationOf(world, LOCAL_PLAYER);
        if (!station || !station.alive) return false;
        destroyCore(world, station); // the sim's own elimination path
        return true;
      },
      /** Kill the LOCAL ship while its core still stands — a *respawnable* death,
       *  so the "RESPAWNING N…" countdown must appear and the sim's own respawn
       *  clock runs it down (field request v0.2.2). Drives the sim's own
       *  `killShip` (the exact path a fatal hit takes: alive=false, respawnTimer
       *  set, half the hold dropped) rather than faking the UI. Returns whether it
       *  staged. */
      killLocalShip(): boolean {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !ship.alive || ship.eliminated || !station || !station.alive) return false;
        killShip(world, ship);
        return true;
      },
      /** The local ship's liveness — the test asserts controls return once it is
       *  true again after a respawn. */
      shipAlive(): boolean {
        return world.ships.find(isLocalShip)?.alive ?? false;
      },
      /** The sim's own respawn clock for the local ship (seconds; 0 when alive) —
       *  the source the countdown renders the ceiling of. */
      respawnTimer(): number {
        return world.ships.find(isLocalShip)?.respawnTimer ?? 0;
      },
      /** The respawn countdown the HUD actually DREW this frame — show flag, the
       *  ceiling seconds, and the text — so the test proves it appears, decrements
       *  on sim ticks, and clears the instant the ship respawns. */
      respawnCountdown(): { show: boolean; seconds: number; text: string } {
        const m = hud.debugRespawnCountdown();
        return { show: m.show, seconds: m.seconds, text: m.text };
      },
      endMatch(): boolean {
        const survivor = world.stations.find((p) => p.owner !== LOCAL_PLAYER && p.alive);
        if (!survivor) return false;
        for (const p of world.stations) {
          if (p.owner !== survivor.owner && p.alive) destroyCore(world, p);
        }
        return true;
      },
      screen(): 'none' | 'defeated' | 'result' {
        return endScreen;
      },
      buttons(): EndButton[] {
        return endButtonsShown.slice();
      },
      spectate(): void {
        startSpectate();
      },
      rematch(): void {
        rematch();
      },
      matchId(): number {
        return matchId;
      },
      ticks(): number {
        return simTicks;
      },
    };
    try {
      Object.defineProperty(window, '__endScreenStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__upgradeWheelStage` — the ?debug=1 live-stage seam for the
   * v0.2 upgrade-wheel field report ("it should be a wheel menu as well", the
   * open/close leak, and dropping the top-right hull). The upgrade screen is now a
   * radial wheel drawn by the same view as the Build wheel; only booting the real
   * bundle proves a bought tier re-renders its wedge, an unaffordable wedge dims
   * with a reason, and rapid open/close never wedges the menu shut — the same
   * reason `__healthbarStage` and its siblings exist. Best paired with ?freeze=1,
   * which pins the sim so the staged frame holds still. Methods:
   *
   *  - `openBuild()` / `openUpgrade(ore)` — park the LOCAL ship docked at its own
   *    station and open the Build wheel (or the Upgrade wheel behind its arrow),
   *    giving it `ore` to spend so wedges read as affordable. Returns whether the
   *    HUD wheel is up.
   *  - `close()` — shut the wheel, the gesture the cycle test mashes.
   *  - `interactive()` — whether the drawn wheel accepts input this frame (the
   *    leak-fix's verdict: it must stay true after rapid open/close).
   *  - `buyTier(i)` — buy one tier on `TRACK_ORDER[i]` through the sim's real
   *    `buyUpgrade` (validated: docked, affordable, not maxed). Returns the result
   *    and the ship's new tier — "sim state changes", the honest way.
   *  - `tierOf(i)` — the ship's current tier on that track.
   *  - `setOre(ore)` — bank exactly `ore` on the ship, to stage an unaffordable
   *    wedge for the dimmed-with-a-reason assertion.
   *  - `wedges()` — the upgrade wedges the real view drew last frame (label, tier,
   *    current, next, cost, state), so the test reads what actually rendered.
   *
   * Like its siblings it flips only the same UI/sim state a real press does, lives
   * entirely behind ?debug=1, and reaches into src/sim only through its public
   * `buyUpgrade` (the exact call a real upgrade order makes).
   */
  function installUpgradeWheelStage(): void {
    const parkDocked = () => {
      const ship = world.ships.find(isLocalShip);
      const station = stationOf(world, LOCAL_PLAYER);
      if (!ship || !station) return null;
      ship.alive = true;
      // Settle clear of the station's collider, at rest, inside dock range — the
      // same staging the ore-deposit seam uses to sit a ship "at" its station.
      ship.pos.x = station.pos.x + (station.radius + ship.radius + 30);
      ship.pos.y = station.pos.y;
      ship.vel.x = 0;
      ship.vel.y = 0;
      // Under ?freeze=1 `updateBuildWheel` never runs, so `docked` (which feedHud
      // hands the HUD) would stay false; set it to what the staged pose means.
      docked = true;
      return ship;
    };
    const stage = {
      openBuild(): { open: boolean } | null {
        const ship = parkDocked();
        if (!ship) return null;
        if (!buildWheel.open) buildWheel.toggle();
        buildWheel.closePanel();
        return { open: buildWheel.open };
      },
      openUpgrade(ore = 999): { open: boolean } | null {
        const ship = parkDocked();
        if (!ship) return null;
        ship.banked = ore;
        if (!buildWheel.open) buildWheel.toggle();
        buildWheel.openPanel();
        weaponWheelOpen = false; // always land on the main wheel
        return { open: buildWheel.panelOpen };
      },
      openWeapon(): { weaponOpen: boolean } | null {
        // Drill into the WEAPON sub-wheel — the "tap WEAPON" of the field flow.
        const ship = parkDocked();
        if (!ship) return null;
        if (!buildWheel.open) buildWheel.toggle();
        buildWheel.openPanel();
        weaponWheelOpen = true;
        return { weaponOpen: weaponWheelOpen };
      },
      back(): { open: boolean; panelOpen: boolean; weaponOpen: boolean } {
        // Pop ONE wheel level — the hub BACK / ESC gesture (field report v0.2.4):
        // WEAPON → upgrade → Build → closed. The same helper the real hub tap and
        // ESC call, so the seam stages exactly what a player's back does.
        wheelBackOneLevel();
        return { open: buildWheel.open, panelOpen: buildWheel.panelOpen, weaponOpen: weaponWheelOpen };
      },
      close(): void {
        buildWheel.close();
        weaponWheelOpen = false;
      },
      interactive(): boolean {
        return hud.debugWheelInteractive();
      },
      buyTier(i: number): { result: string; tier: number } | null {
        const ship = parkDocked();
        const track = TRACK_ORDER[i];
        if (!ship || track === undefined) return null;
        const result = buyUpgrade(world, ship, track);
        return { result, tier: ship.tiers[track] };
      },
      buyByTrack(track: string): { result: string; tier: number } | null {
        // Buy a tier on a named track — the sub-wheel test reads the track off the
        // drawn SPEED wedge and buys it through the sim's real, validated purchase.
        const ship = parkDocked();
        const key = (Object.values(UpgradeTrack) as string[]).includes(track)
          ? (track as UpgradeTrack)
          : null;
        if (!ship || key === null) return null;
        const result = buyUpgrade(world, ship, key);
        return { result, tier: ship.tiers[key] };
      },
      tierOf(i: number): number | null {
        const ship = world.ships.find(isLocalShip);
        const track = TRACK_ORDER[i];
        return ship && track !== undefined ? ship.tiers[track] : null;
      },
      setOre(ore: number): { banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        if (!ship) return null;
        ship.cargo = 0;
        ship.banked = ore;
        return { banked: ship.banked };
      },
      wedges(): ReturnType<typeof hud.debugUpgradeWedges> {
        return hud.debugUpgradeWedges();
      },
      wedgePoint(i: number): { x: number; y: number } | null {
        // The LOGICAL screen point at the centre of wedge `i` on the CURRENT
        // upgrade level — the exact geometry the pointer handler hit-tests against
        // ({@link upgradeWheelLayout}). A real-input test dispatches a synthesized
        // pointerdown here to press the wedge through the actual door.
        const w = transform.logicalWidth;
        const h = transform.logicalHeight;
        const slots = upgradeWheelSlots(weaponWheelOpen);
        if (i < 0 || i >= slots.length) return null;
        const radius = wheelRadius(w, h);
        const angle = upgradeWedgeAngle(i, slots.length);
        // 0.6 of the outer radius sits inside the segment ring (0.3‥1.0), where the
        // wedge's words are drawn — the honest middle of the pressable wedge.
        return {
          x: w / 2 + Math.cos(angle) * radius * 0.6,
          y: h / 2 + Math.sin(angle) * radius * 0.6,
        };
      },
      hubPoint(): { x: number; y: number } {
        // The LOGICAL screen point at the wheel's hub — the BACK affordance a hub
        // tap / ESC acts on (field report v0.2.4). The follow camera holds the
        // docked ship, and the wheel drawn on it, at the viewport centre, so the
        // hub is dead centre. A real-input test dispatches a pointerdown here to
        // back out a level through the actual door.
        return { x: transform.logicalWidth / 2, y: transform.logicalHeight / 2 };
      },
      legend(): ReturnType<typeof hud.debugControlsStrip> {
        // The controls-strip rows the HUD resolved this frame — read by a
        // live-stage test to prove the PC Build legend is contextual on docking.
        return hud.debugControlsStrip();
      },
    };
    try {
      Object.defineProperty(window, '__upgradeWheelStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__pressStage` — the ?debug=1 live-stage seam for the press &
   * action feedback (field report v0.2.2), the same discipline as
   * {@link installUpgradeWheelStage}. It opens the Build wheel at the station, then
   * drives the HUD's own press/confirm seams and reads the motion back, so a
   * Playwright test can prove the pressed / rejected / confirmed tells are wired
   * and drawn on the REAL booted client (the derivation itself is unit-tested in
   * `src/ui/press-feedback.test.ts`). Behind ?debug=1, never in a normal build.
   */
  function installPressStage(): void {
    const stage = {
      /** Park the ship docked, fund the bank, and open the Build wheel so its
       *  wedges draw and can be pressed. */
      openBuild(ore = 999): { open: boolean; banked: number } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        ship.alive = true;
        ship.pos.x = station.pos.x + (station.radius + ship.radius + 30);
        ship.pos.y = station.pos.y;
        ship.vel.x = 0;
        ship.vel.y = 0;
        ship.cargo = 0;
        ship.banked = ore;
        docked = true; // ?freeze skips updateBuildWheel, so state the staged pose
        if (!buildWheel.open) buildWheel.toggle();
        buildWheel.closePanel();
        return { open: buildWheel.open, banked: ship.banked };
      },
      press(surface: 'build' | 'upgrade', index: number): void {
        hud.debugPressWedge(surface, index);
      },
      confirm(surface: 'build' | 'upgrade', index: number, amount: number, deposit = false, core = false): void {
        hud.debugConfirmWedge(surface, index, amount, deposit, core);
      },
      feedback(surface: 'build' | 'upgrade', index: number): ReturnType<typeof hud.debugWedgeFeedback> {
        return hud.debugWedgeFeedback(surface, index);
      },
      floats(): ReturnType<typeof hud.debugCostFloats> {
        return hud.debugCostFloats();
      },
      coreShimmer(): number {
        return hud.debugCoreShimmer();
      },
      bank(): number | null {
        const ship = world.ships.find(isLocalShip);
        return ship ? ship.banked : null;
      },
    };
    try {
      Object.defineProperty(window, '__pressStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__repairStage` — the ?debug=1 live-stage seam for discrete
   * REPAIR CORE (p5-07/p5-08), the same discipline as {@link installPressStage} but
   * driven by REAL clicks (the p1a rule). A unit test proves the wedge's copy and
   * the sim's per-tap repair in memory; only booting the real bundle proves a
   * genuine pointer press on the drawn REPAIR wedge places one discrete order that
   * spends exactly one ore and lifts the core by one tap's HP — and that the wedge
   * SHOWS the deal ("+15 HP", the partial near full, or a reason) before the tap.
   *
   * It stages the report's real precondition — a core only takes damage from a
   * siege (GDD §2.6) — by damaging the LOCAL core through the sim's own
   * `damageStation`, funding the bank, parking the ship docked, and opening the
   * Build wheel so its wedges draw and can be hit. The test then dispatches real
   * pointerdowns at {@link repairWedgePoint} (into the same `main.ts` handler a
   * mouse/thumb uses) and reads the LIVE sim + the DRAWN wedge back. Runs WITHOUT
   * ?freeze so the sim steps and each order actually resolves. Methods:
   *
   *  - `siege(damage, banked)` — damage the local core by `damage`, bank `banked`,
   *    park docked at rest, open the Build wheel. Returns the staged core/bank.
   *  - `setCore(hp)` — set the local core to exactly `hp` (stage near-full/full).
   *  - `repairWedgePoint()` — the LOGICAL screen point at the centre of the REPAIR
   *    wedge, the exact geometry the pointer handler hit-tests (real-click door).
   *  - `wedge()` — the REPAIR wedge the real view drew this frame (sub line, ready,
   *    cost), so the test asserts the shown deal/reason off the shipped bundle.
   *  - `readout()` — the live core HP / max / bank / repair tell this frame.
   *
   * Behind ?debug=1, never in a normal build; it mutates only the plain sim data
   * the boot path already reads, and reaches src/sim only through `damageStation`.
   */
  function installRepairStage(): void {
    const REPAIR_INDEX = WHEEL_ORDER.indexOf('repair');
    const localStation = () => stationOf(world, LOCAL_PLAYER);
    const parkDockedOpen = () => {
      const ship = world.ships.find(isLocalShip);
      const station = localStation();
      if (!ship || !station) return null;
      ship.alive = true;
      ship.pos.x = station.pos.x + (station.radius + ship.radius + 30);
      ship.pos.y = station.pos.y;
      ship.vel.x = 0;
      ship.vel.y = 0;
      docked = true; // the wheel opens at your own station and nowhere else
      if (!buildWheel.open) buildWheel.toggle();
      buildWheel.closePanel(); // land on the main wheel, where REPAIR CORE lives
      return { ship, station };
    };
    const stage = {
      siege(damage: number, banked: number): { coreHp: number; maxCoreHp: number; banked: number } | null {
        const parked = parkDockedOpen();
        if (!parked) return null;
        const { ship, station } = parked;
        ship.cargo = 0;
        ship.banked = banked;
        // Lift the match-start station spawn protection first (GDD §2.1) — it blocks
        // `damageStation` entirely in the opening seconds, so a staged siege would
        // no-op and leave the core full. Zeroing it here stages the mid-match state
        // the report is about, then the hit lands the REAL way.
        station.spawnProtect = 0;
        // Only a siege damages a core (GDD §2.6) — go through the sim's own damage
        // function, the same path a real hit takes, rather than poking coreHp.
        if (damage > 0) damageStation(world, station, damage);
        return { coreHp: station.coreHp, maxCoreHp: station.maxCoreHp, banked: ship.banked };
      },
      setCore(hp: number): { coreHp: number; maxCoreHp: number } | null {
        const station = localStation();
        if (!station) return null;
        station.coreHp = Math.max(0, Math.min(station.maxCoreHp, hp));
        return { coreHp: station.coreHp, maxCoreHp: station.maxCoreHp };
      },
      repairWedgePoint(): { x: number; y: number } | null {
        if (REPAIR_INDEX < 0) return null;
        const w = transform.logicalWidth;
        const h = transform.logicalHeight;
        const radius = wheelRadius(w, h);
        const angle = segmentAngle(REPAIR_INDEX);
        // 0.6 of the outer radius sits inside the segment ring where the wedge's
        // words are drawn — the honest middle of the pressable wedge.
        return {
          x: w / 2 + Math.cos(angle) * radius * 0.6,
          y: h / 2 + Math.sin(angle) * radius * 0.6,
        };
      },
      repairWedgeClientPoint(): { x: number; y: number } | null {
        // The wedge centre in CLIENT (physical CSS) space, so a real tap lands on it
        // on EITHER form factor: on a portrait phone under the landscape lock the
        // logical point is rotated back through `logicalToPhysical` (identity on
        // desktop), then offset by the canvas rect — the exact inverse of the
        // `toLogical` every real pointer crosses. The live-stage cooldown spec taps
        // here so the same cycle drives on desktop and phone alike.
        const logical = stage.repairWedgePoint();
        if (!logical) return null;
        const p = logicalToPhysical(logical.x, logical.y, transform);
        const rect = app.canvas.getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
      },
      wedge(): { sub: string; ready: boolean; cost: number | null } | null {
        const drawn = hud.debugBuildWedges().find((wedge) => wedge.id === 'repair');
        return drawn ? { sub: drawn.sub, ready: drawn.ready, cost: drawn.cost } : null;
      },
      readout(): {
        coreHp: number;
        maxCoreHp: number;
        banked: number;
        repairing: boolean;
        repairGate: number;
      } | null {
        const ship = world.ships.find(isLocalShip);
        const station = localStation();
        if (!ship || !station) return null;
        return {
          coreHp: station.coreHp,
          maxCoreHp: station.maxCoreHp,
          banked: ship.banked,
          repairing: station.repairing ?? false,
          // The repair COOLDOWN remaining (RATIFIED developer, 2026-07-28): while
          // `> 0` the wedge draws "REPAIR in Ns" and a press is refused
          // `'cooling-down'`. The live-stage spec waits on this to prove the wedge
          // disables through the whole cooldown and re-arms as it reaches zero.
          repairGate: station.repairGate ?? 0,
        };
      },
    };
    try {
      Object.defineProperty(window, '__repairStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__tapCommanderStage` — the ?debug=1 live-stage seam that proves
   * Tap Commander is wired on the REAL booted client (developer §5), the same
   * discipline as {@link installPressStage}. The pilot's geometry is unit-tested
   * (tap-pilot.test.ts); what a unit test cannot reach is that the shipped bundle
   * turns a tap into an order that flies the ship and fires on a lock through the
   * client's own input funnel. This stages that: switch to the tap scheme, park the
   * local ship with one bot parked in weapon range, place an order exactly as a tap
   * does (`buildTapCandidates` → `pickTapTarget` → the pilot), and read back the
   * live sim — the ship moves to a waypoint, locks and fires on a bot, and drops the
   * lock when a fresh empty-space order replaces it. Behind ?debug=1, never in a
   * normal build; it mutates only the plain sim data the boot path already reads.
   */
  function installTapCommanderStage(): void {
    /** Park the local ship at the arena centre with one bot in weapon range and the
     *  field cleared — the shared base for the move/lock stage and the auto-engage
     *  stage. Returns the staged world positions, or null if there is no ship / bot. */
    function parkShipBot(): { ship: Vec2; bot: Vec2; botId: PlayerId } | null {
      const ship = world.ships.find(isLocalShip);
      const bot = world.ships.find((s) => s.id !== LOCAL_PLAYER);
      if (!ship || !bot) return null;
      const cx = world.bounds.width / 2;
      const cy = world.bounds.height / 2;
      world.asteroids.length = 0; // empty space is genuinely empty for the move test
      ship.pos.x = cx;
      ship.pos.y = cy;
      ship.vel.x = 0;
      ship.vel.y = 0;
      ship.alive = true;
      ship.spawnProtect = 0;
      bot.pos.x = cx + 140;
      bot.pos.y = cy;
      bot.vel.x = 0;
      bot.vel.y = 0;
      bot.alive = true;
      bot.spawnProtect = 0;
      controlScheme = 'tap';
      tapPilot.clear();
      return { ship: { x: cx, y: cy }, bot: { x: cx + 140, y: cy }, botId: bot.id };
    }

    const stage = {
      /** Switch schemes (persisted like the settings row would). */
      setScheme(scheme: 'sticks' | 'tap'): void {
        controlScheme = scheme;
        tapPilot.clear();
        platform.storage.set(CONTROL_SCHEME_KEY, controlScheme);
      },
      /** Park the local ship at the arena centre with one bot a short hop away in
       *  weapon range, both out of spawn protection, and clear the asteroid field so
       *  a tap on empty space is unambiguous. Switches to the tap scheme. Returns the
       *  staged world positions, or null if there is no local ship / no bot. */
      stage(): { ship: Vec2; bot: Vec2; botId: PlayerId } | null {
        return parkShipBot();
      },
      /** Stage the auto-engage front door (developer p9-02 §1): the local ship at the
       *  arena centre with one bot parked in weapon range, the field cleared, and a
       *  waypoint returned WELL AWAY from the bot. A move to that waypoint (no lock)
       *  must still auto-fire at the bot mid-flight — "move and it auto-fires at the
       *  closest high priority target". Switches to the tap scheme. */
      stageAutoEngage(): { ship: Vec2; bot: Vec2; botId: PlayerId; waypoint: Vec2 } | null {
        const s = parkShipBot();
        if (!s) return null;
        const ship = world.ships.find(isLocalShip);
        if (ship) ship.cargo = 0; // hold has room, so a rock would be mined too
        return { ...s, waypoint: { x: s.ship.x, y: s.ship.y - 320 } };
      },
      /** Stage the full-hold rock suppression front door (developer p9-02 §1, "if ore
       *  is full it shouldn't fire at asteroids automatically"): the local ship at the
       *  arena centre, ONE asteroid in weapon range, and every enemy parked far out of
       *  range so the ladder falls to the rock — which a full hold then suppresses.
       *  `full` sets the hold full (shots stop at rocks) or empty (rock is mined).
       *  Returns the ship + rock world positions and a waypoint away from the rock, or
       *  null if there is no local ship. */
      stageRockOnly(full: boolean): { ship: Vec2; rock: Vec2; waypoint: Vec2 } | null {
        const ship = world.ships.find(isLocalShip);
        if (!ship) return null;
        const cx = world.bounds.width / 2;
        const cy = world.bounds.height / 2;
        ship.pos.x = cx;
        ship.pos.y = cy;
        ship.vel.x = 0;
        ship.vel.y = 0;
        ship.alive = true;
        ship.spawnProtect = 0;
        ship.cargo = full ? ship.cargoCap : 0;
        // No hittable enemy: park every other ship in a far corner, out of weapon
        // range and spawn-protected, so tier 1 is empty and the ladder falls to the
        // rock (then the full-hold rule decides whether the rock is worth a shot).
        for (const other of world.ships) {
          if (other.id === LOCAL_PLAYER) continue;
          other.pos.x = 0;
          other.pos.y = 0;
          other.vel.x = 0;
          other.vel.y = 0;
          other.spawnProtect = 999;
        }
        world.asteroids.length = 0;
        world.asteroids.push({
          id: 900_001,
          pos: { x: cx + 140, y: cy },
          radius: 30,
          ore: 12,
          maxOre: 12,
          crackStage: 0,
          mineBuffer: 0,
          home: null,
        });
        controlScheme = 'tap';
        tapPilot.clear();
        return { ship: { x: cx, y: cy }, rock: { x: cx + 140, y: cy }, waypoint: { x: cx, y: cy - 320 } };
      },
      /** Place an order at a WORLD point exactly as a tap does — resolve the world
       *  hit-test through the client's own candidate list + picker and hand the pilot
       *  the order. Returns what it locked onto (`null` kind = an empty-space move). */
      tapWorld(x: number, y: number): { locked: boolean; kind: TargetKind | null; id: number | null } {
        const hit = pickTapTarget(buildTapCandidates(), { x, y });
        if (hit) {
          tapPilot.lockTarget({ kind: hit.kind, id: hit.id });
          return { locked: true, kind: hit.kind, id: hit.id };
        }
        tapPilot.orderMove({ x, y });
        return { locked: false, kind: null, id: null };
      },
      /**
       * Stage the p10 "tap your station to open the build wheel" front door (developer
       * §5): park the local ship DOCKED at its OWN station (inside `STATION.dockRange`,
       * so the wheel's own `isDocked` gate is true), switch to the tap scheme, fund
       * the bank so a turret is affordable, clear the field and park every rival far
       * away so the station tap is unambiguous, and start from a CLOSED wheel — the
       * real tap must be what opens it. Returns the LOGICAL screen points a Playwright
       * test REAL-taps: the station centre (opens the wheel), the TURRET wedge (buys),
       * a point well OUTSIDE the wheel (closes it, no move), and an empty up-field
       * point (the move that flies again). Runs live (no ?freeze) so the buy actually
       * drains. Null if there is no local ship / station.
       */
      stageStationWheel(): {
        stationPoint: Vec2;
        turretWedgePoint: Vec2;
        outsidePoint: Vec2;
        movePoint: Vec2;
        banked: number;
        turretCount: number;
      } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        // Dock the ship: sit it a short surface hop off the station — the same close
        // parking the repair stage uses, well inside `isDocked`'s range — so the
        // wheel's own docking gate is true every frame (no ?freeze here to prop it up).
        ship.alive = true;
        ship.spawnProtect = 0;
        ship.pos.x = station.pos.x + (station.radius + ship.radius + 20);
        ship.pos.y = station.pos.y;
        ship.vel.x = 0;
        ship.vel.y = 0;
        ship.cargo = 0;
        ship.banked = 999; // a turret is a few ore — comfortably affordable
        station.spawnProtect = 0;
        world.asteroids.length = 0; // no rock steals the tap near the station
        for (const other of world.ships) {
          if (other.id === LOCAL_PLAYER) continue;
          other.pos.x = 0;
          other.pos.y = 0;
          other.vel.x = 0;
          other.vel.y = 0;
          other.spawnProtect = 999;
        }
        controlScheme = 'tap';
        tapPilot.clear();
        if (buildWheel.open) buildWheel.close(); // the tap is what must open it

        const w = transform.logicalWidth;
        const h = transform.logicalHeight;
        const radius = wheelRadius(w, h);
        const turretIndex = WHEEL_ORDER.indexOf('turret');
        const angle = segmentAngle(turretIndex);
        return {
          stationPoint: worldToLogical(station.pos.x, station.pos.y),
          // 0.6 of the outer radius sits in the wedge's word band — the honest middle
          // of the pressable TURRET wedge (mirrors `repairWedgePoint`).
          turretWedgePoint: { x: w / 2 + Math.cos(angle) * radius * 0.6, y: h / 2 + Math.sin(angle) * radius * 0.6 },
          // Below the wheel, comfortably past its outer ring, on cleared empty space:
          // an OUTSIDE tap that closes the wheel and does NOT double as a move (§2).
          outsidePoint: { x: w / 2, y: Math.min(h - 8, h / 2 + radius + 48) },
          // An empty up-field point (well above the station, clear of the top chrome):
          // the fresh tap that flies the ship again once the wheel is closed.
          movePoint: { x: w / 2, y: Math.max(24, h * 0.18) },
          banked: ship.banked,
          turretCount: turretCount(station),
        };
      },
      /** The build wheel's live screen state — what a real tap opened or closed. */
      wheelState(): { open: boolean; panelOpen: boolean } {
        return { open: buildWheel.open, panelOpen: buildWheel.panelOpen };
      },
      /** The local ship's banked ore and its station's turret count (finished + queued):
       *  the two tells a turret buy moves — banked drops by the cost, the count rises. */
      buildReadout(): { banked: number; turretCount: number } | null {
        const ship = world.ships.find(isLocalShip);
        const station = stationOf(world, LOCAL_PLAYER);
        if (!ship || !station) return null;
        return { banked: ship.banked, turretCount: turretCount(station) };
      },
      /** The pilot's current standing order, as plain data. */
      order(): { kind: 'waypoint' | 'target' | 'none'; at: Vec2 | null; ref: { kind: TargetKind; id: number } | null } {
        const o = tapPilot.currentOrder;
        if (!o) return { kind: 'none', at: null, ref: null };
        if (o.kind === 'waypoint') return { kind: 'waypoint', at: { x: o.at.x, y: o.at.y }, ref: null };
        return { kind: 'target', at: null, ref: { kind: o.ref.kind, id: o.ref.id } };
      },
      /** Live readout: the local ship's position, its firing tell (the sim's own
       *  `firing`, set on any tick its weapon loosed), and the active scheme. */
      readout(): { scheme: 'sticks' | 'tap'; shipPos: Vec2 | null; firing: boolean; alive: boolean } {
        const ship = world.ships.find(isLocalShip);
        return {
          scheme: controlScheme,
          shipPos: ship ? { x: ship.pos.x, y: ship.pos.y } : null,
          firing: ship?.firing ?? false,
          alive: ship?.alive ?? false,
        };
      },
    };
    try {
      Object.defineProperty(window, '__tapCommanderStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__tapMarkerStage` — the ?debug=1 live-stage seam that proves
   * the Tap Commander order MARKERS are drawn on a real boot (developer §4), the
   * UI-side counterpart to the Platform lane's `__tapCommanderStage` (which drives
   * the pilot). The pure decision + the view's animation are unit-tested; what a
   * unit test cannot reach is that the shipped bundle projects the standing order
   * to screen and the layer draws a reticle on the right target and a waypoint
   * pulse at the tapped point. This exposes the markers the real layer drew last
   * frame ({@link Hud.debugTapMarkers}) so a Playwright test — driving the pilot
   * through `__tapCommanderStage` — can read them back. Behind ?debug=1 only.
   */
  function installTapMarkerStage(): void {
    const stage = {
      /** The order markers the HUD's tap-marker layer actually drew last frame. */
      markers(): ReturnType<typeof hud.debugTapMarkers> {
        return hud.debugTapMarkers();
      },
    };
    try {
      Object.defineProperty(window, '__tapMarkerStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__minimapStage` — the ?debug=1 live-stage seam that proves, on
   * a REAL boot, the minimap toggles between its two states under REAL input and
   * its own-ship dot tracks the player's motion (the p1a rule; field request rule
   * 4). The toggle + the fit + the scene are unit-tested; what a unit test cannot
   * reach is that the shipped bundle routes a canvas tap to the toggle and the
   * layer redraws the dots on the real client. A Playwright test reads the active
   * rect from {@link Hud.debugMinimap} (so it knows where to tap), dispatches a
   * real pointer at its centre, and reads back the flipped state + the moved dot.
   *
   * **Fog of war (feature f1).** The unit tests assert the sensed-state gating (a
   * live dot vanishes when its coverage dies); what they cannot reach is the whole
   * wiring — that the shipped bundle threads the sim's `sensorSources` into the
   * map, so building a radar satellite paints a LARGE coverage disc and reveals a
   * distant enemy, and killing it collapses that disc and the enemy drops the same
   * tick. `buildSatellite`/`killSatellite` STAGE the sim data (push / zero a
   * satellite, park a distant enemy under the satellite-only band) exactly as
   * `__healthbarStage` stages a bot — the fog itself is computed by the real
   * pipeline, so the seam cannot fake the wiring it proves. Best paired with
   * `?freeze=1` (deterministic: no bot drift, the pinned scene holds still).
   *
   * Behind ?debug=1 only; a normal build never installs it.
   */
  function installMinimapStage(): void {
    const stage = {
      /** The minimap state the HUD's minimap layer actually drew last frame — the
       *  active rect (where to tap), the toggle state, and the own-ship dot, plus
       *  the fog-gated counts (coverage discs + sensed enemy ships). */
      state(): ReturnType<typeof hud.debugMinimap> {
        return hud.debugMinimap();
      },
      /**
       * Stage a radar satellite on the local station (feature f1) and park a
       * distant enemy in the band only that satellite's LARGE sensor can reach —
       * so building it must reveal both a new coverage disc and the enemy dot. A
       * no-op-safe return of null when there is no local station / no enemy to
       * park. Idempotent on the satellite (one per station cap); re-parks the enemy
       * each call. Returns the satellite range + the enemy's distance from the
       * station so the test knows the geometry is honest (enemy inside sat range,
       * outside the ship/station baseline).
       */
      buildSatellite(): { satRange: number; enemyDist: number } | null {
        const station = stationOf(world, LOCAL_PLAYER);
        if (!station) return null;
        if (!station.satellites) station.satellites = [];
        // One per station — reuse an existing staged satellite, else mint one born
        // in its orbit band (mirrors the sim's makeSatellite geometry).
        if (station.satellites.length === 0) {
          const orbitAngle = station.angle + Math.PI;
          const pos = satelliteOrbitPos(station, orbitAngle);
          station.satellites.push({
            id: world.nextEntityId++,
            owner: station.owner,
            pos: { x: pos.x, y: pos.y },
            radius: SATELLITE.radius,
            hp: SATELLITE.hp,
            maxHp: SATELLITE.hp,
            orbitAngle,
          });
        } else {
          // Revive a previously-killed staged satellite for a fresh cycle.
          const sat = station.satellites[0]!;
          sat.hp = SATELLITE.hp;
        }
        // Park an enemy in the satellite-only band: outside the ship's own sensor
        // and the station's, comfortably inside the satellite's LARGE reach.
        const enemyDist = SATELLITE.sensorRange * 0.75; // < range, > ship/station sensors
        const enemy = world.ships.find((s) => s.id !== LOCAL_PLAYER && !s.eliminated);
        if (!enemy) return null;
        enemy.pos.x = station.pos.x + enemyDist;
        enemy.pos.y = station.pos.y;
        enemy.alive = true;
        enemy.spawnProtect = 0;
        return { satRange: SATELLITE.sensorRange, enemyDist };
      },
      /** Kill the staged satellite (feature f1): zero its HP, so it is no longer a
       *  sensor source (`../sim/sensing` reads only hp > 0) — its coverage disc
       *  collapses the same tick and the distant enemy it revealed drops off the
       *  map. Returns true if a satellite was there to kill. */
      killSatellite(): boolean {
        const station = stationOf(world, LOCAL_PLAYER);
        const sat = station?.satellites?.[0];
        if (!sat) return false;
        sat.hp = 0;
        return true;
      },
    };
    try {
      Object.defineProperty(window, '__minimapStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__audioStage` — the ?debug=1 live-stage seam that proves, on a
   * REAL boot, that the game actually MAKES SOUND (field report v0.2.4: "why don't
   * I hear ANY sounds yet?"). The unit tests build the whole graph headless against
   * a stub context and assert its shape; what they cannot reach is the one thing
   * that was broken — that the shipped bundle opens a context, resumes it on a real
   * gesture, and drives the mix. This is a pure READBACK: it reports the live audio
   * state (the raw `AudioContext.state`, the master gain the player will actually
   * hear through, whether the adaptive soundtrack is running and in which phase, and
   * a running count of SFX one-shots the mix has started). A Playwright test does a
   * REAL tap on PLAY (the unlock gesture), then asserts `state === 'running'`, the
   * master gain is above zero, the music is playing, and a real wheel tap bumped the
   * SFX count. It drives nothing — every sound comes from a real gesture on the real
   * client — so it cannot fake the very wiring it is there to prove. Behind ?debug=1.
   */
  function installAudioStage(): void {
    const stage = {
      /** A snapshot of the live audio state — the whole "is it alive?" readout. */
      read(): {
        /** `null` running silent (no context — Node, the harness); otherwise the
         *  raw `AudioContext.state`: `suspended` until a gesture, then `running`. */
        contextState: string | null;
        /** True once a gesture resumed the context (`./art/audio/unlock`). */
        unlocked: boolean;
        /** True once `start()` ran — the standing voices (ambient + music) began. */
        running: boolean;
        /** The master gain the player hears through, 0..1. Zero would be silence. */
        master: number | null;
        /** True while the adaptive soundtrack is enabled and playing (`./music`). */
        musicPlaying: boolean;
        /** The soundtrack's current phase — calm / building / siege / … . */
        musicPhase: string;
        /** SFX one-shots the mix has STARTED since boot — bumps on every real tell
         *  and cue. A wheel tap raising this proves an SFX node actually fired. */
        sfxCount: number;
        /** One-shots skipped because the death hush had the mix at zero (§4.7). */
        hushedCount: number;
        /** The SFX bus gain the cue actually rides, 0..1 (the SFX slider × the
         *  alarm duck). Zero means the seam still fired but nothing is audible —
         *  the "slider at 0" case (field report v0.2.4+ point 4). */
        sfxBusGain: number | null;
        /** UI cues fired through the shared seam since boot, per KIND — so a test
         *  can attribute a sound to the interaction (a live wedge → press, a
         *  disabled one → reject, a landed spend → confirm). Null in a normal build
         *  (the tally is ?debug=1 only). */
        uiCues: { press: number; confirm: number; reject: number; last: UiCue | null } | null;
        /** The placement of the last spatial one-shot (`./art/audio/spatial`) — the
         *  gain a far siege was heard at and the pan a shot flew in on. Sound cannot
         *  screenshot, so the spatial-audio attestation is these numbers (a3-03). */
        lastGain: number;
        lastPan: number;
        /** Where the mix is listening from (the camera), world units — the anchor a
         *  spatial probe measures against. `has` false before the first listener. */
        listener: { x: number; y: number; has: boolean };
      } {
        return {
          contextState: audioCtx ? audioCtx.state : null,
          unlocked: audioUnlock?.unlocked ?? false,
          running: audio.running,
          master: audio.graph ? audio.graph.master.gain.value : null,
          musicPlaying: audio.music?.playing ?? false,
          musicPhase: audio.musicScore.phase,
          sfxCount: audio.playCount,
          hushedCount: audio.hushedCount,
          sfxBusGain: audio.graph ? audio.graph.buses.sfx.gain.value : null,
          uiCues: uiSfxLog ? { ...uiSfxLog } : null,
          lastGain: audio.lastPlacement.gain,
          lastPan: audio.lastPlacement.pan,
          listener: { ...audio.listener },
        };
      },
      /** What the spatial model would do to a sound at world (x, y) right now,
       *  given the live listener — pure, plays nothing. A live-stage test probes a
       *  point left and right of the camera to attest that pan flips sign and a
       *  distant one falls to near-silence (a3-03). Behind ?debug=1 only. */
      probe(x: number, y: number): { gain: number; pan: number; cutoff: number; culled: boolean } {
        return audio.probe(x, y);
      },
      /** Resume the context by hand — the exact call the unlock makes from a
       *  gesture. The spec still drives sound through a REAL tap; this is only the
       *  escape hatch for a headless runner whose synthetic input a browser might
       *  not count as a gesture, so the readback above is never a false negative. */
      async resume(): Promise<string | null> {
        if (!audioUnlock) return null;
        await audioUnlock.unlockNow();
        return audioCtx ? audioCtx.state : null;
      },
      /** Set the SFX bus level, 0..1 — the same call the settings slider makes
       *  through {@link applyAudioMix}. Behind ?debug=1 only, so a live-stage test
       *  can prove the "slider at 0" case: the UI seam still FIRES (`uiCues`
       *  climbs) but `sfxBusGain` reads 0, so the cue is inaudible (field report
       *  v0.2.4+ point 4). The real slider→gain path is the settings test's job. */
      setSfx(value: number): void {
        audio.setSfxVolume(value);
      },
    };
    try {
      Object.defineProperty(window, '__audioStage', {
        value: stage,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      // Already defined (double install / HMR) — leave the existing one in place.
    }
  }

  /**
   * Install `window.__pauseStage` — the live-stage seam that proves, on a REAL
   * boot, that the pause menu is wired (developer p10): ESC/tap opens it, the
   * offline sim freezes while it is up and resumes on RESUME, SETTINGS round-trips,
   * and EXIT+confirm tears the world down to the menu. Pure READBACK plus the
   * physical press points the client itself drew each control at (through the
   * landscape-lock remap, the same shape `__mainMenu` uses), so a Playwright test
   * drives the WHOLE path with real ESC and real clicks — never a hit-test seam —
   * and reads back only plain state.
   *
   * Installed on BOTH boots (see the call site): the online half of the ratified
   * pause rule — the sim keeps running under the overlay — is only reachable
   * through the front door, which `?debug=1` skips.
   */
  function installPauseStage(): void {
    const physOf = (lx: number, ly: number): { x: number; y: number } => {
      const p = logicalToPhysical(lx, ly, transform);
      return { x: p.x, y: p.y };
    };
    /** The controls on whichever pause screen is up — pause buttons, confirm
     *  buttons, or the settings rows + DONE — each with the physical point a real
     *  press must land on. Empty when the overlay is closed. */
    const controls = (): { kind: string; physicalCenter: { x: number; y: number } }[] => {
      const w = transform.logicalWidth;
      const h = transform.logicalHeight;
      if (pauseScreen === 'settings') {
        const l = settingsLayout({ width: w, height: h }, { isTouch });
        const rows = l.rows.map((r, i) => ({
          kind: SETTINGS_ROWS[i]?.kind ?? 'row',
          physicalCenter: physOf(r.x + r.width / 2, r.y + r.height / 2),
        }));
        rows.push({
          kind: 'back',
          physicalCenter: physOf(l.back.x + l.back.width / 2, l.back.y + l.back.height / 2),
        });
        return rows;
      }
      if (pauseScreen === 'menu' || pauseScreen === 'confirm') {
        const ids = pauseButtons(pauseScreen);
        const l = pauseLayout({ width: w, height: h }, ids.length, { isTouch });
        return l.buttons.map((r, i) => ({
          kind: ids[i] ?? 'button',
          physicalCenter: physOf(r.x + r.width / 2, r.y + r.height / 2),
        }));
      }
      return [];
    };
    const stage = {
      read(): {
        screen: PauseScreen;
        open: boolean;
        pausable: boolean;
        frozen: boolean;
        simTicks: number;
        online: boolean;
        ship: { x: number; y: number; vx: number; vy: number } | null;
        controls: { kind: string; physicalCenter: { x: number; y: number } }[];
        buttonPoint: { x: number; y: number };
      } {
        const r = pauseButtonRect({ width: transform.logicalWidth, height: transform.logicalHeight });
        const ship = world.ships.find(isLocalShip) ?? null;
        return {
          screen: pauseScreen,
          open: isPauseOpen(pauseScreen),
          pausable,
          // The one distinction the whole feature turns on: offline + overlay-up →
          // frozen. Read live, so a test can watch it flip on ESC and off on RESUME.
          frozen: shouldFreezeSim(pauseScreen, pausable),
          // The sim's own step counter — unchanging while frozen, advancing after
          // RESUME. The executable form of "ticks stop, resume continues."
          simTicks,
          // Which world this is, so the audit can say WHY it expected what it saw
          // rather than inferring the transport from the freeze it is testing.
          online: !pausable,
          // The local ship's live position and velocity. The ratified online rule is
          // "the world keeps running, the ship keeps flying (or drifts)" — a tick
          // counter proves the first half; only a ship that has MOVED across the
          // pause proves the second, and a frozen offline one must not have.
          ship: ship ? { x: ship.pos.x, y: ship.pos.y, vx: ship.vel.x, vy: ship.vel.y } : null,
          controls: controls(),
          // The touch corner button's physical centre (for the phone-profile path).
          buttonPoint: physOf(r.x + r.width / 2, r.y + r.height / 2),
        };
      },
    };
    try {
      Object.defineProperty(window, '__pauseStage', {
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

    // Tap Commander order markers (developer §4): the waypoint marker and lock-on
    // reticle, world-tracking affordances the ui seam (p6-02) draws. We register
    // the STATE + placement contract — the projected rect the marker occupies —
    // so a live-stage / phone profile can prove the affordance is on screen where
    // the order is. Present only while an order stands, in the tap scheme. Uses the
    // renderer's ACTUAL world-root transform (projectToScreen, after draw), so the
    // rect is exactly where the marker would draw.
    if (controlScheme === 'tap') {
      const wp = tapPilot.waypoint;
      if (wp) {
        renderer.projectToScreen(wp, markerScreen);
        centerRect(waypointRect, markerScreen, TAP_MARKER_SIZE);
        reg.register(TAP_WAYPOINT_ID, TAP_MARKER_ANCHOR, waypointRect);
      }
      const locked = resolvePilotTarget();
      if (locked) {
        renderer.projectToScreen(locked.pos, markerScreen);
        centerRect(reticleRect, markerScreen, locked.radius * 2 + TAP_RETICLE_PAD);
        reg.register(TAP_RETICLE_ID, TAP_MARKER_ANCHOR, reticleRect);
      }
    }

    // Touch controls: anchored home rects from the same constants that draw them
    // (touch-visuals). All null on desktop, so nothing registers there.
    writeAffordanceRects(isTouch, fireMode, w, h, touchRects);
    if (touchRects.leftStickZone) reg.register('touch-left-stick', LEFT_STICK_ANCHOR, touchRects.leftStickZone);
    if (touchRects.aimZone) reg.register('touch-aim-stick', RIGHT_STICK_ANCHOR, touchRects.aimZone);
    if (touchRects.fireButton) reg.register('touch-fire-button', RIGHT_STICK_ANCHOR, touchRects.fireButton);

    // The open-build-wheel button — a permanent HUD fixture at your own station
    // (GDD §2.2, §2.4). Registered from the SAME `buildVisible`/`buildButtonRect`
    // that draw it, so the registry records what is really on screen: present
    // exactly while docked, and unaffected by opening the wheel or building —
    // which is the field-report bug made mechanically checkable. Null (and so
    // unregistered) off-touch and away from the station. Its id + anchor are the
    // UI's contract (`@ui` build-button.ts); see there for why the region is
    // `full` on a short landscape phone.
    const buildBtn = buildButtonRect(isTouch, buildVisible, w, h);
    if (buildBtn) reg.register(BUILD_BUTTON_ID, BUILD_BUTTON_ANCHOR, buildBtn);

    // Build badge: declared bottom-left, actual rect measured from the real text
    // metrics — so a font swap, or a server suffix appearing mid-session, that
    // pushes the stamp off-corner is caught by the placement check rather than by
    // squinting at a screenshot. Skipped when frozen, where the badge is hidden
    // (the registry records what is actually drawn, never what would have been).
    if (buildBadge.visible) reg.register(BADGE_ID, BADGE_ANCHOR, buildBadge.layoutBounds(w, h));

    // The ping stamp above it: same corner, same rule — registered only while a
    // measurement is actually on screen, so "it appears where it's supposed to"
    // is checked against the frames that really carry it.
    if (pingBadge.visible) reg.register(PING_BADGE_ID, PING_BADGE_ANCHOR, pingBadge.layoutBounds(w, h));

    // Re-enter-fullscreen affordance: declared top-right, actual rect measured
    // from the same corner math that draws it — so "no dead corners" (field
    // request v0.1.1) is a placement assertion, not a hope. Registered only while
    // it is actually on screen (the player has backed out of fullscreen).
    if (fsAffordance.visible) reg.register(FS_AFFORDANCE_ID, FS_AFFORDANCE_ANCHOR, fsAffordance.layoutBounds(w, h));

    // Pause menu (developer p10): the overlay (while up) and the touch corner
    // button (while the match owns the screen) register their own logical rects —
    // so QA's placement suite can arbitrate that the corner button lands "clear of
    // everything" and the overlay owns the frame. Self-computed logical bounds, so
    // no physical→logical conversion (like the ship and the build button).
    for (const e of pauseView.describeLayout({ width: w, height: h })) {
      reg.register(e.id, e.anchor, e.bounds);
    }

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

  /** True if any asteroid is within weapon reach of `pos` — the mine prompt's
   *  trigger (GDD §2.10). Plain loop; allocates nothing. */
  function nearAsteroid(pos: Vec2): boolean {
    for (const a of world.asteroids) {
      const dx = a.pos.x - pos.x;
      const dy = a.pos.y - pos.y;
      const reach = WEAPON_RANGE + a.radius;
      if (dx * dx + dy * dy <= reach * reach) return true;
    }
    return false;
  }

  /** Every muzzle flash to draw this frame — read from the sim's published combat
   *  state for EVERY turret, never from local fire input. `muzzleFlashes` walks the
   *  world and emits one record per turret firing this tick (GDD §2.6). This is the
   *  round-2 field fix: the old path handed the renderer only the local player's
   *  fire, so a rival turret spitting shots was invisible. Now each flash draws in
   *  its owner's colour (style-guide §3), ending at the same clamp-to-hit endpoint
   *  the sim publishes. (A ship's shots are pooled projectiles drawn from the shot
   *  pool since the v0.3 laser funeral, so they are not muzzle flashes.) The bounded
   *  `muzzleFlashes` array (≤ turrets, GDD §4.3) is the sim's blessed render helper;
   *  the MuzzleView mapping is pooled so it adds no per-frame allocation. */
  function currentMuzzles(): readonly MuzzleView[] {
    const flashes = muzzleFlashes(world);
    // Reflect the drawn set for the live-boot suite (?debug=1 only, else a no-op).
    if (combatDebug.enabled) combatDebug.update(flashes);
    if (flashes.length === 0) return EMPTY_MUZZLES;
    return fillMuzzleViews(flashes, world);
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
    endOverlay.resize(w, h, isTouch);
    pauseView.resize(w, h, isTouch);
    pauseSettings.resize(w, h, isTouch);
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
    // Control-scheme toggle: single key for day-1, mirroring the fire-mode key
    // (developer §3 puts the picker in settings — UI owns that screen; this is the
    // reachable-from-boot equivalent, persisted to the same seam the settings row
    // would use). Sticks ⇄ Tap Commander; clears any standing order on the switch
    // so the new scheme starts clean.
    if (e.code === 'KeyC') {
      controlScheme = controlScheme === 'tap' ? 'sticks' : 'tap';
      tapPilot.clear();
      platform.storage.set(CONTROL_SCHEME_KEY, controlScheme);
    }
    // Minimap toggle (field request v0.2.2): the `M` keyboard shortcut on PC, the
    // desktop convenience over the primary click/tap gesture — the same toggle the
    // corner tap runs, added to the input-parity table (docs/input-parity.md).
    if (e.code === MINIMAP_TOGGLE_KEY) {
      hud.toggleMinimap();
    }
    // ESC (field report v0.2.4 + developer p10): with a wheel up it pops one wheel
    // level — WEAPON → upgrade → Build → closed; otherwise it opens the pause
    // overlay, or backs it out one level (settings → menu → closed). One "go back"
    // gesture spanning the wheel and the pause menu. Never opens over the end
    // screen, which owns its own exits.
    if (e.code === 'Escape') {
      handlePauseKey();
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
  /** True for a turret record (field request v0.2.2), so the model draws a bar
   *  over the local player's own turrets too — a ship record leaves it false. */
  turret: boolean;
}

/** A mutable {@link Nameable} — the pooled records `feedNameplates()` overwrites
 *  in place each frame (field request v0.2.1), handed over as `Nameable`. */
interface MutNameable {
  owner: PlayerId;
  kind: 'ship' | 'station';
  alive: boolean;
  local: boolean;
  inCombat: boolean;
  hpFraction: number;
  pos: Vec2;
  radius: number;
}

/** A mutable {@link MinimapStation} — the pooled records `feedMinimap()` overwrites
 *  in place each frame (field request v0.2.2), handed over as `MinimapStation`. */
interface MutMinimapStation {
  owner: PlayerId;
  x: number;
  y: number;
  alive: boolean;
  /** Board id — indexes the fog remembered-mask (feature f1). */
  id: number;
}

/** A mutable {@link MinimapSatellite} — pooled radar-satellite records
 *  `feedMinimap()` overwrites in place each frame (feature f1). */
interface MutMinimapSatellite {
  owner: PlayerId;
  x: number;
  y: number;
  alive: boolean;
  local: boolean;
}

/** A mutable {@link MinimapCoverage} — pooled sensor-disc records `feedMinimap()`
 *  copies the sim's current {@link SensorSource} discs into (feature f1). */
interface MutMinimapCoverage {
  x: number;
  y: number;
  radius: number;
}

/** A mutable {@link MinimapShip} — the pooled records `feedMinimap()` overwrites in
 *  place each frame, handed over as `MinimapShip`. */
interface MutMinimapShip {
  owner: PlayerId;
  x: number;
  y: number;
  alive: boolean;
  local: boolean;
  spawnProtected: boolean;
}

/** A mutable {@link TapCandidate} — the pooled records the Tap Commander hit-test
 *  overwrites in place each tap, handed to `pickTapTarget` as `TapCandidate`. */
interface MutTapCandidate {
  kind: TargetKind;
  id: number;
  pos: Vec2;
  radius: number;
  hostile: boolean;
}

const EMPTY_MUZZLES: MuzzleView[] = [];

/** A mutable MuzzleView the pool owns and overwrites each frame — its fields are
 *  readonly only to the renderer (which treats a MuzzleView as a value). */
interface MutableMuzzleView {
  from: Vec2;
  to: Vec2;
  color: number;
  hit: Vec2 | null;
  width: number;
}

// A grow-once pool: one scratch MuzzleView per concurrent flash. Bounded by the
// sim's entity caps (≤ turrets), so after the busiest frame this never allocates
// again — the render hot path stays allocation-free (GDD §4.3b risk 5).
// `muzzleViewList` is the array handed to the renderer; its length is set to the
// live flash count.
const muzzleViewPool: MutableMuzzleView[] = [];
const muzzleViewList: MuzzleView[] = [];

/** Base muzzle-flare stroke width (world units) — the Mk I blast, and the width
 *  the renderer falls back to for an untiered flash. */
const MUZZLE_BASE_WIDTH = 3;
/** Extra flare width per DAMAGE tier — the muzzle scales with the shot it looses
 *  (RATIFIED p11-06): Mk I → 3, Mk II → 4.5, Mk III → 6, a fatter blast per rung. */
const MUZZLE_TIER_GAIN = 0.5;

/** The DAMAGE tier of the turret whose flash this is — matched by the origin the
 *  sim's `muzzleFlashes` aliases straight off `Turret.muzzle` (reference identity,
 *  so no float compare). A flash whose turret is somehow gone reads as Mk I. The
 *  walk is bounded by the turret cap (≤32, GDD §4.3), off the render hot path. */
function firingTurretTier(w: World, flash: MuzzleFlash): number {
  for (const station of w.stations) {
    for (const t of station.turrets) {
      if (t.muzzle && t.muzzle.origin === flash.origin) return turretTier(t);
    }
  }
  return 0;
}

/** Map every muzzle flash this tick into the pooled MuzzleView list the renderer
 *  draws. Endpoint `to` = origin + dir·length (the sim's clamp to what the shot is
 *  aimed at, or full range on a miss); colour is the owner's identity hue
 *  (style-guide §3), so each rival turret's flash reads in its own colour; the
 *  flare width scales with the firing turret's DAMAGE tier (p11-06), so a Mk III
 *  spits a fatter blast than a Mk I. */
function fillMuzzleViews(flashes: readonly MuzzleFlash[], w: World): readonly MuzzleView[] {
  const n = flashes.length;
  for (let i = 0; i < n; i++) {
    const m = flashes[i]!;
    let v = muzzleViewPool[i];
    if (!v) {
      v = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, color: 0x4dc3ff, hit: null, width: MUZZLE_BASE_WIDTH };
      muzzleViewPool[i] = v;
    }
    v.from = m.origin; // alias the sim's origin (read synchronously this frame)
    v.to.x = m.origin.x + m.dir.x * m.length;
    v.to.y = m.origin.y + m.dir.y * m.length;
    v.hit = m.hitPoint; // null on a clean miss → no impact glow
    v.color = PLAYER_COLORS[m.shooter % PLAYER_COLORS.length] ?? 0x4dc3ff;
    v.width = MUZZLE_BASE_WIDTH * (1 + firingTurretTier(w, m) * MUZZLE_TIER_GAIN);
    muzzleViewList[i] = v;
  }
  muzzleViewList.length = n; // reuse the objects; just retract the tail
  return muzzleViewList;
}

/** One staged muzzle flash as the live-boot suite reads it back: identity + the
 *  same clamped world-space geometry {@link fillMuzzleViews} draws from. */
interface StagedMuzzle {
  readonly shooter: number;
  readonly origin: { x: number; y: number };
  readonly end: { x: number; y: number };
  readonly hit: { x: number; y: number } | null;
}

/** What `__planetRush.stageCombat()` hands the test: the NON-LOCAL turret muzzle
 *  flash it staged (so the test can assert the client drew it), plus the non-local
 *  ship whose firing flag it set. */
export interface StagedCombat {
  readonly firingShip: number;
  readonly turret: StagedMuzzle;
}

const STAGE_MUZZLE_LEN = 90;

/** Debug-only (`?debug=1`) deterministic firefight, driven by the live-boot suite
 *  under `?freeze=1` so the sim never steps to clear it: set the firing flag on a
 *  non-local ship (an enemy trigger down) and publish a `muzzle` on a fresh turret
 *  owned by a non-local station (a rival turret firing) — the combat tells the
 *  round-2 field report found invisible. Since the v0.3 laser funeral a ship has no
 *  shot geometry to stage (its shots stream from the projectile pool), so only the
 *  turret contributes a muzzle flash. Returns what it staged so the test can assert
 *  the client put it on stage. Touches only render-tell fields the sim itself
 *  publishes each tick; it changes no sim logic and runs only behind the debug flag. */
function stageCombatFor(world: World): StagedCombat {
  // A non-local, living ship gets its firing flag set (the offline match seats the
  // local player + seven bots), so its id is provably not LOCAL_PLAYER.
  const botShip = world.ships.find((s) => s.id !== LOCAL_PLAYER && s.alive) ?? world.ships[0]!;
  botShip.firing = true;

  // A turret with a live muzzle, mounted on a non-local station so its owner is
  // non-local — a rival turret loosing a shot.
  const station = world.stations.find((p) => p.owner !== LOCAL_PLAYER) ?? world.stations[0]!;
  const muzzle: Muzzle = {
    origin: { x: station.pos.x, y: station.pos.y - station.radius - 12 },
    dir: { x: 0, y: -1 },
    hitPoint: { x: station.pos.x, y: station.pos.y - station.radius - 12 - STAGE_MUZZLE_LEN },
    length: STAGE_MUZZLE_LEN,
  };
  const turret: Turret = {
    id: world.nextEntityId++,
    owner: station.owner,
    slot: station.turrets.length,
    pos: { x: muzzle.origin.x, y: muzzle.origin.y },
    radius: 6,
    hp: 10,
    maxHp: 10,
    angle: -Math.PI / 2,
    cooldown: 0,
    targetId: null,
    muzzle,
  };
  station.turrets.push(turret);

  return {
    firingShip: botShip.id,
    turret: describeStaged(turret.owner, muzzle),
  };
}

function describeStaged(shooter: number, muzzle: Muzzle): StagedMuzzle {
  return {
    shooter,
    origin: { x: muzzle.origin.x, y: muzzle.origin.y },
    end: { x: muzzle.origin.x + muzzle.dir.x * muzzle.length, y: muzzle.origin.y + muzzle.dir.y * muzzle.length },
    hit: muzzle.hitPoint ? { x: muzzle.hitPoint.x, y: muzzle.hitPoint.y } : null,
  };
}

/** A control state carries a real intent this frame — used to pick the active
 *  device for the HUD. Mouse aim is excluded: it moves constantly and would peg
 *  the device to keyboard forever (GDD §2.4 auto device-switch). */
function controlActive(s: ControlState): boolean {
  return s.thrust.x !== 0 || s.thrust.y !== 0 || s.fire || s.build;
}

/** Hoisted local-ship predicate so the per-frame lookup allocates no closure. */
function isLocalShip(s: { id: number }): boolean {
  return s.id === LOCAL_PLAYER;
}

/** Whether a point is inside a screen rect (CSS px). */
function inRect(p: Vec2, r: { x: number; y: number; width: number; height: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Write a `size`×`size` rect centred on `c` into `out` (zero-alloc). */
function centerRect(out: Rect, c: Vec2, size: number): Rect {
  out.x = c.x - size / 2;
  out.y = c.y - size / 2;
  out.width = size;
  out.height = size;
  return out;
}

/** Shield HP at full over a station's core — 0 with no generator built, so the
 *  HUD's shield overbar appears the frame the first one finishes (GDD §2.5).
 *  The sim publishes the *current* pool (`shieldPool`); this is its ceiling. */
function shieldPoolMax(station: MiningStation): number {
  let hp = 0;
  for (const s of station.shields) hp += s.maxHp;
  return hp;
}

/** Summed HP of a station's live turrets — the third term in the alarm's
 *  "your station is being hurt" signal (GDD §2.2). */
function turretPool(station: MiningStation): number {
  let hp = 0;
  for (const t of station.turrets) hp += t.hp;
  return hp;
}

/** Read the persisted fire mode, falling back to the platform default (§2.4). */
function readFireMode(platform: ReturnType<typeof createBrowserPlatform>, isTouch: boolean): FireMode {
  const stored = platform.storage.get(FIRE_MODE_KEY);
  if (stored === FireMode.Manual || stored === FireMode.AutoAim) return stored;
  return defaultFireMode(isTouch);
}

/** Read the persisted control scheme (developer §3). Anything other than the
 *  explicit `'tap'` — an absent key, a stale value — folds to `'sticks'`, so the
 *  existing schemes stay the untouched default and a bad key can never seat an
 *  unknown scheme. Read through the same platform seam as the fire mode. */
function readControlScheme(platform: ReturnType<typeof createBrowserPlatform>): ControlScheme {
  return platform.storage.get(CONTROL_SCHEME_KEY) === 'tap' ? 'tap' : 'sticks';
}

/** The hull to pre-select in the lobby: the last one this player chose, or the
 *  Vanguard default the first time out (GDD §2.11 — "the pre-selected default so
 *  onboarding never blocks on the choice", plus "persist last choice"). Validated
 *  against the enum so a stale or hand-edited storage value can never seat a hull
 *  the sim does not know. Read through the same platform seam as the fire mode. */
function readShipClass(platform: ReturnType<typeof createBrowserPlatform>): ShipClass {
  const stored = platform.storage.get(SHIP_CLASS_KEY);
  if (stored !== null && (Object.values(ShipClass) as string[]).includes(stored)) {
    return stored as ShipClass;
  }
  return DEFAULT_SHIP_CLASS;
}

/** The local player's name to pre-fill the lobby with: the last one they set, or
 *  {@link DEFAULT_PLAYER_NAME} ("YOU") the first time out (field request v0.2.1 —
 *  "persisted like ship class, default YOU"). Folded through `normalizePlayerName`
 *  so a stale/over-long stored value is always a safe nameplate. */
function readPlayerName(platform: ReturnType<typeof createBrowserPlatform>): string {
  return normalizePlayerName(platform.storage.get(PLAYER_NAME_KEY) ?? undefined);
}

/** The arena the player last picked on the PLAY screen (m8-02), read through the
 *  same platform storage seam as the hull and the fire mode so all three survive a
 *  reload identically. `normalizeMapId` folds a stale or hand-edited value down to
 *  the default (`octagon`), so a bad key can never reach the sim. */
function readMapId(platform: ReturnType<typeof createBrowserPlatform>): string {
  return normalizeMapId(platform.storage.get(MAP_STORAGE_KEY));
}

/** The match MODE the lobby opens on (variable-slots Milestone E): the last one
 *  the host chose, or FFA the first time out. Anything but the known TEAMS value
 *  folds to FFA, so a stale key is always a legal mode. */
function readMatchMode(platform: ReturnType<typeof createBrowserPlatform>): MatchMode {
  return platform.storage.get(MATCH_MODE_KEY) === 'teams' ? 'teams' : 'ffa';
}

/** The ore ABUNDANCE the lobby opens on (ratified p11): the last one the host
 *  chose, or the ratified SCARCE default ("by default more scarce"). Anything but
 *  the two richer levels folds to SCARCE. */
function readAbundance(platform: ReturnType<typeof createBrowserPlatform>): Abundance {
  const stored = platform.storage.get(ABUNDANCE_KEY);
  return stored === 'standard' || stored === 'rich' ? stored : 'scarce';
}

/** The match SIZE the lobby opens on (variable-slots Milestone E): the last count
 *  the host RUSHed with, folded into 2..8, or `undefined` (every seat open — the
 *  eight-player game) when unset or stale. */
function readMatchSize(platform: ReturnType<typeof createBrowserPlatform>): number | undefined {
  const stored = Number(platform.storage.get(MATCH_SIZE_KEY));
  if (!Number.isFinite(stored)) return undefined;
  const n = Math.floor(stored);
  return n >= MIN_MATCH_SIZE && n <= MAX_MATCH_SIZE ? n : undefined;
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
  dst.build = dst.build || src.build;
}

/**
 * How the front door hands `boot()` the go-ahead — and *which* game to run.
 *
 *  - `offline` — PLAY SOLO: `boot()` opens the lobby offline and builds the
 *    `LocalLoopback` match at RUSH!, the shipping product (and the default when
 *    there is no menu at all, under `?debug=1`).
 *  - `online` — a CREATE / JOIN that reached the allocator and opened a real socket
 *    (`createOnlineSession`, the proven client-sim the integration tests drive),
 *    **welcomed into a seat**. The match has *not* started: the handoff is now the
 *    server's `welcome`, not its `matchStart`, because the ratified flow puts the
 *    SAME lobby between them — the host configures the room with the code up, the
 *    joiners fill the open seats, and only then does RUSH! start the match. `boot()`
 *    opens that lobby and renders the session's predicted world through the same
 *    loop afterwards, feeding `sendInput` in place of the offline clock (GDD §4.2).
 */
type LaunchPlan =
  | { readonly kind: 'offline' }
  | {
      readonly kind: 'online';
      readonly session: OnlineSession;
      /** The room the allocator minted / the joiner typed — used verbatim (M3). */
      readonly room: RoomCode;
      /** The seat the server welcomed this client into. */
      readonly you: PlayerId;
      /** True when THIS client created the room: the lobby's host, who holds the
       *  slot editor and RUSH! (GDD §4.2 — "host is a lobby word"). */
      readonly host: boolean;
    };

/** The slice of `MatchBoot` the render/input loop actually consumes — so an
 *  online match can present the same shape without a `LocalLoopback` or a bot
 *  cast behind it. `bootOfflineMatch` returns a superset; the online adapter
 *  ({@link onlineMatchAdapter}) returns exactly this. */
type ClientMatch = Pick<MatchBoot, 'world' | 'bots' | 'tick' | 'close'>;

/**
 * Present an open {@link OnlineSession} as a {@link ClientMatch}. The predicted
 * world is already built (the caller waited for `matchStart`), and it is a stable
 * object mutated in place by prediction + reconciliation (`src/net/prediction`),
 * so the loop can capture `world` once. `tick` is just `sendInput`: online the
 * client files its input and the predictor advances the same world offline steps
 * locally — there is no bot cast to file for (the server owns them).
 */
function onlineMatchAdapter(session: OnlineSession): ClientMatch {
  const world = session.world;
  if (!world) throw new Error('online session handed off with no world');
  return {
    world,
    bots: [],
    tick: (localActions): void => session.sendInput(localActions),
    close: (): void => session.close(),
  };
}

/** What `boot()` holds the main menu by: a promise that resolves when the player
 *  has chosen how they are getting in, and a one-shot `matchStarted()` the boot path
 *  calls once the world is actually built (it flips the live-stage test seam). */
interface MainMenuHandle {
  /** Resolves the moment a door resolves: PLAY SOLO (offline) or a CREATE / JOIN
   *  the server has welcomed us into (online). `boot()` opens the LOBBY next in
   *  both cases and builds the world only after RUSH!; the {@link LaunchPlan} tells
   *  it which flavour of lobby to open. */
  untilPlay(): Promise<LaunchPlan>;
  /** Mark the world as built (drives `window.__mainMenu.matchStarted`). */
  matchStarted(): void;
  /** Wire the seam's live match readback (`localShipPos` / `matchControlScheme`)
   *  to the running world, so a clean-boot live-stage run can prove the CONTROLS
   *  setting it flipped through the front door actually drives the ship — a tap
   *  moves it — without any `?debug=1` seam. Reads live bindings each call, so a
   *  rematch that rebuilds the world is tracked with no re-bind. */
  bindMatch(read: () => { scheme: ControlScheme; shipPos: { x: number; y: number } | null }): void;
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

/** One settings-screen row (or DONE) as the seam reports it: its kind and the
 *  physical point a real click/tap must land on to hit it. Lets a live-stage run
 *  drive the settings screen through the front door — no `settingsHitTest` seam,
 *  just a real press at `physicalCenter` — the discipline the CONTROLS-switch
 *  evidence was missing (it flipped the scheme through a debug seam, not a tap). */
interface SettingsControlReport {
  readonly kind: string;
  readonly physicalCenter: { x: number; y: number };
}

/** One CODEX control as the seam reports it: BACK, a tab, or a (visible) entry
 *  row, with the index the model routes on and the physical press point. Lets a
 *  live-stage run drive the codex through the front door on both form factors. */
interface CodexControlReport {
  readonly kind: 'back' | 'tab' | 'entry';
  readonly index: number;
  readonly physicalCenter: { x: number; y: number };
}

/** The read-only `window.__mainMenu` seam, extended for the landscape lock. */
interface MainMenuSeam {
  visible: boolean;
  screen: 'menu' | 'settings' | 'codex' | 'online';
  matchStarted: boolean;
  /** The LOGICAL (landscape) viewport the menu laid out against. */
  logicalViewport: { width: number; height: number };
  /** Whether the game root is rotated (portrait phone under the landscape lock). */
  rotated: boolean;
  /** The menu buttons, logical rect + physical tap point (see {@link MenuControlReport}). */
  controls: readonly MenuControlReport[];
  /** The settings-screen rows + DONE, each with the physical point a real press
   *  must land on — the same landscape-lock remap the menu buttons get. */
  settingsControls: readonly SettingsControlReport[];
  /** The CODEX controls (BACK, the four tabs, the visible entry rows), each with
   *  the physical press point — the front-door handles a live-stage run drives the
   *  reference screen through, on both form factors. */
  codexControls: readonly CodexControlReport[];
  /** The codex's active tab id and selected entry title — plain readback proof a
   *  press on a tab / entry took effect (no hit-test seam). */
  codexTab: string;
  codexEntry: string;
  /** The control scheme the settings screen currently shows and persists — the
   *  menu's live value, written to the same storage the match reads at boot.
   *  Readback proof that a tap on the CONTROLS row took effect immediately. */
  controlScheme: ControlScheme;
  /** The scheme the RUNNING match is driving with, once built (null before) — the
   *  live match value, read through `bindMatch`. Proves the front-door setting
   *  carried across PLAY → lobby → RUSH into the sim. */
  matchControlScheme: ControlScheme | null;
  /** The local ship's live WORLD position in the running match, or null before
   *  the world exists. Lets a clean-boot run watch a real tap move the ship. */
  localShipPos: { x: number; y: number } | null;
  /** PLAY — opens THE DOORS (ratified: one play flow). It no longer starts a
   *  match: PLAY SOLO / CREATE ROOM / JOIN ROOM are what do, and all three go
   *  through the lobby ({@link LobbySeam}). */
  play(): void;
  /** The same screen, under its old name — kept because PLAY *is* the doors now, so
   *  a caller that asked for either gets one screen. */
  online(): void;
}

/**
 * The read-only `window.__onlineMenu` seam. Lets the live-stage suite drive THE
 * DOORS — PLAY SOLO / CREATE / JOIN, the code keypad, and the three distinct
 * refusals — the same way `__mainMenu` drives PLAY and `__lobby` drives the
 * roster, without pixel math. Present only while the menu is up (clean boot).
 */
interface OnlineSeam {
  /** True while the doors screen owns the display. */
  visible: boolean;
  /** `home` (the CREATE / JOIN doors) or `join` (the code keypad). */
  screen: EntryState['screen'];
  /** `idle` / `connecting` / `error` — the front door's own status. */
  status: EntryState['status'];
  /** The refusal line, in the player's words, or `''`. */
  error: string;
  /**
   * The screen's TITLE, exactly as drawn: the standing line (`MINE · DEFEND ·
   * ATTACK`, `ENTER THE ROOM CODE`) when nothing is connecting, and the live
   * connect narration when something is — `ALLOCATING ROOM…`, `ROOM Q5RN · TICKET
   * SIGNED`, `DIALING MACHINE 0800d5b6…`, `JOINED · SEAT 2`, or the exact refusal.
   *
   * The title is Pixi text, so this is how a live-stage run reads it (M10 status-in-
   * title, brief §3: the title must be seen to ADVANCE on a real connect).
   */
  title: string;
  /** The code typed so far on the join screen. */
  code: string;
  /** Whether the region picker draws — `false` at one region (launch). */
  regionPickerVisible: boolean;
  /** The globally-unique code the allocator minted on a successful CREATE, or
   *  `null`. Never client-guessed (M3 — use `assignment.code` verbatim). */
  resolvedCode: string | null;
  /** The three doors and BACK, each with the physical point a real press must land
   *  on (through the landscape-lock remap) — the front-door handles a live-stage run
   *  drives the ratified flow through with real input on both form factors, rather
   *  than by calling the seam methods below. */
  doorControls: readonly { kind: string; physicalCenter: { x: number; y: number } }[];
  open(): void;
  /** PLAY SOLO — the offline door. Needs no server, and lands in the same lobby the
   *  online doors do (ratified: one lobby, both modes). */
  solo(): void;
  create(): void;
  join(): void;
  typeCode(ch: string): void;
  erase(): void;
  submit(): void;
  back(): void;
}

/**
 * The main menu (field report P1; GDD §4.6 M7). Shown on a clean boot only —
 * `boot()` skips it under `?debug=1`, which drops straight into a match so the
 * live / live-stage / mobile harnesses keep the world they assert against.
 *
 * **PLAY opens the doors, and nothing else** (ratified: one play flow — "PLAY →
 * goes to the same online menu (which already has offline play)… right now PLAY
 * going to a separate offline lobby is just redundant"). There used to be two front
 * doors here — PLAY, which dropped straight into an offline lobby, and ONLINE,
 * whose screen already carried PLAY SOLO. The second one is gone: PLAY opens
 * {@link LobbyEntryView} and the three doors on it — SOLO offline, CREATE and JOIN
 * online — each resolve `untilPlay()` so `boot()` can open the ONE lobby.
 *
 * No world is built here on any path: `untilPlay()` resolves, `boot()` opens the
 * lobby, and the world is built at RUSH! (offline) or on the server's `matchStart`
 * (online). SETTINGS reuses the Day-7 settings screen ({@link SettingsView}); a
 * fire-mode change is persisted to the same key `readFireMode` reads when the match
 * boots, so the choice carries into the game.
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
  // The control scheme (developer §3), read from the same storage the match boots
  // with. The CONTROLS settings row shows and toggles it here, persisting to that
  // seam so the choice carries into the match exactly as the fire mode does.
  let controlScheme = readControlScheme(platform);
  let settings: SettingsState = createSettings();
  // `online` is the DOORS screen's id — the screen PLAY now opens. Kept under its
  // old name because the `__mainMenu.screen` seam and every live-stage spec already
  // read that string, and renaming a wire-visible id buys nothing.
  let screen: 'menu' | 'settings' | 'codex' | 'online' = 'menu';
  let played = false;
  // The doors' own state. `entry` is the SOLO/CREATE/JOIN model; `onlineResolved`
  // holds the allocator's minted code once a CREATE succeeds (never client-guessed
  // — M3 rule). One region at launch, so the picker stays suppressed by config
  // (`regionPickerVisible === false`).
  let entry: EntryState = createEntry();
  let onlineResolved: string | null = null;
  const onlineRegions: readonly RegionInfo[] = [{ id: 'iad', label: 'US East' }];
  // A room code the entry model needs for an offline-loopback create; discarded
  // for online (the allocator mints the real one). Seeded, never `Math.random()`.
  const onlineRng = mulberry32(0x51ac37);
  // Bound by boot() once the match world exists — lets the seam read the live
  // ship + active scheme so a clean-boot run can watch the front-door setting fly
  // the ship. Reads live bindings each call, so a rematch needs no re-bind.
  let matchReader: (() => { scheme: ControlScheme; shipPos: { x: number; y: number } | null }) | null = null;

  // Lay the menu out in the LOGICAL (landscape) viewport and hang it off the
  // rotating game root — so a portrait phone gets a landscape menu that can never
  // strand itself off-screen (the field-report bug), and re-layouts on every flip.
  const menu0 = ctx.logicalSize();
  const menuView = new MainMenuView(menu0.w, menu0.h, isTouch);
  const settingsView = new SettingsView(menu0.w, menu0.h, isTouch);
  // The CODEX reference (GDD §2.10) — the shared parsed content handed to the pure
  // model as a value (the ./ui/codex seam). Opened from the menu, never a gate: it
  // builds no world, and BACK returns to the menu.
  let codexState: CodexState = createCodex(CODEX_DATA);
  const codexView = new CodexView(menu0.w, menu0.h, isTouch);
  // The ONLINE front door reuses the built-and-tested room-code screen
  // (`./ui/lobby-entry`) — CREATE / JOIN doors, the ambiguity-free keypad, the
  // refusal line. Un-hidden by the ONLINE button (the "un-hide it" the M3 brief
  // names); hidden until then.
  const entryView = new LobbyEntryView(menu0.w, menu0.h, isTouch);
  // Drag-to-scroll tracking for the codex (touch); a tap fires on pointer-up only
  // if the finger did not travel far enough to be a scroll.
  let codexDrag:
    | { startX: number; startY: number; lastX: number; lastY: number; moved: boolean; overRail: boolean }
    | null = null;
  ctx.root.addChild(menuView, settingsView, codexView, entryView);

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
    settingsControls: [],
    codexControls: [],
    codexTab: codexState.activeTab,
    codexEntry: activeEntries(codexState).find((e) => e.id === codexState.selectedId)?.title ?? '',
    controlScheme,
    // Live match readback, wired by boot() through `bindMatch` once the world is
    // built; both read the live match binding each access so a rematch is tracked.
    get matchControlScheme(): ControlScheme | null {
      return matchReader ? matchReader().scheme : null;
    },
    get localShipPos(): { x: number; y: number } | null {
      return matchReader ? matchReader().shipPos : null;
    },
    // PLAY opens the doors — the one way in (ratified). `online()` is the same
    // screen under its old name, so a caller that asked for either gets one screen.
    play: (): void => openDoors(),
    online: (): void => openDoors(),
  };

  // The doors' own read-only seam. Its methods drive the same pure transitions a tap
  // would, so the live-stage suite can walk SOLO / CREATE / JOIN / a refusal without
  // pixel math (tests/live-stage/online-flow.spec.ts) — and `doorControls` gives it
  // the physical points to do the same walk with REAL presses.
  const onlineSeam: OnlineSeam = {
    visible: false,
    screen: 'home',
    status: 'idle',
    error: '',
    title: '',
    code: '',
    regionPickerVisible: regionPickerVisible(onlineRegions),
    resolvedCode: null,
    doorControls: [],
    open: (): void => openDoors(),
    solo: (): void => chooseEntryDoor('solo'),
    create: (): void => chooseEntryDoor('create'),
    join: (): void => chooseEntryDoor('join'),
    typeCode: (ch: string): void => applyEntryTarget({ kind: 'key', index: KEYPAD_KEYS.indexOf(ch) }),
    erase: (): void => applyEntryTarget({ kind: 'erase' }),
    submit: (): void => applyEntryTarget({ kind: 'submit' }),
    back: (): void => applyEntryTarget({ kind: 'back' }),
  };

  let resolvePlay: (plan: LaunchPlan) => void = () => {};
  const playPromise = new Promise<LaunchPlan>((resolve) => {
    resolvePlay = resolve;
  });

  // --- The live online connection (M10 client match socket) -----------------
  // Opened by a successful CREATE / JOIN (`startResolve`), held here until the
  // server WELCOMES this client into a seat and `boot()` takes it over to open the
  // lobby (`beginRoom`). Null on the offline path, which never enters this file's
  // socket code at all.
  let onlineSession: OnlineSession | null = null;
  // True when THIS client created the room: the lobby's host, who holds the slot
  // editor and RUSH! (the server enforces the start too — `server/room.ts`
  // `startMatch`).
  let onlineHost = false;
  // One-shot latch so a duplicate `welcome` (a reconnect replays it) never hands
  // off twice. This is the handoff the unified play flow uses: the lobby now sits
  // between the room and the match, so a room is ENTERED on `welcome`.
  let roomEntered = false;
  // The session's playtest-log attachment and its poll timer (`startSessionLog`).
  // Deliberately NOT torn down by `teardown()`: the connection outlives the menu, and
  // a drop after the handoff is exactly the moment a report needs recorded.
  let onlineLogHandle: SessionLogHandle | null = null;
  let onlineLogTimer: ReturnType<typeof setInterval> | null = null;
  // The session log (`src/net/playtest-log`), installed by `boot()`. The front door
  // writes the connection lifecycle into it: allocate → ticket → dial.
  const playtest = playtestLog();
  // The last front-door state written to the log, so `logEntryStatus` records one line
  // per change rather than one per render.
  let loggedEntryState = '';

  // --- The verbose connecting screen (M10) ----------------------------------
  // `CONNECTING…` covered five separate things that can each fail on their own, so
  // when one of them broke the screen had one word to say about it. `connectTrace`
  // is the live story — allocate → ticket → dial → hand-off → seat, or the exact
  // refusal — drawn by the panel below and written into the session log step for
  // step (`src/net/connect-trace`). Null when no attempt is in flight.
  let connectTrace: ConnectTrace | null = null;
  // What RETRY re-runs: a *fresh* allocate through the same door, never a redial of
  // a ticket that already lost its coin flip.
  let retryDoor: { door: 'create' | 'join'; room: string } | null = null;
  // Drives the panel while nothing is happening, which is exactly when it matters:
  // a stall is only visible if something keeps looking at the clock (STALL_MS).
  let connectTraceTimer: ReturnType<typeof setInterval> | null = null;
  // The transport state last folded into the trace, so a poll records one step per
  // change rather than one per tick.
  let tracedTransportState = '';
  // The last step written to the session log, by identity — see `traceStep`. An
  // advance that adds no line (the socket opening) must not re-log the line it
  // left standing.
  let lastTracedStep: ConnectStep | null = null;
  installConnectTraceView({
    dom: document,
    onRetry: () => {
      if (retryDoor) void startResolve(retryDoor.door, retryDoor.room);
    },
    onCopyLog: () => void copyLogButton()?.copy(),
    // The DOWNLOAD sibling (ratified M10): a FILE, never a 40 KB clipboard paste.
    onDownloadLog: () => void copyLogButton()?.download(),
  });

  /**
   * Take one step of the connection's story: keep it, draw it, and write it to the
   * session log — in that order, and in one place, so the screen and the pasted log
   * can never disagree about what happened or when (m10-09b `connect` channel).
   *
   * Not every advance is a step. A socket that opens moves the stall clock without
   * adding a line (`connectProgress`), and the trace is immutable, so "is this a new
   * line?" is an identity check against the last one logged — no line, no log entry,
   * and the export does not gain a `dialing` it already has.
   */
  function traceStep(next: ConnectTrace): void {
    const step = next.steps[next.steps.length - 1];
    connectTrace = next;
    if (step && step !== lastTracedStep) {
      lastTracedStep = step;
      const entry = connectTraceLogEntry(step);
      playtest.recordConnect(entry.step, entry.data);
    }
    showConnectTrace(next, Date.now());
    // The step is the screen's TITLE now, not a panel of its own, so a step is not
    // taken until the entry screen has been re-drawn with it.
    render();
    startTraceTicker();
  }

  /**
   * The connection's story, in the shape the entry screen's title takes
   * (`./ui/lobby-entry` `entryModel(state, narration)`).
   *
   * `null` when nothing is connecting — which is when the title goes back to being
   * the screen's own line — and `null` for PLAY SOLO, which opens no socket and so
   * has no story: the offline door keeps the plain `CONNECTING…` it always had, for
   * the fraction of a second it is up.
   */
  function connectNarration(): EntryNarration | null {
    if (!connectTrace) return null;
    const model = connectTraceModel(connectTrace, Date.now());
    return { line: connectTitleLine(model), failed: connectTitleFailed(model) };
  }

  /** Keep the panel's clock running while an attempt is live, so a stall crosses
   *  STALL_MS on its own and auto-offers COPY LOG with nothing else happening. */
  function startTraceTicker(): void {
    if (connectTraceTimer !== null) return;
    connectTraceTimer = setInterval(() => {
      const trace = connectTrace;
      if (!trace) {
        stopTraceTicker();
        return;
      }
      pollTransportForTrace();
      showConnectTrace(connectTrace ?? trace, Date.now());
      // The title carries the stall's seconds (`connectTitleLine`), so the screen
      // is re-drawn on the tick as well — a clock nobody re-draws is a frozen one.
      render();
      // A stall crosses STALL_MS with nothing else happening, so the corner
      // affordance has to be re-decided here too rather than only on a render.
      syncCopyLog();
    }, SESSION_LOG_POLL_MS);
  }

  function stopTraceTicker(): void {
    if (connectTraceTimer !== null) clearInterval(connectTraceTimer);
    connectTraceTimer = null;
  }

  /**
   * Fold the transport's own state into the trace. Polled rather than subscribed
   * because `Transport.onStateChange` already belongs to the session, and a second
   * subscriber would be a second thing to keep in sync; a state is a scalar and a
   * quarter-second is well inside human time.
   */
  function pollTransportForTrace(): void {
    const session = onlineSession;
    const trace = connectTrace;
    if (!session || !trace) return;
    if (session.state === tracedTransportState) return;
    tracedTransportState = session.state;
    const next = connectTransportState(trace, session.state, Date.now(), session.closeReason);
    if (next !== trace) traceStep(next);
  }

  /**
   * The attempt is over: stop the clock, drop the story and take the affordances
   * down. The steps stay in the session log either way.
   *
   * This used to keep the panel up for a beat past a seat so "JOINED · SEAT 2"
   * could be read over the lobby it had just opened. There is no panel to keep up
   * any more — the seat is announced in the title of the screen that is *being*
   * replaced, and the lobby appearing is itself the confirmation — so the linger
   * went with it rather than becoming a timer that outlives an empty surface.
   */
  function endConnectTrace(): void {
    connectTrace = null;
    retryDoor = null;
    tracedTransportState = '';
    lastTracedStep = null;
    stopTraceTicker();
    hideConnectTrace();
  }

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
    // The settings-screen rows + DONE, in the same landscape-lock physical space,
    // so a live-stage run can real-press the CONTROLS row through the front door.
    const settingsRects = settingsLayout({ width: w, height: h }, { isTouch });
    const rowReports = settingsRects.rows.map((r, i) => ({
      kind: SETTINGS_ROWS[i]?.kind ?? 'row',
      physicalCenter: ctx.toPhysical(r.x + r.width / 2, r.y + r.height / 2),
    }));
    const back = settingsRects.back;
    seam.settingsControls = [
      ...rowReports,
      { kind: 'back', physicalCenter: ctx.toPhysical(back.x + back.width / 2, back.y + back.height / 2) },
    ];

    // The CODEX controls: BACK, the four tabs, and the entry rows that are wholly
    // inside the rail viewport at rest (a scrolled-off row has no honest press
    // point). Physical points, so a real click/tap lands on the drawn control.
    const codexRects = codexLayout({ width: w, height: h }, activeEntries(codexState).length, { isTouch });
    const physCenter = (r: Rect): { x: number; y: number } =>
      ctx.toPhysical(r.x + r.width / 2, r.y + r.height / 2);
    const codexControls: CodexControlReport[] = [
      { kind: 'back', index: -1, physicalCenter: physCenter(codexRects.back) },
      ...codexRects.tabs.map((r, i) => ({ kind: 'tab' as const, index: i, physicalCenter: physCenter(r) })),
    ];
    const railBottom = codexRects.rail.y + codexRects.rail.height;
    codexRects.railEntries.forEach((r, i) => {
      if (r.y + r.height <= railBottom + 0.5) {
        codexControls.push({ kind: 'entry', index: i, physicalCenter: physCenter(r) });
      }
    });
    seam.codexControls = codexControls;
    seam.codexTab = codexState.activeTab;
    seam.codexEntry = activeEntries(codexState).find((e) => e.id === codexState.selectedId)?.title ?? '';

    seam.controlScheme = controlScheme;
  }

  /** Redraw the live screen from current state. Static content, so this runs on
   *  a state change or a resize — Pixi's own ticker keeps painting between. */
  function render(): void {
    menuView.visible = screen === 'menu';
    settingsView.visible = screen === 'settings';
    codexView.visible = screen === 'codex';
    entryView.visible = screen === 'online';
    if (menuView.visible) menuView.update(mainMenuModel());
    if (settingsView.visible) settingsView.update(settingsModel(settings, fireMode, controlScheme));
    if (codexView.visible) codexView.update(codexModel(codexState));
    if (entryView.visible) entryView.update(entryModel(entry, connectNarration()));
    seam.screen = screen;
    updateOnlineSeam();
    logEntryStatus();
    syncCopyLog();
    updateSeamLayout();
  }

  // --- The ONLINE front door (M3/online step 3) ----------------------------

  /** Mirror the entry model onto the `__onlineMenu` seam after every change, plus
   *  the physical press points of whatever the entry screen is actually DRAWING
   *  (through the landscape-lock remap the menu buttons get), so a live-stage run
   *  can press its way in for real.
   *
   *  The reported set follows the screen, because a control reported at a point
   *  nobody drew is exactly the class of bug this suite exists to catch: the doors
   *  on `home`, the keypad + ERASE + JOIN on `join`, and BACK on both (it is the
   *  one control that never moves between them). */
  function updateOnlineSeam(): void {
    onlineSeam.visible = screen === 'online';
    onlineSeam.screen = entry.screen;
    onlineSeam.status = entry.status;
    onlineSeam.error = entry.error;
    // Read off the same model the view draws, never re-derived — a seam that
    // computes its own answer can agree with a screen that says something else.
    onlineSeam.title = entryModel(entry, connectNarration()).prompt;
    onlineSeam.code = entry.code;
    onlineSeam.resolvedCode = onlineResolved;
    const { w, h } = ctx.logicalSize();
    const layout = entryLayout({ width: w, height: h }, { isTouch });
    const point = (r: Rect): { x: number; y: number } =>
      ctx.toPhysical(r.x + r.width / 2, r.y + r.height / 2);
    const front =
      entry.screen === 'join'
        ? [
            // The pad, in `KEYPAD_KEYS` order — `key:A`, `key:B`, … so a test types a
            // room code by pressing the very keys a player's thumb finds.
            ...KEYPAD_KEYS.map((ch, i) => ({
              kind: `key:${ch}`,
              physicalCenter: point(layout.keys[i] ?? { x: 0, y: 0, width: 0, height: 0 }),
            })),
            { kind: 'erase', physicalCenter: point(layout.erase) },
            { kind: 'submit', physicalCenter: point(layout.submit) },
          ]
        : DOOR_OPTIONS.map((option, i) => ({
            kind: option.door,
            physicalCenter: point(layout.doors[i] ?? { x: 0, y: 0, width: 0, height: 0 }),
          }));
    onlineSeam.doorControls = [...front, { kind: 'back', physicalCenter: point(layout.back) }];
  }

  /** Open THE DOORS — what PLAY does now (ratified: one play flow), and the only
   *  screen a match is entered from. */
  function openDoors(): void {
    if (played) return;
    screen = 'online';
    entry = createEntry();
    onlineResolved = null;
    // A fresh visit starts a fresh story; a panel left over from a previous
    // refusal must not sit under a door the player has not tapped yet.
    endConnectTrace();
    render();
  }

  /** Back out of the doors to the main menu. */
  function closeDoors(): void {
    screen = 'menu';
    entry = createEntry();
    endConnectTrace();
    render();
  }

  /** Tap (or seam-drive) a door. SOLO needs no server, so it resolves straight
   *  away and `boot()` opens the lobby offline; CREATE / JOIN go through the
   *  allocator and open the same lobby online once the room welcomes us. */
  function chooseEntryDoor(door: EntryDoor): void {
    if (door === 'solo') {
      endConnectTrace();
      beginSolo();
      return;
    }
    const result = chooseDoor(entry, door, onlineRng);
    entry = result.state;
    render();
    if (result.intent) void startResolve(door, result.intent.room);
  }

  /** Route an entry-screen target — the same targets a real tap produces. */
  function applyEntryTarget(target: EntryTarget): void {
    switch (target.kind) {
      case 'door': {
        const door = DOOR_ORDER[target.index];
        if (door) chooseEntryDoor(door);
        return;
      }
      case 'key': {
        const key = KEYPAD_KEYS[target.index];
        if (key !== undefined) {
          entry = typeEntryCode(entry, key);
          render();
        }
        return;
      }
      case 'erase':
        entry = eraseEntryCode(entry);
        render();
        return;
      case 'back':
        // From the keypad, back to the doors; from the doors, back to the menu.
        if (entry.screen === 'join') {
          entry = backToDoors(entry).state;
          endConnectTrace();
          render();
        } else {
          closeDoors();
        }
        return;
      case 'submit': {
        const result = submitJoin(entry);
        entry = result.state;
        render();
        if (result.intent) void startResolve('join', result.intent.room);
        return;
      }
      case 'settings':
        openSettings();
        return;
    }
  }

  /**
   * Turn a CREATE / JOIN into an allocator round trip, and its answer into the
   * right words. On a *successful* resolve the code is recorded and the real match
   * socket opens (`connectMatch`) — the front door finally dialling (M10). Every
   * *refusal* is fully wired: the three failures the allocator distinguishes become
   * three different messages, and with no allocator configured (the shipped offline
   * build) the honest answer is the graceful "can't reach the servers".
   */
  async function startResolve(door: 'create' | 'join', room: string): Promise<void> {
    const base = allocatorUrlFromEnv();
    // RETRY means *this* door again, from the allocate — recorded before the first
    // thing that can fail, so a refusal always has something to offer.
    retryDoor = { door, room };
    // The screen goes back to CONNECTING for a retry, or the panel would sit on the
    // old refusal while a fresh attempt ran behind it.
    entry = { ...entry, status: 'connecting', error: '' };
    if (base === null) {
      // No allocator wired (local dev, the offline build): never reached, so this
      // is a network failure, and it names the door that still works (PLAY SOLO).
      playtest.recordConnect('no allocator configured', { door });
      traceStep(connectFailed(beginConnect(door, Date.now()), 'no allocator configured', Date.now()));
      failOnline('network');
      return;
    }
    const config = { baseUrl: base };
    // The region the player CHOSE, and only that. At launch there is one region in
    // the list and the picker is suppressed (`regionPickerVisible === false`), so
    // nobody has chosen anything — and sending `iad` anyway is what pinned every
    // creator to Virginia, including the one in Minas Gerais. Sent empty, the
    // allocator infers the creator's region from Fly's edge and prefers it whenever
    // it has capacity (`allocator/edge-region.ts`); a real picker, once there is one
    // to pick from, overrides that inference exactly as before.
    const region = regionPickerVisible(onlineRegions) ? onlineRegions[0]?.id : undefined;
    // Step 1 of the lifecycle the log carries end to end (brief §1): the allocate.
    // It is now also the first line the *player* reads — "ALLOCATING ROOM…" — and
    // every step below likewise reaches the screen through `traceStep`, so the
    // screen and the log are one story told once (M10 verbose connecting).
    playtest.recordConnect('allocate', { door, allocator: logHost(base), region: region ?? null });
    traceStep(beginConnect(door, Date.now(), logHost(base)));
    const result =
      door === 'create'
        ? await allocateRoom(config, region !== undefined ? { region } : {})
        : await joinRoom(config, room);
    // The player may have backed out or started over while the request was in
    // flight — drop a stale answer rather than overwrite the live screen.
    if (screen !== 'online' || entry.status !== 'connecting') return;
    if (!result.ok) {
      playtest.recordConnect('allocate failed', { door, reason: result.reason });
      if (connectTrace) traceStep(connectFailed(connectTrace, result.reason, Date.now()));
      failOnline(result.reason);
      return;
    }
    // Success: the code is the allocator's, used verbatim (M3 rule). Open the real
    // socket to the room it signed for and wait for the match to start.
    onlineResolved = result.connection.room;
    // Step 2: which machine, in which region, and that a signed ticket came back —
    // the machine id is the line that tells a "couldn't connect" report from a
    // "connected to the wrong Machine" one. The ticket VALUE is never logged.
    // …and WHY that machine, when the allocator said (`placement.detail` — "gru —
    // your region", "iad — gru full"). This is the line that makes a placement
    // explainable from a pasted log: a report of "why am I on a US server?" now
    // carries its own answer, and so does the good case.
    const placement = result.connection.placement?.detail;
    playtest.recordConnect('ticket', {
      room: result.connection.room,
      machine: result.connection.machine,
      region: result.connection.region,
      ...(placement !== undefined ? { placement } : {}),
      ticket: result.connection.ticket.length > 0,
      expiresInMs: result.connection.expiresAt > 0 ? result.connection.expiresAt - Date.now() : null,
    });
    if (connectTrace) {
      traceStep(
        connectTicketed(
          connectTrace,
          {
            room: result.connection.room,
            machine: result.connection.machine,
            region: result.connection.region,
            ...(placement !== undefined ? { placement } : {}),
            expiresInMs:
              result.connection.expiresAt > 0 ? result.connection.expiresAt - Date.now() : null,
          },
          Date.now(),
        ),
      );
    }
    connectMatch(config, result.connection, door === 'create');
    render();
  }

  /**
   * Open the match socket the allocator's decision points at, and enter the
   * NETWORKED match loop the moment the server starts the match (GDD §4.2).
   *
   * This is the front door finally dialling. `createOnlineSession` opens one
   * `WebSocketTransport` — a `wss://` socket in production, `connect` defaulting to
   * the browser's global `WebSocket` — presenting the signed ticket on every join
   * and carrying the reconnect-grace probe (`allocatorTransport`), so a dropped
   * socket redials inside the window and reclaims this ship, cargo and upgrades
   * intact: that behaviour already lives in the transport, this just wires its
   * entry (GDD §4.2 reconnect). It is the same client-sim the online integration
   * tests drive — reused, not reimplemented.
   *
   * **`welcome` is the handoff, not `matchStart`** (ratified: one lobby serves both
   * modes). The room's welcome names the seat this client got, which is everything
   * the lobby needs to open — the code up top for the host to read out, the roster
   * filling as joiners arrive, the slot editor for the creator, RUSH! when the room
   * is ready. `boot()` opens that lobby; the session's `matchStart` is what ends it,
   * and only then does the predicted arena render through the exact loop the offline
   * match uses.
   */
  function connectMatch(
    client: AllocatorClientConfig,
    connection: ResolvedConnection,
    host: boolean,
  ): void {
    onlineSession?.close();
    stopSessionLog();
    // A fresh dial (or a RETRY) is not yet on any server — drop the previous
    // one's suffix now rather than leaving a stale Machine on screen while a new
    // socket opens. The next `welcome` puts the real one back.
    buildIdentity().disconnected();
    roomEntered = false;
    onlineHost = host;
    // Step 3 of the logged lifecycle: the dial itself — which host, for which room.
    // The URL's `?ticket=` query is a signed credential, so only the host is logged.
    playtest.recordConnect('dial', { host: logHost(connection.url), room: connection.room, creator: host });
    // …and on screen, the Machine by name: "DIALING MACHINE 0800d5b6…". Which
    // Machine is the first question every join failure in this game has turned out
    // to hinge on, and it used to be a thing only the log knew.
    tracedTransportState = '';
    if (connectTrace) {
      traceStep(
        connectDialing(
          connectTrace,
          { machine: connection.machine, host: logHost(connection.url), room: connection.room },
          Date.now(),
        ),
      );
    }
    const session = createOnlineSession({
      url: connection.url,
      room: connection.room,
      shipClass: readShipClass(platform),
      fireMode: wireFireMode(fireMode),
      // The signed ticket + the room-liveness probe make this a fleet connection,
      // not a hard-coded direct dial; `connect` defaults to the browser WebSocket.
      transport: allocatorTransport(connection, client),
    });
    onlineSession = session;
    // Steps 4+ — welcome / joinError with reasons, every state change with its close
    // reason, the reconnect-grace pair, and each finalized second of net telemetry —
    // are the session's own to report (`src/net/playtest-log-attach`).
    startSessionLog(session);
    session.observe((message) => {
      // The two ends of the story, straight from the wire. A refusal is terminal
      // (`src/net/websocket-transport` `rejectJoin`), so the TITLE keeps the exact
      // reason on screen — "REFUSED: bad-ticket — machine mismatch" — with RETRY
      // and COPY LOG under it, instead of a word that never resolves.
      if (message.type === 'joinError') {
        // Refused is not connected: whatever the dial hoped for, the badge must
        // not claim a Machine this client was never seated on.
        buildIdentity().disconnected();
        if (connectTrace) {
          traceStep(connectRefused(connectTrace, message.reason, Date.now()));
          entry = entryFailed(entry, `REFUSED: ${message.reason}`);
          render();
        }
        return;
      }
      if (message.type === 'welcome') {
        // CONNECTED — and this is the moment the developer asked to see from a
        // screenshot (ratified, M10 §2): the badge grows its server suffix,
        // "3d7cc6a · d891dd0a (gru)", from the allocator's own answer. On
        // `welcome` rather than on the allocate, because a signed ticket is a
        // plan and a welcome is a fact; and the log's env follows the same string
        // through the identity's subscribers, so a pasted log agrees with the
        // corner of the screenshot beside it.
        buildIdentity().connected(connection.machine, connection.region);
        if (connectTrace) traceStep(connectJoined(connectTrace, message.you, Date.now()));
        beginRoom(session, connection.room, message.you);
      }
    });
  }

  /**
   * Attach the playtest log to a live session and poll it on a timer.
   *
   * A timer rather than the render loop, and that is deliberate: this has to keep
   * recording across the whole life of the connection — the lobby wait *before* the
   * match loop exists, and a drop *after* the menu has been torn down — so hanging it
   * on either screen's frame loop would leave a hole exactly where a report needs
   * detail. {@link SESSION_LOG_POLL_MS} is slow enough to be free (a handful of
   * integer compares) and fast enough that a death or a state change lands on the
   * right second of the timeline.
   */
  function startSessionLog(session: OnlineSession): void {
    onlineLogHandle = attachSessionLog({ log: playtest, session });
    onlineLogTimer = setInterval(() => {
      onlineLogHandle?.poll();
      // …and the badge's connection stat, on the same tick and for the same
      // reason (ratified M10 §1: "every screen … when connected"). The first
      // version of this fed the badge from the MATCH loop, and the lobby — the
      // screen the developer actually reads a region off, and where a live-stage
      // run photographs it — never showed a number at all, because no match loop
      // exists yet. This timer is already the one thing that spans the whole life
      // of a connection: the lobby wait before the match, and the drop after the
      // menu is gone.
      //
      // `networkFloorMs` is the DECOMPOSED NETWORK figure: the ping probe's own
      // round trip over the recent window, with no input lead and no broadcast
      // cadence in it — never the composite. It is the number `@net/session`
      // exposes as `networkPingMs` with the header "what the lobby and HUD
      // readouts must read", which is exactly the distinction the ratification
      // drew; read here through `telemetry.live` because that getter is the part
      // of it on the `OnlineSession` INTERFACE, and widening a ratified interface
      // is the Director's call, not this lane's. Same number, same source, so the
      // badge and the lobby's roster pings cannot disagree.
      //
      // It is null until a probe has been answered, and the probe rides
      // `sendInput` (`@net/session`) — so there is no reading until the match is
      // predicting, and the tag correctly carries no stats field before then. "A
      // number is a measurement or it is absent" (`@net/ping` rule 1); a `0ms` in
      // the lobby would be a claim about a wire nobody has timed. (The lobby is
      // not left blind: the roster already shows every seat's ping, measured by
      // the server's own probe.)
      //
      // Offered four times a second; `sampleRtt` applies it at most once per ~2 s.
      // `live` builds one small readout object per call — nothing at 4 Hz, and the
      // reason this is on a timer rather than in a frame loop.
      buildIdentity().sampleRtt(
        session.state === 'closed' ? null : session.telemetry.live.networkFloorMs,
        performance.now(),
      );
    }, SESSION_LOG_POLL_MS);
  }

  /** Stop logging a session that is being replaced (a fresh CREATE / JOIN). */
  function stopSessionLog(): void {
    onlineLogHandle?.dispose();
    onlineLogHandle = null;
    if (onlineLogTimer !== null) clearInterval(onlineLogTimer);
    onlineLogTimer = null;
  }

  /**
   * The server welcomed this client into a seat: hand `boot()` the live session so it
   * can open THE LOBBY — the same component PLAY SOLO opens, online this time
   * (ratified). RUSH! lives there now, on the roster, for the host alone; it used to
   * live on this screen as a bare "press Enter once somebody joins", which is why
   * CREATE ROOM had no way to pick a map, a mode, or the bots.
   *
   * Latched, because a redial inside the reconnect window replays `welcome` and a
   * second handoff would open a second lobby over the first.
   */
  function beginRoom(session: OnlineSession, room: RoomCode, you: PlayerId): void {
    if (roomEntered) return;
    roomEntered = true;
    played = true; // close the doors — this client is committed to a room
    ctx.enterImmersive();
    teardown();
    seam.visible = false;
    onlineSeam.visible = false; // the doors are gone; see `beginSolo`
    // The story ends where the lobby begins: the title's last line was "JOINED ·
    // SEAT n", and the room opening under it is the same news said better.
    endConnectTrace();
    resolvePlay({ kind: 'online', session, room, you, host: onlineHost });
  }

  /** Show an allocator refusal on the front door, keeping the typed code so a
   *  retry is one tap (`entryFailed`), and speaking the reason's own words. The
   *  COPY LOG offer follows from the screen's `error` status (`syncCopyLog`), so the
   *  "can't reach the servers" page always carries it (brief §3). */
  function failOnline(reason: ResolveFailure): void {
    entry = entryFailed(entry, entryErrorFor(reason));
    render();
  }

  /**
   * Offer COPY LOG on the front door's error screen, and withdraw it everywhere else
   * in the menus (brief §2, §3). Driven from `render`, so it follows the screen's own
   * state rather than needing a call at each failure site.
   */
  function syncCopyLog(): void {
    // The connect panel carries its own COPY LOG now, right under the failure it
    // is reporting (M10). Two buttons offering the same export, one of them in a
    // far corner, is worse than one in the right place — so the corner affordance
    // stands down for exactly as long as the panel is making the offer.
    if (connectTrace !== null && connectTraceModel(connectTrace, Date.now()).offerCopyLog) {
      hideCopyLog();
      return;
    }
    if (screen === 'online' && entry.status === 'error') showCopyLog({ reason: 'error' });
    else hideCopyLog();
  }

  /**
   * Log the front door's own status as it changes — `connecting`, `error` and the
   * refusal line **in the words the player read** (brief §1, "the verbose
   * connecting-status states").
   *
   * This is the join between the two halves of a report: the developer says *"it told
   * me it couldn't reach the servers"*, and the log's next line is the allocator
   * failure that produced exactly that sentence. Keyed on the whole visible state, so
   * one line per change and none per frame.
   */
  function logEntryStatus(): void {
    if (screen !== 'online') return;
    const key = `${entry.screen}/${entry.status}/${entry.error}`;
    if (key === loggedEntryState) return;
    loggedEntryState = key;
    playtest.recordConnect(`front door ${entry.status}`, {
      screen: entry.screen,
      ...(entry.error.length > 0 ? { shown: entry.error } : {}),
    });
  }

  /** The codex's layout at the current logical size — for the pane a scroll or a
   *  drag lands in. */
  function codexLayoutNow(): ReturnType<typeof codexLayout> {
    const { w, h } = ctx.logicalSize();
    return codexLayout({ width: w, height: h }, activeEntries(codexState).length, { isTouch });
  }

  function withinRect(r: Rect, x: number, y: number): boolean {
    return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
  }

  function openCodex(): void {
    screen = 'codex';
    render();
  }

  function closeCodex(): void {
    screen = 'menu';
    render();
  }

  /** Apply a tap on the codex screen — the targets {@link codexHitTest} returns.
   *  BACK returns to the menu; a tab or an entry folds into the codex state. */
  function applyCodex(target: CodexTarget): void {
    switch (target.kind) {
      case 'back':
        closeCodex();
        return;
      case 'tab': {
        const tab = CODEX_TABS[target.index];
        if (tab) codexState = selectCodexTab(codexState, tab.id);
        break;
      }
      case 'entry':
        codexState = selectCodexEntry(codexState, target.index);
        break;
    }
    render();
  }

  /** PLAY SOLO: tear the doors down and hand `boot()` the go-ahead to open the
   *  lobby offline. It does NOT build a world — RUSH! in the lobby does, exactly as
   *  it does for an online room (ratified: one lobby, both modes). */
  function beginSolo(): void {
    if (played) return;
    played = true;
    // A door press is a valid user gesture: take fullscreen + the native landscape
    // lock now, synchronously within the gesture, before anything else (field request
    // v0.1.1). Fire-and-forget and self-gating — a no-op on desktop / iPhone.
    ctx.enterImmersive();
    teardown();
    seam.visible = false;
    // The doors are gone with the rest of the menu, and `render()` will never run
    // again to say so — mark it here, or the seam would report a screen that is not
    // on screen for the rest of the session.
    onlineSeam.visible = false;
    resolvePlay({ kind: 'offline' });
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
      case 'controls':
        // Sticks ⇄ Tap Commander, persisted to the same seam the match reads at
        // boot (CONTROL_SCHEME_KEY) — so the choice takes effect immediately here
        // and carries into the match exactly as the fire mode does.
        controlScheme = controlScheme === 'tap' ? 'sticks' : 'tap';
        platform.storage.set(CONTROL_SCHEME_KEY, controlScheme);
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
      // PLAY opens the doors — the one way in (ratified). There is no second front
      // door to route, and no path from here that builds a world.
      if (hit === 'play') openDoors();
      else if (hit === 'codex') openCodex();
      else if (hit === 'settings') openSettings();
    } else if (screen === 'online') {
      const hit = entryView.hitTest(x, y);
      if (hit) applyEntryTarget(hit);
      // A tap off the controls does nothing: the doors are three buttons and a
      // keypad, and RUSH! is the LOBBY's now — it used to be a bare tap-anywhere
      // here, which is exactly the shortcut the ratified flow replaced.
    } else if (screen === 'settings') {
      const hit = settingsView.hitTest(x, y);
      if (hit) applySettings(hit);
    } else {
      // Codex: begin a tap-or-drag. The tap fires on pointer-up only if the finger
      // did not travel far enough to be a scroll — so a drag over a long body
      // scrolls it instead of selecting whatever entry it started on.
      const rail = codexLayoutNow().rail;
      codexDrag = { startX: x, startY: y, lastX: x, lastY: y, moved: false, overRail: withinRect(rail, x, y) };
    }
    e.preventDefault();
  }

  /** Scroll drag threshold (logical px) — past this a codex press is a scroll, not
   *  a tap. */
  const CODEX_DRAG_SLOP = 8;

  function onPointerMove(e: PointerEvent): void {
    if (screen !== 'codex' || !codexDrag) return;
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    if (Math.abs(y - codexDrag.startY) > CODEX_DRAG_SLOP || Math.abs(x - codexDrag.startX) > CODEX_DRAG_SLOP) {
      codexDrag.moved = true;
    }
    if (codexDrag.moved) {
      // Dragging the finger up reveals content below — the natural direction.
      const dy = y - codexDrag.lastY;
      if (codexDrag.overRail) codexView.scrollRail(-dy);
      else codexView.scrollDetail(-dy);
      render();
    }
    codexDrag.lastX = x;
    codexDrag.lastY = y;
  }

  function onPointerUp(e: PointerEvent): void {
    if (screen !== 'codex' || !codexDrag) {
      codexDrag = null;
      return;
    }
    const drag = codexDrag;
    codexDrag = null;
    if (drag.moved) return; // it was a scroll, not a tap
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    const hit = codexView.hitTest(x, y);
    if (hit) applyCodex(hit);
  }

  function onWheel(e: WheelEvent): void {
    if (screen !== 'codex') return;
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    if (withinRect(codexLayoutNow().rail, x, y)) codexView.scrollRail(e.deltaY);
    else codexView.scrollDetail(e.deltaY);
    render();
    e.preventDefault();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (screen === 'online') {
      // A desktop player types the code on a real keyboard; the same rule as the
      // pad (`typeEntryCode` drops anything not in the ambiguity-free alphabet).
      // (Enter is JOIN here, not RUSH! — RUSH! is the lobby's, one screen on.)
      if (e.code === 'Escape') {
        applyEntryTarget({ kind: 'back' });
      } else if (e.code === 'Backspace') {
        applyEntryTarget({ kind: 'erase' });
      } else if (e.code === 'Enter') {
        applyEntryTarget({ kind: 'submit' });
      } else if (e.key.length === 1) {
        entry = typeEntryCode(entry, e.key.toUpperCase());
        render();
      }
      return;
    }
    if (screen === 'settings') {
      if (e.code === 'Escape') closeSettings();
      return;
    }
    if (screen === 'codex') {
      // Escape or Backspace backs out of the reference (never a gate — one key out).
      if (e.code === 'Escape' || e.code === 'Backspace') closeCodex();
      return;
    }
    // On the menu, Enter or Space is PLAY — a keyboard player never has to reach
    // for the mouse to get in. It opens the doors, like the button.
    if (e.code === 'Enter' || e.code === 'Space') openDoors();
  }

  function relayout(): void {
    // Landscape lock first: re-apply the root transform for the new canvas size,
    // then re-lay the menu in the resulting logical (landscape) viewport — the
    // re-layout the field report found missing (rotate → menu stranded).
    ctx.recomputeTransform();
    const { w, h } = ctx.logicalSize();
    menuView.resize(w, h, isTouch);
    settingsView.resize(w, h, isTouch);
    codexView.resize(w, h, isTouch);
    entryView.resize(w, h, isTouch);
    render();
  }

  function teardown(): void {
    app.canvas.removeEventListener('pointerdown', onPointerDown);
    app.canvas.removeEventListener('pointermove', onPointerMove);
    app.canvas.removeEventListener('pointerup', onPointerUp);
    app.canvas.removeEventListener('pointercancel', onPointerUp);
    app.canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', relayout);
    window.removeEventListener('orientationchange', relayout);
    window.visualViewport?.removeEventListener('resize', relayout);
    ctx.root.removeChild(menuView, settingsView, codexView, entryView);
    menuView.destroy({ children: true });
    settingsView.destroy({ children: true });
    codexView.destroy({ children: true });
    entryView.destroy({ children: true });
  }

  app.canvas.addEventListener('pointerdown', onPointerDown);
  app.canvas.addEventListener('pointermove', onPointerMove);
  app.canvas.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('pointercancel', onPointerUp);
  app.canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  window.visualViewport?.addEventListener('resize', relayout);

  installMainMenuSeam(seam);
  installOnlineSeam(onlineSeam);
  render();

  return {
    untilPlay: () => playPromise,
    matchStarted: () => {
      seam.matchStarted = true;
    },
    bindMatch: (read) => {
      matchReader = read;
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

/** Install the read-only `window.__onlineMenu` live-stage seam (see
 *  {@link OnlineSeam}). Clean-boot only, same discipline as `__mainMenu`. */
function installOnlineSeam(seam: object): void {
  try {
    Object.defineProperty(window, '__onlineMenu', {
      value: seam,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already defined (double install / HMR) — leave the existing one in place.
  }
}

/** The choices the player locks in at RUSH! — the hull, the arena (p2), the
 *  name shown over their ship and station (field request v0.2.1), and the match
 *  shape (variable-slots Milestone E): the MODE, the ore ABUNDANCE, the SIZE
 *  (`N`) and the per-player TEAM table. Size and teams thread into
 *  `bootOfflineMatch`; abundance still rides the config seam awaiting the rest of
 *  the offline world-build wiring (Task C4). */
interface LobbyChoice {
  readonly shipClass: ShipClass;
  readonly mapId: string;
  readonly name: string;
  readonly mode: MatchMode;
  readonly abundance: Abundance;
  /** `N`, the active-seat count (2..8). Undefined means every seat open (eight). */
  readonly size?: number;
  /**
   * Which side each player fights for, indexed by the **dense** player id the sim
   * builds its world with (`configToPlayers` — closed seats are dropped and the
   * survivors re-indexed 0..N-1, spike Trap 6), so entry `i` is the team of the
   * ship the sim will call player `i`.
   *
   * Absent under `?debug=1`, where there is no lobby to author one; the world then
   * defaults each ship to its own side (`makeShip`) — FFA, byte-identical to
   * before. In FFA this is `[0,1,2,…]` and equally a no-op; it does real work only
   * in TEAMS, where it is the whole feature (m10 teams-wire).
   */
  readonly teams?: readonly number[];
}

/** The host's per-SLOT side, as `lobbyChoice.teams` spells it on the wire: one
 *  entry per physical lobby slot (0..7), including closed ones, because the
 *  server's seats are physical slots and it indexes this by `slot.player`
 *  (`server/room.ts` `applyTeamConfig`). FFA reads as teams-of-one. */
function lobbyTeams(state: LobbyState): number[] {
  return lobbyMatchConfig(state).slots.map((slot) => slot.team);
}

/** The same authored sides in the **dense** order `createWorld` uses — closed
 *  slots dropped, survivors re-indexed 0..N-1 (`configToPlayers`). This is the
 *  offline half of the exact same handoff {@link lobbyTeams} makes to the wire, so
 *  a TEAMS match plays identically with and without a server. */
function lobbyDenseTeams(state: LobbyState): number[] {
  return configToPlayers(lobbyMatchConfig(state)).map((spec) => spec.team ?? spec.id);
}

/**
 * The room this lobby is a lobby *for*, when there is one. Absent for PLAY SOLO —
 * the offline flavour of the same screen, which has no socket, no code to read out
 * and no joiners to wait for.
 *
 * This is the whole difference between "the solo lobby" and "the online lobby"
 * (ratified: ONE lobby component, both modes). Everything else — the roster, the
 * hulls, the arena cards, the mode and abundance rows, the slot editor, RUSH! — is
 * the same model, the same geometry and the same view in both.
 */
interface LobbyRoom {
  /** The live session the doors opened and the server welcomed us into. */
  readonly session: OnlineSession;
  /** The room code, the allocator's verbatim (M3) — shown prominently up top. */
  readonly code: RoomCode;
  /** The seat the server gave this client. */
  readonly you: PlayerId;
  /** True when this client created the room: the lobby's host. */
  readonly host: boolean;
}

/** What `boot()` holds the lobby by: a promise resolving with the hull and the
 *  arena the player locked in at RUSH!, and a one-shot `matchStarted()` the boot
 *  path calls once the world is built, to hand the seam what the sim actually made. */
interface LobbyHandle {
  /**
   * Resolves the moment the match is this client's to render:
   *
   *  - **offline** — the RUSH! countdown reaches zero, and `boot()` builds the world
   *    from the hull and arena it resolves with (GDD §2.11; p2);
   *  - **online** — the server's `matchStart` lands (authority ends the lobby, rule
   *    3 of `./ui/lobby-flow`). The host's countdown sends `startMatch` at zero; a
   *    guest never counted at all and simply waits on the roster.
   */
  untilRush(): Promise<LobbyChoice>;
  /** Report what the built world actually made: the hull the local ship flies and
   *  the arena's home-station positions — the proof both picks reached the sim
   *  (drives `window.__lobby.localShipClass` / `.worldMapId` / `.worldStations`). */
  matchStarted(
    worldShipClass: ShipClass,
    worldMapId: string,
    worldStations: readonly { x: number; y: number }[],
  ): void;
}

/** The read-only `window.__lobby` live-stage seam: the lobby as plain,
 *  structured-cloneable truth, plus two drive methods a Playwright test presses
 *  as taps would (tests/live-stage/lobby-flow.spec.ts). Present only on a clean
 *  boot; absent under `?debug=1`, where the lobby never runs. */
interface LobbySeam {
  /** The lobby layer is up (true until RUSH! hands the screen to the match). */
  visible: boolean;
  /** Seats laid out — eight (GDD §2.1). */
  slotCount: number;
  /** Laid out at thumb scale (the phone case). */
  isTouch: boolean;
  /** Joinable over the wire — false offline, so the room code is hidden. */
  online: boolean;
  /** The room code the lobby is showing — the number a classroom reads off one
   *  screen and types into another (GDD §4.2). `OFFLINE_ROOM` offline, where the
   *  view draws none; the allocator's verbatim code in an online room. */
  room: string;
  /** This client's seat, and whether it holds the host controls — the two facts
   *  that separate a room's creator from a joiner (GDD §4.2: "host is a lobby
   *  word"). Offline you are always seat 0 and always the host. */
  you: number;
  isHost: boolean;
  /** People actually in the room, bots aside — 1 until somebody joins. Readback
   *  proof that a joiner appears in the host's roster live. */
  humanCount: number;
  /** The match mode the lobby is on — FFA or TEAMS (variable-slots Milestone E). */
  mode: MatchMode;
  /** The ore abundance the lobby is on — scarce / standard / rich (ratified p11). */
  abundance: Abundance;
  /** `N` — the active (non-closed) seat count the world will build at (2..8). */
  size: number;
  /** The hull currently selected — the tile drawn as chosen. */
  selectedClass: ShipClass;
  /** The onboarding default (Vanguard), so a test can pick anything *but* it. */
  defaultClass: ShipClass;
  /** Hull order, so a test maps a tile index to a class the way the view does. */
  classOrder: readonly ShipClass[];
  /** The logical (landscape) viewport the lobby laid out against. */
  logicalViewport: { width: number; height: number };
  /** The content box the lobby drew inside — the layout-registry `full` rect,
   *  reported here so a clean boot (no `?debug=1` registry) can still assert the
   *  lobby sits inside the safe viewport. */
  content: Rect;
  /** One roster row's height — a thumb-size assertion target. */
  seatHeight: number;
  /** RUSH!'s height — likewise. */
  rushHeight: number;
  /** The RUSH! control's logical rect + the physical point a tap must land on to
   *  hit it (through the landscape-lock rotation) — the twin of the menu seam's
   *  control reports. Lets the mobile landscape-lock suite prove a *physical* touch
   *  on RUSH remaps to the logical control, rather than only driving rush()
   *  programmatically (tests/mobile/landscape-lock.spec.ts). */
  rushControl: { logical: Rect; physicalCenter: { x: number; y: number } };
  /** True while the RUSH! countdown is running. */
  counting: boolean;
  /** The hull the built world gave the local ship, or null until the match boots
   *  — the debug hook that proves the pick reached the sim (GDD §2.11). */
  localShipClass: ShipClass | null;
  /** The title of the codex hint (hull description / bot dossier) currently shown,
   *  or null when none is up — readback proof the lobby reuse (GDD §2.10 point 2)
   *  fires on hover / long-press. */
  hintTitle: string | null;
  /** The hull tiles' physical centres, so a live-stage run can hover one and watch
   *  the codex hull description appear. */
  classControls: readonly { index: number; physicalCenter: { x: number; y: number } }[];
  /** Select the hull tile at `index` in {@link classOrder} — a tap on a tile. */
  selectClass(index: number): void;
  /** Press RUSH! — starts the countdown that boots the match. */
  rush(): void;
  /** BACK — leave the lobby for the main menu (u2 menu-back), the exit every
   *  screen carries. A clean reload lands on a fresh main menu. */
  leave(): void;

  // --- The arena picker, now in the lobby (p2 field rule) ------------------
  /** The arena currently selected — the map card drawn as chosen. */
  selectedMapId: string;
  /** The onboarding default (`octagon`, "The Ring"), so a test can pick any *other*. */
  defaultMapId: string;
  /** The map that carries the VETERAN tag (`diamond`). */
  veteranMapId: string;
  /** Card order, so a test maps a card index to a map id the way the view does. */
  mapOrder: readonly string[];
  /** The arena card rects (logical, landscape space) — thumb-size assertion targets. */
  mapCards: readonly Rect[];
  /** Each map's registry station positions, from the SAME bundled registry the sim
   *  builds from — the expected board a booted match must match (p2). */
  expectedStations: Readonly<Record<string, readonly { x: number; y: number }[]>>;
  /** The arena the built world actually used, or null until the match boots. */
  worldMapId: string | null;
  /** The built world's home-station positions, or null until the match boots — the
   *  proof the picked arena reached the sim (p2). */
  worldStations: readonly { x: number; y: number }[] | null;
  /** Select the arena card at `index` in {@link mapOrder} — a tap on a card. */
  selectMap(index: number): void;
}

/**
 * The lobby (GDD §2.1, §2.11; M4) — **ONE component, both modes** (ratified: "CREATE
 * ROOM → goes to a lobby where you select players, just like when you press the play
 * button"). Every door on the entry screen lands here on a clean boot; `boot()` skips
 * it under `?debug=1`, which drops straight into a match with the persisted-or-default
 * hull so every existing harness keeps its immediate boot.
 *
 * **Offline flavour** (PLAY SOLO, `room` absent): `online: false`, so the room-code UI
 * is hidden and the empty seats read as the bot cast rather than joinable slots — there
 * is no transport for a second player to arrive on. You are seat 0 and the host, so
 * hull, ARENA, mode, abundance, per-seat state and difficulty, and RUSH! are all live.
 *
 * **Online flavour** (CREATE ROOM / JOIN ROOM, `room` present): the same screen with
 * `online: true` — the **room code up top** for the host to read out, the open seats
 * marked claimable, and the roster filling live as joiners arrive (`lobbyState` →
 * `applyLobbySlots`). The room's creator holds the whole slot editor and RUSH!, which
 * sends `startMatch` when the countdown reaches zero; a **joiner** sees their own name
 * in their own seat, reads the map and mode read-only (`./ui/lobby` refuses both from a
 * guest), and waits for the host. Authority ends the lobby either way: the server's
 * `matchStart` is what resolves it (`./ui/lobby-flow` rule 3).
 *
 * BACK leaves cleanly in both (u2 menu-back): offline it reloads onto a fresh main
 * menu; online it **closes the socket first**, so the seat is freed and an emptied room
 * deallocates rather than leaving a code nobody is behind.
 *
 * The arena picker lives here (p2 field rule): one pre-match room where you pick your
 * hull AND your map, then RUSH! — no separate picker step. Both picks are persisted
 * (same storage seam as the fire mode) and both are resolved to `boot()` at RUSH!.
 *
 * The pure model/geometry/view are `src/ui`'s ({@link LobbyView}, `lobbyModel`,
 * `lobbyLayout`); this function is the *wiring* — screen state, input routing, the
 * countdown clock off Pixi's ticker, the session's messages, and teardown. A read-only
 * `window.__lobby` seam lets the live-stage suite drive it and read back the hull and
 * the arena the sim ended up building.
 */
function openLobby(
  app: Application,
  platform: ReturnType<typeof createBrowserPlatform>,
  ctx: MenuContext,
  room?: LobbyRoom,
): LobbyHandle {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  // Offline solo-vs-bots: seat 0 is you and the host; the room code is hidden
  // (`online: false`); the pre-selected hull and arena are your last picks
  // (GDD §2.11; p2 — same storage seam as the fire mode).
  //
  // Online: the seat is the server's (`welcome`), and the HOST seat is this client's
  // if it created the room. A joiner walked into somebody else's room and the wire
  // carries no host field, so the creator is taken to be the lowest seat — the seat
  // the server always fills first — and never this client's, or a guest would hold
  // the slot editor over the host's own configuration.
  const you = room ? room.you : LOCAL_PLAYER;
  const hostSeat = room ? (room.host ? room.you : you === 0 ? 1 : 0) : LOCAL_PLAYER;
  const savedSize = readMatchSize(platform);
  let state: LobbyState = createLobby({
    room: room ? room.code : OFFLINE_ROOM,
    you,
    host: hostSeat,
    shipClass: readShipClass(platform),
    name: readPlayerName(platform),
    mapId: readMapId(platform),
    // The whole match shape the host last set (variable-slots Milestone E): the
    // mode, the abundance, and the size (trailing seats pre-closed) — folded to
    // legal values on read, so a stale key can never open an illegal lobby.
    //
    // The SIZE is restored offline only: an online room's size is the ROOM's, set
    // when it was allocated, and pre-closing seats from this client's last solo
    // match would show a room smaller than the one people are joining. (Authoring
    // seat states over the wire is the Netcode server seam — Task C4 — so an online
    // host's closed seats are local truth only for now; the room advertises its own
    // size.)
    mode: readMatchMode(platform),
    abundance: readAbundance(platform),
    ...(savedSize !== undefined && room === undefined ? { size: savedSize } : {}),
    online: room !== undefined,
  });
  let resolved = false;

  const size0 = ctx.logicalSize();
  const view = new LobbyView(size0.w, size0.h, isTouch);
  // The codex tooltip (GDD §2.10 point 2) — a passive overlay above the roster,
  // shown on hover / long-press of a hull tile or a bot seat, dismissed on any tap.
  const hintView = new CodexHintView();
  ctx.root.addChild(view, hintView);

  const seam: LobbySeam = {
    visible: true,
    slotCount: 0,
    isTouch,
    online: room !== undefined,
    room: state.room,
    you: state.you,
    isHost: state.you === state.host,
    humanCount: 1,
    mode: state.mode,
    abundance: state.abundance,
    size: matchSizeOf(state),
    selectedClass: state.shipClass,
    defaultClass: DEFAULT_SHIP_CLASS,
    classOrder: CLASS_ORDER,
    logicalViewport: { width: size0.w, height: size0.h },
    content: { x: 0, y: 0, width: 0, height: 0 },
    seatHeight: 0,
    rushHeight: 0,
    rushControl: { logical: { x: 0, y: 0, width: 0, height: 0 }, physicalCenter: { x: 0, y: 0 } },
    counting: false,
    localShipClass: null,
    hintTitle: null,
    classControls: [],
    selectClass: (index: number): void => selectClassAt(index),
    rush: (): void => rush(),
    leave: (): void => leaveToMenu(),
    // The arena picker (p2), computed once from the bundled registry — the same
    // board the sim builds from, so `expectedStations` is the truth a booted match
    // must match. Layout facts are refreshed each render; `worldMapId`/
    // `worldStations` stay null until `boot()` reports the built world.
    selectedMapId: state.mapId,
    defaultMapId: normalizeMapId(''),
    veteranMapId: VETERAN_MAP_ID,
    mapOrder: MAP_ORDER,
    mapCards: [],
    expectedStations: Object.fromEntries(MAP_ORDER.map((id) => [id, registryStations(id)])),
    worldMapId: null,
    worldStations: null,
    selectMap: (index: number): void => selectMapAt(index),
  };

  let resolveRush: (choice: LobbyChoice) => void = () => {};
  const rushPromise = new Promise<LobbyChoice>((resolve) => {
    resolveRush = resolve;
  });

  /** Redraw the lobby from current state and refresh the seam's layout facts. */
  function render(): void {
    const model = lobbyModel(state);
    view.update(model);
    const { w, h } = ctx.logicalSize();
    const layout = lobbyLayout({ width: w, height: h }, { isTouch });
    seam.visible = view.visible;
    seam.slotCount = layout.seats.length;
    seam.online = model.online;
    seam.room = model.room;
    seam.you = state.you;
    seam.isHost = model.hostControls;
    seam.humanCount = model.humanCount;
    seam.mode = model.mode;
    seam.abundance = model.abundance;
    seam.size = model.size;
    seam.selectedClass = state.shipClass;
    seam.selectedMapId = state.mapId;
    seam.mapCards = layout.maps.map((r) => ({ ...r }));
    seam.logicalViewport = { width: w, height: h };
    seam.content = { ...layout.content };
    seam.seatHeight = layout.seats[0]?.height ?? 0;
    seam.rushHeight = layout.rushButton.height;
    // The RUSH! rect in logical (landscape) space and the physical tap point it
    // un-rotates from — computed through the same `ctx.toPhysical` the menu seam
    // uses, so the landscape-lock suite can tap RUSH physically (see LobbySeam).
    const rush = layout.rushButton;
    seam.rushControl = {
      logical: { ...rush },
      physicalCenter: ctx.toPhysical(rush.x + rush.width / 2, rush.y + rush.height / 2),
    };
    seam.counting = model.countdown.active;
    // The hull tiles' physical centres — the codex hull-description hover targets.
    seam.classControls = layout.classOptions.map((r, i) => ({
      index: i,
      physicalCenter: ctx.toPhysical(r.x + r.width / 2, r.y + r.height / 2),
    }));
  }

  // --- Codex reuse (GDD §2.10 point 2): the hint under the pointer ------------

  /** The codex hint for the lobby row at `(x, y)`, plus the logical point to
   *  anchor its tooltip at — a hull description for a class tile, a bot dossier for
   *  a cast bot seat, or null for anything else (an empty seat, your own row, the
   *  arena cards). */
  function resolveHint(
    x: number,
    y: number,
  ): { hint: NonNullable<ReturnType<typeof codexShipHint>>; ax: number; ay: number } | null {
    const hit = view.hitTest(x, y);
    if (!hit) return null;
    const { w, h } = ctx.logicalSize();
    const layout = lobbyLayout({ width: w, height: h }, { isTouch });
    if (hit.kind === 'class') {
      const cls = CLASS_ORDER[hit.index];
      const rect = layout.classOptions[hit.index];
      const hint = cls ? codexShipHint(CODEX_DATA, cls) : null;
      if (!hint || !rect) return null;
      return { hint, ax: rect.x + rect.width / 2, ay: rect.y };
    }
    if (hit.kind === 'seat') {
      const seat = state.seats.find((s) => s.player === hit.index);
      const rect = layout.seats[hit.index];
      if (!seat || seat.occupant === 'human' || !seat.personality || !rect) return null;
      const hint = codexBotHint(CODEX_DATA, seat.personality);
      if (!hint) return null;
      return { hint, ax: rect.x + rect.width / 2, ay: rect.y };
    }
    return null;
  }

  function showHint(resolved: { hint: NonNullable<ReturnType<typeof codexShipHint>>; ax: number; ay: number }): void {
    const { w, h } = ctx.logicalSize();
    hintView.show(resolved.hint, resolved.ax, resolved.ay, w, h);
    seam.hintTitle = resolved.hint.title;
  }

  function hideHint(): void {
    hintView.hide();
    seam.hintTitle = null;
  }

  /**
   * Tell the room what this client chose — the hull, the fire mode, and (from the
   * creator only) the per-seat bot difficulties in the empty-seat order
   * `server/room.ts` reads them in. Offline there is nobody to tell, so this is a
   * no-op and the whole solo path costs the wire nothing.
   *
   * Sent on every change rather than once at RUSH!, because `lobbyState` is
   * broadcast on any change: a roster that showed a hull nobody else had been told
   * about would be a roster that lies about the match being built (the same rule
   * `./ui/lobby-flow` `withLobby` keeps).
   */
  function sendChoice(): void {
    if (!room) return;
    const host = state.you === state.host;
    room.session.chooseInLobby({
      shipClass: state.shipClass,
      fireMode: wireFireMode(readFireMode(platform, isTouch)),
      ...(host ? { botDifficulties: botDifficulties(state) } : {}),
      // The match SHAPE, from the host only (m10 teams-wire): the MODE and the
      // per-seat SIDE, indexed by slot. Sent on every lobby change like the hulls
      // and the difficulties, so the room's advertised mode and every seat's
      // allegiance are already true when RUSH! builds the world — teams are static
      // match config and must be settled *before* the sim exists, never after
      // (GDD §4.2; spike §S2, Trap 7). A joiner sends neither: the room's shape is
      // the host's, and their own toggles are local screen state until the
      // authoritative `lobbyState` folds the truth back in.
      ...(host ? { mode: state.mode, teams: lobbyTeams(state) } : {}),
    });
  }

  /** Pick the hull tile at `index` (a tap on a tile). Refused after RUSH!, where
   *  {@link selectShipClass} returns the same state and the choice is locked. The
   *  room is told at once, so the roster everyone reads shows the real hull. */
  function selectClassAt(index: number): void {
    if (resolved) return;
    const shipClass = CLASS_ORDER[index];
    if (shipClass === undefined) return;
    const next = selectShipClass(state, shipClass);
    if (next === state) return; // a refused / repeated pick costs the wire nothing
    state = next;
    sendChoice();
    render();
  }

  /** Pick the arena card at `index` (a tap on a card). Persists the choice at once,
   *  so a reload finds it preselected and `boot()` reads it at RUSH! (p2). Refused
   *  after RUSH! and from a JOINER — one arena per room, and it is the host's
   *  ({@link selectMap}), so a guest's tap returns the identical state and nothing
   *  is stored. */
  function selectMapAt(index: number): void {
    if (resolved) return;
    const next = selectMap(state, mapIdAt(index));
    if (next === state) return;
    state = next;
    platform.storage.set(MAP_STORAGE_KEY, state.mapId);
    render();
  }

  /**
   * BACK — leave the lobby for the main menu (u2 menu-back). A clean reload to the
   * bare menu URL is the exit's maximal teardown: it clears the pre-match world
   * state and boots straight onto a fresh main menu (the same "go to the menu"
   * reload the pause overlay and end screen use).
   *
   * **In an online room the socket is closed first** (u2 item 4 — no ghost rooms):
   * a reload alone would drop the connection eventually, but closing it here is what
   * frees the seat immediately and lets an emptied room deallocate rather than
   * leaving a code the classroom can still type with nobody behind it.
   *
   * A no-op once the countdown has resolved and the match owns the screen.
   */
  function leaveToMenu(): void {
    if (resolved) return;
    room?.session.close();
    const menuUrl = window.location.origin + window.location.pathname;
    window.location.assign(menuUrl);
  }

  /** Press RUSH! — starts the countdown. Offline you are the host, so it always
   *  takes; online it is refused from a joiner ({@link pressRush} → `canStart`), who
   *  reads "WAITING FOR THE HOST" under the button instead. A no-op once counting or
   *  once the match has been handed the screen. */
  function rush(): void {
    if (resolved) return;
    const next = pressRush(state);
    if (next === state) return;
    state = next;
    render();
  }

  /**
   * Advance the countdown off Pixi's render ticker (the only clock running pre-match
   * — the fixed-timestep game loop starts after the lobby resolves).
   *
   * On the frame it reaches zero the hull locks, and what happens next depends on who
   * owns the match:
   *
   *  - **offline** — nothing else does: the lobby resolves and `boot()` builds the
   *    world from the choices below.
   *  - **online** — `startMatch` goes out on THIS frame, not on the button press
   *    (`./ui/lobby-flow` rule 2: sending on press would let the server's `matchStart`
   *    land mid-count and cut the countdown to nothing). The lobby stays up until the
   *    server answers, because authority ends the lobby, not the local clock (rule 3).
   */
  function onTick(): void {
    if (state.phase !== 'counting') return;
    state = tickLobby(state, app.ticker.deltaMS / 1000);
    render();
    // The guard above means this is the ONE frame the count reached zero.
    if (state.phase !== 'started') return;
    if (room) room.session.startMatch();
    else finish();
  }

  /**
   * The match is this client's to render: tear the lobby down and hand `boot()` the
   * choices locked in at RUSH!. Offline this is the countdown reaching zero; online it
   * is the server's `matchStart` — one exit, two triggers, latched so a duplicate
   * `matchStart` (a reclaim replays it) cannot resolve twice.
   */
  function finish(): void {
    if (resolved) return;
    resolved = true;
    const chosen: LobbyChoice = {
      shipClass: state.shipClass,
      mapId: state.mapId,
      name: state.name,
      mode: state.mode,
      abundance: state.abundance,
      size: matchSizeOf(state),
      // The sides the host authored, in the sim's dense player order — the offline
      // world-build wiring that was missing (Task C4). Online this is ignored: the
      // world is the server's, built from the sides the same lobby already sent it
      // (`sendChoice`), and `matchStart` hands them back for the predicted world.
      teams: lobbyDenseTeams(state),
    };
    teardown();
    seam.visible = false;
    resolveRush(chosen);
  }

  /** Perform a real tap on a lobby control (fired on pointer-UP, so a long-press
   *  that opened a codex dossier does not also act — GDD §2.10 point 2's
   *  "non-blocking"). Hit-tested at the press-DOWN point, which is robust when a
   *  synthetic touchEnd carries no coordinates (landscape-lock physical taps). */
  function act(hit: NonNullable<ReturnType<typeof view.hitTest>>): void {
    switch (hit.kind) {
      case 'class':
        selectClassAt(hit.index);
        break;
      case 'map':
        selectMapAt(hit.index);
        break;
      case 'seat':
        // The row body cycles the seat's OPEN → BOT → CLOSED state (variable-slots
        // Milestone E) — the host shrinks or shapes the match here. Persist the
        // resulting size so a returning host reopens on the same count, and tell the
        // room: closing a seat changes which bots it will cast, and the cast list
        // rides the host's own `lobbyChoice`.
        state = cycleSeatState(state, hit.index);
        platform.storage.set(MATCH_SIZE_KEY, String(matchSizeOf(state)));
        sendChoice();
        render();
        break;
      case 'seatChip':
        // The trailing DIFFICULTY chip — the bot-tier cycle, in BOTH modes (n2):
        // the shared slot-editor control, so a bot's tier is reachable in TEAMS
        // exactly as in FFA (the TEAMS lobby had lost it when the side control took
        // the only chip). Online the room is told, in empty-seat order.
        state = cycleBotDifficulty(state, hit.index);
        sendChoice();
        render();
        break;
      case 'seatTeamChip':
        // The TEAM chip — the side cycle, composed alongside the difficulty chip in
        // TEAMS (n2). A model no-op in FFA (teams-of-one).
        state = cycleSeatTeam(state, hit.index);
        render();
        break;
      case 'mode':
        // FFA ⇄ TEAMS. Persisted, so a returning host finds their last mode.
        state = toggleMode(state);
        platform.storage.set(MATCH_MODE_KEY, state.mode);
        render();
        break;
      case 'abundance':
        // SCARCE → STANDARD → RICH (ratified p11). Persisted like the mode.
        state = cycleAbundance(state);
        platform.storage.set(ABUNDANCE_KEY, state.abundance);
        render();
        break;
      case 'leave':
        // BACK — leave the lobby for the main menu (u2 menu-back). Online this closes
        // the socket first, so the room does not outlive the player.
        leaveToMenu();
        break;
      case 'rush':
        rush();
        break;
      case 'roomCode':
        // The code is a label, not a control — hit-testable so a caller could offer
        // copy-to-clipboard, and hidden entirely offline. A tap never disturbs the
        // roster (the same rule `./ui/lobby-flow` keeps).
        break;
    }
  }

  /** Long-press hold (ms) that opens a codex dossier, and the move slop past which
   *  a press is a scroll/drag, not a tap or a hold. */
  const LOBBY_HOLD_MS = 350;
  const LOBBY_SLOP = 10;
  let press: { x: number; y: number; moved: boolean; hold: boolean; timer: ReturnType<typeof setTimeout> | null } | null =
    null;

  function onPointerDown(e: PointerEvent): void {
    // Un-rotate the physical tap into the logical space the lobby is drawn in
    // (landscape lock), then test it against the same geometry the view drew.
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    hideHint();
    press = { x, y, moved: false, hold: false, timer: null };
    // Arm the long-press dossier: after a held moment on a hull tile or bot seat,
    // its codex hint appears (the touch equivalent of a desktop hover).
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      const resolved = resolveHint(x, y);
      if (resolved) {
        press.hold = true;
        showHint(resolved);
      }
    }, LOBBY_HOLD_MS);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    const { x, y } = ctx.toLogical(e.clientX, e.clientY);
    if (press) {
      if (!press.moved && (Math.abs(x - press.x) > LOBBY_SLOP || Math.abs(y - press.y) > LOBBY_SLOP)) {
        press.moved = true;
        if (press.timer) {
          clearTimeout(press.timer);
          press.timer = null;
        }
        hideHint();
      }
      return;
    }
    // No button down — desktop hover: the codex hint for the row under the cursor.
    const resolved = resolveHint(x, y);
    if (resolved) showHint(resolved);
    else hideHint();
  }

  function onPointerUp(): void {
    const p = press;
    press = null;
    if (p?.timer) clearTimeout(p.timer);
    if (!p || p.hold || p.moved) return; // a dossier long-press or a drag, not a tap
    const hit = view.hitTest(p.x, p.y);
    if (hit) act(hit);
  }

  function onPointerLeave(): void {
    if (!press) hideHint();
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Escape leaves the lobby for the main menu (u2 menu-back) — the pointer twin
    // of the BACK button, the exit every screen answers Escape with.
    if (e.code === 'Escape') {
      leaveToMenu();
      return;
    }
    // Enter or Space is RUSH! — a keyboard player never reaches for the mouse to
    // start, the same courtesy the main menu gives PLAY.
    if (e.code === 'Enter' || e.code === 'Space') rush();
  }

  function relayout(): void {
    ctx.recomputeTransform();
    const { w, h } = ctx.logicalSize();
    view.resize(w, h, isTouch);
    hideHint(); // a stale tooltip is anchored to the old layout — drop it on a flip
    render();
  }

  function teardown(): void {
    app.ticker.remove(onTick);
    app.canvas.removeEventListener('pointerdown', onPointerDown);
    app.canvas.removeEventListener('pointermove', onPointerMove);
    app.canvas.removeEventListener('pointerup', onPointerUp);
    app.canvas.removeEventListener('pointercancel', onPointerUp);
    app.canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', relayout);
    window.removeEventListener('orientationchange', relayout);
    window.visualViewport?.removeEventListener('resize', relayout);
    ctx.root.removeChild(view, hintView);
    view.destroy({ children: true });
    hintView.destroy({ children: true });
  }

  app.ticker.add(onTick);
  app.canvas.addEventListener('pointerdown', onPointerDown);
  app.canvas.addEventListener('pointermove', onPointerMove);
  app.canvas.addEventListener('pointerup', onPointerUp);
  app.canvas.addEventListener('pointercancel', onPointerUp);
  app.canvas.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);
  window.visualViewport?.addEventListener('resize', relayout);

  // --- The wire half of the ONE lobby (online only) --------------------------
  // Two messages matter here, and they are the two `./ui/lobby-flow` documents:
  //
  //  - `lobbyState` — the authoritative roster. Folded in through `applyLobbySlots`,
  //    which is what makes joiners APPEAR in their seats as they type the code in,
  //    live, on the host's screen and on every other joiner's. Purely display: an
  //    echo that replied would loop the room forever, so nothing goes back.
  //  - `matchStart` — authority ending the lobby (rule 3). Whatever the local count
  //    believed, this is what hands the screen to the match; a guest never counted at
  //    all, so for them it is the only trigger there is.
  if (room) {
    room.session.observe((message) => {
      if (message.type === 'lobbyState') {
        state = applyLobbySlots(state, message.slots);
        render();
      } else if (message.type === 'matchStart') {
        state = startLobbyMatch(state);
        render();
        finish();
      }
    });
    // The pre-selected hull (GDD §2.11) is a real choice the room has not been told
    // about yet — send it the moment the lobby opens, exactly as `flowConnected` does.
    sendChoice();
  }

  installLobbySeam(seam);
  render();

  return {
    untilRush: () => rushPromise,
    matchStarted: (
      worldShipClass: ShipClass,
      worldMapId: string,
      worldStations: readonly { x: number; y: number }[],
    ): void => {
      seam.localShipClass = worldShipClass;
      seam.worldMapId = worldMapId;
      seam.worldStations = worldStations.map((p) => ({ x: p.x, y: p.y }));
    },
  };
}

/** Install the read-only `window.__lobby` live-stage seam (see {@link openLobby}).
 *  Its fields are mutated in place as the lobby runs and after the match boots;
 *  the handle itself is fixed, like the menu and fullscreen seams. */
function installLobbySeam(seam: object): void {
  try {
    Object.defineProperty(window, '__lobby', {
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

/**
 * What `window.__buildBadge` reports: the persistent build badge exactly as it is
 * drawn, on whatever screen is up (ratified, M10 — "shown on every single page").
 * Read-only and structured-cloneable, like every other live-stage seam.
 */
interface BuildBadgeSeam {
  /** The string on screen: `'3d7cc6a'` offline, `'3d7cc6a · d891dd0a (gru)'`
   *  connected, `'3d7cc6a · d891dd0a (gru) · 62ms'` once the wire is timed. */
  readonly text: string;
  /** False only under `?freeze=1`, where a changing stamp would break the goldens. */
  readonly visible: boolean;
  /** The server the tag's suffix came from, or null when there is no session. */
  readonly server: { machine: string; region: string } | null;
  /** The round trip in the tag, ms, or null when the tag shows none — the
   *  DECOMPOSED NETWORK figure (ratified: never the composite). */
  readonly rttMs: number | null;
  /** The stamp's actual rect in logical (landscape) space, or null when hidden. */
  readonly bounds: Rect | null;
  /** Does that rect sit inside the declared `bottom-left` zone? */
  readonly withinAnchor: boolean;
}

/** Install the read-only `window.__buildBadge` seam. Best-effort, like the
 *  fullscreen seam — a double install (HMR) leaves the first in place. */
function installBuildBadgeSeam(seam: BuildBadgeSeam): void {
  try {
    Object.defineProperty(window, '__buildBadge', {
      value: seam,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already defined (double install / HMR) — leave the existing one in place.
  }
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
    // And offer the playtest log on this screen too (brief §3: *every* error screen).
    // A boot failure may well have happened before `boot()` installed the affordance,
    // so install one here if there is none; the log itself always exists.
    if (!copyLogButton()) installCopyLogButton({ dom: document });
    showCopyLog({ reason: 'error', hint: `Boot failed — ${ERROR_OFFER_HINT}` });
  } catch (screenErr) {
    // The failure path must not fail silently on top of the original failure.
    console.error('Planet Rush: could not render the boot-error screen', screenErr);
  }
}

// The whole of boot() runs inside one catch, so ANY init failure — no WebGL, a
// bad asset, a thrown constructor — lands on the friendly screen with its error
// text, rather than on a black canvas (GDD §4.3b risk 7).
void boot().catch(presentBootFailure);
