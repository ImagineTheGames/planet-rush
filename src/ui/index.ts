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

// --- Ore split (field rule): banked TOTAL top-left, HELD hold under the ship ---
//
// The held-ore squares that used to sit top-left move under the local ship as a
// compact, pooled, screen-space indicator (same discipline as the health bar),
// leaving the top-left to show only the banked TOTAL — so the two ore numbers can
// never be confused. `ore-hold` is the pure model + geometry; `ore-hold-view` is
// the thin Pixi layer, which the `Hud` owns and registers under `full`.
export {
  holdShown,
  oreHoldModel,
  oreHoldRowWidth,
  oreHoldBounds,
  ORE_HOLD_PIP,
  ORE_HOLD_PIP_GAP,
  ORE_HOLD_SHIP_GAP,
} from './ore-hold';
export type { OreHold } from './ore-hold';

export { OreHoldView, ORE_HOLD_ID, ORE_HOLD_ANCHOR } from './ore-hold-view';
export type { DrawnOreHold } from './ore-hold-view';

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
export type { DrawnUpgradeWedge } from './build-wheel-view';

// --- Open-build-wheel button — the touch E-equivalent, a permanent HUD ------
//     fixture near your own planet (GDD §2.2, §2.4); drawn by touch-visuals,
//     its persistence rule + layout contract owned here.

export { BUILD_BUTTON_ID, BUILD_BUTTON_ANCHOR, buildButtonVisible } from './build-button';
export type { BuildButtonSignals } from './build-button';

// --- Upgrade WHEEL — the only place ship stats appear (GDD §2.2, §2.5) ------
//
// Rebuilt from a table-panel into a radial wheel (field report v0.2 — "it should
// be a wheel menu as well"), drawn by the same view as the Build wheel. One wedge
// per track, data-driven off the ladder so p2-03's projectile tracks appear for
// free.

export {
  upgradeWheelModel,
  upgradeWedge,
  upgradeWedgeAngle,
  upgradeWedgeArc,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  UPGRADE_WHEEL_ORDER,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
  CLASS_NAMES,
} from './upgrade-wheel';
export type {
  UpgradeWheelModel,
  UpgradeWheelSignals,
  UpgradeWedge,
  UpgradeWedgeState,
  UpgradeTiers,
  UpgradeLadder,
  UpgradeTrackSpec,
} from './upgrade-wheel';

// --- Shared wheel open/close transition (the leak-safe fix — field report v0.2) --

export { WheelToggle, WHEEL_TRANSITION_SECONDS } from './wheel-toggle';
export type { WheelPhase } from './wheel-toggle';

// --- Shared press & action feedback (field report v0.2.2) ------------------
//
// The ONE place press/confirm feel is implemented: an immediate pressed tell
// (scale + glow) on touch-down, a rejected shake/flash for a disabled control,
// and — driven from the sim's real state change, not the press — a confirmation
// pulse + cost-float + repair shimmer. The wheel view samples the `PressFeedback`
// driver per wedge; confirmations are derived by `detectConfirmations` from the
// same sim numbers the HUD already reads (press-feedback.ts).

export {
  PressFeedback,
  detectConfirmations,
  buildSegmentIndex,
  pressPulse,
  rejectPulse,
  confirmPulse,
  NEUTRAL_FEEDBACK,
  PRESS_FLASH_SECONDS,
  PRESS_SCALE,
  PRESS_GLOW,
  REJECT_SECONDS,
  REJECT_SHAKE_PX,
  REJECT_FLASH,
  CONFIRM_SECONDS,
  CONFIRM_PULSE,
  CONFIRM_SHIMMER,
  CONFIRM_REPEAT_GAP,
  COST_FLOAT_RISE,
} from './press-feedback';
export type {
  PressSurface,
  PressPulse,
  RejectPulse,
  ConfirmPulse,
  CostFloat,
  Confirmation,
  ControlFeedback,
  WheelSnapshot,
} from './press-feedback';

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

