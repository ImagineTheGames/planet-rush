/**
 * src/bots/fog-honesty.test.ts — **the decisions do not change when the hidden
 * state does.**
 *
 * `./perception.test.ts` proves the *view* is fog-honest: an unscouted core
 * reads `null`, an out-of-range ship is not in the list, enemy cargo is never
 * there at all. This file proves the thing that actually matters about it —
 * that the **trees** cannot see past it — and it proves it the only way that
 * survives future edits: by scrambling everything a bot is not allowed to know
 * and asserting that all three difficulties emit the *byte-identical* action
 * stream they emitted against the truth.
 *
 * The scrambler (below) rewrites, on a clone of a real mid-match world:
 *
 *   - the core and shield HP of every station outside visual range;
 *   - the turret count of every station outside visual range;
 *   - every rival's held ore, banked ore and upgrade tiers — numbers the game
 *     never draws for anyone (GDD §2.2);
 *   - the hull, facing and velocity of every ship outside visual range;
 *   - the ore left inside every asteroid (a bot may only *estimate* it from size
 *     and crack stage — GDD §5.5);
 *   - the world's RNG state, so a tree cannot be reading the future either.
 *
 * If any tree ever starts peeking — through a new view field, a `World` handed
 * in by a well-meaning refactor, or a memory that remembers something it never
 * saw — one of these assertions fails, and it fails for every difficulty and
 * every character at once.
 *
 * The last test guards the guard: it asserts the scrambler really did change
 * facts a cheating bot would have noticed, so this file can never pass by
 * scrambling nothing.
 *
 * ### Station health (a0-05, GDD §2.2 amended 2026-08-07)
 *
 * **The invariant this file defends is SYMMETRY, not blindness.** Station health
 * used to hide behind a 180-unit `SENSOR_RANGE`, and this scrambler lied about
 * every core outside it. The developer withdrew that rule — the damage ring is
 * now drawn on every station the renderer draws — so the lie moved out to
 * `visualRange` with it. Re-pointed, deliberately, rather than deleted: if the
 * line had simply gone, a bot could start reading the HP of a home four thousand
 * units behind it and no test would object, which is the *opposite* failure and
 * a worse one. And left where it was, the scrambler would have been asserting a
 * blindness humans no longer have, quietly handicapping every bot and shifting
 * the whole difficulty ladder (GDD §2.9).
 *
 * What did NOT move: enemy **ship** hull past the screen edge, enemy cargo, bank
 * and tiers at any range, and the ore left inside a rock. The amendment was about
 * stations.
 *
 * ### Teams (Stage 1 Task 1.5, `docs/team-bots-plan.md`)
 *
 * **Every case below runs twice: once over an FFA world and once over a 4v4.**
 * That is not thoroughness for its own sake — it is the lesson p16-01 paid for.
 * FFA is teams-of-one, so a guarantee about allies *reduces to a tautology* in
 * the default mode and passes forever without being tested once
 * (`docs/bot-teams-allegiance-p16.md` §2). Stage 1 is the first work to put an
 * ally on the view at all (`BotView.allies`), and Stage 2 will put a callout
 * radio beside it, so the moment to land the guard is **before** the thing it
 * guards.
 *
 * The scrambler already exempts nothing but the observer itself, which means a
 * teammate's unscouted core, hold, bank, tiers and off-screen hull are all lied
 * about exactly as a stranger's are — and that is the claim: **sharing a side is
 * not a scouting report.** The teams half of the guard-on-the-guard test asserts
 * the lie really did land on an *ally*, so "we ran it on teams" can never be
 * vacuously true.
 */

import { describe, it, expect } from 'vitest';
import { mulberry32, type Rng } from '@shared/types';
import { areEnemies, createWorld, type World } from '../sim';
import { createBot } from './bot';
import { MATCH_SLOTS, botLobby, createBots, fillEmptySlots, runHeadlessMatch } from './harness';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import { ROSTER } from './personalities';

/**
 * The two lineups every case runs. `undefined` is the FFA roster shape the
 * offline client boots with — **no `team` key at all** — and the 4v4 is the
 * shape in which "a bot may not launder a teammate's knowledge" stops being a
 * tautology.
 */
