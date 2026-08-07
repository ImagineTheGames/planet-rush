/**
 * src/bots/perception.ts — what a bot is allowed to know. OWNER: Bot Engineer.
 *
 * **Fog-honesty is enforced structurally, not by good manners.** A behavior tree
 * never receives a `World`. It receives a {@link BotView}: a flat snapshot of
 * exactly what a human in that cockpit could see this tick — its own ship and
 * station in full, everything else filtered by range and stripped of the numbers
 * the HUD does not draw. A tree cannot peek at a hidden core's HP because the
 * field it would read is `null` (GDD §2.2, §2.9).
 *
 * Two ranges, because the GDD names two different things:
 *
 *  - **Visual range** — near enough to be on screen at all. Ships, their hull
 *    bars (GDD §2.2: "a narrow hull bar … floating over every ship"), asteroids,
 *    chunks, and the turrets ringing a station are drawn here.
 *  - **Sensor range** (`SENSOR_RANGE`, the sim's own constant) — near enough to
 *    scout. "Enemy station health is scouted, not broadcast": a rival's core and
 *    shield HP appear only inside this radius, and nowhere else.
 *
 * Three things are deliberately public at any distance, because the game draws
 * them that way: a station's **position** and its owner's **beacon ring**
 * (style-guide §5, "ownership … always visible"), whether a station has become a
 * **wreck** (GDD §2.2 — "a burning station is visible from further away than its
 * numbers are"), and the **asteroid-wave clock** (GDD §2.2, top centre).
 *
 * **Whose side everything is on is public too, and it is asked here — once.**
 * Every perceived ship and station carries a `hostile` stamp taken from
 * `sim/allegiance.ts`'s `areEnemies`, the ONE friend/foe predicate the whole game
 * routes through (auto-aim, turrets, siege collision, projectile damage). The bot
 * layer does not own a second notion of hostility and must never grow one: a tree
 * asks "is that a foe?" by reading the stamp, and the answer is the same answer
 * the sim's own targeting ladder gets. Reading it is fair — a hull's beacon ring
 * *is* its side, drawn at any range (style-guide §5, and `main.ts`'s `TEAM A`
 * label over the hull) — and it is static match config fixed at match start, so a
 * boolean captured per view is exactly as fresh as the world (allegiance spike,
 * Trap 7). **FFA is teams-of-one**, so `hostile` there is `other !== self`, i.e.
 * true for every entity in the view — byte-for-byte what the bots assumed before
 * they were ever told to ask.
 *
 * Hostility gates *targeting*, not *knowledge*: an ally's core and shields are
 * still read through the same sensor-range gate an enemy's are, because sharing a
 * side is not a scouting report and widening what a teammate knows is a design
 * question, not a bug fix (see docs/bot-teams-allegiance-p16.md).
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
  STATION,
  SENSOR_RANGE,
  WAVE_COUNT,
  areEnemies,
  isCollapsed,
  isDocked,
  shieldPool,
  stockTiers,
  teamOf,
  waveTime,
} from '../sim';
import type { Asteroid, Bounds, MatchPhase, MiningStation, Ship, UpgradeTiers, World } from '../sim';

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
  /** Radius within which an enemy station's core and shields can be read. */
  readonly sensorRange: number;
  /** Seconds since a station last took damage that still count as "under
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

/** The bot's own station: full knowledge, exactly like the HUD's top-right panel
 *  (GDD §2.2 — "your own station's HP"). `null` once it is not this bot's any
 *  more, which never happens; the wreck is still reported here. */
