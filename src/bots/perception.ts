/**
 * src/bots/perception.ts — what a bot is allowed to know. OWNER: Bot Engineer.
 *
 * **Fog-honesty is enforced structurally, not by good manners.** A behavior tree
 * never receives a `World`. It receives a {@link BotView}: a flat snapshot of
 * exactly what a human in that cockpit could see this tick — its own ship and
 * planet in full, everything else filtered by range and stripped of the numbers
 * the HUD does not draw. A tree cannot peek at a hidden core's HP because the
 * field it would read is `null` (GDD §2.2, §2.9).
 *
 * Two ranges, because the GDD names two different things:
 *
 *  - **Visual range** — near enough to be on screen at all. Ships, their hull
 *    bars (GDD §2.2: "a narrow hull bar … floating over every ship"), asteroids,
 *    chunks, and the turrets ringing a planet are drawn here.
 *  - **Sensor range** (`SENSOR_RANGE`, the sim's own constant) — near enough to
 *    scout. "Enemy planet health is scouted, not broadcast": a rival's core and
 *    shield HP appear only inside this radius, and nowhere else.
 *
 * Three things are deliberately public at any distance, because the game draws
 * them that way: a planet's **position** and its owner's **beacon ring**
 * (style-guide §5, "ownership … always visible"), whether a planet has become a
 * **wreck** (GDD §2.2 — "a burning planet is visible from further away than its
 * numbers are"), and the **asteroid-wave clock** (GDD §2.2, top centre).
 *
 * Determinism note (GDD §4.8): distances use `Math.sqrt(dx*dx + dy*dy)` rather
 * than `Math.hypot`, because the former is IEEE-exact on every engine and the
 * latter is not specified to be. Bot state lives outside the world tree, so it
 * can never desync a replay — but a bot that decides differently on two engines
 * would still be a bug worth not having.
 */

import { ShipClass } from '@shared/types';
import type { PlayerId, Vec2 } from '@shared/types';
import {
  ASTEROID,
  PLANET,
  SENSOR_RANGE,
  WAVE_COUNT,
  isCollapsed,
  isDocked,
  shieldPool,
  stockTiers,
  waveTime,
} from '../sim';
import type { Asteroid, Bounds, MatchPhase, Planet, Ship, UpgradeTiers, World } from '../sim';

// ---------------------------------------------------------------------------
// The perception envelope
// ---------------------------------------------------------------------------

/**
 * How far a bot can see. Owned by this agent (the sim has no camera), and
 * deliberately **conservative**: `visualRange` is comfortably inside the
 * half-diagonal a human sees on a 16:9 screen, so a bot is never better
 * informed than the player sitting next to it. Difficulty must not widen these
 * — that would be a cheat, and GDD §2.9 forbids it.
 */
export interface Perception {
  /** Radius within which entities are perceived at all (world units). */
  readonly visualRange: number;
  /** Radius within which an enemy planet's core and shields can be read. */
  readonly sensorRange: number;
  /** Seconds since a planet last took damage that still count as "under
   *  attack" — the bot's half of the alarm (GDD §2.2). */
  readonly alarmWindow: number;
}

/**
 * The ceiling on `visualRange`. A human's camera shows roughly this far on a
 * 1920×1080 viewport at 1:1; {@link resolvePerception} clamps to it so no
 * caller — difficulty tier, test, or future tuning pass — can hand a bot
 * map-wide vision.
 */
export const HUMAN_VISUAL_RANGE = 900;

/** The day-2 baseline envelope. TUNABLE (by this agent). */
export const DEFAULT_PERCEPTION: Perception = {
  visualRange: 720,
  sensorRange: SENSOR_RANGE,
  alarmWindow: 2,
};

