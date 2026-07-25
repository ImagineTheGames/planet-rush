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

// --- Open-build-wheel button — the touch E-equivalent, a permanent HUD ------
//     fixture near your own planet (GDD §2.2, §2.4); drawn by touch-visuals,
//     its persistence rule + layout contract owned here.

export { BUILD_BUTTON_ID, BUILD_BUTTON_ANCHOR, buildButtonVisible } from './build-button';
export type { BuildButtonSignals } from './build-button';

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

// --- Over-entity health bars — the field report's enemy bars (GDD §2.2) ----
//
// A pooled, screen-space layer that floats a hull/HP bar over every *non-local*
// combat entity (enemy ships, enemy turrets, hostile wave units) that is damaged
// or in combat — never over the local player's own ship (they read their hull
// from the HUD). Folded into the `Hud`: pass `combatants` on the `HudFrame` with
// each entity's HP and **screen-space** position (project world → screen via
// `renderer.projectToScreen`), and set `owner` to the local player's slot. The
// layer registers itself through `Hud.describeLayout`, so no `main.ts` change is
// needed beyond filling the frame.

export {
  combatantGetsBar,
  healthBarModel,
  isLocalCombatant,
  HEALTHBAR_FULL_EPSILON,
  HEALTHBAR_GAP,
  HEALTHBAR_HEIGHT,
  HEALTHBAR_WIDTH,
} from './healthbar';
export type { Combatant, HealthBar } from './healthbar';

export { HealthBarView, HEALTHBAR_ID, HEALTHBAR_ANCHOR } from './healthbar-view';

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

// --- The seam itself (./lobby-flow) ----------------------------------------
//
// The two blocks above describe the order the door and the room are called in.
// `./lobby-flow` **is** that order, in code, asserted headless
// (`./lobby-flow.test.ts` plays a whole match front with no server and no
// canvas) — because M2 was retracted for features that were merged, tested and
// never wired, and prose cannot fail a test.
//
// Platform's whole integration is: hold a `FlowState`, route input into it,
// and drain the `FlowEffect`s it returns.
//
//   let flow = createFlow(defaultFireMode(isTouch));
//
//   function drain({ state, effects }: FlowResult): void {
//     flow = state;
//     for (const effect of effects) {
//       if (effect.kind === 'open-transport') {
//         transport = effect.intent.online ? new WebSocketTransport(...) : new LocalLoopback(...);
//         transport.send({ type: 'join', room: effect.intent.room });
//       } else transport?.send(effect.message);   // lobbyChoice / startMatch
//     }
//   }
//
//   // per frame:  drain(tickFlow(flow, dt))
//   //             entry.visible = flow.screen === 'entry';
//   //             lobby.visible = flow.screen === 'lobby';
//   //             if (flow.screen === 'entry') entry.update(entryModel(flow.entry));
//   //             else if (flow.lobby) lobby.update(lobbyModel(flow.lobby));
//   // on tap:     const hit = entry.hitTest(x, y) / lobby.hitTest(x, y)
//   //             drain(flowTapEntry(flow, hit, rng) / flowTapLobby(flow, hit))
//   // on keydown: drain(flowKey(flow, event.key))
//   // from wire:  welcome    → drain(flowConnected(flow, msg.you, { room: msg.room }))
//   //             lobbyState → drain(flowLobbySlots(flow, msg.slots))
//   //             matchStart → drain(flowMatchStart(flow))   // then build the world
//   //             refused/dropped → drain(flowFailed(flow, ENTRY_ERRORS.full))

export {
  createFlow,
  flowCloseSettings,
  flowConnected,
  flowEliminated,
  flowFailed,
  flowKey,
  flowLobbySlots,
  flowMatchEnded,
  flowMatchStart,
  flowOpenSettings,
  flowTapEnd,
  flowTapEntry,
  flowTapLobby,
  flowTapSettings,
  resetFlow,
  setFlowFireMode,
  tickFlow,
  wireFireMode,
} from './lobby-flow';
export type { FlowEffect, FlowResult, FlowScreen, FlowState } from './lobby-flow';