export interface OwnStationView {
  readonly pos: Vec2;
  readonly radius: number;
  readonly alive: boolean;
  readonly coreHp: number;
  readonly maxCoreHp: number;
  /** Combined HP across both shield generators (0 with none built). */
  readonly shieldHp: number;
  readonly shields: number;
  readonly turrets: number;
  /** Live radar satellites orbiting this station (feature f1, cap 1). Own-station
   *  knowledge: it is a body orbiting your own home, in plain sight. */
  readonly satellites: number;
  /** Jobs still under construction, all kinds (GDD §2.5). */
  readonly builds: number;
  /**
   * Queued construction **by kind** — turrets, shields, satellites.
   *
   * A tree plans against `standing + queued < target`, and the *kind* matters:
   * with only the total, a shield 15 seconds from completion reads as a turret
   * already on order, so a bot with a hole in its turret ring sits on the ore and
   * waits for a job that will never fill the hole (`./behaviors` `structureGap`).
   * The sim counts its caps this way too (`turretCount`/`shieldCount`/
   * `satelliteCount` in `sim/buildings.ts`) — this is the same arithmetic, on the
   * bot's side of the fog.
   */
  readonly turretsBuilding: number;
  readonly shieldsBuilding: number;
  readonly satellitesBuilding: number;
  /** The repair TELL (GDD §2.5): a patch was bought recently and the glow is
   *  still lit. Signalling only — it is {@link repairReadyIn} that decides
   *  whether the next press is accepted. */
  readonly repairing: boolean;
  /**
   * Seconds until this station's REPAIR wedge re-arms, `0` when it is ready
   * (RATIFIED developer, 2026-07-28: a 15-second per-station repair cooldown).
   *
   * Public information by construction — the wheel counts it down in words on
   * the owner's own screen ("REPAIR in 12s"), so a bot reading it is reading its
   * own HUD, not the world. It is the gate that actually refuses a press
   * (`sim/buildings.ts` `placeOrder` → `'cooling-down'`); the `repairing` tell
   * above releases at half that, so a tree that paced off the tell alone spent
   * the back half of every cooldown filing orders the sim threw away.
   */
  readonly repairReadyIn: number;
  readonly sinceDamage: number;
  /** The alarm (GDD §2.2): something has been hitting home recently. */
  readonly underAttack: boolean;
  readonly distance: number;
}

/** Another player's ship, as seen. */
export interface PerceivedShip {
  readonly id: PlayerId;
  /**
   * **Is this a foe?** `areEnemies(world, self, this.id)` — the sim's ONE
   * allegiance predicate (`sim/allegiance.ts`), stamped here so no bot branch
   * re-derives it. In FFA (teams-of-one) it is true for everything in the view;
   * in TEAMS it is false for a teammate, and a teammate is not a target at any
   * range, in any behavior, at any tier.
   */
  readonly hostile: boolean;
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
  /** Firing this tick — gunfire is the loudest tell in the game. */
  readonly firing: boolean;
  /** Untouchable right now (GDD §2.1 spawn protection), if close enough to read
   *  the glow. */
  readonly spawnProtected: boolean | null;
}

/** Another player's home station, as seen. Position and ownership are public;
 *  the numbers are scouted. */
