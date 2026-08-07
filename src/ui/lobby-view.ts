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
 *  4. **Ship stats ARE drawn here — pips AND numbers** (u4, ratified 2026-08-05:
 *     *"both pips and numbers"*; GDD §2.5 / §2.11 amended). A hull tile draws a
 *     name, a hull, a blurb **and** six stat cells, each a figure over a coarse
 *     five-pip bar. This file does no arithmetic for any of it: the numbers and
 *     the pips both arrive on the model's {@link ShipStatLine} (derived from one
 *     value, off the sim's own table), and every rect arrives from
 *     `classTileContent` / `classStatCell`. The **pips are chrome** — plasma on
 *     the selected tile, chalk otherwise, hull-steel unfilled — so rule 3 above
 *     is untouched: nothing on this screen is signal yellow or threat red.
 *
 * Typography follows style-guide §7: Audiowide for headings and the wordmark,
 * Oxanium for numerals and body — never the other way round.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { buttonStyle } from './button-theme';
import {
  ABUNDANCE_LABELS,
  DIFFICULTY_LABELS,
  MODE_LABELS,
  RUSH_LABEL,
  SIDE_COLORS,
  STAT_PIP_COLORS,
} from './lobby';
import type { LobbyModel, LobbySeatView, ShipClassOption } from './lobby';
import {
  BLOCK_GAP,
  SEAT_CONTROL_MIN_HEIGHT,
  SEAT_STRIPE,
  STAT_COUNT,
  STAT_PIP_BAR,
  STAT_ROW_TEXT,
  classStatCell,
  classTileContent,
  lobbyHitTest,
  lobbyLayout,
} from './lobby-geometry';
import type { ClassTileContent, Insets, LobbyLayout, LobbyTarget } from './lobby-geometry';
import { MapPickerView } from './map-picker-view';
import { mapPickerModel } from './map-picker';
import type { MapPickerLayout } from './map-picker';
import { FONT_BODY, FONT_HEADING } from './typography';
// One grade→colour table for both surfaces that show a ping, so the roster row
// and the in-match stamp can never disagree about what "amber" means — and the
// model's own rule for whether a row has the width to carry a number at all.
import { PING_GRADE_COLORS } from '../net/ping-badge';
import { pingFits } from '../net/ping';

// ---------------------------------------------------------------------------
// Typography & neutrals (style-guide §7 — shared with the HUD and the wheel)
// ---------------------------------------------------------------------------

// Both stacks come from ./typography (imported above) rather than being spelled
// out a second time — that module owns them so a face swap is one line, and this
// copy drifting from it is what a1-01 found on the CI runner.

/** Neutral light UI text. Chalk-white — never signal yellow (style-guide §2). */
const TEXT_PRIMARY = 0xdce3ec;
const TEXT_DIM = PALETTE.hullSteel;

/** Air between a player's name and their ping — `reivi · 245ms`. */
const PING_GAP = 8;

/** Inset the TEAM chip's word keeps from its chip's edges, CSS px — the room the
 *  auto-fit measures against ({@link LobbyView.drawTeamChip}). */
const TEAM_CHIP_LABEL_PAD = 6;

/** …and the same for the leading STATE control's word (u5). Tighter than the team
 *  chip's, because `CLOSED` is the longest word on the narrowest control on this
 *  screen and it should reach full size on every row the layout really produces. */
const STATE_LABEL_PAD = 4;

/** Air between two pips of a stat bar (u4). */
const STAT_PIP_GAP = 1;
/** A pip bar never spans more than this, so a stat on a 543px-wide desktop tile
 *  reads as a bar under its own figure rather than a rule across the tile. Set
 *  to the widest figure the six cells produce (`SPD 130%` measures 32px at
 *  Oxanium 8), so the bar tracks the text it belongs to. */
const STAT_PIP_BAR_MAX_WIDTH = 34;

/** The lobby's layout-registry id and declared anchor: it owns the screen. */
export const LOBBY_ID = 'lobby';
export const LOBBY_ANCHOR: AnchorSpec = { region: 'full' };

// ---------------------------------------------------------------------------
// Per-row children
// ---------------------------------------------------------------------------

