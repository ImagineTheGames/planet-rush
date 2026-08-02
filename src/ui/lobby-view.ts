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
 *     "wing tips, cockpit, weapon tint, beacon ring, HP bar."
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
import { buttonStyle } from './button-theme';
import { ABUNDANCE_LABELS, DIFFICULTY_LABELS, MODE_LABELS, RUSH_LABEL } from './lobby';
import type { LobbyModel, LobbySeatView, ShipClassOption } from './lobby';
import { BLOCK_GAP, lobbyHitTest, lobbyLayout } from './lobby-geometry';
import type { Insets, LobbyLayout, LobbyTarget } from './lobby-geometry';
import { MapPickerView } from './map-picker-view';
import { mapPickerModel } from './map-picker';
import type { MapPickerLayout } from './map-picker';
// One grade→colour table for both surfaces that show a ping, so the roster row
// and the in-match stamp can never disagree about what "amber" means.
import { PING_GRADE_COLORS } from '../net/ping-badge';

// ---------------------------------------------------------------------------
// Typography & neutrals (style-guide §7 — shared with the HUD and the wheel)
// ---------------------------------------------------------------------------

const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';
const FONT_BODY = 'Oxanium, "DejaVu Sans Mono", monospace';

/** Neutral light UI text. Chalk-white — never signal yellow (style-guide §2). */
const TEXT_PRIMARY = 0xdce3ec;
const TEXT_DIM = PALETTE.hullSteel;

/** Air between a player's name and their ping — `reivi · 245ms`. */
const PING_GAP = 8;

/** How much of a row's right edge the ping keeps clear of the trailing chips.
 *  A name long enough to push the number into them loses the number. */
