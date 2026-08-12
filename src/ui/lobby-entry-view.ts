/**
 * src/ui/lobby-entry-view.ts — the Pixi view for the entry screen (THE DOORS).
 * OWNER: UI Engineer.
 *
 * The drawing half of {@link ./lobby-entry}. Every decision lives in the pure
 * model and every rect in {@link ./lobby-geometry} `entryLayout`; this file only
 * turns them into Graphics and Text, and owns the one thing neither has an
 * opinion about — which Pixi child is which.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-04; the direction ratified 2026-08-05, spec
 * `docs/design/gantry-bone-handoff.html`)
 * ---------------------------------------------------------------------------
 * The handoff named five screens — title, build wheel, lobby, ship select,
 * settings — and this one is not among them, which is how the first screen a
 * player touches after PLAY was still *"1px hairlines on black, which reads as a
 * wireframe rather than a product"* while the screen in front of it had been
 * re-skinned. It is now the same material as the title screen: a header beam
 * carrying the eyebrow cluster and the wordmark, a footer beam carrying BACK and
 * SETTINGS, and four door PLATES in the band between them. **None of that is drawn
 * here.** Every bevel, rivet, band and tone comes from {@link ../art/materials},
 * so this screen and the four already in the set speak one dialect.
 *
 * Three rules this file has to keep on its own:
 *
 *  1. **One primary, and it is SOLO.** Bone spends no colour, so the primary
 *     action is simply the biggest and brightest plate — which only works while
 *     there is exactly one ({@link ./gantry} `singlePrimary`, held by
 *     `lobby-entry.test.ts`). CAMPAIGN is a full-contrast `secondary` plate, never
 *     `inert`: `inert` is Gantry's word for a *surface*, and a teaser drawn as a
 *     surface is the greyed-out door u9-01 exists to prevent, wearing a bevel.
 *  2. **Bone spends no hue, so neither does this screen.** The plasma that used to
 *     fill SOLO, tint the caret and letter the `Coming Soon…` answer is gone;
 *     emphasis is brightness now. The ONE exception is unchanged and deliberate:
 *     a join that came back refused is the only genuinely wrong thing this screen
 *     can show, and it stays threat red (style-guide §2).
 *  3. **Signal yellow is RESERVED for ore** (§2). There is no ore on this screen,
 *     so there is no yellow on it — and under Bone, no hue at all.
 *
 * Typography (§7): Audiowide for the wordmark and every plate label; Oxanium for
 * the eyebrow cluster, the sub-lines, the message slot, the code and the keys —
 * the code is a string of characters to be read one at a time, which is exactly
 * what the body face is for. Every control is a plain tap (GDD §2.4): nothing here
 * is a drag, a long-press or a gesture.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  BONE,
  DISPLAY_TRACKING,
  MATERIAL_SHADES,
  PLATE_SCALES,
  TRACKING,
  drawBeam,
  drawPlate,
  plateFamily,
  plateMaterial,
  platePadX,
  plateTypeSize,
  trackingPx,
  typeSize,
} from '../art/materials';
import type { FrameMetrics, PlateState } from '../art/materials';
import { PALETTE } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { entryPlateState } from './lobby-entry';
import type { EntryCodeCell, EntryDoorView, EntryModel, EntrySegmentView } from './lobby-entry';
import { LobbyBrowserView } from './lobby-browser-view';
import type { BrowseModel } from './lobby-browser';
import { entryHitTest, entryLayout } from './lobby-geometry';
import type { EntryLayout, EntryTarget, Insets } from './lobby-geometry';
import { ScreenCache } from './screen-cache';
import { FONT_BODY, FONT_HEADING } from './typography';

// ---------------------------------------------------------------------------
// Reference type sizes — the handoff's own, at its 1280×720 reference
// ---------------------------------------------------------------------------

/** The wordmark, in the header beam. The title screen's 46px. */
const WORDMARK_PX = 46;
/** The beam's two eyebrow lines. */
const EYEBROW_PX = 12;
/** A primary door's label (27px) and a secondary's (21px), per the handoff. */
const LABEL_PX = { primary: 27, secondary: 21 } as const;
/** The sub-line under a door's label — its hint, now inside the plate. */
const SUB_PX = 13;
/** The footer plates' labels: BACK, SETTINGS, ERASE, JOIN. */
const FOOTER_PX = 18;
/** The mode switch's two words (u17-01), at the codex tab chip's own size — this
 *  is the same control doing the same job, so it is drawn at the same size. */
