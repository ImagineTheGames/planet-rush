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
 * stats appear), **your own station's HP** in your player colour (§2.2), the
 * **under-attack alarm** with its sustained-damage trigger and screen-edge arrow
 * home (§2.2, a mechanic and not polish), and the remaining two onboarding
 * prompts (§2.10).
 *
 * M4 surface: the **8-slot lobby** (§2.1) — room code create/join, the roster
 * with its player colours (§5.2 / style-guide §3.1), ship-class select with the
 * four role blurbs and the Vanguard preselected (§2.11), the host's per-seat bot
 * difficulty picks (§2.9), and the RUSH! countdown, in a layout that holds on a
 * phone in landscape and on a desktop — reached through the **entry screen**
 * (§4.2), whose three doors are SOLO (no server: §4.8 risk 6), HOST and
 * JOIN, the last behind an on-screen keypad because the game is a
 * canvas with no text field to focus.
 */

export { Hud } from './hud';
export type { HudFrame } from './hud';

// The latch every screen shell tears down through, so a promise, a timer or a
// socket message that lands after `teardown()` cannot draw into destroyed
// Graphics (u12-01 — the one uncaught TypeError on every clean boot).
export { createShellLifetime } from './shell-lifetime';
export type { ShellLifetime } from './shell-lifetime';

// THE TITLE GATE (a0-50) — the menu is behind a door, and the door gets
// operated. A DOM overlay above the game canvas, deliberately NOT a Pixi port:
// `clip-path`, `background-clip:text`, `-webkit-text-stroke` and `drop-shadow()`
// have no cheap Pixi equivalent, and the doorway punch reveals the real
// `MainMenuView` rather than a picture of one.
// `gateEnabled` is the `?gate=0` read: the automated harnesses walk through the
// front door on their way somewhere else, and a door is a thing a person
// operates (see the function's own note).
export { TitleGate, browserGateDom, gateEnabled, GAME_NAME } from './title-gate';
export type { GateDom, GateQuality, TitleGateOptions, GatePhase } from './title-gate';

export { Onboarding, PromptId, oreWasSpent, resolvePromptText } from './onboarding';
export type { OnboardingMemory, OnboardingSignals, SpendFacts } from './onboarding';
// Where a completed prompt is remembered between matches (u15-01): the ONE
// career profile, never a storage scheme of onboarding's own.
export { createProfileOnboardingMemory } from './onboarding-memory';

export { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
export type { WaveClock } from './wave-clock';

export { oreHudModel, oreFlashOn } from './ore-hud';
export type { OreHudModel } from './ore-hud';

// The one affordability boundary the Build wheel and the Upgrade wheel share, so
// "bank == cost is buyable" is decided in exactly one place (field report v0.2.2).
export { affordable, AFFORD_EPSILON } from './affordability';

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

export { controlsStripRows, controlsStripView, showControlsStrip, BUILD_AWAY_HINT } from './controls-strip';
export type { StripRow } from './controls-strip';

// --- Build & Upgrade wheel (GDD §2.5) --------------------------------------

export {
  buildWheelModel,
  canOpenWheel,
  segmentState,
  segmentCost,
  segmentAngle,
  segmentAtDirection,
  spendableOre,
  repairWedgeInfo,
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
  RepairWedgeInfo,
} from './build-wheel';

export { BuildWheelView } from './build-wheel-view';
export type { DrawnBuildWedge, DrawnUpgradeWedge } from './build-wheel-view';

// --- Open-build-wheel button — the touch E-equivalent, a permanent HUD ------
//     fixture near your own station (GDD §2.2, §2.4); drawn by touch-visuals,
//     its persistence rule + layout contract owned here.

export {
  BUILD_BUTTON_ID,
  BUILD_BUTTON_ANCHOR,
  buildButtonVisible,
  buildButtonHighlighted,
} from './build-button';
export type { BuildButtonSignals } from './build-button';

// --- Upgrade WHEEL — where ship stats appear in a match (GDD §2.2, §2.5) ----
//
// Rebuilt from a table-panel into a radial wheel (field report v0.2 — "it should
// be a wheel menu as well"), drawn by the same view as the Build wheel. One wedge
// per track, data-driven off the ladder so p2-03's projectile tracks appear for
// free.

export {
  upgradeWheelModel,
  upgradeWheelSlots,
  weaponSummary,
  upgradeWedge,
  upgradeWedgeAngle,
  upgradeWedgeArc,
  trackBase,
  trackValue,
  formatTrackValue,
  UpgradeTrack,
  UPGRADE_WHEEL_ORDER,
  WHEEL_TRACK_ORDER,
  WEAPON_GROUP,
  TRACK_ORDER,
  STOCK_TIERS,
  UPGRADE_LADDER,
  CLASS_NAMES,
} from './upgrade-wheel';
export type {
  UpgradeWheelModel,
  UpgradeWheelSignals,
  UpgradeWedge,
  UpgradeWedgeKind,
  UpgradeWedgeState,
  UpgradeSlot,
  UpgradeSummaryPip,
  UpgradeTiers,
  UpgradeLadder,
  UpgradeTrackSpec,
} from './upgrade-wheel';

// --- Shared wheel open/close transition (the leak-safe fix — field report v0.2) --

export { WheelToggle, WHEEL_TRANSITION_SECONDS } from './wheel-toggle';
export type { WheelPhase } from './wheel-toggle';

// --- Wheel BACK navigation — the hub/ESC "go up a level" model (field report v0.2.4) --

export {
  WHEEL_LEVELS,
  HUB_CLOSE_LABEL,
  HUB_BACK_LABEL,
  wheelDepth,
  wheelBack,
  hubBack,
  wheelLevel,
} from './wheel-nav';
export type { WheelLevel, HubBack } from './wheel-nav';

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

// --- UI sound seam (field report v0.2.4+) ----------------------------------
//
// The narrow seam a UI control calls to make a sound — the shape haptics uses.
// The UI names an event (press / confirm / reject); the audio module behind the
// seam decides the sound, the SFX-slider gain and the death-hush ducking. Wired
// into the ONE shared control component (PressFeedback) so every wheel/menu
// control is heard exactly as it is seen (sfx.ts).
export { NO_UI_SFX } from './sfx';
export type { UiCue, UiSfx } from './sfx';

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

// --- Own-station HP, in the player's colour (GDD §2.2) ----------------------

export { stationHpModel, stationHpFlashOn, coreHpReadout, playerColor, STATION_CRITICAL_FRACTION } from './station-hp';
export type { StationHpModel } from './station-hp';

// --- Respawn countdown ("RESPAWNING 3…", field request v0.2.2) --------------
//
// While the local ship is dead and a respawn is coming, a centred "RESPAWNING N…"
// overlay in the player's colour counts down the CEILING of the sim's respawn
// timer (never a UI-side clock). It is fed via `respawnTimer`/`eliminated` on the
// `HudFrame`; a *final* death stands it down so the DEFEATED flow (p1-12) owns the
// screen alone. Decision in ./respawn-countdown, geometry in ./hud-geometry, and
// the layer registers itself through `Hud.describeLayout`.

export { respawnCountdownModel } from './respawn-countdown';
export type { RespawnCountdownModel, RespawnCountdownInput } from './respawn-countdown';

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

// --- Player-name labels over ships and owned stations (field request v0.2.1) --
//
// The same pure-model / pooled-view split as the health bars, stacked with them
// so a ship's name, bar and hull read as one unit ([[nameplates]] rule 1): the
// pure `nameplateModel` decides who gets a label, its text (from a per-slot
// `NameTable`) and its identity colour; `NameplateView` paints and self-registers
// under `full`. The label-bearing entities are fed to the `Hud` on `nameables`
// (ships + owned stations, screen-space) with a `names` table off the lobby
// (`playerNameTable`); the local ship's own label is optional-off (default off).

export {
  nameplateModel,
  nameplateGetsLabel,
  resolveName,
  resolveDifficultySuffix,
  // The `FRIENDLY A` / `ENEMY B` side label every nameplate carries in TEAMS (m10
  // — ratified: colour alone is insufficient, because identity colour is per-SLOT
  // — worded relative to the viewer since u3), and its blue/red motif colour.
  resolveTeamLabel,
  resolveTeamRelation,
  fallbackName,
  NAMEPLATE_MAX_CHARS,
  // The one label opacity there is: a name is lit whatever its ship is doing
  // (a0-04 — the developer withdrew the combat fade, so there is no second level).
  NAMEPLATE_FULL_ALPHA,
} from './nameplates';
export type {
  DifficultyTable,
  Nameable,
  Nameplate,
  NameplateKind,
  NameplateOptions,
  NameTable,
  TeamTable,
} from './nameplates';

export {
  NameplateView,
  NAMEPLATE_ID,
  NAMEPLATE_ANCHOR,
  NAMEPLATE_SHIP_GAP,
  NAMEPLATE_STATION_GAP,
  // The label's clearance above the health-bar cluster — rule 3's surviving half
  // after a0-04 retired the combat fade, so it is exported to be pinned by a test.
  nameplateClusterClearance,
} from './nameplates-view';
export type { DrawnNameplate } from './nameplates-view';

// --- Who is still flying (a0-76) -------------------------------------------
//
// The developer: *"do we have any indication when a player loses connection …
// and when they join back as well … we need something to indicate that so other
// players know"*. `./connection-status` and `src/net/link-loss` are about YOUR
// socket; this is the other side of the same drop — a peer's seat, named, and
// named again when they return.
//
// The same pure-model / pooled-view split as the nameplates above:
// `PeerPresenceLog` holds one state per seat and produces the transition lines,
// `PeerPresenceView` paints them under the wave clock and self-registers.
//
// **Wiring seam**, for whoever boots the client (`src/main.ts`, Platform) — the
// log is fed from AUTHORITY and from nothing else, because a client cannot know
// why another client went quiet:
//
//   const presence = new PeerPresenceLog({ local: LOCAL_PLAYER, names });
//   session.observe((m) => {
//     if (m.type === 'playerSubstituted') presence.noteDropped(m.player, now, { held: m.heldForMatch });
//     else if (m.type === 'playerReclaimed') presence.noteBack(m.player, now);
//     else if (m.type === 'lobbyState') presence.noteBots(m.slots.map((s) => s.isBot), now);
//     else if (m.type === 'matchEnd') presence.noteMatchEnd(now);
//   });
//   hudFrame.presence = presence.read(now);   // once a frame
export {
  PeerPresenceLog,
  applyPresenceMessage,
  presenceClause,
  presenceText,
  PRESENCE_REASON,
  PRESENCE_TELL_SECONDS,
  PRESENCE_FADE,
  PRESENCE_MAX_LINES,
  BOT_CLAUSE,
  BOT_CLAUSE_CLEARED,
} from './peer-presence';
export type { PeerPresence, PresenceTell, SeatPresence } from './peer-presence';
export { PeerPresenceView, PRESENCE_ID, PRESENCE_ANCHOR } from './peer-presence-view';
export type { DrawnPresenceLine } from './peer-presence-view';

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
//   //             'seat'  → cycleSeatCharacter(state, hit.index)   (host only)
//   //             'rush'  → pressRush(state)  → session.start()
//   // from the wire: applyLobbySlots(state, msg.slots) on `lobbyState`,
//   //             startLobbyMatch(state) on `matchStart`, and send
//   //             botDifficulties(state) with the host's `lobbyChoice` (the
//   //             tiers the chosen cast flies at — a0-06), and hand
//   //             lobbyRosterCast(state) to `bootOfflineMatch` offline.
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
  CHARACTER_CYCLE,
  DIFFICULTY_LABELS,
  SEAT_HELP_GLYPH,
  LOBBY_SLOTS,
  MAX_TEAMS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RUSH_COUNTDOWN_SECONDS,
  RUSH_LABEL,
  // The hull tiles' stats — pips AND numbers (u4, ratified 2026-08-05; GDD §2.5
  // / §2.11 amended). `shipStatLines` derives both channels from ONE value off
  // the sim's `SHIP_STATS`, so nothing downstream can print a figure that
  // disagrees with its bar. `STAT_PIP_COLORS` pins the pips as chrome.
  STAT_PIPS,
  STAT_PIP_COLORS,
  shipStatLines,
  applyLobbySlots,
  botDifficulties,
  canStart,
  castForEmptySeat,
  claimChipLabel,
  claimLabel,
  classLocked,
  colorName,
  countdownLabel,
  createLobby,
  cycleAbundance,
  cycleSeatCharacter,
  cycleSeatState,
  cycleSeatTeam,
  defaultCharacterForEmptySeat,
  seatDifficulty,
  // Where a lobby slot lands in the sim's DENSE roster (a0-11) — the two
  // numberings stop agreeing the moment a seat is left open or closed.
  denseSeatIndex,
  eraseRoomCode,
  hostControls,
  isJoinableRoomCode,
  // "In the match" — a human or a bot, and nothing else. Every count on the
  // screen is taken through it (GDD §2.1, amended 2026-08-07).
  isParticipant,
  // …and what a seat IS in the lobby doing the reading: in SOLO there is no OPEN
  // seat, so one stored as OPEN reads BOT, and the host's tap walks two rungs
  // instead of three (a0-31 — "no one can join in solo"). `isBotSeat` is the
  // predicate they feed: "this seat flies a bot", the one every reader shares.
  isBotSeat,
  occupantOf,
  seatStateCycle,
  lobbyMatchConfig,
  lobbyModel,
  // The authored sides, in the two orders the two ends index by (m10 teams-wire):
  // per-SLOT for the server, DENSE for the world the client builds itself.
  lobbyRosterCast,
  lobbyRosterTeams,
  // …and the host's per-seat OPEN / BOT / CLOSED authoring, in the SLOT order the
  // server indexes it by (a0-11 — `LobbyChoiceMessage.seats`).
  lobbyWireSeats,
  lobbyWireTeams,
  makeRoomCode,
  matchSizeOf,
  nameFor,
  normalizePlayerName,
  normalizeRoomCode,
  playerNameTable,
  pressRush,
  seatLocalPlayer,
  selectMap,
  selectShipClass,
  // The room's THREE screens (u10-01, the developer: *"select ship and select map
  // need to open different pages … only show 1 ship and 1 map in lobby"*). The
  // roster keeps one card of each — the pick — and each card opens a page. BACK
  // returns with the pick exactly as it was, because a pick is applied when it is
  // made and there is nothing to cancel.
  LOBBY_SCREENS,
  // The guest's footer line, on the model so the copy audit can read it (a0-108).
  LOBBY_WAITING_FOR_HOST,
  MAP_PICK_GUEST_LABEL,
  MAP_PICK_LABEL,
  SHIP_PICK_LABEL,
  closeLobbyScreen,
  openMapSelect,
  openShipSelect,
  pickMap,
  pickShipClass,
  shipCardFor,
  setPlayerName,
  startLobbyMatch,
  // Why RUSH! is refused, in the words the screen shows (a0-11; GDD §2.1
  // amended) — a refused button that says nothing is a dead control.
  NEEDS_TWO,
  NEEDS_TWO_SIDES,
  startRefusal,
  // The one place a side's player-facing name lives — `FRIENDLY A` / `ENEMY B`,
  // the WORD relative to the viewer and the LETTER absolute — shared by the lobby
  // roster and the in-match nameplates so they can never disagree. `SIDE_COLORS`
  // is the motif's blue/red reinforcement (u3, ratified 2026-08-05).
  SIDE_COLORS,
  SIDE_WORDS,
  sideRelation,
  // The slots on one player's side, off the lobby's own `team` table — the roster
  // the end-of-match summary reads to answer "did MY side win?"
  // (a0-09). The lobby's twin of `art/audio/scope` `deriveAlarmAllies`.
  sideRosterOf,
  teamLabel,
  teamName,
  viewerTeamOf,
  tickLobby,
  toggleClaim,
  toggleMode,
  typeRoomCode,
  showsClaimControl,
} from './lobby';
export type {
  LobbyModel,
  LobbyOptions,
  SideRelation,
  LobbyPhase,
  LobbyScreen,
  LobbySeat,
  LobbySeatView,
  LobbyState,
  LobbyTeamCount,
  SeatOccupant,
  ShipClassOption,
  ShipStatKey,
  ShipStatLine,
} from './lobby';

