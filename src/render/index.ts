/**
 * src/render/ — the PixiJS render layer. OWNER: Platform Engineer.
 *
 * Draws the deterministic sim state to a WebGL2 canvas (GDD §4.1, §4.3). This
 * layer *reads* sim state and never writes it; the sim never imports PixiJS.
 *
 * Discipline (GDD §4.3, risk 5): sprites are **pooled and reused** — the hot,
 * many-entity paths (asteroids, ore chunks) allocate their Graphics once and per
 * frame only touch transforms (position / scale / tint), never geometry, so the
 * frame loop makes zero per-frame allocations. Ships (≤8) get one Graphics each,
 * with player-identity colour baked in (hull stays steel — style guide §3). The
 * beam is a handful of short-lived lines redrawn each frame.
 *
 * Placeholder shapes stand in until art lands (GDD §2.4 day-1: "placeholder
 * triangle ok"): a steel triangle ship with a player-colour cockpit, grey rocks
 * that darken as they crack, signal-yellow ore chunks, a plasma beam line.
 */

import { Container, Graphics } from 'pixi.js';
import type { PlayerId, Vec2 } from '@shared/types';
import { writeCameraOffset } from '@platform/camera';
import type { Viewport } from '@platform/camera';
import type { Asteroid, OreChunk, Ship, World } from '../sim/state';

// ---------------------------------------------------------------------------
// Palette (frozen — style-guide.md §1 / §3.1). Hex as PixiJS numbers.
// ---------------------------------------------------------------------------

/** The six Cold Vacuum material colours (style-guide §1). */
export const PALETTE = {
  vacuum: 0x0d1015,
  hullSteel: 0x7e8894,
  patina: 0x4fa08b,
  signalYellow: 0xf2d24b, // RESERVED: ore or danger only (style-guide §2)
  plasma: 0x4dc3ff,
  threatRed: 0xb23a3a,
} as const;

/** The 8-slot player-identity roster (style-guide §3.1), indexed by PlayerId. */
export const PLAYER_COLORS: readonly number[] = [
  0x3d7bff, // P1 Azure
  0x22d3c5, // P2 Cyan
  0x3dd68c, // P3 Spring
  0x9b5de5, // P4 Violet
  0xf15bb5, // P5 Magenta
  0xff8a3d, // P6 Orange
  0xdce3ec, // P7 Chalk
  0x5c6ce0, // P8 Slate-Blue
];

function playerColor(id: number): number {
  return PLAYER_COLORS[id % PLAYER_COLORS.length] ?? PALETTE.hullSteel;
}

// ---------------------------------------------------------------------------
// A beam segment to draw this frame (computed by the caller from fire intent —
// the sim state doesn't record a beam, so render is told where it goes).
// ---------------------------------------------------------------------------

export interface BeamView {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly color: number;
  /** Where the beam struck (asteroid/ship surface), or `null` on a clean miss
   *  that runs the full range. A pooled plasma impact glow is drawn here when
   *  present; `to` already ends at this point (sim clamps it — GDD §4.1). */
  readonly hit: Vec2 | null;
}

/** What the renderer needs beyond the world to draw one frame. */
export interface RenderView {
  /** The player whose ship the camera follows (centered on screen). */
  readonly cameraTarget: PlayerId;
  /** Active beam segments this frame (usually ≤ number of ships). */
  readonly beams: readonly BeamView[];
}

// ---------------------------------------------------------------------------
// A simple index pool: keep N reusable children in a container, hide the rest.
// ---------------------------------------------------------------------------

class GraphicsPool {
  private readonly items: Graphics[] = [];

  constructor(
    private readonly layer: Container,
    private readonly make: () => Graphics,
  ) {}

  /** The i-th pooled graphic, creating it (once) if the pool must grow. */
  at(i: number): Graphics {
    let g = this.items[i];
    if (!g) {
      g = this.make();
      this.items[i] = g;
      this.layer.addChild(g);
    }
    g.visible = true;
    return g;
  }

