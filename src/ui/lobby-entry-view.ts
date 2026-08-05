/**
 * src/ui/lobby-entry-view.ts — the Pixi view for the entry screen.
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./lobby-entry}. Every decision lives in the pure
 * model and every rect in {@link ./lobby-geometry} `entryLayout`; this file only
 * turns them into Graphics and Text, and owns the one thing neither has an
 * opinion about — which Pixi child is which.
 *
 * The rules from the frozen contract that could only be broken *here*:
 *
 *  1. **Signal yellow is RESERVED for ore** (style-guide §2). There is no ore on
 *     this screen, so there is no yellow on it. Emphasis is plasma.
 *  2. **Threat red is RESERVED for damage and danger** (§2) — and a failed join
 *     is the one thing on this screen that is genuinely wrong, so the error line
 *     is the single red element and nothing else competes with it.
 *  3. **Typography** (§7): Audiowide for the wordmark and the buttons, Oxanium
 *     for the code and the keys — the code is a string of characters to be read
 *     one at a time, which is exactly what the body face is for.
 *  4. **Every control is a plain tap** (GDD §2.4). Nothing here is a drag, a
 *     long-press or a gesture, and the disabled states are drawn rather than
 *     merely inert, so a dead button never looks pressable.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { buttonStyle } from './button-theme';
import type { EntryCodeCell, EntryDoorView, EntryModel } from './lobby-entry';
import { entryHitTest, entryLayout } from './lobby-geometry';
import type { EntryLayout, EntryTarget, Insets } from './lobby-geometry';

// ---------------------------------------------------------------------------
// Typography & neutrals — shared with ./lobby-view (style-guide §7)
// ---------------------------------------------------------------------------

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "DejaVu Sans Mono", monospace';

const TEXT_PRIMARY = 0xdce3ec;
const TEXT_DIM = PALETTE.hullSteel;

/** The standing line under the wordmark: a tagline, a prompt, an error. */
const MESSAGE_SIZE = 12;
/** The same slot carrying a live connect narration — the connecting screen's real
 *  title now, so it is read at a glance from across a classroom rather than
 *  squinted at. Kept in the body face: it spells out machine ids and room codes,
 *  which is exactly what a body face is for, and it fits a phone's width where
 *  Audiowide at this size would not. */
const NARRATION_SIZE = 17;

/** The entry screen's layout-registry id and anchor: it owns the screen. */
export const ENTRY_ID = 'lobby-entry';
export const ENTRY_ANCHOR: AnchorSpec = { region: 'full' };

interface DoorNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly hint: Text;
}

interface CellNodes {
  readonly body: Graphics;
  readonly char: Text;
}

interface KeyNodes {
  readonly body: Graphics;
  readonly label: Text;
}

interface ButtonNodes {
  readonly body: Graphics;
  readonly label: Text;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The entry screen. Add once, call {@link resize} on every viewport change and
 * {@link update} each frame with an {@link EntryModel}; hide it (or remove it)
 * once a transport is up and {@link ./lobby-view} takes the screen.
 *
 * The two screens share one container and one layout: the children of the screen
 * that is not showing are simply invisible, which costs a handful of booleans and
 * means a tap can never land on a control the player cannot see (the hit test
 * takes the same `screen` the draw did).
 */
export class LobbyEntryView extends Container {
  private readonly backdrop = new Graphics();
  private readonly wordmark: Text;
  private readonly message: Text;
  private readonly doorNodes: DoorNodes[] = [];
  private readonly cellNodes: CellNodes[] = [];
  private readonly keyNodes: KeyNodes[] = [];
  private readonly back: ButtonNodes;
  private readonly erase: ButtonNodes;
  private readonly submit: ButtonNodes;
  /** The home screen's own bottom control — the fourth main-menu option. */
  private readonly settings: ButtonNodes;