const SEGMENT_PX = 15;

/** The standing line under the beam: a tagline, a prompt, an error. */
const MESSAGE_SIZE = 13;
/**
 * The same slot carrying a live connect narration or a NOTICE — the connecting
 * screen's real title, so it is read at a glance from across a classroom rather
 * than squinted at. Kept in the body face: it spells out machine ids and room
 * codes, which is exactly what a body face is for, and it fits a phone's width
 * where Audiowide at this size would not.
 */
const NARRATION_SIZE = 17;

/** Gap between the accent tick and the label block inside a plate (handoff 24). */
const TICK_GAP = 24;
/** Vertical gap between a plate's label and its sub-line (handoff 3). */
const LABEL_GAP = 3;
/** Vertical gap between the beam's two eyebrow lines (handoff 4). */
const EYEBROW_GAP = 4;

/** The entry screen's layout-registry id and anchor: it owns the screen. */
export const ENTRY_ID = 'lobby-entry';
export const ENTRY_ANCHOR: AnchorSpec = { region: 'full' };

interface DoorNodes {
  readonly body: Graphics;
  readonly label: Text;
  readonly sub: Text;
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

interface SegmentNodes {
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
  private readonly beams = new Graphics();
  private readonly wordmark: Text;
  private readonly eyebrow: Text;
  private readonly status: Text;
  private readonly message: Text;
  private readonly doorNodes: DoorNodes[] = [];
  private readonly segmentNodes: SegmentNodes[] = [];
  private readonly cellNodes: CellNodes[] = [];
  private readonly keyNodes: KeyNodes[] = [];
  private readonly back: ButtonNodes;
  private readonly erase: ButtonNodes;
  private readonly submit: ButtonNodes;
  /** The home screen's own trailing footer control. */
  private readonly settings: ButtonNodes;
  /** The browse list — the JOIN screen's other half (u17-01). A child rather than
   *  a fourth pool of nodes here: it is a screen's worth of drawing with its own
   *  rules, and the beams, the switch and the footer above it are shared. */
  private readonly browser = new LobbyBrowserView();
  /** The doors are static between state changes — see ./screen-cache. */
  private readonly cache = new ScreenCache(this);

  private layout: EntryLayout;
  private screen: EntryModel['screen'] = 'home';
  /** Which half of the join screen was last drawn — the hit test takes the same
   *  one, so a tap can never land on a control the other mode is covering. */
  private mode: EntryModel['mode'] = 'browse';

