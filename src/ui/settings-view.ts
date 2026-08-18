/**
 * src/ui/settings-view.ts — the Pixi view for the settings screen.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./settings}. Every value lives in the model and
 * every rect in {@link ./settings} `settingsLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-01, ratified 2026-08-05)
 * ---------------------------------------------------------------------------
 * The screen is now made of the same material as the title: a header beam
 * carrying SETTINGS and the one standing instruction, a footer beam carrying
 * DONE, and six rows in between drawn as `inert` plates — surfaces that hold a
 * control rather than plates that stand off the screen. Every bevel, rule, band
 * and tone comes from {@link ../art/materials}; nothing is hand-rolled here.
 *
 * **DONE is the screen's ONE bright plate.** Under Bone the primary action is
 * simply the brightest plate on screen, which only works while there is exactly
 * one — so every row, every value chip and every stepper is deliberately *not*
 * primary, however "engaged" the setting behind it is. An engaged toggle is
 * marked by the brightest hairline on its chip, not by a brighter plate and not
 * by a hue: this screen, like the title, spends no colour at all. That is what
 * keeps signal yellow meaning ore and threat red meaning danger (style-guide
 * §1–§2) — neither appears here, because nothing on this screen is either.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  ROW,
  TRACKING,
  VALUE_CHIP,
  drawBeam,
  drawPlate,
  plateTypeSize,
  trackingPx,
  typeSize,
  valueChipHeight,
} from '../art/materials';
import type { FrameMetrics, PlateState } from '../art/materials';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING } from './typography';
import {
  SETTINGS_HELP_GLYPH,
  SETTINGS_ID,
  VOLUME_STEPS,
  settingsHitTest,
  settingsLayout,
  volumeButtons,
} from './settings';
import type { SettingsLayout, SettingsModel, SettingsRowView, SettingsTarget } from './settings';
import type { Insets } from './menu-geometry';
import { CodexHintView } from './codex-hint-view';
import { ScreenCache } from './screen-cache';

export const SETTINGS_ANCHOR: AnchorSpec = { region: 'full' };

/** Reference type sizes, read off the handoff's settings screen. */
const HEADING_PX = 22;
const EYEBROW_PX = 12;
const ROW_LABEL_PX = 16;
const VALUE_PX = 15;
const STEPPER_PX = 20;
const DONE_PX = 22;

/** The pip bar's height and the gap between two pips (handoff 14 / 4). */
const PIP_HEIGHT = 14;
const PIP_GAP = 4;
/**
 * The label column on a volume row — the handoff's fixed 176px, at the reference.
 *
 * It scales with the PLATE, not with the row: what has to fit in it is
 * `MASTER VOLUME` set in Oxanium, and type scales with `plateScale`. Taking it as
 * a share of the row instead (176/680 = 26%) is what put the pips through the
 * middle of the word on a 390px phone column, where 26% is 101px and the label is
 * ~122 — u7-01's first phone golden.
 */
const VOLUME_LABEL_COLUMN = 176;

/**
 * The least room the pips may be squeezed into on a volume row, at the reference
 * — scaled with the plate like every other number here (a0-77).
 *
 * {@link VOLUME_LABEL_COLUMN} is a *preference*, read off a desktop handoff whose
 * row is 680px wide. On the 372px row a landscape phone gets, that fixed column
 * spends 25px it does not have to spare now that the row also carries a `?`, and
 * the pips are what pays. So the column is now honoured only while it leaves the
 * pips this much: the label still cannot be written over (its measured width is
 * a hard floor, unchanged), and the readout no longer collapses to keep a
 * desktop metric that has nothing left to buy at that width.
 */
const PIPS_MIN_WIDTH = 90;

/** The focus ring's stroke and inset (logical px at the reference). A keyboard
 *  focus is drawn as a RING rather than as the hover state, so "the pointer is
 *  here" and "the keyboard is here" stay two different pictures. */
const FOCUS_RING_WIDTH = 2;
const FOCUS_RING_INSET = 2;

interface RowNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly value: Text;
  readonly minus: Text;
  readonly plus: Text;
  /** The row's `?` glyph (a0-77) — the control that explains the setting. */
  readonly help: Text;
}

/**
 * The settings screen. Add once, {@link resize} on every viewport change,
 * {@link update} each frame with a {@link SettingsModel}; hide it when the flow
 * leaves the settings screen.
 */
