/**
 * tests/adversarial/antagonist.ts — **the thing that stands in the wrong place.**
 * OWNER: QA Agent (a0-106).
 *
 * Every bug of one particular kind has reached this studio the same way: the
 * developer found it. a0-81 — a fleeing bot that would not shoot. a0-105 — a bot
 * camped at its own station, frozen for as long as a player cared to stand
 * there. Both arrived as a screenshot and a sentence, and both cost a live match
 * to find, because the match harness plays bot-vs-bot and **bots play the game
 * the way it is meant to be played**. Nothing in the suite stood in the wrong
 * place on purpose, which is the first thing a player does.
 *
 * This file is that missing player. It is the seed
 * `evidence/a0-105-standoff/standoff.ts` lifted into a reusable instrument: a
 * real world, real behaviour trees, fog-honest views, and one hostile that does
 * a single deliberately unhelpful thing and **holds it** while the bot under
 * test runs its own real brain against it.
 *
 * ── What is scripted and what is not ───────────────────────────────────────
 *
 * Only the antagonist. The bot under test gets `botInputs` — its own cadence,
 * its own fog, its own gun, its own tree — and it is free to fly anywhere it
 * likes. The antagonist is the *only* thing this harness reaches into the world
 * to move, so any hold that shows up is a property of the bot's tree and not of
 * the staging.
 *
 * The antagonist **station-keeps perfectly**: its position and velocity are set
 * each tick to wherever it has decided to be ({@link Antagonist.want}). That is
 * an idealisation of a player and it is the right one for an instrument — a
 * human holds a spot to within a few units by thrusting against their own drift,
 * and the few units of wobble would only add noise to a measurement whose whole
 * question is *"does this ever end?"*. It is also exactly what the a0-105
 * evidence run did, so the numbers here are comparable with the ones already
 * ratified. Its **gun is real**: `auto` fire through the sim's own weapon, so a
 * poke costs the bot real hull off `sim/damage.ts` rather than a number this
 * file writes.
 *
 * ── The property this exists to measure ────────────────────────────────────
 *
 * a0-105's ruling generalises past the bot that prompted it:
 *
 * > **Any latch whose release depends only on conditions an opponent controls
 * > can be held open by that opponent.**
 *
 * So the measurement is always the same shape, whatever the latch: the longest
 * **unbroken run of ticks** the latch reads engaged, and what the bot turned to
 * when it let go. `./latches.ts` enumerates what to watch; `./latch-bounds.test.ts`
 * asserts a bound exists.
 *
 * A run that ends because the bot **died** is recorded as such and is not the
 * same finding as one that ends because the bot **decided**: respawn is free
 * (GDD §2.3, §2.7), so death is a legitimate bound on any latch — but a latch
 * that only ever ends that way is a bot that had to be killed to be switched
 * back on, and the report says so out loud.
 */

import type { Action, Vec2 } from '@shared/types';
import { ShipClass } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step } from '../../src/sim';
import type { Inputs, MiningStation, PlayerInput, PlayerSpec, Ship, World } from '../../src/sim';
import { botInputs, createBot, createBots, fillEmptySlots } from '../../src/bots';
import type { Bot, PersonalityId } from '../../src/bots';

// ---------------------------------------------------------------------------
// The staging
// ---------------------------------------------------------------------------

/** Everything a scripted antagonist is allowed to look at, and everything a
 *  measurement wants afterwards. */
export interface Stage {
  readonly world: World;
  /** The bot under test — slot 0, its own brain, never scripted. */
  readonly bot: Bot;
  /** Slot 0's hull. */
  readonly me: Ship;
  /** The antagonist's hull — slot 1, scripted, never thinks. */
  readonly foe: Ship;
  /** Slot 0's own station. */
  readonly home: MiningStation;
  /** Bots that are neither the subject nor the antagonist: teammates and the
   *  far side, seated so the team latches have somebody to answer. Empty in the
   *  duel staging. */
  readonly others: readonly Bot[];
}

