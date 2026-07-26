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
 * with player-identity colour baked in (hull stays steel — style guide §3).
 * Turret muzzle flashes are a handful of short-lived lines redrawn each frame.
 *
 * Placeholder shapes stand in until art lands (GDD §2.4 day-1: "placeholder
 * triangle ok"): a steel triangle ship with a player-colour cockpit, grey rocks
 * that darken as they crack, signal-yellow ore chunks, plasma muzzle flashes, and
 * planets as patina discs with a player-colour beacon ring and a signal-yellow
 * core (GDD §5.4 — the art pass replaces the shapes, not the layers).
 *
 * **Fog is drawn, not just simulated.** A rival planet's damage ring appears
 * only while the camera's ship is inside `SENSOR_RANGE` of it (GDD §2.2:
 * "enemy planet health is scouted, not broadcast"). Your own home always shows
 * its ring — it is your home.
 */

import { Container, Graphics } from 'pixi.js';
import type { PlayerId, ShipClass, Vec2 } from '@shared/types';
import { writeCameraOffset } from '@platform/camera';
import type { Viewport } from '@platform/camera';
import { SENSOR_RANGE } from '../sim/constants';
import type { Asteroid, OreChunk, Planet, Projectile, Ship, World } from '../sim/state';
import { shipSprite } from '../art/ships';
import { spriteGraphics } from '../art/textures';

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
// A muzzle-flash segment to draw this frame (mapped by the caller from the sim's
// `muzzleFlashes` read model — one short line per turret that fired this tick).
// ---------------------------------------------------------------------------

export interface MuzzleView {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly color: number;
  /** Where the shot is aimed (the tracked ship's surface), or `null` on a clean
   *  miss that runs the full range. A pooled plasma impact glow is drawn here
   *  when present; `to` already ends at this point (sim clamps it — GDD §4.1). */
  readonly hit: Vec2 | null;
}

/** What the renderer needs beyond the world to draw one frame. */
export interface RenderView {
  /** The player whose ship the camera follows (centered on screen). */
  readonly cameraTarget: PlayerId;
  /** Active muzzle-flash segments this frame (one per turret that fired). */
  readonly muzzles: readonly MuzzleView[];
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

// Impact flare radius (world units) at the muzzle flash's hit point. Punchy but small
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

function makeUnitTurret(): Graphics {
  // Placeholder cannon at unit radius, barrel along +x (matching `turret.angle`).
  // Steel, like every hull — ownership is read off the planet it stands on
  // (style-guide §3 rule 2: player colour never lands on structure).
  const g = new Graphics();
  g.rect(0, -0.3, 2.0, 0.6).fill(0x5d6672); // barrel, darker steel
  g.circle(0, 0, 1).fill(PALETTE.hullSteel); // mount
  return g;
}

function makeUnitShot(): Graphics {
  // Turret shot — threat red, the colour of enemy fire (style-guide §1).
  return new Graphics().circle(0, 0, 1).fill(PALETTE.threatRed);
}

/**
 * Pixels-per-unit the ship hull is drawn at before the per-frame `scale.set`.
 * Drawing above 1 keeps thin outline strokes from hitting `drawSprite`'s 0.5px
 * floor; `drawShips` divides it back out so the hull still lands at `ship.radius`.
 */
const SHIP_ART_SCALE = 64;

function makeShip(id: number, shipClass: ShipClass): Graphics {
  // The real hull, from the art pipeline (src/art/ships) — no longer a
  // placeholder. Drawn once at SHIP_ART_SCALE and then only transformed per
  // frame, so the pooling discipline (GDD §4.3) is unchanged. The hull stays
  // steel; player colour rides the trim, cockpit and number decal (style-guide
  // §3), and the silhouette is the class tell (GDD §2.11).
  return spriteGraphics(shipSprite({ shipClass, playerId: id }), SHIP_ART_SCALE);
}

// Crack-stage alpha: an intact rock is solid; a cracked one reads darker
// against Vacuum as it's mined out (style-guide §5.5, three stages).
const CRACK_ALPHA = [1, 0.78, 0.56];

// Module-level scratch point for the camera target, so centerCamera passes the
// target to the pure camera math without allocating a Vec2 each frame (GDD §4.3).
const TARGET_SCRATCH: Vec2 = { x: 0, y: 0 };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Whether `viewer` is close enough to read `planet`'s health (GDD §2.2, §2.8 —
 *  sensor range is 2× the shield radius). Squared compare, no square roots
 *  (GDD §4.1). Measured to the planet's surface, so a big body is legible from
 *  the same standoff distance a small one is. */
