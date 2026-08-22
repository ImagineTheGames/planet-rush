/**
 * src/ui/gantry.ts — the Gantry/Bone screen frame. OWNER: UI Engineer (u7-01).
 *
 * The ratified direction (developer, 2026-08-05: *"the theme and looks is what we
 * want"*) frames every menu the same way: a header beam, a footer beam, a page
 * margin, and one content band between them. `src/art/materials.ts` owns the
 * *material* — the plate, the bevel, the rivets, the beam fill, the tracking, and
 * (since u7-01) the phone counterpart of every metric. This module owns the
 * *frame*: where those beams sit on a given viewport, what is left over for
 * content, and how a stack of plates is centred in it.
 *
 * It is deliberately the thinnest possible layer. Nothing here re-derives a bevel
 * or picks a number the handoff already picked — it turns
 * {@link ../art/materials} `frameMetrics` plus a viewport and its safe-area
 * insets into rects, so the title and settings screens (and the three that follow
 * them) place their furniture identically instead of each inventing a frame.
 *
 * ---------------------------------------------------------------------------
 * ONE PRIMARY PER SCREEN — the constraint that travels with Bone
 * ---------------------------------------------------------------------------
 * Bone spends no colour on the menu: the primary action is simply the brightest
 * plate on screen. The handoff states the consequence, and it is a rule rather
 * than a preference:
 *
 * > *"the primary relies on brightness and size rather than hue, so it must never
 * > share a screen with a second bright plate."*
 *
 * A second `primary` plate does not merely look busy — it destroys the only
 * mechanism the direction has for saying "this is the action". {@link
 * singlePrimary} is that rule written down so a test can hold each screen to it
 * ({@link ./gantry.test}), and so a screen that grows a control later fails
 * loudly instead of quietly going two-bright.
 *
 * Pure geometry and pure predicates: no PixiJS, no DOM, so the whole frame
 * unit-tests headless like the rest of `src/ui/`.
 */

import type { AnchorSpec, Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, REFERENCE_VIEWPORT, TOUCH_MIN, beamContentInset, frameMetrics, plateHeight } from '../art/materials';
import type { BeamKind, FrameMetrics, PlateRole, PlateScale } from '../art/materials';
import { buildStampRow, clearBuildStamp } from './build-stamp';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/**
 * The furniture of one screen, resolved for one viewport.
 *
 * The beams span the **full width inside the safe area** rather than inside the
 * page margin, because a beam is structure — it is the edge of the screen, so it
 * runs to the edge of the screen. It stops at the safe-area inset and no further:
 * a notch is not somewhere a beam may be drawn under.
 */
export interface GantryFrame {
  readonly metrics: FrameMetrics;
  /** The header beam's rect (`height === metrics.beam`; zero-height if there is
   *  no room for one). */
  readonly header: Rect;
  /** The footer beam's rect. */
  readonly footer: Rect;
  /** The safe area inset by the page margin — where a beam's own content sits. */
  readonly content: Rect;
  /** The band between the two beams and their gutters — where the plates live. */
  readonly band: Rect;
  /**
   * The row along the bottom edge the build stamp owns (`./build-stamp`
   * `buildStampRow`) — resolved off the RAW viewport, because the badge corners
   * itself off the logical viewport rather than off the safe area.
   *
   * It is part of the frame and not a thing each screen resolves for itself for
   * the reason a0-129 was filed: the stamp is on every page, so the corner it
   * occupies is furniture of the frame in the same way the beams are, and a
   * screen that had to remember to look it up is a screen that can forget to.
   */
  readonly stamp: Rect;
}

/** Non-negative safe-area inset, defaulting to zero. */
function inset(value: number | undefined): number {
  return Math.max(0, value ?? 0);
}

/**
 * Resolve the frame for a viewport and its safe-area insets.
 *
 * On the reference 1280×720 this yields exactly the handoff's numbers: 44px
 * margins, 92px beams, a content band starting 120px from the top edge. On a
 * portrait-held phone (844×390 logical, under the landscape lock) it yields the
 * derived ones — see {@link ../art/materials} `frameMetrics` for which numbers
 * adapt and why.
 */
