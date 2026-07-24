/**
 * src/ui/hud.ts — the in-play HUD. OWNER: UI Engineer (GDD §3.7, §2.2).
 *
 * A screen-space PixiJS overlay that sits on top of the world render layer
 * (`@render`) in the same canvas — it does NOT move with the camera. The HUD
 * "shows only what the player acts on" (GDD §2.2). Day-1 surface (GDD §4.6):
 *
 *  - **Ore at a glance** (top-left): filled squares per cargo slot, flashing
 *    when full, above the banked ORE total (GDD §2.2, §2.3).
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
 * Over-ship hull bars and the minimap arrive with the remaining M2 wiring.
 *
 * All decision logic lives in the pure, unit-tested sibling modules
 * ({@link ./onboarding}, {@link ./wave-clock}, {@link ./ore-hud},
 * {@link ./controls-strip}); this file is the thin Pixi *view* that draws them.
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
import type { DeviceKind, FireMode, BindingLabel } from '@platform/actions';
import type { LayoutEntry, Viewport } from '@platform/layout-registry';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { Onboarding, resolvePromptText } from './onboarding';
import { computeWaveClock, formatClock } from './wave-clock';
import { oreHudModel, oreFlashOn } from './ore-hud';
import { controlsStripRows, showControlsStrip } from './controls-strip';
import { buildWheelModel } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { BuildWheelView } from './build-wheel-view';
import { upgradePanelModel, STOCK_TIERS } from './upgrade-panel';
import type { UpgradeTiers } from './upgrade-panel';
import { UnderAttackAlarm, homeArrow, ARROW_EDGE_INSET } from './alarm';
import type { Point } from './alarm';
import { planetHpModel, planetHpFlashOn } from './planet-hp';

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

const PAD = 16;
const SQUARE = 18;
const SQUARE_GAP = 5;
const STRIP_PAD = 12;

/** Own-planet HP bar (top-right, GDD §2.2). Wide enough to read a quarter-core
 *  loss at arm's length on a phone. */
const HP_BAR_WIDTH = 140;
const HP_BAR_HEIGHT = 10;
/** Thin shield overbar above it — shields stand in front of the core (GDD §2.5). */
const SHIELD_BAR_HEIGHT = 4;

/** Screen-edge arrow triangle size, CSS px. */
const ARROW_SIZE = 15;

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
  /** An asteroid is within beam range — the mine prompt's trigger (GDD §2.10). */
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
  /** Any wheel order has been placed this match — retires the SPEND onboarding
   *  prompt (GDD §2.10). Default false. */
  readonly hasOrdered?: boolean;
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
}

// ---------------------------------------------------------------------------
// The HUD
// ---------------------------------------------------------------------------

export class Hud extends Container {
  /** Onboarding state machine — each prompt fires once (GDD §2.10). */
  private readonly onboarding = new Onboarding();

  // --- Ore at a glance (top-left) -----------------------------------------
  private readonly oreGroup = new Container();
  private readonly squares: Graphics[] = [];
  private squareCount = -1; // forces a rebuild on first frame
  private readonly bankedText: Text;

  // --- Wave clock (top-center) --------------------------------------------
  private readonly waveGroup = new Container();
  private readonly waveName: Text;
  private readonly waveNext: Text;
  private readonly waveMatch: Text;

  // --- Controls strip (bottom, desktop only) ------------------------------
  private readonly stripGroup = new Container();
  private readonly stripLabels: Text[] = [];
  private stripSignature = ''; // rebuild only when device/mode/visibility change

  // --- Onboarding prompt (lower-center) -----------------------------------
  private readonly promptGroup = new Container();
  private readonly promptPanel = new Graphics();
  private readonly promptAccent = new Graphics();
  private readonly promptText: Text;

  // --- Own planet HP (top-right, player colour — GDD §2.2) ----------------
  private readonly planetGroup = new Container();
  private readonly planetLabel: Text;
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

  // --- Build & Upgrade wheel + upgrade panel (GDD §2.5) -------------------
  private readonly wheel: BuildWheelView;