const LINEUPS: readonly { readonly name: string; readonly teams?: readonly number[] }[] = [
  { name: 'FFA' },
  { name: 'TEAMS 4v4', teams: [0, 0, 0, 0, 1, 1, 1, 1] },
];

/** The seats of a lineup — the whole cast, eight slots, optionally sided. */
function seatsFor(teams?: readonly number[]): ReturnType<typeof fillEmptySlots> {
  return fillEmptySlots([], MATCH_SLOTS, ROSTER, teams);
}

/** A full offline match, mid-flight: eight stations, the whole cast. */
function match(
  seed: number,
  teams?: readonly number[],
): { world: World; bots: ReturnType<typeof createBots> } {
  const seats = seatsFor(teams);
  const world = createWorld({ seed, players: botLobby(seats) });
  return { world, bots: createBots(seats, { seed }) };
}

/** Plain-data world, plain-data clone. */
function clone(world: World): World {
  return JSON.parse(JSON.stringify(world)) as World;
}

/** A number a bot must not be able to tell from the real one. */
function noise(rng: Rng, scale: number): number {
  return rng.next() * scale;
}

/**
 * Rewrite everything slot `id` is not entitled to know. Deliberately aggressive:
 * every hidden field gets a *different* value, not a jittered one, so a tree that
 * reads any of them decides differently and the comparison fails loudly.
 */
function scrambleHidden(world: World, id: number, rng: Rng): void {
  const me = world.ships.find((s) => s.id === id)!;
  const eye = me.pos;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  for (const station of world.stations) {
    if (station.owner === id) continue;
    const surface = Math.max(0, dist(eye, station.pos) - station.radius);
    if (surface > DEFAULT_PERCEPTION.visualRange) {
      // Off screen. Since a0-05 the damage ring is drawn on every station the
      // renderer draws — so a home the bot could see IS a home whose health it
      // may read, and the lie starts exactly where the screen ends. (This gate
      // was `SENSOR_RANGE`, 180 units, until GDD §2.2 was amended on 2026-08-07.)
      station.coreHp = 1 + noise(rng, station.maxCoreHp - 1);
      // **The one exemption in this scrambler, and it is an ALLY's alarm clock.**
      //
      // `sinceDamage` is what `AllyView.underAttack` is derived from (Stage 2
      // Task 2.1), and that field is deliberately range-free: in TEAMS a human
      // *already* hears their teammate's under-attack klaxon map-wide, with no
      // scouting — `deriveAlarmAllies` walks every station and adds every
      // same-team owner (`src/art/presenter.ts`), and `alarmRingsFor` gates the
      // ring on that scope (`src/art/audio/engine.ts`). Lying to a bot about it
      // would not be enforcing fog honesty; it would be asserting a **deafness no
      // human has**, which is the same handicap this file's a0-05 note warns
      // about for station health, in the same direction.
      //
      // The exemption is exactly one boolean's worth, and it is one line so it
      // stays that way. An ally's `coreHp` above and its shields and barrels below
      // are still scrambled — the klaxon is a boolean and a boolean is what the
      // human gets (plan Trap 8). A **stranger's** `sinceDamage` is still a lie at
      // any range, because nothing rings for them.
      if (areEnemies(world, id, station.owner)) station.sinceDamage = noise(rng, 30);
      station.repairing = rng.next() < 0.5;
      for (const shield of station.shields) shield.hp = noise(rng, shield.maxHp);
      if (station.turrets.length > 0) {
        // Too far to count barrels either: drop them all.
        station.turrets = [];
      }
    }
  }

  for (const ship of world.ships) {
    if (ship.id === id) continue;
    // Never drawn for anyone, at any range (GDD §2.2).
    ship.cargo = noise(rng, ship.cargoCap);
    ship.banked = noise(rng, 50);
    ship.tiers = { power: 3, speed: 2, engine: 3, cargo: 0, hull: 0 };
    if (dist(eye, ship.pos) > DEFAULT_PERCEPTION.visualRange) {
      // Off screen: even the hull bar is gone.
      ship.hull = 1 + noise(rng, ship.maxHull - 1);
      ship.angle = noise(rng, Math.PI * 2);
      ship.vel = { x: noise(rng, 200) - 100, y: noise(rng, 200) - 100 };
      // Whether a hull is flying or wreckage is not drawn either, once it is
      // off screen. This one is aimed squarely at `BotView.allies` (Stage 1):
      // the roster carries a teammate's **home**, which is public smoke at any
      // range, and deliberately not whether the teammate's *ship* is alive —
      // a teammate dying in a far corner is on nobody's screen. Flip it here,
      // and any future field that quietly leaks it fails this file.
      ship.alive = !ship.alive;
      ship.respawnTimer = noise(rng, 5);
    }
  }

  // A rock's payout is estimated from size and crack stage, never read.
  for (const rock of world.asteroids) {
    rock.ore = noise(rng, rock.maxOre);
    rock.mineBuffer = noise(rng, 0.9);
  }

  // Chunk velocity is not drawn; the chunk itself is.
  for (const chunk of world.chunks) chunk.vel = { x: noise(rng, 80) - 40, y: noise(rng, 80) - 40 };

  // Nobody reads the future.
  world.rngState = (world.rngState ^ 0x5bf0_3635) >>> 0;
  world.nextEntityId += 1000;
}

