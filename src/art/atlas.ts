/**
 * src/art/atlas.ts — sim state → the right sprite. OWNER: Art & Audio Agent.
 *
 * The generators take *art* parameters (class, slot, seed, crack stage, turret
 * state); the renderer holds *sim* entities. This is the one place that
 * translates, so the render layer never has to know how a look is keyed, and
 * the Art agent can re-key a sprite without touching a file it doesn't own.
 *
 * Every function here does the same two things:
 *
 *  1. builds the **pool key** — the minimal set of parameters that change the
 *     look, so a field of 200 rocks shares a couple of dozen textures, and
 *  2. passes the generator as a **thunk**, so a cache hit never builds geometry
 *     (GDD §4.3: zero per-frame allocation on the hot paths).
 *
 * Arguments are structural: `{ id, crackStage, ore, maxOre }` rather than
 * `Asteroid`. The art module stays a leaf that `src/sim/` and `src/render/` can
 * both consume without either of them importing the other through it.
 */

import type { Texture } from 'pixi.js';
import { asteroidSprite, oreChunkSprite } from './asteroids';
import { buildProgressSprite, shieldSprite, shieldStrength, turretSprite, type TurretState } from './buildings';
import { beaconRingSprite, damageRingSprite, planetSprite, planetVariantFor } from './planets';
import { damageStateFor, shipSprite } from './ships';
import type { SpriteTextureCache } from './textures';
import { planetWreckSprite } from './wrecks';

/** What the atlas needs to know about a ship. A `Ship` satisfies it. */
export interface ShipLike {
  readonly id: number;
  readonly shipClass: string;
  /** Seconds of spawn protection left; > 0 swaps in the shell (GDD §2.1). */
  readonly spawnProtect?: number;
  /** Current hull HP; banded against `maxHull` into a damage state (GDD §2.11). */
  readonly hull?: number;
  /** Full hull for this class+upgrades. Absent ⇒ the ship reads as undamaged. */
  readonly maxHull?: number;
}

/** What the atlas needs from an asteroid. An `Asteroid` satisfies it. */
export interface AsteroidLike {
  readonly id: number;
  readonly crackStage: number;
  readonly ore: number;
  readonly maxOre: number;
}

/** What the atlas needs from a planet. A `Planet` satisfies it. */
export interface PlanetLike {
  readonly id: number;
  readonly owner: number;
  readonly alive: boolean;
  readonly coreHp: number;
  readonly maxCoreHp: number;
}

/**
 * Ore richness banded to thirds — rich, half, nearly bare, empty. Vein count is
 * a *judgement aid* ("is this rock worth my mining time?"), not a gauge, so
 * coarse banding costs the player nothing and it is what keeps the rock pool
 * bounded: bands multiply against seeds and crack stages, so a band too many is
 * a texture budget too big (GDD §4.3).
 */
function richnessBand(ore: number, maxOre: number): number {
  if (maxOre <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, ore / maxOre)) * 3) / 3;
}

/** The ship's livery — hull class, player slot, spawn-protection and damage state. */
export function shipTexture(cache: SpriteTextureCache, ship: ShipLike, size: number): Texture {
  const protectedNow = (ship.spawnProtect ?? 0) > 0;
  const shipClass = ship.shipClass as Parameters<typeof shipSprite>[0]['shipClass'];
  // Band hull HP into three states so a field of ships shares a small pool
  // (class × slot × 3 bands), not a texture per HP point (GDD §4.3).
  const damage = damageStateFor(ship.maxHull && ship.maxHull > 0 ? (ship.hull ?? ship.maxHull) / ship.maxHull : 1);
  return cache.getBy(
    `ship:${ship.shipClass}:${ship.id}:${protectedNow ? 'p' : 'n'}:${damage}:${size}`,
    () => shipSprite({ shipClass, playerId: ship.id, spawnProtected: protectedNow, damage }),
    size,
  );
}

/** The rock at its current crack stage and payout band. */
export function asteroidTexture(cache: SpriteTextureCache, rock: AsteroidLike, size: number): Texture {
  const richness = richnessBand(rock.ore, rock.maxOre);
  // Rocks share a small pool of shapes: the id folds into 12 silhouettes, which
  // is more variety than an eye tracks in a firefight and bounds the whole
  // ~200-rock field at 12 shapes × 3 crack stages × 4 payout bands.
  const seed = rock.id % 12;
  return cache.getBy(
    `rock:${seed}:${rock.crackStage}:${richness}:${size}`,
    () => asteroidSprite({ seed, crackStage: rock.crackStage, richness }),
    size,
  );
}

/** A drifting ore chunk. Four shapes, chosen by id. */
export function oreChunkTexture(cache: SpriteTextureCache, chunkId: number, size: number): Texture {
  const seed = chunkId % 4;
  return cache.getBy(`ore:${seed}:${size}`, () => oreChunkSprite(seed), size);
}

/** The home world — or its wreck, once the core is gone (GDD §2.7). */
export function planetTexture(cache: SpriteTextureCache, planet: PlanetLike, size: number): Texture {
  const variant = planetVariantFor(planet.owner);
  return planet.alive
    ? cache.getBy(`planet:${variant}:${size}`, () => planetSprite(variant), size)
    : cache.getBy(`wreck:${variant}:${size}`, () => planetWreckSprite(variant), size);
}

/** The ownership beacon, always visible (style-guide §5). */
export function beaconTexture(cache: SpriteTextureCache, owner: number, size: number): Texture {
  return cache.getBy(`beacon:${owner}:${size}`, () => beaconRingSprite(owner), size);
}

/**
 * The scouted damage ring. **Call this only when the viewer is inside sensor
 * range** — enemy planet HP is earned by scouting, never broadcast (GDD §2.2).
 * The atlas cannot enforce that; it just refuses to make it convenient to draw
 * a ring nobody asked for.
 */
export function damageRingTexture(cache: SpriteTextureCache, planet: PlanetLike, size: number): Texture {
  const fraction = planet.maxCoreHp > 0 ? planet.coreHp / planet.maxCoreHp : 0;
  const band = Math.round(Math.max(0, Math.min(1, fraction)) * 20) / 20;
  return cache.getBy(`damage:${band}:${size}`, () => damageRingSprite(band), size);
}

/** A turret in one of its four telegraph states. */
export function turretTexture(
  cache: SpriteTextureCache,
  owner: number,
  state: TurretState,
  size: number,
): Texture {
  return cache.getBy(`turret:${owner}:${state}:${size}`, () => turretSprite({ playerId: owner, state }), size);
}

/** A shield bubble, banded by remaining strength so pressure reads. */
export function shieldTexture(
  cache: SpriteTextureCache,
  owner: number,
  hp: number,
  maxHp: number,
  stackIndex: number,
  size: number,
): Texture {
  const strength = shieldStrength(maxHp > 0 ? hp / maxHp : 0);
  return cache.getBy(
    `shield:${owner}:${strength}:${stackIndex}:${size}`,
    () => shieldSprite({ playerId: owner, strength, stackIndex }),
    size,
  );
}

/** A construction ring, quantised to tenths (GDD §2.5 build timers). */
export function buildProgressTexture(
  cache: SpriteTextureCache,
  remaining: number,
  total: number,
  size: number,
): Texture {
  const done = total > 0 ? 1 - remaining / total : 1;
  const band = Math.round(Math.max(0, Math.min(1, done)) * 10) / 10;
  return cache.getBy(`build:${band}:${size}`, () => buildProgressSprite(band), size);
}