export {
  CLASS_TILE_MAX,
  CLASS_TILE_MIN,
  // Inside one hull tile: which of its four blocks fit at this size, and where
  // each stat cell goes (u4). The view draws what these return and decides
  // nothing, so "six stats legible at phone scale" is a headless assertion.
  STAT_COUNT,
  classStatCell,
  classTileContent,
  LOBBY_PAD,
  // Row and button HEIGHTS are no longer lobby literals: since u7-03 they come
  // from the frame (`src/art/materials` `rosterRowHeight` / `plateHeight`), which
  // floors every one of them at the thumb on every platform rather than choosing
  // between a desktop number and a touch number.
  RUSH_WIDTH_MAX,
  TWO_COLUMN_MIN_WIDTH,
  // The lobby's two summary blocks (u10-01) — one hull card, one arena card, each
  // an eyebrow over a card and the whole block a hit target.
  PICK_CARD_MAX_HEIGHT,
  PICK_CARD_MIN_WIDTH,
  PICK_LABEL_HEIGHT,
  // …and the tile placement the SHIP SELECT screen borrows, so the four hulls are
  // arranged by the same function (and the same floors) that arranged them here.
  placeClassTiles,
  lobbyHitTest,
  lobbyLayout,
} from './lobby-geometry';
export type {
  ClassTileContent,
  Insets,
  LobbyLayout,
  LobbyLayoutOptions,
  LobbyTarget,
  TileShape,
} from './lobby-geometry';

