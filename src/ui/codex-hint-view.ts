/**
 * src/ui/codex-hint-view.ts — the lobby's codex tooltip.
 * OWNER: Gameplay Engineer (brief c1-codex-screen; GDD §2.10 point 2).
 *
 * "The lobby reuses the same data where it answers a live question: bot dossier
 * on long-press/hover of a bot slot's name; hull description on the ship-class
 * picker. Small, non-blocking, dismissible." This is the *drawing* of that hint —
 * a compact panel (title, difficulty/hull badges, one-line summary) that floats
 * near the row it describes, clamped inside the viewport, and hides on any tap.
 * The lobby ({@link ../main} `openLobby`) resolves which hint to show via
 * {@link ./codex} `codexBotHint` / `codexShipHint` and drives {@link show} /
 * {@link hide}; this file only draws a {@link CodexHint}.
 *
 * It is a passive overlay — it never hit-tests, so it can never eat a lobby tap
 * (the whole "non-blocking" requirement): the lobby shows it on hover/long-press
 * and dismisses it the instant a real tap lands anywhere.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PALETTE } from '@render/index';
import { FONT_BODY, FONT_HEADING, TEXT_DIM, TEXT_PRIMARY } from './typography';
import type { CodexHint } from './codex';

/** The panel's fixed width band and inner padding. */
const HINT_MAX_WIDTH = 260;
const HINT_PAD = 10;
/** Kept off the screen edges by this margin when clamped. */
const HINT_MARGIN = 8;

/**
 * The lobby codex tooltip. Add once; {@link show} it near a point with a
 * {@link CodexHint}; {@link hide} it on any tap or when the pointer leaves the
 * row. Draws nothing and is invisible until shown.
 */
export class CodexHintView extends Container {
  private readonly panel = new Graphics();
  private readonly title: Text;
  private readonly badges: Text;
  private readonly summary: Text;

  constructor() {
    super();
    this.visible = false;
    this.title = makeText('', FONT_HEADING, 15, TEXT_PRIMARY);
    this.badges = makeText('', FONT_BODY, 12, PALETTE.plasma);
    this.summary = makeText('', FONT_BODY, 12, TEXT_DIM);
    for (const t of [this.title, this.badges, this.summary]) t.anchor.set(0, 0);
    this.summary.style.wordWrap = true;
    this.title.style.wordWrap = true;
    this.addChild(this.panel, this.title, this.badges, this.summary);
  }

  /** Show `hint` anchored near `(ax, ay)` (logical px), clamped inside a `w × h`
   *  viewport so it never spills off an edge. */
  show(hint: CodexHint, ax: number, ay: number, w: number, h: number): void {
    this.visible = true;
    const wrap = HINT_MAX_WIDTH - 2 * HINT_PAD;

    this.title.text = hint.title;
    this.title.style.wordWrapWidth = wrap;
    this.summary.text = hint.summary;
    this.summary.style.wordWrapWidth = wrap;

    let y = HINT_PAD;
    this.title.x = HINT_PAD;
    this.title.y = y;
    y += this.title.height + 4;

    if (hint.badges.length > 0) {
      this.badges.visible = true;
      this.badges.text = hint.badges.join('   ·   ');
      this.badges.x = HINT_PAD;
      this.badges.y = y;
      y += this.badges.height + 4;
    } else {
      this.badges.visible = false;
    }

    this.summary.x = HINT_PAD;
    this.summary.y = y;
    y += this.summary.height + HINT_PAD;

    const panelW = HINT_MAX_WIDTH;
    const panelH = y;
    this.panel.clear();
    this.panel
      .roundRect(0, 0, panelW, panelH, 6)
      .fill({ color: PALETTE.vacuum, alpha: 0.97 })
      .roundRect(0, 0, panelW, panelH, 6)
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.5 });

    // Anchor above-left of the point, then clamp into the viewport.
    let x = ax - panelW / 2;
    let py = ay - panelH - HINT_MARGIN;
    if (py < HINT_MARGIN) py = ay + HINT_MARGIN; // no room above → below the point
    x = clamp(x, HINT_MARGIN, Math.max(HINT_MARGIN, w - panelW - HINT_MARGIN));
    py = clamp(py, HINT_MARGIN, Math.max(HINT_MARGIN, h - panelH - HINT_MARGIN));
    this.x = x;
    this.y = py;
  }

  hide(): void {
    this.visible = false;
  }
}

function makeText(text: string, fontFamily: string, fontSize: number, fill: number): Text {
  return new Text({ text, style: { fontFamily, fontSize, fill, letterSpacing: 0.4 } });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
