/**
 * evidence/a0-10-defend-an-ally.ts — **the two frames the brief asks for.**
 * OWNER: Bot Engineer (a0-10; `docs/team-bots-plan.md` Stage 2).
 *
 * A Teams match, captured, and the control case beside it:
 *
 *  - **THE ANSWER.** An ally's home comes under attack. A teammate bot in range
 *    breaks off what it was doing, flies across the board, and arrives.
 *  - **THE LADDER.** The identical alarm, at the identical instant, while that
 *    bot's *own* home is also under attack. It stays home. That is the frame
 *    that proves the ladder is still selfish-first — the developer's parenthesis,
 *    *"(if they are under threat as well)"* — and it is the half that keeps this
 *    from becoming a bot that abandons its economy.
 *
 * Both runs are the **same seed, the same cast, the same board, the same tick**.
 * The only difference between them is one number: whether slot 0's own station
 * has taken damage inside the alarm window. Everything printed is read out of
 * the running sim and the bot's own `Brain`; nothing here writes to `src/`.
 *
 * Re-run:  npx vite-node evidence/a0-10-defend-an-ally.ts
 * Writes:  evidence/a0-10-defend-an-ally.json
 */

import { writeFileSync } from 'node:fs';
import { ShipClass } from '../src/shared/types';
import type { PlayerId, Vec2 } from '../src/shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step, type World } from '../src/sim';
import { botInputs, botLobby, createBots, fillEmptySlots } from '../src/bots';

const ME = 0;
const ALLY = 1;
const RAIDER = 2;
const RAIDER2 = 3;
/** 2v2: slots 0+1 against 2+3. */
const SIDES = [0, 0, 1, 1] as const;
/** Warden answers alarms; Patch is the teammate whose home burns. */
const CAST = ['warden', 'patch', 'sable', 'foreman'] as const;

const SEED = 20260809;
const SECONDS = 40;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The board. Slot 0 sits out at a rock field 1150 units from its teammate's
 * home — inside Warden's response reach (1200 × (0.5 + 0.55) = 1260) and far
 * enough that flying there is a visible, costly decision rather than a step.
 */
function board(): World {
  const seats = fillEmptySlots([], 4, [...CAST], [...SIDES]);
  const world = createWorld({ seed: SEED, players: botLobby(seats), bounds: { width: 6000, height: 6000 } });
  world.time = SPAWN_PROTECTION_S + 5;

  place(world, ME, { x: 3000, y: 3150 }, { x: 3000, y: 3400 });
  place(world, ALLY, { x: 3000, y: 2050 }, { x: 3000, y: 2000 });
  place(world, RAIDER, { x: 3060, y: 2000 }, { x: 600, y: 5600 });
  place(world, RAIDER2, { x: 900, y: 5600 }, { x: 900, y: 5600 });
  return world;
}

function place(world: World, id: PlayerId, ship: Vec2, home: Vec2): void {
  const s = world.ships.find((x) => x.id === id)!;
  s.pos = { ...ship };
  s.vel = { x: 0, y: 0 };
  s.home = { ...home };
  s.hull = s.maxHull;
  s.cargo = 0;
  s.spawnProtect = 0;
  const p = world.stations.find((x) => x.owner === id)!;
  p.pos = { ...home };
  p.coreHp = p.maxCoreHp;
  p.spawnProtect = 0;
  p.sinceDamage = 999;
}

interface Sample {
  readonly t: number;
  readonly behavior: string;
  readonly answering: PlayerId;
  readonly toAllyHome: number;
  readonly toOwnHome: number;
  readonly allyAlarm: boolean;
  readonly ownAlarm: boolean;
}

/**
 * Run the board with the ally's home permanently under attack, and — when
 * `ownHomeToo` — slot 0's own home taking fire at the same time. Both alarms are
 * held live by writing `sinceDamage` back after each step, which is exactly what
 * an attacker who does not leave produces.
 */