/** Apply defaults and enforce the no-cheating ceiling. */
export function resolvePerception(p?: Partial<Perception>): Perception {
  return {
    visualRange: Math.min(p?.visualRange ?? DEFAULT_PERCEPTION.visualRange, HUMAN_VISUAL_RANGE),
    sensorRange: Math.min(p?.sensorRange ?? DEFAULT_PERCEPTION.sensorRange, HUMAN_VISUAL_RANGE),
    alarmWindow: p?.alarmWindow ?? DEFAULT_PERCEPTION.alarmWindow,
  };
}

// ---------------------------------------------------------------------------
// View types — plain readonly data, no `World` anywhere in the tree
// ---------------------------------------------------------------------------

/** The bot's own planet: full knowledge, exactly like the HUD's top-right panel
 *  (GDD §2.2 — "your own planet's HP"). `null` once it is not this bot's any
 *  more, which never happens; the wreck is still reported here. */
export interface OwnPlanetView {
  readonly pos: Vec2;
  readonly radius: number;
  readonly alive: boolean;
  readonly coreHp: number;
  readonly maxCoreHp: number;
  /** Combined HP across both shield generators (0 with none built). */
  readonly shieldHp: number;
  readonly shields: number;
  readonly turrets: number;
  /** Jobs still under construction (GDD §2.5). */
  readonly builds: number;
  readonly repairing: boolean;
  readonly sinceDamage: number;
  /** The alarm (GDD §2.2): something has been hitting home recently. */
  readonly underAttack: boolean;
  readonly distance: number;
}

/** Another player's ship, as seen. */
export interface PerceivedShip {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  readonly pos: Vec2;
  readonly vel: Vec2;
  readonly angle: number;
  readonly alive: boolean;
  readonly eliminated: boolean;
  readonly distance: number;
  /** Hull HP — the bar floats over every ship on screen, so this is known at
   *  visual range and `null` outside it. Held cargo never appears here: the
   *  game does not draw it, so a bot may not know it. */
  readonly hull: number | null;
  readonly maxHull: number;
  /** Firing this tick — the beam is the loudest tell in the game. */
  readonly firing: boolean;
  /** Untouchable right now (GDD §2.1 spawn protection), if close enough to read
   *  the glow. */
  readonly spawnProtected: boolean | null;
}

/** Another player's home planet, as seen. Position and ownership are public;
 *  the numbers are scouted. */
export interface PerceivedPlanet {
  readonly owner: PlayerId;
  readonly pos: Vec2;
  readonly radius: number;
  /** False for a wreck. Public at any range — smoke carries (GDD §2.2). */
  readonly alive: boolean;
  readonly distance: number;
  /** True when this planet is inside sensor range this tick, i.e. its numbers
   *  below are real rather than `null`. */
  readonly scouted: boolean;
  readonly coreHp: number | null;
  readonly maxCoreHp: number;
  readonly shieldHp: number | null;
  /** Turret count — the barrels are sprites, so this is a visual-range read. */
  readonly turrets: number | null;
  /** Under-attack tell on someone else's home; scouted, like the HP. */
  readonly underAttack: boolean | null;
}

/** A rock, as seen: its size and its crack stage — enough to judge a payout
 *  before committing beam time (GDD §5.5), never the exact ore inside. */
export interface PerceivedAsteroid {
  readonly id: number;
  readonly pos: Vec2;
  readonly radius: number;
  readonly crackStage: number;
  readonly distance: number;
}

/** A drifting ore chunk. Every chunk is worth `CHUNK.ore`, which is public. */
export interface PerceivedChunk {
  readonly id: number;
  readonly pos: Vec2;
  readonly amount: number;
  readonly distance: number;
}