  constructor(screenWidth: number, screenHeight: number, isTouch = false, insets?: Insets) {
    super();
    this.layout = entryLayout({ width: screenWidth, height: screenHeight }, opts(isTouch, insets));

    this.wordmark = makeText('PLANET RUSH', FONT_HEADING, WORDMARK_PX, MATERIAL_SHADES.bone);
    this.wordmark.anchor.set(0.5, 0.5);
    this.eyebrow = makeText('', FONT_BODY, EYEBROW_PX, BONE.lo);
    this.eyebrow.anchor.set(0, 1);
    this.status = makeText('', FONT_BODY, EYEBROW_PX, MATERIAL_SHADES.boneLo);
    this.status.anchor.set(0, 0);
    this.message = makeText('', FONT_BODY, MESSAGE_SIZE, MATERIAL_SHADES.boneLo);
    this.message.anchor.set(0.5, 0);
    // A safety net, not a layout: every line this slot carries fits one row on the
    // narrowest supported phone. It exists so a refusal token nobody anticipated
    // wraps inside the content box instead of running off both edges.
    this.message.style.wordWrap = true;
    this.message.style.align = 'center';

    this.addChild(this.backdrop, this.beams, this.wordmark, this.eyebrow, this.status, this.message);

    // Built in the order they are drawn, so the footer plates sit over the pad
    // rather than under it if a very short screen ever brings them together.
    this.back = this.makeButton('BACK');
    this.erase = this.makeButton('⌫ ERASE');
    this.submit = this.makeButton('JOIN');
    this.settings = this.makeButton('SETTINGS');
    // Last, so the list draws over the pad's rects rather than under them if a
    // very short screen ever brings the two modes' bands together.
    this.addChild(this.browser);
  }

  /** Re-lay-out for a new viewport, device or safe area. */
  resize(width: number, height: number, isTouch = this.layout.isTouch, insets?: Insets): void {
    this.layout = entryLayout({ width, height }, opts(isTouch, insets));
    // The cached texture is the size the OLD viewport rasterised to; refreshing
    // it in place would blit a stale-sized screen, so drop it (./screen-cache).
    this.cache.invalidate();
  }

  /**
   * The rects this frame was drawn at, tested against the screen it was drawn
   * for — so a tap can never hit a door that the keypad is currently covering.
   */
  hitTest(x: number, y: number): EntryTarget | null {
    return entryHitTest(this.layout, x, y, this.screen, this.mode);
  }

