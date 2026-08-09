/**
 * src/sim/match.ts — how a match ends. OWNER: Gameplay Engineer.
 *
 * The three rules that turn a firefight into a match with a result (GDD §1,
 * §2.3, §2.7):
 *
 *  - **Elimination.** A core at zero ends its owner's match. The station becomes
 *    a **wreck** that stays on the map for the rest of the match, its defenses
 *    die with it, its owner's ship is destroyed and never respawns — and its
 *    banked fortune bursts into **debris anyone can scavenge**. Small holds mean
 *    nobody hauls a dead player's fortune away in one trip, so a fresh wreck is
 *    a contested place, which is the point.
 *
 *  - **Collapse.** When the last wave is exhausted (or the grace window after it
 *    runs out), the field closes: no shield regeneration, no repair, no new ore.
 *    The match cannot stalemate because the economy that funds standing still
 *    has stopped (GDD §2.3, §2.6 "the economy is the siege engine of last
 *    resort"). The three rules are enforced where they live — shield regen and
 *    the repair channel in `./buildings`, wave spawning in `./waves` — and this
 *    module owns the transition and the one flag they all read.
 *
 *  - **Win/loss, last TEAM to die.** The last *team* with a core standing wins
 *    (Task D1). In FFA every player is a team of one, so this is the familiar
 *    "one home left standing"; in TEAMS a side keeps playing while any ally's
 *    core survives, and wins the instant the opposing team's last core falls —
 *    even while two of its own homes still stand. If the final cores of the last
 *    two teams die in the *same tick*, the team whose core reached zero last in
 *    the simulation's resolution order wins — `match.eliminated` is that order,
 *    recorded as it happens, so the tiebreak is a lookup rather than a guess.
 *
 * Determinism (GDD §4.8): fixed iteration order, no RNG (debris scatters on an
 * index-derived ring, exactly like a ship's death drop), every rate `* dt`.
 */

import type { PlayerId } from '@shared/types';
import {
  CHUNK,
  COLLAPSE_CORE_DECAY,
  COLLAPSE_GRACE_FLOOR_S,
  COLLAPSE_GRACE_S,
  WAVE_COUNT,
  WRECK,
  clampToMargin,
  waveIntervalOf,
  waveTime,
} from './constants';
import { creditKill } from './combat-credit';
import { killShip } from './damage';
import { ledgerAdd } from './ore-ledger';
import type { MiningStation, World } from './state';
import { allWavesSpawned, fieldExhausted } from './waves';

// ---------------------------------------------------------------------------
// Reading the phase
// ---------------------------------------------------------------------------

/**
 * True once the collapse phase has begun — no shield regeneration, no repair,
 * no new ore (GDD §2.3). Reads `collapseTime`, not `phase`, so the collapse
 * rules keep applying after a winner is declared.
 */
export function isCollapsed(world: World): boolean {
  return world.match.collapseTime >= 0;
}

/** True once the match has a result. */
export function isOver(world: World): boolean {
  return world.match.phase === 'ended';
}

/** True for a station that has become a wreck: dead, but still on the map for
 *  the rest of the match, still solid, still worth flying to (GDD §2.7). */
export function isWreck(station: MiningStation): boolean {
  return !station.alive;
}

/**
 * Sim time at which collapse begins no matter what is left in the field. Reads
 * the match's abundance-resolved wave interval (`world.economy.waveInterval`) and
 * re-anchors the deadline so match length holds regardless of abundance
 * (`collapseDeadlineFor`) — a SCARCE match's waves being further apart never
 * pushes the ending past the 10–15 min target (GDD §1). A world without a
 * resolved economy (legacy/foreign) reads the baseline interval, so the pre-p11
 * deadline is unchanged.
 */
export function collapseDeadline(world?: World): number {
  const interval = waveIntervalOf(world);
  // The pre-p11 anchor — the baseline deadline (750 s at shipped constants); a
  // longer SCARCE interval must not push the ending past it.
  const anchored = waveTime(WAVE_COUNT) + COLLAPSE_GRACE_S;
  // …but collapse can never be forced before the final wave has actually landed,
  // so keep a floor of grace after it (bounded by the base grace, so a mocked
  // accelerated match with a tiny grace still forces on schedule).
  const floor = Math.min(COLLAPSE_GRACE_FLOOR_S, COLLAPSE_GRACE_S);
  return Math.max(anchored, waveTime(WAVE_COUNT, interval) + floor);
}