/** The bot's own ship — full knowledge, because it is its own cockpit. */
export interface SelfView {
  readonly id: PlayerId;
  readonly shipClass: ShipClass;
  /**
   * Tiers bought on the four upgrade tracks (GDD §2.5). Own-ship knowledge: the
   * upgrade panel is "the one screen where ship stats are shown" and it is this
   * player's own screen (GDD §2.5). A copy, never the world's array, so a tree
   * cannot write to the simulation — and paired with `shipClass` it satisfies the
   * sim's `ShipLoadout`, so a bot prices its next tier through exactly the
   * function the panel prints.
   */
  readonly tiers: UpgradeTiers;
  readonly pos: Vec2;
  readonly vel: Vec2;
  readonly angle: number;
  readonly home: Vec2;
  readonly alive: boolean;
  readonly eliminated: boolean;
  readonly hull: number;
  readonly maxHull: number;
  readonly hullFraction: number;
  readonly cargo: number;
  readonly cargoCap: number;
  readonly cargoFull: boolean;
  readonly banked: number;
  /** Hold plus bank — what the build wheel can actually spend (GDD §2.5). */
  readonly spendable: number;
  readonly respawnTimer: number;
  readonly spawnProtect: number;
  /** Close enough to its own planet for the wheel to be live (GDD §2.5). */
  readonly docked: boolean;
  /** Distance to its own planet; `Infinity` if it somehow has none. */
  readonly homeDistance: number;
  readonly planet: OwnPlanetView | null;
}

/**
 * Everything one bot knows this tick. This — not `World` — is the input to a
 * behavior tree.
 */
export interface BotView {
  readonly time: number;
  readonly tick: number;
  readonly bounds: Bounds;
  /** Arena centre: where the field is, and where every later wave lands. */
  readonly center: Vec2;
  readonly phase: MatchPhase;
  /** Collapse has begun: no regen, no repair, no new ore (GDD §2.3). */
  readonly collapsed: boolean;
  /** The wave clock, top centre of the HUD — public information (GDD §2.2). */
  readonly wavesSpawned: number;
  /** Seconds until the next wave lands, or `null` after the last one. */
  readonly nextWaveIn: number | null;
  readonly self: SelfView;
  readonly ships: readonly PerceivedShip[];
  readonly planets: readonly PerceivedPlanet[];
  readonly asteroids: readonly PerceivedAsteroid[];
  readonly chunks: readonly PerceivedChunk[];
  /** The envelope this view was built with — trees read ranges from here rather
   *  than importing constants, so a narrowed envelope narrows behavior too. */
  readonly perception: Perception;
}

// ---------------------------------------------------------------------------
// Building a view
// ---------------------------------------------------------------------------

/** IEEE-exact distance (see the module note on `Math.hypot`). */
function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** The ship in a slot, or null. Local rather than the sim's `shipOf` so this
 *  module keeps one import surface and no ordering assumptions. */
function shipIn(world: World, id: PlayerId): Ship | null {
  for (const s of world.ships) {
    if (s.id === id) return s;
  }
  return null;
}

/** The planet owned by a slot, or null. */
function planetIn(world: World, id: PlayerId): Planet | null {
  for (const p of world.planets) {
    if (p.owner === id) return p;
  }
  return null;
}

/**
 * A bot's own planet, in full. The one place in this module that reads numbers
 * without a range check — it is the bot's own home, and the HUD shows it
 * permanently (GDD §2.2).
 */
function ownPlanetView(planet: Planet, from: Vec2, env: Perception): OwnPlanetView {
  return {
    pos: { x: planet.pos.x, y: planet.pos.y },
    radius: planet.radius,
    alive: planet.alive,
    coreHp: planet.coreHp,
    maxCoreHp: planet.maxCoreHp,
    shieldHp: shieldPool(planet),
    shields: planet.shields.length,
    turrets: planet.turrets.length,
    builds: planet.builds.length,
    repairing: planet.repairing,
    sinceDamage: planet.sinceDamage,
    underAttack: planet.alive && planet.sinceDamage < env.alarmWindow,
    distance: distance(from, planet.pos),
  };
}

/** Another player's ship, filtered to what is drawn on screen. */
function perceiveShip(ship: Ship, from: Vec2, env: Perception): PerceivedShip {
  const d = distance(from, ship.pos);
  const seen = d <= env.visualRange;
  return {
    id: ship.id,
    shipClass: ship.shipClass,
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: ship.vel.x, y: ship.vel.y },
    angle: ship.angle,
    alive: ship.alive,
    eliminated: ship.eliminated,
    distance: d,
    hull: seen ? ship.hull : null,
    maxHull: ship.maxHull,
    firing: seen && ship.beam !== null,
    spawnProtected: seen ? ship.spawnProtect > 0 : null,
  };
}

