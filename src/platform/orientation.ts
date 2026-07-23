/**
 * src/platform/orientation.ts — portrait handling. OWNER: Platform Engineer.
 *
 * Planet Rush is a landscape game; a phone held in portrait is unplayable
 * (milestone-1 phone gap #2). Two paths, chosen by capability, both routed
 * through the platform seam so no game code touches a bare browser global
 * (GDD §4.1, mobile amendment §2):
 *
 *  - **Android (lock supported):** on the first touch gesture, enter fullscreen
 *    and lock to landscape — best-effort, never throws ({@link requestLandscape}).
 *  - **iOS Safari (lock unsupported):** locking is impossible, so when the
 *    viewport is portrait we show a full-screen ROTATE-YOUR-DEVICE overlay
 *    ({@link RotateOverlay}), dismissed automatically the moment the device turns
 *    landscape. Visibility is the pure {@link shouldShowRotateOverlay} decision.
 *
 * Orientation lock is itself cuttable (GDD §4.9) — every call degrades to a
 * no-op where unsupported; the overlay is the fallback that survives the cut.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Platform } from './platform';

// ---------------------------------------------------------------------------
// The pure decision (GDD §4.9 — overlay is the no-lock fallback)
// ---------------------------------------------------------------------------

/**
 * Whether to show the ROTATE overlay. Only where orientation lock is *not*
 * available (iOS Safari) and the viewport is portrait — on a platform that can
 * lock (Android) we lock to landscape instead, so the overlay never shows there.
 * Square (w === h) counts as landscape-enough: not blocked.
 */
export function shouldShowRotateOverlay(
  innerWidth: number,
  innerHeight: number,
  canLock: boolean,
): boolean {
  if (canLock) return false;
  return innerHeight > innerWidth;
}

// ---------------------------------------------------------------------------
// First-gesture landscape request (Android path)
// ---------------------------------------------------------------------------

/**
 * On the first touch gesture: enter fullscreen, then lock to landscape. Both go
 * through the platform seam and swallow their own rejections, so this never
 * throws into the gesture handler (mobile amendment §2). Fire-and-forget.
 */
export function requestLandscape(platform: Platform): void {
  void platform
    .requestFullscreen()
    .then(() => platform.lockOrientation('landscape'))
    .catch(() => {
      /* both calls already degrade to no-ops; this guards the chain itself */
    });
}

// ---------------------------------------------------------------------------
// The overlay (iOS Safari fallback)
// ---------------------------------------------------------------------------

/** Chalk-white body text (NOT signal yellow — RESERVED, style-guide §2). */
const TEXT_CHALK = 0xdce3ec;
const FONT_HEADING = 'Audiowide, "Trebuchet MS", sans-serif';

/**
 * A full-screen "ROTATE YOUR DEVICE" overlay in the frozen palette (style-guide
 * §1: vacuum background, plasma glyph + text). Built once; {@link setShown}
 * toggles it and {@link resize} re-lays it out on orientationchange. Hidden by
 * default so it never flashes on desktop or in landscape.
 */
export class RotateOverlay extends Container {
  private readonly bg = new Graphics();
  private readonly glyph = new Graphics();
  private readonly title: Text;
  private readonly hint: Text;

  constructor(width: number, height: number) {
    super();
    this.visible = false;

    // Rotating-phone glyph: a portrait phone body with a curved arrow sweeping
    // it toward landscape — plasma line-art, drawn once and centred via resize().
    drawRotatingPhone(this.glyph);

    this.title = new Text({
      text: 'ROTATE YOUR DEVICE',
      style: { fontFamily: FONT_HEADING, fontSize: 22, fill: 0x4dc3ff, fontWeight: 'bold', letterSpacing: 1.5 },
    });
    this.hint = new Text({
      text: 'Planet Rush plays in landscape',
      style: { fontFamily: FONT_HEADING, fontSize: 13, fill: TEXT_CHALK, letterSpacing: 0.5 },
    });
    this.title.anchor.set(0.5);
    this.hint.anchor.set(0.5);

    this.addChild(this.bg, this.glyph, this.title, this.hint);
    this.resize(width, height);
  }

  /** Show or hide the overlay (driven by {@link shouldShowRotateOverlay}). */
  setShown(shown: boolean): void {
    this.visible = shown;
  }

  /** Re-fill the backdrop and re-centre the contents for a new viewport size —
   *  called on resize / orientationchange so the canvas re-layouts (gap #2). */
  resize(width: number, height: number): void {
    // Opaque vacuum backdrop — fully covers the game beneath (style-guide §1).
    this.bg.clear();
    this.bg.rect(0, 0, width, height).fill({ color: PALETTE_VACUUM, alpha: 0.97 });

    const cx = width / 2;
    const cy = height / 2;
    this.glyph.position.set(cx, cy - 40);
    this.title.position.set(cx, cy + 56);
    this.hint.position.set(cx, cy + 86);
  }
}

/** Vacuum background hex as a Pixi number (style-guide §1). Local copy so the
 *  overlay carries no import cycle through the render layer. */
const PALETTE_VACUUM = 0x0d1015;
const PLASMA = 0x4dc3ff;

/** Draw a portrait phone with a curved rotate-arrow, once, centred on (0,0). */
function drawRotatingPhone(g: Graphics): void {
  // Phone body, tilted slightly to imply motion.
  g.roundRect(-22, -38, 44, 76, 8).stroke({ width: 3, color: PLASMA, alpha: 0.9 });
  g.rect(-14, -26, 28, 48).stroke({ width: 1.5, color: PLASMA, alpha: 0.4 }); // screen
  // A curved arrow arcing over the top — the "rotate" motion cue.
  g.arc(0, 0, 58, Math.PI * 1.15, Math.PI * 1.75).stroke({ width: 3, color: PLASMA, alpha: 0.7 });
  // Arrowhead at the arc's leading end.
  const ax = Math.cos(Math.PI * 1.75) * 58;
  const ay = Math.sin(Math.PI * 1.75) * 58;
  g.moveTo(ax, ay).lineTo(ax - 10, ay - 2).moveTo(ax, ay).lineTo(ax - 2, ay - 12).stroke({
    width: 3,
    color: PLASMA,
    alpha: 0.7,
  });
}
