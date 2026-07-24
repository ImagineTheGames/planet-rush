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
const SQUARE = 18;
const SQUARE_GAP = 5;
const STRIP_PAD = 12;

/**
 * Outline width of an *empty* ore slot's ghost square.
 *
 * Drawn **inset by half its width**, so the stroke lands entirely inside the
 * `SQUARE × SQUARE` footprint the row was laid out with. Pixi centres a stroke
 * on its path: an outline drawn on the footprint itself would bleed
 * `SLOT_STROKE / 2` px *outside* it, which put the ore HUD's real rendered
 * bounds at x = PAD − 0.75 and escaped the `top-left` margin-`PAD` anchor by a
 * quarter pixel on every phone profile. The registry was right and the drawing
 * was wrong (GDD §2.2 puts ore at a glance in the top-left corner, and the
 * margin is what "corner, not edge" means), so the stroke moved inward rather
 * than the anchor outward.
 */
const SLOT_STROKE = 1.5;


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

  // --- Day 2: the endgame (GDD §2.3) ---------------------------------------

  /** The collapse phase has begun (the sim's `isCollapsed`): no shield regen,
   *  no repair, no new ore. Greys out REPAIR CORE on the wheel and puts
   *  COLLAPSE on the wave clock. Default false. */
  readonly collapsed?: boolean;
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
  /** Whether the screen-edge arrow actually drew this frame. The arrow is hidden
   *  while home is already on screen (the planet is its own tell), and the
   *  registry records what is drawn, never what would have been. */
  private arrowDrawn = false;

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
    // Below the ship (the follow camera holds it at the centre) and above the
    // controls strip, so the prompt never covers the thing it is pointing at.
    // The fraction lives in hud-geometry.ts with the rest of the prompt's
    // geometry, so `describeLayout`'s registered rect is computed from the same
    // number this draws with.
    this.promptGroup.y = this.screenHeight * PROMPT_CENTER_Y;
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
        // Outline on an inset path, so the centred stroke stays inside the
        // square's footprint and the row's bounds are exactly its layout box.
        const i2 = SLOT_STROKE / 2;
        g.roundRect(i2, i2, SQUARE - SLOT_STROKE, SQUARE - SLOT_STROKE, 3 - i2).stroke({
          width: SLOT_STROKE,
          color: PALETTE.signalYellow,
          alpha: 0.5,
        });
      }
    }

    this.bankedText.text = `ORE ${model.banked}`;
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
    // Thumb-scale: wrap rather than run off the side of a phone. "Hold the FIRE
    // button on the asteroid — your beam mines it" is ~440 px on one line, which
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
    // Plasma accent bar on the left — the beam is plasma (style-guide §1).
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
   * | `upgrade-panel` | `full` + 0    | Same overlay, one screen deeper (GDD §2.5). Its width is clamped to the viewport (`panelSize`) precisely so this holds on a narrow phone. |
   * | `alarm-frame`   | `full` + 0    | It *is* the screen frame — `full` is a statement of intent, not a fallback. |
   * | `alarm-arrow`   | `full` + 0    | GDD §2.2's "screen-edge arrow": it hugs an edge but must never leave the screen, which is exactly what `full` asserts. There is no narrower region in the ratified vocabulary for "on an edge", and inventing one is the Director's call, not a placement fix. |
   * | `onboarding`    | `full` + PAD  | The one M2 element GDD §2.2 lists **without a position** — it names a corner or a band for every other element (ore top-left, HP top-right, clock top-centre, minimap bottom-right, strip along the bottom) and for the prompts says only "Onboarding prompts (section 2.10)"; §2.10 adds none either. So `center` (QA's placeholder in the PENDING list) is not a GDD claim to honour, and the honest contract is the one the design *does* make: a prompt the player cannot read is a prompt that didn't fire (§2.10), so it must never leave the screen. `full` + `PAD` asserts exactly that, and `promptWrapWidth()` is what makes it true rather than hopeful — see the note below. |
   *
   * **Why `onboarding` is `full` and not a band.** A prompt is a *sentence*, and
   * every interior region in the vocabulary is one third of the viewport wide.
   * "Hold the FIRE button on the asteroid — your beam mines it" is ~440 px on one
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
    push('build-wheel', 'full', 0, this.wheel.wheelNode);
    push('upgrade-panel', 'full', 0, this.wheel.panelNode);
    push('alarm-frame', 'full', 0, this.alarmFrame);
    if (this.arrowDrawn) push('alarm-arrow', 'full', 0, this.alarmArrow);
    push('onboarding', 'full', PAD, this.promptGroup);

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