interface SeatNodes {
  readonly body: Graphics;
  /** The LEADING STATE control's background — the OPEN/BOT/CLOSED cycle, drawn at
   *  last (u5). The one control on this row that decides whether the slot is a
   *  human, a bot, or shut, and until u5 the only one with nothing drawn for it. */
  readonly stateBody: Graphics;
  /** `OPEN` / `BOT` / `CLOSED` / `TAKEN`, centred on it — the CURRENT state, in
   *  words (`./lobby` SEAT_STATE_LABELS). */
  readonly stateLabel: Text;
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
  /** The side, in the viewer's words — `FRIENDLY A` / `ENEMY B` — centred on the
   *  team chip and auto-fitted to it (u3). */
  readonly teamChipLabel: Text;
  /** The team underline under the name — the TEAMS grouping motif over the eight
   *  identity colours (ratified: keep the colours, add a team indicator), drawn in
   *  the side colour since u3 (blue friendly / red enemy, `./lobby` SIDE_COLORS). */
  readonly underline: Graphics;
  /** `· 245ms` — this player's round trip, beside their name, colour-graded
   *  (ratified developer). Human rows only; a bot has no ping (`src/net/ping`). */
  readonly ping: Text;
}

interface ClassNodes {
  readonly body: Graphics;
  readonly name: Text;
  readonly hull: Text;
  readonly blurb: Text;
  /** Every pip of every stat on this tile, in one Graphics — 30 tiny rects
   *  redrawn together, so a tile costs one extra draw call rather than six. */
  readonly pips: Graphics;
  /** `SPD 130%` — one per stat, in the model's own stat order (u4). */
  readonly stats: Text[];
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
    // The claim code is the thing that gets read across a classroom, so it is the
    // largest text on the screen after the wordmark — and it is set in the body
    // face, because it is a *code* to be read character by character (§7). The
    // noun above it moved to CLAIM with the doors (GDD §4.7); the word "code"
    // deliberately did not — see `lobby-entry.ts` ENTRY_ERRORS.
    this.roomLabel = makeText('CLAIM', FONT_HEADING, 10, TEXT_DIM);
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
      const stateControl = this.layout.seatStates[i];
      const chip = this.layout.seatChips[i];
      const teamChip = this.layout.seatTeamChips[i];
      if (!seat || !rect || !stateControl || !chip || !teamChip) continue;
      this.drawSeat(this.seatSlot(i), seat, rect, stateControl, chip, teamChip, model);
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
   *
   * Left to right since u5: `stripe | STATE control | identity chip | name and
   * detail | team chip | difficulty chip`. The state control leads, because it is
   * the control that decides what the slot *is* — and because it was the only one
   * on this row that had nothing drawn for it at all.
   */
  private drawSeat(
    nodes: SeatNodes,
    seat: LobbySeatView,
    rect: Rect,
    stateRect: Rect,
    chipRect: Rect,
    teamChipRect: Rect,
    model: LobbyModel,
  ): void {
    const pad = 8;
    const stripe = SEAT_STRIPE;
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

    // The seat-state control — leading, labelled, and the reason this row was
    // re-composed (u5). Drawn FIRST because everything after it measures from
    // where it ended; a row too narrow to carry one falls back to the old
    // composition, where the identity chip sits against the stripe.
    const stateShown = this.drawSeatState(nodes, seat, stateRect);
    const leadX = stateShown ? stateRect.x + stateRect.width : rect.x + stripe;

    // The identity chip and its decal. The decal is the source of truth and the
    // colour is the fast read, so they are drawn as one object (§3 rule 3). A
    // closed seat keeps its decal faint (identity is per-slot) but drops the fill.
    const chipSize = Math.min(26, rect.height - 2 * pad);
    const chipX = leadX + pad;
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

    // Colour named in words, beside the hull. This is the line that makes the
    // roster readable with the hue removed (style-guide §3 rule 3, §9).
    nodes.detail.text = closed ? 'out of the match' : `${seat.className} · ${seat.colorName}`;
    nodes.detail.x = textX;
    nodes.detail.y = nodes.name.y + 14;
    nodes.detail.visible = rect.height > 30;

    // The TEAMS grouping underline under the name (ratified: keep the identity
    // colours, add a team indicator) — the team MOTIF, and since u3 the one place
    // on this row that carries side colour: blue for your side, red for any other
    // (`./lobby` SIDE_COLORS). The identity colours above it do not move — they are
    // per-SLOT (style-guide §3.1) and are how a player tells two enemies apart —
    // and the colour is reinforcement only: the chip beside it says the word.
    const teams = model.mode === 'teams';
    nodes.underline.clear();
    if (teams && !closed) {
      nodes.underline
        .rect(textX, nodes.name.y + 12, 22, 2)
        .fill({ color: SIDE_COLORS[seat.side], alpha: 0.85 });
    }

    // The two trailing controls (n2): the DIFFICULTY chip (bot tier, both modes)
    // and — composed to its left in TEAMS — the TEAM chip (side). A bot seat in
    // TEAMS therefore carries both at once; neither replaces the other.
    const tierShown = this.drawDifficultyChip(nodes, seat, chipRect);
    const teamShown = this.drawTeamChip(nodes, seat, teamChipRect, teams, closed);

    // Where the row's trailing furniture actually begins — the leftmost chip that
    // was really drawn, or the right edge when the row carries none. The ping
    // measures from it, so it never reserves space for a control that isn't there.
    const chipsLeft = teamShown ? teamChipRect.x : tierShown ? chipRect.x : rect.x + rect.width;

    // A trailing `OPEN` marker used to sit here, saying that a bot seat was still
    // claimable by room code. It is gone with u5, because the LEADING control now
    // says `OPEN` on exactly those seats and a row with the same word at both ends
    // reads as two different facts when it is one. The model's `openToJoin` is
    // unchanged — the state control's word is the same truth, drawn once, at the
    // end of the row a player reads first.

    // The ping, beside the name (ratified developer): `reivi · 245ms`, graded
    // green/amber/red by `src/net/ping`. Drawn on the name's own line because it
    // is a fact about the *person* in the seat, not about the hull under them —
    // and never at all on a bot row, where a number would be a lie the model
    // refuses to produce (`seat.ping === null`).
    //
    // The name is left-anchored, so the ping follows its measured width, and the
    // number is kept only if it fits WHOLE in the space before `chipsLeft`
    // (`pingFits`). Measured against the row's real content edge rather than a
    // fixed reservation: a human seat in FFA has no trailing chip at all, and on a
    // phone in landscape — a 221px row — the difference between "the chips that
    // are there" and "the chips that could be there" is the whole number.
    nodes.ping.visible = false;
    if (seat.ping) {
      nodes.ping.text = `· ${seat.ping.label}`;
      const pingX = nodes.name.x + nodes.name.width + PING_GAP;
      if (pingFits(pingX, nodes.ping.width, chipsLeft)) {
        nodes.ping.visible = true;
        nodes.ping.style.fill = PING_GRADE_COLORS[seat.ping.grade];
        nodes.ping.x = pingX;
        nodes.ping.y = nodes.name.y + 2;
      }
    }
  }