// --- The Day-7 menus: main-menu settings, end-of-match, connection status ---
//
// Three flat screens that hang off the flow above. Each is the same three-piece
// shape as the lobby: a pure model (with its layout co-located, since a stack of
// rows needs no responsive geometry of its own), and a thin Pixi view. The flow
// owns *when* each is shown; these own *what* each shows.
//
//   settings   ← flow.screen === 'settings'  (from the main menu's SETTINGS)
//   end        ← flow.screen === 'end'        (from flowMatchEnded/flowEliminated)
//   connection ← driven by the transport's ConnectionState, independent of screen
//
// Wiring continues the flow seam:
//   settingsView.hitTest(x,y) → flowTapSettings(flow, target)
//   endView.hitTest(x,y)      → flowTapEnd(flow, target)   // rematch | spectate
//   on `matchEnd`  → flowMatchEnded(flow, msg.winner)
//   on your core's death (from the snapshot) → flowEliminated(flow)
//   connectionView.update(connectionStatusModel({ state: transport.state, online }))

export {
  FONT_BODY,
  FONT_HEADING,
  TEXT_DIM,
  TEXT_PRIMARY,
} from './typography';

export {
  MENU_COLUMN_MAX,
  MENU_PAD,
  MENU_ROW_GAP,
  centeredColumn,
  centeredPanel,
  clamp,
  hitRect,
  menuContent,
} from './menu-geometry';

export {
  DEFAULT_VOLUMES,
  SETTINGS_ID,
  SETTINGS_ROWS,
  VOLUME_CHANNELS,
  VOLUME_STEP,
  VOLUME_STEPS,
  adjustVolume,
  createSettings,
  setReduceVfx,
  setVolume,
  settingsHitTest,
  settingsLayout,
  settingsModel,
  toggleReduceVfx,
  volumeButtons,
  volumeLevel,
} from './settings';
export type {
  SettingsLayout,
  SettingsModel,
  SettingsRowSpec,
  SettingsRowView,
  SettingsState,
  SettingsTarget,
  Volumes,
  VolumeChannel,
} from './settings';

export { SettingsView, SETTINGS_ANCHOR } from './settings-view';

export {
  END_OF_MATCH_ID,
  endButtons,
  endKind,
  endOfMatchHitTest,
  endOfMatchLayout,
  endOfMatchModel,
} from './end-of-match';
export type {
  EndButton,
  EndButtonView,
  EndKind,
  EndOfMatchLayout,
  EndOfMatchModel,
  EndTarget,
  MatchOutcome,
} from './end-of-match';

export { EndOfMatchView, END_OF_MATCH_ANCHOR } from './end-of-match-view';

export {
  CONNECTION_STATUS_ID,
  connectionStatusHitTest,
  connectionStatusLayout,
  connectionStatusModel,
} from './connection-status';
export type {
  ConnectionSeverity,
  ConnectionStatusInput,
  ConnectionStatusLayout,
  ConnectionStatusModel,
  ConnectionTarget,
} from './connection-status';

export { ConnectionStatusView, CONNECTION_STATUS_ANCHOR } from './connection-status-view';

// --- The main menu — the front door a clean boot opens on (GDD §4.6 M7) -----
//
// The screen the field report found missing: the Day-7 menus merged, but boot
// dropped the player straight into a match, so the menu was never wired. PLAY is
// the only door that builds a match world; SETTINGS reuses the screen above.
// The gate that defers the world until PLAY lives in `src/main.ts` — this is the
// same pure-model + Pixi-view pair as every other screen here.

export {
  MAIN_MENU_ID,
  MAIN_MENU_ITEMS,
  MAIN_MENU_TITLE,
  MAIN_MENU_TITLE_HEIGHT,
  MAIN_MENU_BUTTON_HEIGHT,
  MAIN_MENU_BUTTON_HEIGHT_TOUCH,
  mainMenuHitTest,
  mainMenuLayout,
  mainMenuModel,
} from './main-menu';
export type {
  MainMenuButtonView,
  MainMenuItem,
  MainMenuLayout,
  MainMenuLayoutOptions,
  MainMenuModel,
  MainMenuOption,
} from './main-menu';

export { MainMenuView, MAIN_MENU_ANCHOR } from './main-menu-view';

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