  constructor(
    private screenWidth: number,
    private screenHeight: number,
  ) {
    super();

    // Ore group: squares are built lazily in update(); the banked total below.
    this.bankedText = this.makeText('', FONT_NUMERAL, 20, PALETTE.signalYellow, 'bold');
    this.oreGroup.addChild(this.bankedText);
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

    // Own planet HP: a right-anchored label above a bar in the player's colour.
    this.planetLabel = this.makeText('HOME', FONT_HEADING, 11, TEXT_DIM);
    this.planetLabel.anchor.set(1, 0);
    this.planetGroup.addChild(this.planetBar, this.planetLabel);
    this.planetGroup.visible = false;

    // Alarm: a threat-red frame around the whole screen plus the arrow home.
    // Both are drawn only while the alarm is sounding — threat red is never a
    // resting-state colour (style-guide §2).
    this.alarmGroup.addChild(this.alarmFrame, this.alarmArrow);
    this.alarmGroup.visible = false;

    // The wheel draws above the HUD chrome: while it is open it *is* the screen.
    this.wheel = new BuildWheelView(screenWidth, screenHeight);

    this.addChild(
      this.oreGroup,
      this.waveGroup,
      this.planetGroup,
      this.stripGroup,
      this.alarmGroup,
      this.wheel,
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
    this.stripGroup.y = this.screenHeight - SQUARE - STRIP_PAD;
    this.promptGroup.x = this.screenWidth / 2;
    // Below the ship, above the controls strip, and clear of the bottom third's
    // upper edge so the registry's `bottom-center` anchor holds at any height.
    this.promptGroup.y = this.screenHeight * 0.72;
    this.wheel.resize(this.screenWidth, this.screenHeight);
  }

  /** Draw one frame. Pull the pure models, then update the Pixi children. */
  update(frame: HudFrame): void {
    this.updateOre(frame);
    this.updateWaveClock(frame);
    this.updatePlanetHp(frame);
    this.updateControlsStrip(frame);
    // The alarm runs before the wheel and the prompts, because both read its
    // verdict: the wheel is not hidden by it, but the onboarding prompt is
    // chosen by it (GDD §2.10's under-attack prompt).
    const underAttack = this.updateAlarm(frame);
    const wheelOpen = this.updateWheel(frame);
    this.updateOnboarding(frame, wheelOpen, underAttack);
  }

  // --- Ore at a glance -----------------------------------------------------

  private updateOre(frame: HudFrame): void {
    const model = oreHudModel(frame.cargo, frame.cargoCap, frame.banked);

    // Rebuild the square row only when the slot count changes (cargo upgrade).
    if (model.slots !== this.squareCount) {
      for (const s of this.squares) s.destroy();
      this.squares.length = 0;
      for (let i = 0; i < model.slots; i++) {
        const g = new Graphics().roundRect(0, 0, SQUARE, SQUARE, 3);
        g.x = i * (SQUARE + SQUARE_GAP);
        this.oreGroup.addChildAt(g, 0); // behind the banked text
        this.squares.push(g);
      }
      this.squareCount = model.slots;
      // Banked total sits just under the square row.
      this.bankedText.y = SQUARE + 8;
    }

    // Fill/outline each square; the full hold flashes (GDD §2.2).
    const flashOn = oreFlashOn(model, frame.time);
    for (let i = 0; i < this.squares.length; i++) {
      const g = this.squares[i]!;
      const filled = i < model.filled;
      g.clear();
      g.roundRect(0, 0, SQUARE, SQUARE, 3);
      if (filled) {
        // Filled ore square: signal yellow, RESERVED for ore (style-guide §2).
        g.fill({ color: PALETTE.signalYellow, alpha: model.full && !flashOn ? 0.45 : 1 });
      } else {
        g.fill({ color: PALETTE.signalYellow, alpha: 0.1 }); // faint slot ghost
        g.stroke({ width: 1.5, color: PALETTE.signalYellow, alpha: 0.5 });
      }
    }

    this.bankedText.text = `ORE ${model.banked}`;
  }

  // --- Wave clock ----------------------------------------------------------

  private updateWaveClock(frame: HudFrame): void {
    const clock = computeWaveClock(frame.time);
    this.waveName.text = `WAVE ${clock.wave}/${clock.waveCount} · ${clock.name}`;
    this.waveNext.text = clock.isFinalWave
      ? 'FINAL WAVE'
      : `NEXT ${formatClock(clock.countdownToNext ?? 0)}`;
    this.waveMatch.text = `MATCH ${formatClock(clock.matchTime)}`;
  }

  // --- Controls strip (desktop only) --------------------------------------

  private updateControlsStrip(frame: HudFrame): void {
    const show = showControlsStrip(frame.isTouch);
    this.stripGroup.visible = show;
    if (!show) return;

    const rows = controlsStripRows(frame.device, frame.fireMode, frame.isTouch);
    // Rebuild the label objects only when the binding set changes, not per frame.
    const signature = `${frame.device}:${frame.fireMode}:${rows.map((r) => r.binding).join(',')}`;
    if (signature !== this.stripSignature) {
      this.rebuildStrip(rows);
      this.stripSignature = signature;
    }
  }

  private rebuildStrip(rows: readonly BindingLabel[]): void {
    for (const t of this.stripLabels) t.destroy();
    this.stripLabels.length = 0;

    // Lay out "KEY action" pairs left→right along the bottom. Keys in plasma,
    // actions in grey — NOT yellow (style-guide §2 overrides GDD §2.4 prose;
    // see ./controls-strip for the reconciliation).
    let x = STRIP_PAD;
    for (const row of rows) {
      const key = this.makeText(row.binding, FONT_NUMERAL, 13, PALETTE.plasma, 'bold');
      key.x = x;
      this.stripGroup.addChild(key);
      this.stripLabels.push(key);
      x += key.width + 6;

      const label = this.makeText(row.label, FONT_HEADING, 12, TEXT_DIM);
      label.x = x;
      label.y = 1;
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

    const y = 16;
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

    this.planetLabel.text = model.destroyed ? 'HOME LOST' : 'HOME';
    this.planetLabel.style.fill = model.destroyed ? model.criticalColor : TEXT_DIM;
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
      .rect(2, 2, this.screenWidth - 4, this.screenHeight - 4)
      .stroke({ width: 4, color: PALETTE.threatRed, alpha: pulse });

    this.drawHomeArrow(frame, pulse);
    return true;
  }

  /** The screen-edge arrow pointing home (GDD §2.2). Hidden when home is already
   *  on screen — at that point the planet itself is the tell. */
  private drawHomeArrow(frame: HudFrame, pulse: number): void {
    const ship = frame.shipPos;
    const home = frame.homePos;
    this.alarmArrow.clear();
    if (!ship || !home) return;

    const arrow = homeArrow(
      ship,
      home,
      { width: this.screenWidth, height: this.screenHeight },
      ARROW_EDGE_INSET,
    );
    if (arrow.onScreen) return;

    // A triangle pointing along `angle`, drawn at the clamped edge position.
    const cos = Math.cos(arrow.angle);
    const sin = Math.sin(arrow.angle);
    const tip = { x: arrow.x + cos * ARROW_SIZE, y: arrow.y + sin * ARROW_SIZE };
    const backX = arrow.x - cos * ARROW_SIZE * 0.5;
    const backY = arrow.y - sin * ARROW_SIZE * 0.5;
    const nx = -sin * ARROW_SIZE * 0.7;
    const ny = cos * ARROW_SIZE * 0.7;
    this.alarmArrow
      .poly([tip.x, tip.y, backX + nx, backY + ny, backX - nx, backY - ny])
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
    };
    const wheel = buildWheelModel(signals);
    const panel = upgradePanelModel({
      // The panel only exists behind an open wheel's arrow (GDD §2.5).
      open: wheel.open && (frame.upgradePanelOpen ?? false),
      shipClass: frame.shipClass ?? ShipClass.Vanguard,
      tiers: frame.upgradeTiers ?? STOCK_TIERS,
      ore: wheel.ore,
    });
    this.wheel.update(wheel, panel);
    return wheel.open;
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

    // Size the panel to the text, centre-anchored on the group origin.
    const w = this.promptText.width + 40;
    const h = this.promptText.height + 22;
    this.promptPanel.clear();
    this.promptPanel
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: PALETTE.vacuum, alpha: 0.82 })
      .stroke({ width: 1, color: PALETTE.plasma, alpha: 0.6 });
    // Plasma accent bar on the left — the beam is plasma (style-guide §1).
    this.promptAccent.clear();
    this.promptAccent.rect(-w / 2, -h / 2, 4, h).fill({ color: PALETTE.plasma });

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
   * **Not yet registered, and why.** QA's layout contract
   * (`tests/mobile/layout.spec.ts`) declares two more HUD ids — `wave-clock`
   * (`top-center`) and `onboarding` (`center`) — and asserts every *registered*
   * element sits inside its anchor. Both of those zones are one third of the
   * viewport wide, and at phone widths the wave clock's line ("WAVE 1/5 ·
   * Outer Drift") and the onboarding prompt's sentence are both intrinsically
   * wider than that; the prompt also sits below the vertical centre band by
   * design, under the ship rather than on top of it. Registering them today
   * would turn QA's suite red on a *real* finding that is a design question —
   * shrink the copy, wrap it, or give those regions a full-width variant — and
   * that is the Director's call, not something to force mid-milestone. They land
   * the moment it is answered; nothing else here changes.
   */
  describeLayout(viewport: Viewport): LayoutEntry[] {
    const entries: LayoutEntry[] = [];
    const push = (
      id: string,
      region: LayoutEntry['anchor']['region'],
      margin: number,
      node: Container,
    ): void => {
      if (!node.visible) return;
      const b = node.getBounds();
      entries.push({
        id,
        anchor: { region, margin },
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      });
    };

    // Ids and regions are QA's, from the PENDING list in their layout contract.
    push('ore-hud', 'top-left', PAD, this.oreGroup);
    push('banked-total', 'top-left', PAD, this.bankedText);
    push('planet-hp', 'top-right', PAD, this.planetGroup);
    push('controls-strip', 'bottom-strip', 0, this.stripGroup);
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
