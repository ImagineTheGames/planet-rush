/**
 * src/ui/nameplates-view.ts — the pooled Pixi layer that draws the name labels.
 * OWNER: UI Engineer (field request v0.2.1).
 *
 * The drawing half of {@link ./nameplates}. It takes the labels the pure model
 * decided and paints each as a small tinted {@link Text}, floating above its
 * entity in **screen space** (the model already projected world → screen), so the
 * labels are a fixed size regardless of camera zoom (field request rule 3) — the
 * same discipline as the over-ship health bars ({@link ./healthbar-view}).
 *
 * **The stack (field request rule 1, and the whole of rule 3 after a0-04).** A
 * ship's status marks read as one unit,
 * top to bottom: the **name + difficulty-tag** row on top, the **health bar +
 * "68/70" number** row below it (the number hangs off the bar's right edge, not
 * under it — field request v0.2.4, drawn by {@link ./healthbar-view}), and the
 * **ship** under that. So a ship label is floated clear of the health-bar cluster
 * — above the bar's own top, using the same bar geometry the bar layer draws with
 * ({@link ./healthbar} `HEALTHBAR_*`), so the name can *never* cover the bar
 * (rule 3); the number sits beside the bar and so stays out of this vertical stack
 * entirely. A station label sits above the station, clear of its HP pin / damage
 * ring, by the station's own screen radius plus a gap.
 *
 * That clearance is now the ONLY thing keeping the health bar's claim on the eye
 * during a brawl. Rule 3's other half — the label fading while its entity was
 * damaged or fighting — was withdrawn by the developer at a0-04 (*"they should
 * always be lit"*), so the geometry carries the intent alone. It is exported as
 * {@link nameplateClusterClearance} rather than kept private precisely so a unit
 * test can pin it without a GPU (nameplates.test.ts).
 *
 * **Pooling (GDD §4.3, risk 5).** Text objects are allocated once and reused: a
 * frame with N labels touches the first N pooled Texts (set text/tint/position —
 * a Text re-rasterises only when its *string* changes, which is rare in a stable
 * scene) and hides the rest. Colour is applied as a cheap GPU {@link Text.tint}
 * over a white glyph, so re-tinting a slot to a new owner costs no re-raster.
 *
 * **Registered under `full`.** Labels appear wherever their entities are, so like
 * the health bars and the alarm's edge arrow they claim the whole viewport as
 * their zone ([[layout-registry]]). A label whose rect would leave the viewport is
 * culled this frame; the registered bounds are the union of what actually drew, so
 * it always sits inside `full`.
 *
 * Typography: **Oxanium** (style-guide §5.6 — the HUD body face, "designed for
 * game interfaces, holds up at 12px"), the legibility pick over the wider display
 * Audiowide for a compact name floating over a 24px ship. Never signal yellow /
 * threat red — those are RESERVED (style-guide §2); the tint is the player's
 * identity colour, which the model already resolved.
 */

import { Container, Text } from 'pixi.js';
import type { PlayerId } from '@shared/types';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import { HEALTHBAR_GAP, HEALTHBAR_HEIGHT, HEALTHBAR_LOCAL_HEIGHT } from './healthbar';
import type { Nameplate, NameplateKind } from './nameplates';
import { hudTracking } from './instrument';
import { FONT_BODY } from './typography';

/** Layout-registry id for the nameplate layer (one entry, the union of labels). */
export const NAMEPLATE_ID = 'nameplates';
/** Labels float over the world anywhere on screen — `full`, like the health bars. */
export const NAMEPLATE_ANCHOR: AnchorSpec = { region: 'full' };

/** Oxanium — the HUD body face (style-guide §5.6/§7), read from ./typography so
 *  a name over a hull is drawn in the same stack as everything else. Spelling the
 *  stack out here again is the drift that module exists to prevent (a1-01). */
const FONT_NAME = FONT_BODY;
/** Label size, CSS px — small chrome over the world, legible at thumb-scale. */
const FONT_SIZE = 12;
/** A name IS a proper noun, so it takes the ratified `name` tier — and so do the
 *  two tags that trail it, because they are read as part of the same row. This
 *  replaces the flat `letterSpacing: 0.5` all three pools used to spell, which is
 *  one of the six drifted values the Gantry handoff set out to retire. */
const NAME_TRACKING = hudTracking('name', FONT_SIZE);

/** Clearance above a ship's health-bar cluster to the label's baseline, CSS px —
 *  so name, bar and ship stack as one unit without touching. */
