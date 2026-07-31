/**
 * src/render/build-badge.ts — the PERSISTENT BUILD BADGE.
 *
 * The visible half of build identity (`@platform/build-identity`): a tiny tag in
 * the **bottom-left** corner of every screen — menu, doors, keypad, lobby, codex,
 * settings, match, match-end — reading the build, and once a session is live, the
 * server it is on:
 *
 *   offline    `3d7cc6a`
 *   connected  `3d7cc6a · d891dd0a (gru)`
 *
 * The developer's ask was blunt, twice. First: from a screenshot or a phone held
 * across the room, you must be able to say *which build that is* — so it is never
 * hidden behind `?debug=1`, because a build you can't identify is exactly the build
 * you're about to waste an hour on. Then (M10, ratified): *"it only shows in
 * matches. I want it shown on every single page — and once you connect to a
 * server, append the server you connected to and its region"*, so that region
 * selection can be verified at a glance from any screenshot. Hence ONE badge
 * component, owned by the boot path and living above every screen, rather than one
 * per screen that three of them would forget.
 *
 * The single exception is `?freeze=1` (main.ts), where the frame must be
 * byte-deterministic for golden screenshots and a stamp that changes every commit
 * is precisely what determinism cannot have.
 *
 * Style (style-guide §1/§2): muted **hull steel** `#7E8894` at low alpha —
 * present, ignorable, and pointedly **NOT signal yellow** (RESERVED: ore or
 * danger only) nor threat red. Set in a mono face, unlike any HUD element: this
 * is a developer instrument, not game chrome, and a sha wants fixed advance
 * width.
 *
 * **It never covers a control** (the m10-14 lesson: nothing may cover a button).
 * Two mechanisms, because one is not enough:
 *   - `eventMode = 'none'` — the badge is pointer-transparent, so even where it
 *     draws over something pressable, the press lands on the control.
 *   - {@link BuildBadge.lift} — in-match on desktop the controls strip owns the
 *     bottom edge, so the badge is lifted clear of it by
 *     {@link BADGE_STRIP_LIFT}. (On touch the strip is not drawn, and the left
 *     thrust-stick ghost is a circle whose bounding box stops well above the
 *     corner margin, so no lift is needed — see build-badge.test.ts, which
 *     asserts that clearance rather than assuming it.)
 *
 * Render discipline (GDD §4.3): the text is rebuilt **only** when the identity
 * changes (a connect, a disconnect — twice a session, not twice a frame), and the
 * per-frame path writes `x`/`y` and nothing else. No geometry rebuild, no
 * allocation, nothing measured per frame.
 */

import { Container, Text } from 'pixi.js';
import { buildIdentity, BuildIdentity } from '@platform/build-identity';
import type { AnchorSpec, Rect } from '@platform/layout-registry';
import { PALETTE } from './index';

/** Registry id — the layout registry asserts this element's placement. */
export const BADGE_ID = 'build-badge';

/** Inset from the bottom and left viewport edges, CSS px. */
export const BADGE_MARGIN = 8;

/** Declared placement (layout-registry vocabulary): bottom-left corner. */
export const BADGE_ANCHOR: AnchorSpec = { region: 'bottom-left', margin: BADGE_MARGIN };

/** Tiny — legible at arm's length, invisible to the eye that isn't looking. Small
 *  screens keep it readable but tiny (the ask): one size, both form factors, since
 *  the phone lays out in the same logical landscape space the desk does. */
export const BADGE_FONT_SIZE = 10;

/** Muted: readable against Vacuum, never competing with the HUD. */
export const BADGE_ALPHA = 0.55;

/** IBM-mono-ish stack; self-hosted faces are for game chrome, this is a stamp. */
export const BADGE_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Extra bottom inset applied while the desktop controls strip is drawn, CSS px.
 * The strip's own band is 18px of text 12px off the bottom edge (`@ui` hud.ts
 * `STRIP_ROW`/`STRIP_PAD`); this clears it with a hair of air, so the badge sits
 * *above* the bindings instead of through them.
 */
export const BADGE_STRIP_LIFT = 26;