/**
 * Another player's home. Position, ownership, and wreck state are public; the
 * core and shield numbers require sensor range, and the turret count requires
 * being close enough to see the barrels.
 */
function perceivePlanet(planet: Planet, from: Vec2, env: Perception): PerceivedPlanet {
  const d = distance(from, planet.pos);
  // Measured to the planet's surface, not its centre: a 64-unit rock you are
  // standing on must not read as out of sensor range.
  const surface = Math.max(0, d - planet.radius);
  const scouted = surface <= env.sensorRange;
  const seen = surface <= env.visualRange;
  return {
    owner: planet.owner,
    pos: { x: planet.pos.x, y: planet.pos.y },
    radius: planet.radius,
    alive: planet.alive,
    distance: d,
    scouted,
    coreHp: scouted ? planet.coreHp : null,
    maxCoreHp: planet.maxCoreHp,
    shieldHp: scouted ? shieldPool(planet) : null,
    turrets: seen ? planet.turrets.length : null,
    underAttack: scouted ? planet.alive && planet.sinceDamage < env.alarmWindow : null,
  };
}

/**
 * Build one bot's view of the world (GDD §2.2, §2.9). Allocates a fresh flat
 * snapshot: nothing here aliases the world tree, so a tree cannot mutate the
 * simulation even by accident.
 *
 * A slot with no ship — which the sim never produces in a real match — yields a
 * view whose `self.alive` is false and whose lists are empty, so a caller never
 * has to null-check the view itself.
 */
export function perceive(world: World, id: PlayerId, env: Perception = DEFAULT_PERCEPTION): BotView {
  const self = shipIn(world, id);
  const ownPlanet = planetIn(world, id);
  const eye: Vec2 = self ? self.pos : (ownPlanet?.pos ?? { x: 0, y: 0 });

  const ships: PerceivedShip[] = [];
  const planets: PerceivedPlanet[] = [];
  const asteroids: PerceivedAsteroid[] = [];
  const chunks: PerceivedChunk[] = [];

  // A dead bot sees nothing but the respawn clock — its cockpit is wreckage.
  const looking = self !== null && self.alive;

  if (looking) {
    for (const other of world.ships) {
      if (other.id === id) continue;
      const p = perceiveShip(other, eye, env);
      // Out of visual range: the ship is not on screen, so it is not in the
      // view at all. (Its planet still is — planets are landmarks.)
      if (p.distance <= env.visualRange) ships.push(p);
    }
    for (const planet of world.planets) {
      if (planet.owner === id) continue;
      planets.push(perceivePlanet(planet, eye, env));
    }
    for (const a of world.asteroids) {
      const d = distance(eye, a.pos);
      if (d - a.radius > env.visualRange) continue;
      asteroids.push(perceivedAsteroid(a, d));
    }
    for (const c of world.chunks) {
      const d = distance(eye, c.pos);
      if (d > env.visualRange) continue;
      chunks.push({ id: c.id, pos: { x: c.pos.x, y: c.pos.y }, amount: c.amount, distance: d });
    }
  }

  return {
    time: world.time,
    tick: world.tick,
    bounds: { width: world.bounds.width, height: world.bounds.height },
    center: { x: world.bounds.width / 2, y: world.bounds.height / 2 },
    phase: world.match.phase,
    collapsed: isCollapsed(world),
    wavesSpawned: world.match.wavesSpawned,
    nextWaveIn: nextWaveIn(world),
    self: selfView(self, ownPlanet, env),
    ships,
    planets,
    asteroids,
    chunks,
    perception: env,
  };
}