  /**
   * The LEADING STATE control — the OPEN → BOT → CLOSED cycle, drawn and named
   * (u5, 2026-08-05; developer report: *"theres no way visible way to know that
   * you can close slots right now"*). Returns whether it was drawn.
   *
   * Three things about it are the whole fix, and each is a rule rather than a
   * style choice:
   *
   *  1. **It says the state it is on.** `OPEN` / `BOT` / `CLOSED` — the model's
   *     own words (`./lobby` SEAT_STATE_LABELS) for the model's own cycle, so a
   *     player can answer *"can I close this slot?"* by reading rather than by
   *     experimenting. `TAKEN` on a seat with a person in it, which is the one
   *     state the ring does not contain.
   *  2. **It reads as pressable** — a steel body with a plasma edge, the exact
   *     visual language the MODE and ABUNDANCE pills already use
   *     ({@link drawToggle}) and the difficulty and team chips echo. The screen
   *     had been advertising its two lesser controls and hiding its main one;
   *     this makes the main one look like the others.
   *  3. **…and it reads DEAD when it is dead.** A guest, a lobby past RUSH!, and
   *     a human seat are all no-ops in `cycleSeatState`, and all three arrive
   *     here as `canCycleState === false` — one flag, from the mutation's own
   *     refusals — so the control goes steel-edged and dim instead of looking
   *     live and then refusing. A dead-looking button beats a lying one.
   *
   * No new hue enters for any of it (style-guide §2): a closed slot is not
   * danger, so there is no threat red on it, and there is no ore on this screen,
   * so there is no signal yellow either.
   */
  private drawSeatState(nodes: SeatNodes, seat: LobbySeatView, rect: Rect): boolean {
    const visible = rect.width > 0 && rect.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.stateBody.visible = visible;
    nodes.stateLabel.visible = visible;
    nodes.stateBody.clear();
    if (!visible) return false;

    const live = seat.canCycleState;
    nodes.stateBody
      .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
      .fill({ color: PALETTE.hullSteel, alpha: live ? 0.16 : 0.08 })
      .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
      .stroke({
        width: 1,
        color: live ? PALETTE.plasma : PALETTE.hullSteel,
        alpha: live ? 0.85 : 0.4,
      });
    nodes.stateLabel.text = seat.stateLabel;
    nodes.stateLabel.style.fill = live ? TEXT_PRIMARY : TEXT_DIM;
    nodes.stateLabel.alpha = live ? 1 : 0.7;
    // Fit the word to the control it is drawn in — down, never up — exactly as the
    // team chip does: the narrowest row the layout produces is a landscape phone's,
    // and `CLOSED` drawn wider than its own button reads as a bug.
    nodes.stateLabel.scale.set(1);
    const room = rect.width - 2 * STATE_LABEL_PAD;
    const drawn = nodes.stateLabel.width;
    if (drawn > room && room > 0) nodes.stateLabel.scale.set(room / drawn);
    nodes.stateLabel.x = rect.x + rect.width / 2;
    nodes.stateLabel.y = rect.y + rect.height / 2;
    return true;
  }