export function gantryFrame(viewport: Viewport, insets?: Insets): GantryFrame {
  const top = inset(insets?.top);
  const bottom = inset(insets?.bottom);
  const left = inset(insets?.left);
  const right = inset(insets?.right);

  const safeX = left;
  const safeY = top;
  const safeW = Math.max(0, viewport.width - left - right);
  const safeH = Math.max(0, viewport.height - top - bottom);

  const metrics = frameMetrics(safeW, safeH);
  // Two beams and their gutters can never claim the whole screen: on a viewport
  // too short to hold both, the beams give way before the content does.
  const beam = Math.max(0, Math.min(metrics.beam, safeH / 2));

  const header: Rect = { x: safeX, y: safeY, width: safeW, height: beam };
  const footer: Rect = { x: safeX, y: safeY + safeH - beam, width: safeW, height: beam };

  const content: Rect = {
    x: safeX + metrics.margin,
    y: safeY,
    width: Math.max(0, safeW - metrics.margin * 2),
    height: safeH,
  };

  const bandTop = safeY + beam + metrics.gutter;
  const bandBottom = safeY + safeH - beam - metrics.gutter;
  const band: Rect = {
    x: content.x,
    y: bandTop,
    width: content.width,
    height: Math.max(0, bandBottom - bandTop),
  };

  return { metrics, header, footer, content, band, stamp: buildStampRow(viewport) };
}

/**
 * The strip inside a beam that its content may occupy. Used for the wordmark, the
 * eyebrow cluster, and the one plate a footer beam is allowed to carry (settings'
 * DONE).
 *
 * The inset is {@link ../art/materials} `beamContentInset`, not the bare page
 * margin: a header beam is bolted, and its rivets do not scale with the frame, so
 * on a phone the margin alone would run the eyebrow straight through them.
 */
export function beamContent(beam: Rect, m: FrameMetrics, kind: BeamKind = 'header'): Rect {
  const inset = beamContentInset(m, kind);
  return {
    x: beam.x + inset,
    y: beam.y,
    width: Math.max(0, beam.width - inset * 2),
    height: beam.height,
  };
}

/** Which end of a beam a plate is bolted to. */
export type BeamAlign = 'leading' | 'trailing';

/**
 * Place one plate inside a beam's own strip — the settings screen's DONE, the
 * doors screen's BACK and SETTINGS, the CODEX's BACK.
 *
 * The settings screen worked this out first and did it inline; three more screens
 * want the same three lines, so it lives here rather than being copied a fourth
 * time. A beam plate is **centred in the beam's height** at its scale's own plate
 * height (never stretched to fill the beam — a plate as tall as the frame stops
 * reading as a control), and anchored to one end of the strip.
 *
 * `offset` moves the plate inward from its anchored end, which is how two plates
 * share one end of a beam (ERASE sits a gutter inboard of JOIN).
 */
export function beamPlate(
  strip: Rect,
  m: FrameMetrics,
  align: BeamAlign,
  width: number,
  scale: PlateScale = 'compact',
  offset = 0,
): Rect {
  const h = Math.max(0, Math.min(plateHeight(scale, m), strip.height));
  const w = Math.max(0, Math.min(width, strip.width));
  const x =
    align === 'leading'
      ? strip.x + offset
      : strip.x + strip.width - w - offset;
  return { x, y: strip.y + (strip.height - h) / 2, width: w, height: h };
}