export interface PerceivedStation {
  readonly owner: PlayerId;
  /**
   * **Is this home a foe's?** The same `areEnemies` stamp {@link PerceivedShip}
   * carries, asked of the station's owner — which is exactly the question the
   * sim's own siege ladder asks (`sim/step.ts`: `areEnemies(world, ship.id,
   * station.owner)`). A bot lays siege only to a hostile home; an ally's station
   * is a landmark and an obstacle, never a target.
   */
  readonly hostile: boolean;
  readonly pos: Vec2;
  readonly radius: number;
  /** False for a wreck. Public at any range — smoke carries (GDD §2.2). */
  readonly alive: boolean;
  readonly distance: number;
  /** True when this station is inside sensor range this tick, i.e. its numbers
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

/**
 * A slot on this bot's own side — its **roster** entry, not a sighting.
 *
 * Stage 1 of `docs/team-bots-plan.md` exists because a bot's model of *winning*
 * was wrong in TEAMS rather than merely unsophisticated: the sim ends a match
 * when the last **team** holding a core is alone (`sim/match.ts` `resolveWinner`,
 * GDD §1), and every read in the bot layer was *me*-shaped. This is the roster a
 * tree needs to ask the right question — "does my side still hold a core?"
 * instead of "do I?".
 *
 * **Every field here is public at any range, and that is the whole test it had
 * to pass.** A station's position and its owner's beacon ring are drawn map-wide
 * (style-guide §5, "ownership … always visible"), and a wreck is visible from
 * further away than its numbers are (GDD §2.2) — the same licence
 * {@link PerceivedStation} already ships `pos` and `alive` under. Who is on your
 * side is the `FRIENDLY A` label over the hull (`src/ui/hud.ts`), which is the
 * lobby's, not a scouting report.
 *
 * **Three things are deliberately NOT here**, and the next person to add one
 * should read this first:
 *
 *  - **The ally's core and shield HP.** Scouted for everyone, ally included
 *    (`perceiveStation` below, and `docs/bot-teams-allegiance-p16.md` §4). A
 *    human does not get a teammate's HP on their HUD either.
 *  - **Whether the ally's *ship* is alive.** A teammate dying in a far corner is
 *    not drawn on anyone's screen. Its ship is in {@link BotView.ships} when it
 *    is close enough to see, with a hull bar and everything else, and it is
 *    absent when it is not — which is exactly right. (The plan's sketch of this
 *    record listed a bare `alive`; it is left out because nothing in Stage 1
 *    needs it and fog honesty is structural, not a preference.)
 *  - **Whether the ally's home is under attack.** That one is Stage 2's, and it
 *    is licensed by the shipped human klaxon being team-scoped and range-free
 *    (`src/art/presenter.ts`, `src/art/audio/engine.ts`) — a separate argument
 *    from this one, to be made when it ships and not smuggled in early.
 */
export interface AllyView {
  readonly id: PlayerId;
  /** This ally's home, or `null` if it somehow has none. Position is public. */
  readonly stationPos: Vec2 | null;
  /**
   * Does this ally still hold a core? **This is the win condition**, one slot at
   * a time: the match runs while any member of a side holds one, so a bot's side
   * is alive iff its own station is alive or any of these is. Public — a burning
   * home carries (GDD §2.2).
   */
  readonly stationAlive: boolean;
}

/** A rock, as seen: its size and its crack stage — enough to judge a payout
 *  before committing weapon time (GDD §5.5), never the exact ore inside. */
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
  /**
   * The side this bot fights for (`sim/allegiance.ts` `teamOf`). Public: it is
   * the beacon ring on the hull and the `FRIENDLY A` / `ENEMY B` label the HUD
   * prints beside every name plate in TEAMS (`src/ui/hud.ts`), and it is static
   * match config fixed at match start, so a number captured per view is exactly
   * as fresh as the world.
   *
   * **FFA is teams-of-one**, so this is the bot's own id there and
   * {@link BotView.allies} is empty — which is the structural reason every
   * team-aware branch degrades to today's behaviour rather than being switched
   * off by a mode flag (`docs/team-bots-plan.md` §2.5).
   */
  readonly team: number;
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
  /** Close enough to its own station for the wheel to be live (GDD §2.5). */
  readonly docked: boolean;
  /** Distance to its own station; `Infinity` if it somehow has none. */
  readonly homeDistance: number;
  readonly station: OwnStationView | null;
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
  /**
   * The other slots on this bot's own side, **ascending by id, self excluded**
   * ({@link AllyView}). Empty in FFA — teams-of-one has no allies — which is how
   * every team-aware branch degrades to exactly today's behaviour without a mode
   * flag anywhere in the tree (`docs/team-bots-plan.md` §2.5).
   *
   * The order is ascending rather than "whatever `world.ships` happened to be
   * in": a roster read in an incidental order is a determinism bug that only
   * surfaces on the engine whose array shape differs (GDD §4.8).
   */
  readonly allies: readonly AllyView[];
  readonly ships: readonly PerceivedShip[];
  readonly stations: readonly PerceivedStation[];
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

/** The station owned by a slot, or null. */
function stationIn(world: World, id: PlayerId): MiningStation | null {
  for (const p of world.stations) {
    if (p.owner === id) return p;
  }
  return null;
}

/**
 * A bot's own station, in full. The one place in this module that reads numbers
 * without a range check — it is the bot's own home, and the HUD shows it
 * permanently (GDD §2.2).
 */
function ownStationView(station: MiningStation, from: Vec2, env: Perception): OwnStationView {
  let turretsBuilding = 0;
  let shieldsBuilding = 0;
  let satellitesBuilding = 0;
  for (const job of station.builds) {
    if (job.kind === 'turret') turretsBuilding++;
    else if (job.kind === 'shield') shieldsBuilding++;
    else if (job.kind === 'satellite') satellitesBuilding++;
  }
  return {
    pos: { x: station.pos.x, y: station.pos.y },
    radius: station.radius,
    alive: station.alive,
    coreHp: station.coreHp,
    maxCoreHp: station.maxCoreHp,
    shieldHp: shieldPool(station),
    shields: station.shields.length,
    turrets: station.turrets.length,
    satellites: station.satellites?.length ?? 0,
    builds: station.builds.length,
    turretsBuilding,
    shieldsBuilding,
    satellitesBuilding,
    repairing: station.repairing,
    repairReadyIn: Math.max(0, station.repairGate ?? 0),
    sinceDamage: station.sinceDamage,
    underAttack: station.alive && station.sinceDamage < env.alarmWindow,
    distance: distance(from, station.pos),
  };
}

/** Another player's ship, filtered to what is drawn on screen. `hostile` is the
 *  caller's `areEnemies` read (see the module note): this function never decides
 *  allegiance, it only carries the one answer through. */
function perceiveShip(ship: Ship, from: Vec2, env: Perception, hostile: boolean): PerceivedShip {
  const d = distance(from, ship.pos);
  const seen = d <= env.visualRange;
  return {
    id: ship.id,
    hostile,
    shipClass: ship.shipClass,
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: ship.vel.x, y: ship.vel.y },
    angle: ship.angle,
    alive: ship.alive,
    eliminated: ship.eliminated,
    distance: d,
    hull: seen ? ship.hull : null,
    maxHull: ship.maxHull,
    firing: seen && ship.firing,
    spawnProtected: seen ? ship.spawnProtect > 0 : null,
  };
}

