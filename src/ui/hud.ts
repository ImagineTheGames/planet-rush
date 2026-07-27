/**
 * src/ui/hud.ts — the in-play HUD. OWNER: UI Engineer (GDD §3.7, §2.2).
 *
 * A screen-space PixiJS overlay that sits on top of the world render layer
 * (`@render`) in the same canvas — it does NOT move with the camera. The HUD
 * "shows only what the player acts on" (GDD §2.2). Day-1 surface (GDD §4.6):
 *
 *  - **Ore at a glance**, split per the field rule: the banked **TOTAL** in the
 *    top-left corner (the safe bank the Build wheel spends), and a compact
 *    **hold indicator under the ship** — one pip per cargo slot, flashing when
 *    full — that follows the local ship in screen space and drains during a dock
 *    deposit ({@link ./ore-hold}). Two forms, two places, so held and banked ore
 *    can never be confused (GDD §2.2, §2.3).
 *  - **Asteroid-wave clock** (top-center): wave name + countdown + match time
 *    (GDD §2.2, §2.3) — the match metronome made visible.
 *  - **Controls strip** (bottom edge, desktop only): bindings read from the live
 *    action map so it can never drift; absent on touch (GDD §2.2, §2.4).
 *  - **Onboarding prompts** (GDD §2.10): input-agnostic via the action layer,
 *    each firing once.
 *
 * Day-2 surface, landing with planets, cores and the build economy in the sim:
 *
 *  - **Your own planet's HP** (top-right, in your player colour, GDD §2.2) —
 *    your own only; enemy HP is scouted, never broadcast.
 *  - **The under-attack alarm** (GDD §2.2, a *mechanic, not polish*): a threat-
 *    red screen frame plus the screen-edge arrow pointing home, on the
 *    sustained-damage trigger in {@link ./alarm} — never on a taunt-tap.
 *  - **The Build & Upgrade wheel** and the upgrade panel behind its arrow
 *    (GDD §2.5), drawn by {@link ./build-wheel-view}, open at your own planet.
 *
 * Over-ship hull bars now land as a pooled, screen-space layer over every
 * non-local combat entity ({@link ./healthbar}, {@link ./healthbar-view}); the
 * minimap arrives with the remaining M2 wiring.
 *
 * All decision logic lives in the pure, unit-tested sibling modules
 * ({@link ./onboarding}, {@link ./wave-clock}, {@link ./ore-hud},
 * {@link ./controls-strip}), and every day-2 element's screen geometry lives in
 * {@link ./hud-geometry} so its placement is asserted headless against the
 * layout registry's own resolver; this file is the thin Pixi *view* that draws
 * them and reports what it drew ({@link Hud.describeLayout}).
 * Integration (constructing this and calling {@link Hud.update} each frame) is
 * the Platform Engineer's wiring in `main.ts` — see the PR notes.
 *
 * Typography per style-guide §5.6: Audiowide for headings/labels, Oxanium for
 * numerals. Both self-host under `assets/` (Art & Audio); we name the families
 * with safe fallbacks so the HUD renders before the fonts land.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { DeviceKind, FireMode } from '@platform/actions';
import type { LayoutEntry, Viewport } from '@platform/layout-registry';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { Onboarding, resolvePromptText } from './onboarding';
import { computeWaveClock, formatClock } from './wave-clock';
import { oreHudModel, oreFlashOn } from './ore-hud';
import { oreHoldModel } from './ore-hold';
import { OreHoldView } from './ore-hold-view';
import type { DrawnOreHold } from './ore-hold-view';
import { controlsStripView, showControlsStrip } from './controls-strip';
import type { StripRow } from './controls-strip';
import { buildWheelModel, segmentAngle } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { BuildWheelView } from './build-wheel-view';
import type { DrawnBuildWedge, DrawnUpgradeWedge } from './build-wheel-view';
import { upgradeWheelModel, upgradeWedgeAngle, STOCK_TIERS } from './upgrade-wheel';
import type { UpgradeTiers } from './upgrade-wheel';
import { PressFeedback, detectConfirmations } from './press-feedback';
import type { CostFloat, ControlFeedback, PressSurface, WheelSnapshot } from './press-feedback';
import { UnderAttackAlarm, homeArrow, ARROW_EDGE_INSET } from './alarm';
import type { Point } from './alarm';
import { planetHpModel, planetHpFlashOn, coreHpReadout } from './planet-hp';
import { respawnCountdownModel } from './respawn-countdown';
import type { RespawnCountdownModel } from './respawn-countdown';
import { healthBarModel } from './healthbar';
import type { Combatant } from './healthbar';
import { HealthBarView } from './healthbar-view';
import type { DrawnHealthBar } from './healthbar-view';
import { nameplateModel } from './nameplates';
import type { DifficultyTable, Nameable, NameTable } from './nameplates';
import { NameplateView } from './nameplates-view';
import type { DrawnNameplate } from './nameplates-view';
import { tapMarkersModel } from './tap-markers';
import { TapMarkerView } from './tap-markers-view';
import type { DrawnTapMarkers } from './tap-markers-view';
import { Minimap } from './minimap';
import type { MinimapFrame, MinimapInsets } from './minimap';
import { MinimapView } from './minimap-view';
import type { DrawnMinimap } from './minimap-view';
import {
  ARROW_SIZE,
  arrowPoly,
  ALARM_FRAME_INSET,
  ALARM_FRAME_STROKE,
  HUD_PAD,
  HP_BAR_WIDTH,
  HP_BAR_HEIGHT,
  HP_BAR_TOP,
  SHIELD_BAR_HEIGHT,
  PROMPT_PAD_X,
  PROMPT_PAD_Y,
  PROMPT_STROKE,
  PROMPT_CENTER_Y,
  promptWrapWidth,
  RESPAWN_PAD_X,
  RESPAWN_PAD_Y,
  RESPAWN_STROKE,
  RESPAWN_CENTER_Y,
  respawnWrapWidth,
  wheelRadius,
} from './hud-geometry';

// ---------------------------------------------------------------------------
// Typography & neutral colours
// ---------------------------------------------------------------------------

/** Audiowide — wordmark/headings/labels (style-guide §5.6). Fallback until the
 *  self-hosted face loads. */
const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
/** Oxanium — HUD numerals/body (style-guide §5.6). Holds up at 12px. */
const FONT_NUMERAL = 'Oxanium, "DejaVu Sans Mono", monospace';

/** Neutral light HUD text. Chalk-white — NOT signal yellow (RESERVED, §2). */
const TEXT_PRIMARY = 0xdce3ec;
/** Dimmer neutral (match time, secondary numerals). */
const TEXT_DIM = PALETTE.hullSteel;

// ---------------------------------------------------------------------------
// Layout constants (CSS pixels; the Application handles devicePixelRatio)
// ---------------------------------------------------------------------------

/** The corner margin, and the `margin` of the corner anchors — one constant, in
 *  `hud-geometry.ts`, so the drawing and the registered anchor cannot drift. */
const PAD = HUD_PAD;
/** Bottom strip's baseline offset from the screen bottom, CSS px. */
const STRIP_ROW = 18;
const STRIP_PAD = 12;
/** Gap between the top-left TOTAL label and the banked number below it, CSS px. */
const TOTAL_LABEL_H = 14;


// ---------------------------------------------------------------------------
// The per-frame HUD input
// ---------------------------------------------------------------------------

/**
 * Everything the HUD needs for one frame, derived by the caller from the local
 * ship + world. Device-neutral where the sim is; the device/fireMode drive only
 * the controls strip and the input-agnostic prompt wording (GDD §2.4, §2.10).
 *
 * **Every day-2 field is optional**, and each has a defined default (documented
 * per field). That is deliberate: the M1 feed in `main.ts` predates planets and
 * is the Platform Engineer's file, so the HUD must keep compiling and drawing
 * correctly against a frame that carries none of them. As each field gets wired,
 * its element lights up — nothing here has to change, and nothing outside
 * `src/ui/` had to change to land this.
 */
export interface HudFrame {
  /** Local ship's held ore (GDD §2.3). */
  readonly cargo: number;
  /** Local ship's hold capacity — one square per slot (GDD §2.2). */
  readonly cargoCap: number;
  /** Local player's banked ore — safe (GDD §2.3). */
  readonly banked: number;
  /** Elapsed match time, seconds (`world.time`). Drives the wave clock + flash. */
  readonly time: number;
  /** The active input device — selects the controls strip + prompt wording. */
  readonly device: DeviceKind;
  /** Manual / Auto-aim — morphs the strip + prompt wording (GDD §2.4). */
  readonly fireMode: FireMode;
  /** Touch build: the strip is hidden and prompts get touch wording (GDD §2.4). */
  readonly isTouch: boolean;
  /** An asteroid is within weapon range — the mine prompt's trigger (GDD §2.10). */
  readonly nearAsteroid: boolean;

  // --- Day 2: your own planet (GDD §2.2 — your own only, never a rival's) ---

  /** The local player's slot — selects the HP bar's identity colour
   *  (style-guide §3.1). Default 0. */
  readonly owner?: PlayerId;
  /** Own planet's current core HP. Default: full (the bar reads healthy). */
  readonly coreHp?: number;
  /** Own planet's max core HP. Default 0 ⇒ the HP element is hidden entirely. */
  readonly maxCoreHp?: number;
  /** Pooled shield HP standing over the core. Default 0. */
  readonly shieldHp?: number;
  /** Pooled shield HP at full — 0 when no generator is built. Default 0. */
  readonly maxShieldHp?: number;
  /** Summed HP of the planet's live turrets. Feeds the alarm only: turret damage
   *  is your planet being attacked too (GDD §2.2). Default 0. */
  readonly turretHp?: number;
  /** False once the core is destroyed (GDD §2.7). Default true. */
  readonly planetAlive?: boolean;

  // --- Day 2: the Build & Upgrade wheel (GDD §2.5) --------------------------

