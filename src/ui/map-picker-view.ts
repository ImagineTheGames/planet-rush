/**
 * src/ui/map-picker-view.ts — the Pixi view for the map picker. OWNER: UI Engineer.
 *
 * The drawing half of {@link ./map-picker}. Every word lives in the model and
 * every rect in {@link ./map-picker} `mapPickerLayout`; this file turns them into
 * Graphics and Text and owns nothing but which child is which — the same shape as
 * {@link ./main-menu-view}.
 *
 * ---------------------------------------------------------------------------
 * GANTRY / BONE (u7-03)
 * ---------------------------------------------------------------------------
 * The arena row lives inside the lobby (p2 field rule — one pre-match room where
 * you pick your hull AND your arena), and the lobby is Gantry/Bone now. A card
 * drawn as a 1px hairline in the middle of a screen of machined plates is the
 * exact "five dialects of one direction" drift the handoff exists to fix, so a
 * card is a plate: `secondary` where it is the pick, `inert` where it is not —
 * the same pair the hull tiles beside it use, and never `primary`, because RUSH!
 * is the lobby's one bright plate.
 *
 * The frozen contract, where it could only be broken here (style-guide §1, §2):
 *  - Names in Audiowide (words), blurbs in Oxanium (body) — never crossed (§7).
 *  - Selection is a **raised plate**, not a hue: Bone spends no colour on a menu,
 *    which is what leaves the palette's hues free to mean things in a match. No
 *    **signal yellow** anywhere — a map card is neither ore nor danger, and the
 *    reserved rule is the one that carries the most weight (§2).
 *  - The mini preview keeps drawing each home station as a **patina** disc, the
 *    station's own body colour (§5), inside a steel arena frame. That one *is* a
 *    material read rather than chrome — it is a picture of the board — so it
 *    survives a direction that spends no colour on its controls.
 *
 * ---------------------------------------------------------------------------
 * a0-124 — THE CARD SHOWS THE BOARD
 * ---------------------------------------------------------------------------
 * The preview was eight teal dots in a grey box. It is now a picture of the
 * arena: the map's own **sky** behind it, the **ore field** the match opens on,
 * and the berths — the developer's *"the ores, empty stations locations, the
 * nebulas and stars in the back… just more accurate overall"*.
 *
 * Two rules decide how it is drawn, and both are about not writing a second copy
 * of something:
 *
 *  1. **The sky is the backdrop's.** {@link ../art/backdrop} `nebulaTileSprite` —
 *     ground, two star layers and the map's own `MAP_NEBULA` sky, composited in
 *     the order the frame composites them — played into a `Graphics` with
 *     `drawSprite`. There is no starfield in this file and there must never be
 *     one: the bloom population in `backdrop.ts` is under active change (a0-123),
 *     and a preview with its own copy would be wrong the day that lands.
 *  2. **The board is the model's**, and the model builds it with `createWorld`
 *     ({@link ./map-picker} `mapPreview`). This file letterboxes and scales; it
 *     decides nothing about where a rock is.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SIMPLIFIES, AND WHY — 240×114, SIX AT ONCE
 * ---------------------------------------------------------------------------
 * A landscape-phone card is 240×114 and there are six of them on a screen the
 * player is deciding on. Detail that turns to mush there is worse than the honest
 * dots this replaced, so the picture spends its pixels on **proportion and
 * structure** and drops everything else:
 *
 *  - **Rocks are plain bodies** — a `rockBody` disc, no crack stage, no ore vein.
 *    A vein at this scale would be one yellow pixel, and one yellow pixel in a
 *    MENU is the RESERVED rule (§2) spent on nothing legible. The rock body is
 *    neutral steel-grey mineral, which is what §6 says a rock is.
 *  - **A rock never draws below {@link MIN_ROCK_RADIUS}**, so the field reads as a
 *    field. True scale on a phone card is a third of a pixel; the floor makes the
 *    lobes and the commons ring visible and costs the *relative* rock sizes, which
 *    were never the read.
 *  - **No ships, no turrets, no wall glow.** Nothing that is not the board.
 *  - The void fills the picture box **edge to edge** and the arena wall sits
 *    inside it, because that is what the arena actually is — a steel frame in a
 *    bigger dark. The old letterbox left two dead grey bands instead.
 *
 * The picture also takes the height the words do not: the caption band is
 * measured once across the whole row and every card gets the same one, so six
 * pictures stay identical in size while the tallest blurb still fits.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import { VOID_SEED, nebulaForMap, nebulaTileSprite } from '../art/backdrop';
import { DERIVED } from '../art/palette';
import { drawSprite } from '../art/textures';
import {
  BONE,
  MATERIAL_SHADES,
  TRACKING,
  DISPLAY_TRACKING,
  drawPlate,
  trackingPx,
} from '../art/materials';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { FONT_BODY, FONT_HEADING } from './typography';
import { MAP_PICKER_ID, mapPickerHitTest } from './map-picker';
import type { MapCardModel, MapPickerLayout, MapPickerModel, MapPreview } from './map-picker';

/** The picker sits in the vertical middle of the menu, between the wordmark and
 *  the buttons (`main.ts` reserves the band). */