// ---------------------------------------------------------------------------
// Elimination and the wreck (GDD §2.7)
// ---------------------------------------------------------------------------

/**
 * The core is gone. The station stops being a station and becomes a wreck that
 * stays on the map for the rest of the match (GDD §2.7): its defenses die with
 * it, unfinished construction is lost, shots already in the air from its
 * turrets stop being a threat — and its owner is eliminated.
 *
 * Called the instant a core reaches zero, from whichever source took it there
 * (`damageStation`, or collapse decay). Idempotent, because two shots can land on
 * the same core in the same tick.
 *
 * Turrets are zeroed rather than spliced — `sweepDeadTurrets` removes them at
 * end of step, so indices stay stable for every shot already resolved this tick.
 *
 * `by` is the slot that landed the killing blow, when there was one, and it is
 * carried straight through to {@link eliminate} — the single non-idempotent point
 * on this path, so a core cannot pay its 10× twice even if two shots reach it in
 * the same tick. Collapse decay calls this with no `by` at all: the Crush has no
 * attacker, and measurement says that is the *common* case, not a corner one
 * (§1.5 — 100% of station deaths in an Easy lobby). Nobody is credited then, by
 * design (`./combat-credit`).
 */
export function destroyCore(world: World, station: MiningStation, by?: PlayerId): void {
  station.coreHp = 0;
  station.alive = false;
  station.repairing = false;
  for (const t of station.turrets) t.hp = 0;
  for (const s of station.shields) s.hp = 0;
  // Radar satellites die with the station (feature f1): zero their HP so their
  // sensor coverage collapses this tick and `sweepDeadSatellites` clears them at
  // end of step, exactly as the turrets above are handled.
  if (station.satellites) for (const sat of station.satellites) sat.hp = 0;
  station.builds.length = 0;
  for (const p of world.projectiles) {
    if (p.active && p.owner === station.owner) p.active = false;
  }
  eliminate(world, station, by);
}

/**
 * Record the death in the elimination order and pay out the wreck. The push onto
 * `match.eliminated` *is* the last-to-die order, so it happens here, in
 * resolution order, rather than being reconstructed later from timestamps.
 *
 * The `eliminated` guard below makes this the once-per-death point, which is why
 * the station kill is credited HERE rather than in `destroyCore` (which is
 * deliberately idempotent).
 */
function eliminate(world: World, station: MiningStation, by?: PlayerId): void {
  if (world.match.eliminated.includes(station.owner)) return;
  creditKill(world, by, station.owner, 'stationKills');
  world.match.eliminated.push(station.owner);
  station.deathTime = world.time;

  // The owner is out (GDD §2.7): their ship dies where it stands — shedding
  // half its hold like any death — and it never respawns. The Rematch button is
  // the UI's answer to this flag.
  //
  // Deliberately NOT credited as a ship kill, even when a player took the core:
  // a "ship destroyed" is a killing blow landed on a hull, and this hull was not
  // shot — it went down with the seat. The 10× station kill already pays for
  // ending the player, and crediting the 5× too would pay one act twice
  // (`./combat-credit`, and the honesty rule in §1.5). Hence no `by` here.
  const ship = shipOwnedBy(world, station.owner);
  let banked = 0;
  if (ship) {
    if (ship.alive) killShip(world, ship);
    ship.eliminated = true;
    ship.respawnTimer = 0;
    banked = ship.banked;
    ship.banked = 0;
  }

  // The wreck pays out the dead player's bank PLUS a floor minted from nothing so
  // even a broke player leaves something to scavenge (GDD §2.7). The banked share
  // is a transfer (bank → chunks, conserved); the floor is a fresh source, so the
  // ledger records only the floor here — `scatterWreckDebris` records the chunks
  // it actually lays down as `dropped` and any capped overflow as `capLoss`.
  ledgerAdd(world, 'debrisFloor', WRECK.baseDebrisOre);
  scatterWreckDebris(world, station, banked + WRECK.baseDebrisOre);
}