/** How the bot under test is put on the board before the antagonist starts. */
export interface Staging {
  readonly id: string;
  /** One line, for the report. */
  readonly what: string;
  /** Lobby size. 2 is the duel; 4 seats a teammate and a second hostile. */
  readonly slots: number;
  /** Teams table by slot, or undefined for FFA. */
  readonly teams?: readonly number[];
  /** Hull fraction the subject opens at. Below every tier's nerve floor (the
   *  clamp on `retreatThreshold` is 0.15) so the flee branch is live for the
   *  whole cast rather than only its timid half. */
  readonly hull: number;
  /** Cargo fraction the subject opens with, so `haul` has something to hold. */
  readonly cargo: number;
}

/**
 * The **duel**: the subject wounded at its own doorstep with a part-full hold,
 * one hostile, a real ore field in front of it. This is the a0-105 photograph
 * generalised — every FFA latch the trees have can engage from here, because
 * every one of them is about a wounded bot with somewhere to be and something in
 * the way.
 */
export const DUEL: Staging = {
  id: 'duel',
  what: '1v1 FFA — subject wounded at its own station with a part-full hold',
  slots: 2,
  hull: 0.14,
  cargo: 0.9,
};

/**
 * The **squad**: two a side, so the two ally latches (`defend-ally`,
 * `join-assault`) have a teammate to answer and an enemy home to raid. The
 * teammate is a real bot on its own tree; only slot 1 is scripted.
 */
export const SQUAD: Staging = {
  id: 'squad',
  what: '2v2 TEAMS — subject wounded beside a live teammate, one scripted hostile',
  slots: 4,
  teams: [0, 1, 0, 1],
  hull: 0.14,
  cargo: 0.9,
};

/** Core fraction {@link SIEGE_HOME} pins the subject's own station at: below
 *  `CORE_FINAL_ASSAULT` (0.3), so the last-stand branch is live, and above zero,
 *  so the siege never resolves by the core dying. */
export const SIEGE_CORE_FRACTION = 0.2;

/** Core fraction {@link SIEGE_ALLY} pins the *teammate's* station at: healthy
 *  enough that the teammate is not itself in a last stand (which would change
 *  what the subject hears), damaged enough that the klaxon rings. */
export const ALLY_SIEGE_CORE_FRACTION = 0.5;

/** Fixed seed for every staging: this instrument answers "does it end?", and a
 *  seed sweep would only trade a clear answer for a slow one. The antagonists
 *  below are the variable, not the world. */
const WORLD_SEED = 20260819;

/** Build the board and seat everybody. */
export function stage(staging: Staging, personality: PersonalityId): Stage {
  const world = createWorld({
    seed: WORLD_SEED,
    // Built branch-wise rather than with an always-present `team: undefined`:
    // `PlayerSpec.team` is genuinely optional (an absent team IS FFA), and under
    // `exactOptionalPropertyTypes` those are not the same thing.
    players: Array.from({ length: staging.slots }, (_, id): PlayerSpec => {
      const team = staging.teams?.[id];
      return team === undefined ? { id, shipClass: ShipClass.Vanguard } : { id, shipClass: ShipClass.Vanguard, team };
    }),
    bounds: { width: 4000, height: 4000 },
  });
  // Past the opening: spawn protection off, stations long undamaged, so nothing
  // in the reading is an artefact of the first ten seconds of a match.
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
  }

  const me = world.ships[0]!;
  const foe = world.ships[1]!;
  const home = world.stations.find((s) => s.owner === 0)!;

  me.hull = me.maxHull * staging.hull;
  me.cargo = me.cargoCap * staging.cargo;
  // The subject starts where the photograph found it: at its own station, having
  // already run there and arrived.
  me.pos = { x: home.pos.x, y: home.pos.y };
  me.vel = { x: 0, y: 0 };

  const seats = fillEmptySlots([], staging.slots, undefined, staging.teams);
  // The subject is the character under test; everybody else keeps roster order.
  const subjectSeat = { ...seats[0]!, personality };
  const bot = createBot(subjectSeat, { seed: 3 });
  // Slots 2+ are live bots so the team latches have something to answer; slot 1
  // is the antagonist and gets no brain at all.
  const others = staging.slots > 2 ? createBots(seats.slice(2), { seed: 3 }) : [];

  return { world, bot, me, foe, home, others };
}

// ---------------------------------------------------------------------------
// The antagonists
// ---------------------------------------------------------------------------