  /**
   * The trailing DIFFICULTY chip — the bot-tier cycle (EASY/MEDIUM/HARD), drawn on
   * every BOT seat in BOTH modes (n2): the one slot-editor control every mode
   * shares, so a bot's tier is editable in TEAMS exactly as in FFA. A human or
   * closed seat has no tier, so the chip is hidden. Returns whether it was drawn.
   */
  private drawDifficultyChip(nodes: SeatNodes, seat: LobbySeatView, chip: Rect): boolean {
    const visible = seat.isBot && chip.width > 0 && chip.height > SEAT_CONTROL_MIN_HEIGHT;
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
   * It carries the WORD — `FRIENDLY A` / `ENEMY B`, {@link LobbySeatView.teamName}
   * — not the bare letter it used to. The developer played a teams match and could
   * not tell who was on their side; a lone `A` on a roster chip is a legend nobody
   * was given, and `TEAM A` only helped a player who remembered which team they
   * were (u3). The in-match nameplates say the identical string for this seat and
   * this viewer (`./nameplates`), so the lobby teaches the battlefield's vocabulary
   * before RUSH!.
   *
   * The chip's stroke and its word take the side colour ({@link SIDE_COLORS}) —
   * reinforcement for the word, never a replacement for it, so the row still reads
   * with the hue removed. The label auto-fits: on a landscape phone the row can
   * only spare ~78px, and a word that would overrun its chip is scaled down rather
   * than allowed to spill over the name beside it.
   */
  private drawTeamChip(
    nodes: SeatNodes,
    seat: LobbySeatView,
    chip: Rect,
    teams: boolean,
    closed: boolean,
  ): boolean {
    const visible = teams && !closed && chip.width > 0 && chip.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.teamChip.visible = visible;
    nodes.teamChipLabel.visible = visible;
    nodes.teamChip.clear();
    if (!visible) return false;

    const accent = SIDE_COLORS[seat.side];
    nodes.teamChip
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .fill({ color: PALETTE.hullSteel, alpha: 0.16 })
      .roundRect(chip.x, chip.y, chip.width, chip.height, 4)
      .stroke({ width: 1, color: accent, alpha: 0.85 });
    nodes.teamChipLabel.text = seat.teamName;
    nodes.teamChipLabel.style.fill = accent;
    // Fit the word to the chip it is drawn in. The chip is sized for the longest
    // side word, but a very narrow row clamps it (lobby-geometry
    // SEAT_TEAM_CHIP_MIN_BODY), and a word drawn wider than its own chip reads as a
    // bug — so scale down instead, never up.
    nodes.teamChipLabel.scale.set(1);
    const room = chip.width - 2 * TEAM_CHIP_LABEL_PAD;
    const drawn = nodes.teamChipLabel.width;
    if (drawn > room && room > 0) nodes.teamChipLabel.scale.set(room / drawn);
    nodes.teamChipLabel.x = chip.x + chip.width / 2;
    nodes.teamChipLabel.y = chip.y + chip.height / 2;
    return true;
  }

  private seatSlot(index: number): SeatNodes {
    const existing = this.seatNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const stateBody = new Graphics();
    // The heading face, like every other control label on this screen (§7); 10 pt
    // rather than the chips' 11, because `CLOSED` is the longest word any of them
    // carries and it rides the narrowest button.
    const stateLabel = makeText('', FONT_HEADING, 10, TEXT_PRIMARY);
    stateLabel.anchor.set(0.5, 0.5);
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
    // Numerals face, like every other number on this screen; the colour is set
    // per-frame from the grade.
    const ping = makeText('', FONT_BODY, 11, PING_GRADE_COLORS.good);

    this.addChild(
      body,
      stateBody,
      stateLabel,
      chip,
      decal,
      name,
      detail,
      underline,
      rightChip,
      chipLabel,
      teamChip,
      teamChipLabel,
      ping,
    );
    const nodes: SeatNodes = {
      body,
      stateBody,
      stateLabel,
      chip,
      decal,
      name,
      detail,
      rightChip,
      chipLabel,
      teamChip,
      teamChipLabel,
      underline,
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
      `YIELD · ${ABUNDANCE_LABELS[model.abundance]}`,
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
   * One hull tile: a name, a hull, **six stats as pips and numbers**, and a role
   * blurb — in that priority order, laid out by `classTileContent` so a short
   * tile drops a whole block rather than clipping one (u4, ratified 2026-08-05:
   * *"both pips and numbers"*).
   *
   * Every figure here is `line.text` and every bar is `line.pips`, both derived
   * from the one `line.value` the model read off the sim's `SHIP_STATS`. This
   * method computes neither, which is how "four pips beside a number that means
   * three" is made unreachable rather than merely unlikely.
   *
   * Selection is **plasma**, never signal yellow: there is no ore and no hazard
   * on this screen, so there is no yellow on it (style-guide §2) — and the pips
   * are chrome, so they are neither yellow nor threat red either.
   */
  private drawClassTile(
    nodes: ClassNodes,
    option: ShipClassOption,
    rect: Rect,
    model: LobbyModel,
  ): void {
    const selected = option.shipClass === model.shipClass;
    const dim = model.classLocked && !selected;
    const content = classTileContent(rect);

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

    const alpha = dim ? 0.45 : 1;
    nodes.name.text = option.name;
    nodes.name.style.fill = selected ? TEXT_PRIMARY : TEXT_DIM;
    nodes.name.alpha = alpha;
    nodes.name.x = content.name.x;
    nodes.name.y = content.name.y;

    // The hull nickname (Quadfin…). Flavour the codex also carries, so it is the
    // block that gives way *before* the stats on the tightest tile.
    nodes.hull.text = option.hull;
    nodes.hull.alpha = alpha;
    nodes.hull.x = content.hull.x;
    nodes.hull.y = content.hull.y;
    nodes.hull.visible = content.showHull;

    this.drawClassStats(nodes, option, content, selected, alpha);

    // The role blurb (GDD §2.11). Hidden on a tile too short to hold it rather
    // than clipped — a half-sentence reads worse than none.
    nodes.blurb.text = option.blurb;
    nodes.blurb.alpha = alpha;
    nodes.blurb.style.wordWrapWidth = Math.max(20, content.blurb.width);
    nodes.blurb.x = content.blurb.x;
    nodes.blurb.y = content.blurb.y;
    nodes.blurb.visible = content.showBlurb;
  }

  /**
   * The stat grid on one tile: per stat, its figure on a text line with its pip
   * bar directly beneath, in the model's own stat order (GDD §2.11's table).
   *
   * The two channels are deliberately redundant — the bar answers *"which of
   * these four is the fast one?"* across the four tiles at a glance, the figure
   * answers *"by how much"* — and both are read off the same `ShipStatLine`, so
   * they cannot drift apart here.
   */
  private drawClassStats(
    nodes: ClassNodes,
    option: ShipClassOption,
    content: ClassTileContent,
    selected: boolean,
    alpha: number,
  ): void {
    nodes.pips.clear();
    nodes.pips.alpha = alpha;
    nodes.pips.visible = content.showStats;

    for (let i = 0; i < nodes.stats.length; i++) {
      const cell = nodes.stats[i]!;
      const line = option.stats[i];
      if (!line || !content.showStats) {
        cell.visible = false;
        continue;
      }
      const box = classStatCell(content, i);
      cell.visible = true;
      cell.text = `${line.label} ${line.text}`;
      cell.style.fill = selected ? TEXT_PRIMARY : TEXT_DIM;
      cell.alpha = alpha;
      cell.x = box.x;
      cell.y = box.y;

      // The bar under the figure. Filled pips take the tile's own accent —
      // plasma when this hull is the pick, chalk otherwise — and the unfilled
      // remainder is hull-steel at a glance-level alpha: chrome, never a
      // reserved hue (style-guide §2).
      const barWidth = Math.min(box.width, STAT_PIP_BAR_MAX_WIDTH);
      const pipWidth = Math.max(
        1,
        (barWidth - (line.pipMax - 1) * STAT_PIP_GAP) / Math.max(1, line.pipMax),
      );
      const barY = box.y + STAT_ROW_TEXT;
      for (let p = 0; p < line.pipMax; p++) {
        const filled = p < line.pips;
        nodes.pips
          .rect(box.x + p * (pipWidth + STAT_PIP_GAP), barY, pipWidth, STAT_PIP_BAR)
          .fill({
            color: filled
              ? selected
                ? STAT_PIP_COLORS.selected
                : STAT_PIP_COLORS.filled
              : STAT_PIP_COLORS.empty,
            alpha: filled ? (selected ? 1 : 0.85) : 0.3,
          });
      }
    }
  }

  private classSlot(index: number): ClassNodes {
    const existing = this.classNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const name = makeText('', FONT_HEADING, 12, TEXT_PRIMARY);
    const hull = makeText('', FONT_BODY, 9, PALETTE.patina);
    const blurb = makeText('', FONT_BODY, 10, TEXT_DIM);
    blurb.style.wordWrap = true;
    const pips = new Graphics();
    // One label+figure per stat. `letterSpacing: 0` (rather than the screen's
    // usual 0.5) is what buys `SPD 130%` its room in a 42px cell on a phone.
    const stats: Text[] = [];
    for (let i = 0; i < STAT_COUNT; i++) {
      const cell = makeText('', FONT_BODY, 8, TEXT_DIM);
      cell.style.letterSpacing = 0;
      stats.push(cell);
    }

    this.addChild(body, name, hull, blurb, pips, ...stats);
    const nodes: ClassNodes = { body, name, hull, blurb, pips, stats };
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
    // "Claim holder", not "host": the guest came through JOIN A CLAIM, so the
    // claim is the noun already on screen, and "host" is the network's word for
    // it (GDD §4.7 worked examples). Measured at 11px against the 390-wide
    // content box before it shipped — see tests/mobile/voice-copy-fit.spec.ts.
    this.rushHint.text = counting
      ? ''
      : model.hostControls
        ? this.hintText(model)
        : 'WAITING FOR THE CLAIM HOLDER';
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