/**
 * A footer plate that keeps the **thumb floor even where the beam cannot hold
 * one** — and the band's share of the bill.
 *
 * The lobby worked this out first for RUSH! and did it inline (`./lobby-geometry`):
 * a 390-wide phone in PORTRAIT resolves a 28px footer beam, so a plate centred in
 * it would be a 28px control, and RUSH! is the one thing on that screen a player
 * has to be able to press. It takes {@link TOUCH_MIN} regardless, grows **upward**
 * out of the beam, and the band gives up exactly the overflow — which is air
 * between the band and the beam by construction.
 *
 * u10-01's two picker screens have the same one-control-you-must-press shape (BACK
 * is the only way off either), so the arithmetic lives here rather than being
 * copied a third time. The returned `overflow` is what the caller must subtract
 * from its band, and it is zero on every viewport whose beam is already tall
 * enough — which is every desktop and every phone in landscape.
 *
 * **And it keeps off the build stamp** (a0-129). The beam runs to the bottom of
 * the frame, and so does the stamp's row (`./build-stamp`), so a plate centred in
 * the beam lands on the tag: a0-127 measured 55% of it under MAP SELECT's BACK,
 * with the plate's accent bar across the last character. The plate is bottom-
 * limited by {@link GantryFrame.stamp} rather than by the beam's own edge and
 * grows upward out of the difference — the same movement, charged to the same
 * band, that the thumb floor above already makes. `./build-stamp` argues at
 * length why the plate is what yields and why it yields on this axis.
 *
 * `align` picks the end of the beam: `leading` for a BACK plate, `trailing` for an
 * action (the settings screen's DONE, the lobby's RUSH!).
 */
export function beamActionPlate(
  frame: GantryFrame,
  m: FrameMetrics,
  width: number,
  align: BeamAlign = 'leading',
): { readonly rect: Rect; readonly overflow: number } {
  const strip = beamContent(frame.footer, m, 'footer');
  const height = Math.max(
    0,
    Math.min(
      Math.max(TOUCH_MIN, plateHeight('compact', m)),
      frame.footer.height + m.gutter + frame.band.height,
    ),
  );
  const bottom = frame.footer.y + frame.footer.height;
  // Centred in the beam where it fits; bottom-aligned and growing up where it does
  // not — never past the safe-area edge below it — and then lifted clear of the
  // stamp's row, which on a short beam is the constraint that actually binds.
  const centred = Math.min(strip.y + (strip.height - height) / 2, bottom - height);
  const w = Math.max(0, Math.min(width, strip.width));
  const x = align === 'leading' ? strip.x : strip.x + strip.width - w;
  const rect = clearBuildStamp({ x, y: centred, width: w, height }, frame.stamp);
  return { rect, overflow: bandOverflow(frame, rect) };
}

/**
 * How far a footer plate reaches ABOVE the band's bottom edge — the pixels the
 * band has to give up so the two do not land on each other.
 *
 * Stated as a function of the placed rect rather than as arithmetic on the plate
 * height, which is what it was before a0-129. The two agreed exactly while the
 * only reason a plate left its beam was the thumb floor; they stop agreeing the
 * moment a second rule can raise it (the stamp's row), and a band charged for
 * one lift but not the other is how a screen quietly grows its next overlap.
 *
 * Zero on every viewport whose beam already holds its plate — which is every
 * desktop, and every phone in landscape until the stamp's row bites.
 */
export function bandOverflow(frame: GantryFrame, plate: Rect): number {
  if (plate.width <= 0 || plate.height <= 0) return 0;
  return Math.max(0, frame.band.y + frame.band.height - plate.y);
}

// ---------------------------------------------------------------------------
// What a footer plate declares to the layout registry (a0-129)
// ---------------------------------------------------------------------------

/**
 * The anchor a plate bolted to the **leading** end of a footer beam declares —
 * BACK, on every screen that carries one.
 *
 * `bottom-left` is the real claim and it is kept: a leading footer plate starts
 * at the beam's own content inset and is at most 140px wide at the reference, so
 * it is inside the left half of the frame on every profile in
 * `./hud-geometry.test.ts`'s matrix, down to a 320px screen. It is also, and not
 * coincidentally, the region the build stamp declares — which is the whole of
 * a0-129 in one line, and now something a registry reader can see.
 */
export const FOOTER_PLATE_LEADING_ANCHOR: AnchorSpec = { region: 'bottom-left', margin: 0 };