/** What the antagonist has decided to do this tick. */
export interface Intent {
  /** Where it holds station. */
  readonly at: Vec2;
  /** Trigger down (the sim's own auto-aim weapon, so a poke costs real hull). */
  readonly fire: boolean;
}

/** One deliberately unhelpful thing, held. */
export interface Antagonist {
  readonly id: string;
  /** One line, for the report. */
  readonly what: string;
  /** Which staging this behaviour needs. */
  readonly staging: Staging;
  /** Hold the subject's hull at its staged fraction every tick — "never kill".
   *  Any latch exit gated on the subject recovering can then never fire, which
   *  is the whole point of the case. */
  readonly pinSubjectHull?: boolean;
  /** Keep the antagonist's own hull full — "never die". */
  readonly invulnerable?: boolean;
  /** Hold the subject's own core under attack and below `CORE_FINAL_ASSAULT`,
   *  without ever finishing it — the structural twin of `pinSubjectHull`. */
  readonly pinSubjectHome?: boolean;
  /** The same, on the subject's teammate's core, at a fraction that rings the
   *  klaxon without triggering the teammate's own last stand. */
  readonly pinAllyHome?: boolean;
  /** Where to stand this tick. */
  intent(s: Stage, tick: number): Intent;
}

/** Unit vector from `a` to `b`, or `fallback` when they coincide. */
function toward(a: Vec2, b: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  return d < 1e-6 ? fallback : { x: dx / d, y: dy / d };
}

/** A point `back` units from `target`, on the line from `target` to `from` — the
 *  spot a body-blocker stands on to shut a doorstep. */
function doorstep(from: Vec2, target: Vec2, back: number): Vec2 {
  const u = toward(target, from);
  return { x: target.x + u.x * back, y: target.y + u.y * back };
}

/** The rock the subject is most likely to want: the nearest one it can reach. */
function nearestRock(s: Stage): Vec2 {
  let best: Vec2 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const rock of s.world.asteroids) {
    if (rock.ore <= 0) continue;
    const d = Math.hypot(rock.pos.x - s.me.pos.x, rock.pos.y - s.me.pos.y);
    if (d < bestD) {
      bestD = d;
      best = rock.pos;
    }
  }
  // A field can be between waves; the arena centre is where the next one lands
  // (GDD §2.3), so that is where the subject is heading anyway.
  return best ?? { x: s.world.bounds.width / 2, y: s.world.bounds.height / 2 };
}

/**
 * **Park.** Sit at a fixed distance from the subject's own station and do
 * nothing at all — no shots, no movement, no reaction. The a0-105 case, and the
 * one the standing gate is named after: an opponent who has genuinely stopped
 * playing must not be able to hold a branch open.
 *
 * **The distance is the variable, and sweeping it is what earns this its keep.**
 * The flee branch reads two ranges — `THREAT_RANGE` (416) on the way in and
 * `RETREAT_CLEAR_RANGE` (676) on the way out — and the interesting question is
 * not *"does a parked hostile hold the bot?"* but *"at which range?"*. So the
 * cast below carries three parks, one either side of each range and one between
 * them, and the one in between is where a0-106's finding lives.
 *
 * `from` is measured **from the subject's own station**, along the lane toward
 * the arena centre, which is the lane the developer says they stood in. A
 * wounded subject settles ~80 u the far side of its own station, so the
 * separation the bot actually reads is about `from + 80`.
 */
function park(from: number, note: string): Antagonist {
  return {
    id: `park@${from}`,
    what: `sits ${from}u off the subject's station, on the lane to the field, and does nothing — ${note}`,
    staging: DUEL,
    intent(s) {
      const centre = { x: s.world.bounds.width / 2, y: s.world.bounds.height / 2 };
      const out = toward(s.home.pos, centre);
      return { at: { x: s.home.pos.x + out.x * from, y: s.home.pos.y + out.y * from }, fire: false };
    },
  };
}

/** Inside weapon reach: the a0-105 photograph verbatim. The retreat is *in
 *  contact*, so every exit the trees have is live and the bot should deal with
 *  it — this is the control that says the a0-105 fix works where it was aimed. */
