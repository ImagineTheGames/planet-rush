/**
 * src/ui/peer-presence-view.ts — the pooled Pixi layer that draws the peer
 * presence banner. OWNER: UI Engineer (a0-76).
 *
 * The drawing half of {@link ./peer-presence}. It takes the transition lines the
 * pure model produced and paints each as a two-token row —
 * **`P3` — `CONNECTION LOST · BOT FLYING`** — stacked under the wave clock, top
 * centre, where the player already looks for match state (GDD §2.2).
 *
 * **Two tokens, two jobs.** The seat's name draws in that seat's own identity
 * colour (style-guide §3.1, the same hue as its ship trim, its beacon ring and
 * its nameplate) so the line ties to a ship on screen without the player having
 * to translate a number; the fact behind it draws in the muted HUD grey, because
 * it is a machine fact and neither ore nor damage — signal yellow and threat red
 * are RESERVED (style-guide §2.1) and a peer's socket is neither.
 *
 * **What gets dropped first when the room runs out.** A phone is 320–390 px wide
 * and the row can carry two facts. The secondary one — `· BOT FLYING` — is
 * dropped before the line is, because *who dropped* outranks *who is flying their
 * ship*; only if the name and its reason still do not fit inside the HUD margin
 * is the whole line culled. That is what keeps the layer's `full` + `PAD`
 * registration honest rather than hopeful (the discipline
 * {@link ./nameplates-view} and the loot tell already keep).
 *
 * Typography: **Oxanium** at the eyebrow size (style-guide §5.6/§7 — legible at
 * 12 px), read from {@link ./typography} rather than spelled here.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { PLAYER_COLORS } from '@render/index';
import type { AnchorSpec, LayoutEntry, Rect, Viewport } from '@platform/layout-registry';
import type { PlayerId } from '@shared/types';
import type { PresenceTell } from './peer-presence';
import { TEXT_MUTED } from './chrome';
import { drawScrim, hudTracking, SCRIM } from './instrument';
import { FONT_BODY } from './typography';

/** Layout-registry id for the banner (one entry, the union of its lines). */
export const PRESENCE_ID = 'peer-presence';
/**
 * `full` + a real margin, on exactly the reasoning `onboarding` registers that
 * way (see `hud.ts` `describeLayout`): the GDD makes no positional claim about a
 * peer-presence tell — it is new — so `top-center` would be a claim *this* file
 * invented, and the band is intrinsically wider than a third-width zone anyway.
 * What the design does promise is that a tell the player cannot read is a tell
 * that did not fire, so the honest contract is "never leaves the HUD margin",
 * and the cull below is what makes it true.
 */
export const PRESENCE_ANCHOR: AnchorSpec = { region: 'full', margin: 0 };

/** Gap between the name and the fact behind it, CSS px. The em dash that opens
 *  the fact token does most of the separating; this is the breathing room around
 *  it (GDD §4.7 — `—` separates a fact from its reason). */
export const PRESENCE_TOKEN_GAP = 6;
/** How far the band's own scrim reaches past its rows, CSS px — the same horizontal
 *  padding the wave clock's chrome uses, so the two darknesses read as one column
 *  rather than as two lozenges of different widths. */
export const PRESENCE_SCRIM_PAD_X = 24;
/** …and above/below, so the darkness starts before the type does. */
export const PRESENCE_SCRIM_PAD_Y = 4;
/** How much dimmer the fact is than the name it trails — the same recessive step
 *  a nameplate's difficulty tag takes, so the eye lands on the seat first. */
export const PRESENCE_REASON_ALPHA = 0.85;

/** One line the layer actually drew this frame (post-cull) — the `?debug=1`
 *  live-stage seam and `hud.test.ts` read it back, so "the HUD named them" is an
 *  assertion rather than a screenshot someone has to catch in five seconds. */
