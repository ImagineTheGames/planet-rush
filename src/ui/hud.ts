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
 *  - **Onboarding prompts** (GDD §2.10): the first two, input-agnostic via the
 *    action layer, each firing once.
 *
 * The under-attack alarm + screen-edge arrow, over-ship hull bars, own-planet
 * HP, the build wheel and upgrade panel arrive on day 2+ with planets/combat in
 * the sim — this file is scoped to what day-1 sim state can drive.
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
import { Onboarding, resolvePromptText } from './onboarding';
import { computeWaveClock, formatClock } from './wave-clock';
import { oreHudModel, oreFlashOn } from './ore-hud';
import { controlsStripRows, showControlsStrip } from './controls-strip';

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

// ---------------------------------------------------------------------------
// The per-frame HUD input
// ---------------------------------------------------------------------------

/**
 * Everything the HUD needs for one frame, derived by the caller from the local
 * ship + world. Device-neutral where the sim is; the device/fireMode drive only
 * the controls strip and the input-agnostic prompt wording (GDD §2.4, §2.10).
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

    this.addChild(this.oreGroup, this.waveGroup, this.stripGroup, this.promptGroup);
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
    this.stripGroup.y = this.screenHeight - SQUARE - STRIP_PAD;
    this.promptGroup.x = this.screenWidth / 2;
    this.promptGroup.y = this.screenHeight * 0.7;
  }

  /** Draw one frame. Pull the pure models, then update the Pixi children. */
  update(frame: HudFrame): void {
    this.updateOre(frame);
    this.updateWaveClock(frame);
    this.updateControlsStrip(frame);
    this.updateOnboarding(frame);
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

  // --- Onboarding prompt ---------------------------------------------------

  private updateOnboarding(frame: HudFrame): void {
    const active = this.onboarding.update({
      nearAsteroid: frame.nearAsteroid,
      cargo: frame.cargo,
      cargoCap: frame.cargoCap,
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