// --- Over-entity health bars — enemy bars + the own ship (GDD §2.2) ---------
//
// A pooled, screen-space layer that floats a hull/HP bar over every combat
// entity that is damaged or in combat: enemy ships, enemy turrets, hostile wave
// units — and, per field request v0.1.1, the local player's **own ship**, styled
// distinctly (player colour, slightly larger) so it reads as mine. The own ship
// is fed to the `Hud` via `hull`/`maxHull`/`shipRadius`/`shipFiring` on the
// `HudFrame` (the HUD synthesises its `local` combatant at screen centre); the
// enemies come on `combatants`, each with its HP and **screen-space** position
// (project world → screen via `renderer.projectToScreen`), with `owner` set to
// the local player's slot. The own player's *turrets* still get no bar (they read
// off the HOME HP readout). The layer registers itself through
// `Hud.describeLayout`. It is the single truth for own-ship hull now: the
// top-right `hull-hud` readout was removed (field report v0.2 — "it's already
// appearing on my ship").

export {
  combatantGetsBar,
  healthBarModel,
  isLocalCombatant,
  HEALTHBAR_FULL_EPSILON,
  HEALTHBAR_GAP,
  HEALTHBAR_HEIGHT,
  HEALTHBAR_WIDTH,
  HEALTHBAR_LOCAL_HEIGHT,
  HEALTHBAR_LOCAL_WIDTH,
} from './healthbar';
export type { Combatant, HealthBar } from './healthbar';

export { HealthBarView, HEALTHBAR_ID, HEALTHBAR_ANCHOR } from './healthbar-view';

// --- Player-name labels over ships and owned planets (field request v0.2.1) --
//
// The same pure-model / pooled-view split as the health bars, stacked with them
// so a ship's name, bar and hull read as one unit ([[nameplates]] rule 1): the
// pure `nameplateModel` decides who gets a label, its text (from a per-slot
// `NameTable`) and its identity colour; `NameplateView` paints and self-registers
// under `full`. The label-bearing entities are fed to the `Hud` on `nameables`
// (ships + owned planets, screen-space) with a `names` table off the lobby
// (`playerNameTable`); the local ship's own label is optional-off (default off).

export {
  nameplateModel,
  nameplateGetsLabel,
  resolveName,
  fallbackName,
  NAMEPLATE_MAX_CHARS,
  NAMEPLATE_FULL_ALPHA,
  NAMEPLATE_FADE_ALPHA,
} from './nameplates';
export type { Nameable, Nameplate, NameplateKind, NameplateOptions, NameTable } from './nameplates';

export {
  NameplateView,
  NAMEPLATE_ID,
  NAMEPLATE_ANCHOR,
  NAMEPLATE_SHIP_GAP,
  NAMEPLATE_PLANET_GAP,
} from './nameplates-view';
export type { DrawnNameplate } from './nameplates-view';

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
  DEFAULT_PLAYER_NAME,
  PLAYER_NAME_MAX_CHARS,
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
  nameFor,
  normalizePlayerName,
  normalizeRoomCode,
  playerNameTable,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  setPlayerName,
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
  DeathCause,
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

// --- The map picker — pick the arena before a match (GDD §2.1; registry m8-01) --
//
// Four cards on the PLAY flow, each a mini layout preview drawn from the
// registry's own planet positions so the picture can never drift from the board.
// `octagon` preselected; `diamond` carries a VETERAN tag. The chosen id is
// persisted (same seam as the fire mode) and fed to `bootOfflineMatch(seed, mapId)`.
// Same three-piece shape as every screen here: a pure model with co-located
// geometry (`./map-picker`) and a thin Pixi view (`./map-picker-view`).

export {
  MAP_STORAGE_KEY,
  MAP_PICKER_ID,
  MAP_ORDER,
  MAP_PREVIEW_SLOTS,
  MAP_PREVIEW_SEED,
  VETERAN_MAP_ID,
  MAP_CARD_GAP,
  MAP_CARD_MIN_WIDTH,
  MAP_CARD_MAX_WIDTH,
  MAP_CARD_MIN_HEIGHT,
  MAP_CARD_MAX_HEIGHT,
  mapPickerModel,
  mapPickerLayout,
  mapPickerHitTest,
  mapPreview,
  normalizeMapId,
  mapIndexOf,
  mapIdAt,
  registryPlanets,
} from './map-picker';
export type {
  MapCardModel,
  MapCardShape,
  MapPickerLayout,
  MapPickerModel,
  MapPreview,
} from './map-picker';

export { MapPickerView, MAP_PICKER_ANCHOR } from './map-picker-view';

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