export interface DrawnPresenceLine {
  seat: PlayerId;
  /** The whole row as drawn, INCLUDING or EXCLUDING the clause per the cull. */
  text: string;
  /** The name token alone. */
  name: string;
  /** The primary fact — `CONNECTION LOST`, `BACK`, … — never the clause. */
  reason: string;
  /** The secondary clause AS DRAWN: `BOT FLYING` / `BOT OUT`, or `''` when there
   *  was none or when it was dropped for want of width. */
  clause: string;
  /** True when a clause existed and the row was too wide to carry it. */
  clauseDropped: boolean;
  /** The identity colour the name drew in. */
  color: number;
  alpha: number;
  /** Row left edge and top, screen space, CSS px. */
  x: number;
  y: number;
  width: number;
}

export class PeerPresenceView extends Container {
  /**
   * The band's own darkness, drawn behind the rows.
   *
   * Not decoration: the banner sits over the asteroid field, and a muted grey
   * fact over a lit rock is a fact the player cannot read — which, per GDD §2.10's
   * own rule, is a tell that did not fire. It is a SCRIM and not a plate
   * ({@link ./instrument} — no plates over gameplay), drawn inside the band's own
   * rect so the layer's registered footprint stays what it draws.
   */
  private readonly scrim = new Graphics();
  private scrimKey = '';
  private readonly names: Text[] = [];
  private readonly reasons: Text[] = [];
  private drawnBounds: Rect | null = null;
  private readonly drawn: DrawnPresenceLine[] = [];
  private drawnCount = 0;
  private fontSize = 12;

  /** Re-derive the type size for the current HUD frame scale. Called from the
   *  HUD's own `applyTypeScale`, so the banner shrinks with everything else on a
   *  phone rather than staying at desktop pixels. */
  setTypeScale(px: number): void {
    if (px === this.fontSize) return;
    this.fontSize = px;
    const tracking = hudTracking('name', px);
    for (const t of this.names) {
      t.style.fontSize = px;
      t.style.letterSpacing = tracking;
    }
    for (const t of this.reasons) {
      t.style.fontSize = px;
      t.style.letterSpacing = hudTracking('eyebrow', px);
    }
  }

  /**
   * Draw one frame of the banner.
   *
   * `centerX` / `top` / `leading` come from {@link ./hud-geometry} `presenceBand`,
   * which places the stack under the wave clock's own scrim; `margin` is the HUD
   * margin the rows must stay inside.
   */
  update(
    lines: readonly PresenceTell[],
    place: { readonly x: number; readonly y: number; readonly leading: number },
    viewportWidth: number,
    margin: number,
  ): void {
    let drawn = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const line of lines) {
      const name = this.nameSlot(drawn);
      const reason = this.reasonSlot(drawn);
      if (name.text !== line.name) name.text = line.name;

      // Full row first; drop the secondary clause only if the full one will not
      // fit inside the margin. Measured on the real Text, never estimated.
      // The separator rides the muted half, exactly as the loot tell's middot
      // does: punctuation is chrome, never identity (style-guide §2).
      const full = line.clause ? `— ${line.reason} · ${line.clause}` : `— ${line.reason}`;
      if (reason.text !== full) reason.text = full;
      let width = name.width + PRESENCE_TOKEN_GAP + reason.width;
      let clauseDropped = false;
      const budget = viewportWidth - 2 * margin;
      if (width > budget && line.clause) {
        reason.text = `— ${line.reason}`;
        width = name.width + PRESENCE_TOKEN_GAP + reason.width;
        clauseDropped = true;
      }

      const height = Math.max(name.height, reason.height);
      const left = place.x - width / 2;
      const top = place.y + drawn * place.leading;
      // A line that still does not fit is culled whole: a half-row that reads
      // `P3 — CONNECTION L` is worse than silence, and a rect over the margin
      // would break the `full` + PAD contract above.
      if (left < margin || left + width > viewportWidth - margin) {
        name.visible = false;
        reason.visible = false;
        continue;
      }

      name.visible = true;
      name.tint = PLAYER_COLORS[line.seat % PLAYER_COLORS.length] ?? 0xdce3ec;
      name.alpha = line.alpha;
      name.position.set(left, top);

      reason.visible = true;
      reason.tint = TEXT_MUTED;
      reason.alpha = line.alpha * PRESENCE_REASON_ALPHA;
      reason.position.set(left + name.width + PRESENCE_TOKEN_GAP, top);

      this.record(drawn, line, {
        text: `${line.name} ${reason.text}`,
        reason: line.reason,
        clause: clauseDropped ? '' : line.clause,
        clauseDropped,
        color: name.tint as number,
        x: left,
        y: top,
        width,
      });
      drawn++;

      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (left + width > maxX) maxX = left + width;
      if (top + height > maxY) maxY = top + height;
    }