export const NAMEPLATE_SHIP_GAP = 3;
/** Clearance above a station's screen radius (its HP pin) to the label, CSS px. */
export const NAMEPLATE_STATION_GAP = 8;

/** Horizontal gap between the name and its difficulty suffix, CSS px — enough to
 *  read "SABLE (HARD)" as name-then-metadata, not one run-on word. */
export const NAMEPLATE_SUFFIX_GAP = 3;
/** How much dimmer the difficulty suffix is than the name it trails — the "dimmer
 *  weight than the name" the field request asks for (v0.2.2), applied as a factor
 *  on the name's own alpha so it recedes in step through the combat fade too. */
export const NAMEPLATE_SUFFIX_ALPHA = 0.55;

/** Horizontal gap between the name and the `FRIENDLY A` side label after it,
 *  CSS px — the same beat as the difficulty gap, so a plate reads as one row. */
export const NAMEPLATE_TEAM_GAP = 4;
/**
 * How much dimmer the side label is than the name it trails.
 *
 * Deliberately close to full: the difficulty tag is metadata and recedes hard
 * ({@link NAMEPLATE_SUFFIX_ALPHA}), but the side is the thing the developer could
 * not read at all — *"impossible to know who is on your team"* — so it steps back
 * from the name without ever becoming decoration. Applied as a factor on the
 * plate's own alpha, so it fades in step through the combat fade like everything
 * else in the row.
 */
export const NAMEPLATE_TEAM_ALPHA = 0.85;

/**
 * Vertical clearance from the entity centre to the label's bottom edge, so the
 * label clears the entity's status cluster (a ship's health bar, a station's HP
 * pin) and the three stack as one unit (field request rule 1).
 *
 * For a SHIP it is derived from the health bar's own geometry — the bar layer
 * puts the bar's top at `y - radius - HEALTHBAR_GAP - height` ({@link
 * ./healthbar-view}), and this returns exactly that plus {@link
 * NAMEPLATE_SHIP_GAP} — so the label's bottom edge is always strictly above the
 * bar's top edge, for any radius and either bar height. That inequality is what
 * keeps the health bar's claim on the eye during a brawl now that the combat fade
 * is gone (a0-04); it is a pure function of the plate, exported and unit-tested
 * (nameplates.test.ts) rather than buried in the draw loop.
 */
export function nameplateClusterClearance(plate: Nameplate): number {
  if (plate.kind === 'station') return plate.radius + NAMEPLATE_STATION_GAP;
  // Ship: clear the sprite, the bar gap, and the bar itself, then a hair more.
  const barHeight = plate.local ? HEALTHBAR_LOCAL_HEIGHT : HEALTHBAR_HEIGHT;
  return plate.radius + HEALTHBAR_GAP + barHeight + NAMEPLATE_SHIP_GAP;
}

/**
 * One label the layer actually drew this frame (post-cull), captured only when
 * {@link NameplateView.enableDebugCapture} has been called — the ?debug=1
 * live-stage seam behind {@link NameplateView.debugPlates}. It lets a Playwright
 * test read back that a *drawn* label, with the lobby's text and the owner's
 * colour, tracks a given ship/station on a real boot (the same discipline the
 * health bars needed after shipping dead twice). Never written in a normal build.
 */
export interface DrawnNameplate {
  owner: PlayerId;
  kind: NameplateKind;
  /** The name text drawn. */
  text: string;
  /** The recessive difficulty suffix drawn beside the name — `(HARD)` etc., or
   *  `''` for a human seat (field request v0.2.2). */
  suffix: string;
  /** The side label drawn beside the name — `FRIENDLY A` / `ENEMY B` in TEAMS,
   *  `''` in FFA (m10 teams, u3 wording). This is the readback a live-stage teams
   *  match asserts on: proof the label a player is supposed to be able to read
   *  actually DREW. */
  teamLabel: string;
  /** …and the tint it drew in — blue for the viewer's own side, red for a rival
   *  (`./lobby` SIDE_COLORS), so a screenshot's colour claim is checkable too. */
  teamColor: number;
  /** The tint (owner identity colour) applied. */
  color: number;
  /** The opacity the label was actually drawn at. Constant across every plate
   *  since a0-04 — which is exactly why it is worth reading back: a live-stage
   *  test (and the evidence capture) can show a fighting ship's name and a calm
   *  one's name at the same number, not merely assert it. */
  alpha: number;
  /** Label centre-x in screen space, CSS px (the entity it tracks). */
  x: number;
  /** Label-top y in screen space, CSS px. */
  y: number;
  /** True for the local player's own-ship label. */
  local: boolean;
}