  /** The layout-registry seam (`LayoutContributor`), same as `./lobby-view`. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible) return [];
    return [{ id: ENTRY_ID, anchor: ENTRY_ANCHOR, bounds: { ...this.layout.content } }];
  }

  /**
   * Draw one frame.
   *
   * `browse` is the list's own model (`./lobby-browser` `browseModel`) and is
   * required whenever the BROWSE segment is up — the caller owns the clock and the
   * poll, so it owns the model built from them. Absent, the list draws nothing,
   * which is what the doors screen and the keypad want.
   */
  update(model: EntryModel, browse: BrowseModel | null = null): void {
    this.screen = model.screen;
    this.mode = model.mode;
    if (!this.visible) return;
    // This screen is called per FRAME (src/main.ts `render`), and under Gantry it
    // is now four door plates plus two beam plates plus two beams — around 350
    // large translucent polygons, painted at `resolution: devicePixelRatio`. That
    // is a per-frame cost the hairline version did not have, and on a software
    // rasteriser it pegs the page's main thread. Redraw only when the model
    // actually changed; blit the rest of the time (./screen-cache).
    // The list ticks its own age stamp once a second and its rows change under a
    // poll, so it is part of the signature — a cached blit of a stale stamp would
    // be this screen telling the exact lie it exists to prevent.
    const signature = JSON.stringify([model, browse]);
    if (this.cache.unchanged(signature)) return;

    const { header, footer, metrics } = this.layout;

    // Opaque backdrop over the whole viewport — the doors own the screen. Drawn
    // from the beams outward so the beams' own translucent fill has the void to
    // sit on, exactly as the handoff composites them.
    this.backdrop.clear();
    this.backdrop
      .rect(0, 0, header.x * 2 + header.width, footer.y + footer.height + header.y)
      .fill({ color: PALETTE.vacuum, alpha: 1 });

    // The beams paint the height the FRAME reserved, not a flat 92 (see
    // `../art/materials` drawBeam) — this screen's band is the tightest of the set
    // on a phone and cannot afford a beam that overshoots it.
    this.beams.clear();
    if (header.height > 0) drawBeam(this.beams, header.x, header.y, header.width, 'header', true, header.height);
    if (footer.height > 0) drawBeam(this.beams, footer.x, footer.y, footer.width, 'footer', true, footer.height);

    this.drawHeader(model, metrics);
    this.drawMessage(model, metrics);

    const home = model.screen === 'home';
    // The join screen's two modes. The switch is drawn on BOTH — it is how you get
    // from either to the other — and everything below it belongs to one of them.
    const browsing = !home && model.mode === 'browse';
    const typing = !home && !browsing;
    for (let i = 0; i < this.layout.segments.length; i++) {
      const segment = model.segments[i];
      const rect = this.layout.segments[i];
      if (!segment || !rect) continue;
      const nodes = this.segmentSlot(i);
      setVisible(!home, nodes.body, nodes.label);
      if (!home) this.drawSegment(nodes, segment, rect, entryPlateState(model, `segment:${i}`), metrics);
    }

    // …and the list itself, drawn by its own view over the rects the layout holds.
    this.browser.visible = browsing;
    if (browsing && browse) {
      this.browser.update(
        browse,
        {
          rows: this.layout.browseRows,
          joins: this.layout.browseJoins,
          stamp: this.layout.browseStamp,
          list: this.layout.browseList,
        },
        metrics,
        { hover: model.hover, press: model.press },
      );
    }

    for (let i = 0; i < this.layout.doors.length; i++) {
      const door = model.doors[i];
      const rect = this.layout.doors[i];
      if (!door || !rect) continue;
      const nodes = this.doorSlot(i);
      setVisible(home, nodes.body, nodes.label, nodes.sub);
      if (home) this.drawDoor(nodes, door, rect, metrics);
    }

    for (let i = 0; i < this.layout.cells.length; i++) {
      const cell = model.cells[i];
      const rect = this.layout.cells[i];
      if (!cell || !rect) continue;
      const nodes = this.cellSlot(i);
      setVisible(typing, nodes.body, nodes.char);
      if (typing) this.drawCell(nodes, cell, rect);
    }

    for (let i = 0; i < this.layout.keys.length; i++) {
      const key = model.keys[i];
      const rect = this.layout.keys[i];
      if (key === undefined || !rect) continue;
      const nodes = this.keySlot(i);
      setVisible(typing, nodes.body, nodes.label);
      if (typing) {
        this.drawKey(nodes, key, rect, model.connecting ? 'rest' : entryPlateState(model, `key:${i}`));
      }
    }

    // BACK is on BOTH screens — the exit every screen must carry (u2 menu-back):
    // on the keypad it steps back to the doors, on the home screen it leaves to
    // the main menu. A `secondary` plate, bolted to the leading end of the footer
    // beam so it never moves as the screen changes under it.
    setVisible(true, this.back.body, this.back.label);
    this.drawFooterPlate(this.back, this.layout.back, model, 'back', false, !model.connecting, metrics);

    for (const [nodes, rect, key, primary, enabled] of [
      [this.erase, this.layout.erase, 'erase', false, model.canErase],
      // JOIN is the keypad screen's one affirmative action — its single bright
      // plate, exactly as SOLO is the doors screen's. The two never share a
      // screen, so the one-primary rule holds in both states.
      [this.submit, this.layout.submit, 'submit', true, model.canSubmit],
    ] as const) {
      // ERASE and JOIN belong to the keypad, not to the list: a browse screen has
      // nothing typed to erase and nothing typed to submit, and a control drawn
      // where nothing can answer it is the affordance bug this suite exists for.
      setVisible(typing, nodes.body, nodes.label);
      if (typing) this.drawFooterPlate(nodes, rect, model, key, primary, enabled, metrics);
    }

    // SETTINGS shares the beam's trailing end with JOIN, on the home screen only.
    // `secondary`, never primary: SOLO is this screen's affirmative action.
    setVisible(home, this.settings.body, this.settings.label);
    if (home) {
      this.drawFooterPlate(this.settings, this.layout.settings, model, 'settings', false, !model.connecting, metrics);
    }

    // Everything above is now on the display list; rasterise it once so the frames
    // between state changes cost one blit rather than the whole plate set
    // (./screen-cache).
    this.cache.refresh(signature);
  }

