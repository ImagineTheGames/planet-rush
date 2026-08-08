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
import { asteroidKindFor, asteroidSprite, oreChunkSprite, CRACK_STAGES } from './asteroids';
import type { SpriteDef } from './shapes';
import { buildProgressSprite, shieldSprite, shieldStrength, turretSprite, type TurretState } from './buildings';
import { beaconRingSprite, damageRingSprite, stationSprite, stationVariantFor } from './stations';
import { damageStateFor, shipSprite } from './ships';
import { satelliteSprite, satelliteWreckSprite, type SatelliteState } from './satellite';
import type { SpriteTextureCache } from './textures';
import { stationWreckSprite } from './wrecks';

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

/** What the atlas needs from a station. A `MiningStation` satisfies it. */
export interface StationLike {
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

/**
 * A rock's look as a **cheap key plus a build thunk** — the seam a `Graphics`
 * renderer uses to pool the ratified pool (docs/art-direction §5.5) without
 * rebuilding geometry every frame.
 *
 * The `key` is derived from the pooling parameters *without* generating the
 * sprite, so a renderer can compare it against the look already drawn into a
 * pooled `Graphics` and only call `build()` when the rock's stage or payout band
 * has actually moved. Two rocks that read the same (same seed fold, same crack
 * stage, same richness band) share a key — and so a texture, per GDD §4.3.
 */
export interface AsteroidArt {
  /** Cheap identity of the look — build only when this changes between frames. */
  readonly key: string;
  /** Generate the sprite for this look. Call only on a key change. */
  build(): SpriteDef;
}

/** The pooled art for a rock: which of the six, at what crack stage and payout. */
export function asteroidArt(rock: AsteroidLike): AsteroidArt {
  // Same fold the texture path uses: a dozen silhouettes carry the whole field.
  const seed = ((rock.id % 12) + 12) % 12;
  const stage = Math.max(0, Math.min(CRACK_STAGES - 1, Math.trunc(rock.crackStage)));
  const richness = richnessBand(rock.ore, rock.maxOre);
  const kind = asteroidKindFor(seed);
  return {
    key: `${kind}:${seed}:${stage}:${Math.round(richness * 10)}`,
    build: () => asteroidSprite({ seed, crackStage: stage, richness }),
  };
}

/** A drifting ore chunk. Four shapes, chosen by id. */
export function oreChunkTexture(cache: SpriteTextureCache, chunkId: number, size: number): Texture {
  const seed = chunkId % 4;
  return cache.getBy(`ore:${seed}:${size}`, () => oreChunkSprite(seed), size);
}

/**
 * The home facility — or its derelict, once the core is gone (GDD §2.7).
 *
 * The live rig is keyed by **owner**, not just by variant: the roster colour
 * reaches the lug keyways and the apron blocks (style-guide §3 — trim, never the
 * steel), so two owners on the same arrangement are two textures. That is at most
 * eight of them in a match, built once each, which is what the cache is for. A
 * derelict has no owner, so it stays keyed by variant alone.
 */
export function stationTexture(cache: SpriteTextureCache, station: StationLike, size: number): Texture {
  const variant = stationVariantFor(station.owner);
  return station.alive
    ? cache.getBy(`station:${variant}:${station.owner}:${size}`, () => stationSprite(variant, station.owner), size)
    : cache.getBy(`wreck:${variant}:${size}`, () => stationWreckSprite(variant), size);
}

/** The ownership beacon, always visible (style-guide §5). */
export function beaconTexture(cache: SpriteTextureCache, owner: number, size: number): Texture {
  return cache.getBy(`beacon:${owner}:${size}`, () => beaconRingSprite(owner), size);
}

/**
 * The scouted damage ring. **Call this only when the viewer is inside sensor
 * range** — enemy station HP is earned by scouting, never broadcast (GDD §2.2).
 * The atlas cannot enforce that; it just refuses to make it convenient to draw
 * a ring nobody asked for.
 */
export function damageRingTexture(cache: SpriteTextureCache, station: StationLike, size: number): Texture {
  const fraction = station.maxCoreHp > 0 ? station.coreHp / station.maxCoreHp : 0;
  const band = Math.round(Math.max(0, Math.min(1, fraction)) * 20) / 20;
  // Owner is in the key now: the base ring wears the owner's colour (p11), so
  // two owners at the same HP are two different textures.
  return cache.getBy(`damage:${station.owner}:${band}:${size}`, () => damageRingSprite(station.owner, band), size);
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

/**
 * A radar satellite in one of its sensor states (`idle`/`sweeping`/`pinging`), or
 * its scaffold while building. Pooled on owner × state, exactly like the turret —
 * a station's eye shares one texture per state, and the sweep animates by the
 * renderer rotating the pooled quad, never by rebuilding geometry (GDD §4.3).
 */
export function satelliteTexture(
  cache: SpriteTextureCache,
  owner: number,
  state: SatelliteState,
  size: number,
): Texture {
  return cache.getBy(
    `satellite:${owner}:${state}:${size}`,
    () => satelliteSprite({ playerId: owner, state }),
    size,
  );
}

/** The cold remnant of a destroyed satellite (GDD §2.7 wreck language). */
export function satelliteWreckTexture(
  cache: SpriteTextureCache,
  seed: number,
  size: number,
): Texture {
  const s = ((seed % 4) + 4) % 4;
  return cache.getBy(`satellite-wreck:${s}:${size}`, () => satelliteWreckSprite(s), size);
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