export const MAP_PICKER_ANCHOR: AnchorSpec = { region: 'center' };

/** Card inner padding. */
const CARD_PAD = 8;
/** Air between the picture and the name under it. */
const NAME_GAP = 6;
/** Air between the name and the blurb. */
const BLURB_GAP = 4;
/** Below this card height the blurb is dropped rather than clipped — the same
 *  "protect the read, drop the detail" rule the lobby tiles keep. */
const BLURB_MIN_CARD_HEIGHT = 116;
/**
 * The share of a card the picture keeps whatever the words want.
 *
 * The caption band is measured, not assumed (see {@link MapPickerView.captionBand}),
 * which is what lets the picture take the height a dropped blurb frees on a phone.
 * The floor is the other half of that deal: a registry blurb long enough to squeeze
 * the board drops the blurb instead, because this screen exists to show the board.
 * At the shipped copy nothing reaches it — it is a guard on a future map's prose.
 */
const MIN_PICTURE_FRACTION = 0.42;
/**
 * A rock never draws below this radius, in px.
 *
 * True scale on a landscape-phone card is ≈0.4px — a rock that rounds away to
 * nothing, and a field of them is an empty box. The floor buys the field's SHAPE
 * (the eight home lobes, the commons ring) at the cost of the rocks' relative
 * sizes, which at this scale were never legible anyway.
 */
const MIN_ROCK_RADIUS = 1.1;
/** A berth never draws below this radius, in px — the same bargain as
 *  {@link MIN_ROCK_RADIUS}, one step up, so a berth still reads as the larger body
 *  it is (the sim makes a station a little over 2× a rock) on a phone card. */
const MIN_BERTH_RADIUS = 1.9;
/**
 * The void is authored over a field this many times the picture box and drawn back
 * down onto it.
 *
 * **1:1 was wrong and it is worth writing down why.** Star radii, bloom halos and
 * diffraction spikes are absolute pixel sizes: correct for a screenful, and in a
 * 174px window a bloom halo is 11% of the picture instead of 2% of a screen — the
 * card came out a handful of grey smudges rather than a starfield. Authoring big
 * and scaling down puts the sky back in proportion to the arena the card is
 * showing, and buys the star COUNT that proportion implies at the same time
 * (density is per unit area, so it scales with the field).
 */
const SKY_SCALE = 2.5;
/**
 * A Vacuum wash laid over the void before the board is drawn, and the one thing on
 * this card that is a legibility device rather than a rendering.
 *
 * A rock is a 30-unit body: on a screen it is 30-odd pixels and reads as an object
 * next to a 2px star. Squeezed into a 156px arena it is 2.5px — the same size as
 * the star, and dimmer (`rockBody` luma 77, a star's core white), so the ore field
 * disappeared INTO the sky it was drawn over. The wash pushes the void back a stop
 * so the board sits in front of it. It is stated here rather than tuned quietly
 * because it is the one place the card is not simply the frame's own art.
 */
const VOID_WASH_ALPHA = 0.32;
/**
 * How far the void reaches past the arena wall, as a fraction of the arena's short
 * side — and it is a **margin, not a field**.
 *
 * The developer asked for the sky *"in the back"*, and the difference matters where
 * a wide box holds a square board: the lobby's own arena card is 446×62, and a sky
 * filling that box put a postage-stamp arena in the middle of a starfield banner —
 * the least important element drawn largest. Sized off the arena instead, the void
 * is a surround that says which sky this map flies under and stops. Where the box
 * is tighter than the margin (every MAP SELECT card on a desktop) it is simply
 * clipped, so the big cards still fill edge to edge.
 */