  /** Hide every pooled graphic from `count` onward (reused, not destroyed). */
  hideFrom(count: number): void {
    for (let i = count; i < this.items.length; i++) {
      const g = this.items[i];
      if (g) g.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Unit-shape factories (drawn once at unit scale; sized per frame via transform)
// ---------------------------------------------------------------------------

function makeUnitRock(): Graphics {
  // Unit circle (r=1); neutral grey mineral body (style-guide §6). Crack stage
  // reads as a darker rock via alpha against near-black Vacuum.
  return new Graphics().circle(0, 0, 1).fill(0x9199a1);
}

function makeUnitChunk(): Graphics {
  // Ore chunk — signal yellow (RESERVED rule: ore, style-guide §2).
  return new Graphics().circle(0, 0, 1).fill(PALETTE.signalYellow);
}

// Impact flare radius (world units) at the beam's hit point. Punchy but small
// so it reads as a torch bite, not an explosion (style-guide §8 "bright, punchy").
const IMPACT_RADIUS = 7;

function makeImpactGlow(): Graphics {
  // Plasma cutting-torch impact (style-guide §1 Plasma, RESERVED energy hue).
  // Soft outer halo + a bright core, drawn once at unit radius and scaled per
  // frame via transform so the hot path stays allocation-free (GDD §4.3 risk 5).
  const g = new Graphics();
  g.circle(0, 0, 1).fill({ color: PALETTE.plasma, alpha: 0.35 }); // halo
  g.circle(0, 0, 0.45).fill({ color: PALETTE.plasma, alpha: 0.95 }); // core
  return g;
}

function makeShip(id: number): Graphics {
  // Placeholder triangle pointing +x (angle 0 faces +x, matching the sim). Hull
  // stays steel; the cockpit carries player identity (style-guide §3 rule 2).
  const g = new Graphics();
  g.poly([1.0, 0.0, -0.7, 0.62, -0.7, -0.62]).fill(PALETTE.hullSteel);
  g.circle(0.15, 0, 0.28).fill(playerColor(id)); // cockpit = player colour
  return g;
}

// Crack-stage alpha: an intact rock is solid; a cracked one reads darker
// against Vacuum as it's mined out (style-guide §5.5, three stages).
const CRACK_ALPHA = [1, 0.78, 0.56];

// Module-level scratch point for the camera target, so centerCamera passes the
// target to the pure camera math without allocating a Vec2 each frame (GDD §4.3).
const TARGET_SCRATCH: Vec2 = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export class Renderer {
  /** World-space root; the camera moves this so the target ship stays centered. */
  private readonly worldRoot = new Container();
  private readonly asteroidLayer = new Container();
  private readonly chunkLayer = new Container();
  private readonly beamLayer = new Container();
  private readonly impactLayer = new Container();
  private readonly shipLayer = new Container();

  private readonly asteroidPool: GraphicsPool;
  private readonly chunkPool: GraphicsPool;
  private readonly beamPool: GraphicsPool;
  private readonly impactPool: GraphicsPool;
  /** Ships keyed by PlayerId (≤ 8), colour baked in — not an index pool. */
  private readonly shipGfx: Graphics[] = [];

  /** When true, shed the non-load-bearing VFX (impact glows) to buy back frame
   *  time on a struggling device. Driven by the platform's auto-reducer on a
   *  sustained drop below the fps floor (GDD §4.3, risk 5 "reduce VFX"). The
   *  readable tells — beam line, ships, ore — always draw; only decoration goes. */
  private reduceVfx = false;

  /** The visible viewport the camera centres on. This is the *visual* viewport
   *  (URL-bar / notch / fullscreen aware), not the raw canvas — see camera.ts.
   *  Mutated whole via {@link setViewport}; read every frame in centerCamera. */
  private viewport: Viewport;
  /** Reused scratch so centerCamera allocates nothing per frame (GDD §4.3). */
  private readonly offsetScratch: Vec2 = { x: 0, y: 0 };

  constructor(stage: Container, viewport: Viewport) {
    this.viewport = viewport;

    // Back to front: rocks, chunks, beams, impact glows (over the beam end),
    // ships. Labels aid the layout registry + render tests.
    this.beamLayer.label = 'beams';
    this.impactLayer.label = 'impacts';
    this.worldRoot.addChild(
      this.asteroidLayer,
      this.chunkLayer,
      this.beamLayer,
      this.impactLayer,
      this.shipLayer,
    );
    stage.addChild(this.worldRoot);

    this.asteroidPool = new GraphicsPool(this.asteroidLayer, makeUnitRock);
    this.chunkPool = new GraphicsPool(this.chunkLayer, makeUnitChunk);
    this.beamPool = new GraphicsPool(this.beamLayer, () => new Graphics());
    this.impactPool = new GraphicsPool(this.impactLayer, makeImpactGlow);
  }

  /** Point the camera at a new visible viewport (resize / orientationchange /
   *  fullscreen / URL-bar reflow). DPR is handled by the Application's
   *  `autoDensity`, so the viewport is in CSS pixels. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Toggle reduced-VFX mode (GDD §4.3). Cheap and idempotent — the flag is read
   *  in {@link draw}; nothing is created or destroyed, so it can flip any frame. */
  setReduceVfx(on: boolean): void {
    this.reduceVfx = on;
  }

  /** The screen position (canvas-local CSS px) a world point draws at this frame,
   *  read from the *actual* worldRoot transform. The debug instrument
   *  (debug-hook.ts) projects the local ship through this so QA asserts against
   *  what is really on screen, not a recomputed ideal. Call after {@link draw}. */
  projectToScreen(world: Vec2, out: Vec2): Vec2 {
    out.x = this.worldRoot.x + world.x;
    out.y = this.worldRoot.y + world.y;
    return out;
  }

  /** Draw one frame from read-only sim state. Allocation-free on the hot paths. */
  draw(world: World, view: RenderView): void {
    this.centerCamera(world, view.cameraTarget);
    this.drawAsteroids(world.asteroids);
    this.drawChunks(world.chunks);
    this.drawShips(world.ships);
    this.drawBeams(view.beams);
  }

  private centerCamera(world: World, targetId: PlayerId): void {
    const target = world.ships.find((s) => s.id === targetId) ?? world.ships[0];
    const cx = target ? target.pos.x : world.bounds.width / 2;
    const cy = target ? target.pos.y : world.bounds.height / 2;
    // Offset worldRoot so the target lands at the *visible* viewport centre — not
    // the canvas centre, which drifts off-screen on mobile (camera.ts).
    TARGET_SCRATCH.x = cx;
    TARGET_SCRATCH.y = cy;
    writeCameraOffset(this.offsetScratch, TARGET_SCRATCH, this.viewport);
    this.worldRoot.x = this.offsetScratch.x;
    this.worldRoot.y = this.offsetScratch.y;
  }

  private drawAsteroids(asteroids: readonly Asteroid[]): void {
    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i]!;
      const g = this.asteroidPool.at(i);
      g.x = a.pos.x;
      g.y = a.pos.y;
      g.scale.set(a.radius);
      g.alpha = CRACK_ALPHA[a.crackStage] ?? CRACK_ALPHA[0]!;
    }
    this.asteroidPool.hideFrom(asteroids.length);
  }

  private drawChunks(chunks: readonly OreChunk[]): void {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const g = this.chunkPool.at(i);
      g.x = c.pos.x;
      g.y = c.pos.y;
      g.scale.set(c.radius);
    }
    this.chunkPool.hideFrom(chunks.length);
  }

