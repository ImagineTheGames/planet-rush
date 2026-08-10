/**
 * src/render/ — the PixiJS render layer. OWNER: Platform Engineer.
 *
 * Draws the deterministic sim state to a WebGL2 canvas (GDD §4.1, §4.3). This
 * layer *reads* sim state and never writes it; the sim never imports PixiJS.
 *
 * Discipline (GDD §4.3, risk 5): sprites are **pooled and reused** — the hot,
 * many-entity paths (asteroids, ore chunks) allocate their display object once
 * and per frame only touch transforms (position / scale / tint), never geometry,
 * so the frame loop makes zero per-frame allocations. Ships (≤8) get one Graphics
 * each, with player-identity colour baked in (hull stays steel — style guide §3).
 * Turret muzzle flashes are a handful of short-lived lines redrawn each frame.
 *
 * **And the three densest layers share TEXTURES, not just geometry (a1-11).**
 * Rocks, turrets and shots are pooled `Sprite`s over a handful of baked textures
 * — §4.3's "instanced sprites", the half of the budget this layer used to skip.
 * a1-10 measured what skipping it cost on the §4.3 stress scene: the 200-rock
 * layer alone was 26.1 ms and **200 draw calls** as one `Graphics` per rock,
 * against 3.9 ms and 1.8 draw calls over 46 shared textures
 * (`docs/atlas-pooling-measured.md`). Pooling geometry is not pooling submission:
 * Pixi issues one draw call per `Graphics` however much geometry they share, and
 * a rock's veins and cracks clear the batcher's vertex threshold every time.
 *
 * Three things make that swap a pixel-for-pixel one rather than a re-authoring,
 * and they are the reason the goldens moved by as little as they did:
 *
 *  - **The bake density is the draw density.** Each look is baked at exactly the
 *    pixels-per-unit the direct path rasterised at (`ROCK_ART_SCALE` and friends),
 *    so the sprite's per-frame scale is the very `radius / ART_SCALE` the
 *    `Graphics` carried. Every entity minifies and none is ever magnified.
 *  - **The bake is framed on the art's ORIGIN**, not cropped to its bounding box
 *    ({@link CenteredBaker}) — otherwise an asymmetric silhouette would draw off
 *    where it collides.
 *  - **There is one draw path, not two.** The renderer always draws sprites; what
 *    is injected is the *baker*. Without one it bakes blank textures of the right
 *    size, so a headless suite asserts the same scene graph players get and only
 *    the pixels are absent — which is the one thing it never asserted anyway.
 *
 * Placeholder shapes stand in until art lands (GDD §2.4 day-1: "placeholder
 * triangle ok"): a steel triangle ship with a player-colour cockpit, grey rocks
 * that darken as they crack, signal-yellow ore chunks, plasma muzzle flashes, and
 * stations as patina discs with a player-colour beacon ring and a signal-yellow
 * core (GDD §5.4 — the art pass replaces the shapes, not the layers).
 *
 * **Fog is drawn, not just simulated** — but station HEALTH is not fog (GDD §2.2,
 * amended 2026-08-07; a0-05). Every station this layer draws gets its damage
 * ring, at every range, whoever owns it. The ring is drawn in world units at a
 * fixed width and the camera is translate-only (no zoom), so the far read is
 * pixel-identical to the near one. What is still fogged is the *minimap*
 * (`sim/sensing` coverage) and enemy **ship** hulls, which are drawn only on
 * screen.
 */

import { Container, Graphics, Rectangle, Sprite, Texture, TextureSource } from 'pixi.js';
import { UpgradeTrack } from '@shared/types';
import type { PlayerId, ShipClass, Vec2 } from '@shared/types';
import { writeCameraOffset } from '@platform/camera';
import type { Viewport } from '@platform/camera';
import { TURRET, TURRET_MAX_TIER, turretTierShotDamage } from '../sim/constants';
import { inAtmosphere, turretHomeAngle, turretOrbitPos } from '../sim/buildings';
import { areEnemies } from '../sim/allegiance';
import { stationHealthVisible } from '../sim/sensing';
import type { Asteroid, OreChunk, MiningStation, Projectile, Ship, World } from '../sim/state';
import { atmosphereHaloSprite, beaconRingSprite, stationSprite, stationVariantFor } from '../art/stations';
import { stationWreckSprite } from '../art/wrecks';
import { asteroidArt, asteroidTexture } from '../art/atlas';
import { shipSprite } from '../art/ships';
import { turretSprite, shieldSprite, shieldStrength, type TurretState } from '../art/buildings';
import { shotSprite, type ShotFamily } from '../art/vfx/shots';
import type { SpriteDef } from '../art/shapes';
import { SpriteTextureCache, drawSprite, spriteGraphics, type TextureBaker } from '../art/textures';
import { ARENA_WALL_BANDS, VoidBackdrop } from '../art/backdrop';

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
  /** Flare stroke width (world units) — the muzzle scales with the firing turret's
   *  DAMAGE tier (RATIFIED p11-06, "muzzle flash scales with it"): a Mk III barrel
   *  spits a fatter blast than a Mk I. Optional so an untiered caller (a test
   *  fixture, a wire-decoded flash) still reads as the base flare. */
  readonly width?: number;
}

