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
 * **The row (a0-38).** A plate reads **side, name, difficulty tag** — `FRIENDLY A
 * Bolt (EASY)` — the side first because that is what the developer is scanning
 * for (*"friendly or enemy should be the first thing displayed on a name so thats
 * its easier to identify"*). The wording of the tags is untouched (m10, u3); only
 * the order moved. In FFA there is no side and the row opens with the name, with
 * no gap where the tag would have been — an FFA plate is untouched to the pixel.
 * The name stays centred on its entity and the two tags flank it; see
 * {@link nameplateRowLayout}, which owns the arithmetic so the order is
 * unit-testable without a GPU.
 *
 * **The stack (field request rule 1, and the whole of rule 3 after a0-04).** A
 * ship's status marks read as one unit,
 * top to bottom: the **side + name + difficulty-tag** row on top, the **health bar +
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
 * **The keep-out (a0-115).** A label is world-anchored — it goes wherever its ship
 * goes — and the HUD's readouts are not, so on some camera positions the two are
 * in the same pixels. QA measured it at roughly one stop in seven: the grey word
 * `ORE` and a teal `Rusty (EASY)` on the same corner, the R drawn across the E.
 * Draw order does not answer it (this layer is already UNDER the counter and the
 * collision was photographed anyway — type is mostly holes), so the label yields:
 * it steps sideways by the least that clears the readouts, as far as it can while
 * still standing over its own ship, and stands down for the frame when there is no
 * such position. The rule and the argument live in {@link ./layout-exclusions};
 * what a stood-down plate leaves behind is a {@link WithheldNameplate} on the
 * ?debug=1 seam, so a label that yields is never a label that just disappeared.
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
// a0-115: a label is world-anchored and a readout is not, so on some camera
// positions the two are in the same pixels. The rule — who yields, how far, and
// what happens when yielding is not enough — is stated once in the registry's own
// vocabulary and applied here; see that module's keep-out section for the argument.
import { labelYieldsToReadouts } from './layout-exclusions';
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
/** Label size, CSS px — small chrome over the world, legible at thumb-scale.
 *  Exported since a0-38 so the width budget for a side-first plate is *measured*
 *  headlessly at the real type size (`./font-metrics`, a0-32's discipline) rather
 *  than restated in a test as a number that can drift away from this one. */
export const NAMEPLATE_FONT_SIZE = 12;
const FONT_SIZE = NAMEPLATE_FONT_SIZE;
/** A name IS a proper noun, so it takes the ratified `name` tier — and so do the
 *  two tags that flank it, because they are read as part of the same row. This
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

/** Horizontal gap between the `FRIENDLY A` side label and the name it LEADS,
 *  CSS px — the same beat as the difficulty gap, so a plate reads as one row. */
export const NAMEPLATE_TEAM_GAP = 4;
/**
 * How much dimmer the side label is than the name it leads.
 *
 * Deliberately close to full: the difficulty tag is metadata and recedes hard
 * ({@link NAMEPLATE_SUFFIX_ALPHA}), but the side is the thing the developer could
 * not read at all — *"impossible to know who is on your team"* — so it steps back
 * from the name without ever becoming decoration. It steps back in WEIGHT only:
 * since a0-38 it is also the token the eye lands on first, which is the developer's
 * ruling (*"friendly or enemy should be the first thing displayed on a name"*), so
 * the dimming must never be read as demotion. Applied as a factor on the plate's
 * own alpha, so the whole row dims together when a caller dims the layer.
 */
export const NAMEPLATE_TEAM_ALPHA = 0.85;

// ---------------------------------------------------------------------------
// The row (a0-38 — the side reads first)
// ---------------------------------------------------------------------------

/** The three tokens' drawn widths, CSS px, as PixiJS measured them — `0` for a
 *  token that is not there (no side in FFA, no difficulty on a human seat). */
export interface NameplateRowWidths {
  /** `FRIENDLY A` / `ENEMY B`, or 0 in FFA and for any slot with no side. */
  readonly side: number;
  /** The name itself — always present (a nameless slot still shows `P{n}`). */
  readonly name: number;
  /** `(HARD)` etc., or 0 for a human seat / an unfed difficulty table. */
  readonly suffix: number;
}

/** Where each token's LEFT edge goes, and what the whole row spans. Every x is
 *  absolute screen px on the plate's own baseline; a token with a zero width has
 *  no meaningful x and the caller hides it. */
export interface NameplateRow {
  /** Left edge of the leading side tag — only meaningful when `side > 0`. */
  readonly sideX: number;
  /** Left edge of the name. Always `centerX - name / 2`: the NAME is what stays
   *  centred on the entity, whatever flanks it (see below). */
  readonly nameX: number;
  /** Left edge of the trailing difficulty tag — only meaningful when `suffix > 0`. */
  readonly suffixX: number;
  /** The row's outer edges and total span, which is what the cull and the layer's
   *  registered bounds are computed from — the row draws and culls as one piece. */
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/**
 * Lay a plate's row out left→right: **side, then name, then difficulty tag**.
 *
 * The order is the a0-38 ruling — the developer, on a live build: *"friendly or
 * enemy should be the first thing displayed on a name so thats its easier to
 * identify"*. Until then a plate read `Bolt FRIENDLY A (EASY)`; the fact a player
 * is actually scanning for was second, behind a name that varies in length, so
 * there was no fixed place on the row for the eye to land. Leading with it gives
 * one. The tags' WORDING is untouched (ratified m10, refined u3); only their
 * position moved. The difficulty tag stays last — it is recessive metadata and has
 * no claim on the front of the row.
 *
 * **FFA opens with the name, never with a gap.** `side` is `''` on every plate in
 * a free-for-all, and the leading gap is charged only when there IS a side — so an
 * FFA row is `Bolt (EASY)`, the same tokens in the same places it has always had.
 * Same for the trailing gap and a human seat's absent tag.
 *
 * **The NAME stays centred on the entity; the tags flank it.** The alternative was
 * to centre the whole row, which reads tidier in the abstract and would have moved
 * every plate in the game — including every FFA plate, which has no side and no
 * business moving for a change about sides. This way the FFA HUD is untouched to
 * the pixel and the diff is exactly the thing a0-38 asked for: in TEAMS the side
 * tag moves from the name's right to its left.
 *
 * **The width answer, stated exactly.** The row is a RIGID body and a0-38 did not
 * change its width — same three tokens, same two gaps — it changed where the ship
 * sits inside it. Two consequences, and they are different facts:
 *
 *  - **Culling is not worse.** The band of ship positions that keep a plate is
 *    `viewport − rowWidth` wide whatever the arrangement, so it is the same size
 *    it was; it SHIFTS right (by 62px on the typical teams plate, measured), so a
 *    plate survives further towards the right edge and less far towards the left.
 *  - **The plate is less lopsided about its hull.** It reached `name / 2 + gap +
 *    side + gap + suffix` to the right before — 127px on that same plate — and now
 *    reaches at most 81px either way, so it sits over the ship it names instead of
 *    trailing off one side of it.
 *
 * Both numbers are read back on the real faces in
 * `evidence/a0-38-side-first-nameplate/readback.json`, and the cull in
 * {@link NameplateView.update} tests exactly these edges.
 */
export function nameplateRowLayout(centerX: number, w: NameplateRowWidths): NameplateRow {
  const hasSide = w.side > 0;
  const hasSuffix = w.suffix > 0;
  const nameX = centerX - w.name / 2;
  const sideX = nameX - NAMEPLATE_TEAM_GAP - w.side;
  const suffixX = nameX + w.name + NAMEPLATE_SUFFIX_GAP;
  const left = hasSide ? sideX : nameX;
  const right = hasSuffix ? suffixX + w.suffix : nameX + w.name;
  return { sideX, nameX, suffixX, left, right, width: right - left };
}

/** No readouts to clear — the default, and what every caller that predates
 *  a0-115 gets. Shared so an omitted argument allocates nothing per frame. */
const NO_READOUTS: readonly Rect[] = [];

/** The same rigid row, `dx` px to the side. The row is a rigid body (see
 *  {@link nameplateRowLayout}), so a step aside is one addition per edge and the
 *  order of the three tokens is untouched by construction. */
function shiftRow(row: NameplateRow, dx: number): NameplateRow {
  return {
    sideX: row.sideX + dx,
    nameX: row.nameX + dx,
    suffixX: row.suffixX + dx,
    left: row.left + dx,
    right: row.right + dx,
    width: row.width,
  };
}

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
  /** The side label drawn at the FRONT of the row — `FRIENDLY A` / `ENEMY B` in
   *  TEAMS, `''` in FFA (m10 teams, u3 wording; leading since a0-38). This is the
   *  readback a live-stage teams match asserts on: proof the label a player is
   *  supposed to be able to read actually DREW. */
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
  /** Label centre-x in screen space, CSS px — the NAME's centre, which is what
   *  stays pinned to the entity now that the side tag leads the row (a0-38).
   *
   *  It is the centre the name was DRAWN at, which is the entity's own x on all
   *  but the frames where the plate stepped out of a readout's way (a0-115). On
   *  those it is the entity's x plus the step, because every other field here
   *  reports where the ink went and a mixture would be unreadable: `nameX` is
   *  always `x − name/2`, and `left ≤ x ≤ right` always holds. The entity's own
   *  position is the caller's — it is what the caller passed in. */
  x: number;
  /**
   * The row's drawn geometry, CSS px: the left edge of each token and the span of
   * the whole piece. Captured since a0-38 because the ruling this deliverable
   * implements is about ORDER, and order is a fact about x — `text` and
   * `teamLabel` read back identically whichever side of the name the tag is on.
   * With these a live-stage test can assert on a REAL boot that the side tag drew
   * to the LEFT of the name (`sideX < nameX`), and can measure how near two plates
   * come in a crowded frame instead of eyeballing a screenshot.
   *
   * `sideX` / `suffixX` are only meaningful when the plate carries that token —
   * an FFA plate's `sideX` is where a side tag WOULD have gone, and `left` is the
   * name's own left edge, which is the row's true start.
   */
  sideX: number;
  nameX: number;
  suffixX: number;
  left: number;
  right: number;
  /** Label-top y in screen space, CSS px. */
  y: number;
  /** True for the local player's own-ship label. */
  local: boolean;
}

/**
 * One label the layer decided NOT to draw this frame, and why — the other half of
 * {@link DrawnNameplate}, and the reason a0-115's fix is not itself a bug.
 *
 * A label that yields to a HUD readout can end up withheld (there is no position
 * that clears the readout while the plate still stands over its own ship), and a
 * nameplate that silently disappears is exactly the kind of defect QA cannot tell
 * from a rendering fault. So the layer keeps the receipt: under
 * {@link NameplateView.enableDebugCapture} every withheld plate is recorded with
 * the entity it belonged to and the reason it stood down, readable through
 * {@link NameplateView.debugWithheld}. Nothing vanishes without a line about it.
 *
 * Never written in a normal build.
 */
export interface WithheldNameplate {
  owner: PlayerId;
  kind: NameplateKind;
  /** The text that would have drawn. */
  text: string;
  /**
   * Why it did not:
   *
   *  - `offscreen` — the row would have spilled off the canvas, the cull this
   *    layer has always applied ("a partial label reads worse than none").
   *  - `readout` — every position that clears the fixed HUD readouts would put
   *    the plate off the ship it names (a0-115).
   */
  reason: 'offscreen' | 'readout';
  /** Where the entity was, screen space CSS px — the centre the row was built on. */
  x: number;
  y: number;
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
  private readonly debugHeld: WithheldNameplate[] = [];
  private debugHeldCount = 0;

  /**
   * Draw one frame of labels into the given viewport. `plates` come from
   * {@link nameplateModel}; each is centred on its entity and floated above the
   * entity's status cluster.
   *
   * `readouts` are the fixed HUD readouts' drawn rects this frame — the caller
   * pulls them straight off the elements the layout registry records (`./hud`
   * `readoutKeepOut`), never off a hard-coded corner, because the next one to be
   * landed in will not be the one that was photographed. A label that would be
   * drawn inside one of them steps aside, and stands down if it cannot: the rule,
   * and the argument for it, are in `./layout-exclusions` (a0-115). Omit it and
   * the layer behaves exactly as it did before that brief.
   */
  update(
    plates: readonly Nameplate[],
    viewportWidth: number,
    viewportHeight: number,
    readouts: readonly Rect[] = NO_READOUTS,
  ): void {
    let drawn = 0;
    let held = 0;
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
      // words, and since a0-38 it LEADS the row, because that is the fact a player
      // is scanning for (*"friendly or enemy should be the first thing displayed on
      // a name"*). Colour cannot say it on its own: identity colour is per-SLOT, so
      // a side has no hue (style-guide §3.1; "colour alone insufficient", ratified).
      // Its own tint IS the side colour — blue ally / red rival — but only as
      // reinforcement over a word that already says it. Empty in FFA, where every
      // plate would otherwise read a different side and say nothing.
      const tm = this.teamSlot(drawn);
      if (tm.text !== plate.teamLabel) tm.text = plate.teamLabel;
      const hasTeam = plate.teamLabel.length > 0;

      // The recessive difficulty suffix (field request v0.2.2), trailing the name
      // in the owner colour but a step dimmer, so it reads as metadata not identity.
      const st = this.suffixSlot(drawn);
      if (st.text !== plate.suffix) st.text = plate.suffix;
      const hasSuffix = plate.suffix.length > 0;

      // Bottom anchors: the row's baseline sits just above the entity's status
      // cluster, so it grows upward and never into the bar/ship. The row itself —
      // side, name, tag — is laid out and centred by the pure function above, so
      // its order and its FFA/human-seat gaps are unit-testable without a GPU.
      const bottom = plate.y - nameplateClusterClearance(plate);
      const height = t.height;
      const row = nameplateRowLayout(plate.x, {
        side: hasTeam ? tm.width : 0,
        name: t.width,
        suffix: hasSuffix ? st.width : 0,
      });
      const top = bottom - height;

      // Cull anything that would spill off the canvas: a partial label reads worse
      // than none, and a clipped rect would break the `full` contract. The row is
      // one piece — the side tag is not decoration a ship can be labelled without,
      // so a row that does not fit takes the whole plate with it.
      if (row.left < 0 || top < 0 || row.right > viewportWidth || top + height > viewportHeight) {
        t.visible = false;
        tm.visible = false;
        st.visible = false;
        if (this.debugCapture) this.recordWithheld(held, plate, 'offscreen');
        held++;
        continue;
      }

      // a0-115: the readouts are fixed furniture and this label is not, so the
      // label is the one that moves. `dx` is the smallest sideways step that
      // clears every readout while the row still stands over its own entity;
      // `withheld` means there is no such step and the plate stands down for this
      // frame rather than being drawn through the word ORE.
      const yielded = labelYieldsToReadouts(
        { left: row.left, right: row.right, top, bottom },
        plate.x,
        plate.radius,
        readouts,
        viewportWidth,
      );
      if (yielded.withheld) {
        t.visible = false;
        tm.visible = false;
        st.visible = false;
        if (this.debugCapture) this.recordWithheld(held, plate, 'readout');
        held++;
        continue;
      }
      const dx = yielded.dx;

      t.visible = true;
      // Centre-anchored, so it is drawn AT the entity — `row.nameX` is that same
      // point expressed as the name's left edge, which is what the two tags and
      // the cull are measured from.
      t.position.set(plate.x + dx, bottom);
      if (hasTeam) {
        tm.visible = true;
        tm.tint = plate.teamColor;
        tm.alpha = plate.alpha * NAMEPLATE_TEAM_ALPHA;
        tm.position.set(row.sideX + dx, bottom);
      } else {
        tm.visible = false;
      }
      if (hasSuffix) {
        st.visible = true;
        st.tint = plate.color;
        st.alpha = plate.alpha * NAMEPLATE_SUFFIX_ALPHA;
        // Left-anchored past the name, sharing its baseline.
        st.position.set(row.suffixX + dx, bottom);
      } else {
        st.visible = false;
      }
      // Everything downstream — the debug readback and the registered bounds —
      // reads the row where it was DRAWN, not where it would have been: a rect
      // that ignored the step would report the plate inside the counter it just
      // stepped out of.
      const placed = dx === 0 ? row : shiftRow(row, dx);
      if (this.debugCapture) this.recordDebug(drawn, plate, top, placed, plate.x + dx);
      drawn++;

      if (placed.left < minX) minX = placed.left;
      if (top < minY) minY = top;
      if (placed.right > maxX) maxX = placed.right;
      if (top + height > maxY) maxY = top + height;
    }

    this.hideFrom(drawn);
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
    this.debugCount = this.debugCapture ? drawn : 0;
    this.debugHeldCount = this.debugCapture ? held : 0;
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

  /** The labels the layer decided NOT to draw last frame, and why (a0-115) —
   *  the receipt that keeps "it yielded" distinguishable from "it broke". Empty
   *  unless {@link enableDebugCapture} was called. */
  debugWithheld(): WithheldNameplate[] {
    return this.debugHeld.slice(0, this.debugHeldCount).map((d) => ({ ...d }));
  }

  /** Record one withheld label into the reusable pool at `i` (grows to fit),
   *  pooled exactly like {@link recordDebug} and just as cold in a normal build. */
  private recordWithheld(
    i: number,
    plate: Nameplate,
    reason: WithheldNameplate['reason'],
  ): void {
    let d = this.debugHeld[i];
    if (!d) {
      d = { owner: plate.owner, kind: plate.kind, text: plate.text, reason, x: plate.x, y: plate.y };
      this.debugHeld[i] = d;
      return;
    }
    d.owner = plate.owner;
    d.kind = plate.kind;
    d.text = plate.text;
    d.reason = reason;
    d.x = plate.x;
    d.y = plate.y;
  }

  /** Record one drawn label into the reusable pool at `i` (grows to fit). Only
   *  reached under {@link debugCapture}, so it costs nothing in a normal build. */
  private recordDebug(
    i: number,
    plate: Nameplate,
    top: number,
    row: NameplateRow,
    centerX: number,
  ): void {
    let d = this.debugDrawn[i];
    if (!d) {
      d = { owner: plate.owner, kind: plate.kind, text: plate.text, suffix: plate.suffix, teamLabel: plate.teamLabel, teamColor: plate.teamColor, color: plate.color, alpha: plate.alpha, x: centerX, y: top, local: plate.local, sideX: row.sideX, nameX: row.nameX, suffixX: row.suffixX, left: row.left, right: row.right };
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
    d.x = centerX;
    d.y = top;
    d.local = plate.local;
    d.sideX = row.sideX;
    d.nameX = row.nameX;
    d.suffixX = row.suffixX;
    d.left = row.left;
    d.right = row.right;
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