  /** The local ship is alive. Default true. */
  readonly shipAlive?: boolean;
  /** Seconds until the local ship respawns, straight off the sim's
   *  `Ship.respawnTimer` (0 when alive). Drives the "RESPAWNING 3…" countdown —
   *  the HUD renders the *ceiling* of this and never runs its own clock (field
   *  request v0.2.2). Default 0 ⇒ no countdown. */
  readonly respawnTimer?: number;
  /** The local seat is eliminated — a *final* death (its core is gone, GDD §2.7).
   *  The DEFEATED flow (p1-12) owns the screen, so the respawn countdown stands
   *  down entirely; the sim answers which death this is, the UI never guesses.
   *  Default false. */
  readonly eliminated?: boolean;
  /** The ship is within `PLANET.dockRange` of its own planet — the sim's
   *  `isDocked`. The wheel opens here and nowhere else. Default false. */
  readonly docked?: boolean;
  /** The `build` action is held (GDD §2.4). Default false. */
  readonly buildRequested?: boolean;
  /** Turrets standing or queued (the sim's `turretCount`). Default 0. */
  readonly turrets?: number;
  /** Shields standing or queued (the sim's `shieldCount`). Default 0. */
  readonly shields?: number;
  /** The player has UPGRADE SHIP selected — the panel is in front of the wheel
   *  (GDD §2.5). Default false. */
  readonly upgradePanelOpen?: boolean;
  /** The player has drilled into the WEAPON sub-wheel (RATIFIED v0.2.2) — the
   *  upgrade wheel then shows the weapon-group tracks (DAMAGE, SPEED) and a BACK
   *  wedge instead of the main-wheel set. Only meaningful while
   *  {@link upgradePanelOpen}. Default false. */
  readonly weaponWheelOpen?: boolean;
  /** Any wheel order has been placed this match — retires the SPEND onboarding
   *  prompt (GDD §2.10). Default false. */
  readonly hasOrdered?: boolean;
  /** Local ship's current hull HP — the one source both the over-ship own-ship
   *  bar and the HUD hull readout read (field request v0.1.1), so they agree.
   *  Default: full (`maxHull`). */
  readonly hull?: number;
  /** Local ship's max hull HP. Default 0 ⇒ no own-ship bar and no hull readout
   *  (the M1 feed predates the ship's hull being wired). */
  readonly maxHull?: number;
  /** Local ship's screen radius, so the over-ship own bar floats clear of the
   *  sprite. The follow camera renders the ship at screen centre 1:1, so a world
   *  radius is a screen radius. Default {@link DEFAULT_SHIP_SCREEN_RADIUS}. */
  readonly shipRadius?: number;
  /** The local ship is firing its weapon this tick (mining or shooting — one weapon,
   *  GDD §2.5) ⇒ "in combat" for the own-ship bar, matching the enemy rule.
   *  Default false. */
  readonly shipFiring?: boolean;
  /** The hull the player picked in the lobby (GDD §2.11) — the upgrade panel's
   *  stat baseline. Default Vanguard, the onboarding default. */
  readonly shipClass?: ShipClass;
  /** Upgrade tiers bought so far, per track. Default: stock. */
  readonly upgradeTiers?: UpgradeTiers;

  // --- Day 2: the under-attack alarm (GDD §2.2) ----------------------------

  /** The local ship's world position — the follow camera's target. Together with
   *  `homePos` this drives the screen-edge arrow. Default: no arrow. */
  readonly shipPos?: Point;
  /** The local player's planet's world position. Default: no arrow. */
  readonly homePos?: Point;

  // --- Day 2: the endgame (GDD §2.3) ---------------------------------------

  /** The collapse phase has begun (the sim's `isCollapsed`): no shield regen,
   *  no repair, no new ore. Greys out REPAIR CORE on the wheel and puts
   *  COLLAPSE on the wave clock. Default false. */
  readonly collapsed?: boolean;

  // --- Day 2: over-entity health bars (GDD §2.2 — a hull bar over every ship) --

  /** Non-local combat entities — enemy ships, enemy turrets, hostile wave units
   *  — each with its HP and its **screen-space** position (the caller projects
   *  world → screen via the renderer's camera). The health-bar layer draws a bar
   *  over each that is damaged or in combat; the local player's own ship and
   *  turrets are filtered out by {@link ./healthbar}, so passing them is harmless.
   *  Default: none ⇒ no bars (the M1 feed predates enemies). */
  readonly combatants?: readonly Combatant[];

  // --- Field request v0.2.1: name labels over ships and owned planets --------

  /** Label-bearing entities — every ship and every owned planet — each with its
   *  owner slot, kind, liveness and **screen-space** position (the caller projects
   *  world → screen). The nameplate layer draws a name over each; the local ship's
   *  own label is filtered unless {@link showOwnShipLabel}. Default: none ⇒ no
   *  labels (the feed predates nameplates). */
  readonly nameables?: readonly Nameable[];
  /** Per-slot name table (from the lobby's slot state — local name + bot cast).
   *  Default: none ⇒ every label falls back to its `P{n}` identity tag. */
  readonly names?: NameTable;
  /** Per-slot difficulty table, mirroring {@link names} (field request v0.2.2): a
   *  bot seat's tier becomes a recessive `(EASY)`/`(MEDIUM)`/`(HARD)` suffix, a
   *  human seat is left empty so it shows none. Default: none ⇒ no suffixes. */
  readonly difficulties?: DifficultyTable;
  /** Show the local player's OWN ship label. Default false — see
   *  {@link ./nameplates} `NameplateOptions.showOwnShipLabel}. */
  readonly showOwnShipLabel?: boolean;

  // --- Tap Commander order markers (developer §4; the optional scheme) --------

  /** The waypoint marker's **screen-space** position (the tapped point the pilot
   *  is flying to), or absent when there is no move order / not in the tap scheme.
   *  The caller projects world → screen; the layer draws the fading pulse. */
  readonly tapWaypoint?: { readonly x: number; readonly y: number };
  /** The lock-on reticle's **screen-space** target centre + screen radius, or
   *  absent when nothing is locked. Rides the target (already projected by the
   *  caller), so the reticle tracks a moving ship / shrinking rock. */
  readonly tapLock?: { readonly x: number; readonly y: number; readonly radius: number };
  /** The pilot is firing on its lock this tick → the line of intent from ship to
   *  target draws. Only meaningful with {@link tapLock} present. Default false. */
  readonly tapFiring?: boolean;

  // --- The minimap (GDD §2.2; field request v0.2.2) --------------------------

  /** The minimap's content in **map (world) space** — arena bounds, planets,
   *  ships, the collapse ring, ore hints. Absent before the world exists (the M1
   *  feed) ⇒ the minimap hides entirely; present ⇒ it draws. Unlike the rest of
   *  the HUD this is NOT pre-projected to screen: the minimap does its own fit
   *  ({@link ./minimap}). Default: none. */
  readonly minimap?: MinimapFrame;
  /** Safe-area / thumb insets for the minimap's corner + overlay placement
   *  (mobile amendment §2). Default: none ⇒ plain edges. */
  readonly minimapInsets?: MinimapInsets;
  /** The sim tick, driving the minimap's low-frequency content redraw
   *  ({@link ./minimap} `MINIMAP_REDRAW_TICKS}). Default: derived from `time`. */
  readonly tick?: number;
}

/** Reused for a frame that carries no combatants, so the empty case allocates
 *  nothing (GDD §4.3 — no per-frame allocation on the hot path). */
const NO_COMBATANTS: readonly Combatant[] = [];

/** Reused empties for the nameplate feed, same zero-allocation discipline. */
const NO_NAMEABLES: readonly Nameable[] = [];
const NO_NAMES: NameTable = [];
const NO_DIFFICULTIES: DifficultyTable = [];

/** Fallback screen radius for the own-ship over-bar when the frame carries no
 *  `shipRadius` (an unwired feed) — a sane hull-sized clearance so the bar still
 *  floats above where the ship sits (screen centre), CSS px. */
const DEFAULT_SHIP_SCREEN_RADIUS = 14;

/** A mutable {@link Combatant} — the single own-ship record the HUD synthesises
 *  and overwrites in place each frame, so folding the local ship into the
 *  health-bar model allocates nothing after warm-up (GDD §4.3). */
interface MutableLocalCombatant {
  owner: PlayerId;
  hp: number;
  maxHp: number;
  alive: boolean;
  inCombat: boolean;
  pos: { x: number; y: number };
  radius: number;
  local: boolean;
  forceShow: boolean;
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

export class Hud extends Container {
  /** Onboarding state machine — each prompt fires once (GDD §2.10). */
  private readonly onboarding = new Onboarding();

  // --- Ore TOTAL — the banked bank the Build wheel spends (top-left) --------
  //     Field rule: top-left shows the TOTAL only; held ore moved under the ship
  //     (see `oreHold` below), so the two ore numbers can never be confused.
  private readonly oreGroup = new Container();
  private readonly totalLabel: Text;
  private readonly bankedText: Text;
  /** The banked total the top-left last drew — read back by the ?debug=1
   *  live-stage seam to prove the total rises as the under-ship hold drains. */
  private lastBankedTotal = 0;

  // --- Ore HOLD — the under-ship indicator for what you're carrying ---------
  //     A pooled, screen-space layer that follows the local ship (like the
  //     health bar), showing hold / capacity as pips; visible while carrying or
  //     mining, drains visibly during a dock deposit. Decisions in ./ore-hold.
  private readonly oreHold = new OreHoldView();

  // --- Wave clock (top-center) --------------------------------------------
  private readonly waveGroup = new Container();
  private readonly waveName: Text;
  private readonly waveNext: Text;
  private readonly waveMatch: Text;

  // --- Controls strip (bottom, desktop only) ------------------------------
  private readonly stripGroup = new Container();
  private readonly stripLabels: Text[] = [];
  private stripSignature = ''; // rebuild only when device/mode/visibility change
  /** The strip rows resolved for this frame — captured for the ?debug=1 live-stage
   *  seam so a test can assert the contextual Build legend on the real client. */
  private lastStripRows: readonly StripRow[] = [];

  // --- Onboarding prompt (lower-center) -----------------------------------
  private readonly promptGroup = new Container();
  private readonly promptPanel = new Graphics();
  private readonly promptAccent = new Graphics();
  private readonly promptText: Text;