/** What the renderer needs beyond the world to draw one frame. */
export interface RenderView {
  /** The player whose ship the camera follows (centered on screen). */
  readonly cameraTarget: PlayerId;
  /** Active muzzle-flash segments this frame (one per turret that fired). */
  readonly muzzles: readonly MuzzleView[];
  /**
   * The map this world was built from (`sim/maps.ts` id) — which is what picks
   * the backdrop's sky (a0-07, `../art/backdrop` `MAP_NEBULA`: a map's sky is
   * part of its identity, like its layout). Optional and last-wins: `World`
   * itself does not carry its map id, so the caller that chose the map passes it
   * here, and an omitted one falls back to the default map's sky rather than to
   * a blank one — a harness or a test fixture keeps working unchanged.
   */
  readonly mapId?: string;
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

/**
 * The same pool, over `Sprite`s — the textured-quad half of GDD §4.3's
 * "instanced sprites". A slot's texture is swapped only when its entity's *look*
 * changes (the key guards below); a steady frame writes position, rotation,
 * scale and alpha and nothing else, so the layer submits one batched quad per
 * entity instead of one draw call each.
 *
 * Anchored at the centre because the sprite IR's origin is the entity's centre
 * (`../art/shapes` unit space) and {@link CenteredBaker} keeps the bake square
 * about that origin — so anchor 0.5 puts the art exactly where the collider is.
 */
class SpritePool {
  private readonly items: Sprite[] = [];

  constructor(private readonly layer: Container) {}

  /** The i-th pooled sprite, creating it (once) if the pool must grow. */
  at(i: number): Sprite {
    let s = this.items[i];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.items[i] = s;
      this.layer.addChild(s);
    }
    s.visible = true;
    return s;
  }