export { LobbyView, LOBBY_ID, LOBBY_ANCHOR } from './lobby-view';

// --- The two screens the lobby's cards open (u10-01) ------------------------
//
// The developer, 2026-08-07, over a screenshot of the live lobby: *"in the lobby
// page select ship and select map need to open different pages, we should only
// show 1 ship and 1 map in lobby because it's too cluttered now"*. CREW MUSTER
// was carrying eight roster rows, four hull tiles of six stats each and six arena
// cards on one 390px screen; these are where the four and the six went.
//
// Both are ordinary members of this directory's three-piece set — a pure model
// with its layout co-located, and a thin view that draws it — and both reuse the
// renderer the lobby already had rather than growing a second one: the hull tile
// is `./class-tile-view` (shared with the lobby's one card, so the u4 "figure and
// pips are two renderings of one value" rule has one home), and the arena card is
// the picker's own `MapPickerView`.
export {
  SHIP_SELECT_BACK_LABEL,
  SHIP_SELECT_EYEBROW,
  SHIP_SELECT_HINT,
  SHIP_SELECT_ID,
  SHIP_SELECT_LOCKED_HINT,
  SHIP_SELECT_TITLE,
  SHIP_TILE_MAX,
  sameShipTarget,
  shipClassAt,
  shipSelectHitTest,
  shipSelectLayout,
  shipSelectModel,
  shipSelectPlateRoles,
  shipSelectTargetKey,
} from './ship-select';
export type {
  ShipSelectLayout,
  ShipSelectLayoutOptions,
  ShipSelectModel,
  ShipSelectPointer,
  ShipSelectState,
  ShipSelectTarget,
  ShipSelectTileView,
} from './ship-select';
export { ShipSelectView, SHIP_SELECT_ANCHOR } from './ship-select-view';

export {
  MAP_SELECT_BACK_LABEL,
  MAP_SELECT_EYEBROW,
  MAP_SELECT_GUEST_HINT,
  MAP_SELECT_HINT,
  MAP_SELECT_ID,
  MAP_SELECT_TITLE,
  mapIdAtCard,
  mapSelectHitTest,
  mapSelectLayout,
  mapSelectModel,
  mapSelectPlateRoles,
  mapSelectTargetKey,
  sameMapTarget,
} from './map-select';
export type {
  MapSelectLayout,
  MapSelectLayoutOptions,
  MapSelectModel,
  MapSelectPointer,
  MapSelectState,
  MapSelectTarget,
} from './map-select';
export { MapSelectView, MAP_SELECT_ANCHOR } from './map-select-view';

// The hull tile, drawn — shared by the lobby's one summary card and SHIP SELECT's
// four (u10-01). One renderer, because two screens drawing the same six figures
// and five-pip bars must not be two drawings of them.
export {
  createClassTileNodes,
  drawClassTile,
  hideClassTile,
  STAT_MIN_PX,
  STAT_PX,
  TILE_BLURB_PX,
  TILE_HULL_PX,
  TILE_NAME_PX,
} from './class-tile-view';
export type { ClassTileNodes, ClassTilePaint } from './class-tile-view';

// --- The door into a room (GDD §2.1, §4.2, §4.8) ---------------------------
//
// The screen *before* the lobby: CAMPAIGN / SOLO / HOST /
// JOIN, and the on-screen keypad a room code is typed on (the game is a
// canvas — there is no DOM input to focus, see `./lobby-entry`). CAMPAIGN is a
// teaser: it is lit and pressable, and pressing it says `Coming Soon…` without
// going anywhere (`chooseDoor` returns no intent for it — u9-01).
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
  ENTRY_COMING_SOON,
  ENTRY_ERRORS,
  doorOption,
  KEYPAD_COLUMNS,
  KEYPAD_KEYS,
  KEYPAD_ROWS,
  backToDoors,
  canSubmitJoin,
  chooseDoor,
  chooseJoinMode,
  createEntry,
  entryConnected,
  entryErrorFor,
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
  EntryNarration,
  EntryResult,
  EntryScreen,
  EntrySegmentView,
  EntryState,
  EntryStatus,
} from './lobby-entry';