/**
 * Another player's home. Position, ownership, and wreck state are public; the
 * core and shield numbers require sensor range, and the turret count requires
 * being close enough to see the barrels.
 */
function perceiveStation(
  station: MiningStation,
  from: Vec2,
  env: Perception,
  hostile: boolean,
): PerceivedStation {
  const d = distance(from, station.pos);
  // Measured to the station's surface, not its centre: a 64-unit rock you are
  // standing on must not read as out of sensor range.
  const surface = Math.max(0, d - station.radius);
  const scouted = surface <= env.sensorRange;
  const seen = surface <= env.visualRange;
  return {
    owner: station.owner,
    hostile,
    pos: { x: station.pos.x, y: station.pos.y },
    radius: station.radius,
    alive: station.alive,
    distance: d,
    scouted,
    coreHp: scouted ? station.coreHp : null,
    maxCoreHp: station.maxCoreHp,
    shieldHp: scouted ? shieldPool(station) : null,
    turrets: seen ? station.turrets.length : null,
    underAttack: scouted ? station.alive && station.sinceDamage < env.alarmWindow : null,
  };
}

/** Every FFA bot's ally list, shared: a teams-of-one match allocates nothing
 *  here per view (GDD §4.3), and there is nothing to allocate. */
const NO_ALLIES: readonly AllyView[] = Object.freeze([]);