/** The ship in a given slot, or null (slots and ships are 1:1 in a match).
 *  A local copy of `buildings.shipOf` on purpose: `./buildings` imports this
 *  module for `destroyCore`, and four lines beat an import cycle. */
function shipOwnedBy(world: World, owner: PlayerId) {
  for (const s of world.ships) {
    if (s.id === owner) return s;
  }
  return null;
}

/**
 * Burst `ore` into chunks on a ring around the fresh wreck — the dead player's
 * fortune, loose on the map for anyone (GDD §2.7). Deterministic: the ring
 * angle comes from the chunk index, never the RNG, so two runs scatter debris
 * identically. Capped at `WRECK.maxDebrisChunks`; the excess dies with the
 * station rather than carpeting the arena with collectables.
 */
function scatterWreckDebris(world: World, station: MiningStation, ore: number): void {
  if (ore <= 1e-9) return;
  const whole = Math.min(Math.floor(ore / CHUNK.ore), WRECK.maxDebrisChunks);
  const remainder = whole < WRECK.maxDebrisChunks ? ore - whole * CHUNK.ore : 0;
  const pieces = whole + (remainder > 1e-9 ? 1 : 0);
  if (pieces <= 0) return;

  const ring = station.radius + WRECK.debrisRingOffset;
  for (let i = 0; i < pieces; i++) {
    const theta = (2 * Math.PI * i) / pieces;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // A wreck near the edge would otherwise ring debris into the wall margin —
    // keep every chunk clear of the bounds (field report P1).
    world.chunks.push({
      id: world.nextEntityId++,
      pos: {
        x: clampToMargin(station.pos.x + dx * ring, CHUNK.radius, world.bounds.width),
        y: clampToMargin(station.pos.y + dy * ring, CHUNK.radius, world.bounds.height),
      },
      vel: { x: dx * CHUNK.ejectSpeed, y: dy * CHUNK.ejectSpeed },
      amount: i < whole ? CHUNK.ore : remainder,
      radius: CHUNK.radius,
    });
  }

  // Ledger: the chunks laid down are `dropped` ore (loot on the map); anything the
  // `maxDebrisChunks` cap refused to scatter died with the station — a real sink
  // (`capLoss`), so a hoarder's over-cap fortune is accounted, not silently gone.
  const scattered = whole * CHUNK.ore + (remainder > 1e-9 ? remainder : 0);
  ledgerAdd(world, 'dropped', scattered);
  ledgerAdd(world, 'capLoss', ore - scattered);
}

/**
 * Scatter the lootable debris of every **derelict** wreck a map laid out
 * (Milestone B, derelict-fill maps). A derelict is born a wreck with no owner and
 * no bank, so — like a broke player's home — it leaves the `WRECK.baseDebrisOre`
 * floor: a small ring of ore-laden chunks anyone can scavenge (ratified LOOTABLE,
 * 2026-07-26; GDD §2.7). Called once at world-build (`createWorld`), after the
 * fair opening field, so the home + commons asteroid ids are stamped first. No
 * RNG (the debris ring is index-derived), so the board stays deterministic.
 */
export function scatterDerelictLoot(world: World): void {
  for (const station of world.stations) {
    if (station.derelict) scatterWreckDebris(world, station, WRECK.baseDebrisOre);
  }
}

// ---------------------------------------------------------------------------
// The per-tick pass (GDD §1, §2.3)
// ---------------------------------------------------------------------------

/**
 * Advance the match itself one tick: enter collapse when the field is spent,
 * let entropy chew on what is left, and resolve a winner when only one home is
 * standing. Runs at the *end* of the step, after every source of damage has
 * been applied, so a core that died this tick is counted this tick.
 */
export function updateMatch(world: World, dt: number): void {
  enterCollapseIfDue(world);
  applyCollapseDecay(world, dt);
  resolveWinner(world);
}

/**
 * Collapse begins when the last wave has been delivered *and* the field is
 * exhausted — or, if nobody bothered to mine it out, at `collapseDeadline()`.
 * Both conditions require the final wave, so the phase can never open early on
 * a field that is merely between waves.
 */