export const PARK_NEAR = park(200, 'inside THREAT_RANGE: in contact, every exit live');

/** **The annulus between the two ranges.** Far enough that the flee branch stops
 *  reading the hostile as *in contact*, near enough that it can never read
 *  *escaped*. Nothing in the trees is written for this band, which is exactly
 *  why an instrument has to sweep it rather than test the two ranges it knows
 *  about. */
export const PARK_BAND = park(580, 'between THREAT_RANGE and RETREAT_CLEAR_RANGE');

/** Past the clear range: the retreat can read *escaped* and must. The control on
 *  the other side. */
export const PARK_FAR = park(840, 'outside RETREAT_CLEAR_RANGE: escape is readable');

/** How close a body-blocker sits to the thing it is shutting. Inside the
 *  subject's own arrival radius on that thing, so there is no way round it that
 *  is not through it. */
const BLOCK_BACK = 90;

/** **Body-block: the ore.** Interpose between the subject and the rock it wants.
 *  Silent — the block is the whole behaviour. */
export const BLOCK_ORE: Antagonist = {
  id: 'block-ore',
  what: 'interposes between the subject and its nearest rock, silently',
  staging: DUEL,
  intent(s) {
    return { at: doorstep(s.me.pos, nearestRock(s), BLOCK_BACK), fire: false };
  },
};

/** **Body-block: the road home.** Stand on the line between the subject and its
 *  own station — the p15 blockade, and the geometry `sim/blockade.ts` reads. */
export const BLOCK_HOME: Antagonist = {
  id: 'block-home',
  what: 'stands on the line between the subject and its own station',
  staging: DUEL,
  intent(s) {
    const dx = s.me.pos.x - s.home.pos.x;
    const dy = s.me.pos.y - s.home.pos.y;
    const d = Math.hypot(dx, dy);
    // Halfway home, or on the doorstep when the subject is already there.
    const back = Math.max(BLOCK_BACK, Math.min(d * 0.5, 400));
    return { at: doorstep(s.me.pos, s.home.pos, back), fire: false };
  },
};

/** **Body-block: the build site.** Park on the subject's own guard ring, between
 *  it and the station it has to dock at to spend a hold. The economic block: a
 *  bot that cannot reach its own wheel builds nothing all match. */
export const BLOCK_BUILD: Antagonist = {
  id: 'block-build',
  what: "parks on the subject's own doorstep so it cannot dock and spend",
  staging: DUEL,
  intent(s) {
    return { at: doorstep(s.me.pos, s.home.pos, s.home.radius + 40), fire: false };
  },
};

/** Seconds in contact, then seconds out of it, for {@link POKE}. The withdrawal
 *  is longer than `Perception.alarmWindow` (2 s), so every threat-gated read
 *  genuinely blinks off rather than smearing into one continuous alarm. */
const POKE_IN_S = 1.5;
const POKE_OUT_S = 3.5;

/**
 * **Poke and withdraw.** Close inside weapon range, hold the trigger down, then
 * leave past `RETREAT_CLEAR_RANGE` and wait — over and over. Every latch that
 * enters on a threat and exits on its absence gets flapped at the period an
 * attacker between bursts actually produces.
 *
 * The withdrawal is past the *clear* range and not merely out of weapon reach,
 * so each cycle offers the subject a genuine, readable escape: anything that
 * still holds through this is holding on memory rather than on the world.
 */
export const POKE: Antagonist = {
  id: 'poke',
  what: 'closes to 150u firing, withdraws past 800u, repeats every 5s',
  staging: DUEL,
  invulnerable: true,
  intent(s, tick) {
    const t = tick * TICK_DT;
    const phase = t % (POKE_IN_S + POKE_OUT_S);
    const inContact = phase < POKE_IN_S;
    // Approach from the subject's own station side, so the poke is also always
    // on the road home and never becomes a free escort out of the field.
    const from = toward(s.me.pos, s.home.pos, { x: 1, y: 0 });
    const range = inContact ? 150 : 800;
    return { at: { x: s.me.pos.x + from.x * range, y: s.me.pos.y + from.y * range }, fire: inContact };
  },
};

