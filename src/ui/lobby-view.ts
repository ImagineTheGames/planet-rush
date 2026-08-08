/**
 * src/ui/lobby-view.ts — the Pixi view for the lobby. OWNER: UI Engineer.
 *
 * The drawing half of GDD §2.1 / §2.11. Every decision lives in the pure,
 * unit-tested model ({@link ./lobby}) and every rect in the pure, unit-tested
 * layout ({@link ./lobby-geometry}); this file only turns them into Graphics and
 * Text, and holds the one thing neither of them has an opinion about — which
 * Pixi child is which.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-03, ratified 2026-08-05; spec `docs/design/gantry-bone-handoff.html`)
 * ---------------------------------------------------------------------------
 * The lobby is made of the same material as the title and settings screens: a
 * header beam carrying `CREW MUSTER` and the room code, a footer beam carrying
 * BACK, the RUSH! hint and RUSH!, eight roster rows drawn as `inert` plates —
 * surfaces that hold controls rather than plates standing off the screen — and
 * the four hull tiles beside them. Every bevel, rule, band and tone comes from
 * {@link ../art/materials}; nothing is hand-rolled here.
 *
 * **RUSH! is the screen's ONE bright plate.** Under Bone the primary action is
 * simply the brightest plate on screen, which only works while there is exactly
 * one — so a *selected* hull tile is a `secondary` plate (raised, actionable),
 * an unselected one is `inert` (a surface), and no row, chip or card is ever
 * primary however engaged it is. {@link ./gantry} `singlePrimary` states the
 * rule and `./lobby.test.ts` holds this screen to it.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE CONTRACT RULES ENFORCED *HERE*, BECAUSE HERE IS WHERE THEY BREAK
 * ---------------------------------------------------------------------------
 *
 *  1. **Hulls stay steel** (style-guide §3 rule 1). A row's chrome is Bone —
 *     a value ramp on hull steel — and spends no hue at all.
 *  2. **Identity lives on the row bar and the P-number, and NOWHERE else**
 *     (the handoff, verbatim: *"identity colours live on the row bar and
 *     P-number only, never as a background wash — that was making identity read
 *     as chrome"*). The filled identity chip this row used to draw behind its
 *     decal is gone with that rule; the decal itself stays, because it is the
 *     colour-blind-safe source of truth (§3 rule 3) and the *only* channel left
 *     once the wash is removed.
 *  3. **Signal yellow is RESERVED** (§2). There is no ore and no hazard on this
 *     screen, so there is no yellow on it — and under Bone, no accent hue
 *     either. Selection reads as brighter metal, not as plasma.
 *  4. **Ship stats ARE drawn here — pips AND numbers** (u4, ratified 2026-08-05:
 *     *"both pips and numbers"*; GDD §2.5 / §2.11 amended). A hull tile draws a
 *     name, a hull, a blurb **and** six stat cells, each a figure over a coarse
 *     five-pip bar. This file does no arithmetic for any of it: the numbers and
 *     the pips both arrive on the model's {@link ShipStatLine} (derived from one
 *     value, off the sim's own table), and every rect arrives from
 *     `classTileContent` / `classStatCell`.
 *  5. **The side chip keeps its colour, and it is the one exception to Bone.**
 *     Blue friendly / red enemy on the team motif is a ratified *mechanic*
 *     (GDD §2.1, amended 2026-08-05 — a Teams match was played in which it was
 *     "impossible to know who is on your team"), not chrome, so it survives a
 *     direction that spends no colour. The word carries the meaning either way.
 *
 * Typography follows style-guide §7: Audiowide for headings, names and control
 * words, Oxanium for numerals and body — never the other way round.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  PLATE_SCALES,
  ROSTER,
  TRACKING,
  drawBeam,
  drawPlate,
  platePadX,
  plateTypeSize,
  rosterMetric,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics, PlateRole } from '../art/materials';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { PALETTE } from '@render/index';
import {
  ABUNDANCE_LABELS,
  DIFFICULTY_LABELS,
  LOBBY_EYEBROW,
  LOBBY_TITLE,
  MODE_LABELS,
  RUSH_LABEL,
  SEAT_HELP_GLYPH,
  SIDE_COLORS,
  STAT_PIP_COLORS,
} from './lobby';
import type { LobbyModel, LobbySeatView, ShipClassOption } from './lobby';
import {
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
import { FONT_BODY, FONT_HEADING } from './typography';
import { MapPickerView } from './map-picker-view';
import { mapPickerModel } from './map-picker';
import type { MapPickerLayout } from './map-picker';
import { ScreenCache } from './screen-cache';
// One grade→colour table for both surfaces that show a ping, so the roster row
// and the in-match stamp can never disagree about what "amber" means — and the
// model's own rule for whether a row has the width to carry a number at all.
import { PING_GRADE_COLORS } from '../net/ping-badge';
import { pingFits } from '../net/ping';

// ---------------------------------------------------------------------------
// Reference type sizes, read off the handoff's lobby / ship-select screens
// ---------------------------------------------------------------------------

// Both font stacks come from ./typography (imported above) rather than being
// spelled out a second time — that module owns them so a face swap is one line,
// and this file's own local copy drifting from it is what a1-01 found on the CI
// runner. Nothing below re-declares one.

/** `CREW MUSTER` in the header beam, and `CLAIM` above the code. */
const HEADING_PX = 22;
const EYEBROW_PX = 12;
/** The room code itself — the number a classroom reads off one screen. */
const CODE_PX = 26;
/** A roster row: the P-number, the player's name, its second line. */
const DECAL_PX = 13;
const NAME_PX = 15;
const DETAIL_PX = 12;
/** The word on a row's own controls, and on the MODE / ORE chips above them. */
const ROW_LABEL_PX = 12;
const TOGGLE_PX = 13;
/** The footer beam's two plates and the hint between them. */
const ACTION_PX = 20;
const HINT_PX = 12;
/** A hull tile: its class name, its hull nickname, its blurb, its stat cells. */
const TILE_NAME_PX = 14;
const TILE_HULL_PX = 10;
const TILE_BLURB_PX = 11;
const STAT_PX = 9;
/** …and the floor it keeps. Deliberately below {@link TYPE_MIN}: see the note in
 *  {@link LobbyView.drawClassStats}. */
const STAT_MIN_PX = 8;

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
/** A pip bar never spans more than this, so a stat on a 469px-wide desktop tile
 *  reads as a bar under its own figure rather than a rule across the tile. Set
 *  to the widest figure the six cells produce (`SPD 130%` measures 34px at
 *  Oxanium 9), so the bar tracks the text it belongs to. */
