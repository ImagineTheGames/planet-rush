/**
 * src/ui/lobby-view.ts — the Pixi view for the lobby. OWNER: UI Engineer.
 *
 * The drawing half of GDD §2.1 / §2.11. Every decision lives in the pure,
 * unit-tested model ({@link ./lobby}) and every rect in the pure, unit-tested
 * layout ({@link ./lobby-geometry}); this file only turns them into Graphics and
 * Text, and holds the one thing neither of them has an opinion about — which
 * Pixi child is which.
 *
 * Four rules from the frozen contract are enforced *here*, in the drawing code,
 * because this is where they could be broken:
 *
 *  1. **Hulls stay steel** (style-guide §3 rule 1). A seat row's chrome is
 *     hull-steel and Vacuum; the player's identity colour appears only on the
 *     colour chip, the decal and the row's edge stripe — the UI equivalents of
 *     "wing tips, cockpit, beam tint, beacon ring, HP bar."
 *  2. **Identity never depends on colour alone** (§3 rule 3). Every row draws
 *     its `P1`…`P8` decal *and* names its colour in words, so the roster reads
 *     with the hue removed.
 *  3. **Signal yellow is RESERVED** (§2). There is no ore and no hazard on this
 *     screen, so there is no yellow on it either — not on the selected hull tile,
 *     not on RUSH!, not on the room code. Selection reads as plasma.
 *  4. **No ship stats** (GDD §2.2, §2.5). A hull tile draws a name, a hull and a
 *     blurb; the model gives it nothing else it *could* draw.
 *
 * Typography follows style-guide §7: Audiowide for headings and the wordmark,
 * Oxanium for numerals and body — never the other way round.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { DIFFICULTY_LABELS, RUSH_LABEL } from './lobby';
import type { LobbyModel, LobbySeatView, ShipClassOption } from './lobby';
import { lobbyHitTest, lobbyLayout } from './lobby-geometry';
import type { Insets, LobbyLayout, LobbyTarget } from './lobby-geometry';

// ---------------------------------------------------------------------------
// Typography & neutrals (style-guide §7 — shared with the HUD and the wheel)
// ---------------------------------------------------------------------------

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "DejaVu Sans Mono", monospace';

/** Neutral light UI text. Chalk-white — never signal yellow (style-guide §2). */
const TEXT_PRIMARY = 0xdce3ec;
const TEXT_DIM = PALETTE.hullSteel;

/** The lobby's layout-registry id and declared anchor: it owns the screen. */
export const LOBBY_ID = 'lobby';
export const LOBBY_ANCHOR: AnchorSpec = { region: 'full' };

// ---------------------------------------------------------------------------
// Per-row children
// ---------------------------------------------------------------------------

interface SeatNodes {
  readonly body: Graphics;
  /** The identity chip: the colour, with the decal written on it (§3 rule 3). */
  readonly chip: Graphics;
  readonly decal: Text;
  readonly name: Text;
  /** Hull and colour name — the words that carry identity without the hue. */
  readonly detail: Text;
  /** EASY / MEDIUM / HARD on a bot row; the tap target the host cycles. */
  readonly difficulty: Text;
  /** "OPEN" while a bot seat is still claimable by room code. */
  readonly open: Text;
}

interface ClassNodes {
  readonly body: Graphics;
  readonly name: Text;
  readonly hull: Text;
  readonly blurb: Text;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * The lobby screen. Add once, call {@link resize} on every viewport change and
 * {@link update} each frame with a {@link LobbyModel}. The container hides
 * itself entirely once the match has started, so the lobby costs one boolean
 * per frame for the rest of the match.
 */
export class LobbyView extends Container {
  private readonly backdrop = new Graphics();
  private readonly wordmark: Text;
  private readonly roomLabel: Text;
  private readonly roomCode: Text;
  private readonly seatNodes: SeatNodes[] = [];
  private readonly classNodes: ClassNodes[] = [];
  private readonly rushBody = new Graphics();
  private readonly rushText: Text;
  private readonly rushHint: Text;