function perceivedAsteroid(a: Asteroid, d: number): PerceivedAsteroid {
  return {
    id: a.id,
    pos: { x: a.pos.x, y: a.pos.y },
    radius: a.radius,
    crackStage: a.crackStage,
    distance: d,
  };
}

/** The cockpit half of the view. */
function selfView(ship: Ship | null, planet: Planet | null, env: Perception): SelfView {
  if (!ship) {
    const pos: Vec2 = planet ? { x: planet.pos.x, y: planet.pos.y } : { x: 0, y: 0 };
    return {
      id: -1,
      shipClass: ShipClass.Vanguard,
      tiers: stockTiers(),
      pos,
      vel: { x: 0, y: 0 },
      angle: 0,
      home: pos,
      alive: false,
      eliminated: true,
      hull: 0,
      maxHull: 0,
      hullFraction: 0,
      cargo: 0,
      cargoCap: 0,
      cargoFull: false,
      banked: 0,
      spendable: 0,
      respawnTimer: 0,
      spawnProtect: 0,
      docked: false,
      homeDistance: Number.POSITIVE_INFINITY,
      planet: planet ? ownPlanetView(planet, pos, env) : null,
    };
  }
  return {
    id: ship.id,
    shipClass: ship.shipClass,
    tiers: { ...ship.tiers },
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: ship.vel.x, y: ship.vel.y },
    angle: ship.angle,
    home: { x: ship.home.x, y: ship.home.y },
    alive: ship.alive,
    eliminated: ship.eliminated,
    hull: ship.hull,
    maxHull: ship.maxHull,
    hullFraction: ship.maxHull > 0 ? ship.hull / ship.maxHull : 0,
    cargo: ship.cargo,
    cargoCap: ship.cargoCap,
    cargoFull: ship.cargo >= ship.cargoCap - 1e-9,
    banked: ship.banked,
    spendable: ship.cargo + ship.banked,
    respawnTimer: ship.respawnTimer,
    spawnProtect: ship.spawnProtect,
    docked: planet !== null && isDocked(ship, planet),
    homeDistance: planet ? distance(ship.pos, planet.pos) : Number.POSITIVE_INFINITY,
    planet: planet ? ownPlanetView(planet, ship.pos, env) : null,
  };
}

/** Seconds until the next wave, or null once the last one has landed. Public
 *  information: it is printed on the HUD (GDD §2.2). */
function nextWaveIn(world: World): number | null {
  const next = world.match.wavesSpawned + 1;
  if (next > WAVE_COUNT) return null;
  return Math.max(0, waveTime(next) - world.time);
}

// ---------------------------------------------------------------------------
// Reading the view (helpers the trees will share)
// ---------------------------------------------------------------------------

/**
 * A fog-honest guess at what a rock still holds, from the two things a player
 * can actually see: its size and its crack stage (GDD §5.5, style-guide §6).
 * Deliberately an *estimate* — no bot may read `Asteroid.ore`.
 */
export function estimateOre(a: PerceivedAsteroid): number {
  const t = (a.radius - ASTEROID.minRadius) / Math.max(1e-9, ASTEROID.maxRadius - ASTEROID.minRadius);
  const full = ASTEROID.minOre + (ASTEROID.maxOre - ASTEROID.minOre) * Math.min(Math.max(t, 0), 1);
  // Crack stage 0 / 1 / 2 ⇒ above 2/3, between, below 1/3 of the rock's ore.
  const remaining = a.crackStage <= 0 ? 1 : a.crackStage === 1 ? 0.5 : 1 / 6;
  return full * remaining;
}

/** Docking distance to a planet — the wheel's radius (GDD §2.5), for trees that
 *  plan a trip home. */
export const DOCK_RANGE = PLANET.dockRange;

/** The nearest element of `list`, or null when it is empty. Every perceived
 *  entity carries its own `distance`, so this is a min over a field. */
export function nearest<T extends { readonly distance: number }>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of list) {
    if (best === null || item.distance < best.distance) best = item;
  }
  return best;
}