    this.hideFrom(drawn);
    this.drawnCount = drawn;
    this.drawnBounds =
      drawn > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
    this.visible = drawn > 0;
    this.drawChrome(lines);
  }

  /** Redraw the band's scrim to fit what drew, and only when that rect moves —
   *  a fading row changes its alpha sixty times a second and its geometry never. */
  private drawChrome(lines: readonly PresenceTell[]): void {
    const b = this.drawnBounds;
    if (!b) {
      this.scrim.clear();
      this.scrimKey = '';
      return;
    }
    this.ensureScrim();
    const x = b.x - PRESENCE_SCRIM_PAD_X;
    const y = b.y - PRESENCE_SCRIM_PAD_Y;
    const w = b.width + PRESENCE_SCRIM_PAD_X * 2;
    const h = b.height + PRESENCE_SCRIM_PAD_Y * 2;
    const key = `${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${Math.round(h)}`;
    if (key !== this.scrimKey) {
      this.scrim.clear();
      drawScrim(this.scrim, x, y, w, h, 'center', SCRIM.corner);
      this.scrimKey = key;
    }
    // The darkness fades with the loudest row it is under, so the whole cluster
    // leaves together instead of a scrim outliving its own text.
    this.scrim.alpha = lines.reduce((a, l) => Math.max(a, l.alpha), 0);
  }

  /** The lines that actually drew last frame, post-cull. */
  debugLines(): DrawnPresenceLine[] {
    return this.drawn.slice(0, this.drawnCount).map((d) => ({ ...d }));
  }

  /** The union rect of the rows drawn this frame, or nothing when none did —
   *  self-registering, like the health bars and the nameplates, because the
   *  footprint is not one child's `getBounds()`. */
  describeLayout(_viewport: Viewport): LayoutEntry[] {
    const b = this.drawnBounds;
    if (!b || !this.visible) return [];
    return [{ id: PRESENCE_ID, anchor: PRESENCE_ANCHOR, bounds: { ...b } }];
  }

  // --- pools ---------------------------------------------------------------

  private nameSlot(i: number): Text {
    let t = this.names[i];
    if (!t) {
      t = this.makeText('name');
      this.names[i] = t;
      this.addChild(t);
    }
    return t;
  }

  /** The scrim is added on first draw so it lands UNDER every pooled Text —
   *  Pixi draws children in order, and the rows are added as they are needed. */
  private ensureScrim(): void {
    if (this.scrim.parent === this) return;
    this.addChildAt(this.scrim, 0);
  }

  private reasonSlot(i: number): Text {
    let t = this.reasons[i];
    if (!t) {
      t = this.makeText('eyebrow');
      this.reasons[i] = t;
      this.addChild(t);
    }
    return t;
  }

  private makeText(tier: 'name' | 'eyebrow'): Text {
    return new Text({
      text: '',
      style: {
        fontFamily: FONT_BODY,
        fontSize: this.fontSize,
        fontWeight: tier === 'name' ? 'bold' : 'normal',
        fill: 0xffffff, // white glyph, tinted per row — a re-tint costs no raster
        letterSpacing: hudTracking(tier, this.fontSize),
      },
    });
  }

  private hideFrom(i: number): void {
    for (let k = i; k < this.names.length; k++) {
      const n = this.names[k];
      const r = this.reasons[k];
      if (n) n.visible = false;
      if (r) r.visible = false;
    }
  }

  private record(
    i: number,
    line: PresenceTell,
    drawn: Omit<DrawnPresenceLine, 'seat' | 'name' | 'alpha'>,
  ): void {
    const rec: DrawnPresenceLine = {
      seat: line.seat,
      name: line.name,
      alpha: line.alpha,
      ...drawn,
    };
    this.drawn[i] = rec;
  }
}