const STAT_PIP_BAR_MAX_WIDTH = 36;

/** The lobby's layout-registry id and declared anchor: it owns the screen. */
export const LOBBY_ID = 'lobby';
export const LOBBY_ANCHOR: AnchorSpec = { region: 'full' };

// ---------------------------------------------------------------------------
// Per-row children
// ---------------------------------------------------------------------------

interface SeatNodes {
  /** The row surface, its identity bar and every plate drawn on it — one
   *  Graphics, because a row's segments change together or not at all. */
  readonly body: Graphics;
  /** `OPEN` / `BOT` / `CLOSED` / `TAKEN`, centred on the leading control — the
   *  CURRENT state, in words (`./lobby` SEAT_STATE_LABELS). */
  readonly stateLabel: Text;
  /** `P1`…`P8` in the slot's identity colour — with the row bar, one of the two
   *  places identity is allowed to land (the handoff). */
  readonly decal: Text;
  readonly name: Text;
  /** The hull the seat flies. The colour NAME that used to share this line is
   *  gone with the handoff's decluttered row: the bar and the P-number carry
   *  identity, and §3 rule 3's hue-independent channel is the decal. */
  readonly detail: Text;
  /** EASY/MEDIUM/HARD, centred on the trailing tier chip. **Read-only since
   *  a0-06** — the character's own tier, shown rather than chosen. */
  readonly chipLabel: Text;
  /** `?` — the trailing control that opens this seat's codex dossier (a0-06). */
  readonly helpLabel: Text;
  /** The side, in the viewer's words — `FRIENDLY A` / `ENEMY B` — centred on the
   *  team chip and auto-fitted to it (u3). */
  readonly teamChipLabel: Text;
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
  private readonly beams = new Graphics();
  private readonly heading: Text;
  private readonly roomLabel: Text;
  private readonly roomCode: Text;
  private readonly seatNodes: SeatNodes[] = [];
  private readonly classNodes: ClassNodes[] = [];
  /** The arena row (p2 field rule): the four map cards, drawn by the SHARED map
   *  view, so the registry previews, the VETERAN tag and the selection all come
   *  for free — no ship stats, no yellow, exactly the frozen contract the
   *  standalone picker kept. Fed the lobby's own card rects each frame. */
  private readonly mapPicker = new MapPickerView();
  /** The MODE toggle (FFA / TEAMS) and the ABUNDANCE toggle (SCARCE / STANDARD /
   *  RICH) — the two match-config controls at the top of the roster (Milestone E). */
  private readonly toggles = new Graphics();
  private readonly modeText: Text;
  private readonly abundanceText: Text;
  /** BACK and RUSH! — the footer beam's two plates — and the hint between them. */
  private readonly actions = new Graphics();
  private readonly backText: Text;
  private readonly rushText: Text;
  private readonly rushHint: Text;
  /**
   * The lobby is static between state changes, and the Gantry material is ~56
   * translucent polygons per plate — this screen draws around thirty of them.
   * Without this it costs more per frame than the live match (see ./screen-cache
   * and tests/mobile/menu-frame-cost.spec.ts, where exactly that pegged CI).
   */
  private readonly cache = new ScreenCache(this);

  private layout: LobbyLayout;

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = lobbyLayout({ width: screenWidth, height: screenHeight }, touchOpts(isTouch, insets));

    this.heading = makeText(LOBBY_TITLE, FONT_HEADING, HEADING_PX, MATERIAL_SHADES.bone);
    this.heading.anchor.set(0, 0.5);
    this.roomLabel = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.roomLabel.anchor.set(1, 1);
    // The room code is the thing that gets read across a classroom, so it is the
    // brightest metal in the beam — and it is set in the body face, because it is
    // a code read character by character (§7).
    this.roomCode = makeText('', FONT_BODY, CODE_PX, BONE.hi, 'bold');
    this.roomCode.anchor.set(1, 0);

    this.backText = makeText('BACK', FONT_HEADING, ACTION_PX, MATERIAL_SHADES.bone);
    this.backText.anchor.set(0.5, 0.5);
    this.rushText = makeText(RUSH_LABEL, FONT_HEADING, ACTION_PX, BONE.hi);
    this.rushText.anchor.set(0.5, 0.5);
    this.rushHint = makeText('', FONT_BODY, HINT_PX, MATERIAL_SHADES.boneLo);
    this.rushHint.anchor.set(1, 0.5);

    this.modeText = makeText('', FONT_HEADING, TOGGLE_PX, MATERIAL_SHADES.bone);
    this.modeText.anchor.set(0.5, 0.5);
    this.abundanceText = makeText('', FONT_HEADING, TOGGLE_PX, MATERIAL_SHADES.bone);
    this.abundanceText.anchor.set(0.5, 0.5);