  // --- The mode switch ------------------------------------------------------

  /**
   * One segment of BROWSE / ENTER ROOM CODE.
   *
   * A CHIP, and the active one is `primary` — the codex tab's exact construction
   * ({@link ./codex} `codexTabPlate`): *"a tab is a mode switch, not an action"*,
   * so it is marked by brightness at chip scale, which is a different size family
   * from the plates the one-primary rule counts ({@link ./gantry} `countPrimaries`
   * takes a screen's PLATES). The keypad's JOIN stays the join screen's single
   * bright PLATE, exactly as it was before this brief.
   */
  private drawSegment(
    nodes: SegmentNodes,
    segment: EntrySegmentView,
    rect: Rect,
    state: PlateState,
    m: FrameMetrics,
  ): void {
    nodes.body.clear();
    const drawable = rect.width > 0 && rect.height > 0;
    nodes.label.visible = drawable;
    if (!drawable) return;

    const role = segment.active ? 'primary' : 'secondary';
    const shown = segment.enabled ? state : 'rest';
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, role, 'chip', shown);
    nodes.body.alpha = segment.enabled ? 1 : 0.5;

    const px = plateTypeSize(SEGMENT_PX, m);
    nodes.label.text = segment.label;
    nodes.label.style.fontSize = px;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    nodes.label.style.fill = segment.active ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.alpha = segment.enabled ? 1 : 0.5;
    nodes.label.scale.set(1);
    // `ENTER ROOM CODE` is the longest word-pair on this screen and a phone's chip
    // is not a desktop's, so it shrinks to its chip rather than spilling past the
    // bezel — the codex tab's own answer to the same problem.
    const room = Math.max(0, rect.width - 2 * Math.max(6, Math.round(10 * m.plateScale)));
    if (nodes.label.width > room && nodes.label.width > 0) {
      nodes.label.scale.set(room / nodes.label.width);
    }
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2 + plateMaterial(role, shown, 'chip').offsetY;
  }