  /** Hide every pooled sprite from `count` onward (reused, not destroyed). */
  hideFrom(count: number): void {
    for (let i = count; i < this.items.length; i++) {
      const s = this.items[i];
      if (s) s.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Baking: sim look → one shared texture
// ---------------------------------------------------------------------------

/**
 * What this layer needs from PixiJS in order to bake. `pixi.js`'s `Renderer`
 * satisfies it structurally (that is what `main.ts` passes); a test double
 * satisfies it in four lines.
 *
 * It is `../art/textures`'s `TextureBaker` plus the one option that interface
 * does not carry — `frame`, the region to rasterise. {@link CenteredBaker} needs
 * it and Art's cache is not this layer's file to widen.
 */
export interface EntityTextureBaker {
  generateTexture(options: {
    target: Container;
    frame?: Rectangle;
    resolution?: number;
    antialias?: boolean;
  }): Texture;
}

/** Options for {@link Renderer}. Both default to the headless behaviour, so an
 *  existing two-argument caller (every render unit test) is unchanged. */
export interface RendererOptions {
  /** Bakes the pooled entity textures. Pass `app.renderer`. Omitted ⇒ the
   *  correctly-sized blank textures a headless suite draws with. */
  readonly baker?: EntityTextureBaker;
  /** Device pixel ratio to bake at. `Math.min(devicePixelRatio, 2)` in `main.ts`. */
  readonly resolution?: number;
}

/**
 * Margin baked around a look's declared half-extent. `drawSprite` strokes on the
 * path centre-line and floors thin widths at half a pixel, so a shape that
 * reaches the declared extent overhangs it by half its stroke; without the
 * margin the outermost hairline would be clipped by the frame. It costs
 * transparent texels and no screen area — the sprite scales by the *nominal*
 * size, so the margin lands outside the art exactly as it does in the vectors.
 */
const BAKE_MARGIN = 1.08;

/**
 * Bakes a look into a texture framed **symmetrically about the art's origin**.
 *
 * `SpriteTextureCache` asks for `generateTexture({ target })`, which crops to the
 * target's local bounds. Cropped, the sprite's centre is its bounding box's
 * centre — and an asteroid silhouette is not symmetric, so the rock would draw a
 * pixel or so off the position it collides at, differently per seed. Passing an
 * explicit square `frame` makes the texture's centre the sprite IR's origin, by
 * construction and for every look.
 *
 * {@link frameFor} is set immediately before each cache lookup. That is safe
 * because a bake only ever happens *inside* that lookup, synchronously, and on a
 * cache hit it is simply unread.
 */
class CenteredBaker implements TextureBaker {
  private half = 0;

  constructor(
    private readonly inner: EntityTextureBaker | undefined,
    private readonly resolution: number,
  ) {}

  /** Frame the next bake to a `px`-square about the origin, plus the margin. */
  frameFor(px: number): void {
    this.half = Math.ceil((px * BAKE_MARGIN) / 2);
  }

  generateTexture(options: { target: Container; resolution?: number; antialias?: boolean }): Texture {
    const size = this.half * 2;
    const resolution = options.resolution ?? this.resolution;
    if (!this.inner) {
      // Headless: no WebGL, so no raster — but a `TextureSource` is plain data,
      // and a blank one of the right size gives the pooled sprite the bounds,
      // and therefore the drawn size, it will have in the browser.
      return new Texture({ source: new TextureSource({ width: size, height: size, resolution }) });
    }
    return this.inner.generateTexture({
      target: options.target,
      frame: new Rectangle(-this.half, -this.half, size, size),
      resolution,
      antialias: options.antialias ?? true,
    });
  }
}

// ---------------------------------------------------------------------------
// Unit-shape factories (drawn once at unit scale; sized per frame via transform)
// ---------------------------------------------------------------------------

/**
 * Pixels-per-unit asteroid art is rasterised at before the per-frame `scale.set`,
 * matching the ships' trick: drawing above 1 keeps thin vein/crack strokes off
 * `drawSprite`'s 0.5px floor, and `drawAsteroids` divides it back out so the
 * rock still lands at `asteroid.radius` world units.
 *
 * It is also the **bake density** (a1-11): the pooled texture is rasterised at
 * this many pixels per art unit, which is what makes the pooled rock the same
 * picture the direct-drawn one was. 64 px/unit against `ASTEROID.maxRadius` 46
 * means the largest rock on screen is still a minification of its texture.
 */
const ROCK_ART_SCALE = 64;

/** Pixels-per-unit the turret/scaffold art is rasterised at before the per-frame
 *  `scale.set` back down to `turret.radius`. Above 1 so the thin trim/panel
 *  strokes (~0.03–0.05 unit) clear `drawSprite`'s 0.5px floor and stay crisp —
 *  and, as above, the density the pooled texture is baked at (`TURRET.radius` is
 *  12, so a turret is a 4× minification of its own texture). */
const TURRET_ART_SCALE = 48;

function makeUnitChunk(): Graphics {
  // Ore chunk — signal yellow (RESERVED rule: ore, style-guide §2).
  return new Graphics().circle(0, 0, 1).fill(PALETTE.signalYellow);
}

// Impact flare radius (world units) at the muzzle flash's hit point. Punchy but small
// so it reads as a torch bite, not an explosion (style-guide §8 "bright, punchy").
const IMPACT_RADIUS = 7;

// The atmosphere halo's breath (radians/sec). Keyed to sim time, not the wall
// clock, so the frozen golden stays deterministic (goldens.spec.ts). ~4.5s
// period — slow enough to read as breathing air, not a pulsing UI ring.
const ATMOSPHERE_BREATH_RATE = 1.4;

function makeImpactGlow(): Graphics {
  // Plasma cutting-torch impact (style-guide §1 Plasma, RESERVED energy hue).
  // Soft outer halo + a bright core, drawn once at unit radius and scaled per
  // frame via transform so the hot path stays allocation-free (GDD §4.3 risk 5).
  const g = new Graphics();
  g.circle(0, 0, 1).fill({ color: PALETTE.plasma, alpha: 0.35 }); // halo
  g.circle(0, 0, 0.45).fill({ color: PALETTE.plasma, alpha: 0.95 }); // core
  return g;
}

/**
 * Pixels-per-unit a shot's ramp sprite is baked at before the per-frame
 * `scale.set`. Its unit space is authored so radius `1` is the projectile's
 * collision radius (the glow overhangs it); `drawShots` divides this back out so
 * the shot still lands at `projectile.radius` world units. Above 1 for the same
 * reason the ship/rock scales are: keep the baked geometry off any sub-pixel floor.
 */
const SHOT_ART_SCALE = 16;

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


// Module-level scratch point for the camera target, so centerCamera passes the
// target to the pure camera math without allocating a Vec2 each frame (GDD §4.3).
const TARGET_SCRATCH: Vec2 = { x: 0, y: 0 };

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The shooter's DAMAGE tier for a shot (RATIFIED p11-06) — what the ramp tints by.
 * Read from sim state, so the tint is stamped from the truth at spawn and never
 * from input: a **ship** shot wears its owner's DAMAGE (`Power`) upgrade tier; a
 * **turret** shot wears the Mk the barrel fired at, recovered from the per-shot
 * `damage` the sim derived from that tier (`turretTierShotDamage`, ≤3 rungs, an
 * exact match since both sides compute it from the same constants). An untagged /
 * wire-decoded shot (`kind` absent) reads as a turret shot, the sim's own default,
 * and a shot whose shooter is somehow gone reads as tier 0 — never a crash. The
 * art ramp clamps whatever tier this returns into its rungs.
 */
function shotTier(world: World, p: Projectile): number {
  if (p.kind === 'ship') {
    const owner = world.ships.find((s) => s.id === p.owner);
    return owner ? owner.tiers[UpgradeTrack.Power] : 0;
  }
  for (let tier = TURRET_MAX_TIER; tier >= 0; tier--) {
    if (turretTierShotDamage(tier) === p.damage) return tier;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export class Renderer {
  /** The void (a2-06, re-grounded a0-07): the Floor ground plane, a layered
   *  parallax star-field with seeded-scatter bloom, and the map's own sky, drawn
   *  in *screen* space behind the world so it scrolls at a fraction of the
   *  camera — depth the fleet flies against. The look and the geometry live in
   *  the art layer (`../art/backdrop`); the renderer only places it behind the
   *  world and feeds it three things it already has: the camera offset, the VFX
   *  tier, and which map is being played. */
  private readonly backdrop = new VoidBackdrop();
  /** World-space root; the camera moves this so the target ship stays centered. */
  private readonly worldRoot = new Container();
  /** The arena boundary — the wall the sim clamps every ship against
   *  (`step.ts` integrate). It is a blocking volume like a station, so it is
   *  drawn like one: without it the play-field edge is an invisible wall a
   *  player crashes into "beside their station" (which sits right on it). */
  private readonly boundaryLayer = new Container();
  /** The atmosphere halos — behind the stations they ring, so a home's air sits
   *  under its own furniture (body, turrets, overlay). Only own stations fill it. */
  private readonly atmosphereLayer = new Container();
  private readonly stationLayer = new Container();
  private readonly turretLayer = new Container();
  private readonly asteroidLayer = new Container();
  private readonly chunkLayer = new Container();
  private readonly muzzleLayer = new Container();
  private readonly impactLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly shotLayer = new Container();

  private readonly asteroidPool: SpritePool;
  /** The look-key held by each pooled rock, so its texture is swapped only on change. */
  private readonly asteroidKeys: string[] = [];
  /** World units per texture pixel for the look in each rock slot — the sprite's
   *  scale is this times the rock's collision radius. Cached per slot rather than
   *  looked up per frame so a 200-rock field reads one array entry each. */
  private readonly asteroidUnits: number[] = [];
  private readonly chunkPool: GraphicsPool;
  private readonly muzzlePool: GraphicsPool;
  private readonly impactPool: GraphicsPool;
  private readonly turretPool: SpritePool;
  /** The (silhouette, state, owner) held by each turret slot, so its texture is
   *  swapped only when the read changes — steady state stays allocation-free, the
   *  same discipline the rock pool uses (GDD §4.3). */
  private readonly turretKeys: string[] = [];
  private readonly turretUnits: number[] = [];
  /** Construction scaffolds (the `building` art) — one per in-progress turret job,
   *  placed on the reserved mount so the finished gun lands where the frame stood. */
  private readonly scaffoldPool: SpritePool;
  private readonly scaffoldKeys: string[] = [];
  private readonly scaffoldUnits: number[] = [];
  private readonly shotPool: SpritePool;
  /** The `${family}:${tier}` shot look held by each shot slot, so the DAMAGE-tier
   *  ramp texture is swapped only when a slot's shot changes side or tier (the
   *  asteroid-pool discipline) — a firefight stays transform-only per frame. */
  private readonly shotKeys: string[] = [];
  private readonly shotUnits: number[] = [];

  /** The shared texture pool the three dense layers draw from (GDD §4.3). One
   *  texture per distinct look; ~46 carry a 200-rock field, ~24 all 32 turrets. */
  private readonly textures: SpriteTextureCache;
  /** The framing wrapper around whatever bakes those textures. */
  private readonly baker: CenteredBaker;
  /** A look's authored half-extent, remembered so sizing a bake never re-runs a
   *  generator on a cache hit. See {@link extentOf}. */
  private readonly extents = new Map<string, number>();
  /** Ships keyed by PlayerId (≤ 8), colour baked in — not an index pool. */
  private readonly shipGfx: Graphics[] = [];
  /** A station's static body: disc, beacon ring, core. Keyed by station index
   *  (≤ 8, and stations never move), redrawn only when the station becomes a
   *  wreck — which happens at most once each, all match (GDD §2.7). */
  private readonly stationGfx: Graphics[] = [];
  /** Whether `stationGfx[i]` was last drawn as a wreck, so the redraw above
   *  happens on the transition and on no other frame. */
  private readonly stationDrawnDead: boolean[] = [];
  /** A station's live overlay: shield bubble, construction arc, damage ring.
   *  One Graphics per station, redrawn per frame — eight of them, and every one
   *  is a handful of arcs. */
  private readonly stationOverlay: Graphics[] = [];
  /** A station's atmosphere halo, keyed by station index. Only the viewer's OWN
   *  station gets one (the halo is the deposit affordance — you cannot deposit at
   *  a rival's). Built once from the art pipeline, then only positioned and faded
   *  per frame; the owner it was built for is remembered so it is never rebuilt. */
  private readonly stationHalo: (Graphics | null)[] = [];
  private readonly stationHaloOwner: PlayerId[] = [];
  /** The VFX tier each halo was baked at (0 full, 1 reduced), so a flip of
   *  {@link reduceVfx} rebuilds it into the other look (full gradient ⇄ simpler
   *  ring) instead of leaving a stale texture. `undefined` = never built. */
  private readonly stationHaloReduced: number[] = [];
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

  constructor(stage: Container, viewport: Viewport, options: RendererOptions = {}) {
    this.viewport = viewport;
    this.baker = new CenteredBaker(options.baker, options.resolution ?? 1);
    this.textures = new SpriteTextureCache(this.baker, options.resolution ?? 1);

    // Back to front: your home's atmosphere halo (behind its own station),
    // stations (the map's furniture — big, static, and behind
    // everything that moves over them), turrets mounted on them, rocks, chunks,
    // muzzle flashes, impact glows (over the flash end), ships, turret shots.
    // Labels aid the layout registry + render tests.
    this.boundaryLayer.label = 'boundary';
    this.atmosphereLayer.label = 'atmosphere';
    this.stationLayer.label = 'stations';
    this.turretLayer.label = 'turrets';
    this.asteroidLayer.label = 'asteroids';
    this.chunkLayer.label = 'chunks';
    this.muzzleLayer.label = 'muzzles';
    this.impactLayer.label = 'impacts';
    this.shipLayer.label = 'ships';
    this.shotLayer.label = 'shots';
    this.worldRoot.addChild(
      this.boundaryLayer, // behind everything: the wall the arena is drawn inside
      this.atmosphereLayer, // your home's air, under its station furniture
      this.stationLayer,
      this.turretLayer,
      this.asteroidLayer,
      this.chunkLayer,
      this.muzzleLayer,
      this.impactLayer,
      this.shipLayer,
      this.shotLayer,
    );
    // The void goes in first, so it sits behind the world container and every
    // HUD layer the caller adds after us — it is the deepest thing on screen.
    stage.addChild(this.backdrop.view);
    stage.addChild(this.worldRoot);

    this.asteroidPool = new SpritePool(this.asteroidLayer);
    this.chunkPool = new GraphicsPool(this.chunkLayer, makeUnitChunk);
    this.muzzlePool = new GraphicsPool(this.muzzleLayer, () => new Graphics());
    this.impactPool = new GraphicsPool(this.impactLayer, makeImpactGlow);
    this.turretPool = new SpritePool(this.turretLayer);
    this.scaffoldPool = new SpritePool(this.turretLayer);
    this.shotPool = new SpritePool(this.shotLayer);
  }

  /** Distinct textures the entity layers are sharing — the pooling assertion
   *  GDD §4.3 states as "a field of 200 rocks shares a couple of dozen textures". */
  get textureCount(): number {
    return this.textures.size;
  }

  /** How many of those were actually baked. Equal to {@link textureCount} unless
   *  something is rebuilding a look it already had. */
  get bakeCount(): number {
    return this.textures.bakeCount;
  }

  /**
   * A look's authored half-extent (`../art/shapes` unit space), generated once
   * and remembered.
   *
   * Sizing a bake needs it — the texture is `2 · extent · pxPerUnit` pixels
   * across — and the atlas hands back a `Texture`, not the definition it baked
   * from. So a generator runs one extra time per *distinct look*, at most once
   * each per match (46 rocks, 24 turrets, 4 shots), and never on a cache hit or
   * on a steady frame.
   */
  private extentOf(key: string, make: () => SpriteDef): number {
    const hit = this.extents.get(key);
    if (hit !== undefined) return hit;
    const extent = make().extent;
    this.extents.set(key, extent);
    return extent;
  }

  /**
   * Bake (or fetch) one look and return the **world units per texture pixel**
   * that lands it at the same size the direct-draw path drew it at.
   *
   * `pxPerUnit` is the density the vectors were rasterised at before their
   * per-frame `scale.set`, so `units` comes back as `1 / pxPerUnit` (bar
   * rounding) and the caller's scale is the very `radius / ART_SCALE` the
   * `Graphics` carried. `bake` is the atlas (or, where the atlas has no entry for
   * a look, a direct keyed lookup) — it is passed the pixel size to bake at.
   */
  private lookUnits(key: string, pxPerUnit: number, make: () => SpriteDef, bake: (size: number) => Texture): {
    texture: Texture;
    units: number;
  } {
    const extent = this.extentOf(key, make);
    const size = Math.max(8, Math.round(2 * extent * pxPerUnit));
    this.baker.frameFor(size);
    return { texture: bake(size), units: (2 * extent) / size };
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
    // The void sheds its nebula (translucent-disc overdraw) on the same signal;
    // its stars, near-free once baked, stay. Rebuild happens lazily in draw.
    this.backdrop.setReduceVfx(on);
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
    // The void, behind the world: sized once to cover the arena+viewport (a
    // cheap no-op when neither changed), then scrolled by the camera offset
    // centerCamera just wrote — parallax, allocation-free (GDD §4.3).
    this.backdrop.setMap(view.mapId);
    this.backdrop.configure(world.bounds.width, world.bounds.height, this.viewport.width, this.viewport.height);
    this.backdrop.update(this.offsetScratch.x, this.offsetScratch.y, this.viewport.width, this.viewport.height);
    this.drawBoundary(world.bounds);
    this.drawStations(world, view.cameraTarget);
    this.drawAsteroids(world.asteroids);
    this.drawChunks(world.chunks);
    this.drawShips(world.ships);
    this.drawShots(world, view.cameraTarget);
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
   * It is as much a blocking volume as a station, so it gets a drawn surface: the
   * field report was a ship crashing into the invisible right edge "beside my
   * station" — stations are pinned right against this wall (`createWorld`), so the
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

    // The wall, integrated into the void (a2-06): a crisp double steel frame at
    // the play edge, then a short falloff of ever-fainter steel bands stepping
    // inward — a soft inner glow that ties the wall to the star-field behind it,
    // so the edge reads as a lit structure the void presses against rather than a
    // hairline rectangle floating on black. Hull steel is structure, never a
    // player colour (style-guide §3) and never signal yellow (reserved, §2). The
    // band recipe is the art layer's (`ARENA_WALL_BANDS`); the renderer places it.
    g.clear();
    for (const band of ARENA_WALL_BANDS) {
      g.rect(band.inset, band.inset, bounds.width - band.inset * 2, bounds.height - band.inset * 2).stroke({
        width: band.width,
        color: PALETTE.hullSteel,
        alpha: band.alpha,
      });
    }
  }

  /**
   * The eight homes (GDD §2.1) and everything standing on them: the body, the
   * owner's beacon ring, the signal-yellow core, the shield bubble, construction
   * in progress, and the damage ring.
   *
   * **The damage ring is drawn for every station, at every range** (GDD §2.2,
   * amended 2026-08-07; `sim/sensing`'s `stationHealthVisible`). It used to be
   * gated on the viewer's ship being inside the retired `SENSOR_RANGE` — 180
   * units, a fifth of the way to the edge of a 1080p screen — so a rival you
   * could see perfectly well drew *no* ring, and the always-drawn owner-colour
   * beacon ring under it made a quarter-dead station look untouched. `viewerId`
   * is still the eye for everything that genuinely is fog (the atmosphere halo is
   * an own-station affordance, shots read by side), just not for health.
   *
   * **Turrets are pooled here rather than through `atlas.turretTexture` (a1-11).**
   * The atlas's entry predates the Mk I→III ladder and keys on `(owner, state)`
   * alone, so routing through it would put every Mk II and Mk III barrel on the
   * Mk I silhouette — a visible regression, and this brief's whole guard rail is
   * that appearance must not degrade. The key below is the atlas's own idiom with
   * `tier` restored; `src/art/atlas.ts` is Art's file and was left alone.
   * **Recommended to Art: `turretTexture` should take the tier.**
   */
  private drawStations(world: World, viewerId: PlayerId): void {
    const viewer = world.ships.find((s) => s.id === viewerId);
    let turrets = 0;
    let scaffolds = 0;

    for (let i = 0; i < world.stations.length; i++) {
      const station = world.stations[i]!;
      this.drawAtmosphere(i, station, viewerId, viewer, world.time);
      this.stationBody(i, station);

      const overlay = this.overlayFor(i);
      overlay.clear();
      overlay.x = station.pos.x;
      overlay.y = station.pos.y;

      if (station.alive) {
        this.drawShieldBubble(overlay, station);
        this.drawConstruction(overlay, station);
        // Health is not fog (GDD §2.2, amended): every station, every range. The
        // sim owns the rule so there is one place to change it, and exactly one
        // answer for the renderer, the bots and the server.
        if (stationHealthVisible(viewerId, station)) this.drawDamageRing(overlay, station);
      }

      for (const turret of station.turrets) {
        if (turret.hp <= 0) continue; // killed this tick, swept at end of step
        const s = this.turretPool.at(turrets);
        // The barrel state is the threat telegraph (style-guide §5.5): a fired
        // muzzle this tick is `firing`; a committed target is `tracking`; else
        // the barrel is cold. The tier picks the ratified pool silhouette.
        const state: TurretState =
          turret.muzzle != null ? 'firing' : turret.targetId != null ? 'tracking' : 'idle';
        const tier = turret.tier ?? 0;
        // Swap the texture only when the read changes — steady state is a
        // transform-only frame (GDD §4.3), exactly like the rock pool. Owner ×
        // tier × state is 8 × 3 × 3 at the design cap, and a1-10 measured 24 of
        // them carrying all 32 turrets on the §4.3 scene.
        const key = `turret:${turret.owner}:${tier}:${state}`;
        if (this.turretKeys[turrets] !== key) {
          const look = this.lookUnits(
            key,
            TURRET_ART_SCALE,
            () => turretSprite({ playerId: turret.owner, state, tier }),
            (size) =>
              this.textures.getBy(`${key}:${size}`, () => turretSprite({ playerId: turret.owner, state, tier }), size),
          );
          s.texture = look.texture;
          this.turretUnits[turrets] = look.units;
          this.turretKeys[turrets] = key;
        }
        s.x = turret.pos.x;
        s.y = turret.pos.y;
        s.rotation = turret.angle;
        // The texture is TURRET_ART_SCALE px per art unit; divide it back out to
        // land the turret at its collision radius in world units.
        s.scale.set(this.turretUnits[turrets]! * turret.radius);
        // Damaged turrets fade toward the vacuum rather than recolouring —
        // threat red is reserved for damage *events*, not for standing objects.
        s.alpha = 0.45 + 0.55 * clamp01(turret.hp / turret.maxHp);
        turrets++;
      }

      // A turret build-in-progress reads as a scaffold on its reserved mount, so
      // the finished gun lands exactly where the frame stood (GDD §2.5, §2.6).
      for (const job of station.builds) {
        if (job.kind !== 'turret') continue; // a shield builds centred — arc only
        const pos = turretOrbitPos(station, turretHomeAngle(station, job.slot));
        const s = this.scaffoldPool.at(scaffolds);
        const key = `scaffold:${station.owner}`;
        if (this.scaffoldKeys[scaffolds] !== key) {
          const make = (): SpriteDef => turretSprite({ playerId: station.owner, state: 'building' });
          const look = this.lookUnits(key, TURRET_ART_SCALE, make, (size) =>
            this.textures.getBy(`${key}:${size}`, make, size),
          );
          s.texture = look.texture;
          this.scaffoldUnits[scaffolds] = look.units;
          this.scaffoldKeys[scaffolds] = key;
        }
        s.x = pos.x;
        s.y = pos.y;
        s.rotation = turretHomeAngle(station, job.slot);
        s.scale.set(this.scaffoldUnits[scaffolds]! * TURRET.radius);
        scaffolds++;
      }
    }

    this.turretPool.hideFrom(turrets);
    this.scaffoldPool.hideFrom(scaffolds);
  }

  /**
   * The two own-station range rings (GDD §2.3, §2.5, §5.4; p4-12, a4-01): the
   * atmosphere out to exactly `DEPOSIT_RANGE`, and the dashed plasma build ring
   * at exactly `STATION.dockRange`. Drawn only around the viewer's OWN living
   * station — both are affordances ("where do I unload?", "where can I build?"),
   * so a rival's world gets neither. Both radii derive from the sim constants
   * inside the sprite (`atmosphereHaloSprite`), so the art and the rules are one
   * number each; here we only place and fade them.
   *
   * Static-render discipline (GDD §4.3): the geometry is built once per owner and
   * then **baked to a single texture** (`cacheAsTexture`), so per frame the halo
   * is one textured quad the GPU blits — not a stack of translucent discs it
   * re-blends every frame. That overdraw (large alpha fills at the atmosphere
   * radius) was the mobile frame-budget cost this VFX was tuned to shed: on the
   * software-GL profile it dropped the frame rate below the boot-path budget until
   * it was baked. The bake is also what makes the gradient affordable at the step
   * count it now needs to read as genuinely smooth (a4-01) — the discs blend once,
   * at match start, and never again. The bake survives every per-frame change we
   * make — position (the camera pan) and alpha (the breath) are display properties
   * applied to the quad, never a re-rasterise of the gradient.
   *
   * Per frame the halo only moves and fades: a gentle breath keyed to sim time
   * (deterministic, so the frozen golden holds still), lifted toward full while a
   * deposit is actually flowing — the viewer carrying ore inside its own
   * atmosphere, the same predicate the sim drains on (`inAtmosphere`). Idle it is
   * a hush; depositing it brightens, pairing with the ore-flight couriers.
   *
   * VfxAutoQuality tier (GDD §4.3 risk 5): when the auto-reducer has throttled a
   * struggling device (`reduceVfx`), even the one baked quad's full-disc fill is
   * too dear, so the halo is rebuilt as the **rings alone** — the same edge band
   * at `DEPOSIT_RANGE` and the same build ring at `STATION.dockRange`, with the
   * haze between them dropped, blending only their own annuli rather than a full
   * disc. Both questions still get an answer at this tier; only the air is cut.
   * It is left un-baked on purpose: a cached quad would blit the whole bounding
   * box (the transparent centre included), which is the very cost this tier exists
   * to dodge.
   */
  private drawAtmosphere(
    index: number,
    station: MiningStation,
    viewerId: PlayerId,
    viewer: Ship | undefined,
    time: number,
  ): void {
    const own = station.alive && station.owner === viewerId;
    let g = this.stationHalo[index];
    if (!own) {
      if (g) g.visible = false;
      return;
    }
    const reduced = this.reduceVfx ? 1 : 0;
    if (!g || this.stationHaloOwner[index] !== station.owner || this.stationHaloReduced[index] !== reduced) {
      g?.destroy();
      g = spriteGraphics(atmosphereHaloSprite(station.owner, reduced === 1), station.radius);
      g.label = `atmosphere-${index}`;
      // Full gradient: bake it to one texture so its discs blend once, ever.
      // The ring tier stays vector — its thin bands are cheaper drawn than blitted.
      if (reduced === 0) g.cacheAsTexture(true);
      this.stationHalo[index] = g;
      this.stationHaloOwner[index] = station.owner;
      this.stationHaloReduced[index] = reduced;
      this.atmosphereLayer.addChild(g);
    }
    g.visible = true;
    g.x = station.pos.x;
    g.y = station.pos.y;
    // 0..1 breath; flowing lifts the whole band up toward full opacity.
    const breath = 0.5 + 0.5 * Math.sin(time * ATMOSPHERE_BREATH_RATE);
    const flowing = viewer !== undefined && viewer.cargo > 1e-6 && inAtmosphere(viewer, station);
    const lo = flowing ? 0.82 : 0.42;
    const hi = flowing ? 1 : 0.56;
    g.alpha = lo + (hi - lo) * breath;
  }

  /** A station's static body, drawn once — and again the one time it becomes a
   *  wreck (GDD §2.7: the wreck stays on the map for the rest of the match). */
  private stationBody(index: number, station: MiningStation): void {
    let g = this.stationGfx[index];
    const dead = !station.alive;
    if (g && this.stationDrawnDead[index] === dead) {
      g.alpha = station.spawnProtect > 0 ? 0.75 : 1;
      return;
    }
    if (!g) {
      g = new Graphics();
      g.label = `station-${index}`;
      this.stationGfx[index] = g;
      this.stationLayer.addChild(g);
    }
    this.stationDrawnDead[index] = dead;

    const r = station.radius;
    g.clear();
    g.x = station.pos.x;
    g.y = station.pos.y;

    // THE CUTTERHEAD, from the art pipeline (a2-03; `src/art/stations.ts`,
    // `src/art/wrecks.ts`), drawn by the same `drawSprite` verb as every turret,
    // shield and hull on this stage.
    //
    // This block used to hand-draw a blue-green planetoid — three discs and a
    // ring stroke, in hexes (`0x2f4a63`, `0x2a3038`, `0x1a1f26`) that are not in
    // the palette and that no compliance audit could ever see, because the audit
    // walks the sprite IR and this was never a sprite. So the generators were
    // reviewed, catalogued and audited while the game drew something else, and
    // the facility board's whole verdict — *"none of these look like a mining
    // space station"* — was being passed on art the player never saw.
    // `stationSprite`/`stationWreckSprite`/`beaconRingSprite` are now what
    // renders, which is what makes the ratified direction reach the screen and
    // what puts the station inside the palette contract for the first time.
    const variant = stationVariantFor(station.owner);
    if (dead) {
      // A derelict: the core is out, the beacon is off, the ore is still there.
      // Still solid, still on the map, still worth flying to (GDD §2.7).
      drawSprite(g, stationWreckSprite(variant), r);
      g.alpha = 1;
      return;
    }

    drawSprite(g, stationSprite(variant, station.owner), r);
    // Ownership, always visible (style-guide §5.4): four arcs and four pips, so
    // the beacon reads as a beacon rather than an outline and keeps a shape a
    // colourblind player can pick out next to a neighbouring slot's ring.
    drawSprite(g, beaconRingSprite(station.owner), r);
    g.alpha = station.spawnProtect > 0 ? 0.75 : 1;
  }

  private overlayFor(index: number): Graphics {
    let g = this.stationOverlay[index];
    if (!g) {
      g = new Graphics();
      g.label = `station-overlay-${index}`;
      this.stationOverlay[index] = g;
      this.stationLayer.addChild(g);
    }
    return g;
  }

  /**
   * The ratified ring-damage grammar (p11), for core and shields alike: a whole
   * ring in the OWNER's colour is the health that remains; a threat-red segment
   * FILLS it — from twelve o'clock, clockwise — proportional to the pool LOST.
   * Full red is death. One primitive so a besieged station reads outermost-first:
   * shields redden and die before the core starts to fill.
   *
   * Screen space is +y down, so `-π/2` is the top and an increasing sweep runs
   * clockwise. `lost` is `1 - remaining` — the arc grows as the pool drains.
   */
  private drawDamageFill(
    g: Graphics,
    radius: number,
    owner: number,
    lost: number,
    width: number,
    alpha: number,
  ): void {
    const l = clamp01(lost);
    // The base: the owner's colour, whole — full health is your colour, entire.
    g.circle(0, 0, radius).stroke({ width, color: playerColor(owner), alpha });
    if (l > 0) {
      // The damage: threat red, filling clockwise from twelve o'clock. `moveTo`
      // the arc's start first so `arc` never draws a connecting spoke from the
      // path's lingering current point (a Pixi arc-after-circle gotcha).
      g.moveTo(0, -radius);
      g.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + l * 2 * Math.PI).stroke({
        width,
        color: PALETTE.threatRed,
        alpha: Math.max(alpha, 0.9),
      });
    }
  }

  /** The shield bubble over the core (GDD §2.5): the real plasma sphere from the
   *  art pipeline (style-guide §5.5 — banded full/weakened/failing so pressure
   *  reads), with the ratified CONTINUOUS p11 gauge ring drawn on top so the
   *  health read stays smooth rather than three-step. A stacked pair reads as two,
   *  each wider and each filling red as its own pool drains. */
  private drawShieldBubble(g: Graphics, station: MiningStation): void {
    for (let i = 0; i < station.shields.length; i++) {
      const shield = station.shields[i]!;
      if (shield.hp <= 1e-9) continue;
      const strength = shieldStrength(shield.maxHp > 0 ? shield.hp / shield.maxHp : 0);
      // The bubble, authored at unit radius; `gauge: false` leaves the gauge to
      // the continuous fill below so there is one ring, not two.
      drawSprite(
        g,
        shieldSprite({ playerId: station.owner, strength, stackIndex: i, gauge: false }),
        shield.radius,
      );
      const lost = clamp01(1 - shield.hp / shield.maxHp);
      this.drawDamageFill(g, shield.radius + i * 6, station.owner, lost, 2, 0.7);
    }
  }

  /** Construction in progress (GDD §2.5: "a turret assembles over ~10 seconds").
   *  A plasma arc just outside the body, filling as the job completes — the
   *  visible answer to "defenses are bought before the attack, not during it". */
  private drawConstruction(g: Graphics, station: MiningStation): void {
    if (station.builds.length === 0) return;
    const job = station.builds[0]!;
    const done = job.total > 0 ? clamp01(1 - job.remaining / job.total) : 1;
    const r = station.radius + 12;
    g.circle(0, 0, r).stroke({ width: 2, color: PALETTE.hullSteel, alpha: 0.25 });
    if (done <= 0) return;
    // `moveTo` the arc start so `arc` never spokes back to the current point.
    g.moveTo(0, -r);
    g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + done * 2 * Math.PI).stroke({
      width: 3,
      color: PALETTE.plasma,
      alpha: 0.9,
    });
  }

  /** The damage ring (GDD §2.2, §5.4): the owner's colour whole, a threat-red
   *  segment filling it as core HP is lost (p11). Enemy stations read in THEIR
   *  colour by exactly this verb — red is the damage, never the station. */
  private drawDamageRing(g: Graphics, station: MiningStation): void {
    const lost = clamp01(1 - station.coreHp / station.maxCoreHp);
    this.drawDamageFill(g, station.radius + 5, station.owner, lost, 4, 0.95);
  }

  /**
   * Ship and turret shots, tinted by the shooter's DAMAGE tier (RATIFIED p11-06,
   * "power you can see"). Each shot reads in its side's family — the viewer's (and
   * any ally's) fire climbs the plasma family, an enemy's climbs threat red — and
   * brightens with the shooter's weapon tier, so "whose shot" and "how strong" both
   * read at a glance. The `${family}:${tier}` look is baked from the art ramp
   * (`shotSprite`) into a shared texture and swapped into a slot only when that
   * slot's shot changes side or tier, so the sparse pool stays transform-only in a
   * steady firefight (GDD §4.3). The pool is sparse — skip inactive slots rather
   * than assume density (see {@link Projectile}).
   *
   * a1-10 measured this layer at **11.7 ms** drawn as one `Graphics` per shot and
   * **3.5 ms** over four shared textures. It is the one layer that already
   * collapsed to a single draw call either way — a shot's geometry is simple
   * enough to clear Pixi's batching threshold — so the whole win here is that a
   * `Sprite` moves a quad where a batched `Graphics` re-uploads its vertices every
   * frame, 300 times a frame at the §4.3 counts.
   *
   * `src/art/atlas.ts` has no entry for a shot (its art lives under
   * `src/art/vfx/`), so the key is written here, in the atlas's own idiom.
   */
  private drawShots(world: World, viewer: PlayerId): void {
    let live = 0;
    for (const p of world.projectiles) {
      if (!p.active) continue;
      const family: ShotFamily = areEnemies(world, viewer, p.owner) ? 'enemy' : 'own';
      const tier = shotTier(world, p);
      const key = `shot:${family}:${tier}`;
      const s = this.shotPool.at(live);
      if (this.shotKeys[live] !== key) {
        const make = (): SpriteDef => shotSprite(family, tier);
        const look = this.lookUnits(key, SHOT_ART_SCALE, make, (size) =>
          this.textures.getBy(`${key}:${size}`, make, size),
        );
        s.texture = look.texture;
        this.shotUnits[live] = look.units;
        this.shotKeys[live] = key;
      }
      s.x = p.pos.x;
      s.y = p.pos.y;
      // The texture is SHOT_ART_SCALE px per art unit; divide it back out so unit
      // radius 1 lands at the shot's collision radius (the glow overhangs it).
      s.scale.set(this.shotUnits[live]! * p.radius);
      live++;
    }
    this.shotPool.hideFrom(live);
  }

  /**
   * The rock field — the layer a1-10 measured at **26.1 ms and 200 draw calls**
   * as one `Graphics` each, and 3.9 ms over 46 shared textures pooled.
   *
   * `asteroidArt` still supplies the cheap look key (seed fold × crack stage ×
   * payout band), so a slot's texture is swapped only when its rock's look
   * actually moves; `atlas.asteroidTexture` — whose header has carried the claim
   * "a field of 200 rocks shares a couple of dozen textures" since M1, with
   * nothing calling it — is what supplies the texture.
   */
  private drawAsteroids(asteroids: readonly Asteroid[]): void {
    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i]!;
      const s = this.asteroidPool.at(i);
      const art = asteroidArt(a);
      if (this.asteroidKeys[i] !== art.key) {
        const look = this.lookUnits(art.key, ROCK_ART_SCALE, () => art.build(), (size) =>
          asteroidTexture(this.textures, a, size),
        );
        s.texture = look.texture;
        this.asteroidUnits[i] = look.units;
        this.asteroidKeys[i] = art.key;
      }
      s.x = a.pos.x;
      s.y = a.pos.y;
      // The texture is ROCK_ART_SCALE px per art unit; divide it back out to land
      // the rock at its collision radius. The crack stage is in the art, not alpha.
      s.scale.set(this.asteroidUnits[i]! * a.radius);
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
      g.moveTo(m.from.x, m.from.y).lineTo(m.to.x, m.to.y).stroke({ width: m.width ?? 3, color: m.color, cap: 'round' });
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