function enterCollapseIfDue(world: World): void {
  if (isCollapsed(world) || !allWavesSpawned(world)) return;
  if (!fieldExhausted(world) && world.time < collapseDeadline(world)) return;

  world.match.collapseTime = world.time;
  if (world.match.phase === 'live') world.match.phase = 'collapse';
  // Clear any lingering repair tell as the phase turns: repair shuts off
  // (GDD §2.3). `placeOrder` refuses every repair purchase from here on.
  for (const station of world.stations) station.repairing = false;
}

/** "Entropy finishes whoever the players don't" (GDD §1) — every surviving core
 *  decays at `COLLAPSE_CORE_DECAY` HP/s once collapse opens (ratified 1 at M5;
 *  see the constant). Spawn-protected and dead cores are skipped; a core that
 *  hits zero here is destroyed like any other kill. */
function applyCollapseDecay(world: World, dt: number): void {
  if (COLLAPSE_CORE_DECAY <= 0 || !isCollapsed(world)) return;
  for (const station of world.stations) {
    if (!station.alive || station.spawnProtect > 0) continue;
    station.coreHp -= COLLAPSE_CORE_DECAY * dt;
    if (station.coreHp <= 0) destroyCore(world, station);
  }
}

/**
 * Win condition: the last **team** with a surviving core wins (GDD §1, Task D1).
 *
 * We count distinct surviving *teams*, not surviving cores. A team with two
 * homes still standing is one surviving team, so a 2v2 ends the moment the
 * opposing side loses its last core — while the winners may still hold two. FFA
 * is teams-of-one (`team` defaults to `owner`, see {@link teamOfStation}), so
 * this reduces to "one home left standing", byte-for-byte the old rule.
 *
 * The tie rule is the interesting half. If the final cores of the last two teams
 * die in the same instant — attackers finishing both homes on one tick, or the
 * collapse taking the last two together — there is no survivor to crown, so the
 * match goes to **whoever's core reached zero last** in the simulation's
 * resolution order. That order is `match.eliminated`, appended to as each core
 * dies; the last entry's *team* wins.
 *
 * A world with fewer than two stations is not a match (the render/test harnesses
 * run single-slot worlds); it never ends and never declares a winner. Derelict
 * wrecks (`alive === false` from birth) are nobody's team and are skipped here,
 * so the `8-N` fillers on a derelict-fill map never keep a match alive.
 */
function resolveWinner(world: World): void {
  const m = world.match;
  if (m.phase === 'ended' || world.stations.length < 2) return;

  const survivingTeams = new Set<number>();
  let survivor: PlayerId | null = null;
  let survivorTeam: number | null = null;
  for (const station of world.stations) {
    if (!station.alive) continue;
    const team = teamOfStation(station);
    survivingTeams.add(team);
    survivor = station.owner;
    survivorTeam = team;
  }
  if (survivingTeams.size > 1) return;

  if (survivingTeams.size === 1) {
    // One team still holds a core — even if it holds several. It wins.
    m.winner = survivor;
    m.winningTeam = survivorTeam;
  } else {
    // Every core is gone: the last team to lose its last core takes it.
    const last = lastToDie(m.eliminated);
    m.winner = last;
    m.winningTeam = last === null ? null : teamOfOwner(world, last);
  }
  m.phase = 'ended';
  m.endTime = world.time;
}

/** The team a station fights for — its stamped `team`, or (for the pre-Teams
 *  fixtures other lanes build without one) its owner id, i.e. FFA teams-of-one.
 *  The station-level twin of `allegiance.teamOf`, read here off the core that
 *  actually decides the match rather than off a ship that may be a wreck. */
function teamOfStation(station: MiningStation): number {
  return station.team ?? station.owner;
}

/** The team a given slot fought for, found by its home station — used only for
 *  the same-tick tiebreak, where the winning `PlayerId` is already known and its
 *  team must be reported. Falls back to the id itself (teams-of-one). */
function teamOfOwner(world: World, owner: PlayerId): number {
  for (const station of world.stations) {
    if (station.owner === owner) return teamOfStation(station);
  }
  return owner;
}

/** Whoever died last — the tiebreak, and null if nobody ever did. */
function lastToDie(eliminated: readonly PlayerId[]): PlayerId | null {
  return eliminated.length > 0 ? eliminated[eliminated.length - 1]! : null;
}