  private layout: EntryLayout;
  private screen: EntryModel['screen'] = 'home';

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = entryLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));

    this.wordmark = makeText('PLANET RUSH', FONT_HEADING, 26, TEXT_PRIMARY);
    this.wordmark.anchor.set(0.5, 0.5);
    this.message = makeText('', FONT_BODY, MESSAGE_SIZE, TEXT_DIM);
    this.message.anchor.set(0.5, 0);
    // A safety net, not a layout: every line this slot carries fits one row on the
    // narrowest supported phone. It exists so a refusal token nobody anticipated
    // wraps inside the content box instead of running off both edges.
    this.message.style.wordWrap = true;
    this.message.style.align = 'center';

    this.addChild(this.backdrop, this.wordmark, this.message);

    // Built in the order they are drawn, so the action row sits over the pad
    // rather than under it if a very short screen ever brings them together.
    this.back = this.makeButton('BACK', FONT_HEADING, 13);
    this.erase = this.makeButton('⌫ ERASE', FONT_BODY, 13);
    this.submit = this.makeButton('JOIN', FONT_HEADING, 15);
    this.settings = this.makeButton('SETTINGS', FONT_HEADING, 14);
  }

  /** Re-lay-out for a new viewport, device or safe area. */
  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = entryLayout({ width, height }, opts(isTouch, insets));
  }

  /**
   * The rects this frame was drawn at, tested against the screen it was drawn
   * for — so a tap can never hit a door that the keypad is currently covering.
   */
  hitTest(x: number, y: number): EntryTarget | null {
    return entryHitTest(this.layout, x, y, this.screen);
  }

  /** The layout-registry seam (`LayoutContributor`), same as `./lobby-view`. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: ENTRY_ID, anchor: ENTRY_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /** Draw one frame. */
  update(model: EntryModel): void {
    this.screen = model.screen;
    if (!this.visible) return;

    const { content } = this.layout;
    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.96 });

    this.drawTitle(model);

    const home = model.screen === 'home';
    for (let i = 0; i < this.layout.doors.length; i++) {
      const door = model.doors[i];
      const rect = this.layout.doors[i];
      if (!door || !rect) continue;
      const nodes = this.doorSlot(i);
      setVisible(home, nodes.body, nodes.label, nodes.hint);
      if (home) this.drawDoor(nodes, door, rect);
    }

    for (let i = 0; i < this.layout.cells.length; i++) {
      const cell = model.cells[i];
      const rect = this.layout.cells[i];
      if (!cell || !rect) continue;
      const nodes = this.cellSlot(i);
      setVisible(!home, nodes.body, nodes.char);
      if (!home) this.drawCell(nodes, cell, rect);
    }

    for (let i = 0; i < this.layout.keys.length; i++) {
      const key = model.keys[i];
      const rect = this.layout.keys[i];
      if (key === undefined || !rect) continue;
      const nodes = this.keySlot(i);
      setVisible(!home, nodes.body, nodes.label);
      if (!home) this.drawKey(nodes, key, rect, !model.connecting);
    }

    // BACK is on BOTH screens — the exit every screen must carry (u2 menu-back):
    // on the keypad it steps back to the doors, on the home screen it leaves to
    // the main menu. Steel chrome, never plasma. ERASE / JOIN are join-only.
    setVisible(true, this.back.body, this.back.label);
    this.drawButton(this.back, this.layout.back, !model.connecting, false);

    for (const [nodes, rect, enabled] of [
      [this.erase, this.layout.erase, model.canErase],
      [this.submit, this.layout.submit, model.canSubmit],
    ] as const) {
      setVisible(!home, nodes.body, nodes.label);
      // JOIN is the screen's one affirmative action, so it is the only button
      // that reads as plasma; ERASE is steel chrome.
      if (!home) this.drawButton(nodes, rect, enabled, nodes === this.submit);
    }

    // SETTINGS lives in the same band, but only on the home screen. Steel, never
    // plasma: SOLO CONTRACT is the screen's affirmative action, not this.
    setVisible(home, this.settings.body, this.settings.label);
    if (home) this.drawButton(this.settings, this.layout.settings, !model.connecting, false);
  }

  // --- Title and the one line under it --------------------------------------

  /**
   * The wordmark, and **the title slot under it** — the line that used to read
   * `CONNECTING…` from the first tap to the last, and now reads whatever the
   * connection is actually doing: ALLOCATING ROOM… → ROOM Q5RN · TICKET SIGNED →
   * DIALING MACHINE 0800d5b6… → JOINED · SEAT 2, or the exact refusal
   * (`EntryModel.narrating`, fed from `src/net/connect-trace`).
   *
   * A narration is drawn as a *title*, not as the standing sub-line: bigger, in
   * plasma while there is still hope and threat red once there is not, with the
   * wordmark stepping back behind it — the same deference it already shows the
   * keypad prompt. One text element at the top of the screen, which was the ask.
   */
  private drawTitle(model: EntryModel): void {
    const { title, message } = this.layout;
    this.wordmark.x = title.x + title.width / 2;
    this.wordmark.y = title.y + title.height / 2;
    // The wordmark is the title on the home screen; on the keypad the *prompt* is
    // what the player needs, and while a connect narrates, the narration is — so
    // the wordmark steps back rather than shouting the game's name at somebody who
    // is mid-way through typing a code or watching a socket refuse them.
    this.wordmark.alpha = model.screen === 'home' && !model.narrating ? 1 : 0.45;

    // Threat red is reserved for danger (style-guide §2) — and a join that came
    // back refused is the only genuinely wrong thing this screen can show.
    const failed = model.error !== '';
    this.message.text = failed ? model.error : model.prompt;
    this.message.style.fill = failed
      ? PALETTE.threatRed
      : model.narrating
        ? PALETTE.plasma
        : TEXT_DIM;
    this.message.style.fontSize = model.narrating ? NARRATION_SIZE : MESSAGE_SIZE;
    // A refusal names a token the server chose the length of, so the title wraps
    // inside the content box rather than running off both edges of a phone.
    this.message.style.wordWrapWidth = Math.max(1, message.width);
    this.message.x = message.x + message.width / 2;
    this.message.y = message.y;
    this.message.visible = this.message.text !== '' && message.height > 0;
  }

  // --- Doors ---------------------------------------------------------------

  /**
   * One door: a word, and one line saying what it costs you. The offline door is
   * drawn as the primary action (plasma fill) because it is the one that always
   * works — a player who cannot reach the server should still see a lit button
   * (GDD §4.8 risk 6).
   */
  private drawDoor(nodes: DoorNodes, door: EntryDoorView, rect: Rect): void {
    // The offline door is PRIMARY (it always works — risk 6); the online door is
    // STANDARD, equally active. A door the player can't take yet is DISABLED and
    // its `hint` is the reason (p4-03). One contract, no ad-hoc gray.
    const style = buttonStyle(door.needsNetwork ? 'standard' : 'primary', !door.enabled);
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });

    nodes.label.text = door.label;
    nodes.label.style.fill = style.label;
    nodes.label.alpha = style.labelAlpha;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
    nodes.label.visible = rect.height > 0;

    nodes.hint.text = door.hint;
    nodes.hint.alpha = 0.9;
    nodes.hint.x = rect.x + rect.width / 2;
    nodes.hint.y = rect.y + rect.height + 3;
  }

  private doorSlot(index: number): DoorNodes {
    const existing = this.doorNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, 16, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    const hint = makeText('', FONT_BODY, 11, TEXT_DIM);
    hint.anchor.set(0.5, 0);
    this.addChild(body, label, hint);
    const nodes: DoorNodes = { body, label, hint };
    this.doorNodes[index] = nodes;
    return nodes;
  }

  // --- The code, and the pad it is typed on --------------------------------

  /** One code cell. The caret is a plasma underline rather than a blinking bar:
   *  nothing on this screen animates, so nothing has to be re-drawn per frame. */
  private drawCell(nodes: CellNodes, cell: EntryCodeCell, rect: Rect): void {
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
      .fill({ color: PALETTE.hullSteel, alpha: cell.filled ? 0.16 : 0.07 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
      .stroke({
        width: cell.active ? 2 : 1,
        color: cell.active || cell.filled ? PALETTE.plasma : PALETTE.hullSteel,
        alpha: cell.active ? 0.95 : cell.filled ? 0.6 : 0.4,
      });
    if (cell.active) {
      nodes.body
        .moveTo(rect.x + 6, rect.y + rect.height - 5)
        .lineTo(rect.x + rect.width - 6, rect.y + rect.height - 5)
        .stroke({ width: 2, color: PALETTE.plasma, alpha: 0.95 });
    }

    nodes.char.text = cell.char;
    nodes.char.style.fontSize = Math.max(10, Math.min(38, rect.height * 0.6));
    nodes.char.x = rect.x + rect.width / 2;
    nodes.char.y = rect.y + rect.height / 2;
    nodes.char.visible = cell.filled;
  }

  private cellSlot(index: number): CellNodes {
    const existing = this.cellNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const char = makeText('', FONT_BODY, 32, TEXT_PRIMARY, 'bold');
    char.anchor.set(0.5, 0.5);
    this.addChild(body, char);
    const nodes: CellNodes = { body, char };
    this.cellNodes[index] = nodes;
    return nodes;
  }

  private drawKey(nodes: KeyNodes, key: string, rect: Rect, enabled: boolean): void {
    const alpha = enabled ? 1 : 0.3;
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
      .fill({ color: PALETTE.hullSteel, alpha: 0.1 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 3)
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.45 * alpha });
    nodes.body.alpha = alpha;

    nodes.label.text = key;
    nodes.label.alpha = alpha;
    nodes.label.style.fontSize = Math.max(9, Math.min(18, rect.height * 0.45));
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
  }

  private keySlot(index: number): KeyNodes {
    const existing = this.keyNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_BODY, 14, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: KeyNodes = { body, label };
    this.keyNodes[index] = nodes;
    return nodes;
  }

  // --- BACK / ERASE / JOIN --------------------------------------------------

  private drawButton(nodes: ButtonNodes, rect: Rect, enabled: boolean, primary: boolean): void {
    // JOIN is PRIMARY, BACK/ERASE STANDARD. A disabled JOIN (code not yet full)
    // gets the shared dim look — its reason is the incomplete code above it.
    const style = buttonStyle(primary ? 'primary' : 'standard', !enabled);
    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 5)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 5)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });

    nodes.label.style.fill = style.label;
    nodes.label.alpha = style.labelAlpha;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2;
  }

  private makeButton(text: string, font: string, size: number): ButtonNodes {
    const body = new Graphics();
    const label = makeText(text, font, size, TEXT_PRIMARY);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    return { body, label };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function opts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
}

function setVisible(visible: boolean, ...nodes: Array<Graphics | Text>): void {
  for (const node of nodes) node.visible = visible;
}

function makeText(
  text: string,
  fontFamily: string,
  fontSize: number,
  fill: number,
  fontWeight: TextStyleFontWeight = 'normal',
): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, fontWeight, letterSpacing: 0.5 } });
}