function withinSensorRange(viewer: { pos: Vec2 }, planet: Planet): boolean {
  const dx = planet.pos.x - viewer.pos.x;
  const dy = planet.pos.y - viewer.pos.y;
  const reach = SENSOR_RANGE + planet.radius;
  return dx * dx + dy * dy <= reach * reach;
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export class Renderer {
  /** World-space root; the camera moves this so the target ship stays centered. */
  private readonly worldRoot = new Container();
  /** The arena boundary — the wall the sim clamps every ship against
   *  (`step.ts` integrate). It is a blocking volume like a planet, so it is
   *  drawn like one: without it the play-field edge is an invisible wall a
   *  player crashes into "beside their planet" (which sits right on it). */
  private readonly boundaryLayer = new Container();
  private readonly planetLayer = new Container();
  private readonly turretLayer = new Container();
  private readonly asteroidLayer = new Container();
  private readonly chunkLayer = new Container();
  private readonly muzzleLayer = new Container();
  private readonly impactLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly shotLayer = new Container();

  private readonly asteroidPool: GraphicsPool;
  private readonly chunkPool: GraphicsPool;
  private readonly muzzlePool: GraphicsPool;
  private readonly impactPool: GraphicsPool;
  private readonly turretPool: GraphicsPool;
  private readonly shotPool: GraphicsPool;
  /** Ships keyed by PlayerId (≤ 8), colour baked in — not an index pool. */
  private readonly shipGfx: Graphics[] = [];
  /** A planet's static body: disc, beacon ring, core. Keyed by planet index
   *  (≤ 8, and planets never move), redrawn only when the planet becomes a
   *  wreck — which happens at most once each, all match (GDD §2.7). */
  private readonly planetGfx: Graphics[] = [];
  /** Whether `planetGfx[i]` was last drawn as a wreck, so the redraw above
   *  happens on the transition and on no other frame. */
  private readonly planetDrawnDead: boolean[] = [];
  /** A planet's live overlay: shield bubble, construction arc, damage ring.
   *  One Graphics per planet, redrawn per frame — eight of them, and every one
   *  is a handful of arcs. */
  private readonly planetOverlay: Graphics[] = [];
  /** The arena boundary, drawn once. Static — the play bounds never move — so it
   *  is redrawn only if the bounds themselves change (they don't mid-match). */
  private boundaryGfx: Graphics | null = null;
  private boundaryW = -1;
  private boundaryH = -1;

  /** When true, shed the non-load-bearing VFX (impact glows) to buy back frame
   *  time on a struggling device. Driven by the platform's auto-reducer on a
   *  sustained drop below the fps floor (GDD §4.3, risk 5 "reduce VFX"). The
   *  readable tells — muzzle flashes, ships, ore — always draw; only decoration goes. */
  private reduceVfx = false;

  /** The visible viewport the camera centres on. This is the *visual* viewport
   *  (URL-bar / notch / fullscreen aware), not the raw canvas — see camera.ts.
   *  Mutated whole via {@link setViewport}; read every frame in centerCamera. */
  private viewport: Viewport;
  /** Reused scratch so centerCamera allocates nothing per frame (GDD §4.3). */
  private readonly offsetScratch: Vec2 = { x: 0, y: 0 };

  constructor(stage: Container, viewport: Viewport) {
    this.viewport = viewport;

    // Back to front: planets (the map's furniture — big, static, and behind
    // everything that moves over them), turrets mounted on them, rocks, chunks,
    // muzzle flashes, impact glows (over the flash end), ships, turret shots.
    // Labels aid the layout registry + render tests.
    this.boundaryLayer.label = 'boundary';
    this.planetLayer.label = 'planets';
    this.turretLayer.label = 'turrets';
    this.asteroidLayer.label = 'asteroids';
    this.chunkLayer.label = 'chunks';
    this.muzzleLayer.label = 'muzzles';
    this.impactLayer.label = 'impacts';
    this.shipLayer.label = 'ships';
    this.shotLayer.label = 'shots';
    this.worldRoot.addChild(
      this.boundaryLayer, // behind everything: the wall the arena is drawn inside
      this.planetLayer,
      this.turretLayer,
      this.asteroidLayer,
      this.chunkLayer,
      this.muzzleLayer,
      this.impactLayer,
      this.shipLayer,
      this.shotLayer,
    );
    stage.addChild(this.worldRoot);

    this.asteroidPool = new GraphicsPool(this.asteroidLayer, makeUnitRock);
    this.chunkPool = new GraphicsPool(this.chunkLayer, makeUnitChunk);
    this.muzzlePool = new GraphicsPool(this.muzzleLayer, () => new Graphics());
    this.impactPool = new GraphicsPool(this.impactLayer, makeImpactGlow);
    this.turretPool = new GraphicsPool(this.turretLayer, makeUnitTurret);
    this.shotPool = new GraphicsPool(this.shotLayer, makeUnitShot);
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
    this.drawBoundary(world.bounds);
    this.drawPlanets(world, view.cameraTarget);
    this.drawAsteroids(world.asteroids);
    this.drawChunks(world.chunks);
    this.drawShips(world.ships);
    this.drawShots(world.projectiles);
    this.drawMuzzles(view.muzzles);
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

  /**
   * The arena wall (GDD §4.1 — the sim clamps every ship inside `world.bounds`).
   * It is as much a blocking volume as a planet, so it gets a drawn surface: the
   * field report was a ship crashing into the invisible right edge "beside my
   * planet" — planets are pinned right against this wall (`createWorld`), so the
   * boundary and the home read as one place, and one of them was never drawn.
   *
   * Static, so it is stroked once and only redrawn if the bounds change (they do
   * not mid-match) — no per-frame allocation on this path (GDD §4.3).
   */
  private drawBoundary(bounds: World['bounds']): void {
    if (this.boundaryGfx && this.boundaryW === bounds.width && this.boundaryH === bounds.height) return;
    let g = this.boundaryGfx;
    if (!g) {
      g = new Graphics();
      g.label = 'boundary-wall';
      this.boundaryGfx = g;
      this.boundaryLayer.addChild(g);
    }
    this.boundaryW = bounds.width;
    this.boundaryH = bounds.height;

    // A double steel frame at the play edge: hull steel is structure, never a
    // player colour (style-guide §3), and never signal yellow (reserved for ore
    // / danger, §2). Dim, so it marks the limit without competing with the
    // entities that move against it — the read is "the world ends here."
    g.clear();
    g.rect(0, 0, bounds.width, bounds.height).stroke({ width: 4, color: PALETTE.hullSteel, alpha: 0.5 });
    g.rect(6, 6, bounds.width - 12, bounds.height - 12).stroke({
      width: 1,
      color: PALETTE.hullSteel,
      alpha: 0.25,
    });
  }

  /**
   * The eight homes (GDD §2.1) and everything standing on them: the body, the
   * owner's beacon ring, the signal-yellow core, the shield bubble, construction
   * in progress, and the scouted damage ring.
   *
   * `viewerId`'s ship is the eye: a rival's damage ring is drawn only while that
   * ship is inside `SENSOR_RANGE` of the planet (GDD §2.2 — health you earn by
   * scouting). Your own home is always legible, because it is yours.
   */
  private drawPlanets(world: World, viewerId: PlayerId): void {
    const viewer = world.ships.find((s) => s.id === viewerId);
    let turrets = 0;

    for (let i = 0; i < world.planets.length; i++) {
      const planet = world.planets[i]!;
      this.planetBody(i, planet);

      const overlay = this.overlayFor(i);
      overlay.clear();
      overlay.x = planet.pos.x;
      overlay.y = planet.pos.y;

      if (planet.alive) {
        this.drawShieldBubble(overlay, planet);
        this.drawConstruction(overlay, planet);
        // Own planet always; a rival's only from inside sensor range.
        const scouted =
          planet.owner === viewerId ||
          (viewer !== undefined && withinSensorRange(viewer, planet));
        if (scouted) this.drawDamageRing(overlay, planet, planet.owner === viewerId);
      }

      for (const turret of planet.turrets) {
        if (turret.hp <= 0) continue; // killed this tick, swept at end of step
        const g = this.turretPool.at(turrets++);
        g.x = turret.pos.x;
        g.y = turret.pos.y;
        g.rotation = turret.angle;
        g.scale.set(turret.radius);
        // Damaged turrets fade toward the vacuum rather than recolouring —
        // threat red is reserved for damage *events*, not for standing objects.
        g.alpha = 0.45 + 0.55 * clamp01(turret.hp / turret.maxHp);
      }
    }

    this.turretPool.hideFrom(turrets);
  }

  /** A planet's static body, drawn once — and again the one time it becomes a
   *  wreck (GDD §2.7: the wreck stays on the map for the rest of the match). */
  private planetBody(index: number, planet: Planet): void {
    let g = this.planetGfx[index];
    const dead = !planet.alive;
    if (g && this.planetDrawnDead[index] === dead) {
      g.alpha = planet.spawnProtect > 0 ? 0.75 : 1;
      return;
    }
    if (!g) {
      g = new Graphics();
      g.label = `planet-${index}`;
      this.planetGfx[index] = g;
      this.planetLayer.addChild(g);
    }
    this.planetDrawnDead[index] = dead;

    const r = planet.radius;
    g.clear();
    g.x = planet.pos.x;
    g.y = planet.pos.y;

    if (dead) {
      // A wreck: the ocean has gone out, the beacon is off, the core is spent.
      // Still solid, still on the map, still worth flying to for its debris.
      g.circle(0, 0, r).fill({ color: 0x2a3038, alpha: 0.95 });
      g.circle(0, 0, r).stroke({ width: 2, color: PALETTE.hullSteel, alpha: 0.35 });
      g.circle(0, 0, r * 0.34).fill({ color: 0x1a1f26 });
      g.alpha = 1;
      return;
    }

    // Earthlike inside the Cold Vacuum palette (style-guide §5.4): steel-blue
    // ocean, patina continents, and a signal-yellow core — the win condition, so
    // it obeys the yellow rule.
    g.circle(0, 0, r).fill(0x2f4a63); // ocean
    g.circle(-r * 0.3, -r * 0.25, r * 0.42).fill({ color: PALETTE.patina, alpha: 0.85 });
    g.circle(r * 0.34, r * 0.22, r * 0.3).fill({ color: PALETTE.patina, alpha: 0.7 });
    // Beacon ring: ownership, always visible (style-guide §5.4).
    g.circle(0, 0, r + 5).stroke({ width: 3, color: playerColor(planet.owner), alpha: 0.9 });
    g.circle(0, 0, r * 0.28).fill(PALETTE.signalYellow); // core
    g.alpha = planet.spawnProtect > 0 ? 0.75 : 1;
  }

  private overlayFor(index: number): Graphics {
    let g = this.planetOverlay[index];
    if (!g) {
      g = new Graphics();
      g.label = `planet-overlay-${index}`;
      this.planetOverlay[index] = g;
      this.planetLayer.addChild(g);
    }
    return g;
  }

  /** The shield bubble over the core (GDD §2.5) — one ring per generator, so a
   *  stacked pair reads as two. Brightness is the pool that is left. */
  private drawShieldBubble(g: Graphics, planet: Planet): void {
    for (let i = 0; i < planet.shields.length; i++) {
      const shield = planet.shields[i]!;
      if (shield.hp <= 1e-9) continue;
      const frac = clamp01(shield.hp / shield.maxHp);
      g.circle(0, 0, shield.radius + i * 6).stroke({
        width: 2,
        color: PALETTE.plasma,
        alpha: 0.18 + 0.5 * frac,
      });
    }
  }

  /** Construction in progress (GDD §2.5: "a turret assembles over ~10 seconds").
   *  A plasma arc just outside the body, filling as the job completes — the
   *  visible answer to "defenses are bought before the attack, not during it". */
  private drawConstruction(g: Graphics, planet: Planet): void {
    if (planet.builds.length === 0) return;
    const job = planet.builds[0]!;
    const done = job.total > 0 ? clamp01(1 - job.remaining / job.total) : 1;
    const r = planet.radius + 12;
    g.circle(0, 0, r).stroke({ width: 2, color: PALETTE.hullSteel, alpha: 0.25 });
    if (done <= 0) return;
    g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + done * 2 * Math.PI).stroke({
      width: 3,
      color: PALETTE.plasma,
      alpha: 0.9,
    });
  }

  /** The damage ring (GDD §2.2, §5.4): how much core is left, as an arc over the
   *  planet. Player colour on your own home, threat red on a scouted rival's —
   *  the same information, but yours is identity and theirs is a target. */
  private drawDamageRing(g: Graphics, planet: Planet, own: boolean): void {
    const frac = clamp01(planet.coreHp / planet.maxCoreHp);
    const r = planet.radius + 5;
    if (frac >= 1) return; // a full core says nothing worth drawing
    g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI).stroke({
      width: 4,
      color: own ? playerColor(planet.owner) : PALETTE.threatRed,
      alpha: 0.95,
    });
  }

  /** Turret shots — the pool is sparse, so skip inactive slots rather than
   *  assuming the array is dense (see {@link Projectile}). */
  private drawShots(projectiles: readonly Projectile[]): void {
    let live = 0;
    for (const p of projectiles) {
      if (!p.active) continue;
      const g = this.shotPool.at(live++);
      g.x = p.pos.x;
      g.y = p.pos.y;
      g.scale.set(p.radius);
    }
    this.shotPool.hideFrom(live);
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
        g = makeShip(ship.id, ship.shipClass);
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
      // Art is drawn at SHIP_ART_SCALE px/unit, so divide it back out to land
      // the hull at the ship's collision radius in world units.
      g.scale.set(ship.radius / SHIP_ART_SCALE);
      // Spawn-protected ships read as translucent (placeholder for the glow VFX).
      g.alpha = ship.spawnProtect > 0 ? 0.5 : 1;
    }
  }

  private drawMuzzles(muzzles: readonly MuzzleView[]): void {
    // A flash that hits ends at its impact point and gets a plasma glow there; a
    // clean miss runs full range with no glow (GDD §4.1). Glows are pooled
    // separately since only some flashes strike — index them independently.
    let glows = 0;
    for (let i = 0; i < muzzles.length; i++) {
      const m = muzzles[i]!;
      const g = this.muzzlePool.at(i);
      g.clear();
      g.moveTo(m.from.x, m.from.y).lineTo(m.to.x, m.to.y).stroke({ width: 3, color: m.color, cap: 'round' });
      // The flash line always draws (it is the turret-fire tell); the impact
      // glow is decoration, so it is the first thing reduce-VFX sheds (§4.3).
      if (m.hit && !this.reduceVfx) {
        const glow = this.impactPool.at(glows++);
        glow.x = m.hit.x;
        glow.y = m.hit.y;
        glow.scale.set(IMPACT_RADIUS);
      }
    }
    this.muzzlePool.hideFrom(muzzles.length);
    this.impactPool.hideFrom(glows);
  }
}