const SKY_MARGIN = 0.09;

/** What the caption under every picture costs, measured across the whole row. */
interface CaptionBand {
  /** Height from the bottom of the picture to the bottom of the card's padding. */
  readonly height: number;
  /** Whether the blurb is drawn at all — one answer for the row, not per card. */
  readonly showBlurb: boolean;
}

interface CardNodes {
  readonly body: Graphics;
  /**
   * The board picture. Drawn in its OWN space (`0,0` at the box's top-left) and
   * moved as a whole, so a card sliding on a resize costs a transform rather than
   * a re-scatter of a starfield.
   */
  readonly picture: Container;
  /** The void: ground, stars and the map's sky ({@link ../art/backdrop}). */
  readonly sky: Graphics;
  /** The arena wall, the ore field and the berths. */
  readonly board: Graphics;
  /** Rect mask — nothing the void generators author may reach the plate. */
  readonly clip: Graphics;
  readonly name: Text;
  readonly blurb: Text;
  readonly veteran: Text;
  readonly veteranBg: Graphics;
  /** The map and box the picture currently holds; `''` = nothing drawn yet. */
  pictureKey: string;
  /** This card's own name height, measured in the caption pass. */
  nameHeight: number;
}

/**
 * The map picker overlay. Add once to the menu root, {@link setLayout} whenever the
 * reserved band changes (a resize), {@link update} each frame with a
 * {@link MapPickerModel}; hide it when the menu leaves the screen (settings, PLAY).
 */
export class MapPickerView extends Container {
  private readonly cardNodes: CardNodes[] = [];
  private layout: MapPickerLayout = { band: zeroRect(), cards: [], columns: 0, shape: 'row' };

  /** Adopt a freshly computed layout (the band the menu reserved, divided into
   *  card rects). The next {@link update} draws against it. */
  setLayout(layout: MapPickerLayout): void {
    this.layout = layout;
  }