// --- JOIN's second mode: the lobby browser (u17-01) -------------------------
//
// The developer: *"join gives you both options BROWSE and ENTER ROOM CODE"* and
// *"there should be a join button to join it"*. The read and the tap are
// `src/net/lobby-list.ts`'s (n10-01); everything below is what the player sees —
// the rows, the age stamp over them, the sentence an empty list says, and the
// refusal a row that filled up answers with.
export {
  BROWSE_COPY,
  BROWSE_NO_PING,
  BROWSE_POLL_MS,
  BROWSE_TICK_MS,
  JOIN_MODES,
  JOIN_MODE_LABELS,
  browseCleared,
  browseJoinFailed,
  browseJoined,
  browseLive,
  browseModel,
  browseReceived,
  browseRefreshFailed,
  browseShouldRefresh,
  browseStamp,
  createBrowse,
  pressBrowseRow,
} from './lobby-browser';
export type {
  BrowseModel,
  BrowseRow,
  BrowseRowModel,
  BrowseRowState,
  BrowseState,
  JoinMode,
} from './lobby-browser';
export { LobbyBrowserView } from './lobby-browser-view';

export {
  entryHitTest,
  entryLayout,
  entryTargetKey,
  DOOR_COUNT,
  // DOOR_HEIGHT / DOOR_HEIGHT_TOUCH are gone (u7-04): a door is a Gantry PLATE
  // now, so its height comes from `frameMetrics` like every other plate in the
  // set rather than from a per-screen constant. See `./lobby-geometry`.
  KEY_MAX,
  KEY_MIN,
} from './lobby-geometry';
export type { DoorShape, EntryLayout, EntryTarget, JoinSwitchShape } from './lobby-geometry';

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
  FLOW_SCREENS,
  createFlow,
  flowCloseHangar,
  flowConnected,
  flowEliminated,
  flowFailed,
  flowKey,
  flowLobbySlots,
  flowMatchEnded,
  flowMatchStart,
  flowOpenHangar,
  flowScreenHandler,
  flowTapEnd,
  flowTapEntry,
  flowTapHangar,
  flowTapLobby,
  // …and the two screens a lobby card opens (u10-01). Separate handlers rather
  // than more `LobbyTarget` cases, because each screen owns the display while it
  // is up and hit-tests its own geometry.
  flowTapMapSelect,
  flowTapShipSelect,
  resetFlow,
  setFlowFireMode,
  setFlowProfile,
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
//   settings   ← the shell's own SETTINGS screen. NOT a flow screen: the flow
//                has never rendered, stored or read a setting, and the model
//                that pretended otherwise was deleted in a0-95. The two live
//                screens (menu and pause) share `./settings` `commitSettings`.
//   end        ← flow.screen === 'end'        (from flowMatchEnded/flowEliminated)
//   connection ← driven by the transport's ConnectionState, independent of screen
//
// Wiring continues the flow seam:
//   settingsView.hitTest(x,y) → `./settings` `commitSettings` (the one seam)
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
  // The FIRE MODE chip's three words. AUTO-FIRE is the LOCKED reading under Tap
  // Commander, where the pilot holds the trigger; the ratified AUTO-AIM / MANUAL
  // pair is the sticks scheme's, where the player does (a0-100b).
  AUTO_AIM_LABEL,
  AUTO_FIRE_LABEL,
  CONTROL_SCHEME_STORAGE,
  DEFAULT_VOLUMES,
  MANUAL_LABEL,
  SETTINGS_EYEBROW,
  SETTINGS_HELP,
  SETTINGS_HELP_GLYPH,
  SETTINGS_ID,
  SETTINGS_ROWS,
  SETTINGS_STORAGE,
  STICKS_LABELS,
  TAP_COMMANDER_LABEL,
  VOLUME_CHANNELS,
  VOLUME_STEP,
  VOLUME_STEPS,
  adjustVolume,
  applyVolumes,
  commitFireMode,
  commitSettings,
  controlsDevice,
  controlsValue,
  createSettings,
  fireModeLocked,
  fireModeValue,
  loadSettings,
  parseControlScheme,
  parseReduceVfx,
  parseVolume,
  sameTarget,
  saveSettings,
  setReduceVfx,
  setVolume,
  settingsHelp,
  settingsHelpStep,
  settingsHitTest,
  settingsLayout,
  settingsModel,
  settingsRowKey,
  storedControlScheme,
  storedReduceVfx,
  storedVolume,
  toggleReduceVfx,
  volumeButtons,
  volumeLevel,
} from './settings';
export type {
  ControlScheme,
  ControlsDeviceInputs,
  FireModeCommit,
  SettingsCommit,
  SettingsControlState,
  SettingsHelp,
  SettingsLayout,
  SettingsModel,
  SettingsPointer,
  SettingsRowKey,
  SettingsRowSpec,
  SettingsRowView,
  SettingsSink,
  SettingsState,
  SettingsStorage,
  SettingsTarget,
  SettingsValueTarget,
  VolumeMixer,
  Volumes,
  VolumeChannel,
} from './settings';

export { SettingsView, SETTINGS_ANCHOR } from './settings-view';

export {
  END_OF_MATCH_EYEBROW,
  END_OF_MATCH_ID,
  endButtonPlate,
  endButtons,
  endKind,
  endOfMatchHitTest,
  endOfMatchLayout,
  endOfMatchModel,
  // The summary's ONE allegiance question (a0-09): is that player on my side?
  // Asked here rather than re-derived, so the headline, the line under it and the
  // identity rule can never answer it three ways.
  onYourSide,
} from './end-of-match';
export type {
  DeathCause,
  EndButton,
  EndButtonView,
  EndKind,
  EndOfMatchLayout,
  EndOfMatchModel,
  EndPointer,
  EndSummaryLayout,
  EndTarget,
  MatchOutcome,
} from './end-of-match';