/**
 * …and the anchor a plate bolted to the **trailing** end declares: `full`.
 *
 * Not `bottom-right`, and the reason is measured rather than cautious. The
 * trailing plates are the wide ones — DONE and the hangar's BACK are 300px at the
 * reference, RUSH! is 189px — and a 300px plate right-aligned in a 390px beam
 * starts at x=120, which is left of the midline where the `bottom-right` zone
 * begins. Four of the nine profiles fail containment for that reason, on a screen
 * where nothing is wrong: the plate is as far right as a beam that wide can put
 * it. `full` is the anchor that makes no promise it cannot keep — the same call
 * the onboarding prompt makes, and for the same reason (`./anchor-reach` §1).
 */
export const FOOTER_PLATE_TRAILING_ANCHOR: AnchorSpec = { region: 'full', margin: 0 };

// ---------------------------------------------------------------------------
// The column — how much of the band a menu's content may claim
// ---------------------------------------------------------------------------

/**
 * The content band at the reference viewport: 1280 less the handoff's 44px page
 * margin on each side. Derived rather than written down, so a change to either
 * number moves {@link MENU_COLUMN_SHARE} with it instead of leaving it stale.
 */
const REFERENCE_BAND_WIDTH =
  REFERENCE_VIEWPORT.width - 2 * frameMetrics(REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height).margin;

/**
 * **The proportional ceiling on a menu's column — the handoff's own share.**
 *
 * Every menu screen used to cap its column with one absolute number
 * ({@link ../art/materials} `COLUMN`) and nothing else:
 *
 * ```ts
 * const columnWidth = Math.min(COLUMN.title, frame.band.width);
 * ```
 *
 * On a desktop the absolute wins and the plates stay a sane column. On a phone
 * the *band* wins — it is narrower than the cap — so the cap never bites and the
 * plates take everything. Measured on the developer's own 798x384 screenshot
 * viewport, the field left beside a plate was **2.9% of the screen on each
 * side**: edge to edge, which is exactly what the screenshot showed.
 *
 * The fix is a ceiling that scales, and the honest number for it is not a taste:
 * the ratified handoff draws an **800px column in a 1192px band**, so the design
 * itself says a menu's plates get 67.1% of the band and give the remaining third
 * back as field. This is that ratio, so:
 *
 *  - the reference desktop is **unchanged to the pixel** — 1192 x 0.671 = 800,
 *    which is `COLUMN.title`, and the absolute cap still holds every viewport
 *    wider than the reference;
 *  - a narrow screen reads the **same proportion of field** the handoff draws
 *    rather than surrendering it. At 798x384 the plates go 752 -> 505 and the
 *    field goes 2.9% -> 18.4% a side, which is the desktop's own 18.75%.
 *
 * The margin is the fix, not a smaller plate: 505px of plate on a 798px screen
 * is still far and away the biggest control on it, and a plate's *tappability*
 * is its height, which {@link ../art/materials} `frameMetrics` floors at the
 * thumb minimum and this does not touch.
 */
export const MENU_COLUMN_SHARE = COLUMN.title / REFERENCE_BAND_WIDTH;

/**
 * **The floor the proportional ceiling stops at**, in reference px — scaled by
 * `plateScale`, because what it protects is the type *inside* the plate and that
 * is what `plateScale` sizes.
 *
 * A share alone is the right rule in one direction only. Landscape is wide and
 * has field to spare; **portrait is the opposite constraint** — at a 390px-wide
 * logical viewport the whole band is 364px, and taking a third of that as field
 * leaves 244px of plate to hold a label, an accent tick, two lots of padding and
 * a sub-line as long as *"Ship, level, and what a level unlocks"*. That is a
 * screen whose words are squeezed to buy air nobody asked for.
 *
 * So below this width the screen gives up **field** rather than **words**: the
 * ceiling stops descending and the column is simply the band. The number is not
 * a preference either — it is the narrowest column the widest thing the front of
 * the game puts in one still fits at a phone's plate scale. That thing is the
 * main menu's longest sub-line (383px at 844x390, against the settings screen's
 * widest row at 345px), and `main-menu.test.ts` measures it against the real
 * advance tables ({@link ./font-metrics}) rather than trusting this comment, so
 * copy that outgrows it fails loudly.
 */
export const MENU_COLUMN_MIN = 448;