  hitTest(x: number, y: number): number | null {
    return mapPickerHitTest(this.layout, x, y);
  }

  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || this.layout.band.width <= 0 || this.layout.band.height <= 0) return [];
    return [{ id: MAP_PICKER_ID, anchor: MAP_PICKER_ANCHOR, bounds: { ...this.layout.band } }];
  }

  update(model: MapPickerModel): void {
    if (!this.visible) return;
    // Two passes, and the first one is what keeps six pictures the same size: the
    // words are measured across the WHOLE row before any card is drawn, so The
    // Crescents' four-line blurb sets the caption band for all six rather than
    // giving five cards a taller board than the sixth.
    const caption = this.captionBand(model);
    for (let i = 0; i < this.layout.cards.length; i++) {
      const rect = this.layout.cards[i];
      const card = model.cards[i];
      if (!rect || !card) continue;
      this.drawCard(this.cardSlot(i), card, rect, caption);
    }
    // Any surplus slots from a previous, larger layout draw nothing.
    for (let i = this.layout.cards.length; i < this.cardNodes.length; i++) {
      this.hideCard(this.cardNodes[i]);
    }
  }

  /**
   * Measure the caption once for the row: the tallest name, the tallest blurb, and
   * whether the blurb survives at all.
   *
   * How many WRAPPED lines a sentence takes at a given width is a measurement only
   * Pixi can make, which is why this is here and not in the geometry — but it is a
   * measurement, not a decision: the name is set and scaled to fit here so
   * {@link drawCard} draws exactly what was measured.
   *
   * The blurb is dropped for the whole row on either of two counts — a card too
   * short to hold one ({@link BLURB_MIN_CARD_HEIGHT}, which is every landscape
   * phone), or a caption that would take the picture below
   * {@link MIN_PICTURE_FRACTION}. One answer for the row, because six cards where
   * some carry a sentence and some do not is a row that looks broken.
   */
  private captionBand(model: MapPickerModel): CaptionBand {
    let nameH = 0;
    let blurbH = 0;
    let showBlurb = true;
    let innerH = Infinity;

    for (let i = 0; i < this.layout.cards.length; i++) {
      const rect = this.layout.cards[i];
      const card = model.cards[i];
      if (!rect || !card || rect.width <= 0 || rect.height <= 0) continue;
      const nodes = this.cardSlot(i);
      const innerW = Math.max(0, rect.width - 2 * CARD_PAD);
      innerH = Math.min(innerH, Math.max(0, rect.height - 2 * CARD_PAD));
      if (rect.height < BLURB_MIN_CARD_HEIGHT) showBlurb = false;

      // Measured at scale 1, then scaled — so the number is the text's own height
      // whatever `Container.height` does with a transform. A long map name on a
      // narrow phone card is scaled DOWN to fit and never up.
      nodes.name.text = card.name;
      nodes.name.scale.set(1);
      const rawW = nodes.name.width;
      const rawH = nodes.name.height;
      const k = rawW > innerW && rawW > 0 ? innerW / rawW : 1;
      nodes.name.scale.set(k);
      nodes.nameHeight = rawH * k;
      nameH = Math.max(nameH, nodes.nameHeight);

      nodes.blurb.text = card.blurb;
      nodes.blurb.style.wordWrapWidth = innerW;
      blurbH = Math.max(blurbH, nodes.blurb.height);
    }

    if (!Number.isFinite(innerH)) return { height: 0, showBlurb: false };
    let height = NAME_GAP + nameH + (showBlurb ? BLURB_GAP + blurbH : 0);
    if (showBlurb && innerH - height < innerH * MIN_PICTURE_FRACTION) {
      showBlurb = false;
      height = NAME_GAP + nameH;
    }
    return { height: Math.min(height, innerH), showBlurb };
  }

  private drawCard(nodes: CardNodes, card: MapCardModel, rect: Rect, caption: CaptionBand): void {
    nodes.body.clear();
    if (rect.width <= 0 || rect.height <= 0) {
      this.hideCard(nodes);
      return;
    }
    // A card is a plate: raised where it is the pick, a surface where it is not.
    // No accent tick: a card's content is a PREVIEW box starting at its own 8px
    // padding, and the tick would land inside the picture.
    drawPlate(
      nodes.body,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      card.selected ? 'secondary' : 'inert',
      'compact',
      'rest',
      false,
    );
    nodes.name.style.fill = card.selected ? BONE.hi : MATERIAL_SHADES.bone;

    // --- The board, off the top of the card -----------------------------------
    // Everything the caption does not need. On a landscape phone the blurb is gone,
    // and the picture takes the height it freed rather than sitting at a fixed
    // fraction with dead card under it — which is where the accuracy this brief is
    // about actually gets its pixels (49px of arena before, ~72 after).
    const innerW = Math.max(0, rect.width - 2 * CARD_PAD);
    const innerH = Math.max(0, rect.height - 2 * CARD_PAD);
    const previewBox: Rect = {
      x: rect.x + CARD_PAD,
      y: rect.y + CARD_PAD,
      width: innerW,
      height: Math.max(0, innerH - caption.height),
    };
    this.drawPicture(nodes, card, previewBox);

    // --- Name, then blurb, down the caption band ------------------------------
    // The name's text and scale were set in the measuring pass; only its place is
    // decided here, so what is drawn is exactly what the band was sized for.
    const textX = rect.x + rect.width / 2;
    let cursorY = previewBox.y + previewBox.height + NAME_GAP;
    nodes.name.x = textX;
    nodes.name.y = cursorY;
    nodes.name.visible = true;
    cursorY += nodes.nameHeight + BLURB_GAP;

    nodes.blurb.visible = caption.showBlurb;
    if (caption.showBlurb) {
      nodes.blurb.x = textX;
      nodes.blurb.y = cursorY;
      // The band already reserved the tallest blurb in the row, so this is now a
      // belt-and-braces guard rather than the load-bearing one it was — kept
      // because "drop the detail, protect the read" is the ladder this directory
      // keeps and a future card size should fail by dropping, never by clipping.
      //
      // Found by looking (u10-01): on the desktop MAP SELECT baseline, The
      // Crescents' four-line blurb had its last word cut in half by the card's
      // lower edge while the five cards beside it fitted in three.
      nodes.blurb.visible = cursorY + nodes.blurb.height <= rect.y + rect.height - CARD_PAD;
    }

    // --- The VETERAN tag, a small pill in the top-right corner ----------------
    if (card.veteran) {
      nodes.veteran.visible = true;
      nodes.veteranBg.visible = true;
      const padX = 5;
      const padY = 2;
      const tw = nodes.veteran.width + 2 * padX;
      const th = nodes.veteran.height + 2 * padY;
      const tx = rect.x + rect.width - tw - CARD_PAD;
      const ty = rect.y + CARD_PAD;
      nodes.veteranBg.clear();
      drawPlate(nodes.veteranBg, tx, ty, tw, th, 'secondary', 'chip', 'rest', false);
      nodes.veteran.x = tx + padX;
      nodes.veteran.y = ty + padY;
    } else {
      nodes.veteran.visible = false;
      nodes.veteranBg.visible = false;
    }
  }

  /**
   * The board picture: the map's own void behind it, then the arena and what is in
   * it, letterboxed to the arena's aspect so a wide map reads wide and a square one
   * square.
   *
   * **Rebuilt only when the map or the box changes.** Everything in here is a pure
   * function of `(map id, box size)` — the sky is seeded, the field came off a
   * memoised world — so a frame that changes nothing rebuilds nothing. Six star
   * fields and six ore fields re-scattered per frame, on a screen a player is
   * waiting on, is the exact shape of the three dashboard regressions this month;
   * the picture is drawn in its own space and MOVED, so even a resize that only
   * slides the cards costs a transform.
   */
  private drawPicture(nodes: CardNodes, card: MapCardModel, box: Rect): void {
    nodes.picture.x = box.x;
    nodes.picture.y = box.y;
    nodes.picture.visible = box.width > 0 && box.height > 0;
    if (!nodes.picture.visible) return;

    const w = Math.round(box.width);
    const h = Math.round(box.height);
    const key = `${card.id}|${w}x${h}`;
    if (nodes.pictureKey === key) return;
    nodes.pictureKey = key;

    // The arena first — everything else is sized off it. Letterboxed to its own
    // aspect, so a wide map reads wide and a square one square.
    const arena = arenaRect(card.preview.aspect, w, h);
    // …then the window the void is drawn in: the arena plus {@link SKY_MARGIN},
    // clipped to the box.
    const margin = SKY_MARGIN * Math.min(arena.width, arena.height);
    const sky = centred(
      Math.min(w, Math.round(arena.width + 2 * margin)),
      Math.min(h, Math.round(arena.height + 2 * margin)),
      w,
      h,
    );

    // The mask, first: the void generators author over a field of their own and
    // the tile's ground fills a SQUARE of the window's longer side, so without this
    // a wide window would paint ground over the plate above and below it.
    nodes.clip.clear().rect(sky.x, sky.y, sky.width, sky.height).fill({ color: 0xffffff });

    // --- The void ------------------------------------------------------------
    // `nebulaTileSprite` is the whole stack in the order the frame composites it —
    // ground, two star layers, and the map's sky either behind them or (Coalsack)
    // in front of them. Called rather than reproduced: there is exactly one star
    // field in this codebase and it is `backdrop.ts`'s. `VOID_SEED` is the seed the
    // renderer's own `VoidBackdrop` runs on, so this is not merely the same sky —
    // it is the same STARS the match opens on.
    //
    // Authored over a {@link SKY_SCALE}× field and scaled back down — see there for
    // why 1:1 is the wrong reading of "the same stars".
    nodes.sky.clear();
    const skyW = Math.max(1, Math.round(sky.width * SKY_SCALE));
    const skyH = Math.max(1, Math.round(sky.height * SKY_SCALE));
    drawSprite(nodes.sky, nebulaTileSprite(nebulaForMap(card.id).id, VOID_SEED, skyW, skyH), 1 / SKY_SCALE);
    nodes.sky.x = sky.x + sky.width / 2;
    nodes.sky.y = sky.y + sky.height / 2;

    this.drawBoard(nodes.board, card.preview, arena, sky);
  }

  /**
   * The arena wall, the opening ore field and the berths, in the picture's own
   * space. `preview` is the model's, off a world `createWorld` built; `arena` and
   * `sky` are the rects {@link drawPicture} sized.
   */
  private drawBoard(g: Graphics, preview: MapPreview, arena: Rect, sky: Rect): void {
    g.clear();
    if (arena.width <= 0 || arena.height <= 0) return;
    const { x: drawX, y: drawY, width: drawW, height: drawH } = arena;

    // Push the void back a stop, so the board reads in front of it
    // ({@link VOID_WASH_ALPHA}).
    g.rect(sky.x, sky.y, sky.width, sky.height).fill({
      color: PALETTE.vacuum,
      alpha: VOID_WASH_ALPHA,
    });

    // The arena wall — steel, the "space with a steel frame" read (maps.ts), in the
    // tones the plates around it are cut from. A lit rule rather than a deep one:
    // it is now drawn over the void instead of over a grey fill, and it has to hold
    // the edge of the board against the stars outside it.
    g.rect(drawX, drawY, drawW, drawH).stroke({
      width: 1,
      color: MATERIAL_SHADES.ruleLit,
      alpha: 0.9,
    });

    // The ore field, under the berths so a rock never hides one. Neutral rock body
    // (§6) — the veins are the only yellow on an asteroid and there is no room for
    // one here, which is the right answer twice over: the RESERVED rule (§2) does
    // not spend signal yellow on a menu.
    for (const rock of preview.ore) {
      g.circle(
        drawX + rock.x * drawW,
        drawY + rock.y * drawH,
        Math.max(MIN_ROCK_RADIUS, rock.r * drawW),
      ).fill({ color: DERIVED.rockBody, alpha: 0.95 });
    }

    // Each berth: a patina disc, the station's own body colour (§5) — and NOT a
    // roster colour. Nobody owns these at pick time, and since a0-110 colour means
    // side on the minimap; a card that painted eight berths in eight player hues
    // would contradict the one screen that has just been taught to mean it.
    for (const berth of preview.stations) {
      g.circle(
        drawX + berth.x * drawW,
        drawY + berth.y * drawH,
        Math.max(MIN_BERTH_RADIUS, berth.r * drawW),
      ).fill({ color: PALETTE.patina, alpha: 0.95 });
    }
  }

  private hideCard(nodes: CardNodes | undefined): void {
    if (!nodes) return;
    nodes.body.clear();
    nodes.picture.visible = false;
    nodes.veteranBg.clear();
    nodes.name.visible = false;
    nodes.blurb.visible = false;
    nodes.veteran.visible = false;
    nodes.veteranBg.visible = false;
  }

  private cardSlot(index: number): CardNodes {
    const existing = this.cardNodes[index];
    if (existing) return existing;
    const body = new Graphics();
    // The picture: sky, then board, clipped to the box. Its own container so it can
    // be positioned rather than redrawn (see `drawPicture`), and so ONE mask covers
    // both layers.
    const picture = new Container();
    const sky = new Graphics();
    const board = new Graphics();
    const clip = new Graphics();
    picture.addChild(sky, board, clip);
    picture.mask = clip;
    const name = makeText('', FONT_HEADING, 15, MATERIAL_SHADES.bone);
    name.style.letterSpacing = trackingPx(DISPLAY_TRACKING.heading, 15);
    name.anchor.set(0.5, 0);
    const blurb = new Text({
      text: '',
      style: {
        fontFamily: FONT_BODY,
        fontSize: 11,
        fill: MATERIAL_SHADES.boneLo,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 120,
        lineHeight: 13,
      },
    });
    blurb.anchor.set(0.5, 0);
    const veteranBg = new Graphics();
    const veteran = makeText('VETERAN', FONT_BODY, 9, MATERIAL_SHADES.bone);
    veteran.style.letterSpacing = trackingPx(TRACKING.eyebrow, 9);
    veteran.anchor.set(0, 0);
    // Draw order: body, picture, text, then the tag on top.
    this.addChild(body, picture, name, blurb, veteranBg, veteran);
    const nodes: CardNodes = {
      body,
      picture,
      sky,
      board,
      clip,
      name,
      blurb,
      veteran,
      veteranBg,
      pictureKey: '',
      nameHeight: 0,
    };
    this.cardNodes[index] = nodes;
    return nodes;
  }
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0 } });
}

function zeroRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** The arena, letterboxed into a `w`×`h` box at its own aspect and centred: a wide
 *  map reads wide and a square one square, on every card size. */
function arenaRect(aspect: number, w: number, h: number): Rect {
  const a = aspect > 0 ? aspect : 1;
  let width = w;
  let height = width / a;
  if (height > h) {
    height = h;
    width = height * a;
  }
  return centred(width, height, w, h);
}

/** A `width`×`height` rect centred in a `w`×`h` box. */
function centred(width: number, height: number, w: number, h: number): Rect {
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
}