export { EndOfMatchView, END_OF_MATCH_ANCHOR } from './end-of-match-view';

// --- The summary as a choreographed sequence (pr-05, plan §6) ---------------
//
// The end screen counts its stats up, fills the level bar toward the next level,
// and is skippable at any moment onto exactly the same numbers. `buildSummary`
// fixes every value at teardown; `summaryFrame` reads that timeline at an
// instant and is pure in `(sequence, elapsed, skipped)`.

export {
  SUMMARY_MATCH_TIME_LABEL,
  SUMMARY_MAX_LEVEL_UPS,
  SUMMARY_ROW_ORDER,
  SUMMARY_TIMING,
  buildSummary,
  formatMatchTime,
  summaryFrame,
} from './summary-sequence';
export type {
  SummaryFrame,
  SummaryFrameOptions,
  SummaryInput,
  SummaryPhase,
  SummaryRow,
  SummaryRowFrame,
  SummaryRowKey,
  SummarySequence,
} from './summary-sequence';

// --- The pause menu — exit / settings mid-match, offline-only pause (p10) ----
//
// ESC (or a touch corner button) opens an overlay over a match in progress:
// RESUME / SETTINGS / EXIT TO MENU, with EXIT behind a "Leave the match?"
// confirm. Offline the sim FREEZES while it is up (loop-gated in `src/main.ts`);
// online it shows over a running sim — that distinction is the `pausable` flag
// routed through `shouldFreezeSim`, nothing the overlay itself knows.

export {
  PAUSE_ANCHOR,
  PAUSE_BUTTON_ANCHOR,
  PAUSE_BUTTON_ID,
  PAUSE_BUTTON_LEFT,
  PAUSE_BUTTON_MARGIN,
  PAUSE_BUTTON_SIZE,
  PAUSE_ID,
  isLayeredOverPause,
  isPauseOpen,
  nextPauseScreen,
  pauseAllowsDownloadLog,
  pauseButtonPlate,
  pauseButtonRect,
  pauseButtonVisible,
  pauseButtons,
  pauseHitTest,
  pauseLayout,
  pauseMenuModel,
  shouldFreezeSim,
} from './pause-menu';
export type {
  PauseAction,
  PauseButton,
  PauseButtonSignals,
  PauseButtonView,
  PauseLayout,
  PauseLayoutOptions,
  PauseMenuModel,
  PausePointer,
  PauseScreen,
  PauseTarget,
} from './pause-menu';

export { PauseMenuView } from './pause-menu-view';

// Where the DOWNLOAD LOG offer may stand in a match (a0-98) — a0-97's rule,
// generalised past pause. Beside the pause exports because it composes them.
export {
  kickOutClaimsTheGlass,
  matchLogOffer,
  screenClaimsTheDisplay,
  sessionHasDropped,
} from './log-offer';
export type {
  MatchGlassOwner,
  MatchLogOfferReason,
  MatchLogOfferState,
  SessionLinkState,
} from './log-offer';

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

// --- Online words: allocator failures, reconnect-ended events, region ------
//
// The one place `src/net`'s reasons become a player's words (M3/online step 3).
// The front door ({@link ./lobby-entry} `entryErrorFor`) and the connection
// overlay ({@link ./connection-status}) both draw their copy from here, so a
// failure reads the same wherever it appears. Region is modelled and suppressed
// at one region (`regionPickerVisible === false`) — present in the code, hidden
// on screen until a second region lands.

export {
  CROSS_REGION_PING_WARN_MS,
  crossRegionWarning,
  reconnectEndedCopy,
  regionPickerVisible,
  resolveFailureCopy,
  resolveFailureMessage,
} from './online-copy';
export type {
  OnlineErrorAction,
  OnlineErrorCopy,
  ReconnectEndedCopy,
  RegionInfo,
} from './online-copy';

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
  MAIN_MENU_EYEBROW,
  MAIN_MENU_STATUS,
  codexSubLine,
  itemPlate,
  mainMenuHitTest,
  mainMenuLayout,
  mainMenuModel,
  mainMenuRoute,
  mainMenuStep,
  mainMenuIndexOf,
} from './main-menu';
export type {
  MainMenuButtonState,
  MainMenuButtonView,
  MainMenuItem,
  MainMenuLayout,
  MainMenuLayoutOptions,
  MainMenuModel,
  MainMenuOption,
  MainMenuPointer,
} from './main-menu';

// --- The Gantry/Bone screen frame (u7-01) ----------------------------------
//
// Where the header/footer beams sit, what is left for content, and the rule that
// travels with the Bone accent: at most ONE bright plate per screen.

export { beamContent, countPrimaries, gantryFrame, singlePrimary, stackPlates } from './gantry';
export type { GantryFrame } from './gantry';

export { MainMenuView, MAIN_MENU_ANCHOR } from './main-menu-view';
// The void behind the menus (a0-79) — the REAL `VoidBackdrop`, baked once per
// resize because a menu is static. See `./menu-backdrop` for the trade.
export {
  MenuBackdrop,
  MENU_SKY,
  MENU_SKY_MAP,
  MENU_BAKE_MAX_TEXELS,
  menuBakeResolution,
  menuSkyEnabled,
} from './menu-backdrop';