/**
 * **Never die, never kill.** Hold the subject at a fixed hull fraction and sit
 * inside its clear range, invulnerable, forever. Both of the flee latch's own
 * exits are conditions this antagonist owns — *escaped* needs the hostile gone,
 * *recovered* needs a hull the subject cannot climb back to in a game with no
 * ship repair — so this is the pure form of the a0-105 ruling: **every exit an
 * opponent controls is switched off, and the only release left is one the bot
 * makes itself.**
 *
 * It follows, unlike the parks, so there is no out-flying it either. If a bound
 * exists under this, a bound exists.
 */
export const NEVER_DIE_NEVER_KILL: Antagonist = {
  id: 'never-die',
  what: 'follows at 200u, invulnerable, subject pinned at its staged hull — no exit an opponent controls can fire',
  staging: DUEL,
  pinSubjectHull: true,
  invulnerable: true,
  intent(s) {
    const from = toward(s.me.pos, s.home.pos, { x: 1, y: 0 });
    return { at: { x: s.me.pos.x + from.x * 200, y: s.me.pos.y + from.y * 200 }, fire: false };
  },
};

/**
 * **Siege the subject's own core, and never finish it.** The structural form of
 * "never die, never kill": the subject's station is held under attack with its
 * core pinned below `CORE_FINAL_ASSAULT` (0.3) and never allowed to fall, so the
 * `last-stand` branch — the strictly-highest priority in every tree, the one
 * that pre-empts the retreat itself — is switched on and can never be switched
 * off by the thing it is defending being resolved either way.
 *
 * This is the only antagonist that reaches past the ships into the station, and
 * it does so for the same reason the hull pin does: an exit gated on the
 * situation ending cannot be measured while the situation is allowed to end.
 */
export const SIEGE_HOME: Antagonist = {
  id: 'siege-home',
  what: "holds the subject's own core under attack at 0.2, never finishing it",
  staging: DUEL,
  pinSubjectHome: true,
  invulnerable: true,
  intent(s) {
    return { at: doorstep(s.me.pos, s.home.pos, s.home.radius + 40), fire: false };
  },
};

/** **Park, with a teammate on the board.** {@link PARK_BAND} in the squad
 *  staging, so the ally latches are on a board where they could fire while the
 *  subject is being stood on. */
export const PARK_SQUAD: Antagonist = {
  id: 'park-squad',
  what: 'PARK in the dead band, on a 2v2 board',
  staging: SQUAD,
  intent(s, tick) {
    return PARK_BAND.intent(s, tick);
  },
};

/** **Never die, never kill, with a teammate on the board.** The strongest hold in
 *  the squad staging: the ally latches measured while the subject's own flee
 *  exits are all switched off. */
export const NEVER_DIE_SQUAD: Antagonist = {
  id: 'never-die-squad',
  what: 'NEVER DIE NEVER KILL, on a 2v2 board',
  staging: SQUAD,
  pinSubjectHull: true,
  invulnerable: true,
  intent(s, tick) {
    return NEVER_DIE_NEVER_KILL.intent(s, tick);
  },
};

/**
 * **Siege the teammate's home, and never finish it.** The klaxon that never
 * stops ringing — `ALLY_RESPONSE_MAX` exists precisely because the plan named
 * this failure ("a siege the responder cannot break becomes a permanent
 * posting") before it happened, so this is the antagonist that goes and checks.
 *
 * It sits on the *ally's* doorstep rather than the subject's, which makes it the
 * one antagonist here that is not standing on the bot under test at all — and
 * that is the point: the hold it produces is entirely second-hand, arriving down
 * the radio.
 */
export const SIEGE_ALLY: Antagonist = {
  id: 'siege-ally',
  what: "holds the teammate's core under attack at 0.5, never finishing it",
  staging: SQUAD,
  pinAllyHome: true,
  invulnerable: true,
  intent(s) {
    const ally = allyStation(s);
    return { at: ally ? doorstep(s.me.pos, ally.pos, ally.radius + 40) : { ...s.foe.pos }, fire: false };
  },
};

/** The subject's teammate's station, or null in a staging with no teammate. */
export function allyStation(s: Stage): MiningStation | null {
  const mine = s.home.team;
  for (const station of s.world.stations) {
    if (station.owner === s.me.id || station.derelict || !station.alive) continue;
    if (mine !== undefined && station.team === mine) return station;
  }
  return null;
}