  private layout: LobbyLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = lobbyLayout({ width: screenWidth, height: screenHeight }, touchOpts(isTouch, insets));

    this.wordmark = makeText('PLANET RUSH', FONT_HEADING, 22, TEXT_PRIMARY);
    // The room code is the thing that gets read across a classroom, so it is the
    // largest text on the screen after the wordmark — and it is set in the body
    // face, because it is a code to be read character by character (§7).
    this.roomLabel = makeText('ROOM', FONT_HEADING, 10, TEXT_DIM);
    this.roomLabel.anchor.set(1, 0);
    this.roomCode = makeText('', FONT_BODY, 26, PALETTE.plasma, 'bold');
    this.roomCode.anchor.set(1, 0);

    this.rushText = makeText(RUSH_LABEL, FONT_HEADING, 22, TEXT_PRIMARY);
    this.rushText.anchor.set(0.5, 0.5);
    this.rushHint = makeText('', FONT_BODY, 11, TEXT_DIM);
    this.rushHint.anchor.set(0.5, 0);

    this.addChild(this.backdrop, this.wordmark, this.roomLabel, this.roomCode);
    this.addChild(this.rushBody, this.rushText, this.rushHint);
    this.visible = false;
  }

  /** Re-lay-out for a new viewport, device or safe area. Cheap: the layout is
   *  a handful of rects, and nothing is re-created. */
  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = lobbyLayout({ width, height }, touchOpts(isTouch, insets));
  }

  /** The rects this frame was drawn at — so a tap is tested against the same
   *  geometry that was drawn, never a second copy (GDD §2.4: menus are taps). */
  hitTest(x: number, y: number): LobbyTarget | null {
    return lobbyHitTest(this.layout, x, y);
  }

  /** The layout-registry seam (`LayoutContributor`): the lobby owns the screen,
   *  so it declares `full` and reports the content box it actually drew in. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: LOBBY_ID, anchor: LOBBY_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /** Draw one frame. A `started` lobby draws nothing: the match owns the screen. */
  update(model: LobbyModel): void {
    this.visible = model.phase !== 'started';
    if (!this.visible) return;

    const { content } = this.layout;
    this.backdrop.clear();
    this.backdrop
      .rect(content.x - 8, content.y - 8, content.width + 16, content.height + 16)
      .fill({ color: PALETTE.vacuum, alpha: 0.92 });

    this.drawTitle(model);
    for (let i = 0; i < this.layout.seats.length; i++) {
      const seat = model.seats[i];
      const rect = this.layout.seats[i];
      if (!seat || !rect) continue;
      this.drawSeat(this.seatSlot(i), seat, rect, model.phase);
    }
    for (let i = 0; i < this.layout.classOptions.length; i++) {
      const option = model.classOptions[i];
      const rect = this.layout.classOptions[i];
      if (!option || !rect) continue;
      this.drawClassTile(this.classSlot(i), option, rect, model);
    }
    this.drawRush(model);
  }

  // --- Title ---------------------------------------------------------------

  private drawTitle(model: LobbyModel): void {
    const { title, roomCode } = this.layout;
    this.wordmark.x = title.x;
    this.wordmark.y = title.y + (title.height - this.wordmark.height) / 2;

    const right = roomCode.x + roomCode.width;
    this.roomLabel.x = right;
    this.roomLabel.y = roomCode.y + 2;
    this.roomCode.text = model.room;
    this.roomCode.x = right;
    this.roomCode.y = roomCode.y + 14;
  }

  // --- Seat rows -----------------------------------------------------------

  /**
   * One roster row.
   *
   * The row's chrome is steel; the only identity colour on it is the chip, the
   * decal and a stripe down its leading edge (style-guide §3 rule 2 — colour
   * lives on trim, never on the body). Your own row is marked by a plasma
   * outline rather than by a brighter identity colour, so "which one is me" and
   * "which colour am I" stay two separate reads.
   */
  private drawSeat(nodes: SeatNodes, seat: LobbySeatView, rect: Rect, phase: LobbyModel['phase']): void {
    const pad = 8;
    const stripe = 4;

    nodes.body.clear();
    nodes.body
      .rect(rect.x, rect.y, rect.width, rect.height)
      .fill({ color: PALETTE.hullSteel, alpha: seat.isBot ? 0.07 : 0.13 })
      // The identity stripe: trim, not body (style-guide §3 rule 2).
      .rect(rect.x, rect.y, stripe, rect.height)
      .fill({ color: seat.color, alpha: 0.9 });
    if (seat.isYou) {
      nodes.body
        .rect(rect.x, rect.y, rect.width, rect.height)
        .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.8 });
    }

    // The identity chip and its decal. The decal is the source of truth and the
    // colour is the fast read, so they are drawn as one object (§3 rule 3).
    const chipSize = Math.min(26, rect.height - 2 * pad);
    const chipX = rect.x + stripe + pad;
    const chipY = rect.y + (rect.height - chipSize) / 2;
    nodes.chip.clear();
    nodes.chip
      .roundRect(chipX, chipY, chipSize, chipSize, 4)
      .fill({ color: seat.color, alpha: 0.22 })
      .roundRect(chipX, chipY, chipSize, chipSize, 4)
      .stroke({ width: 1, color: seat.color, alpha: 0.9 });
    nodes.decal.text = seat.decal;
    nodes.decal.style.fill = seat.color;
    nodes.decal.x = chipX + chipSize / 2;
    nodes.decal.y = chipY + chipSize / 2;

    const textX = chipX + chipSize + pad;
    nodes.name.text = seat.isHost ? `${seat.name}  ★` : seat.name;
    nodes.name.style.fill = seat.isBot ? TEXT_DIM : TEXT_PRIMARY;
    nodes.name.x = textX;
    nodes.name.y = rect.y + rect.height / 2 - (rect.height > 46 ? 15 : 8);

    // Colour named in words, beside the hull. This is the line that makes the
    // roster readable with the hue removed (style-guide §3 rule 3, §9).
    nodes.detail.text = `${seat.className} · ${seat.colorName}`;
    nodes.detail.x = textX;
    nodes.detail.y = nodes.name.y + 14;
    nodes.detail.visible = rect.height > 30;

    const rightX = rect.x + rect.width - pad;
    nodes.difficulty.visible = seat.isBot;
    if (seat.isBot && seat.botDifficulty) {
      nodes.difficulty.text = DIFFICULTY_LABELS[seat.botDifficulty];
      nodes.difficulty.x = rightX;
      nodes.difficulty.y = rect.y + rect.height / 2 - (rect.height > 46 ? 15 : 8);
    }

    // A bot seat before RUSH is a seat somebody can still take by room code.
    nodes.open.visible = seat.openToJoin && phase === 'gathering' && rect.height > 30;
    if (nodes.open.visible) {
      nodes.open.x = rightX;
      nodes.open.y = nodes.difficulty.y + 14;
    }
  }

  private seatSlot(index: number): SeatNodes {
    const existing = this.seatNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const chip = new Graphics();
    const decal = makeText('', FONT_BODY, 11, TEXT_PRIMARY, 'bold');
    decal.anchor.set(0.5, 0.5);
    const name = makeText('', FONT_HEADING, 13, TEXT_PRIMARY);
    const detail = makeText('', FONT_BODY, 11, TEXT_DIM);
    const difficulty = makeText('', FONT_HEADING, 11, PALETTE.plasma);
    difficulty.anchor.set(1, 0);
    const open = makeText('OPEN', FONT_BODY, 10, TEXT_DIM);
    open.anchor.set(1, 0);

    this.addChild(body, chip, decal, name, detail, difficulty, open);
    const nodes: SeatNodes = { body, chip, decal, name, detail, difficulty, open };
    this.seatNodes[index] = nodes;
    return nodes;
  }

  // --- Hull tiles ----------------------------------------------------------

  /**
   * One hull tile: a name, a hull, and a role blurb. **Words only** — the model
   * carries no stat for this to print, which is how GDD §2.5's "ship stats live
   * in the upgrade panel" is kept true by construction rather than by care.
   *
   * Selection is **plasma**, never signal yellow: there is no ore and no hazard
   * on this screen, so there is no yellow on it (style-guide §2).
   */
  private drawClassTile(
    nodes: ClassNodes,
    option: ShipClassOption,
    rect: Rect,
    model: LobbyModel,
  ): void {
    const selected = option.shipClass === model.shipClass;
    const dim = model.classLocked && !selected;

    nodes.body.clear();
    nodes.body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: PALETTE.hullSteel, alpha: selected ? 0.18 : 0.08 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({
        width: selected ? 2 : 1,
        color: selected ? PALETTE.plasma : PALETTE.hullSteel,
        alpha: dim ? 0.3 : selected ? 0.9 : 0.45,
      });

    const pad = 8;
    const alpha = dim ? 0.45 : 1;
    nodes.name.text = option.name;
    nodes.name.style.fill = selected ? TEXT_PRIMARY : TEXT_DIM;
    nodes.name.alpha = alpha;
    nodes.name.x = rect.x + pad;
    nodes.name.y = rect.y + pad;

    nodes.hull.text = option.hull;
    nodes.hull.alpha = alpha;
    nodes.hull.x = rect.x + pad;
    nodes.hull.y = nodes.name.y + 16;

    // The role blurb (GDD §2.11). Hidden on a tile too short to hold it rather
    // than clipped — a half-sentence reads worse than none.
    nodes.blurb.text = option.blurb;
    nodes.blurb.alpha = alpha;
    nodes.blurb.style.wordWrapWidth = Math.max(20, rect.width - 2 * pad);
    nodes.blurb.x = rect.x + pad;
    nodes.blurb.y = nodes.hull.y + 16;
    nodes.blurb.visible = rect.height >= 64;
  }

  private classSlot(index: number): ClassNodes {
    const existing = this.classNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const name = makeText('', FONT_HEADING, 12, TEXT_PRIMARY);
    const hull = makeText('', FONT_BODY, 11, PALETTE.patina);
    const blurb = makeText('', FONT_BODY, 10, TEXT_DIM);
    blurb.style.wordWrap = true;

    this.addChild(body, name, hull, blurb);
    const nodes: ClassNodes = { body, name, hull, blurb };
    this.classNodes[index] = nodes;
    return nodes;
  }

  // --- RUSH! ---------------------------------------------------------------

  /**
   * The button that starts the match, and then the countdown it becomes
   * (GDD §2.1). One control, two states: the host presses `RUSH!`, and the same
   * box counts `5`…`1` and says `RUSH!` again at zero — so every player watches
   * the same thing the host pressed.
   */
  private drawRush(model: LobbyModel): void {
    const rect = this.layout.rushButton;
    const counting = model.countdown.active;
    const live = model.canStart || counting;

    this.rushBody.clear();
    this.rushBody
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: PALETTE.plasma, alpha: live ? 0.18 : 0.06 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: live ? 2 : 1, color: PALETTE.plasma, alpha: live ? 0.9 : 0.3 });

    this.rushText.text = model.countdown.label;
    this.rushText.style.fill = live ? TEXT_PRIMARY : TEXT_DIM;
    this.rushText.x = rect.x + rect.width / 2;
    this.rushText.y = rect.y + rect.height / 2;

    // A guest is told who they are waiting for rather than shown a dead button.
    this.rushHint.text = counting
      ? ''
      : model.hostControls
        ? `${model.humanCount} PLAYING · ${model.botCount} BOTS`
        : 'WAITING FOR THE HOST';
    this.rushHint.visible = this.rushHint.text !== '';
    this.rushHint.x = rect.x + rect.width / 2;
    this.rushHint.y = rect.y + rect.height + 2;
    // Only drawn when it fits inside the content box; the layout hands the
    // button the bottom edge, so on a very short screen there is no room below.
    const bottom = this.layout.content.y + this.layout.content.height;
    if (this.rushHint.y + 12 > bottom) this.rushHint.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function touchOpts(isTouch: boolean, insets?: Insets): { isTouch: boolean; insets?: Insets } {
  return insets ? { isTouch, insets } : { isTouch };
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
