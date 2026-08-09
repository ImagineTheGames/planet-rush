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

import type { Rect, Viewport } from '@platform/layout-registry';
import { TOUCH_MIN, beamContentInset, frameMetrics, plateHeight } from '../art/materials';
import type { BeamKind, FrameMetrics, PlateRole, PlateScale } from '../art/materials';
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

  return { metrics, header, footer, content, band };
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
  const overflow = Math.max(0, height - (frame.footer.height + m.gutter));
  const bottom = frame.footer.y + frame.footer.height;
  // Centred in the beam where it fits; bottom-aligned and growing up where it does
  // not — never past the safe-area edge below it.
  const y = Math.min(strip.y + (strip.height - height) / 2, bottom - height);
  const w = Math.max(0, Math.min(width, strip.width));
  const x = align === 'leading' ? strip.x : strip.x + strip.width - w;
  return { rect: { x, y, width: w, height }, overflow };
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