  // --- Respawn countdown ("RESPAWNING 3…", field request v0.2.2) ----------
  //     A centred overlay in the player's colour while the local ship is dead and
  //     a respawn is pending; hidden the instant the ship exists again, and never
  //     shown for a final death (the DEFEATED flow owns that). Decisions live in
  //     ./respawn-countdown; this file just draws the verdict.
  private readonly respawnGroup = new Container();
  private readonly respawnPanel = new Graphics();
  private readonly respawnText: Text;
  /** The countdown model the overlay drew last frame — read back by the ?debug=1
   *  live-stage seam to prove the number decrements on sim ticks and clears at
   *  respawn. */
  private lastRespawn: RespawnCountdownModel = { show: false, seconds: 0, text: '', color: 0 };

  // --- Own planet HP (top-right, player colour — GDD §2.2) ----------------
  private readonly planetGroup = new Container();
  private readonly planetLabel: Text;
  /** Numeric core HP beside the bar — a "75/100" readout (developer request,
   *  p5-08). Sim-driven off the same coreHp/maxCoreHp the bar fills from, so the
   *  number and the bar can never disagree. */
  private readonly coreLabel: Text;
  private readonly planetBar = new Graphics();

  // --- Under-attack alarm (screen frame + edge arrow home — GDD §2.2) ------
  private readonly alarmGroup = new Container();
  private readonly alarmFrame = new Graphics();
  private readonly alarmArrow = new Graphics();
  /** The sustained-damage trigger. A taunt-tap never reaches it (GDD §2.2). */
  private readonly alarm = new UnderAttackAlarm();
  /** Previous frame's total planet HP (core + shields + turrets) and match time.
   *  The HUD derives "damage this tick" from the drop rather than asking the
   *  caller for a damage event, so the alarm needs no new sim plumbing. */
  private lastDefenseHp = -1;
  private lastTime = -1;
  /** Whether the screen-edge arrow actually drew this frame. The arrow is hidden
   *  while home is already on screen (the planet is its own tell), and the
   *  registry records what is drawn, never what would have been. */
  private arrowDrawn = false;

  // --- Over-entity health bars (GDD §2.2 — the field report's enemy bars) ---
  //     A pooled, screen-space layer, drawn behind the HUD chrome and over the
  //     world render layer below the HUD. Its decisions live in ./healthbar.
  private readonly healthbars = new HealthBarView();
  /** The own-ship combatant, synthesised each frame and folded into the health-
   *  bar model so the local ship gets a bar too (field request v0.1.1). Reused in
   *  place; `local` never changes. */
  private readonly localCombatant: MutableLocalCombatant = {
    owner: 0,
    hp: 0,
    maxHp: 0,
    alive: true,
    inCombat: false,
    pos: { x: 0, y: 0 },
    radius: DEFAULT_SHIP_SCREEN_RADIUS,
    local: true,
    forceShow: false,
  };
  /** Reused input array for {@link healthBarModel}: the own ship followed by the
   *  frame's enemies/hostiles, so folding the local ship in allocates nothing. */
  private readonly healthbarInput: Combatant[] = [];
  /** The own ship's hull fraction the over-ship bar drew this frame, or -1 when
   *  it has no hull wired. The over-ship bar is now the single truth for own-ship
   *  hull (the top-right readout was removed — field report v0.2), so the ?debug=1
   *  live-stage seam reads this ({@link debugHullReadout}) off the same source. */
  private lastLocalHullFraction = -1;

  // --- Player-name labels (field request v0.2.1) -------------------------
  //     A pooled, screen-space layer stacked with the health bars: name on top,
  //     bar under it, ship under that. Its decisions live in ./nameplates.
  private readonly nameplates = new NameplateView();

  // --- Tap Commander order markers (developer §4) ------------------------
  //     The lock-on reticle, line-of-intent and waypoint pulse, in screen space.
  //     Added FIRST below (bottom of the HUD), so it sits over the world but under
  //     every piece of HUD chrome — the health bars and nameplates included — and
  //     can never occlude them (p6-01 §3). Its decisions live in ./tap-markers.
  private readonly tapMarkers = new TapMarkerView();

  // --- Minimap (GDD §2.2; field request v0.2.2) --------------------------
  //     Two states (a bottom-right corner square / a centred overlay), toggled by
  //     the same click/tap on both platforms and the `M` key on PC. The pure model
  //     holds the toggle + geometry + fit; the view draws the sim-driven dots to a
  //     throttled cached texture. Decisions live in ./minimap.
  private readonly minimapModel = new Minimap();
  private readonly minimap = new MinimapView();
  /** The last frame's touch flag + insets, so a pointer event arriving between
   *  frames hit-tests the minimap against the geometry it actually drew with. */
  private minimapIsTouch = false;
  private minimapInsets: MinimapInsets = {};

  // --- Build & Upgrade wheel + upgrade panel (GDD §2.5) -------------------
  private readonly wheel: BuildWheelView;

  // --- Press & action feedback (field report v0.2.2) ----------------------
  //     One shared driver for the whole wheel family: it holds the live press
  //     (scale/glow/reject) and the confirmations (pulse/shimmer/cost-float), and
  //     the wheel view samples it per wedge. Confirmations are *derived* from the
  //     sim numbers this HUD already receives — a turret queued, a tier bought,
  //     ore banked, the core healing under a repair channel — so pressing REPAIR
  //     and watching the core tick up needs no new plumbing (press-feedback.ts).
  private readonly pressFeedback = new PressFeedback();
  /** Last frame's wheel-relevant sim numbers + whether the wheel was open, so a
   *  confirmation is the *change* between two open frames (never a spawn/wiring
   *  jump, which happens with the wheel shut). Null until the first frame. */
  private prevSnapshot: (WheelSnapshot & { open: boolean }) | null = null;
  /** This frame's match time, so a press arriving from a pointer event (between
   *  frames) is stamped with a clock the next sample can measure elapsed against. */
  private frameTime = 0;
  /** `ready` per wedge index on each surface, captured from the last drawn model
   *  so a press seam can tell a live wedge from a disabled one (drives reject). */
  private buildReady: boolean[] = [];
  private upgradeReady: boolean[] = [];
  /** How many wedges the upgrade wheel last drew — the float layer needs it to
   *  place an upgrade-wedge cost float at the right angle. */
  private upgradeWedgeCount = 0;
  /** The floating ore costs, drawn in screen space so one can travel from a
   *  centred wedge all the way to the top-left bank readout and outlive the wheel
   *  closing. A pooled Text row, same discipline as the rest of the HUD. */
  private readonly floatsGroup = new Container();
  private readonly floatTexts: Text[] = [];

  constructor(
    private screenWidth: number,
    private screenHeight: number,
  ) {
    super();

    // Ore TOTAL (top-left): a dim `TOTAL` heading over the banked number in ore
    // yellow. The heading names it as the safe bank total, distinct in both form
    // and place from the pips carried under the ship (field rule).
    this.totalLabel = this.makeText('TOTAL', FONT_HEADING, 11, TEXT_DIM);
    this.totalLabel.y = 0;
    this.bankedText = this.makeText('', FONT_NUMERAL, 22, PALETTE.signalYellow, 'bold');
    this.bankedText.y = TOTAL_LABEL_H;
    this.oreGroup.addChild(this.totalLabel, this.bankedText);
    this.oreGroup.x = PAD;
    this.oreGroup.y = PAD;

    // Wave clock: three stacked, centre-anchored lines.
    this.waveName = this.makeText('', FONT_HEADING, 15, TEXT_PRIMARY);
    this.waveNext = this.makeText('', FONT_NUMERAL, 14, PALETTE.plasma);
    this.waveMatch = this.makeText('', FONT_NUMERAL, 13, TEXT_DIM);
    for (const t of [this.waveName, this.waveNext, this.waveMatch]) t.anchor.set(0.5, 0);
    this.waveName.y = 0;
    this.waveNext.y = 20;
    this.waveMatch.y = 38;
    this.waveGroup.addChild(this.waveName, this.waveNext, this.waveMatch);

    // Onboarding prompt: accent bar + panel + centre-anchored text, hidden until
    // a prompt is active.
    this.promptText = this.makeText('', FONT_HEADING, 16, TEXT_PRIMARY);
    this.promptText.anchor.set(0.5, 0.5);
    this.promptGroup.addChild(this.promptPanel, this.promptAccent, this.promptText);
    this.promptGroup.visible = false;

    // Respawn countdown: a prominent centre-anchored line over a dim backing
    // panel, hidden until the local ship is dead with a respawn pending. The fill
    // is set per frame to the player's colour (field request v0.2.2).
    this.respawnText = this.makeText('', FONT_HEADING, 24, TEXT_PRIMARY, 'bold');
    this.respawnText.anchor.set(0.5, 0.5);
    this.respawnGroup.addChild(this.respawnPanel, this.respawnText);
    this.respawnGroup.visible = false;

    // Own planet HP: a right-anchored label above a bar in the player's colour,
    // with the numeric core HP ("75/100") sitting left-aligned on the same row,
    // opposite HOME and above the left end of the bar — a numeral, so Oxanium
    // (style-guide §5.6). It rides within the bar's own x-span, so it never widens
    // the top-right footprint the layout registry records (see hud-geometry.ts).
    this.planetLabel = this.makeText('HOME', FONT_HEADING, 11, TEXT_DIM);
    this.planetLabel.anchor.set(1, 0);
    this.coreLabel = this.makeText('', FONT_NUMERAL, 11, TEXT_PRIMARY);
    this.coreLabel.anchor.set(0, 0);
    this.coreLabel.x = -HP_BAR_WIDTH;
    this.coreLabel.y = 1;
    this.planetGroup.addChild(this.planetBar, this.planetLabel, this.coreLabel);
    this.planetGroup.visible = false;

    // Alarm: a threat-red frame around the whole screen plus the arrow home.
    // Both are drawn only while the alarm is sounding — threat red is never a
    // resting-state colour (style-guide §2).
    this.alarmGroup.addChild(this.alarmFrame, this.alarmArrow);
    this.alarmGroup.visible = false;

    // The wheel draws above the HUD chrome: while it is open it *is* the screen.
    this.wheel = new BuildWheelView(screenWidth, screenHeight);

    this.addChild(
      // Tap Commander order markers draw at the very bottom of the HUD: over the
      // world render, but UNDER every other HUD layer including the health bars and
      // nameplates, so a reticle riding a target's rim can never sit on top of that
      // target's bar or name (p6-01 §3 — never occludes them).
      this.tapMarkers,
      // Health bars and the under-ship hold indicator draw first: they float over
      // the world but under every piece of HUD chrome, so neither ever sits on top
      // of the ore total or the wave clock. Both track the local ship in screen
      // space, bracketing it — bar above, hold below — as one status cluster.
      this.healthbars,
      // Name labels float over the world with the bars, stacked just above each
      // entity's bar cluster (field request v0.2.1) — under all HUD chrome.
      this.nameplates,
      this.oreHold,
      this.oreGroup,
      this.waveGroup,
      this.planetGroup,
      this.stripGroup,
      // The minimap sits above the corner readouts but under the alarm/wheel/prompt:
      // the collapse frame and the danger tells must read over it, and the wheel
      // is what the player acts on when docked. Its expanded overlay lets the
      // match play on behind it, so it deliberately does not claim the top.
      this.minimap,
      this.alarmGroup,
      this.wheel,
      // Cost floats ride above the wheel (they launch off its wedges) and travel
      // to the top-left bank readout, so they sit over the wheel but under the
      // onboarding prompt.
      this.floatsGroup,
      // The respawn countdown draws over the death scene while the ship is gone;
      // it never coexists with an open wheel (a dead ship cannot dock/build) or a
      // fresh prompt, so its order relative to those is moot — it sits under the
      // onboarding prompt for consistency with the rest of the chrome.
      this.respawnGroup,
      // The onboarding prompt draws last: the SPEND prompt fires *while the
      // wheel is open* (GDD §2.10), so it has to sit on top of it.
      this.promptGroup,
    );
    this.layout();
  }