/**
 * The slots on `eye`'s own side whose **home is off `eye`'s screen** — the allies
 * whose core, shields and barrels the scrambler is entitled to lie about.
 * (Their *klaxon* is not on that list; see the exemption in `scrambleHidden`.)
 */
function hiddenAllyHomes(world: World, eye: number): number[] {
  const me = world.ships.find((s) => s.id === eye)!;
  const out: number[] = [];
  for (const station of world.stations) {
    if (station.owner === eye || areEnemies(world, eye, station.owner)) continue;
    const d = Math.sqrt((me.pos.x - station.pos.x) ** 2 + (me.pos.y - station.pos.y) ** 2);
    if (Math.max(0, d - station.radius) > DEFAULT_PERCEPTION.visualRange) out.push(station.owner);
  }
  return out;
}

/** The first slot, ascending, that has at least one teammate it cannot see the
 *  home of; `-1` if the whole board is huddled together. */
function observerWithHiddenAlly(world: World): number {
  const ids = world.ships.map((s) => s.id).sort((a, b) => a - b);
  for (const id of ids) {
    if (hiddenAllyHomes(world, id).length > 0) return id;
  }
  return -1;
}

/** Decide one tick with a *fresh* mind, so the comparison is view-vs-view and
 *  never memory-vs-memory. */
function decideFresh(world: World, id: number, personality: (typeof ROSTER)[number]) {
  const bot = createBot({ id, personality }, { seed: 4242 });
  return bot.decide(perceive(world, id));
}

/** Sample a running match at a spread of ticks — opening, mid-field, and deep
 *  into the fight — rather than at one convenient instant. */
function sampleTicks(
  seed: number,
  everyTicks: number,
  seconds: number,
  teams: readonly number[] | undefined,
  visit: (w: World) => void,
): void {
  const { world, bots } = match(seed, teams);
  runHeadlessMatch(world, bots, {
    maxSeconds: seconds,
    onTick: (w, tick) => {
      if (tick % everyTicks === 0) visit(w);
    },
  });
}