// --- The CODEX — the optional main-menu reference (GDD §2.10) ---------------
//
// Five tabs (OBJECTIVE / BOTS / SHIPS / SYSTEMS / STRATEGY) over the five `content/codex/
// *.json` files: a scrollable entry rail and a detail pane (summary, body, the
// machine-checked facts, difficulty/hull badges, cross-links), with a BACK
// button. A door the player opens voluntarily, never a gate before play — it
// builds no world. Same pure-model + Pixi-view pair as every screen here, but
// the DATA is handed in rather than imported: `content/codex/` lives outside
// `src/`, so whoever boots the client imports the JSON (Vite resolves it) and
// hands over `normalizeCodex({ objective, bots, ships, systems, strategy })`.
//
// **Wiring seam** (for `src/main.ts`, the menu owner):
//
//   import objective from '../content/codex/codex-objective.json';  // + bots/ships/systems/strategy
//   const codex = new CodexView(w, h, isTouch);
//   ctx.root.addChild(codex);
//   let state = createCodex(normalizeCodex({ objective, bots, ships, systems, strategy }));
//   // CODEX pressed on the menu → codex.visible = true; menuView.visible = false
//   // per frame while shown:  codex.update(codexModel(state))
//   // on tap:   const hit = codex.hitTest(x, y)
//   //   'back'  → codex.visible = false; back to the menu
//   //   'tab'   → state = selectCodexTab(state, CODEX_TABS[hit.index].id)
//   //   'entry' → state = selectCodexEntry(state, hit.index)
//   // on wheel/drag: codex.scrollRail(dy) over the rail, codex.scrollDetail(dy) over the pane
export {
  CODEX_TABS,
  CODEX_TITLE,
  CODEX_BACK_LABEL,
  CODEX_ID,
  // The five per-screen size constants (CODEX_ENTRY_GAP / _TITLE_HEIGHT /
  // _TAB_HEIGHT / _TAB_HEIGHT_TOUCH / _ENTRY_HEIGHT / _ENTRY_HEIGHT_TOUCH) are
  // gone in u7-04: the CODEX is on the shared Gantry frame, so its rows, its tab
  // chips and its gaps come from `frameMetrics` like the rest of the set. See
  // `./codex`'s layout header for what each one became.
  CODEX_RAIL_MIN,
  CODEX_RAIL_MAX,
  activeEntries,
  activeEntry,
  activeEntryIndex,
  codexHitTest,
  codexLayout,
  codexModel,
  codexRailContentHeight,
  codexEntryPlate,
  codexTabPlate,
  codexTargetKey,
  createCodex,
  formatFactValue,
  normalizeCodex,
  selectCodexEntry,
  selectCodexTab,
  codexBotHint,
  codexShipHint,
} from './codex';
export type {
  CodexCategory,
  CodexData,
  CodexDetailView,
  CodexEntry,
  CodexEntryView,
  CodexFact,
  CodexFactView,
  CodexHint,
  CodexLayout,
  CodexModel,
  CodexRaw,
  CodexSection,
  CodexState,
  CodexTab,
  CodexTabView,
  CodexTarget,
} from './codex';

export { CodexView, CODEX_ANCHOR } from './codex-view';

// The lobby's codex tooltip (GDD §2.10 point 2) — a passive, dismissible overlay
// the lobby shows on hover / long-press of a bot seat or a hull tile, resolved
// via codexBotHint / codexShipHint. It never hit-tests, so it can never eat a
// lobby tap ("non-blocking").
export { CodexHintView } from './codex-hint-view';

// --- The HANGAR — the fourth main-menu door (a0-14) -------------------------
//
// Where a player looks at what they have and what they are working toward: their
// ship drawn from the REAL generators, their level and progress toward the next
// (read from the one profile, `src/progression/`, never recomputed here), and
// the level→unlock list of cosmetics.
//
// It is NOT a store: no currency, no price, no purchase. And the boundary that
// keeps it honest is in the contract rather than in the content — a cosmetic may
// vary colour, livery, decals, trim and engine glow, and may NEVER vary outline,
// proportions or class-identifying geometry, because a silhouette on the minimap
// is information (style-guide §4, GDD §2.11).
//
//   const hangar = new HangarView(w, h, isTouch);
//   ctx.root.addChild(hangar);
//   // HANGAR pressed on the menu → hangar.visible = true; menuView.visible = false
//   // on a state change: hangar.update(hangarModel({ profile, shipClass }))
//   // on tap: const hit = hangar.hitTest(x, y)
//   //   'back'     → hangar.visible = false; back to the menu
//   //   'cosmetic' → equipCosmetic(profile, c); saveProfile(platform.storage, next)
//
// The list ships EMPTY, and the screen is built to be worth opening anyway —
// `model.empty` carries the line to draw where the rows would be, because an
// empty grid is indistinguishable from a broken one (LESSONS §20).
export {
  COSMETICS,
  COSMETIC_INVARIANT,
  COSMETIC_SLOTS,
  COSMETIC_SLOT_SURFACE,
  COSMETIC_VARIABLE,
  HANGAR_BACK_LABEL,
  HANGAR_EMPTY_LINE,
  HANGAR_EYEBROW,
  HANGAR_ID,
  HANGAR_TITLE,
  cosmeticStatus,
  equipCosmetic,
  equippedId,
  hangarHitTest,
  hangarLayout,
  hangarModel,
  hangarTargetKey,
  isUnlocked,
  sameHangarTarget,
} from './hangar';
export type {
  Cosmetic,
  CosmeticSlot,
  CosmeticStatus,
  HangarLayout,
  HangarLayoutOptions,
  HangarLevelView,
  HangarModel,
  HangarPointer,
  HangarRowView,
  HangarShipView,
  HangarState,
  HangarTarget,
} from './hangar';

export { HangarView, HANGAR_ANCHOR } from './hangar-view';

