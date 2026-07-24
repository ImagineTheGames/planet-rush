/**
 * src/ui/ — HUD and menus. OWNER: UI Engineer (GDD §3.7).
 *
 * Ore squares + banked total, the asteroid-wave clock, the under-attack alarm
 * and screen-edge arrow, over-ship hull bars, the device-aware controls strip,
 * the radial build menu, upgrade panel, minimap, lobby, settings (incl. the
 * fire-mode toggle), end-of-match/rematch, and the onboarding prompts (§2.10).
 * Thumb-scale layout and safe-area anchoring for touch.
 *
 * The shape of every module here is the same: a **pure, DOM-free model** that
 * holds all the decisions and unit-tests headless, plus a thin PixiJS *view*
 * that draws it. The Platform Engineer constructs {@link Hud} on the Pixi stage
 * and calls {@link Hud.update} each frame with a {@link HudFrame}.
 *
 * M1 surface (GDD §4.6): ore-at-a-glance + banked total, the asteroid-wave
 * clock, the desktop controls strip, and the first two onboarding prompts.
 *
 * M2 surface: the **Build & Upgrade wheel** (§2.5 — words plus cost, and cost is
 * the only number), the **upgrade panel** behind its arrow (the only place ship
 * stats appear), **your own planet's HP** in your player colour (§2.2), the
 * **under-attack alarm** with its sustained-damage trigger and screen-edge arrow
 * home (§2.2, a mechanic and not polish), and the remaining two onboarding
 * prompts (§2.10).
 *
 * M4 surface: the **8-slot lobby** (§2.1) — room code create/join, the roster
 * with its player colours (§5.2 / style-guide §3.1), ship-class select with the
 * four role blurbs and the Vanguard preselected (§2.11), the host's per-seat bot
 * difficulty picks (§2.9), and the RUSH! countdown, in a layout that holds on a
 * phone in landscape and on a desktop — reached through the **entry screen**
 * (§4.2), whose three doors are PLAY SOLO (no server: §4.8 risk 6), CREATE ROOM
 * and JOIN ROOM, the last behind an on-screen keypad because the game is a
 * canvas with no text field to focus.
 */

export { Hud } from './hud';
export type { HudFrame } from './hud';

export { Onboarding, PromptId, resolvePromptText } from './onboarding';
export type { OnboardingSignals } from './onboarding';

export { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
export type { WaveClock } from './wave-clock';

export { oreHudModel, oreFlashOn } from './ore-hud';
export type { OreHudModel } from './ore-hud';

export { controlsStripRows, showControlsStrip } from './controls-strip';

// --- Build & Upgrade wheel (GDD §2.5) --------------------------------------

export {
  buildWheelModel,
  canOpenWheel,
  segmentState,
  segmentCost,
  segmentAngle,
  segmentAtDirection,
  spendableOre,
  WHEEL_ORDER,
  SEGMENT_ARC,
  REPAIR_ENTRY_ORE,
} from './build-wheel';
export type {
  BuildWheelModel,
  BuildWheelSignals,
  WheelSegment,
  WheelSegmentId,
  SegmentState,
  SegmentTarget,
} from './build-wheel';

export { BuildWheelView } from './build-wheel-view';

// --- Upgrade panel — the only place ship stats appear (GDD §2.2, §2.5) -----

export {
  upgradePanelModel,
  upgradeRow,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
  CLASS_NAMES,
} from './upgrade-panel';
export type {
  UpgradePanelModel,
  UpgradePanelSignals,
  UpgradeRow,
  UpgradeRowState,
  UpgradeTiers,
  UpgradeLadder,
  UpgradeTrackSpec,
} from './upgrade-panel';

// --- Under-attack alarm (GDD §2.2 — a mechanic, not polish) ----------------

export {
  UnderAttackAlarm,
  homeArrow,
  ALARM_THRESHOLD_HP,
  ALARM_DRAIN_HP_PER_S,
  ALARM_HOLD_S,
  ARROW_EDGE_INSET,
} from './alarm';
export type { HomeArrow, ArrowViewport, Point } from './alarm';

// --- Own-planet HP, in the player's colour (GDD §2.2) ----------------------

export { planetHpModel, planetHpFlashOn, playerColor, PLANET_CRITICAL_FRACTION } from './planet-hp';
export type { PlanetHpModel } from './planet-hp';

// --- The 8-slot lobby (GDD §2.1, §2.11, §4.2) ------------------------------
//
// The same three-piece shape as everything else here: a pure model
// (`./lobby`), pure geometry (`./lobby-geometry`), and a Pixi view
// (`./lobby-view`) that only draws what those two return.
//
// **Wiring seam**, for whoever boots the client (`src/main.ts`, Platform):
//
//   const lobby = new LobbyView(app.screen.width, app.screen.height, isTouch);
//   app.stage.addChild(lobby);
//   let state = createLobby({ room: makeRoomCode(rng) });   // host creates a code;
//                        // a joiner passes the one they typed (normalizeRoomCode)
//   // per frame:  state = tickLobby(state, dt); lobby.update(lobbyModel(state));
//   // on resize:  lobby.resize(w, h, isTouch, safeAreaInsets)
//   // on tap:     const hit = lobby.hitTest(x, y)  →  'class' | 'seat' | 'rush'
//   //             'class' → selectShipClass(state, CLASS_ORDER[hit.index])
//   //             'seat'  → cycleBotDifficulty(state, hit.index)   (host only)
//   //             'rush'  → pressRush(state)  → session.start()
//   // from the wire: applyLobbySlots(state, msg.slots) on `lobbyState`,
//   //             startLobbyMatch(state) on `matchStart`, and send
//   //             botDifficulties(state) with the host's `lobbyChoice`.
//
// `LobbyView` implements `LayoutContributor`, so the same registry loop that
// already registers the HUD registers the lobby with no change (see `main.ts`).

export {
  CLASS_OPTIONS,
  CLASS_ORDER,
  COLOR_NAMES,
  DEFAULT_SHIP_CLASS,
  DIFFICULTY_CYCLE,
  DIFFICULTY_LABELS,
  LOBBY_SLOTS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RUSH_COUNTDOWN_SECONDS,
  RUSH_LABEL,
  applyLobbySlots,
  botDifficulties,
  canStart,
  castForEmptySeat,
  classLocked,
  colorName,
  countdownLabel,
  createLobby,
  cycleBotDifficulty,
  defaultDifficultyForEmptySeat,
  eraseRoomCode,
  hostControls,
  isJoinableRoomCode,
  lobbyModel,
  makeRoomCode,
  normalizeRoomCode,
  pressRush,
  seatLocalPlayer,
  selectShipClass,
  startLobbyMatch,
  tickLobby,
  typeRoomCode,
} from './lobby';
export type {
  LobbyModel,
  LobbyOptions,
  LobbyPhase,
  LobbySeat,
  LobbySeatView,
  LobbyState,
  SeatOccupant,
  ShipClassOption,
} from './lobby';

export {
  CLASS_TILE_MAX,
  CLASS_TILE_MIN,
  LOBBY_PAD,
  RUSH_HEIGHT,
  RUSH_HEIGHT_TOUCH,
  SEAT_ROW_MAX,
  SEAT_ROW_MAX_TOUCH,
  TWO_COLUMN_MIN_WIDTH,
  lobbyHitTest,
  lobbyLayout,
} from './lobby-geometry';
export type { Insets, LobbyLayout, LobbyLayoutOptions, LobbyTarget, TileShape } from './lobby-geometry';

export { LobbyView, LOBBY_ID, LOBBY_ANCHOR } from './lobby-view';

// --- The door into a room (GDD §2.1, §4.2, §4.8) ---------------------------
//
// The screen *before* the lobby: PLAY SOLO / CREATE ROOM / JOIN ROOM, and the
// on-screen keypad a room code is typed on (the game is a canvas — there is no
// DOM input to focus, see `./lobby-entry`).
//
// **Wiring seam**, continuing the one above:
//
//   const entry = new LobbyEntryView(app.screen.width, app.screen.height, isTouch);
//   app.stage.addChild(entry);
//   let door = createEntry();
//   // per frame:  entry.update(entryModel(door))
//   // on tap:     const hit = entry.hitTest(x, y)
//   //   'door'   → chooseDoor(door, DOOR_ORDER[hit.index], rng)
//   //   'key'    → typeEntryCode(door, KEYPAD_KEYS[hit.index])
//   //   'erase'  → eraseEntryCode(door)   'back' → backToDoors(door)
//   //   'submit' → submitJoin(door)
//   // on a desktop keypress: typeEntryCode / eraseEntryCode take it unchanged.
//
// Every one of those returns an `EntryResult`; when `.intent` is non-null the
// caller opens the transport and hands the lobby the same room code:
//
//   if (result.intent) {
//     const transport = result.intent.online          // 'solo' is the offline door
//       ? new WebSocketTransport(...) : new LocalLoopback(...);
//     transport.send({ type: 'join', room: result.intent.room });
//     state = createLobby({ room: result.intent.room });   // ← the lobby above
//     entry.visible = false;
//   }
//   // …and on a refusal: door = entryFailed(door, ENTRY_ERRORS.full)  — which
//   // keeps the typed code, so retrying is one tap and not four.

export {
  DOOR_OPTIONS,
  DOOR_ORDER,
  ENTRY_ERRORS,
  KEYPAD_COLUMNS,
  KEYPAD_KEYS,
  KEYPAD_ROWS,
  backToDoors,
  canSubmitJoin,
  chooseDoor,
  createEntry,
  entryConnected,
  entryFailed,
  entryLive,
  entryModel,
  eraseEntryCode,
  submitJoin,
  typeEntryCode,
} from './lobby-entry';
export type {
  EntryCodeCell,
  EntryDoor,
  EntryDoorOption,
  EntryDoorView,
  EntryIntent,
  EntryModel,
  EntryResult,
  EntryScreen,
  EntryState,
  EntryStatus,
} from './lobby-entry';

export { entryHitTest, entryLayout, DOOR_HEIGHT, DOOR_HEIGHT_TOUCH, KEY_MAX, KEY_MIN } from './lobby-geometry';
export type { EntryLayout, EntryTarget } from './lobby-geometry';

export { LobbyEntryView, ENTRY_ID, ENTRY_ANCHOR } from './lobby-entry-view';

// --- Screen geometry for the M2 overlays (layout-registry contract) ---------
//
// Pure and PixiJS-free, so the rects the wheel, the panel and the alarm are
// drawn at are asserted against the registry's own anchor resolver headless —
// the frozen golden scene never opens a wheel or takes a hit, so QA's live
// layout contract cannot see these three (see ./hud-geometry.test.ts).

export {
  wheelRadius,
  wheelBounds,
  panelSize,
  panelBounds,
  alarmFrameBounds,
  arrowPoly,
  polyBounds,
  ARROW_SIZE,
  ALARM_FRAME_STROKE,
  ALARM_FRAME_INSET,
  WHEEL_SCALE,
  WHEEL_MIN_RADIUS,
  WHEEL_MAX_RADIUS,
  PANEL_MAX_WIDTH,
  PANEL_EDGE_PAD,
  PANEL_CHROME_HEIGHT,
  PANEL_ROW_HEIGHT,
} from './hud-geometry';