  /** Re-anchor viewport-relative groups (wave clock, strip, prompt) on resize. */
  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.layout();
  }

  private layout(): void {
    this.waveGroup.x = this.screenWidth / 2;
    this.waveGroup.y = PAD;
    this.planetGroup.x = this.screenWidth - PAD;
    this.planetGroup.y = PAD;
    this.stripGroup.y = this.screenHeight - STRIP_ROW - STRIP_PAD;
    this.promptGroup.x = this.screenWidth / 2;
    // Below the ship (the follow camera holds it at the centre) and above the
    // controls strip, so the prompt never covers the thing it is pointing at.
    // The fraction lives in hud-geometry.ts with the rest of the prompt's
    // geometry, so `describeLayout`'s registered rect is computed from the same
    // number this draws with.
    this.promptGroup.y = this.screenHeight * PROMPT_CENTER_Y;
    // Respawn countdown: dead centre — the ship exploded here and the camera
    // stays on it (field request v0.2.2).
    this.respawnGroup.x = this.screenWidth / 2;
    this.respawnGroup.y = this.screenHeight * RESPAWN_CENTER_Y;
    this.wheel.resize(this.screenWidth, this.screenHeight);
  }

  /** Draw one frame. Pull the pure models, then update the Pixi children. */
  update(frame: HudFrame): void {
    this.frameTime = frame.time;
    this.updateOre(frame);
    this.updateWaveClock(frame);
    // The alarm runs first now, because three things downstream read its verdict:
    // the onboarding prompt is chosen by it (GDD §2.10's under-attack prompt) and
    // the own-ship health bar is forced on by it during a siege (field request
    // v0.1.1). The alarm derives its damage from HP deltas alone, so running it
    // earlier changes nothing it computes.
    const underAttack = this.updateAlarm(frame);
    this.updateHealthBars(frame, underAttack);
    this.updateNameplates(frame);
    this.updateTapMarkers(frame);
    this.updateMinimap(frame);
    this.updatePlanetHp(frame);
    this.updateRespawn(frame);
    this.updateControlsStrip(frame);
    const wheelOpen = this.updateWheel(frame);
    this.updateCostFloats(frame);
    this.updateOnboarding(frame, wheelOpen, underAttack);
  }

  // --- Ore: the TOTAL (top-left) and the HOLD (under the ship) -------------

  /** Draw the two ore readouts from the one sim-driven model (field rule): the
   *  banked TOTAL in the top-left corner, and the held-ore indicator that follows
   *  the ship under it. Each reads its own number from the same source of truth —
   *  `banked` for the total, hold/capacity for the pips — so they cannot drift. */
  private updateOre(frame: HudFrame): void {
    const model = oreHudModel(frame.cargo, frame.cargoCap, frame.banked);

    // Top-left TOTAL: just the safe banked number the Build wheel spends.
    this.bankedText.text = `${model.banked}`;
    this.lastBankedTotal = model.banked;

    // Under-ship HOLD: the pips for what you're carrying, floated below the local
    // ship (screen centre under the follow camera). Shown while carrying OR
    // mining; the full hold flashes in step with the total's own full-flash. The
    // pooled layer culls itself off-screen, so its `full` anchor stays honest.
    const mining = (frame.shipFiring ?? false) && frame.nearAsteroid;
    const radius = frame.shipRadius ?? DEFAULT_SHIP_SCREEN_RADIUS;
    const hold = oreHoldModel(
      frame.cargo,
      frame.cargoCap,
      mining,
      this.screenWidth / 2,
      this.screenHeight / 2,
      radius,
    );
    this.oreHold.update(hold, oreFlashOn(model, frame.time), this.screenWidth, this.screenHeight);
  }

  /** The banked total the top-left last drew — the ?debug=1 live-stage seam reads
   *  this to prove the total rises as the under-ship hold deposits. */
  debugBankedTotal(): number {
    return this.lastBankedTotal;
  }

  /** The under-ship hold indicator the layer actually drew last frame (screen
   *  position + pip counts), or null when hidden — the ?debug=1 live-stage seam
   *  reads this to prove a drawn indicator tracks the ship with the right count. */
  debugOreHold(): DrawnOreHold | null {
    return this.oreHold.debugHold();
  }

  // --- Wave clock ----------------------------------------------------------

  private updateWaveClock(frame: HudFrame): void {
    const clock = computeWaveClock(frame.time, frame.collapsed ?? false);
    this.waveName.text = `WAVE ${clock.wave}/${clock.waveCount} · ${clock.name}`;
    // COLLAPSE outranks FINAL WAVE: the field is spent, repair is off and
    // shields no longer regenerate (GDD §2.3). It is threat red because it is
    // the match's danger state, which is what that colour is for.
    if (clock.isCollapsed) {
      this.waveNext.text = 'COLLAPSE';
      this.waveNext.style.fill = PALETTE.threatRed;
    } else {
      this.waveNext.text = clock.isFinalWave
        ? 'FINAL WAVE'
        : `NEXT ${formatClock(clock.countdownToNext ?? 0)}`;
      this.waveNext.style.fill = PALETTE.plasma;
    }
    this.waveMatch.text = `MATCH ${formatClock(clock.matchTime)}`;
  }

  // --- Controls strip (desktop only) --------------------------------------

  private updateControlsStrip(frame: HudFrame): void {
    const show = showControlsStrip(frame.isTouch);
    this.stripGroup.visible = show;
    if (!show) return;

    // The Build & Upgrade row is contextual on docking (field report v0.2.2): its
    // live key shows only at your own planet, matching the touch BUILD button.
    const rows = controlsStripView(frame.device, frame.fireMode, frame.isTouch, frame.docked ?? false);
    this.lastStripRows = rows; // captured for the ?debug=1 legend seam
    // Rebuild the label objects only when the binding set changes, not per frame —
    // and docking flips the Build row, so it rides the signature too.
    const signature = `${frame.device}:${frame.fireMode}:${rows
      .map((r) => `${r.binding ?? '·'}/${r.label}`)
      .join(',')}`;
    if (signature !== this.stripSignature) {
      this.rebuildStrip(rows);
      this.stripSignature = signature;
    }
  }

  private rebuildStrip(rows: readonly StripRow[]): void {
    for (const t of this.stripLabels) t.destroy();
    this.stripLabels.length = 0;

    // Lay out "KEY action" pairs left→right along the bottom. Keys in plasma,
    // actions in grey — NOT yellow (style-guide §2 overrides GDD §2.4 prose;
    // see ./controls-strip for the reconciliation). A dimmed row (an affordance
    // you can't use here — e.g. Build away from your planet) drops its key
    // entirely, so the legend never prints a dead one, and draws at reduced alpha.
    const DIM_ALPHA = 0.5;
    let x = STRIP_PAD;
    for (const row of rows) {
      if (row.binding !== null) {
        const key = this.makeText(row.binding, FONT_NUMERAL, 13, PALETTE.plasma, 'bold');
        key.x = x;
        key.alpha = row.dimmed ? DIM_ALPHA : 1;
        this.stripGroup.addChild(key);
        this.stripLabels.push(key);
        x += key.width + 6;
      }

      const label = this.makeText(row.label, FONT_HEADING, 12, TEXT_DIM);
      label.x = x;
      label.y = 1;
      label.alpha = row.dimmed ? DIM_ALPHA : 1;
      this.stripGroup.addChild(label);
      this.stripLabels.push(label);
      x += label.width + 18;
    }
  }

  // --- Own planet HP (top-right, GDD §2.2) ---------------------------------