// --- The map picker — pick the arena before a match (GDD §2.1; registry m8-01) --
//
// Four cards on the PLAY flow, each a mini layout preview drawn from the
// registry's own station positions so the picture can never drift from the board.
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
  // One card for one map (u10-01) — the lobby's single arena card, built by the
  // same constructor the six-card row is, so the summary and the screen it was
  // picked on are the same picture.
  mapCardModel,
  mapPickerLayout,
  mapPickerHitTest,
  mapPreview,
  normalizeMapId,
  mapIndexOf,
  mapIdAt,
  registryStations,
} from './map-picker';
export type {
  MapCardModel,
  MapCardShape,
  MapPickerLayout,
  MapPickerModel,
  MapPreview,
} from './map-picker';

export { MapPickerView, MAP_PICKER_ANCHOR } from './map-picker-view';

// --- The minimap (GDD §2.2; field request v0.2.2) --------------------------
//
// Bottom-right corner square that taps/clicks open to a centred overlay (same
// gesture PC + mobile, `M` on PC), drawing sim-driven marks — station squares,
// ship triangles pointed along their heading, satellite diamonds, the collapse
// ring, faint ore dots (a0-88: SHAPE is kind; a0-110: COLOUR is SIDE — friendly
// blue, hostile red, a wreck neutral steel, off the ratified `./lobby`
// SIDE_COLORS). Same pure-model /
// Pixi-view split as the rest: `./minimap` decides (toggle, fit, scene, mark
// geometry, the sensed region), `./minimap-view` draws (throttled cached content +
// a per-frame own-ship mark). The `Hud` owns both.

export {
  Minimap,
  minimapScene,
  minimapRect,
  collapsedRect,
  expandedRect,
  fitBounds,
  mapPoint,
  markPolygon,
  pointInRect,
  sensedRegions,
  MINIMAP_TOGGLE_KEY,
  MINIMAP_REDRAW_TICKS,
  MINIMAP_MARGIN,
  MINIMAP_COLLAPSED_DESKTOP,
  MINIMAP_COLLAPSED_TOUCH,
  MINIMAP_COLLAPSED_MIN,
  MINIMAP_EXPANDED_FRACTION,
  MINIMAP_EXPANDED_MIN,
  MINIMAP_DOT_ALPHA,
  MINIMAP_DERELICT_ALPHA,
  MINIMAP_SPAWN_PROTECT_ALPHA,
  MINIMAP_ORE_ALPHA,
  MINIMAP_REMEMBERED_ALPHA,
  MINIMAP_FOG_ALPHA,
  MINIMAP_COVERAGE_FILL_ALPHA,
  MINIMAP_COVERAGE_RING_ALPHA,
  // Friend or foe (a0-110) — the side table, the resolver, and the two seams the
  // colour is read through.
  MINIMAP_SIDE_COLORS,
  minimapSide,
  minimapMarkColor,
  minimapViewerSide,
  // The mark-sizing tunables, exported so a test can bind to the floor rather
  // than to a number (a0-110: the fraction moved, the floor did not).
  STATION_DOT_FRACTION,
  SHIP_DOT_FRACTION,
  SHIP_DOT_MIN,
  SATELLITE_DOT_FRACTION,
  SATELLITE_DOT_MIN,
  OWN_SHIP_DOT_MULTIPLIER,
} from './minimap';
export type {
  MinimapState,
  MinimapFrame,
  MinimapStation,
  MinimapShip,
  MinimapSatellite,
  MinimapRing,
  MinimapCoverage,
  MinimapFog,
  MinimapInsets,
  MinimapDot,
  MinimapShape,
  MinimapSide,
  MinimapRegion,
  MinimapScene,
  FitTransform,
} from './minimap';

export {
  MinimapView,
  MINIMAP_ID,
  MINIMAP_EXPANDED_ID,
  MINIMAP_ANCHOR,
  MINIMAP_EXPANDED_ANCHOR,
} from './minimap-view';
export type { DrawnMinimap } from './minimap-view';

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

// --- The viewport: how much screen the HUD uses, how much world the camera shows
//
// a0-74, "the screen you get depends on the screen you have". Both halves are
// pure: `contentBox` binds the HUD's chrome to a centred region of the HUD's own
// reference aspect on an ultrawide (and to the whole viewport everywhere else),
// and the zoom ladder is the touch zoom-out control's model. The wiring layer
// reads the stored rung and hands the camera `cameraScale(step)`.

export {
  contentBox,
  cameraScale,
  nextViewZoom,
  viewZoomLabel,
  parseViewZoom,
  storedViewZoom,
  CONTENT_MAX_ASPECT,
  CONTENT_MIN_WIDTH,
  VIEW_ZOOM_STEPS,
  VIEW_ZOOM_STORAGE,
  DEFAULT_VIEW_ZOOM,
} from './viewport';

export {
  showZoomControl,
  zoomControlBounds,
  zoomControlLabel,
  hitZoomControl,
  ZOOM_CONTROL_ID,
  ZOOM_CONTROL_ANCHOR,
  ZOOM_CONTROL_WIDTH,
  ZOOM_CONTROL_HEIGHT,
} from './zoom-control';

// --- Which on-glass controls the seated scheme can actually drive (a0-74) ----
//
// "theres buttons like Fire, that shouldn't show up since im using tap commander
// and auto fire (on pc)". The rule is read off `sampleInput`'s own four lines,
// and the touch layer is handed the answer as booleans.

export { liveOnGlassControls, showStickFurniture } from './live-controls';
export type { OnGlassControls } from './live-controls';