  private segmentSlot(index: number): SegmentNodes {
    const existing = this.segmentNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, SEGMENT_PX, MATERIAL_SHADES.bone);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: SegmentNodes = { body, label };
    this.segmentNodes[index] = nodes;
    return nodes;
  }

  // --- The header beam ------------------------------------------------------

  /**
   * The header beam's contents: the eyebrow cluster on the left, the wordmark
   * centred across the beam — the title screen's own construction, because this
   * screen is that screen's other half. The wordmark shrinks — never the cluster —
   * when the two would collide, because "which game is this" survives a smaller
   * wordmark and the cluster is already at the type floor.
   *
   * The wordmark still steps back while the keypad is up or a connect is
   * narrating: what the player needs then is the prompt, not the game's name
   * shouted at somebody mid-way through typing a code.
   */
  private drawHeader(model: EntryModel, m: FrameMetrics): void {
    const { title, eyebrow: eyebrowRect } = this.layout;
    const visible = this.layout.header.height > 0;
    this.wordmark.visible = visible;
    this.eyebrow.visible = visible;
    this.status.visible = visible;
    if (!visible) return;

    const eyebrowPx = typeSize(EYEBROW_PX, m);
    const gap = Math.max(2, Math.round(EYEBROW_GAP * m.scale));
    this.eyebrow.text = model.eyebrow;
    this.eyebrow.style.fontSize = eyebrowPx;
    this.eyebrow.style.letterSpacing = trackingPx(TRACKING.eyebrow, eyebrowPx);
    this.status.text = model.status;
    this.status.style.fontSize = eyebrowPx;
    this.status.style.letterSpacing = trackingPx(TRACKING.label, eyebrowPx);

    const midY = eyebrowRect.y + eyebrowRect.height / 2;
    this.eyebrow.x = eyebrowRect.x;
    this.eyebrow.y = midY - gap / 2;
    this.status.x = eyebrowRect.x;
    this.status.y = midY + gap / 2;

    const wordPx = typeSize(WORDMARK_PX, m);
    this.wordmark.style.fontSize = wordPx;
    this.wordmark.style.letterSpacing = trackingPx(DISPLAY_TRACKING.wordmark, wordPx);
    this.wordmark.scale.set(1);
    this.wordmark.x = title.x + title.width / 2;
    this.wordmark.y = midY;
    this.wordmark.alpha = model.screen === 'home' && !model.narrating ? 1 : 0.45;

    // Two ceilings, and the tighter wins: the beam's own strip, and whatever is
    // left after the eyebrow cluster claims its left-hand share on both sides of
    // centre (the wordmark is centred, so a collision on the left is a collision).
    const clusterW = Math.max(this.eyebrow.width, this.status.width);
    const centreRoom = Math.max(0, title.width - 2 * (clusterW + m.gutter));
    const maxWidth = Math.max(0, Math.min(title.width, centreRoom));
    if (this.wordmark.width > maxWidth && this.wordmark.width > 0) {
      this.wordmark.scale.set(maxWidth / this.wordmark.width);
    }
  }

  // --- The one line under the beam ------------------------------------------

  /**
   * The message slot: the tagline `MINE · DEFEND · ATTACK`, the keypad's prompt,
   * the CAMPAIGN teaser's `Coming Soon…`, a refusal, or whatever the connection is
   * actually doing — `ALLOCATING ROOM…` → `ROOM Q5RN · TICKET SIGNED` → `DIALING
   * MACHINE 0800d5b6…` → `JOINED · SEAT 2` (`EntryModel.narrating`, fed from
   * `src/net/connect-trace`).
   *
   * Under Bone the emphasis is BRIGHTNESS, not hue: the standing tagline is low
   * Bone, and a narration or a NOTICE is chalk-bright and a size larger. The one
   * survivor of the old palette is threat red for a genuine refusal — the only
   * thing on this screen that is actually wrong (style-guide §2). A notice takes
   * the narration's size as well as its brightness: it is an ANSWER to a press the
   * player just made a band lower down the screen, and a reply whispered at hint
   * size half a screen from the finger that asked is a reply nobody reads.
   */
  private drawMessage(model: EntryModel, m: FrameMetrics): void {
    const { message } = this.layout;
    const failed = model.error !== '';
    const noticed = !failed && model.notice !== '';
    const loud = model.narrating || noticed;

    this.message.text = failed ? model.error : noticed ? model.notice : model.prompt;
    this.message.style.fill = failed ? PALETTE.threatRed : loud ? BONE.hi : MATERIAL_SHADES.boneLo;
    const px = typeSize(loud ? NARRATION_SIZE : MESSAGE_SIZE, m);
    this.message.style.fontSize = px;
    this.message.style.letterSpacing = trackingPx(loud ? TRACKING.label : TRACKING.eyebrow, px);
    // A refusal names a token the server chose the length of, so the title wraps
    // inside the content box rather than running off both edges of a phone.
    this.message.style.wordWrapWidth = Math.max(1, message.width);
    this.message.x = message.x + message.width / 2;
    this.message.y = message.y + Math.max(0, (message.height - this.message.height) / 2);
    this.message.visible = this.message.text !== '' && message.height > 0;
  }

  // --- Doors ---------------------------------------------------------------

  /**
   * One door: the plate material from {@link ../art/materials} `drawPlate`, then
   * its word and the one line saying what it costs you, both hung off the plate's
   * accent tick — the handoff's own plate anatomy, identical to the title screen's.
   *
   * The offline door is the PRIMARY (it always works — GDD §4.8 risk 6) and is the
   * only bright plate on the screen. A COMING-SOON door (CAMPAIGN, u9-01) is
   * `secondary`, never primary and never `inert`: fully lit and fully pressable,
   * because pressing it is how the screen answers — while SOLO keeps the
   * brightness, so the teaser does not take the emphasis off the door that works.
   */
  private drawDoor(nodes: DoorNodes, door: EntryDoorView, rect: Rect, m: FrameMetrics): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.label.visible = false;
      nodes.sub.visible = false;
      return;
    }
    nodes.label.visible = true;
    nodes.sub.visible = true;

    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, door.role, door.scale, door.state);

    const padX = platePadX(door.scale, m);
    const tickW = PLATE_SCALES[door.scale].tickWidth;
    const textX = rect.x + padX + tickW + Math.max(8, Math.round(TICK_GAP * m.plateScale));
    // `drawPlate` sinks a pressed plate by its role's own offset; the text rides
    // the same number rather than a second copy of it.
    const sink = plateMaterial(door.role, door.state, plateFamily(door.scale)).offsetY;
    const midY = rect.y + rect.height / 2 + sink;

    const labelPx = plateTypeSize(door.primary ? LABEL_PX.primary : LABEL_PX.secondary, m);
    const subPx = plateTypeSize(SUB_PX, m);
    const gap = Math.max(2, Math.round(LABEL_GAP * m.plateScale));

    nodes.label.text = door.label;
    nodes.label.style.fontSize = labelPx;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, labelPx);
    nodes.label.style.fill = door.primary ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.alpha = door.enabled ? 1 : 0.45;
    nodes.label.x = textX;

    nodes.sub.text = door.hint;
    nodes.sub.style.fontSize = subPx;
    nodes.sub.style.letterSpacing = trackingPx(TRACKING.label, subPx);
    nodes.sub.style.fill = door.primary ? MATERIAL_SHADES.bone : MATERIAL_SHADES.boneLo;
    nodes.sub.alpha = door.enabled ? 1 : 0.45;
    nodes.sub.x = textX;
    // The sub-line wraps inside the plate rather than running out past its bevel:
    // a hint is a whole sentence and a phone's plate is not a desktop's.
    nodes.sub.style.wordWrap = true;
    nodes.sub.style.wordWrapWidth = Math.max(20, rect.x + rect.width - padX - textX);

    // The two lines share the plate's vertical centre: the label sits above it,
    // the sub-line below, so the block is centred however tall the plate is. A
    // plate too short for two lines drops the sub-line rather than overflowing its
    // own bevel — the label is the door's name and is never the thing cut.
    const block = nodes.label.height + gap + nodes.sub.height;
    const twoLines = block <= rect.height - 8;
    nodes.sub.visible = twoLines;
    if (twoLines) {
      nodes.label.y = midY - block / 2;
      nodes.sub.y = midY - block / 2 + nodes.label.height + gap;
    } else {
      nodes.label.y = midY - nodes.label.height / 2;
    }
  }

  private doorSlot(index: number): DoorNodes {
    const existing = this.doorNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_HEADING, LABEL_PX.secondary, MATERIAL_SHADES.bone);
    label.anchor.set(0, 0);
    const sub = makeText('', FONT_BODY, SUB_PX, MATERIAL_SHADES.boneLo);
    sub.anchor.set(0, 0);
    this.addChild(body, label, sub);
    const nodes: DoorNodes = { body, label, sub };
    this.doorNodes[index] = nodes;
    return nodes;
  }

  // --- The code, and the pad it is typed on --------------------------------

  /**
   * One code cell, as a chip-scale plate.
   *
   * A cell is a *surface a character sits on*, so it takes the `inert` chip — the
   * same material the settings screen's engaged value chip wears, and the
   * brightest hairline in the set, which is what makes the ACTIVE cell (the one
   * the next key lands in) read as the caret without spending a hue on it. A
   * filled cell is a plain `secondary` chip and an empty one is drawn dimmer
   * still, so the code reads as a row that is filling up left to right.
   */
  private drawCell(nodes: CellNodes, cell: EntryCodeCell, rect: Rect): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.char.visible = false;
      return;
    }
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, cell.active ? 'inert' : 'secondary', 'chip');
    nodes.body.alpha = cell.active || cell.filled ? 1 : 0.6;

    nodes.char.text = cell.char;
    nodes.char.style.fill = cell.filled ? BONE.hi : MATERIAL_SHADES.boneLo;
    nodes.char.style.fontSize = Math.max(10, Math.min(38, rect.height * 0.6));
    nodes.char.x = rect.x + rect.width / 2;
    nodes.char.y = rect.y + rect.height / 2;
    nodes.char.visible = cell.filled;
  }

  private cellSlot(index: number): CellNodes {
    const existing = this.cellNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const char = makeText('', FONT_BODY, 32, BONE.hi);
    char.anchor.set(0.5, 0.5);
    this.addChild(body, char);
    const nodes: CellNodes = { body, char };
    this.cellNodes[index] = nodes;
    return nodes;
  }

  /** One pad key: a `secondary` chip, the same metal every actionable chip in the
   *  set is made of. It presses and it hovers, like any other plate. */
  private drawKey(nodes: KeyNodes, key: string, rect: Rect, state: PlateState): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      nodes.label.visible = false;
      return;
    }
    nodes.label.visible = true;
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, 'secondary', 'chip', state);

    nodes.label.text = key;
    nodes.label.style.fontSize = Math.max(9, Math.min(18, rect.height * 0.45));
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2 + plateMaterial('secondary', state, 'chip').offsetY;
  }

  private keySlot(index: number): KeyNodes {
    const existing = this.keyNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    const label = makeText('', FONT_BODY, 14, MATERIAL_SHADES.bone);
    label.anchor.set(0.5, 0.5);
    this.addChild(body, label);
    const nodes: KeyNodes = { body, label };
    this.keyNodes[index] = nodes;
    return nodes;
  }

  // --- The footer beam's plates: BACK / SETTINGS / ERASE / JOIN --------------

  /**
   * One footer plate — a `compact` plate bolted into the beam, the shape the
   * settings screen's DONE already is.
   *
   * A disabled control (a JOIN with an incomplete code above it) keeps the same
   * material and loses its brightness rather than taking a colour: this screen has
   * no gray costume any more, because gray is a hue budget it no longer spends.
   * Its reason is the incomplete code sitting directly above it — the p4-03 rule
   * that a dim control always carries its reason.
   */
  private drawFooterPlate(
    nodes: ButtonNodes,
    rect: Rect,
    model: EntryModel,
    key: string,
    primary: boolean,
    enabled: boolean,
    m: FrameMetrics,
  ): void {
    nodes.body.clear();
    const visible = rect.width > 0 && rect.height > 0;
    nodes.label.visible = visible;
    if (!visible) return;

    const state = enabled ? entryPlateState(model, key) : 'rest';
    const role = primary && enabled ? 'primary' : 'secondary';
    drawPlate(nodes.body, rect.x, rect.y, rect.width, rect.height, role, 'compact', state);
    nodes.body.alpha = enabled ? 1 : 0.5;

    const px = plateTypeSize(FOOTER_PX, m);
    nodes.label.style.fontSize = px;
    nodes.label.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, px);
    nodes.label.style.fill = primary && enabled ? BONE.hi : MATERIAL_SHADES.bone;
    nodes.label.alpha = enabled ? 1 : 0.5;
    nodes.label.x = rect.x + rect.width / 2;
    nodes.label.y = rect.y + rect.height / 2 + plateMaterial(role, state, 'plate').offsetY;
  }

  private makeButton(text: string): ButtonNodes {
    const body = new Graphics();
    const label = makeText(text, FONT_HEADING, FOOTER_PX, MATERIAL_SHADES.bone);
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

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}