  /** Your own planet's HP, in your player colour. **Your own only** — a rival's
   *  health is scouted on their planet within sensor range, never broadcast to
   *  a HUD bar (GDD §2.2), and there is no code path here that takes another
   *  player's planet. */
  private updatePlanetHp(frame: HudFrame): void {
    const maxCore = frame.maxCoreHp ?? 0;
    // Nothing wired yet (M1 feed) ⇒ nothing drawn. The element appears the frame
    // the planet does.
    if (maxCore <= 0) {
      this.planetGroup.visible = false;
      return;
    }
    this.planetGroup.visible = true;

    const model = planetHpModel(
      frame.owner ?? 0,
      frame.coreHp ?? maxCore,
      maxCore,
      frame.shieldHp ?? 0,
      frame.maxShieldHp ?? 0,
    );

    // Critical cores flash threat red over the identity colour; a healthy bar is
    // pure player colour, so red on this bar always means the same thing.
    const flash = planetHpFlashOn(model, frame.time);
    const fill = model.critical && flash ? model.criticalColor : model.color;

    const y = HP_BAR_TOP;
    this.planetBar.clear();
    // Track: the full width, so the missing part is visible as absence.
    this.planetBar
      .roundRect(-HP_BAR_WIDTH, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 2)
      .fill({ color: PALETTE.hullSteel, alpha: 0.22 })
      .roundRect(-HP_BAR_WIDTH, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 2)
      .stroke({ width: 1, color: model.color, alpha: 0.55 });
    if (model.coreFraction > 0) {
      const w = HP_BAR_WIDTH * model.coreFraction;
      this.planetBar.roundRect(-w, y, w, HP_BAR_HEIGHT, 2).fill({ color: fill, alpha: 0.95 });
    }
    // Shield overbar: plasma, and only while a generator stands (GDD §2.5).
    if (model.hasShield && model.shieldFraction > 0) {
      const sw = HP_BAR_WIDTH * model.shieldFraction;
      this.planetBar
        .roundRect(-sw, y - SHIELD_BAR_HEIGHT - 2, sw, SHIELD_BAR_HEIGHT, 1)
        .fill({ color: PALETTE.plasma, alpha: 0.85 });
    }

    // Repair shimmer: a brief patina wash over the healed core while a REPAIR
    // confirmation is live (field report v0.2.2) — the "core HP pip ticks up"
    // tell, in the repair tint (patina — style-guide §1), so a player watching
    // the bar sees it move, not just a silent number.
    const shimmer = this.pressFeedback.coreShimmer(this.frameTime);
    if (shimmer > 0 && model.coreFraction > 0) {
      const w = HP_BAR_WIDTH * model.coreFraction;
      this.planetBar.roundRect(-w, y, w, HP_BAR_HEIGHT, 2).fill({ color: PALETTE.patina, alpha: shimmer * 0.6 });
    }

    this.planetLabel.text = model.destroyed ? 'HOME LOST' : 'HOME';
    this.planetLabel.style.fill = model.destroyed ? model.criticalColor : TEXT_DIM;

    // Numeric core HP ("75/100") beside the bar, off the SAME numbers the bar
    // fills from so the two can never drift. It flashes threat red in step with the
    // bar's own critical flash — one danger tell, two forms — and otherwise stays
    // chalk-white (never signal yellow, which is reserved for ore — style-guide §2).
    this.coreLabel.text = coreHpReadout(frame.coreHp ?? maxCore, maxCore);
    this.coreLabel.style.fill = model.critical && flash ? model.criticalColor : TEXT_PRIMARY;
  }

  // --- Respawn countdown ("RESPAWNING 3…", field request v0.2.2) -----------