/**
 * Where the badge's rect sits for a given viewport, measured text size, and lift:
 * hugging the bottom-left corner, inset by {@link BADGE_MARGIN} on both edges and
 * raised by `lift`. Pure and allocation-free (writes into `out`) so placement is
 * unit-testable without a canvas — the text metrics come in as numbers.
 */
export function writeBadgeRect(
  textW: number,
  textH: number,
  viewportW: number,
  viewportH: number,
  out: Rect,
  lift = 0,
): Rect {
  void viewportW; // left-anchored: the corner is the origin, not the far edge
  out.width = textW;
  out.height = textH;
  out.x = BADGE_MARGIN;
  out.y = viewportH - BADGE_MARGIN - textH - Math.max(0, lift);
  return out;
}

/**
 * The badge layer. Added once, to a container that sits above every screen (see
 * main.ts's `badgeRoot`), then {@link update}d with the viewport size whenever the
 * layout changes. It subscribes to the process-wide {@link BuildIdentity}, so the
 * server suffix appears the moment a session is welcomed and clears on disconnect
 * without anyone having to remember to tell the badge.
 */
export class BuildBadge extends Container {
  /** The identity being displayed — handed to the debug/live-stage seam. */
  readonly identity: BuildIdentity;

  private readonly stamp: Text;
  /** Reused bounds record; handed to the layout registry, which copies it. */
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** Bottom clearance for screen furniture below it (the controls strip). */
  private raise = 0;
  /** Last viewport we were cornered for, so a text change re-corners itself. */
  private lastW = 0;
  private lastH = 0;
  private readonly unsubscribe: () => void;

  constructor(identity: BuildIdentity = buildIdentity()) {
    super();
    this.identity = identity;
    this.stamp = new Text({
      text: identity.tag,
      style: {
        fontFamily: BADGE_FONT,
        fontSize: BADGE_FONT_SIZE,
        fill: PALETTE.hullSteel,
        letterSpacing: 0.5,
      },
    });
    // Bottom-LEFT origin: x is then the margin outright, and a tag that grows a
    // server suffix grows rightwards into empty space rather than shifting.
    this.stamp.anchor.set(0, 1);
    this.stamp.alpha = BADGE_ALPHA;
    // The badge is decoration for humans, never a hit target for thumbs.
    this.eventMode = 'none';
    this.addChild(this.stamp);
    // Fires immediately with the current tag, so this also seats the initial text.
    this.unsubscribe = identity.subscribe((tag) => {
      if (this.stamp.text === tag) return;
      this.stamp.text = tag;
      // Height can change with the glyph set; re-corner off the last known size
      // rather than waiting for the next resize to fix a one-pixel drift.
      if (this.lastH > 0) this.update(this.lastW, this.lastH);
    });
  }

  /** The string on screen right now — the live-stage seam's single read. */
  get text(): string {
    return this.stamp.text;
  }

  /** Bottom clearance, CSS px: {@link BADGE_STRIP_LIFT} while the desktop
   *  controls strip is drawn, 0 everywhere else. Idempotent. */
  set lift(px: number) {
    const next = Math.max(0, px);
    if (next === this.raise) return;
    this.raise = next;
    if (this.lastH > 0) this.update(this.lastW, this.lastH);
  }

  get lift(): number {
    return this.raise;
  }

  /** Re-corner the badge for the current viewport (CSS px). Per-frame safe. */
  update(viewportW: number, viewportH: number): void {
    this.lastW = viewportW;
    this.lastH = viewportH;
    this.stamp.x = BADGE_MARGIN;
    this.stamp.y = viewportH - BADGE_MARGIN - this.raise;
  }

  /** This frame's actual rendered rect, for the layout registry. Measured from
   *  the real text metrics, so a font that renders wider than expected shows up
   *  as drift instead of hiding behind an assumed size. */
  layoutBounds(viewportW: number, viewportH: number): Rect {
    return writeBadgeRect(this.stamp.width, this.stamp.height, viewportW, viewportH, this.rect, this.raise);
  }

  /** Detach from the identity. The game never tears the badge down (it outlives
   *  every screen); this exists so a test can build one without leaking a
   *  listener into the next. */
  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.unsubscribe();
    super.destroy(options);
  }
}
