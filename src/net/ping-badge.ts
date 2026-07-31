/**
 * src/net/ping-badge.ts — YOUR ping, in the corner of the match. OWNER: Netcode
 * Engineer (ratified developer: "in-match too, minimal: the player's OWN ping in
 * a corner of the HUD — small, mono, no box").
 *
 * The lobby shows everyone's round trip beside their name (`./ping`,
 * `src/ui/lobby-view`); this is the half that survives RUSH!. One line of mono
 * text in the bottom-left corner, stacked directly above the build stamp
 * (`@render/build-badge`) — the two developer-facing truths about a session, in
 * the one corner that holds neither a control nor a mechanic.
 *
 * Four rules it keeps, three of them borrowed from the badge it sits on:
 *
 *  1. **The same number the log prints.** It reads `./telemetry` `hudRttMs` — the
 *     last finalized second's mean round trip, exactly the `rtt` column of a
 *     pasted session log. Two instruments, one connection, one number.
 *  2. **No measurement, nothing on screen.** Offline there is no wire to time, and
 *     in the first seconds of a match there is no sample yet; both draw *nothing*
 *     rather than a `0ms` that would claim a perfect connection (`./ping` rule 1).
 *  3. **It never covers a control.** `eventMode = 'none'` makes it
 *     pointer-transparent, and it lifts clear of the desktop controls strip with
 *     the build badge it rides above (the m10-14 lesson: nothing may cover a
 *     button).
 *  4. **It costs nothing per frame.** The text is rebuilt only when the *rounded*
 *     number or its grade changes — once a second at most, and not at all on a
 *     steady connection — and the per-frame path writes `x`/`y` and nothing else.
 *
 * Colour is the grade, mapped here rather than in `./ping` so that module stays
 * free of the render layer: patina for a good trip, signal yellow for a fair one,
 * threat red for a poor one (style-guide §1). Signal yellow keeps its meaning —
 * this is the warning band, and the red one is the connection actually hurting.
 */

import { Container, Text } from 'pixi.js';
import type { AnchorSpec, Rect } from '@platform/layout-registry';
import { PALETTE } from '@render/index';
import { BADGE_FONT, BADGE_FONT_SIZE, BADGE_MARGIN } from '@render/build-badge';
import { pingReadout } from './ping';
import type { PingGrade } from './ping';

/** Registry id — the layout registry asserts this element's placement. */
export const PING_BADGE_ID = 'net-ping';

/** Declared placement: bottom-left, the same corner and inset as the build stamp
 *  it stacks above. */
export const PING_BADGE_ANCHOR: AnchorSpec = { region: 'bottom-left', margin: BADGE_MARGIN };

/**
 * How far above the build stamp this line sits, CSS px — one 10 px mono line plus
 * a hair of air. Applied by the caller on top of the build badge's own lift, so
 * the pair moves as one when the controls strip claims the bottom edge.
 */
export const PING_BADGE_STACK_LIFT = 15;

/** Muted like the build stamp — present, ignorable. The colour already carries
 *  the alarm; the alpha must not shout on top of it. */
export const PING_BADGE_ALPHA = 0.8;

/** The Cold Vacuum colour for each band (style-guide §1). Exported so the lobby
 *  row and this stamp can be asserted to grade the same connection the same
 *  colour. */
export const PING_GRADE_COLORS: Readonly<Record<PingGrade, number>> = {
  good: PALETTE.patina,
  fair: PALETTE.signalYellow,
  poor: PALETTE.threatRed,
};

/**
 * Where the stamp's rect sits for a given viewport, measured text size and lift:
 * the bottom-left corner, inset by {@link BADGE_MARGIN} on both edges and raised
 * by `lift`. Pure and allocation-free (writes into `out`) so placement is
 * unit-testable with no canvas — the text metrics arrive as numbers.
 */
export function writePingRect(
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
 * The in-match ping stamp. Added once to the layer that sits above the world
 * (main.ts's `badgeRoot`), told the viewport when the layout changes, and handed
 * a round trip — or null — every frame.
 */
export class PingBadge extends Container {
  private readonly stamp: Text;
  /** Reused bounds record; handed to the layout registry, which copies it. */
  private readonly rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** Bottom clearance for the screen furniture below (the build stamp, and under
   *  it the desktop controls strip). */
  private raise = 0;
  private lastW = 0;
  private lastH = 0;
  /** The rounded number on screen, or null while nothing is shown — the guard
   *  that keeps a steady connection from touching Pixi text at all. */
  private shownMs: number | null = null;

  constructor() {
    super();
    this.stamp = new Text({
      text: '',
      style: {
        fontFamily: BADGE_FONT,
        fontSize: BADGE_FONT_SIZE,
        fill: PING_GRADE_COLORS.good,
        letterSpacing: 0.5,
      },
    });
    // Bottom-LEFT origin, like the build stamp: x is the margin outright, and a
    // number that grows a digit grows rightwards instead of shifting the corner.
    this.stamp.anchor.set(0, 1);
    this.stamp.alpha = PING_BADGE_ALPHA;
    // Decoration for humans, never a hit target for thumbs.
    this.eventMode = 'none';
    this.visible = false;
    this.addChild(this.stamp);
  }

  /** The string on screen right now — empty while nothing is shown. */
  get text(): string {
    return this.visible ? this.stamp.text : '';
  }

  /** Bottom clearance, CSS px: the build badge's own lift plus
   *  {@link PING_BADGE_STACK_LIFT}. Idempotent. */
  set lift(px: number) {
    const next = Math.max(0, px);
    if (next === this.raise) return;
    this.raise = next;
    if (this.lastH > 0) this.update(this.lastW, this.lastH);
  }

  get lift(): number {
    return this.raise;
  }

  /**
   * Show this round trip (ms), or nothing at all when it is null — the whole of
   * rule 2. Per-frame safe: a value that rounds to the number already on screen
   * costs one comparison and touches neither the text nor its style.
   */
  setRtt(rttMs: number | null): void {
    const readout = pingReadout(rttMs);
    if (!readout) {
      this.shownMs = null;
      this.visible = false;
      return;
    }
    this.visible = true;
    if (readout.ms === this.shownMs) return;
    this.shownMs = readout.ms;
    this.stamp.text = readout.label;
    this.stamp.style.fill = PING_GRADE_COLORS[readout.grade];
  }

  /** Re-corner the stamp for the current viewport (CSS px). Per-frame safe. */
  update(viewportW: number, viewportH: number): void {
    this.lastW = viewportW;
    this.lastH = viewportH;
    this.stamp.x = BADGE_MARGIN;
    this.stamp.y = viewportH - BADGE_MARGIN - this.raise;
  }

  /** This frame's actual rendered rect, for the layout registry — measured from
   *  the real text metrics, so a wider-than-expected glyph set shows up as drift
   *  rather than hiding behind an assumed size. */
  layoutBounds(viewportW: number, viewportH: number): Rect {
    return writePingRect(this.stamp.width, this.stamp.height, viewportW, viewportH, this.rect, this.raise);
  }
}