const PING_RIGHT_GUARD = 120;

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
  /** The trailing DIFFICULTY chip's background — the bot-tier cycle, in BOTH modes
   *  (n2); the tap target the host cycles. */
  readonly rightChip: Graphics;
  /** EASY/MEDIUM/HARD, centred on the difficulty chip. */
  readonly chipLabel: Text;
  /** The TEAM chip's background (TEAMS only) — the side cycle, composed left of the
   *  difficulty chip (n2), so a bot seat carries BOTH controls at once. */
  readonly teamChip: Graphics;
  /** The side letter (A…D), centred on the team chip. */
  readonly teamChipLabel: Text;
  /** The team underline under the name — the TEAMS grouping motif over the eight
   *  identity colours (ratified: keep the colours, add a team indicator). */
  readonly underline: Graphics;
  /** "OPEN" while a bot seat is still claimable by room code. */
  readonly open: Text;
  /** `· 245ms` — this player's round trip, beside their name, colour-graded
   *  (ratified developer). Human rows only; a bot has no ping (`src/net/ping`). */
  readonly ping: Text;
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
  /** BACK — the lobby's exit to the main menu (u2 menu-back), top-left. */
  private readonly backBody = new Graphics();
  private readonly backText: Text;
  private readonly wordmark: Text;
  private readonly roomLabel: Text;
  private readonly roomCode: Text;
  private readonly seatNodes: SeatNodes[] = [];
  private readonly classNodes: ClassNodes[] = [];
  /** The arena row (p2 field rule): the four map cards, drawn by the SHARED map
   *  view, so the registry previews, the VETERAN tag and the plasma selection all
   *  come for free — no ship stats, no yellow, exactly the frozen contract the
   *  standalone picker kept. Fed the lobby's own card rects each frame. */
  private readonly mapPicker = new MapPickerView();
  /** The MODE toggle (FFA / TEAMS) and the ABUNDANCE toggle (SCARCE / STANDARD /
   *  RICH) — the two match-config controls at the top of the roster (Milestone E). */
  private readonly modeBody = new Graphics();
  private readonly modeText: Text;
  private readonly abundanceBody = new Graphics();
  private readonly abundanceText: Text;
  private readonly rushBody = new Graphics();
  private readonly rushText: Text;
  private readonly rushHint: Text;

  private layout: LobbyLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = lobbyLayout({ width: screenWidth, height: screenHeight }, touchOpts(isTouch, insets));

    this.backText = makeText('BACK', FONT_HEADING, 12, TEXT_PRIMARY);
    this.backText.anchor.set(0.5, 0.5);

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

    this.modeText = makeText('', FONT_HEADING, 12, TEXT_PRIMARY);
    this.modeText.anchor.set(0.5, 0.5);
    this.abundanceText = makeText('', FONT_HEADING, 12, TEXT_PRIMARY);
    this.abundanceText.anchor.set(0.5, 0.5);

    this.addChild(this.backdrop, this.backBody, this.backText, this.wordmark, this.roomLabel, this.roomCode);
    this.addChild(this.mapPicker);
    this.addChild(this.modeBody, this.modeText, this.abundanceBody, this.abundanceText);
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
    this.drawControls(model);
    for (let i = 0; i < this.layout.seats.length; i++) {
      const seat = model.seats[i];
      const rect = this.layout.seats[i];
      const chip = this.layout.seatChips[i];
      const teamChip = this.layout.seatTeamChips[i];
      if (!seat || !rect || !chip || !teamChip) continue;
      this.drawSeat(this.seatSlot(i), seat, rect, chip, teamChip, model);
    }
    for (let i = 0; i < this.layout.classOptions.length; i++) {
      const option = model.classOptions[i];
      const rect = this.layout.classOptions[i];
      if (!option || !rect) continue;
      this.drawClassTile(this.classSlot(i), option, rect, model);
    }
    this.drawMaps(model);
    this.drawRush(model);
  }

  /**
   * The arena row. The rects are the lobby's own ({@link LobbyLayout.maps}); the
   * drawing is the shared {@link MapPickerView}'s, fed a {@link MapPickerLayout}
   * built from those rects and the model for the currently-selected arena — so
   * the card previews, names, VETERAN tag and plasma selection are pixel-for-pixel
   * what the standalone picker drew, with none of it duplicated here.
   *
   * The whole row dims for a client that cannot change it — a JOINER in an online
   * room, or any lobby past RUSH! — the same honest tell the MODE and ABUNDANCE
   * pills carry ({@link drawControls}), and the same rule the model enforces
   * (`./lobby` `selectMap` is the host's). A guest still *reads* which arena the
   * room is flying; it just doesn't read as theirs to press.
   */
  private drawMaps(model: LobbyModel): void {
    const mapLayout: MapPickerLayout = {
      band: this.layout.mapBand,
      cards: this.layout.maps,
      columns: this.layout.mapColumns,
      shape: this.layout.mapColumns >= this.layout.maps.length ? 'row' : 'grid',
    };
    this.mapPicker.setLayout(mapLayout);
    this.mapPicker.visible = true;
    this.mapPicker.alpha = model.hostControls && !model.classLocked ? 1 : 0.55;
    this.mapPicker.update(mapPickerModel(model.mapId));
  }

  // --- Title ---------------------------------------------------------------

  private drawTitle(model: LobbyModel): void {
    const { title, leave, roomCode } = this.layout;

    // BACK — the exit every screen carries (u2 menu-back). Steel chrome, drawn in
    // the same visual language as the codex/keypad BACK; the wordmark steps to its
    // right so the two never collide.
    const backVisible = leave.width > 0 && leave.height > 0;
    this.backBody.visible = backVisible;
    this.backText.visible = backVisible;
    this.backBody.clear();
    if (backVisible) {
      const style = buttonStyle('standard', false);
      this.backBody
        .roundRect(leave.x, leave.y + 6, leave.width, leave.height - 12, 5)
        .fill({ color: style.fill, alpha: style.fillAlpha })
        .roundRect(leave.x, leave.y + 6, leave.width, leave.height - 12, 5)
        .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });
      this.backText.text = 'BACK';
      this.backText.style.fill = style.label;
      this.backText.alpha = style.labelAlpha;
      this.backText.x = leave.x + leave.width / 2;
      this.backText.y = leave.y + leave.height / 2;
    }

    this.wordmark.x = title.x + (backVisible ? leave.width + BLOCK_GAP : 0);
    this.wordmark.y = title.y + (title.height - this.wordmark.height) / 2;

    // The room code is the number a classroom reads off one screen and types into
    // another (GDD §4.2) — so it exists only when there is a wire to join over.
    // Offline (solo-vs-bots, M4) there is none, so ROOM and the code are hidden
    // rather than showing a code nobody can act on.
    this.roomLabel.visible = model.online;
    this.roomCode.visible = model.online;
    if (!model.online) return;

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
  private drawSeat(
    nodes: SeatNodes,
    seat: LobbySeatView,
    rect: Rect,
    chipRect: Rect,
    teamChipRect: Rect,
    model: LobbyModel,
  ): void {
    const pad = 8;
    const stripe = 4;
    const phase = model.phase;
    // A closed seat is a shut door: drawn faint, no identity, no chip, no team —
    // it holds no player and takes no field (variable-slots Milestone E).
    const closed = seat.isClosed;
    const bodyAlpha = closed ? 0.04 : seat.isBot ? 0.07 : 0.13;

    nodes.body.clear();
    nodes.body.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: PALETTE.hullSteel, alpha: bodyAlpha });
    if (!closed) {
      // The identity stripe: trim, not body (style-guide §3 rule 2).
      nodes.body.rect(rect.x, rect.y, stripe, rect.height).fill({ color: seat.color, alpha: 0.9 });
    }
    if (seat.isYou) {
      nodes.body
        .rect(rect.x, rect.y, rect.width, rect.height)
        .stroke({ width: 1.5, color: PALETTE.plasma, alpha: 0.8 });
    }

    // The identity chip and its decal. The decal is the source of truth and the
    // colour is the fast read, so they are drawn as one object (§3 rule 3). A
    // closed seat keeps its decal faint (identity is per-slot) but drops the fill.
    const chipSize = Math.min(26, rect.height - 2 * pad);
    const chipX = rect.x + stripe + pad;
    const chipY = rect.y + (rect.height - chipSize) / 2;
    nodes.chip.clear();
    nodes.chip
      .roundRect(chipX, chipY, chipSize, chipSize, 4)
      .fill({ color: seat.color, alpha: closed ? 0.05 : 0.22 })
      .roundRect(chipX, chipY, chipSize, chipSize, 4)
      .stroke({ width: 1, color: seat.color, alpha: closed ? 0.3 : 0.9 });
    nodes.decal.text = seat.decal;
    nodes.decal.style.fill = seat.color;
    nodes.decal.alpha = closed ? 0.4 : 1;
    nodes.decal.x = chipX + chipSize / 2;
    nodes.decal.y = chipY + chipSize / 2;

    const textX = chipX + chipSize + pad;
    nodes.name.text = seat.isHost ? `${seat.name}  ★` : seat.name;
    nodes.name.style.fill = closed ? TEXT_DIM : seat.isBot ? TEXT_DIM : TEXT_PRIMARY;
    nodes.name.alpha = closed ? 0.55 : 1;
    nodes.name.x = textX;
    nodes.name.y = rect.y + rect.height / 2 - (rect.height > 46 ? 15 : 8);

    // The ping, beside the name (ratified developer): `reivi · 245ms`, graded
    // green/amber/red by `src/net/ping`. Drawn on the name's own line because it
    // is a fact about the *person* in the seat, not about the hull under them —
    // and never at all on a bot row, where a number would be a lie the model
    // refuses to produce (`seat.ping === null`).
    //
    // The name is left-anchored, so the ping simply follows its measured width; a
    // long name that would push the number under the trailing chips drops it
    // instead, because a roster that overlaps itself is worse than one without a
    // ping on one row.
    const pingRight = rect.x + rect.width - PING_RIGHT_GUARD;
    const pingX = nodes.name.x + nodes.name.width + PING_GAP;
    nodes.ping.visible = seat.ping !== null && pingX < pingRight;
    if (seat.ping && nodes.ping.visible) {
      nodes.ping.text = `· ${seat.ping.label}`;
      nodes.ping.style.fill = PING_GRADE_COLORS[seat.ping.grade];
      nodes.ping.x = pingX;
      nodes.ping.y = nodes.name.y + 2;
    }

    // Colour named in words, beside the hull. This is the line that makes the
    // roster readable with the hue removed (style-guide §3 rule 3, §9).
    nodes.detail.text = closed ? 'out of the match' : `${seat.className} · ${seat.colorName}`;
    nodes.detail.x = textX;
    nodes.detail.y = nodes.name.y + 14;
    nodes.detail.visible = rect.height > 30;

    // The TEAMS grouping underline under the name (ratified: keep the identity
    // colours, add a team indicator). Neutral accent — the LETTER on the chip is
    // the team's identity, not a hue (team colours would be a style-guide change).
    const teams = model.mode === 'teams';
    nodes.underline.clear();
    if (teams && !closed) {
      nodes.underline
        .rect(textX, nodes.name.y + 12, 22, 2)
        .fill({ color: PALETTE.patina, alpha: 0.85 });
    }

    // The two trailing controls (n2): the DIFFICULTY chip (bot tier, both modes)
    // and — composed to its left in TEAMS — the TEAM chip (side). A bot seat in
    // TEAMS therefore carries both at once; neither replaces the other.
    const tierShown = this.drawDifficultyChip(nodes, seat, chipRect);
    const teamShown = this.drawTeamChip(nodes, seat, teamChipRect, teams, closed);

    // A bot seat before RUSH is a seat somebody can still take by room code —
    // marked just left of the leftmost visible chip so it never fights a label.
    nodes.open.visible = seat.openToJoin && phase === 'gathering' && rect.height > 30 && !closed;
    if (nodes.open.visible) {
      const chipsLeft = teamShown ? teamChipRect.x : tierShown ? chipRect.x : rect.x + rect.width;
      nodes.open.x = chipsLeft - 4;
      nodes.open.y = rect.y + rect.height / 2 + 2;
    }
  }

  /**
   * The trailing DIFFICULTY chip — the bot-tier cycle (EASY/MEDIUM/HARD), drawn on
   * every BOT seat in BOTH modes (n2): the one slot-editor control every mode
   * shares, so a bot's tier is editable in TEAMS exactly as in FFA. A human or
   * closed seat has no tier, so the chip is hidden. Returns whether it was drawn.
   */
  private drawDifficultyChip(nodes: SeatNodes, seat: LobbySeatView, chip: Rect): boolean {
    const visible = seat.isBot && chip.width > 0 && chip.height > 8;
    nodes.rightChip.visible = visible;
    nodes.chipLabel.visible = visible;
    nodes.rightChip.clear();
    if (!visible) return false;

    const accent = PALETTE.patina;
    nodes.rightChip
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .fill({ color: PALETTE.hullSteel, alpha: 0.16 })
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .stroke({ width: 1, color: accent, alpha: 0.85 });
    nodes.chipLabel.text = DIFFICULTY_LABELS[seat.botDifficulty ?? 'medium'];
    nodes.chipLabel.style.fill = accent;
    nodes.chipLabel.x = chip.x + chip.width / 2;
    nodes.chipLabel.y = chip.y + chip.height / 2;
    return true;
  }

  /**
   * The TEAM chip — the seat's side, drawn in TEAMS on every non-closed seat and
   * composed to the LEFT of the difficulty chip (n2), so it adds to the slot editor
   * rather than replacing it. FFA is teams-of-one, so it is hidden there. Returns
   * whether it was drawn.
   *
   * It carries the WORD — `TEAM A`, {@link LobbySeatView.teamName} — not the bare
   * letter it used to. The developer played a teams match and could not tell who
   * was on their side; a lone `A` on a roster chip is a legend nobody was given,
   * and the in-match nameplates now say `TEAM A` in full (`./nameplates`), so the
   * lobby says it the same way and a player learns the vocabulary before RUSH!.
   */
  private drawTeamChip(
    nodes: SeatNodes,
    seat: LobbySeatView,
    chip: Rect,
    teams: boolean,
    closed: boolean,
  ): boolean {
    const visible = teams && !closed && chip.width > 0 && chip.height > 8;
    nodes.teamChip.visible = visible;
    nodes.teamChipLabel.visible = visible;
    nodes.teamChip.clear();
    if (!visible) return false;

    nodes.teamChip
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .fill({ color: PALETTE.hullSteel, alpha: 0.16 })
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .stroke({ width: 1, color: PALETTE.plasma, alpha: 0.85 });
    nodes.teamChipLabel.text = seat.teamName;
    nodes.teamChipLabel.style.fill = TEXT_PRIMARY;
    nodes.teamChipLabel.x = chip.x + chip.width / 2;
    nodes.teamChipLabel.y = chip.y + chip.height / 2;
    return true;
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
    const rightChip = new Graphics();
    const chipLabel = makeText('', FONT_HEADING, 11, PALETTE.patina);
    chipLabel.anchor.set(0.5, 0.5);
    const teamChip = new Graphics();
    const teamChipLabel = makeText('', FONT_HEADING, 11, TEXT_PRIMARY);
    teamChipLabel.anchor.set(0.5, 0.5);
    const underline = new Graphics();
    const open = makeText('OPEN', FONT_BODY, 10, TEXT_DIM);
    open.anchor.set(1, 0.5);
    // Numerals face, like every other number on this screen; the colour is set
    // per-frame from the grade.
    const ping = makeText('', FONT_BODY, 11, PING_GRADE_COLORS.good);

    this.addChild(body, chip, decal, name, detail, underline, rightChip, chipLabel, teamChip, teamChipLabel, open, ping);
    const nodes: SeatNodes = {
      body,
      chip,
      decal,
      name,
      detail,
      rightChip,
      chipLabel,
      teamChip,
      teamChipLabel,
      underline,
      open,
      ping,
    };
    this.seatNodes[index] = nodes;
    return nodes;
  }

  // --- The MODE / ABUNDANCE strip (variable-slots Milestone E) --------------

  /**
   * The two match-config toggles at the top of the roster: MODE (FFA / TEAMS) and
   * ABUNDANCE (SCARCE / STANDARD / RICH). Both are the host's, and both lock with
   * the hull at RUSH! ({@link LobbyModel.classLocked}); a guest or a locked lobby
   * draws them dim, because the value is real but not this client's to change.
   */
  private drawControls(model: LobbyModel): void {
    const enabled = model.hostControls && !model.classLocked;
    this.drawToggle(this.modeBody, this.modeText, this.layout.modeToggle, `MODE · ${MODE_LABELS[model.mode]}`, enabled);
    this.drawToggle(
      this.abundanceBody,
      this.abundanceText,
      this.layout.abundance,
      `ORE · ${ABUNDANCE_LABELS[model.abundance]}`,
      enabled,
    );
  }

  /** One pill toggle: a steel body, a plasma edge when live, and a centred label
   *  (no stat, no yellow — the lobby's palette rules hold here too). */
  private drawToggle(body: Graphics, label: Text, rect: Rect, text: string, enabled: boolean): void {
    const visible = rect.width > 0 && rect.height > 0;
    body.visible = visible;
    label.visible = visible;
    body.clear();
    if (!visible) return;
    body
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: PALETTE.hullSteel, alpha: enabled ? 0.16 : 0.08 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: 1, color: enabled ? PALETTE.plasma : PALETTE.hullSteel, alpha: enabled ? 0.8 : 0.4 });
    label.text = text;
    label.style.fill = enabled ? TEXT_PRIMARY : TEXT_DIM;
    label.alpha = enabled ? 1 : 0.7;
    label.x = rect.x + rect.width / 2;
    label.y = rect.y + rect.height / 2;
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

    // RUSH! is the headline action — PRIMARY. A guest before the host starts is
    // the one disabled case, and it carries its reason below (the hint), so the
    // dim look is honest, not a stray gray (p4-03 / the button contract).
    const style = buttonStyle('primary', !live);
    this.rushBody.clear();
    this.rushBody
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .fill({ color: style.fill, alpha: style.fillAlpha })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 6)
      .stroke({ width: style.strokeWidth, color: style.stroke, alpha: style.strokeAlpha });

    this.rushText.text = model.countdown.label;
    this.rushText.style.fill = style.label;
    this.rushText.alpha = style.labelAlpha;
    this.rushText.x = rect.x + rect.width / 2;
    this.rushText.y = rect.y + rect.height / 2;

    // A guest is told who they are waiting for rather than shown a dead button.
    // The host sees the shape of the match they are about to start — the head count
    // in FFA, and the always-visible per-side tally in TEAMS (ratified: counts
    // shown, never blocking a split).
    this.rushHint.text = counting ? '' : model.hostControls ? this.hintText(model) : 'WAITING FOR THE HOST';
    this.rushHint.visible = this.rushHint.text !== '';
    this.rushHint.x = rect.x + rect.width / 2;
    this.rushHint.y = rect.y + rect.height + 2;
    // Only drawn when it fits inside the content box; the layout hands the
    // button the bottom edge, so on a very short screen there is no room below.
    const bottom = this.layout.content.y + this.layout.content.height;
    if (this.rushHint.y + 12 > bottom) this.rushHint.visible = false;
  }

  /** The RUSH! hint the host reads: the FFA head count, or the TEAMS per-side
   *  tally (`A 2 · B 2`), which is always shown so an uneven split is visible and
   *  never blocked (ratified). */
  private hintText(model: LobbyModel): string {
    if (model.mode === 'teams') {
      const sides = model.teamCounts.map((c) => `${c.label} ${c.count}`).join(' · ');
      return sides || `${model.size} PLAYERS`;
    }
    return `${model.humanCount} PLAYING · ${model.botCount} BOTS`;
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