/** The cast of antagonists, in report order. */
export const ANTAGONISTS: readonly Antagonist[] = [
  PARK_NEAR,
  PARK_BAND,
  PARK_FAR,
  BLOCK_ORE,
  BLOCK_HOME,
  BLOCK_BUILD,
  POKE,
  NEVER_DIE_NEVER_KILL,
  SIEGE_HOME,
  PARK_SQUAD,
  NEVER_DIE_SQUAD,
  SIEGE_ALLY,
];

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** One tick of the record. Small on purpose: a 30-second run is 1800 of these
 *  per cell and the cross-product has hundreds of cells. */
export interface Frame {
  /** The winning leaf's own name (`Brain.lastBehavior`). */
  readonly leaf: string;
  /** Was the subject alive at the end of this tick? */
  readonly alive: boolean;
  /** Trigger down this tick — the sim's own flag, not the bot's intent. */
  readonly firing: boolean;
  /** Where the subject was, so a hold can be told apart from a freeze. */
  readonly x: number;
  readonly y: number;
  /** Which watched latches read engaged, by id. */
  readonly on: readonly string[];
}

/** What a latch registry entry has to answer, per tick. */
export interface Watch {
  readonly id: string;
  engaged(s: Stage): boolean;
}

export interface RunOptions {
  readonly seconds: number;
  readonly watches: readonly Watch[];
}

/** The trace of one (subject, antagonist) cell. */
export interface Trace {
  readonly personality: PersonalityId;
  readonly antagonist: string;
  readonly frames: readonly Frame[];
  /** Ticks the subject spent dead — respawn is free, and a run that ends in one
   *  is a different finding from a run that ends in a decision. */
  readonly deaths: number;
}

/**
 * Run one cell: stage the board, hold the antagonist where it has decided to be,
 * and record every tick.
 *
 * The order inside the loop is the load-bearing part. The antagonist is placed
 * **before** `botInputs`, so the view the subject perceives this tick already
 * contains the hostile in its held position — a placement after the decision
 * would let the subject decide against a world that no longer exists, and every
 * reading would be one tick of lag out.
 */
export function run(antagonist: Antagonist, personality: PersonalityId, options: RunOptions): Trace {
  const s = stage(antagonist.staging, personality);
  const ticks = Math.round(options.seconds / TICK_DT);
  const frames: Frame[] = [];
  const pinnedHull = s.me.maxHull * antagonist.staging.hull;
  let deaths = 0;

  for (let tick = 0; tick < ticks; tick++) {
    const intent = antagonist.intent(s, tick);
    // Perfect station-keeping: see the file header on why an instrument idealises
    // the player's thrusters rather than modelling their wobble.
    s.foe.pos = { x: intent.at.x, y: intent.at.y };
    s.foe.vel = { x: 0, y: 0 };
    if (antagonist.invulnerable) s.foe.hull = s.foe.maxHull;
    // "Never kill": the subject's hull is held where it was staged, so no latch
    // exit gated on recovery can ever fire. Only while it is alive — a respawn
    // is the sim's own release and must not be papered over.
    if (antagonist.pinSubjectHull && s.me.alive) s.me.hull = pinnedHull;
    // The structural pins. `sinceDamage = 0` is what `underAttack` reads
    // (`./perception`), so holding it at zero is an attacker who never lets up;
    // holding the core fraction is the "never kill" half, so no exit gated on
    // the siege resolving — either way — can fire.
    if (antagonist.pinSubjectHome && s.home.alive) {
      s.home.sinceDamage = 0;
      s.home.coreHp = s.home.maxCoreHp * SIEGE_CORE_FRACTION;
    }
    if (antagonist.pinAllyHome) {
      const ally = allyStation(s);
      if (ally && ally.alive) {
        ally.sinceDamage = 0;
        ally.coreHp = ally.maxCoreHp * ALLY_SIEGE_CORE_FRACTION;
      }
    }

    const actors: Bot[] = [s.bot, ...s.others];
    const inputs: PlayerInput[] = [...botInputs(s.world, actors, TICK_DT)];
    inputs.push({ id: s.foe.id, actions: foeActions(s, intent) });
    step(s.world, inputs as Inputs, TICK_DT);

    if (!s.me.alive) deaths++;
    const on: string[] = [];
    for (const watch of options.watches) if (watch.engaged(s)) on.push(watch.id);
    frames.push({
      leaf: s.bot.brain.lastBehavior,
      alive: s.me.alive,
      firing: s.me.firing,
      x: s.me.pos.x,
      y: s.me.pos.y,
      on,
    });
  }
  return { personality, antagonist: antagonist.id, frames, deaths };
}