  /**
   * Draw the respawn countdown while the local ship is dead with a respawn
   * pending — a centred "RESPAWNING N…" in the player's own colour. The number is
   * the CEILING of the sim's respawn timer, computed in {@link
   * ./respawn-countdown}; this file only draws the verdict, so the HUD never runs
   * a clock that could drift from the sim's (field request).
   *
   * Hidden the instant the ship exists again, and never shown for a *final* death
   * — an eliminated seat's screen belongs to the DEFEATED flow (p1-12, GDD §2.7),
   * and the model returns `show: false` for it.
   */
  private updateRespawn(frame: HudFrame): void {
    const model = respawnCountdownModel({
      shipAlive: frame.shipAlive ?? true,
      eliminated: frame.eliminated ?? false,
      respawnTimer: frame.respawnTimer ?? 0,
      owner: frame.owner ?? 0,
    });
    this.lastRespawn = model;

    if (!model.show) {
      this.respawnGroup.visible = false;
      return;
    }

    // Wrap like the prompt does, so a prominent line never runs off a narrow
    // phone — the wrap is what lets the overlay honestly claim `full` + PAD.
    this.respawnText.text = model.text;
    this.respawnText.style.fill = model.color; // the player's own colour (§5.2)
    this.respawnText.style.wordWrap = true;
    this.respawnText.style.wordWrapWidth = respawnWrapWidth(this.screenWidth);
    this.respawnText.style.align = 'center';

    // A dim backing panel sized to the text, so the countdown reads over the
    // death scene; a thin outline in the player's colour ties it to the number.
    const w = this.respawnText.width + RESPAWN_PAD_X;
    const h = this.respawnText.height + RESPAWN_PAD_Y;
    this.respawnPanel.clear();
    this.respawnPanel
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: PALETTE.vacuum, alpha: 0.72 })
      .stroke({ width: RESPAWN_STROKE, color: model.color, alpha: 0.6 });

    this.respawnGroup.visible = true;
  }

  /** The respawn countdown the overlay drew last frame (or the hidden model) —
   *  the ?debug=1 live-stage seam reads this to prove the number decrements on sim
   *  ticks and clears the instant the ship respawns. */
  debugRespawnCountdown(): RespawnCountdownModel {
    return this.lastRespawn;
  }

  // --- Over-entity health bars (GDD §2.2) ---------------------------------

  /** Draw a bar over every combat entity that is damaged or fighting: enemy
   *  ships, hostile wave units (the enemy field report), **the local player's own
   *  ship** (field request v0.1.1), and **every turret, yours and the enemy's**
   *  (field request v0.2.2). The pure model in
   *  {@link ./healthbar} owns the "which entities, what fill" decision; this
   *  synthesises the own-ship combatant (from sim hull, at the screen centre the
   *  follow camera holds it, flagged `local`, forced on while under siege), folds
   *  it in front of the frame's enemies, and draws the result. */
  private updateHealthBars(frame: HudFrame, underAttack: boolean): void {
    const input = this.healthbarInput;
    input.length = 0;

    // The own ship: a first-class bar, styled as mine (field request v0.1.1). The
    // camera holds the local ship at the viewport centre, so that is where its
    // bar tracks. Same visibility rule as an enemy — damaged OR in combat — plus
    // forced on during a siege alarm so the player can watch their hull as they
    // scramble home. Fed from the SAME hull the readout uses, so the two agree.
    const maxHull = frame.maxHull ?? 0;
    if (maxHull > 0) {
      const c = this.localCombatant;
      c.owner = frame.owner ?? 0;
      c.hp = frame.hull ?? maxHull;
      c.maxHp = maxHull;
      c.alive = frame.shipAlive ?? true;
      c.inCombat = frame.shipFiring ?? false;
      c.pos.x = this.screenWidth / 2;
      c.pos.y = this.screenHeight / 2;
      c.radius = frame.shipRadius ?? DEFAULT_SHIP_SCREEN_RADIUS;
      c.forceShow = underAttack;
      input.push(c);
      // The over-ship bar is the single truth for own-ship hull now; record its
      // fraction off the same numbers, for the ?debug=1 live-stage seam.
      this.lastLocalHullFraction = clamp01(c.hp / maxHull);
    } else {
      this.lastLocalHullFraction = -1;
    }

    // Then the enemies/hostiles AND every turret the caller projected to screen
    // space — including the local player's own turrets, which now get a bar when
    // damaged (field request v0.2.2). The model filters anything full-and-idle (and
    // any bare local entity), so passing them all is correct.
    const combatants = frame.combatants ?? NO_COMBATANTS;
    for (const e of combatants) input.push(e);

    const bars = healthBarModel(input, frame.owner ?? 0);
    this.healthbars.update(bars, this.screenWidth, this.screenHeight);
  }

  // --- Player-name labels (field request v0.2.1) --------------------------

  /** Draw a name label over every ship and every owned planet (field request
   *  v0.2.1). The pure model in {@link ./nameplates} owns "who, what text, which
   *  colour, how faded"; this hands it the frame's already-projected entities and
   *  the lobby's per-slot name table, and draws the result in the screen-space
   *  layer stacked above the health bars. */
  private updateNameplates(frame: HudFrame): void {
    const entities = frame.nameables ?? NO_NAMEABLES;
    const plates = nameplateModel(
      entities,
      frame.names ?? NO_NAMES,
      { showOwnShipLabel: frame.showOwnShipLabel ?? false },
      frame.difficulties ?? NO_DIFFICULTIES,
    );
    this.nameplates.update(plates, this.screenWidth, this.screenHeight);
  }

  /** ?debug=1 live-stage seam: arm the nameplate layer's drawn-label capture so
   *  {@link debugNameplates} can read it back. Called once from `main.ts` under
   *  ?debug=1; no effect on a normal build. */
  enableNameplateDebug(): void {
    this.nameplates.enableDebugCapture();
  }

  /** The name labels the layer actually drew last frame — owner, text, colour,
   *  kind, position — for the live-stage test. Empty unless
   *  {@link enableNameplateDebug} was called. */
  debugNameplates(): DrawnNameplate[] {
    return this.nameplates.debugPlates();
  }

  // --- Tap Commander order markers (developer §4) -------------------------

  /** Draw the lock-on reticle, line-of-intent and waypoint pulse (developer §4).
   *  The pure model in {@link ./tap-markers} decides which markers exist and their
   *  identity colour from the pilot's standing order (already re-resolved and
   *  projected to screen by the caller); this hands it the frame's marker fields
   *  and draws the animated result in the bottom screen-space layer. The line of
   *  intent's origin is the viewport centre — the follow camera holds the local
   *  ship there, the same anchor the own-ship health bar uses. */
  private updateTapMarkers(frame: HudFrame): void {
    const markers = tapMarkersModel({
      owner: frame.owner ?? 0,
      waypoint: frame.tapWaypoint ?? null,
      lock: frame.tapLock ?? null,
      firing: frame.tapFiring ?? false,
      shipX: this.screenWidth / 2,
      shipY: this.screenHeight / 2,
    });
    this.tapMarkers.update(markers, frame.time);
  }

  /** ?debug=1 live-stage seam: arm the tap-marker layer's drawn-marker capture so
   *  {@link debugTapMarkers} can read it back. Called once from `main.ts` under
   *  ?debug=1; no effect on a normal build. */
  enableTapMarkerDebug(): void {
    this.tapMarkers.enableDebugCapture();
  }

  /** The order markers the layer actually drew last frame — the reticle (with the
   *  target it rides), the waypoint pulse (and whether it is fading on arrival),
   *  and whether the line of intent drew — for the live-stage test. Empty unless
   *  {@link enableTapMarkerDebug} was called. */
  debugTapMarkers(): DrawnTapMarkers {
    return this.tapMarkers.debugMarkers();
  }

  // --- Minimap (GDD §2.2; field request v0.2.2) ---------------------------

  /** Draw the minimap from this frame's map-space content (or hide it when the
   *  world isn't wired yet). The pure model in {@link ./minimap} holds the toggle
   *  state and the fit; this hands the view the frame, the current state, and the
   *  viewport/touch/insets it lays out against, plus the sim tick that throttles
   *  the content redraw. The touch flag + insets are stashed so a pointer event
   *  between frames ({@link minimapTap}) hit-tests the same geometry. */
  private updateMinimap(frame: HudFrame): void {
    this.minimapIsTouch = frame.isTouch;
    this.minimapInsets = frame.minimapInsets ?? {};
    const tick = frame.tick ?? Math.floor(frame.time * 60);
    this.minimap.update(
      frame.minimap ?? null,
      this.minimapModel.state,
      { width: this.screenWidth, height: this.screenHeight },
      this.minimapIsTouch,
      this.minimapInsets,
      tick,
    );
  }

  /**
   * Route a click/tap at a screen point to the minimap. If it lands on the active
   * surface (the corner square, or the whole overlay when expanded) the model
   * toggles and this returns `true` — the caller then consumes the event so the
   * same press never also flies the ship or engages a stick under it. Returns
   * `false` (leaving the event to fall through) when the minimap isn't showing or
   * the point missed. The ONE entry point PC clicks and mobile taps share, so the
   * two platforms can never diverge (docs/input-parity.md; ./minimap.test.ts).
   */
  minimapTap(x: number, y: number): boolean {
    if (!this.minimap.visible) return false;
    return this.minimapModel.tap(
      x,
      y,
      { width: this.screenWidth, height: this.screenHeight },
      this.minimapIsTouch,
      this.minimapInsets,
    );
  }

  /** Toggle the minimap (the `M` keyboard shortcut on PC — {@link
   *  ./minimap} `MINIMAP_TOGGLE_KEY}). No-op-safe when the minimap is hidden: the
   *  state flips regardless, and the view stays hidden until a frame is fed. */
  toggleMinimap(): void {
    this.minimapModel.toggle();
  }

  /** Whether the minimap overlay is open — for a caller that wants to know (e.g.
   *  to suppress a conflicting overlay). */
  minimapExpanded(): boolean {
    return this.minimapModel.expanded;
  }

  /** ?debug=1 live-stage seam: arm the minimap layer's drawn-state capture so
   *  {@link debugMinimap} can read it back. Called once from `main.ts` under
   *  ?debug=1; no effect on a normal build. */
  enableMinimapDebug(): void {
    this.minimap.enableDebugCapture();
  }

  /** The minimap state the layer actually drew last frame — the active rect (where
   *  a live-stage test taps to toggle), the toggle state, and the own-ship dot
   *  position (which the test watches track the ship's motion). Empty until
   *  {@link enableMinimapDebug} is called. */
  debugMinimap(): DrawnMinimap {
    return this.minimap.debugMinimap();
  }

  /**
   * The own ship's hull fraction the over-ship bar drew last frame (or -1 when it
   * has none) — the ?debug=1 live-stage seam reads this. The dedicated top-right
   * HULL readout was **removed** (field report v0.2: *"I don't need to see hull on
   * top right — it's already appearing on my ship"*); the over-ship bar is the
   * single truth now, so this seam reports that bar's own fill rather than a second
   * element's. The `hullReadout()`/over-ship-bar agreement the healthbars spec
   * checks therefore holds by construction — they are the same number.
   */
  debugHullReadout(): number {
    return this.lastLocalHullFraction;
  }

  // --- Build/Upgrade wheel ?debug=1 live-stage seam (field report v0.2) ------

  /** Whether the wheel view accepts input this frame — read by the cycle
   *  live-stage test to prove it still opens after rapid open/close mashing. */
  debugWheelInteractive(): boolean {
    return this.wheel.debugInteractive();
  }

  /** The upgrade wheel wedges the view actually drew last frame (empty when it is
   *  not up), so the live-stage test can assert a bought tier re-rendered. */
  debugUpgradeWedges(): DrawnUpgradeWedge[] {
    return this.wheel.debugUpgradeWedges();
  }

  /** The Build wheel wedges the view actually drew last frame (empty when the
   *  Build wheel is not up), so the repair-wedge live-stage test can read the
   *  REPAIR wedge's real effect/reason line ("+15 HP", the partial, "CORE FULL")
   *  off the shipped bundle. */
  debugBuildWedges(): DrawnBuildWedge[] {
    return this.wheel.debugBuildWedges();
  }

  /** The controls-strip rows resolved for this frame (empty on touch), so a
   *  live-stage test can prove the Build & Upgrade legend is contextual on the
   *  real client — a live key at your planet, a dimmed hint (never a dead key)
   *  away from it (field report v0.2.2). */
  debugControlsStrip(): readonly StripRow[] {
    return this.lastStripRows;
  }

  // --- Press-feedback ?debug=1 live-stage seam (field report v0.2.2) --------

  /** Drive a wedge press through the same path the real pointer handler uses, so
   *  a live-stage test can prove the pressed / rejected tell fires on the real
   *  booted client (not just the headless model). */
  debugPressWedge(surface: PressSurface, index: number): void {
    this.pressWheelSegment(surface, index);
  }

  /** Inject a confirmation directly, so a live-stage test can prove the confirm
   *  pulse + cost-float + core shimmer are wired and DRAWN — the derivation itself
   *  (`detectConfirmations`) is what the unit tests cover. */
  debugConfirmWedge(surface: PressSurface, index: number, amount: number, deposit: boolean, core: boolean): void {
    this.pressFeedback.confirm({ surface, index, amount, deposit, core }, this.frameTime);
  }

  /** The combined press/confirm motion the driver holds for one wedge this frame
   *  (scale, glow, shake, reject flash, shimmer) — read back by the live-stage
   *  test to assert a press scaled/glowed it and a disabled press red-flashed it. */
  debugWedgeFeedback(surface: PressSurface, index: number): ControlFeedback {
    return this.pressFeedback.feedback(surface, index, this.frameTime);
  }

  /** The cost floats live this frame — the test asserts a confirmed spend launched
   *  one toward the bank. */
  debugCostFloats(): CostFloat[] {
    return this.pressFeedback.floats(this.frameTime);
  }

  /** The core-shimmer alpha this frame (repair confirmations) — the test asserts a
   *  repair shimmered the core. */
  debugCoreShimmer(): number {
    return this.pressFeedback.coreShimmer(this.frameTime);
  }

  /** ?debug=1 live-stage seam: arm the health-bar layer's drawn-bar capture so
   *  {@link debugHealthBars} can read it back. Called once from `main.ts` only
   *  under ?debug=1 — the wiring the field report caught missing is what a
   *  live-stage Playwright test drives through here; no effect on a normal build. */
  enableHealthBarDebug(): void {
    this.healthbars.enableDebugCapture();
  }

  /** The health bars the real layer drew last frame — owner, fill, screen
   *  position — for the live-stage test. Empty unless {@link enableHealthBarDebug}
   *  was called. */
  debugHealthBars(): DrawnHealthBar[] {
    return this.healthbars.debugBars();
  }

  // --- Under-attack alarm (GDD §2.2 — a mechanic, not polish) -------------

  /**
   * Advance the sustained-damage trigger and draw the tell: a threat-red frame
   * around the screen plus the arrow pointing home. Returns whether the alarm is
   * sounding, which the onboarding prompt reads.
   *
   * Damage is *derived*, not reported: the drop in total planet HP (core +
   * shields + turrets) since last frame is the damage this frame took. Repair
   * and shield regen move it the other way and are ignored — only the fall
   * counts, which is exactly the "your planet is being hurt" signal.
   */
  private updateAlarm(frame: HudFrame): boolean {
    const maxCore = frame.maxCoreHp ?? 0;
    if (maxCore <= 0 || frame.planetAlive === false) {
      this.alarmGroup.visible = false;
      this.alarm.reset();
      this.lastDefenseHp = -1;
      this.lastTime = frame.time;
      return false;
    }

    const defenseHp = (frame.coreHp ?? maxCore) + (frame.shieldHp ?? 0) + (frame.turretHp ?? 0);
    // First frame with a planet: establish a baseline, never a phantom hit.
    const damage = this.lastDefenseHp < 0 ? 0 : Math.max(0, this.lastDefenseHp - defenseHp);
    this.lastDefenseHp = defenseHp;

    // dt from match time, clamped: a tab that was backgrounded must not dump a
    // multi-second drain into the bucket and silence a live siege.
    const dt = this.lastTime < 0 ? 0 : Math.min(0.25, Math.max(0, frame.time - this.lastTime));
    this.lastTime = frame.time;

    const active = this.alarm.update(dt, damage);
    this.alarmGroup.visible = active;
    if (!active) return false;

    // Frame: pulses with match time so it reads as an alarm rather than a border.
    const pulse = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(frame.time * 8));
    this.alarmFrame.clear();
    this.alarmFrame
      .rect(
        ALARM_FRAME_INSET,
        ALARM_FRAME_INSET,
        this.screenWidth - 2 * ALARM_FRAME_INSET,
        this.screenHeight - 2 * ALARM_FRAME_INSET,
      )
      .stroke({ width: ALARM_FRAME_STROKE, color: PALETTE.threatRed, alpha: pulse });

    this.drawHomeArrow(frame, pulse);
    return true;
  }

  /** The screen-edge arrow pointing home (GDD §2.2). Hidden when home is already
   *  on screen — at that point the planet itself is the tell. */
  private drawHomeArrow(frame: HudFrame, pulse: number): void {
    const ship = frame.shipPos;
    const home = frame.homePos;
    this.alarmArrow.clear();
    this.arrowDrawn = false;
    if (!ship || !home) return;

    const arrow = homeArrow(
      ship,
      home,
      { width: this.screenWidth, height: this.screenHeight },
      ARROW_EDGE_INSET,
    );
    if (arrow.onScreen) return;
    this.arrowDrawn = true;

    // A triangle pointing along `angle`, drawn at the clamped edge position.
    // The polygon comes from ./hud-geometry so the rect the registry records is
    // the rect a headless test can measure.
    this.alarmArrow
      .poly(arrowPoly(arrow, ARROW_SIZE))
      .fill({ color: PALETTE.threatRed, alpha: 0.55 + 0.45 * pulse });
  }

  // --- Build & Upgrade wheel (GDD §2.5) -----------------------------------

  /** Feed the wheel + panel models to the view. Returns whether the wheel is
   *  open, which the SPEND onboarding prompt triggers on (GDD §2.10). */
  private updateWheel(frame: HudFrame): boolean {
    const signals: BuildWheelSignals = {
      requested: frame.buildRequested ?? false,
      docked: frame.docked ?? false,
      shipAlive: frame.shipAlive ?? true,
      planetAlive: frame.planetAlive ?? true,
      cargo: frame.cargo,
      banked: frame.banked,
      turrets: frame.turrets ?? 0,
      shields: frame.shields ?? 0,
      coreHp: frame.coreHp ?? 0,
      maxCoreHp: frame.maxCoreHp ?? 0,
      collapsed: frame.collapsed ?? false,
    };
    const wheel = buildWheelModel(signals);
    const upgrade = upgradeWheelModel({
      // The upgrade wheel only exists behind the Build wheel's arrow (GDD §2.5).
      open: wheel.open && (frame.upgradePanelOpen ?? false),
      // ...and the WEAPON sub-wheel only inside that (RATIFIED v0.2.2).
      weaponOpen: (frame.upgradePanelOpen ?? false) && (frame.weaponWheelOpen ?? false),
      shipClass: frame.shipClass ?? ShipClass.Vanguard,
      tiers: frame.upgradeTiers ?? STOCK_TIERS,
      ore: wheel.ore,
    });

    // Confirmations, derived from the sim's own numbers (field report v0.2.2):
    // compare this frame to the last, but only across two frames where the wheel
    // was open — so a spawn/wiring jump (wheel shut) can never fake a repair, and
    // the celebration only fires while the player is actually at the wheel.
    const tiers = frame.upgradeTiers ?? STOCK_TIERS;
    const snap: WheelSnapshot & { open: boolean } = {
      coreHp: frame.coreHp ?? 0,
      banked: frame.banked,
      cargo: frame.cargo,
      turrets: frame.turrets ?? 0,
      shields: frame.shields ?? 0,
      tiers: { ...tiers },
      // The wheel level a bought tier's cost float should land on (a weapon-track
      // buy only happens with the sub-wheel drilled in).
      weaponOpen: upgrade.weaponOpen,
      open: wheel.open,
    };
    const prev = this.prevSnapshot;
    if (prev && prev.open && snap.open) {
      for (const c of detectConfirmations(prev, snap)) this.pressFeedback.confirm(c, frame.time);
    }
    this.prevSnapshot = snap;

    // Capture which wedges are pressable, so a press on a disabled one reads as a
    // rejection (shake + flash) rather than a dead press. Cost floats need the
    // upgrade wedge count to place an upgrade float at the right angle.
    this.buildReady = wheel.segments.map((s) => s.state === 'ready');
    this.upgradeReady = upgrade.wedges.map((w) => w.state === 'ready');
    this.upgradeWedgeCount = upgrade.wedges.length;

    this.wheel.update(wheel, upgrade, frame.time, this.pressFeedback);
    return wheel.open;
  }

  // --- Press & confirmation feedback (field report v0.2.2) -----------------

  /**
   * Register a press on a wheel wedge for the pressed/rejected tell. Called from
   * the boot path's pointer handler (the same tap that drives {@link ./build-wheel}
   * selection) and from the `?debug=1` live-stage seam. Whether it reads as a
   * press (scale + glow) or a rejection (shake + red flash) is decided *here* from
   * the wedge's own drawn state — the caller does not have to know, so one call
   * site covers both.
   */
  pressWheelSegment(surface: PressSurface, index: number): void {
    const ready = surface === 'build' ? this.buildReady[index] : this.upgradeReady[index];
    this.pressFeedback.press(surface, index, ready ?? false, this.frameTime);
  }

  /** Draw the floating ore costs launched by confirmed spends — each travels from
   *  its wedge toward the top-left bank readout and fades. Signal yellow, because
   *  a floating cost *is* ore (style-guide §2). */
  private updateCostFloats(frame: HudFrame): void {
    const floats = this.pressFeedback.floats(frame.time);
    const bankX = PAD + 8;
    const bankY = PAD + TOTAL_LABEL_H;
    for (let i = 0; i < floats.length; i++) {
      const f = floats[i]!;
      const start = this.floatStart(f);
      const t = f.progress;
      const text = this.floatSlot(i);
      text.visible = true;
      // A BANK deposit reads as ore arriving (`+n`); a spend reads as the bare cost.
      text.text = f.deposit ? `+${f.amount}` : `${f.amount}`;
      text.x = start.x + (bankX - start.x) * t;
      // Ease the vertical travel and lift it a touch, so it arcs toward the bank
      // rather than sliding flat.
      text.y = start.y + (bankY - start.y) * t - 10 * Math.sin(Math.PI * t);
      text.alpha = f.alpha;
      text.scale.set(1 + 0.15 * (1 - t));
    }
    for (let i = floats.length; i < this.floatTexts.length; i++) {
      const t = this.floatTexts[i];
      if (t) t.visible = false;
    }
  }

  /** The screen-space point a cost float launches from: its wedge's label point
   *  on the centred wheel, in the same geometry the view draws it at. */
  private floatStart(f: CostFloat): { x: number; y: number } {
    const cx = this.screenWidth / 2;
    const cy = this.screenHeight / 2;
    const r = wheelRadius(this.screenWidth, this.screenHeight) * 0.6;
    const angle =
      f.surface === 'build'
        ? segmentAngle(f.index)
        : upgradeWedgeAngle(f.index, Math.max(1, this.upgradeWedgeCount));
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  }

  private floatSlot(index: number): Text {
    const existing = this.floatTexts[index];
    if (existing) return existing;
    const text = this.makeText('', FONT_NUMERAL, 18, PALETTE.signalYellow, 'bold');
    text.anchor.set(0.5, 0.5);
    this.floatsGroup.addChild(text);
    this.floatTexts[index] = text;
    return text;
  }

  // --- Onboarding prompt ---------------------------------------------------

  private updateOnboarding(frame: HudFrame, wheelOpen: boolean, underAttack: boolean): void {
    const active = this.onboarding.update({
      nearAsteroid: frame.nearAsteroid,
      cargo: frame.cargo,
      cargoCap: frame.cargoCap,
      wheelOpen,
      hasOrdered: frame.hasOrdered ?? false,
      underAttack,
    });

    if (active === null) {
      this.promptGroup.visible = false;
      return;
    }

    // Input-agnostic wording via the action layer (GDD §2.10).
    this.promptText.text = resolvePromptText(active, frame.device, frame.fireMode);
    // Thumb-scale: wrap rather than run off the side of a phone. "Hold the FIRE
    // button on the asteroid — your shots chip the rock" is ~440 px on one line, which
    // is wider than a 390 px portrait screen; a prompt the player can't read is a
    // prompt that didn't fire (GDD §2.10, style-guide §9 "reads at a glance").
    this.promptText.style.wordWrap = true;
    this.promptText.style.wordWrapWidth = promptWrapWidth(this.screenWidth);
    this.promptText.style.align = 'center';

    // Size the panel to the text, centre-anchored on the group origin. The
    // stroke is centred on the path by Pixi, so it adds PROMPT_STROKE to the
    // drawn footprint — the same term promptWrapWidth() already subtracted, and
    // the same rect promptBounds() reports to the registry.
    const w = this.promptText.width + PROMPT_PAD_X;
    const h = this.promptText.height + PROMPT_PAD_Y;
    this.promptPanel.clear();
    this.promptPanel
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: PALETTE.vacuum, alpha: 0.82 })
      .stroke({ width: PROMPT_STROKE, color: PALETTE.plasma, alpha: 0.6 });
    // Plasma accent bar on the left — the weapon is plasma (style-guide §1).
    this.promptAccent.clear();
    this.promptAccent.rect(-w / 2, -h / 2, 4, h).fill({ color: PALETTE.plasma });
    // The accent is drawn on the panel's left edge and is narrower than it, so
    // the group's footprint stays exactly the stroked panel — what promptBounds
    // reports and what `full` + PAD is asserted against.

    this.promptGroup.visible = true;
  }

  // --- Layout registry seam (GDD §3.4 platform instrument) ----------------

  /**
   * The HUD's own {@link LayoutEntry}s — declared anchor plus the rect actually
   * drawn — for the layout registry (`@platform/layout-registry`). This is the
   * public seam the layout host already probes for via `isLayoutContributor`;
   * implementing it here means "if something is supposed to appear somewhere, it
   * appears there" becomes a test for the HUD too, without anyone reaching into
   * `src/ui` internals.
   *
   * Bounds come from the live Pixi objects (real text metrics), never from the
   * constants they were laid out with — a font swap that pushes the banked total
   * out of its corner has to be *caught*, not restated. Hidden elements are
   * omitted: the registry records what is drawn, never what would have been.
   *
   * **Every M2 element is here.** The wheel, the upgrade panel behind its arrow,
   * the under-attack frame and the screen-edge arrow home all register the frame
   * they are drawn, alongside the own-planet HP bar. Their anchors are argued in
   * the table below rather than picked for convenience:
   *
   * | id              | anchor        | why that region                        |
   * |-----------------|---------------|----------------------------------------|
   * | `planet-hp`     | `top-right`   | GDD §2.2 puts own-planet HP top-right. The only M2 element with a *narrow* anchor, so it is the only one whose width is a real constraint: `top-right`'s zone starts at the half-width line, giving the bar a `W/2 − PAD` budget — 144px on a 320px phone against a 140px bar. `hud-geometry.ts` owns that number and `hud-geometry.test.ts` pins it. |
   * | `build-wheel`   | `full` + 0    | GDD §2.2 opens the wheel "near your own planet"; the follow camera keeps your ship — and so your docked planet — at the screen centre, and the wheel is drawn there. It is an **overlay**: at thumb scale it is ~72% of the shorter screen dimension (GDD §2.4 makes it a touch target first), so no third-width band can hold it and `full` is the region the vocabulary reserves for overlays. The assertion that bites is the real failure mode — a thumb-scaled radial menu spilling off a phone's edge. |
   * | `upgrade-wheel` | `full` + 0    | Same overlay, one wheel deeper (GDD §2.5). Now a radial wheel like the Build wheel (field report v0.2), it shares the Build wheel's centred `2r` square, so the same overlay reasoning and edge assertion hold. |
   *
   * The top-right own-**ship** `hull-hud` readout that used to stack under
   * `planet-hp` was **removed** (field report v0.2: *"I don't need to see hull on
   * top right — it's already appearing on my ship"*). The over-ship bar is the
   * single truth for own-ship hull now, so nothing registers beneath HOME any
   * more — the anchor hole is closed, not left orphaned.
   * | `alarm-frame`   | `full` + 0    | It *is* the screen frame — `full` is a statement of intent, not a fallback. |
   * | `alarm-arrow`   | `full` + 0    | GDD §2.2's "screen-edge arrow": it hugs an edge but must never leave the screen, which is exactly what `full` asserts. There is no narrower region in the ratified vocabulary for "on an edge", and inventing one is the Director's call, not a placement fix. |
   * | `onboarding`    | `full` + PAD  | The one M2 element GDD §2.2 lists **without a position** — it names a corner or a band for every other element (ore top-left, HP top-right, clock top-centre, minimap bottom-right, strip along the bottom) and for the prompts says only "Onboarding prompts (section 2.10)"; §2.10 adds none either. So `center` (QA's placeholder in the PENDING list) is not a GDD claim to honour, and the honest contract is the one the design *does* make: a prompt the player cannot read is a prompt that didn't fire (§2.10), so it must never leave the screen. `full` + `PAD` asserts exactly that, and `promptWrapWidth()` is what makes it true rather than hopeful — see the note below. |
   *
   * **Why `onboarding` is `full` and not a band.** A prompt is a *sentence*, and
   * every interior region in the vocabulary is one third of the viewport wide.
   * "Hold the FIRE button on the asteroid — your shots chip the rock" is ~440 px on one
   * line — wider than a 390 px portrait phone, let alone its 98 px `center` zone
   * — so no band can hold it at any type size the style guide permits. The prompt
   * therefore takes the screen and signs the stronger promise it *can* keep: it
   * stays inside the HUD margin. `promptWrapWidth()` wraps the text at
   * `W − 2·PAD − PROMPT_PAD_X − PROMPT_STROKE` so the stroked panel lands exactly
   * on that margin in the worst case, which is why this registers with a real
   * `PAD` margin rather than the bare `full` the overlays above use.
   *
   * Its vertical placement (`PROMPT_CENTER_Y`, below the ship, above the strip)
   * is a readability choice, not an anchor claim — no region in the vocabulary
   * distinguishes it, and `hud-geometry.test.ts` pins the footprint it produces.
   *
   * **Still not registered, and why — measured, not estimated.** One element is
   * left: `wave-clock` (`top-center` in QA's contract). It is worth being exact
   * about what kind of gap that is: the clock is **not an M2 element**. It
   * shipped with the day-1 HUD (`b923b53`), so it is a pre-existing M1 straggler
   * that this M2 reconcile inherited rather than introduced — every element M2
   * actually added is in the table above. Its zone is one third of the viewport
   * wide and the clock is intrinsically wider. The numbers below
   * were read out of a real browser frame — the zone from the registry's own
   * `resolveAnchor`, the widths from `measureText` in the shipped font stack:
   *
   *  - `top-center` resolves to **98 px** wide on a 390 px portrait phone
   *    (`W/3 − 2·PAD`), and **74.7 px** on the 320 px narrowest profile in the
   *    matrix.
   *  - "WAVE 1/5 · Outer Drift" is **168 px** at its drawn 15 px, and still
   *    **134 px** at 12 px — the floor style-guide §5.6 sets for HUD type
   *    ("Oxanium must remain legible at 12px"). That is 1.4× the zone *at the
   *    smallest type the style guide permits*, so this cannot be fixed by
   *    shrinking: the copy runs out of road before the zone does.
   *  - Splitting the name onto its own line does not rescue it either. That is a
   *    four-line clock, and on the 320 px profile "Outer Drift" (81 px) and
   *    "MATCH 0:02" (91 px) each still overflow a 74.7 px zone at 15 px; both
   *    only fit once *every* line drops to the 12 px floor.
   *
   * So the honest options are all design decisions, not placement bugs: shorten
   * the wave names, accept a floor-type four-line clock on phones, or give
   * `top-center` a full-width variant. The last one lives in
   * `src/platform/layout-registry.ts`'s ratified anchor vocabulary, which is not
   * mine to extend.
   *
   * **And `full` is not the escape hatch here that it is for `onboarding`.** The
   * difference is not the geometry — both elements are wider than a third-width
   * band — it is what the GDD claims. §2.2 puts "the **ASTEROID WAVE clock** (top
   * center)" in writing, so `top-center` is a *specified* placement; answering it
   * with `full` would keep the element green while silently discarding the only
   * claim worth checking, which is the definition of loosening the contract. The
   * prompts are listed in that same paragraph with **no position at all**, so
   * `full` + `PAD` there discards nothing — it is the strongest promise the
   * design actually makes. Same region, opposite honesty, because the GDD says
   * different things about the two.
   *
   * **Caveat that cuts in our favour.** `assets/` ships no fonts yet (Art &
   * Audio's deliverable), so those widths were measured in the
   * `"Trebuchet MS", sans-serif` fallback. Audiowide is a *wider* display face:
   * every number above is a lower bound, and the real clock only overflows
   * harder once the fonts land. That same dependency is why both golden
   * baselines will legitimately need regenerating on the day they do.
   *
   * Registering `wave-clock` today would turn QA's suite red on a real finding
   * that nobody has been given the call on. It lands the moment one is made;
   * nothing else here changes.
   */
  describeLayout(viewport: Viewport): LayoutEntry[] {
    const entries: LayoutEntry[] = [];
    /** Visible all the way up to this HUD — a child of a hidden group is not
     *  drawn, and the registry records only what is drawn. */
    const shown = (node: Container): boolean => {
      for (let n: Container | null = node; n; n = n.parent) {
        if (!n.visible) return false;
        if (n === (this as Container)) return true;
      }
      return false;
    };
    const push = (
      id: string,
      region: LayoutEntry['anchor']['region'],
      margin: number,
      node: Container,
    ): void => {
      if (!shown(node)) return;
      const b = node.getBounds();
      entries.push({
        id,
        anchor: { region, margin },
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      });
    };

    // M1 ids and regions are QA's, from the PENDING list in their layout contract.
    push('ore-hud', 'top-left', PAD, this.oreGroup);
    push('banked-total', 'top-left', PAD, this.bankedText);
    push('controls-strip', 'bottom-strip', 0, this.stripGroup);

    // M2 (see the table above).
    push('planet-hp', 'top-right', PAD, this.planetGroup);
    // The top-right own-ship HULL readout was removed (field report v0.2 — the
    // over-ship bar is the truth now), so nothing registers under `top-right`
    // beneath HOME any more: the layout hole is closed, not orphaned.
    push('build-wheel', 'full', 0, this.wheel.wheelNode);
    push('upgrade-wheel', 'full', 0, this.wheel.panelNode);
    push('alarm-frame', 'full', 0, this.alarmFrame);
    if (this.arrowDrawn) push('alarm-arrow', 'full', 0, this.alarmArrow);
    push('onboarding', 'full', PAD, this.promptGroup);
    // Respawn countdown: a centred overlay wider than any third-width band (a
    // prominent line), so it registers `full` + PAD on the same reasoning as the
    // prompt — wrapped to stay inside the HUD margin (see respawnWrapWidth). Only
    // drawn while dead-and-respawning, so `shown()` omits it the rest of the time.
    push('respawn-countdown', 'full', PAD, this.respawnGroup);

    // Over-entity health bars: the layer computes its own union bounds (only the
    // bars that actually drew on-screen), so it registers itself rather than
    // going through `push` — its footprint is not one child's getBounds(). Gated
    // on the HUD's own visibility, the same as `shown()` does for `push`.
    if (shown(this.healthbars)) {
      for (const entry of this.healthbars.describeLayout(viewport)) entries.push(entry);
    }

    // Name labels: same self-registering, screen-space discipline as the health
    // bars — the union of the labels that actually drew on-screen (culled off the
    // edge), so its `full` anchor stays honest, or nothing when nothing is named.
    if (shown(this.nameplates)) {
      for (const entry of this.nameplates.describeLayout(viewport)) entries.push(entry);
    }

    // Under-ship ore-hold indicator: the same self-registering, screen-space
    // discipline as the health bars — it reports the pip row it actually drew
    // (culled off-screen, so the `full` anchor stays honest), or nothing when the
    // hold is empty and idle. Its bounds come from the row itself, not a child's
    // getBounds(), so it registers itself the same way.
    if (shown(this.oreHold)) {
      for (const entry of this.oreHold.describeLayout(viewport)) entries.push(entry);
    }

    // Minimap: registers its corner rect when collapsed and its overlay rect when
    // expanded (one at a time — the state it drew), through the same self-computed
    // getBounds() discipline as the health bars. So "it appears where it's supposed
    // to" is a test on BOTH states and BOTH phone profiles (field request rule 3).
    if (shown(this.minimap)) {
      for (const entry of this.minimap.describeLayout(viewport)) entries.push(entry);
    }

    // `viewport` is the host's size; the HUD was laid out against the same
    // numbers via resize(), so a mismatch is itself the drift worth catching.
    void viewport;
    return entries;
  }

  // --- Helpers -------------------------------------------------------------

  private makeText(
    text: string,
    fontFamily: string,
    fontSize: number,
    fill: number,
    fontWeight: TextStyleFontWeight = 'normal',
  ): Text {
    return new Text({
      text,
      style: { fontFamily, fontSize, fill, fontWeight, letterSpacing: 0.5 },
    });
  }
}

/** Clamp a fraction to 0..1, treating a non-finite value as empty — a hull HP of
 *  NaN must read as "no bar", never over/under-draw. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