/**
 * How wide a menu's column may be in `bandWidth`: at most `max` (the screen's own
 * absolute cap from {@link ../art/materials} `COLUMN`), at most
 * {@link MENU_COLUMN_SHARE} of the band, and never squeezed below
 * {@link MENU_COLUMN_MIN} — or the band itself, when even that will not fit.
 *
 * This is the seam the four flat menu screens share (title, settings, codex,
 * hangar), so the front of the game is one system rather than four that drifted:
 * each screen still names its own absolute column, and the proportion is decided
 * in exactly one place.
 */
export function menuColumnWidth(
  bandWidth: number,
  max: number,
  m: FrameMetrics,
  columns = 1,
): number {
  const band = Math.max(0, bandWidth);
  const n = Math.max(1, Math.round(columns));
  // `columns` is for the screens that WRAP (the settings grid on a short phone):
  // the floor protects a column's content, so a band holding n of them has to
  // clear n floors and the gaps between them, or the ceiling would buy its
  // margin out of every column at once.
  const floor = Math.min(band, MENU_COLUMN_MIN * m.plateScale * n + m.gap * (n - 1));
  return Math.max(0, Math.min(max, band, Math.max(band * MENU_COLUMN_SHARE, floor)));
}

/**
 * `band`, narrowed to {@link menuColumnWidth} and re-centred in itself — for the
 * screens whose content is not a stack of plates but a whole two-pane layout
 * (the codex's tabs + rail + article). Same ceiling, same centring; the screen
 * then lays out inside the returned rect exactly as it used to lay out inside
 * the band.
 */
export function menuColumnBand(band: Rect, max: number, m: FrameMetrics, columns = 1): Rect {
  const width = menuColumnWidth(band.width, max, m, columns);
  return { x: band.x + (band.width - width) / 2, y: band.y, width, height: band.height };
}

// ---------------------------------------------------------------------------
// Stacking plates
// ---------------------------------------------------------------------------

/**
 * Centre a stack of plates of *different* heights in `band`.
 *
 * {@link ./menu-geometry} `centeredColumn` cannot do this: it gives every row one
 * height, and the whole point of the title screen is that PLAY is taller than the
 * two plates under it — size is half of what makes it the primary (the other half
 * is brightness, and there is no third half, because Bone spends no hue).
 *
 * Overflow **compresses proportionally** rather than running off the bottom edge,
 * so the ratios survive a viewport that cannot hold the stack at full size; and a
 * band with no room at all yields zero-extent rects, which the hit tests treat as
 * untappable — invisible ⇒ unhittable, the rule every layout in this directory
 * keeps.
 */
export function stackPlates(
  band: Rect,
  width: number,
  heights: readonly number[],
  gap: number,
): Rect[] {
  if (heights.length === 0) return [];
  const w = Math.max(0, Math.min(width, band.width));
  const gaps = (heights.length - 1) * gap;
  const wanted = heights.reduce((a, b) => a + Math.max(0, b), 0);
  const available = Math.max(0, band.height - gaps);
  const k = wanted > 0 ? Math.min(1, available / wanted) : 0;

  const sized = heights.map((h) => Math.max(0, h) * k);
  const used = sized.reduce((a, b) => a + b, 0) + gaps;
  const x = band.x + Math.max(0, (band.width - w) / 2);
  let y = band.y + Math.max(0, (band.height - used) / 2);

  const out: Rect[] = [];
  for (const h of sized) {
    out.push({ x, y, width: w, height: h });
    y += h + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The one-primary rule
// ---------------------------------------------------------------------------

/**
 * How many `primary` plates a screen draws. Chips are excluded by construction:
 * this takes the roles of the screen's **plates**, and a chip is a different size
 * family whose "primary" is a *selected* state, not a headline action.
 */
export function countPrimaries(roles: Iterable<PlateRole>): number {
  let n = 0;
  for (const role of roles) if (role === 'primary') n++;
  return n;
}

/**
 * Whether a screen obeys the handoff's constraint: **at most one bright plate**.
 * Zero is legal (a screen may have no headline action); two is not, at any
 * viewport, on any platform.
 */
export function singlePrimary(roles: Iterable<PlateRole>): boolean {
  return countPrimaries(roles) <= 1;
}