export class NameplateView extends Container {
  private readonly labels: Text[] = [];
  /** Parallel pool for the recessive difficulty suffix, one per name slot; a name
   *  with no suffix (a human, or an unfed difficulty table) hides its entry. */
  private readonly suffixes: Text[] = [];
  /** Parallel pool for the side label, one per name slot; a plate with no
   *  side (every plate in FFA) hides its entry. */
  private readonly teamTags: Text[] = [];
  /** Union of the rects drawn this frame, or null when nothing drew. */
  private drawnBounds: Rect | null = null;

  // --- ?debug=1 live-stage capture (off in every normal build) -------------
  private debugCapture = false;
  private readonly debugDrawn: DrawnNameplate[] = [];
  private debugCount = 0;

  /**
   * Draw one frame of labels into the given viewport. `plates` come from
   * {@link nameplateModel}; each is centred on its entity and floated above the
   * entity's status cluster.
   */
  update(plates: readonly Nameplate[], viewportWidth: number, viewportHeight: number): void {
    let drawn = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const plate of plates) {
      const t = this.slot(drawn);
      // A Text re-rasterises only when its string changes — cheap in a stable
      // scene where slot i keeps tracking the same entity across frames.
      if (t.text !== plate.text) t.text = plate.text;
      t.tint = plate.color;
      t.alpha = plate.alpha;

      // The side label (m10 teams, u3 wording) — `FRIENDLY A` / `ENEMY B`, in
      // words, immediately after the name, because colour cannot say it on its own:
      // identity colour is per-SLOT, so a side has no hue (style-guide §3.1;
      // "colour alone insufficient", ratified). Its own tint IS the side colour —
      // blue ally / red rival — but only as reinforcement over a word that already
      // says it. Empty in FFA, where every plate would otherwise read a different
      // side and say nothing.
      const tm = this.teamSlot(drawn);
      if (tm.text !== plate.teamLabel) tm.text = plate.teamLabel;
      const hasTeam = plate.teamLabel.length > 0;
      const teamWidth = hasTeam ? NAMEPLATE_TEAM_GAP + tm.width : 0;

      // The recessive difficulty suffix (field request v0.2.2), trailing the name
      // in the owner colour but a step dimmer, so it reads as metadata not identity.
      const st = this.suffixSlot(drawn);
      if (st.text !== plate.suffix) st.text = plate.suffix;
      const hasSuffix = plate.suffix.length > 0;
      const suffixWidth = hasSuffix ? NAMEPLATE_SUFFIX_GAP + st.width : 0;

      // Bottom-centre anchor: position the label's baseline just above the
      // entity's status cluster, so it grows upward and never into the bar/ship.
      const bottom = plate.y - nameplateClusterClearance(plate);
      const width = t.width;
      const height = t.height;
      const left = plate.x - width / 2;
      // Side label and suffix hang off the name's right edge, so the drawn unit
      // runs wider than the name alone — cull and bounds count it as one piece.
      const right = left + width + teamWidth + suffixWidth;
      const top = bottom - height;

      // Cull anything that would spill off the canvas: a partial label reads worse
      // than none, and a clipped rect would break the `full` contract.
      if (left < 0 || top < 0 || right > viewportWidth || top + height > viewportHeight) {
        tm.visible = false;
        st.visible = false;
        continue;
      }

      t.visible = true;
      t.position.set(plate.x, bottom);
      if (hasTeam) {
        tm.visible = true;
        tm.tint = plate.teamColor;
        tm.alpha = plate.alpha * NAMEPLATE_TEAM_ALPHA;
        tm.position.set(left + width + NAMEPLATE_TEAM_GAP, bottom);
      } else {
        tm.visible = false;
      }
      if (hasSuffix) {
        st.visible = true;
        st.tint = plate.color;
        st.alpha = plate.alpha * NAMEPLATE_SUFFIX_ALPHA;
        // Left-anchored past the name and its side label, sharing their baseline.
        st.position.set(left + width + teamWidth + NAMEPLATE_SUFFIX_GAP, bottom);
      } else {
        st.visible = false;
      }
      if (this.debugCapture) this.recordDebug(drawn, plate, top);
      drawn++;

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (top + height > maxY) maxY = top + height;
    }