export class SettingsView extends Container {
  private readonly backdrop = new Graphics();
  /** Whether the shell has put the real void behind this screen (a0-79). */
  private voidBehind = false;
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly eyebrow: Text;
  private readonly rowNodes: RowNodes[] = [];
  private readonly backBody = new Graphics();
  /** A settings screen is static between state changes — see ./screen-cache. */
  private readonly cache = new ScreenCache(this);
  private readonly backLabel: Text;
  /**
   * The `?` panel (a0-77) — **the lobby's own codex tooltip**, not a second
   * implementation of one: a compact title-and-summary panel that floats near
   * the control it describes and is clamped inside the viewport. Reusing it is
   * the brief's instruction and the reason the two popups in this game cannot
   * drift apart, since there is only one.
   */
  private readonly hint = new CodexHintView();
  /** The logical viewport, kept so the panel can be clamped inside it — the
   *  layout's rects are inside the frame's margins, and the panel is allowed the
   *  whole screen. */
  private viewport: Viewport;
  /** Which explanation the cached texture was rasterised with. A panel opening
   *  changes the container's contents outside any rect this screen redraws, so
   *  the cache is dropped whole rather than refreshed in place. */
  private cachedHelp: number | null = null;

  private layout: SettingsLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.viewport = { width: screenWidth, height: screenHeight };
    this.layout = settingsLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));
    this.heading = makeText('SETTINGS', FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.heading.anchor.set(0, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.eyebrow.anchor.set(1, 0.5);
    this.backLabel = makeText('DONE', FONT_HEADING, DONE_PX, BONE.hi);
    this.backLabel.anchor.set(0.5, 0.5);
    this.addChild(this.backdrop, this.beams, this.heading, this.eyebrow, this.backBody, this.backLabel, this.hint);
  }

  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.viewport = { width, height };
    this.layout = settingsLayout({ width, height }, opts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }


  /**
   * Tell this screen that **something else already paints the whole viewport
   * behind it** — the real {@link ../art/backdrop} `VoidBackdrop`, put there by
   * the menu shell (a0-79, `./menu-backdrop`).
   *
   * A screen paints its own ground by default, and that default is the safe one:
   * a view shown with nothing behind it still owns its screen. This is how the
   * shell says otherwise, and it is a *statement about the scene graph* rather
   * than a style knob — which is why it is a method the shell calls once and not
   * a colour or an alpha somebody can tune.
   *
   * Invalidates the screen cache, because the cached texture is a rasterisation
   * of the old answer ({@link ./screen-cache}).
   */
  setVoidBehind(on: boolean): void {
    if (on === this.voidBehind) return;
    this.voidBehind = on;
    this.cache.invalidate();
  }

  hitTest(x: number, y: number): SettingsTarget | null {
    return settingsHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: SETTINGS_ID, anchor: SETTINGS_ANCHOR, bounds: { ...this.layout.content } }];
  }

  update(model: SettingsModel): void {
    if (!this.visible) return;
    // This screen's `update` is called per FRAME in-match (`syncPause()` draws
    // the pause overlay every rendered frame), not only on a state change. An
    // unchanged frame must therefore cost a string compare rather than ~170
    // polygons and a render-to-texture — see ./screen-cache.
    const signature = JSON.stringify(model);
    if (this.cache.unchanged(signature)) return;
    // A panel opening or closing changes what the container's bounds enclose, and
    // `updateCacheTexture` re-renders into the texture it already has. Opening
    // and closing are player events (twice per question asked, not per frame), so
    // the safe answer is the cheap one: drop the texture and let the refresh at
    // the end of this pass measure the screen again.
    const openIndex = model.openHelp?.index ?? null;
    if (openIndex !== this.cachedHelp) {
      this.cache.invalidate();
      this.cachedHelp = openIndex;
    }
    const { header, footer, title, rows, back, metrics } = this.layout;

    // Near-opaque over the whole viewport: **this screen has two homes**, and
    // this is the one that matters. Opened from the PAUSE overlay it sits over a
    // live match, and the rows must read against the fight rather than through
    // it — so the scrim stays wherever the shell has not said otherwise. Opened
    // from the MAIN MENU there is no fight, the real void is behind it instead
    // (a0-79), and a 0.96 scrim over the void is a scrim over the thing it was
    // put there to hide. See `setVoidBehind`.
    this.backdrop.clear();
    if (!this.voidBehind) {
      this.backdrop
        .rect(0, 0, header.x * 2 + header.width, footer.y + footer.height + header.y)
        .fill({ color: PALETTE.vacuum, alpha: 0.96 });
    }

    this.beams.clear();
    // The beams paint the height the FRAME reserved, not a flat 92 (u7-04) — see
    // `../art/materials` drawBeam for what the mismatch did on a phone.
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, title, metrics);

    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i];
      const row = model.rows[i];
      if (!rect || !row) continue;
      this.drawRow(this.rowSlot(i), row, rect, metrics, i);
    }

    this.drawBack(model, back, metrics);
    this.drawHint(model);
    // Everything above is now on the display list; rasterise it once so the
    // frames between state changes cost one blit rather than ~170 translucent
    // polygons (./screen-cache).
    this.cache.refresh(signature);
  }

  /** The header beam: the heading hard left, the standing instruction hard right. */
  private drawHeader(model: SettingsModel, title: Rect, m: FrameMetrics): void {
    const visible = title.height > 0;
    this.heading.visible = visible;
    this.eyebrow.visible = visible;
    if (!visible) return;

    const headingPx = typeSize(HEADING_PX, m);
    this.heading.text = model.title;
    this.heading.style.fontSize = headingPx;
    this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, headingPx);
    this.heading.x = title.x;
    this.heading.y = title.y + title.height / 2;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.eyebrow.x = title.x + title.width;
    this.eyebrow.y = title.y + title.height / 2;
    // On a narrow beam the instruction gives way to the heading — the heading
    // names the screen and the instruction only describes it.
    this.eyebrow.visible = this.heading.width + this.eyebrow.width + m.gutter <= title.width;
  }

  private drawRow(nodes: RowNodes, row: SettingsRowView, rect: Rect, m: FrameMetrics, index: number): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.label.visible = false;
      nodes.value.visible = false;
      nodes.minus.visible = false;
      nodes.plus.visible = false;
      nodes.help.visible = false;
      return;
    }
    nodes.label.visible = true;

    // A row is a SURFACE, not a raised plate: `inert` gives it a 1px rule, the
    // faintest sheen, square corners and no cast shadow — held down on the panel
    // rather than standing off it, which is the handoff's own read.
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'inert', 'compact', row.state);

    const padX = Math.max(8, Math.round(ROW.padX * m.plateScale));
    // The `?` leads the row, so the label starts after it (a0-77). One pad, the
    // row's own — the same gap the label used to keep from the plate's edge.
    const help = this.drawHelpControl(nodes, row, index, m);
    const labelPx = plateTypeSize(ROW_LABEL_PX, m);
    nodes.label.text = row.label;
    nodes.label.style.fontSize = labelPx;
    nodes.label.style.letterSpacing = trackingPx(TRACKING.name, labelPx);
    nodes.label.x = (help > 0 ? help : rect.x) + padX;
    nodes.label.y = rect.y + rect.height / 2;

    if (row.kind === 'volume') {
      nodes.value.visible = false;
      this.drawVolume(nodes, row, rect, m);
    } else {
      nodes.minus.visible = false;
      nodes.plus.visible = false;
      this.drawToggle(nodes, row, rect, m);
    }
  }

  /**
   * A toggle's value as a chip. Bone spends no hue, so "engaged" is carried by
   * the chip's hairline and its label brightness, not by a colour: an engaged
   * chip wears the `inert` chip's brightest rule (`ruleLit`, the same hairline
   * the handoff draws round MANUAL) and a chalk label; an off one is the plain
   * `secondary` chip with a dimmer label. Same material, one step apart — which
   * is exactly how the rest of the direction distinguishes states.
   */
  private drawToggle(nodes: RowNodes, row: SettingsRowView, rect: Rect, m: FrameMetrics): void {
    const chipH = Math.min(valueChipHeight(m), Math.max(0, rect.height - 8));
    const valuePx = plateTypeSize(VALUE_PX, m);

    nodes.value.visible = true;
    nodes.value.text = row.value;
    nodes.value.style.fontSize = valuePx;
    nodes.value.style.letterSpacing = trackingPx(TRACKING.label, valuePx);
    nodes.value.style.fill = row.on ? BONE.hi : MATERIAL_SHADES.bone;

    const padX = Math.max(8, Math.round(VALUE_CHIP.padX * m.plateScale));
    const rowPad = Math.max(8, Math.round(ROW.padX * m.plateScale));
    const floor = Math.min(Math.round(VALUE_CHIP.minWidth * m.plateScale), rect.width * 0.4);
    const ceiling = Math.max(floor, rect.width * 0.62);
    const chipW = Math.min(ceiling, Math.max(floor, nodes.value.width + padX * 2));
    const cx = rect.x + rect.width - chipW - rowPad;
    const cy = rect.y + (rect.height - chipH) / 2;

    // The chip rides the row's own press sink, so the two move as one piece.
    drawPlate(nodes.body, cx, cy, chipW, chipH, row.on ? 'inert' : 'secondary', 'chip', row.state);

    nodes.value.x = cx + chipW / 2;
    nodes.value.y = cy + chipH / 2;
  }

  /**
   * The row's `?` — the control that explains the setting (a0-77).
   *
   * Drawn as the `secondary` chip the −/+ steppers wear, because it **is** a
   * control and the material has one word for that. It carries no hue: yellow
   * means ore and red means damage (style-guide §2), and a help affordance is
   * neither — the same reading the lobby's own `?` takes (`./lobby-view`
   * `drawHelpControl`), which is the control this one is a second instance of.
   *
   * Three states are on it at once and they are deliberately different marks:
   * the pointer's hover/press ride the plate, an OPEN panel holds the plate down
   * (so the `?` you are reading from reads as held), and the KEYBOARD focus is a
   * ring inside the chip's edge. A focus drawn as a hover would tell a player
   * driving with both hands that the mouse is somewhere it is not.
   *
   * Returns the x its chip ENDS at (0 when there was no room to draw one), which
   * is where the row's label begins.
   */
  private drawHelpControl(nodes: RowNodes, row: SettingsRowView, index: number, m: FrameMetrics): number {
    const rect = this.layout.help[index];
    const visible = !!rect && rect.width > 0 && rect.height > 0;
    nodes.help.visible = visible;
    if (!rect || !visible) return 0;

    // An open panel reads as a held control — `press` outranks whatever the
    // pointer is doing, because the panel is the louder fact about this chip.
    const state: PlateState = row.helpOpen ? 'press' : (row.helpState as PlateState);
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'secondary', 'chip', state);

    if (row.helpFocused) {
      const inset = Math.max(1, Math.round(FOCUS_RING_INSET * m.plateScale));
      const width = Math.max(1, Math.round(FOCUS_RING_WIDTH * m.plateScale));
      nodes.body
        .rect(rect.x + inset, rect.y + inset, rect.width - 2 * inset, rect.height - 2 * inset)
        .stroke({ width, color: BONE.hi, alpha: 1 });
    }

    const px = plateTypeSize(ROW_LABEL_PX, m);
    nodes.help.text = SETTINGS_HELP_GLYPH;
    nodes.help.style.fontSize = px;
    nodes.help.style.fill = MATERIAL_SHADES.bone;
    nodes.help.x = rect.x + rect.width / 2;
    nodes.help.y = rect.y + rect.height / 2 + (state === 'press' ? 1 : 0);
    return rect.x + rect.width;
  }

  /**
   * The open explanation, floated over the row it belongs to — or nothing.
   *
   * Anchored at the TOP CENTRE of the `?` that opened it and clamped inside the
   * whole logical viewport by the panel itself (`./codex-hint-view` `show`), so
   * it sits above the control on a desktop and folds below it on a row near the
   * top of a short phone screen. The viewport, not the content box: a panel is
   * allowed the margins the rows are not.
   */
  private drawHint(model: SettingsModel): void {
    const open = model.openHelp;
    const rect = open ? this.layout.help[open.index] : undefined;
    if (!open || !rect || rect.width <= 0) {
      this.hint.hide();
      return;
    }
    const row = this.layout.rows[open.index] ?? rect;
    const ax = rect.x + rect.width / 2;
    this.hint.show(open.hint, ax, rect.y, this.viewport.width, this.viewport.height);
    // The panel prefers to sit ABOVE the `?`; on a short screen it folds below it
    // instead, and below the `?` is ON TOP OF the row the `?` explains — which on
    // a settings row means covering the very value the player asked about. So when
    // it folds, it is re-anchored to the row's BOTTOM edge, which clears the row
    // whole. Same public call, twice, and only in the folding case: the panel's
    // placement is a pure function of its anchor, so asking it twice costs one
    // layout and no state.
    if (this.hint.y > rect.y) {
      this.hint.show(open.hint, ax, row.y + row.height, this.viewport.width, this.viewport.height);
    }
  }

  /** A volume as filled/empty pips between a − and a + chip. */
  private drawVolume(nodes: RowNodes, row: SettingsRowView, rect: Rect, m: FrameMetrics): void {
    const { minus, plus, bar } = volumeButtons(rect, this.layout.stepper);
    const level = row.level ?? 0;
    const max = row.max ?? VOLUME_STEPS;
    const glyphPx = plateTypeSize(STEPPER_PX, m);

    for (const [box, glyph, node, state] of [
      [minus, '−', nodes.minus, row.minusState ?? 'rest'],
      [plus, '+', nodes.plus, row.plusState ?? 'rest'],
    ] as const) {
      if (box.width <= 0 || box.height <= 0) {
        node.visible = false;
        continue;
      }
      drawPlate(nodes.body, box.x, box.y, box.width, box.height, 'secondary', 'chip', state as PlateState);
      node.visible = true;
      node.text = glyph;
      node.style.fontSize = glyphPx;
      node.x = box.x + box.width / 2;
      node.y = box.y + box.height / 2 + (state === 'press' ? 1 : 0);
    }

    // The pips start after the label's column and run to the steppers. Three
    // bounds, in strict precedence:
    //
    //   1. the MEASURED label is a hard floor — a face that sets wider than
    //      expected still cannot be written over (u7-01's first phone golden);
    //   2. the handoff's fixed column is a preference, taken from where the label
    //      STARTS (which the `?` moved, a0-77) rather than from the row's edge,
    //      so it means the same thing it always did;
    //   3. …and that preference is given up once it would leave the readout under
    //      {@link PIPS_MIN_WIDTH}, which is the width a phone row now has to
    //      spend after a thumb-sized `?` and two thumb-sized steppers.
    const column = nodes.label.x + Math.round(VOLUME_LABEL_COLUMN * m.plateScale);
    const afterLabel = nodes.label.x + nodes.label.width + Math.max(8, Math.round(ROW.padX * m.plateScale));
    const barRight = bar.x + bar.width;
    const roomiest = Math.max(bar.x, barRight - Math.round(PIPS_MIN_WIDTH * m.plateScale));
    const pipsX = Math.min(Math.max(Math.min(column, roomiest), afterLabel), barRight);
    const pipsW = Math.max(0, bar.x + bar.width - pipsX - PIP_GAP);
    if (pipsW <= 0 || max <= 0) return;
    const gap = Math.max(2, Math.round(PIP_GAP * m.plateScale));
    const pipW = Math.max(0, (pipsW - (max - 1) * gap) / max);
    const pipH = Math.min(Math.round(PIP_HEIGHT * m.plateScale), Math.max(0, rect.height - 20));
    const pipY = rect.y + (rect.height - pipH) / 2;
    for (let i = 0; i < max; i++) {
      const filled = i < level;
      // Bone, not plasma: a filled pip is chalk-bright metal and an empty one is
      // the shaded end of the same ramp. No hue is spent on a level readout.
      nodes.body
        .rect(pipsX + i * (pipW + gap), pipY, pipW, pipH)
        .fill({ color: filled ? MATERIAL_SHADES.bone : MATERIAL_SHADES.chipFaceLit, alpha: 1 });
    }
  }

  /** DONE — the screen's one bright plate, right-aligned in the footer beam. */
  private drawBack(model: SettingsModel, rect: Rect, m: FrameMetrics): void {
    this.backBody.clear();
    const visible = rect.width > 0 && rect.height > 0;
    this.backLabel.visible = visible;
    if (!visible) return;

    drawPlate(this.backBody, rect.x, rect.y, rect.width, rect.height, model.backRole, 'compact', model.backState);
    const px = plateTypeSize(DONE_PX, m);
    this.backLabel.text = model.backLabel;
    this.backLabel.style.fontSize = px;
    this.backLabel.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    this.backLabel.x = rect.x + rect.width / 2;
    this.backLabel.y = rect.y + rect.height / 2 + (model.backState === 'press' ? 2 : 0);
  }

  private rowSlot(index: number): RowNodes {
    const existing = this.rowNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_BODY, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    label.anchor.set(0, 0.5);
    const value = makeText('', FONT_BODY, VALUE_PX, BONE.hi);
    value.anchor.set(0.5, 0.5);
    const minus = makeText('', FONT_BODY, STEPPER_PX, MATERIAL_SHADES.bone);
    minus.anchor.set(0.5, 0.5);
    const plus = makeText('', FONT_BODY, STEPPER_PX, MATERIAL_SHADES.bone);
    plus.anchor.set(0.5, 0.5);
    const help = makeText('', FONT_BODY, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    help.anchor.set(0.5, 0.5);
    this.addChild(body, label, value, minus, plus, help);
    // A row's nodes are added lazily, on the frame the row is first drawn — so
    // the panel, which must float OVER the rows, is pushed back to the top of the
    // display list each time a slot is built.
    this.setChildIndex(this.hint, this.children.length - 1);
    const nodes: RowNodes = { body, label, value, minus, plus, help };
    this.rowNodes[index] = nodes;
    return nodes;
  }
}

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