    this.addChild(this.backdrop, this.beams, this.heading, this.roomLabel, this.roomCode);
    this.addChild(this.mapPicker);
    this.addChild(this.toggles, this.modeText, this.abundanceText);
    this.addChild(this.actions, this.backText, this.rushText, this.rushHint);
    this.visible = false;
  }

  /** Re-lay-out for a new viewport, device or safe area. Cheap: the layout is
   *  a handful of rects, and nothing is re-created. */
  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = lobbyLayout({ width, height }, touchOpts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
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
    const visible = model.phase !== 'started';
    if (visible !== this.visible) this.cache.invalidate();
    this.visible = visible;
    if (!visible) return;

    // This screen's `update` is called per FRAME, and the countdown's raw seconds
    // move every one of them — so the signature deliberately carries the
    // countdown's LABEL (which ticks once a second) and not its float. Without
    // that the cache would re-rasterise ~1700 polygons 60 times a second during
    // the five seconds a player is watching RUSH! count down.
    const signature = signatureOf(model);
    if (this.cache.unchanged(signature)) return;

    const { content, header, footer, metrics } = this.layout;

    // Opaque over the whole viewport: the lobby owns the screen, and the beams'
    // own translucent fill needs the void to sit on, exactly as the handoff
    // composites them.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, content.x * 2 + content.width, content.y + content.height + content.y)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    this.beams.clear();
    if (header.height > 0)
      drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0)
      drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, metrics);
    this.drawSeparator();
    this.drawControls(model, metrics);
    for (let i = 0; i < this.layout.seats.length; i++) {
      const seat = model.seats[i];
      const rect = this.layout.seats[i];
      const stateControl = this.layout.seatStates[i];
      const chip = this.layout.seatChips[i];
      const teamChip = this.layout.seatTeamChips[i];
      const help = this.layout.seatHelp[i];
      if (!seat || !rect || !stateControl || !chip || !teamChip || !help) continue;
      this.drawSeat(this.seatSlot(i), seat, rect, stateControl, chip, teamChip, help, model, metrics);
    }
    for (let i = 0; i < this.layout.classOptions.length; i++) {
      const option = model.classOptions[i];
      const rect = this.layout.classOptions[i];
      if (!option || !rect) continue;
      this.drawClassTile(this.classSlot(i), option, rect, model, metrics);
    }
    this.drawMaps(model);
    this.drawActions(model, metrics);
    // Everything above is now on the display list; rasterise it once so the
    // frames between state changes cost one blit rather than ~1700 translucent
    // polygons (./screen-cache).
    this.cache.refresh(signature);
  }

  // --- The frame -----------------------------------------------------------

  /** The header beam: `CREW MUSTER` hard left, the room-code cluster hard right. */
  private drawHeader(model: LobbyModel, m: FrameMetrics): void {
    const { title, roomCode } = this.layout;
    const visible = title.height > 0;
    this.heading.visible = visible;
    if (visible) {
      const px = typeSize(HEADING_PX, m);
      this.heading.text = LOBBY_TITLE;
      this.heading.style.fontSize = px;
      this.heading.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
      this.heading.x = title.x;
      this.heading.y = title.y + title.height / 2;
      // The heading gives way to the room code, never the other way round: a
      // player can name the screen they are on, and cannot guess a code.
      this.heading.scale.set(1);
      if (this.heading.width > title.width && this.heading.width > 0) {
        this.heading.scale.set(title.width / this.heading.width);
      }
    }

    // The room code is the number a classroom reads off one screen and types into
    // another (GDD §4.2) — so it exists only when there is a wire to join over.
    // Offline (solo-vs-bots, M4) there is none, so ROOM and the code are hidden
    // rather than showing a code nobody can act on.
    const online = model.online && roomCode.width > 0 && roomCode.height > 0;
    this.roomLabel.visible = online;
    this.roomCode.visible = online;
    if (!online) return;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    const codePx = typeSize(CODE_PX, m);
    const right = roomCode.x + roomCode.width;
    const mid = roomCode.y + roomCode.height / 2;
    this.roomLabel.text = LOBBY_EYEBROW;
    this.roomLabel.style.fontSize = eyebrowPx;
    this.roomLabel.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.roomLabel.x = right;
    this.roomLabel.y = mid - codePx * 0.4;
    this.roomCode.text = model.room;
    this.roomCode.style.fontSize = codePx;
    this.roomCode.style.letterSpacing = trackingPx(TRACKING.name, codePx);
    this.roomCode.x = right;
    this.roomCode.y = mid - codePx * 0.35;
  }

  /**
   * The 1px rule down the gap between the roster and ship select.
   *
   * It is drawn on the backdrop rather than as a plate because it is not one: the
   * handoff bounds the right column by *the band between the beams* so nothing
   * crowds this rule, which is the whole reason the arena row moved out of the
   * full width of the band and into the right column.
   */
  private drawSeparator(): void {
    const { separator } = this.layout;
    if (separator.width <= 0 || separator.height <= 0) return;
    this.backdrop
      .rect(separator.x, separator.y, separator.width, separator.height)
      .fill({ color: MATERIAL_SHADES.hairline, alpha: 0.35 });
  }

  /**
   * The footer beam: BACK on the left, the RUSH! hint, and RUSH! on the right —
   * the screen's **one** bright plate (`./gantry` `singlePrimary`).
   *
   * A guest before the host starts is the one disabled case, and it carries its
   * reason beside it (the hint), so the dim look is honest rather than a stray
   * grey — the same rule the button contract has kept since p4-03. Under Bone
   * "disabled" is a step down the same ramp, not a colour.
   */
  private drawActions(model: LobbyModel, m: FrameMetrics): void {
    const { leave, rushButton, rushHint } = this.layout;
    this.actions.clear();

    const backVisible = leave.width > 0 && leave.height > 0;
    this.backText.visible = backVisible;
    if (backVisible) {
      drawPlate(this.actions, leave.x, leave.y, leave.width, leave.height, 'secondary', 'compact');
      const px = plateTypeSize(ACTION_PX, m);
      this.backText.style.fontSize = px;
      this.backText.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
      this.backText.x = plateLabelCentreX(leave, m);
      this.backText.y = leave.y + leave.height / 2;
      fitLabel(this.backText, leave.width - 2 * platePadX('compact', m));
    }

    const rushVisible = rushButton.width > 0 && rushButton.height > 0;
    this.rushText.visible = rushVisible;
    if (rushVisible) {
      const live = model.canStart || model.countdown.active;
      drawPlate(
        this.actions,
        rushButton.x,
        rushButton.y,
        rushButton.width,
        rushButton.height,
        'primary',
        'compact',
      );
      const px = plateTypeSize(ACTION_PX, m);
      this.rushText.text = model.countdown.label;
      this.rushText.style.fontSize = px;
      this.rushText.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
      this.rushText.style.fill = live ? BONE.hi : MATERIAL_SHADES.boneLo;
      this.rushText.alpha = live ? 1 : 0.75;
      this.rushText.x = plateLabelCentreX(rushButton, m);
      this.rushText.y = rushButton.y + rushButton.height / 2;
      fitLabel(this.rushText, rushButton.width - 2 * platePadX('compact', m));
    }

    // A guest is told who they are waiting for rather than shown a dead button.
    // The host sees the shape of the match they are about to start — the head
    // count in FFA, and the always-visible per-side tally in TEAMS (ratified:
    // counts shown, never blocking a split).
    // "Claim holder", not "host": the guest came through JOIN A CLAIM, so the
    // claim is the noun already on screen, and "host" is the network's word for
    // it (GDD §4.7 worked examples). Measured at 11px against the content box
    // before it shipped — see tests/mobile/voice-copy-fit.spec.ts.
    const text = model.countdown.active
      ? ''
      : model.hostControls
        ? hintText(model)
        : 'WAITING FOR THE CLAIM HOLDER';
    const px = typeSize(HINT_PX, m);
    this.rushHint.text = text;
    this.rushHint.style.fontSize = px;
    this.rushHint.style.letterSpacing = trackingPx(TRACKING.eyebrow, px);
    this.rushHint.x = rushHint.x + rushHint.width;
    this.rushHint.y = rushHint.y + rushHint.height / 2;
    // Drawn only where the footer beam actually has a strip for it — the
    // narrowest phone spends its whole footer on the two plates.
    this.rushHint.visible = text !== '' && rushHint.width >= this.rushHint.width;
  }

  /**
   * The arena row. The rects are the lobby's own ({@link LobbyLayout.maps}); the
   * drawing is the shared {@link MapPickerView}'s, fed a {@link MapPickerLayout}
   * built from those rects and the model for the currently-selected arena — so
   * the card previews, names and VETERAN tag are pixel-for-pixel what the picker
   * draws, with none of it duplicated here.
   *
   * The whole row dims for a client that cannot change it — a JOINER in an online
   * room, or any lobby past RUSH! — the same honest tell the MODE and ORE chips
   * carry ({@link drawControls}), and the same rule the model enforces
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

  // --- Seat rows -----------------------------------------------------------

  /**
   * One roster row.
   *
   * The row is an `inert` plate — a surface held down on the panel, which is how
   * the handoff draws a list — and its only colour is the 4px identity bar down
   * its leading edge and the P-number beside it. Rows **abut**: two adjacent
   * `inert` plates share their 1px rules, which is the separator a list wants and
   * is also what buys the row its height on a phone (`./lobby-geometry`).
   *
   * Left to right: `bar | STATE control | P-number | name and hull | team chip |
   * tier chip | ?`. The state control leads, because it is the control that
   * decides what the slot *is* — and because it was the only one on this row that
   * had nothing drawn for it at all before u5.
   *
   * **a0-06 changed what two of those segments MEAN, and added one.** The row's
   * body is the character cycle now (the tap that lands on a name changes the
   * name); the tier chip states the character's difficulty and is no longer a
   * control at all — it draws on the `inert` surface every dead thing on this
   * screen draws on, so it reads as the information GDD §2.1 promises rather than
   * as a second control that could disagree with the cast; and the `?` at the far
   * right opens that character's codex dossier on a plain tap.
   */
  private drawSeat(
    nodes: SeatNodes,
    seat: LobbySeatView,
    rect: Rect,
    stateRect: Rect,
    chipRect: Rect,
    teamChipRect: Rect,
    helpRect: Rect,
    model: LobbyModel,
    m: FrameMetrics,
  ): void {
    const pad = rosterMetric(ROSTER.padX, m);
    // A closed seat is a shut door: drawn faint, no identity, no chip, no team —
    // it holds no player and takes no field (variable-slots Milestone E).
    const closed = seat.isClosed;

    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      hideRow(nodes);
      return;
    }
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'inert', 'compact');
    // The identity bar — with the P-number, one of the two places a slot's colour
    // is allowed to land (the handoff; style-guide §3 rule 2).
    nodes.body
      .rect(rect.x, rect.y, SEAT_STRIPE, rect.height)
      .fill({ color: seat.color, alpha: closed ? 0.25 : 0.95 });
    if (seat.isYou) {
      // Your own row is marked by the brightest hairline on the roster rather
      // than by a brighter identity colour, so "which one is me" and "which
      // colour am I" stay two separate reads. No hue is spent on it.
      nodes.body
        .rect(rect.x, rect.y, rect.width, rect.height)
        .stroke({ width: 1, color: BONE.mid, alpha: 0.8 });
    }

    // The seat-state control — leading, labelled, and the reason this row was
    // re-composed (u5). Drawn FIRST because everything after it measures from
    // where it ended; a row too narrow to carry one falls back to the old
    // composition, where the decal sits against the bar.
    const stateShown = this.drawSeatState(nodes, seat, stateRect, m);
    const leadX = stateShown ? stateRect.x + stateRect.width : rect.x + SEAT_STRIPE;

    // The P-number. The decal is the source of truth and the colour is the fast
    // read (§3 rule 3) — and since u7-03 the colour has no *background* to sit
    // on, because a wash made identity read as chrome (the handoff).
    const decalPx = plateTypeSize(DECAL_PX, m);
    nodes.decal.visible = true;
    nodes.decal.text = seat.decal;
    nodes.decal.style.fontSize = decalPx;
    nodes.decal.style.letterSpacing = trackingPx(TRACKING.name, decalPx);
    nodes.decal.style.fill = seat.color;
    nodes.decal.alpha = closed ? 0.4 : 1;
    nodes.decal.x = leadX + pad;
    nodes.decal.y = rect.y + rect.height / 2;

    // The two trailing controls (n2) are drawn BEFORE the name, because the name
    // is what has to fit in whatever they leave: the DIFFICULTY chip (bot tier,
    // both modes) and — composed to its left in TEAMS — the TEAM chip (side). A
    // bot seat in TEAMS therefore carries both at once; neither replaces the
    // other.
    const teams = model.mode === 'teams';
    const helpShown = this.drawHelpControl(nodes, seat, helpRect, m);
    const tierShown = this.drawDifficultyChip(nodes, seat, chipRect, m);
    const teamShown = this.drawTeamChip(nodes, seat, teamChipRect, teams, closed, m);

    // Where the row's trailing furniture actually begins — the leftmost chip that
    // was really drawn, or the right edge when the row carries none. The name and
    // the hull measure against it, so a 233px landscape row's name is fitted into
    // its own body rather than drawn under the side chip.
    const chipsLeft = teamShown
      ? teamChipRect.x
      : tierShown
        ? chipRect.x
        : helpShown
          ? helpRect.x
          : rect.x + rect.width;

    const textX = nodes.decal.x + nodes.decal.width + pad;
    const textRoom = Math.max(0, chipsLeft - pad - textX);
    const namePx = plateTypeSize(NAME_PX, m);
    const detailPx = plateTypeSize(DETAIL_PX, m);
    nodes.name.visible = true;
    nodes.name.text = seat.isHost ? `${seat.name}  \u2605` : seat.name;
    nodes.name.style.fontSize = namePx;
    nodes.name.style.letterSpacing = trackingPx(TRACKING.name, namePx);
    nodes.name.style.fill = closed || seat.isBot ? MATERIAL_SHADES.boneLo : MATERIAL_SHADES.bone;
    nodes.name.alpha = closed ? 0.6 : 1;

    // The hull, in words. The colour NAME that used to share this line is gone
    // with the handoff's decluttered row.
    nodes.detail.text = closed ? 'OUT OF THE MATCH' : seat.className;
    nodes.detail.style.fontSize = detailPx;
    nodes.detail.style.letterSpacing = trackingPx(TRACKING.label, detailPx);

    // Two lines when the row is tall enough for the two MEASURED boxes, one
    // otherwise — dropped whole, never clipped, the ladder every block on this
    // screen keeps. Measured rather than estimated from the point sizes: the
    // first cut of this row guessed, and every name was drawn through its hull.
    const twoLines =
      nodes.name.height + nodes.detail.height <= rect.height - 6 &&
      nodes.detail.width <= textRoom;
    const block = nodes.name.height + (twoLines ? nodes.detail.height : 0);
    const top = rect.y + (rect.height - block) / 2;
    nodes.name.x = textX;
    nodes.name.y = top + nodes.name.height / 2;
    // The hull line is rung 3 of the row's ladder and it is DROPPED WHOLE rather
    // than scaled: a landscape phone's 233px row leaves ~40px of body, and
    // `EXCAVATOR` fitted into 40px is a 5px smudge, not a word. The tile beside
    // the roster carries the same hull at full size, so nothing is lost.
    nodes.detail.visible = twoLines;
    nodes.detail.x = textX;
    nodes.detail.y = top + block - nodes.detail.height / 2;

    // The ping, beside the name (ratified developer): `reivi · 245ms`, graded
    // green/amber/red by `src/net/ping`. Drawn on the name's own line because it
    // is a fact about the *person* in the seat, not about the hull under them —
    // and never at all on a bot row, where a number would be a lie the model
    // refuses to produce (`seat.ping === null`).
    nodes.ping.visible = false;
    if (seat.ping) {
      nodes.ping.text = `\u00b7 ${seat.ping.label}`;
      nodes.ping.style.fontSize = detailPx;
      const pingX = nodes.name.x + nodes.name.width + PING_GAP;
      if (pingFits(pingX, nodes.ping.width, chipsLeft - pad)) {
        nodes.ping.visible = true;
        nodes.ping.style.fill = PING_GRADE_COLORS[seat.ping.grade];
        nodes.ping.x = pingX;
        nodes.ping.y = nodes.name.y;
        // The name gives way to the ping, never the other way round: a truncated
        // number is a lie about a measurement.
        fitLabel(nodes.name, Math.max(0, textRoom - nodes.ping.width - PING_GAP));
      } else {
        fitLabel(nodes.name, textRoom);
      }
    } else {
      fitLabel(nodes.name, textRoom);
    }
  }

  /**
   * The LEADING STATE control — the OPEN → BOT → CLOSED cycle, drawn and named
   * (u5, 2026-08-05; developer report: *"theres no way visible way to know that
   * you can close slots right now"*), and since u7-03 wearing the handoff's own
   * shape for it. Returns whether it was drawn.
   *
   * Three things about it are the whole fix, and each is a rule rather than a
   * style choice:
   *
   *  1. **It says the state it is on.** `OPEN` / `BOT` / `CLOSED` — the model's
   *     own words (`./lobby` SEAT_STATE_LABELS) for the model's own cycle, so a
   *     player can answer *"can I close this slot?"* by reading rather than by
   *     experimenting. `TAKEN` on a seat with a person in it, which is the one
   *     state the ring does not contain.
   *  2. **It reads as pressable** — a `secondary` chip, which under Bone is a
   *     raised, bright-hairlined plate: the same material every other control on
   *     this screen wears. The screen had been advertising its two lesser
   *     controls and hiding its main one; this makes the main one look like the
   *     others.
   *  3. **…and it reads DEAD when it is dead.** A guest, a lobby past RUSH!, and
   *     a human seat are all no-ops in `cycleSeatState`, and all three arrive
   *     here as `canCycleState === false` — one flag, from the mutation's own
   *     refusals — so the control drops to the `inert` surface material and a
   *     dimmer word instead of looking live and then refusing. A dead-looking
   *     button beats a lying one.
   *
   * No hue enters for any of it: a closed slot is not danger, so there is no
   * threat red on it, and there is no ore on this screen, so no signal yellow
   * either (style-guide §2).
   */
  private drawSeatState(nodes: SeatNodes, seat: LobbySeatView, rect: Rect, m: FrameMetrics): boolean {
    const visible = rect.width > 0 && rect.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.stateLabel.visible = visible;
    if (!visible) return false;

    const live = seat.canCycleState;
    drawDeadOrLive(nodes.body, rect, live);
    const px = plateTypeSize(ROW_LABEL_PX, m);
    nodes.stateLabel.text = seat.stateLabel;
    nodes.stateLabel.style.fontSize = px;
    nodes.stateLabel.style.letterSpacing = trackingPx(TRACKING.label, px);
    nodes.stateLabel.style.fill = live ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    nodes.stateLabel.alpha = live ? 1 : 0.7;
    fitLabel(nodes.stateLabel, rect.width - 2 * STATE_LABEL_PAD);
    nodes.stateLabel.x = rect.x + rect.width / 2;
    nodes.stateLabel.y = rect.y + rect.height / 2;
    return true;
  }

  /**
   * The trailing TIER chip — `EASY` / `MEDIUM` / `HARD`, drawn on every BOT seat in
   * both modes. Returns whether it was drawn.
   *
   * **It is a read-out, not a control** *(a0-06, GDD §2.1 amended 2026-08-07: the
   * host picks the character and its difficulty is shown)*. That is the entire
   * change here and it is deliberately visible in the material rather than only in
   * the hit test: the chip draws on the `inert` surface — the same one a guest's
   * mode toggle and a dead state control wear — instead of the raised, bright-
   * hairlined `secondary` plate it used to. This screen already keeps the rule
   * that *a dead-looking button beats a lying one* ({@link drawSeatState} point 3);
   * a value that is not a button at all has to look like one even less.
   *
   * The tier itself comes off the character (`./lobby` `seatDifficulty`), so this
   * chip cannot print a difficulty the seated bot will not fly — the developer's
   * *"i chose HARD … they were at other difficulties"* has no representation left.
   */
  private drawDifficultyChip(
    nodes: SeatNodes,
    seat: LobbySeatView,
    chip: Rect,
    m: FrameMetrics,
  ): boolean {
    const visible = seat.isBot && chip.width > 0 && chip.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.chipLabel.visible = visible;
    if (!visible) return false;

    drawDeadOrLive(nodes.body, chip, false);
    const px = plateTypeSize(ROW_LABEL_PX, m);
    nodes.chipLabel.text = DIFFICULTY_LABELS[seat.botDifficulty ?? 'medium'];
    nodes.chipLabel.style.fontSize = px;
    nodes.chipLabel.style.letterSpacing = trackingPx(TRACKING.label, px);
    nodes.chipLabel.style.fill = MATERIAL_SHADES.boneLo;
    fitLabel(nodes.chipLabel, chip.width - 2 * STATE_LABEL_PAD);
    nodes.chipLabel.x = chip.x + chip.width / 2;
    nodes.chipLabel.y = chip.y + chip.height / 2;
    return true;
  }

  /**
   * The trailing **`?` control** — a plain tap opens this seat's character's codex
   * dossier *(a0-06; the developer asked for "a ? question mark icon that you can
   * press to show a tooltip with the codex entry about that bot")*. Bot rows only:
   * a human seat and a closed one have no character to write a dossier about.
   * Returns whether it was drawn.
   *
   * It reads as pressable — the `secondary` chip plate the state control wears —
   * because unlike the tier chip beside it, it **is** a control, and on every
   * device: the hover and the long-press that reach the same hint are shortcuts to
   * an affordance that is now advertised, not the affordance itself. A hover-only
   * tooltip is a desktop-only feature and the parity principle (GDD §2.4) does not
   * have a cell for one.
   *
   * The glyph is a bare `?` and takes no hue: yellow means ore and red means damage
   * (style-guide §2), and a help affordance is neither.
   */
  private drawHelpControl(
    nodes: SeatNodes,
    seat: LobbySeatView,
    rect: Rect,
    m: FrameMetrics,
  ): boolean {
    const visible = seat.isBot && rect.width > 0 && rect.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.helpLabel.visible = visible;
    if (!visible) return false;

    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'secondary', 'chip');
    const px = plateTypeSize(ROW_LABEL_PX, m);
    nodes.helpLabel.text = SEAT_HELP_GLYPH;
    nodes.helpLabel.style.fontSize = px;
    nodes.helpLabel.style.letterSpacing = 0;
    nodes.helpLabel.style.fill = MATERIAL_SHADES.bone;
    fitLabel(nodes.helpLabel, rect.width - 2);
    nodes.helpLabel.x = rect.x + rect.width / 2;
    nodes.helpLabel.y = rect.y + rect.height / 2;
    return true;
  }

  /**
   * The TEAM chip — the seat's side, drawn in TEAMS on every non-closed seat and
   * composed to the LEFT of the difficulty chip (n2), so it adds to the slot editor
   * rather than replacing it. FFA is teams-of-one, so it is hidden there. Returns
   * whether it was drawn.
   *
   * It carries the WORD — `FRIENDLY A` / `ENEMY B`, {@link LobbySeatView.teamName}
   * — not the `T1`–`T8` letter the handoff draws. That is the one place this screen
   * takes the design's *treatment* and keeps our own *wording*: the developer
   * played a teams match and could not tell who was on their side, and a lone `A`
   * on a roster chip is a legend nobody was given (m10, refined by u3). The
   * in-match nameplates say the identical string for this seat and this viewer
   * (`./nameplates`), so the lobby teaches the battlefield's vocabulary before
   * RUSH!.
   *
   * The chip's word takes the side colour ({@link SIDE_COLORS}) — the one hue this
   * Bone screen spends, because it is a ratified mechanic rather than chrome —
   * as reinforcement for the word, never a replacement for it, so the row still
   * reads with the hue removed.
   *
   * **On a narrow row the chip STACKS the word over the letter rather than
   * shrinking it.** `WORD + LETTER` is the ratified grammar (GDD §2.1) and both
   * halves do different jobs — the word is relative to the viewer, the letter is
   * absolute — so both have to survive; what does not have to survive is their
   * being on one line. A 233px landscape-phone row can spare ~70px for this chip,
   * which holds `FRIENDLY A` at 8px on one line or `FRIENDLY` over `A` at full
   * size on two, and the row is 48px tall with nothing else in it. The string is
   * still `teamName`'s, character for character; only the line break is the
   * view's. Below that the word is auto-fitted down, never up — a word drawn
   * wider than its own chip reads as a bug.
   */
  private drawTeamChip(
    nodes: SeatNodes,
    seat: LobbySeatView,
    chip: Rect,
    teams: boolean,
    closed: boolean,
    m: FrameMetrics,
  ): boolean {
    const visible = teams && !closed && chip.width > 0 && chip.height > SEAT_CONTROL_MIN_HEIGHT;
    nodes.teamChipLabel.visible = visible;
    if (!visible) return false;

    drawPlate(nodes.body, chip.x, chip.y, chip.width, chip.height, 'secondary', 'chip');
    const px = plateTypeSize(ROW_LABEL_PX, m);
    const room = chip.width - 2 * TEAM_CHIP_LABEL_PAD;
    nodes.teamChipLabel.text = seat.teamName;
    nodes.teamChipLabel.style.fontSize = px;
    nodes.teamChipLabel.style.letterSpacing = trackingPx(TRACKING.label, px);
    nodes.teamChipLabel.style.fill = SIDE_COLORS[seat.side];
    nodes.teamChipLabel.style.align = 'center';
    nodes.teamChipLabel.scale.set(1);
    // The word over the letter, on EVERY row and every device — not "one line
    // where it fits". A chip that wraps `FRIENDLY A` and does not wrap `ENEMY B`
    // reads as two different controls down one roster, and the row that decides
    // is the phone's, so the desktop would be the odd one out for no gain. The
    // string is `teamName`'s, character for character; only the line break is the
    // view's, and stacking is what lets both halves stay at full type size in the
    // ~62px a landscape-phone row can spare (`lobby-geometry` SEAT_ROW_BODY_MIN).
    // A row too short for two lines falls back to one.
    nodes.teamChipLabel.text = seat.teamName.replace(' ', '\n');
    if (nodes.teamChipLabel.height > chip.height - 4) nodes.teamChipLabel.text = seat.teamName;
    fitLabel(nodes.teamChipLabel, room);
    nodes.teamChipLabel.x = chip.x + chip.width / 2;
    nodes.teamChipLabel.y = chip.y + chip.height / 2;
    return true;
  }

  private seatSlot(index: number): SeatNodes {
    const existing = this.seatNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const stateLabel = makeText('', FONT_HEADING, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    stateLabel.anchor.set(0.5, 0.5);
    const decal = makeText('', FONT_BODY, DECAL_PX, MATERIAL_SHADES.bone, 'bold');
    decal.anchor.set(0, 0.5);
    const name = makeText('', FONT_HEADING, NAME_PX, MATERIAL_SHADES.bone);
    name.anchor.set(0, 0.5);
    const detail = makeText('', FONT_BODY, DETAIL_PX, MATERIAL_SHADES.boneLo);
    detail.anchor.set(0, 0.5);
    const chipLabel = makeText('', FONT_HEADING, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    chipLabel.anchor.set(0.5, 0.5);
    const teamChipLabel = makeText('', FONT_HEADING, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    teamChipLabel.anchor.set(0.5, 0.5);
    const helpLabel = makeText('', FONT_HEADING, ROW_LABEL_PX, MATERIAL_SHADES.bone);
    helpLabel.anchor.set(0.5, 0.5);
    // Numerals face, like every other number on this screen; the colour is set
    // per-frame from the grade.
    const ping = makeText('', FONT_BODY, DETAIL_PX, PING_GRADE_COLORS.good);
    ping.anchor.set(0, 0.5);

    this.addChild(body, stateLabel, decal, name, detail, chipLabel, teamChipLabel, helpLabel, ping);
    const nodes: SeatNodes = {
      body,
      stateLabel,
      decal,
      name,
      detail,
      chipLabel,
      teamChipLabel,
      helpLabel,
      ping,
    };
    this.seatNodes[index] = nodes;
    return nodes;
  }

  // --- The MODE / ORE strip (variable-slots Milestone E) --------------------

  /**
   * The two match-config toggles at the top of the roster: MODE (FFA / TEAMS) and
   * ORE (SCARCE / STANDARD / RICH). Both are the host's, and both lock with the
   * hull at RUSH! ({@link LobbyModel.classLocked}); a guest or a locked lobby
   * draws them as `inert` surfaces rather than as pressable chips, because the
   * value is real but not this client's to change — the same honesty rule the
   * seat-state control keeps.
   */
  private drawControls(model: LobbyModel, m: FrameMetrics): void {
    const enabled = model.hostControls && !model.classLocked;
    this.toggles.clear();
    this.drawToggle(this.modeText, this.layout.modeToggle, `MODE · ${MODE_LABELS[model.mode]}`, enabled, m);
    this.drawToggle(
      this.abundanceText,
      this.layout.abundance,
      `YIELD · ${ABUNDANCE_LABELS[model.abundance]}`,
      enabled,
      m,
    );
  }

  /** One toggle chip: the frame's own chip plate, and a centred label. */
  private drawToggle(
    label: Text,
    rect: Rect,
    text: string,
    enabled: boolean,
    m: FrameMetrics,
  ): void {
    const visible = rect.width > 0 && rect.height > 0;
    label.visible = visible;
    if (!visible) return;
    drawDeadOrLive(this.toggles, rect, enabled);
    const px = plateTypeSize(TOGGLE_PX, m);
    label.text = text;
    label.style.fontSize = px;
    label.style.letterSpacing = trackingPx(TRACKING.label, px);
    label.style.fill = enabled ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    label.alpha = enabled ? 1 : 0.75;
    fitLabel(label, rect.width - 2 * STATE_LABEL_PAD);
    label.x = rect.x + rect.width / 2;
    label.y = rect.y + rect.height / 2;
  }

  // --- Hull tiles (ship select) --------------------------------------------

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
   * **Selection is a raised plate, not a hue.** The picked hull is `secondary`
   * (the material every actionable control on this screen wears) and the other
   * three are `inert` — which is the handoff's own example of that role, *"a
   * settings row, an unselected ship"*. It is deliberately NOT `primary`: RUSH!
   * is this screen's one bright plate, and a second would destroy the only
   * mechanism Bone has for saying "this is the action".
   */
  private drawClassTile(
    nodes: ClassNodes,
    option: ShipClassOption,
    rect: Rect,
    model: LobbyModel,
    m: FrameMetrics,
  ): void {
    const selected = option.shipClass === model.shipClass;
    const dim = model.classLocked && !selected;
    const content = classTileContent(rect);

    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.name.visible = false;
      nodes.hull.visible = false;
      nodes.blurb.visible = false;
      nodes.pips.visible = false;
      for (const cell of nodes.stats) cell.visible = false;
      return;
    }
    // No accent tick: a tile's content is a GRID that starts at its own 3px
    // padding, and the tick would land in the middle of the stat cells.
    drawPlate(
      nodes.body,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      selected ? 'secondary' : 'inert',
      'compact',
      'rest',
      false,
    );

    const alpha = dim ? 0.45 : 1;
    const namePx = plateTypeSize(TILE_NAME_PX, m);
    nodes.name.visible = true;
    nodes.name.text = option.name;
    nodes.name.style.fontSize = namePx;
    nodes.name.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, namePx);
    nodes.name.style.fill = selected ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.name.alpha = alpha;
    nodes.name.x = content.name.x;
    nodes.name.y = content.name.y;

    // The hull nickname (Quadfin…). Flavour the codex also carries, so it is the
    // block that gives way *before* the stats on the tightest tile.
    const hullPx = plateTypeSize(TILE_HULL_PX, m);
    nodes.hull.text = option.hull;
    nodes.hull.style.fontSize = hullPx;
    nodes.hull.style.letterSpacing = trackingPx(TRACKING.label, hullPx);
    nodes.hull.alpha = alpha;
    nodes.hull.x = content.hull.x;
    nodes.hull.y = content.hull.y;
    nodes.hull.visible = content.showHull;

    this.drawClassStats(nodes, option, content, selected, alpha, m);

    // The role blurb (GDD §2.11). Hidden on a tile too short to hold it rather
    // than clipped — a half-sentence reads worse than none.
    const blurbPx = plateTypeSize(TILE_BLURB_PX, m);
    nodes.blurb.text = option.blurb;
    nodes.blurb.style.fontSize = blurbPx;
    nodes.blurb.alpha = alpha;
    nodes.blurb.style.wordWrapWidth = Math.max(20, content.blurb.width);
    nodes.blurb.x = content.blurb.x;
    nodes.blurb.y = content.blurb.y;
    // The layout reserves the blurb's band; how many WRAPPED lines the sentence
    // actually takes at this width is a measurement only Pixi can make, so the
    // final say is here — an overrunning blurb is dropped whole rather than run
    // out of the bottom of its own tile.
    nodes.blurb.visible = content.showBlurb && nodes.blurb.height <= content.blurb.height;
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
    m: FrameMetrics,
  ): void {
    nodes.pips.clear();
    nodes.pips.alpha = alpha;
    nodes.pips.visible = content.showStats;
    // NOT `plateTypeSize`: that floors type at TYPE_MIN (11px), which is the right
    // floor for a control's word and the wrong one for a six-cell grid — an 11px
    // figure overflows the 10px text line `classStatCell` reserves and the pip bar
    // is drawn straight through it. The grid has its own floor, and 8px is the
    // size this block has been legible at since u4.
    const px = Math.max(STAT_MIN_PX, Math.round(STAT_PX * m.plateScale));

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
      cell.style.fontSize = px;
      cell.style.fill = selected ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
      cell.alpha = alpha;
      cell.x = box.x;
      cell.y = box.y;

      // The bar under the figure. Filled pips are the brightest metal on the
      // picked hull and one ramp step down on the others; the unfilled remainder
      // is the shaded end of the same ramp. No hue is spent on a stat readout —
      // the same treatment the settings screen's volume pips take.
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
            alpha: 1,
          });
      }
    }
  }

  private classSlot(index: number): ClassNodes {
    const existing = this.classNodes[index];
    if (existing) return existing;

    const body = new Graphics();
    const name = makeText('', FONT_HEADING, TILE_NAME_PX, MATERIAL_SHADES.bone);
    const hull = makeText('', FONT_BODY, TILE_HULL_PX, MATERIAL_SHADES.boneLo);
    const blurb = makeText('', FONT_BODY, TILE_BLURB_PX, MATERIAL_SHADES.boneLo);
    blurb.style.wordWrap = true;
    const pips = new Graphics();
    // One label+figure per stat. `letterSpacing: 0` (rather than the row's usual
    // tracking) is what buys `SPD 130%` its room in a 46px cell on a phone.
    const stats: Text[] = [];
    for (let i = 0; i < STAT_COUNT; i++) {
      const cell = makeText('', FONT_BODY, STAT_PX, MATERIAL_SHADES.boneLo);
      cell.style.letterSpacing = 0;
      stats.push(cell);
    }

    this.addChild(body, name, hull, blurb, pips, ...stats);
    const nodes: ClassNodes = { body, name, hull, blurb, pips, stats };
    this.classNodes[index] = nodes;
    return nodes;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The plate roles this screen draws, in one list, so `./gantry` `singlePrimary`
 * can be asserted against the screen rather than against a comment: RUSH! is the
 * one `primary`, BACK and the selected hull are `secondary`, everything else is a
 * surface. Chips are excluded by construction (`countPrimaries` takes plates).
 */
export function lobbyPlateRoles(model: LobbyModel): PlateRole[] {
  const roles: PlateRole[] = ['primary', 'secondary'];
  for (const option of model.classOptions) {
    roles.push(option.shipClass === model.shipClass ? 'secondary' : 'inert');
  }
  for (let i = 0; i < model.seats.length; i++) roles.push('inert');
  return roles;
}

/** The RUSH! hint the host reads: the FFA head count, or the TEAMS per-side tally
 *  (`A 2 · B 2`), which is always shown so an uneven split is visible and never
 *  blocked (ratified). */
function hintText(model: LobbyModel): string {
  // WHY the button is dead comes first (a0-11; GDD §2.1 *amended 2026-08-07*:
  // "RUSH! is refused, with a reason on screen, below two participants"). Before
  // a0-11 the host's RUSH! could only be refused by something they had just done
  // — closing the seventh seat, putting everyone on one side — so the head count
  // beside it was explanation enough. It is not any more: a fresh room is one
  // person in seven empty chairs, and `1 PLAYING · 0 BOTS` states that without
  // saying it is the problem, or which of the two ways out to take.
  //
  // It replaces the tally rather than sitting beside it because there is one
  // strip and the tally is the *count* the reason already contains.
  const refusal = model.startRefusal;
  if (refusal !== null) return refusal;
  if (model.mode === 'teams') {
    const sides = model.teamCounts.map((c) => `${c.label} ${c.count}`).join(' · ');
    return sides || `${model.size} PLAYERS`;
  }
  return `${model.humanCount} PLAYING · ${model.botCount} BOTS`;
}

/**
 * The cache signature for one frame — the model, minus the countdown's raw
 * seconds.
 *
 * The seconds are a float that moves every frame; the LABEL is what the screen
 * actually draws and it ticks once a second. Serialising the float would make the
 * cache re-rasterise the whole screen 60 times a second for five seconds, which
 * is strictly worse than not caching (./screen-cache).
 */
function signatureOf(model: LobbyModel): string {
  const { countdown, ...rest } = model;
  return JSON.stringify({ ...rest, countdown: { active: countdown.active, label: countdown.label } });
}

/**
 * A control that is either pressable or honestly dead.
 *
 * Live is the `secondary` CHIP — a bordered plate wearing the Bone hairline,
 * which is what every pressable thing on this screen wears. Dead is an `inert`
 * plate at `compact`, one full step DOWN the same ramp: `rulePlate` rather than
 * `boneLo`, which is a third the brightness.
 *
 * The pairing matters more than either half. A guest, a lobby past RUSH! and a
 * seat somebody is sitting in are all refusals the model already makes
 * (`./lobby` `cycleSeatState`, `hostControls`), and the rule this screen keeps is
 * that they must **look** unavailable rather than look live and then refuse — a
 * dead-looking button beats a lying one. `tests/mobile/slot-state.spec.ts`
 * measures exactly this, in pixels, on the two states in one frame.
 *
 * Note the deliberate divergence from the settings screen, which marks an
 * ENGAGED toggle with the brightest hairline (`inert`'s chip is `ruleLit`). There
 * a chip is always pressable and the hairline says which value is current; here a
 * chip may be dead, so the hairline has to say *that* first.
 */
function drawDeadOrLive(canvas: Graphics, rect: Rect, live: boolean): void {
  if (live) drawPlate(canvas, rect.x, rect.y, rect.width, rect.height, 'secondary', 'chip');
  else drawPlate(canvas, rect.x, rect.y, rect.width, rect.height, 'inert', 'compact', 'rest', false);
}

/**
 * Where a centred label sits on a plate that carries an accent tick.
 *
 * Not the plate's middle: the handoff hangs a label off the tick, and a small
 * plate centred on its own box draws the word straight onto the 3px bar (found on
 * u7-03's first BACK and RUSH! render). Centring in the space to the RIGHT of the
 * tick keeps the handoff's composition on a wide plate and stops the collision on
 * a narrow one.
 */
function plateLabelCentreX(rect: Rect, m: FrameMetrics): number {
  const lead = platePadX('compact', m) + PLATE_SCALES.compact.tickWidth;
  return rect.x + (rect.width + lead) / 2;
}

/** Scale a label DOWN to fit the control it is drawn in, never up — a word drawn
 *  wider than its own button reads as a bug. */
function fitLabel(label: Text, room: number): void {
  label.scale.set(1);
  const drawn = label.width;
  if (drawn > room && room > 0) label.scale.set(room / drawn);
}

function hideRow(nodes: SeatNodes): void {
  nodes.stateLabel.visible = false;
  nodes.decal.visible = false;
  nodes.name.visible = false;
  nodes.detail.visible = false;
  nodes.chipLabel.visible = false;
  nodes.teamChipLabel.visible = false;
  nodes.helpLabel.visible = false;
  nodes.ping.visible = false;
}

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
  return new Text({ text, style: { fontFamily, fontSize, fill, fontWeight, letterSpacing: 0 } });
}
