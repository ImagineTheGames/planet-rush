/**
 * src/render/build-badge.ts — the in-game BUILD BADGE. OWNER: Platform Engineer.
 *
 * The visible half of build identity (`@platform/build-info`): a tiny tag in the
 * bottom-right corner reading `"<sha> · <HH:MM>Z"`, always on, in every build.
 * The developer's ask was blunt — from a screenshot or a phone held across the
 * room, you must be able to say *which build that is*. So it is never hidden
 * behind `?debug=1`: a build you can't identify is exactly the build you're
 * about to waste an hour on. The single exception is `?freeze=1` (main.ts),
 * where the frame must be byte-deterministic for golden screenshots and a stamp
 * that changes every commit is precisely what determinism cannot have.
 *
 * Style (style-guide §1/§2): muted **hull steel** `#7E8894` at low alpha —
 * present, ignorable, and pointedly **NOT signal yellow** (RESERVED: ore or
 * danger only) nor threat red. Set in a mono face, unlike any HUD element: this
 * is a developer instrument, not game chrome, and a sha wants fixed advance
 * width. It never overlaps the HUD's own corners (§ bottom-right is minimap
 * territory only from day 2; the badge sits inside the corner margin under it).
 *
 * Render discipline (GDD §4.3): the text is built **once** — the stamp cannot
 * change at runtime — and per frame the layer only writes `x`/`y`. No geometry
 * rebuild, no allocation, nothing measured per frame.
 */

import { Container, Text } from 'pixi.js';
import { BUILD_INFO, formatBuildBadge } from '@platform/build-info';
import type { BuildInfo } from '@platform/build-info';
import type { AnchorSpec, Rect } from '@platform/layout-registry';
import { PALETTE } from './index';

/** Registry id — the layout registry asserts this element's placement. */
export const BADGE_ID = 'build-badge';

/** Inset from the bottom and right viewport edges, CSS px. */
export const BADGE_MARGIN = 8;

/** Declared placement (layout-registry vocabulary): bottom-right corner. */
export const BADGE_ANCHOR: AnchorSpec = { region: 'bottom-right', margin: BADGE_MARGIN };

/** Tiny — legible at arm's length, invisible to the eye that isn't looking. */
export const BADGE_FONT_SIZE = 10;

/** Muted: readable against Vacuum, never competing with the HUD. */
export const BADGE_ALPHA = 0.55;

/** IBM-mono-ish stack; self-hosted faces are for game chrome, this is a stamp. */
export const BADGE_FONT = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Where the badge's rect sits for a given viewport and measured text size: hugging
 * the bottom-right corner, inset by {@link BADGE_MARGIN} on both edges. Pure and
 * allocation-free (writes into `out`) so placement is unit-testable without a
 * canvas — the text metrics come in as numbers.
 */
export function writeBadgeRect(textW: number, textH: number, viewportW: number, viewportH: number, out: Rect): Rect {
  out.width = textW;
  out.height = textH;
  out.x = viewportW - BADGE_MARGIN - textW;
  out.y = viewportH - BADGE_MARGIN - textH;
  return out;
}

/**
 * The badge layer. Add once to the stage (above the world, below any overlay),
 * then call {@link update} each frame with the viewport size.
 */
export class BuildBadge extends Container {
  /** The stamp being displayed — handed to the debug hook and tests. */
  readonly info: BuildInfo;

  private readonly stamp: Text;
  /** Reused bounds record; handed to the layout registry, which copies it. */
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(info: BuildInfo = BUILD_INFO) {
    super();
    this.info = info;
    this.stamp = new Text({
      text: formatBuildBadge(info),
      style: {
        fontFamily: BADGE_FONT,
        fontSize: BADGE_FONT_SIZE,
        fill: PALETTE.hullSteel,
        letterSpacing: 0.5,
      },
    });
    // Bottom-right origin: positioning is then one subtraction per axis.
    this.stamp.anchor.set(1, 1);
    this.stamp.alpha = BADGE_ALPHA;
    // The badge is decoration for humans, never a hit target for thumbs.
    this.eventMode = 'none';
    this.addChild(this.stamp);
  }

  /** Re-corner the badge for the current viewport (CSS px). Per-frame safe. */
  update(viewportW: number, viewportH: number): void {
    this.stamp.x = viewportW - BADGE_MARGIN;
    this.stamp.y = viewportH - BADGE_MARGIN;
  }

  /** This frame's actual rendered rect, for the layout registry. Measured from
   *  the real text metrics, so a font that renders wider than expected shows up
   *  as drift instead of hiding behind an assumed size. */
  layoutBounds(viewportW: number, viewportH: number): Rect {
    return writeBadgeRect(this.stamp.width, this.stamp.height, viewportW, viewportH, this.rect);
  }
}