describe.each(LINEUPS)('fog-honesty in $name — the trees decide on the view, and only the view', ({ teams }) => {
  it('emits identical actions when every hidden number is scrambled, all match long', () => {
    const rng = mulberry32(0xf0_9d);
    let compared = 0;

    sampleTicks(17, 600, 240, teams, (world) => {
      const scrambledFor = new Map<number, World>();
      for (const seat of seatsFor(teams)) {
        if (!world.ships.find((s) => s.id === seat.id)?.alive) continue;
        const lied = clone(world);
        scrambleHidden(lied, seat.id, rng);
        scrambledFor.set(seat.id, lied);
      }

      for (const seat of seatsFor(teams)) {
        const lied = scrambledFor.get(seat.id);
        if (!lied) continue;
        const honest = decideFresh(world, seat.id, seat.personality);
        const fogged = decideFresh(lied, seat.id, seat.personality);
        expect(fogged).toEqual(honest);
        compared++;
      }
    });

    // The sampling actually happened — a silent zero would pass vacuously.
    expect(compared).toBeGreaterThan(50);
  });

  it('holds for every character at every difficulty, including a wounded one', () => {
    const rng = mulberry32(7);
    const { world, bots } = match(23, teams);
    runHeadlessMatch(world, bots, { maxSeconds: 90 });

    // Hurt everyone: the retreat, defend and opportunity branches all become
    // live, so the comparison covers the parts of each tree that read HP.
    for (const ship of world.ships) ship.hull = ship.maxHull * 0.3;
    for (const station of world.stations) station.coreHp = station.maxCoreHp * 0.4;

    for (const personality of ROSTER) {
      for (const id of [0, 3, 6]) {
        if (!world.ships.find((s) => s.id === id)?.alive) continue;
        const lied = clone(world);
        scrambleHidden(lied, id, rng);
        expect(decideFresh(lied, id, personality)).toEqual(decideFresh(world, id, personality));
      }
    }
  });

  it('scrambles something a cheat would have noticed — the guard on the guard', () => {
    const { world, bots } = match(5, teams);
    runHeadlessMatch(world, bots, { maxSeconds: 120 });

    // **Whose eyes?** In FFA, any slot's. In TEAMS the claim under test is
    // specifically that the lie lands on a *teammate's* hidden numbers, and a
    // teammate whose home is on this bot's screen has no hidden numbers to lie
    // about — so an observer parked between all three of its allies' front doors
    // satisfies "we ran it on teams" while asserting nothing. Slot 0 is exactly
    // that bot at this seed once Stage 2 ships and bots fly to each other's
    // homes, which is how this was found. Pick the observer *by the property
    // under test* instead, and assert one exists.
    const eye = teams ? observerWithHiddenAlly(world) : 0;
    expect(eye).toBeGreaterThanOrEqual(0);

    const lied = clone(world);
    scrambleHidden(lied, eye, mulberry32(99));

    const changed = (pick: (w: World) => number): boolean => pick(world) !== pick(lied);
    // Enemy holds, enemy banks, and the ore inside the rocks all moved.
    expect(changed((w) => w.ships.reduce((sum, s) => sum + (s.id === eye ? 0 : s.cargo + s.banked), 0))).toBe(true);
    expect(changed((w) => w.asteroids.reduce((sum, a) => sum + a.ore, 0))).toBe(true);
    // And at least one unscouted core is now telling a different story.
    const cores = (w: World): number[] => w.stations.filter((p) => p.owner !== eye).map((p) => p.coreHp);
    expect(cores(lied)).not.toEqual(cores(world));

    // Meanwhile the view a bot is *given* is unchanged — which is the whole
    // point: the lie lives entirely in the half of the world it cannot see.
    // In TEAMS this is also the structural statement about `BotView.allies`:
    // the roster is public facts plus the klaxon, so a world that lied about
    // everything else on this bot's own side still produces a byte-identical view.
    expect(perceive(lied, eye)).toEqual(perceive(world, eye));

    // …and in TEAMS, the lie landed on a TEAMMATE, not only on strangers.
    // Without this the teams half of the sweep would be "we ran it twice" and
    // nothing more: FFA is teams-of-one, so an ally guarantee that is never
    // aimed at an actual ally is a tautology (p16-01's lesson, §2).
    if (teams) {
      const allies = perceive(world, eye).allies.map((a) => a.id);
      expect(allies.length).toBeGreaterThan(0);
      const bank = (w: World): number[] =>
        allies.map((id) => w.ships.find((s) => s.id === id)!.banked);
      // Cores only for the allies whose homes are genuinely off this bot's
      // screen — the ones there is something to lie about.
      const hidden = hiddenAllyHomes(world, eye);
      expect(hidden.length).toBeGreaterThan(0);
      const core = (w: World): number[] =>
        hidden.map((id) => w.stations.find((p) => p.owner === id)!.coreHp);
      expect(bank(lied)).not.toEqual(bank(world));
      expect(core(lied)).not.toEqual(core(world));
    }
  });
});
