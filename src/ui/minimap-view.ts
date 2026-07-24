/**
 * src/ui/minimap-view.ts — the Pixi view for the minimap. OWNER: UI Engineer.
 *
 * The drawing half of the minimap (GDD §2.2 bottom-right, §2.4 ping). Every
 * decision — placement, projection, blip identity, the ping's pulse — lives in
 * the pure, unit-tested {@link ./minimap} model; this file only turns a
 * {@link MinimapModel} into Graphics.
 *
 * Two contract rules are enforced by what this file *can* draw, not just by
 * intent: a blip is a dot with an identity colour and **no HP** (enemy health is
 * scouted, never broadcast — GDD §2.2), and the ping is drawn in the pinging
 * player's colour so "look here" carries who called it (GDD §2.4). The view
 * holds two pooled Graphics — one for the static frame + blips, one for the
 * animating ping — so the ping can pulse every frame while the blips redraw only
 * when the model changes.
 *
 * Screen space, CSS px, origin top-left. {@link Hud} adds this and registers its
 * `bottom-right` rect with the layout registry.
 */

import { Container, Graphics } from 'pixi.js';
import { PALETTE } from '@render/index';
import { minimapModel } from './minimap';
import type { MinimapInput, MinimapModel, MinimapBlip } from './minimap';

/** Blip radii, CSS px. The local player's dot is bigger and ringed so you can
 *  find yourself at a glance; planets read larger than ships. */
const SHIP_RADIUS = 2;
const PLANET_RADIUS = 3.2;
const SELF_RING_RADIUS = 5;

/** A wreck is drawn dim, not dropped — you still see where it was (GDD §2.7). */
const WRECK_ALPHA = 0.3;

export class MinimapView extends Container {
  /** The frame + blips: redrawn only when the model actually changes. */
  private readonly plate = new Graphics();
  /** The ping's expanding pulse: redrawn every frame while a ping is live. */
  private readonly pingGfx = new Graphics();
  /** Signature of the last drawn static layer, so blips don't redraw per frame. */
  private plateSignature = '';

  constructor() {
    super();
    this.addChild(this.plate, this.pingGfx);
    this.visible = false;
  }

  /**
   * Draw one frame from the pure model. Hidden entirely until there is an arena
   * to show — the M1 feed carries none, so the minimap lights up the frame the
   * planets do, exactly like the rest of the M2 HUD.
   */
  update(input: MinimapInput): void {
    // No arena (M1 feed / lobby) ⇒ nothing to map. Stay hidden.
    if (input.arena.width <= 0 || input.arena.height <= 0) {
      this.visible = false;
      return;
    }
    this.visible = true;
    const model = minimapModel(input);
    this.drawPlate(model);
    this.drawPing(model);
  }

  /** The bottom-right rect the minimap occupies — the HUD registers this with the
   *  layout registry so its placement is contract-checked. */
  get bounds(): { x: number; y: number; width: number; height: number } {
    return this.lastRect;
  }
  private lastRect = { x: 0, y: 0, width: 0, height: 0 };

  private drawPlate(model: MinimapModel): void {
    // Only the blips + rect define the static layer; the ping animates separately.
    const sig = plateSignature(model);
    if (sig === this.plateSignature) return;
    this.plateSignature = sig;
    this.lastRect = model.rect;

    const { x, y, width, height } = model.rect;
    this.plate.clear();
    // Backing plate: a dark vacuum panel with a faint steel border so the map
    // reads as a distinct instrument against the world behind it.
    this.plate
      .roundRect(x, y, width, height, 4)
      .fill({ color: PALETTE.vacuum, alpha: 0.6 })
      .roundRect(x, y, width, height, 4)
      .stroke({ width: 1, color: PALETTE.hullSteel, alpha: 0.4 });

    // Planets read larger than ships (they are the map's landmarks); the local
    // player's blips get an identity ring so "where am I" is instant.
    for (const b of model.planets) this.drawBlip(b, PLANET_RADIUS);
    for (const b of model.ships) this.drawBlip(b, SHIP_RADIUS);
  }

  private drawBlip(b: MinimapBlip, radius: number): void {
    const alpha = b.alive ? 0.95 : WRECK_ALPHA;
    if (b.isSelf) {
      this.plate
        .circle(b.x, b.y, SELF_RING_RADIUS)
        .stroke({ width: 1, color: b.color, alpha: 0.9 });
    }
    this.plate.circle(b.x, b.y, radius).fill({ color: b.color, alpha });
  }

  private drawPing(model: MinimapModel): void {
    this.pingGfx.clear();
    const ping = model.ping;
    if (!ping) return;
    // An expanding, fading ring drawn in the pinging player's colour (GDD §2.4).
    this.pingGfx
      .circle(ping.x, ping.y, ping.radius)
      .stroke({ width: 1.5, color: ping.color, alpha: ping.alpha });
    // A steady centre dot anchors the pulse to the pinged point.
    this.pingGfx.circle(ping.x, ping.y, 1.5).fill({ color: ping.color, alpha: ping.alpha });
  }
}

/** The static layer's identity: its rect and every blip's position/colour/state,
 *  but not the ping (which animates every frame and is drawn separately). */
function plateSignature(model: MinimapModel): string {
  const r = model.rect;
  const blip = (b: MinimapBlip): string =>
    `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.color},${b.isSelf ? 1 : 0},${b.alive ? 1 : 0}`;
  return (
    `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}|` +
    `${model.planets.map(blip).join(';')}|${model.ships.map(blip).join(';')}`
  );
}