/**
 * The roster of slots on `id`'s own side, ascending by id and never including
 * `id` itself ({@link AllyView}).
 *
 * Walks `world.ships` — a slot with a ship is a slot in the match — and asks the
 * sim's one allegiance predicate per candidate, exactly as the ship and station
 * loops in {@link perceive} do. It never re-derives a side from a `team` number
 * of its own.
 *
 * Derelict homes cannot appear here: a derelict has no ship, and it reads as its
 * own team anyway (`teamOf` falls back to the owner id), so it is nobody's ally.
 *
 * The insertion below keeps the list sorted without `Array.sort` — at most seven
 * entries, so it is cheaper than a comparator and, more to the point, it makes
 * the ordering a property of *this* function rather than of the engine's sort
 * (GDD §4.8).
 */
function allyRoster(world: World, id: PlayerId): readonly AllyView[] {
  let allies: AllyView[] | null = null;
  for (const other of world.ships) {
    if (other.id === id || areEnemies(world, id, other.id)) continue;
    const station = stationIn(world, other.id);
    const ally: AllyView = {
      id: other.id,
      stationPos: station ? { x: station.pos.x, y: station.pos.y } : null,
      stationAlive: station !== null && station.alive,
    };
    allies ??= [];
    // Insertion sort by id: ids are unique, so the order is total and there is
    // no tie to break.
    let at = allies.length;
    while (at > 0 && allies[at - 1]!.id > ally.id) at--;
    allies.splice(at, 0, ally);
  }
  return allies ?? NO_ALLIES;
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
  const ownStation = stationIn(world, id);
  const eye: Vec2 = self ? self.pos : (ownStation?.pos ?? { x: 0, y: 0 });

  const ships: PerceivedShip[] = [];
  const stations: PerceivedStation[] = [];
  const asteroids: PerceivedAsteroid[] = [];
  const chunks: PerceivedChunk[] = [];

  // A dead bot sees nothing but the respawn clock — its cockpit is wreckage.
  const looking = self !== null && self.alive;

  if (looking) {
    for (const other of world.ships) {
      if (other.id === id) continue;
      // Whose side it is on, asked ONCE, of the sim's one predicate. Self is
      // already skipped above, and `areEnemies` short-circuits `a === b` anyway,
      // so self-immunity never depends on this loop's shape.
      const p = perceiveShip(other, eye, env, areEnemies(world, id, other.id));
      // Out of visual range: the ship is not on screen, so it is not in the
      // view at all. (Its station still is — stations are landmarks.)
      if (p.distance <= env.visualRange) ships.push(p);
    }
    for (const station of world.stations) {
      if (station.owner === id) continue;
      stations.push(perceiveStation(station, eye, env, areEnemies(world, id, station.owner)));
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
    self: selfView(self, ownStation, env, teamOf(world, id)),
    // The roster is filled even for a bot whose cockpit is wreckage: it is the
    // lobby plus map-wide public state, not a sighting, and a dead player's
    // screen still shows the board they are about to respawn into.
    allies: allyRoster(world, id),
    ships,
    stations,
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
function selfView(
  ship: Ship | null,
  station: MiningStation | null,
  env: Perception,
  team: number,
): SelfView {
  if (!ship) {
    const pos: Vec2 = station ? { x: station.pos.x, y: station.pos.y } : { x: 0, y: 0 };
    return {
      id: -1,
      team,
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
      station: station ? ownStationView(station, pos, env) : null,
    };
  }
  return {
    id: ship.id,
    team,
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
    docked: station !== null && isDocked(ship, station),
    homeDistance: station ? distance(ship.pos, station.pos) : Number.POSITIVE_INFINITY,
    station: station ? ownStationView(station, ship.pos, env) : null,
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

/** Docking distance to a station — the wheel's radius (GDD §2.5), for trees that
 *  plan a trip home. */
export const DOCK_RANGE = STATION.dockRange;

/** The nearest element of `list`, or null when it is empty. Every perceived
 *  entity carries its own `distance`, so this is a min over a field. */
export function nearest<T extends { readonly distance: number }>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const item of list) {
    if (best === null || item.distance < best.distance) best = item;
  }
  return best;
}