/** The antagonist's own action stream. Its gun is the sim's, on auto, so a poke
 *  costs the subject real hull through `sim/damage.ts` — this file never writes
 *  a damage number of its own. Thrust is zero because the position is held
 *  directly; emitting a throttle it is not using would only lie to any future
 *  reader of the recording. */
function foeActions(s: Stage, intent: Intent): readonly Action[] {
  const aim = toward(s.foe.pos, s.me.pos);
  return [
    { type: 'thrust', dir: { x: 0, y: 0 } },
    { type: 'aim', dir: aim },
    { type: 'fire', active: intent.fire, auto: true },
  ];
}

// ---------------------------------------------------------------------------
// Reading a trace
// ---------------------------------------------------------------------------

/** The longest unbroken hold of one latch inside a trace, and how it ended. */
export interface Hold {
  /** Ticks in the longest unbroken engaged run. 0 ⇒ the latch never engaged. */
  readonly ticks: number;
  /** Tick the run started, or -1 if it never engaged. */
  readonly from: number;
  /** True when the longest run was still going at the ceiling — the shape of an
   *  unbounded latch, and the only reading this instrument cannot put a number
   *  on. */
  readonly openAtCeiling: boolean;
  /** The leaf the bot turned to on the tick the run ended; `—` when it did not. */
  readonly turnedTo: string;
  /** The run ended because the subject died rather than because it decided. */
  readonly endedByDeath: boolean;
  /**
   * Fraction of the hold's ticks the subject had its trigger down.
   *
   * A held latch is not automatically a defect: a bot fighting a blockader for
   * ninety seconds is playing the game, a bot orbiting its own station for
   * ninety seconds is switched off. This number and {@link travelled} are what
   * tell those two apart, and they are why `defend`, `haul` and `cornered` can
   * sit in the census with no ceiling and still be *asserted on*.
   */
  readonly firedFrac: number;
  /** Furthest the subject got from where the hold started, world units. */
  readonly travelled: number;
}

/** Measure one latch out of one trace. */
export function hold(trace: Trace, latchId: string): Hold {
  let best = 0;
  let bestFrom = -1;
  let bestEnd = -1;
  let runFrom = -1;
  for (let i = 0; i < trace.frames.length; i++) {
    const engaged = trace.frames[i]!.on.includes(latchId);
    if (engaged) {
      if (runFrom < 0) runFrom = i;
      const len = i - runFrom + 1;
      if (len > best) {
        best = len;
        bestFrom = runFrom;
        bestEnd = i + 1;
      }
    } else {
      runFrom = -1;
    }
  }
  const last = trace.frames.length - 1;
  const openAtCeiling = best > 0 && bestEnd > last;
  const endFrame = bestEnd >= 0 && bestEnd <= last ? trace.frames[bestEnd] : undefined;

  let fired = 0;
  let travelled = 0;
  if (best > 0) {
    const start = trace.frames[bestFrom]!;
    for (let i = bestFrom; i < bestFrom + best; i++) {
      const f = trace.frames[i]!;
      if (f.firing) fired++;
      const d = Math.hypot(f.x - start.x, f.y - start.y);
      if (d > travelled) travelled = d;
    }
  }

  return {
    ticks: best,
    from: bestFrom,
    openAtCeiling,
    turnedTo: endFrame ? endFrame.leaf : '—',
    // A run that ends on a dead subject ended because the sim killed it.
    endedByDeath: endFrame !== undefined && !trace.frames[bestEnd - 1]!.alive,
    firedFrac: best > 0 ? fired / best : 0,
    travelled,
  };
}