  private drawShips(ships: readonly Ship[]): void {
    for (const ship of ships) {
      let g = this.shipGfx[ship.id];
      if (!g) {
        g = makeShip(ship.id);
        this.shipGfx[ship.id] = g;
        this.shipLayer.addChild(g);
      }
      if (!ship.alive) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.x = ship.pos.x;
      g.y = ship.pos.y;
      g.rotation = ship.angle;
      g.scale.set(ship.radius);
      // Spawn-protected ships read as translucent (placeholder for the glow VFX).
      g.alpha = ship.spawnProtect > 0 ? 0.5 : 1;
    }
  }

  private drawBeams(beams: readonly BeamView[]): void {
    // A beam that hits ends at its impact point and gets a plasma glow there; a
    // clean miss runs full range with no glow (GDD §4.1). Glows are pooled
    // separately since only some beams strike — index them independently.
    let glows = 0;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i]!;
      const g = this.beamPool.at(i);
      g.clear();
      g.moveTo(b.from.x, b.from.y).lineTo(b.to.x, b.to.y).stroke({ width: 3, color: b.color, cap: 'round' });
      // The beam line always draws (it is the mining/attack tell); the impact
      // glow is decoration, so it is the first thing reduce-VFX sheds (§4.3).
      if (b.hit && !this.reduceVfx) {
        const glow = this.impactPool.at(glows++);
        glow.x = b.hit.x;
        glow.y = b.hit.y;
        glow.scale.set(IMPACT_RADIUS);
      }
    }
    this.beamPool.hideFrom(beams.length);
    this.impactPool.hideFrom(glows);
  }
}