    this.hideFrom(drawn);
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
    this.debugCount = this.debugCapture ? drawn : 0;
  }

  // --- ?debug=1 live-stage seam --------------------------------------------

  /** Turn on capture of the drawn labels so {@link debugPlates} reports them. The
   *  live-stage harness (main.ts, only under ?debug=1) calls this once; a normal
   *  build never does, so the record path stays cold. Idempotent. */
  enableDebugCapture(): void {
    this.debugCapture = true;
  }

  /** The labels that actually drew last frame (post-cull) — owner, text, colour,
   *  kind and screen position — for a live-stage test to assert a real label
   *  tracks a ship/station. Empty unless {@link enableDebugCapture} was called. */
  debugPlates(): DrawnNameplate[] {
    return this.debugDrawn.slice(0, this.debugCount).map((d) => ({ ...d }));
  }

  /** Record one drawn label into the reusable pool at `i` (grows to fit). Only
   *  reached under {@link debugCapture}, so it costs nothing in a normal build. */
  private recordDebug(i: number, plate: Nameplate, top: number): void {
    let d = this.debugDrawn[i];
    if (!d) {
      d = { owner: plate.owner, kind: plate.kind, text: plate.text, suffix: plate.suffix, teamLabel: plate.teamLabel, teamColor: plate.teamColor, color: plate.color, alpha: plate.alpha, x: plate.x, y: top, local: plate.local };
      this.debugDrawn[i] = d;
      return;
    }
    d.owner = plate.owner;
    d.kind = plate.kind;
    d.text = plate.text;
    d.suffix = plate.suffix;
    d.teamLabel = plate.teamLabel;
    d.teamColor = plate.teamColor;
    d.color = plate.color;
    d.alpha = plate.alpha;
    d.x = plate.x;
    d.y = top;
    d.local = plate.local;
  }

  /**
   * The layer's registry entry — the union of the labels that drew, or nothing
   * when no entity is on screen to name.
   *
   * The bounds are reported in GLOBAL (physical) space via {@link getBounds},
   * exactly as the HUD's other elements do through `Hud.describeLayout`'s `push`
   * helper: the layout host reads a `describeLayout` seam as physical Pixi bounds
   * and un-rotates them into the logical viewport itself (`physicalBoundsToLogical`
   * in main.ts). The labels draw as children of the rotating game root, so their
   * on-screen union IS `getBounds()`. Returning the layer's *own-space*
   * `drawnBounds` instead — which is already logical — double-counts the landscape
   * lock's 90° rotation: under a portrait-held phone the host re-rotates an
   * already-logical rect clean off the screen, so the label registers in a
   * different space than it drew in. That is PR #93. `drawnBounds` stays purely
   * the "did anything draw this frame" sentinel; the health-bar layer registers
   * the same way, so the two space handlings are identical.
   */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    if (!this.visible || !this.drawnBounds) return [];
    const b = this.getBounds();
    return [{ id: NAMEPLATE_ID, anchor: NAMEPLATE_ANCHOR, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }];
  }

  private slot(i: number): Text {
    let t = this.labels[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: FONT_NAME, fontSize: FONT_SIZE, fill: 0xffffff, letterSpacing: NAME_TRACKING },
      });
      t.anchor.set(0.5, 1); // bottom-centre: grows upward from the entity
      this.labels[i] = t;
      this.addChild(t);
    }
    return t;
  }

  /** The pooled suffix Text for name slot `i` — left-anchored so it hangs off the
   *  right edge of the centred name, on the same baseline (field request v0.2.2). */
  private suffixSlot(i: number): Text {
    let t = this.suffixes[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: FONT_NAME, fontSize: FONT_SIZE, fill: 0xffffff, letterSpacing: NAME_TRACKING },
      });
      t.anchor.set(0, 1); // bottom-left: sits just past the name, same baseline
      this.suffixes[i] = t;
      this.addChild(t);
    }
    return t;
  }

  /** The pooled side-label Text for name slot `i` — same left anchor and baseline as
   *  the difficulty suffix, and pooled the same way (m10 teams). */
  private teamSlot(i: number): Text {
    let t = this.teamTags[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: FONT_NAME, fontSize: FONT_SIZE, fill: 0xffffff, letterSpacing: NAME_TRACKING },
      });
      t.anchor.set(0, 1);
      this.teamTags[i] = t;
      this.addChild(t);
    }
    return t;
  }

  private hideFrom(count: number): void {
    for (let i = count; i < this.labels.length; i++) {
      const t = this.labels[i];
      if (t) t.visible = false;
    }
    for (let i = count; i < this.suffixes.length; i++) {
      const t = this.suffixes[i];
      if (t) t.visible = false;
    }
    for (let i = count; i < this.teamTags.length; i++) {
      const t = this.teamTags[i];
      if (t) t.visible = false;
    }
  }
}