function run(ownHomeToo: boolean): { samples: Sample[]; summary: Record<string, unknown> } {
  const seats = fillEmptySlots([], 4, [...CAST], [...SIDES]);
  const world = board();
  const bots = createBots(seats, { seed: SEED });
  const me = bots.find((b) => b.seat.id === ME)!;
  const allyHome = world.stations.find((p) => p.owner === ALLY)!.pos;
  const ownHome = world.stations.find((p) => p.owner === ME)!.pos;

  const samples: Sample[] = [];
  const behaviors = new Map<string, number>();
  let closest = Number.POSITIVE_INFINITY;
  let ticks = 0;

  while (world.time < SPAWN_PROTECTION_S + 5 + SECONDS) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    world.stations.find((p) => p.owner === ALLY)!.sinceDamage = 0;
    if (ownHomeToo) world.stations.find((p) => p.owner === ME)!.sinceDamage = 0;

    const ship = world.ships.find((s) => s.id === ME)!;
    const toAlly = dist(ship.pos, allyHome);
    const toOwn = dist(ship.pos, ownHome);
    closest = Math.min(closest, toAlly);
    behaviors.set(me.brain.lastBehavior, (behaviors.get(me.brain.lastBehavior) ?? 0) + 1);
    ticks++;

    // One sample a second: enough to read the flight, short enough to eyeball.
    if (ticks % 60 === 0) {
      samples.push({
        t: +(ticks / 60).toFixed(1),
        behavior: me.brain.lastBehavior,
        answering: me.brain.allyResponse.target,
        toAllyHome: Math.round(toAlly),
        toOwnHome: Math.round(toOwn),
        allyAlarm: true,
        ownAlarm: ownHomeToo,
      });
    }
  }

  return {
    samples,
    summary: {
      closestApproachToAllyHome: Math.round(closest),
      startedAtFromAllyHome: 1150,
      behaviourTickShare: Object.fromEntries(
        [...behaviors].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${((100 * v) / ticks).toFixed(1)}%`]),
      ),
      calloutsOnTheChannel: me.brain.radio?.calls.length ?? 0,
    },
  };
}

const answered = run(false);
const held = run(true);

const out = {
  what: 'a0-10 — a bot answers its ally\'s alarm, and stays home when its own is ringing',
  plan: 'docs/team-bots-plan.md Stage 2 (Tasks 2.1–2.7)',
  fixture: {
    seed: SEED,
    lineup: 'TEAMS 2v2 — warden + patch vs sable + foreman',
    observer: 'slot 0 (Warden), starting 1150 units from its teammate\'s home',
    allyResponseRange: 'ALLY_RESPONSE_RANGE 1200 × (0.5 + homebody 0.55) = 1260',
    note: 'both runs are the same seed, cast, board and tick; the ONLY difference is whether slot 0\'s own home is also taking fire',
  },
  frame1_theAnswer: {
    reading: 'the ally home is burning, my home is quiet — I go',
    ...answered.summary,
    trace: answered.samples,
  },
  frame2_theLadder: {
    reading: 'the same alarm, and my own home is burning too — I stay',
    ...held.summary,
    trace: held.samples,
  },
  verdict: {
    answeredClosed: `${1150 - (answered.summary.closestApproachToAllyHome as number)} units closed toward the teammate's home`,
    heldClosed: `${1150 - (held.summary.closestApproachToAllyHome as number)} units closed`,
    ladderIntact:
      (held.summary.behaviourTickShare as Record<string, string>)['defend-ally'] === undefined,
  },
};

writeFileSync(new URL('./a0-10-defend-an-ally.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out.verdict, null, 2));
console.log('frame 1:', out.frame1_theAnswer.behaviourTickShare, 'closest', out.frame1_theAnswer.closestApproachToAllyHome);
console.log('frame 2:', out.frame2_theLadder.behaviourTickShare, 'closest', out.frame2_theLadder.closestApproachToAllyHome);
