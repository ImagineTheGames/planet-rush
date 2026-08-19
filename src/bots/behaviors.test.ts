/**
 * src/bots/behaviors.test.ts — **movement intent and fire intent are
 * independent.** OWNER: Bot Engineer (a0-81; GDD §2.4, §2.9).
 *
 * The developer, 2026-08-17, from a live match:
 *
 * > *"when rusty was fleeing from me he could have auto fired at me but instead
 * > he didnt it was like he was in a retreat or return to base target but thats
 * > dumb because its unfair for him to just target his base and not fire at me at
 * > same time because thats what i would do"*
 *
 * The last clause is the standard this file tests, and it is the standard GDD
 * §2.9 already sets: a bot runs the *same action interface* a human does, so it
 * has to be allowed to do what a human does. A human fleeing with a full hold
 * fires over their shoulder. It costs them nothing — `sim/step.ts` `integrate`
 * accelerates along `intent.thrust` in world space and `ship.angle` steers only
 * the gun — and it turns a chase from a free kill into a decision.
 *
 * What was actually wrong (the audit, `evidence/a0-81-fleeing-fire/audit.txt`):
 * **not** one `target` field serving both jobs. `retreat` takes its threat as an
 * argument and reads the destination from `self.station`; there is no shared
 * slot the two collapse into. The trigger was simply nailed down — every
 * travelling branch returned a literal `fire(false)` and no `aim` action at all,
 * so the sim's facing ladder fell through to "nose follows velocity" and the bot
 * ran home looking at its own doorstep.
 *
 * Four things are pinned here, and the fourth is the one that keeps this from
 * being a difficulty change smuggled in as a bug fix:
 *
 *  1. a retreating bot shoots at what is chasing it — the developer's frame;
 *  2. it is still *retreating* while it does — the flight is untouched;
 *  3. every tier can, because the bot in the report is Rusty, an **Easy**
 *     character, and a Medium-and-up rule would leave that match unchanged;
 *  4. the branches that were quiet *by design* stay quiet — a teammate on the
 *     tail draws nothing, empty space draws nothing, and `roam`/`scavenge` are
 *     untouched because they sit BELOW the attack branches, where silence is the
 *     tier's own decision rather than a suppressed trigger.
 */

import { describe, it, expect } from 'vitest';
import type { Action, Vec2 } from '@shared/types';
import { ShipClass } from '@shared/types';
import {
  SHIP_WEAPON,
  SPAWN_PROTECTION_S,
  TICK_DT,
  WEAPON_RANGE,
  createWorld,
  step,
  type World,
} from '../sim';
import {
  GUARD_RADIUS,
  RETREAT_CLEAR_RANGE,
  THREAT_RANGE,
  coveringFire,
  haulHome,
  retreat,
  roam,
  scavenge,
  standoffPatience,
} from './behaviors';
import { createBot, type Bot } from './bot';
import { committed } from './commitment';
import { ARRIVE_RADIUS } from './steering';
import { botInputs } from './harness';
import { perceive } from './perception';
import { Difficulty, PERSONALITIES, tuningFor, type PersonalityId } from './personalities';
import { context, type BotCtx } from './tree';

// ---------------------------------------------------------------------------
// The board: one bot, one chaser, and a home to run to
// ---------------------------------------------------------------------------

/** Hull fraction under every tier's nerve (the floor on `retreatThreshold` is
 *  0.15), so the retreat branch is live for Rusty and Sable alike. */
const WOUNDED = 0.12;

/** How far out in the field the bot is caught — a plausible way back. */
const RUN_HOME = 900;

/** Where the chaser sits: on the bot's tail, inside weapon range, and on the
 *  **far side from home**. Behind matters: a hostile parked between the bot and
 *  its station is a *blockade*, which `./cornered.ts` owns and which resolves to
 *  a committed fight rather than a retreat. This is the other case — the one the
 *  developer was flying. */
const CHASE_GAP = WEAPON_RANGE * 0.7;

interface Chase {
  world: World;
  bot: Bot;
  /** Unit vector from the station out to the bot — the way home is `-out`. */
  out: Vec2;
  me: World['ships'][number];
  chaser: World['ships'][number];
}

/**
 * Stage the photograph: a wounded bot `RUN_HOME` out from its own station with a
 * hostile on its tail at knife range.
 *
 * Positions are set directly and — in the decision-level cases — the sim is
 * never stepped, so nothing moves except the clock. These are tests about a
 * *decision*, not about flight; the one case that does fly pins the geometry
 * itself (see {@link chaseFor}).
 */
function chase(opts: { personality: PersonalityId; teammate?: boolean; seed?: number }): Chase {
  const seed = opts.seed ?? 20260817;
  const teams = opts.teammate ? [0, 0, 1, 1] : undefined;
  const world = createWorld({
    seed,
    players: [0, 1, 2, 3].map((id) => ({
      id,
      shipClass: ShipClass.Vanguard,
      ...(teams ? { team: teams[id]! } : {}),
    })),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
  }

  const home = world.stations.find((s) => s.owner === 0)!;
  const me = world.ships[0]!;
  const chaser = world.ships[1]!;

  // Straight out from home toward the arena centre, which is where the ore is
  // and therefore where a bot on its way back from the field comes from.
  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const out: Vec2 = { x: dx / d, y: dy / d };

  me.pos = { x: home.pos.x + out.x * RUN_HOME, y: home.pos.y + out.y * RUN_HOME };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * WOUNDED;
  // Nose pointed at home — exactly the state the defect produced, and the
  // hardest starting angle for the fix to climb out of.
  me.angle = Math.atan2(-out.y, -out.x);

  chaser.pos = {
    x: home.pos.x + out.x * (RUN_HOME + CHASE_GAP),
    y: home.pos.y + out.y * (RUN_HOME + CHASE_GAP),
  };
  chaser.vel = { x: 0, y: 0 };
  for (const s of world.ships) if (s.id !== 0 && s.id !== 1) s.alive = false;

  return { world, bot: createBot({ id: 0, personality: opts.personality }, { seed: 3 }), out, me, chaser };
}

/** One decision's context, perceived through the bot's own fog. Takes the two
 *  fields it actually reads, so the a0-105 staging below can use it too. */
function decide(state: { world: World; bot: Bot }): BotCtx {
  return context(perceive(state.world, 0), state.bot.brain);
}

/** The threat the retreat is handed — the same read the trees make. */
function tail(ctx: BotCtx) {
  return ctx.view.ships.find((s) => s.id === 1) ?? null;
}

// ---------------------------------------------------------------------------
// Reading a stream
// ---------------------------------------------------------------------------

const thrustOf = (stream: readonly Action[]): Vec2 | null => {
  const a = stream.find((x) => x.type === 'thrust');
  return a && a.type === 'thrust' ? a.dir : null;
};
const aimOf = (stream: readonly Action[]): Vec2 | null => {
  const a = stream.find((x) => x.type === 'aim');
  return a && a.type === 'aim' ? a.dir : null;
};
const triggerOf = (stream: readonly Action[]): boolean =>
  stream.some((a) => a.type === 'fire' && a.active);

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const unit = (a: Vec2): Vec2 => {
  const m = Math.sqrt(a.x * a.x + a.y * a.y);
  return m < 1e-9 ? { x: 0, y: 0 } : { x: a.x / m, y: a.y / m };
};
/** Smallest angle between two directions, radians. */
const between = (a: Vec2, b: Vec2): number => {
  const ua = unit(a);
  const ub = unit(b);
  return Math.acos(Math.min(1, Math.max(-1, dot(ua, ub))));
};

/**
 * Fly the chase for `seconds` with the **geometry pinned**: both hulls are put
 * back where they started before every step, so the tail never falls off and the
 * range never opens. Everything else is the real simulation — the bot's own
 * reaction cadence, the sim's turn-rate-limited facing, the weapon reload, the
 * projectiles.
 *
 * Returns the shots the bot actually loosed, counted from the reload jumping
 * back to full inside the step (`fireWeapon`), which is the one unambiguous
 * signal that a projectile left the barrel.
 */
function chaseFor(chaseState: Chase, seconds: number): { shots: number; triggerTicks: number } {
  const { world, bot, me, chaser } = chaseState;
  const mePos = { ...me.pos };
  const chaserPos = { ...chaser.pos };
  let shots = 0;
  let triggerTicks = 0;
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    me.pos = { ...mePos };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * WOUNDED;
    chaser.pos = { ...chaserPos };
    chaser.vel = { x: 0, y: 0 };
    const before = me.weaponCooldown ?? 0;
    const inputs = botInputs(world, [bot], TICK_DT);
    if (triggerOf(inputs[0]!.actions)) triggerTicks++;
    step(world, inputs, TICK_DT);
    if ((me.weaponCooldown ?? 0) > before + SHIP_WEAPON.fireInterval * 0.5) shots++;
  }
  return { shots, triggerTicks };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

describe('a bot running home is still shooting at whoever is chasing it (a0-81)', () => {
  it('a retreating bot still fires on what is chasing it', () => {
    // Rusty: the character in the developer's report, and an EASY one — this
    // case is the reason the fix is not gated at Medium.
    const state = chase({ personality: 'rusty' });
    const ctx = decide(state);
    const threat = tail(ctx);
    expect(threat, 'the chaser is inside the bot\'s own fog').not.toBeNull();
    expect(threat!.distance).toBeLessThanOrEqual(WEAPON_RANGE);

    const stream = retreat(ctx, threat);

    // **The fire intent exists.** On the old code this stream was
    // `[thrust, fire(false)]` — no aim action at all — so both of these fail.
    const aim = aimOf(stream);
    expect(aim, 'a retreating bot aims at something').not.toBeNull();

    // …and it is aimed at the CHASER, not at the station it is flying to. The
    // bearing is allowed to be off by the tier's own spread and no further:
    // Easy leads badly on purpose, it does not point somewhere else.
    const toChaser = { x: threat!.pos.x - ctx.self.pos.x, y: threat!.pos.y - ctx.self.pos.y };
    expect(between(aim!, toChaser)).toBeLessThanOrEqual(ctx.tuning.aimJitter + 1e-9);

    // …and the trigger comes up. Over a pinned three-second chase the hull swings
    // onto that bearing at its class turn rate and shots actually leave the
    // barrel — the whole claim, measured in projectiles rather than intentions.
    const { shots, triggerTicks } = chaseFor(chase({ personality: 'rusty' }), 3);
    expect(triggerTicks).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
  });

  it('is still retreating while it does it — the flight is untouched', () => {
    const state = chase({ personality: 'rusty' });
    const ctx = decide(state);
    const stream = retreat(ctx, tail(ctx));

    // Home is the destination (`retreat`'s own rule: run into your own turrets),
    // and the way home is against `out`. The thrust must still carry the bot
    // that way — covering fire steers the gun, never the ship.
    const push = thrustOf(stream);
    expect(push).not.toBeNull();
    expect(dot(unit(push!), state.out)).toBeLessThan(0);

    // And the gun is pointed the OTHER way — over the shoulder, at the tail.
    // This is the pair the developer described, and the two are opposed, which
    // is exactly why a single "target" could never have expressed it.
    const aim = aimOf(stream);
    expect(dot(unit(aim!), state.out)).toBeGreaterThan(0);
  });

  it('lets every tier shoot back, and puts the ladder in how well', () => {
    // GDD §2.9 says difficulty is *visible competence*, never capability that
    // some tiers lack — and the developer met an Easy bot, so a Medium-and-up
    // gate would have shipped the same complaint back to them. Easy is made bad
    // at this by the aim-error model it is already bad at everything else with
    // (`aimJitter`, `aimLatency`, `reactionInterval`): measured over full
    // matches at 1.34 / 2.16 / 2.32 shots per chased-second
    // (`evidence/a0-81-fleeing-fire/audit.txt`).
    const tiers: readonly [PersonalityId, Difficulty][] = [
      ['rusty', Difficulty.Easy],
      ['foreman', Difficulty.Medium],
      ['warden', Difficulty.Hard],
    ];
    for (const [personality, difficulty] of tiers) {
      expect(PERSONALITIES[personality].difficulty).toBe(difficulty);
      const { shots } = chaseFor(chase({ personality }), 3);
      expect(shots, `${personality} (${difficulty}) shoots back`).toBeGreaterThan(0);
    }
  });

  it('never makes a teammate on its tail into covering fire', () => {
    // Allegiance is read, never re-implemented (GDD §2.9, p16-01): covering fire
    // asks `isTargetable`, the same `hostile` stamp every other behavior asks,
    // so an ally is not a target here for the same reason it is not one
    // anywhere. And FFA cannot prove it — teams-of-one makes every ship hostile
    // — so this case is staged with two slots sharing a side, which is the only
    // way the guarantee is tested at all.
    const state = chase({ personality: 'rusty', teammate: true });
    expect(state.me.team).toBe(state.chaser.team);
    const ctx = decide(state);
    const mate = ctx.view.ships.find((s) => s.id === 1);
    expect(mate?.hostile, 'slot 1 is an ALLY in this staging').toBe(false);

    const stream = retreat(ctx, tail(ctx));
    expect(aimOf(stream), 'no gun is brought to bear on a teammate').toBeNull();
    expect(triggerOf(stream)).toBe(false);
    expect(coveringFire(ctx, ctx.view.ships[0] ?? null).some((a) => a.type === 'aim')).toBe(false);
  });

  it('is still silent when there is nothing in range to shoot at', () => {
    // The half of "gunfire is the loudest tell" (GDD §2.2) that survives: a bot
    // retreating across empty space emits exactly the released trigger it always
    // did, and no aim action — so nothing about the quiet case moved, and a bot
    // out of contact still is not advertising itself.
    const state = chase({ personality: 'rusty' });
    state.chaser.alive = false;
    const ctx = decide(state);
    const stream = retreat(ctx, null);
    expect(aimOf(stream)).toBeNull();
    expect(triggerOf(stream)).toBe(false);
    expect(stream.some((a) => a.type === 'fire')).toBe(true);
  });

  it('covers a haul home the same way it covers a retreat', () => {
    // The developer's sentence names the *destination* ("just target his base"),
    // not the reason for it. A bot flying home with a full hold is in the same
    // position as one flying home wounded, so it gets the same gun. The old
    // argument for holding fire here — a hauler that shoots advertises a full
    // hold — is retired in `haulHome`'s own note: a ship already inside weapon
    // range has found you, so the silence bought nothing and cost the hold.
    const state = chase({ personality: 'foreman' });
    state.me.hull = state.me.maxHull; // not wounded: this is a haul, not a flight
    state.me.cargo = state.me.cargoCap;
    const ctx = decide(state);
    const stream = haulHome(ctx)!;
    expect(stream).not.toBeNull();
    expect(dot(unit(thrustOf(stream)!), state.out)).toBeLessThan(0);
    expect(aimOf(stream), 'the hauler has its gun on the hunter').not.toBeNull();
  });

  it('leaves roam and scavenge deliberately unarmed', () => {
    // The line the fix is drawn on, and it is a difficulty guarantee rather than
    // an oversight. `roam` and `scavenge` sit BELOW `potshot`/`attack` in all
    // three trees, so a bot only reaches them once its own tier declined the
    // fight — Easy's `potshot` demands `weights.triangle.attack >=
    // EASY_ATTACK_WEIGHT` before Rusty will shoot at something already in front
    // of it. Arming these would hand the Easy tree the seek-and-destroy branch
    // GDD §2.9 withholds from it ("attacks rarely"), which is a balance change
    // wearing a bug fix's clothes. The defect was a suppressed trigger, not a
    // missing appetite.
    const state = chase({ personality: 'rusty' });
    state.me.hull = state.me.maxHull;
    const ctx = decide(state);
    expect(aimOf(roam(ctx))).toBeNull();
    expect(triggerOf(roam(ctx))).toBe(false);

    // Scavenge only produces a stream when there is loot to fly at; when it does,
    // it is the same unarmed flight plan it always was.
    const loot = scavenge(ctx);
    if (loot !== null) {
      expect(aimOf(loot)).toBeNull();
      expect(triggerOf(loot)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// a0-105 — the retreat that never ended
// ---------------------------------------------------------------------------

/**
 * The developer, 2026-08-19, from a live match, with a screenshot of Rusty
 * parked at its own station at 20/70 hull:
 *
 * > *"I was able to make rusty just stay stuck there by putting myself in
 * > between the ore and his base. he just stayed in that same spot scared of me.
 * > ship lives are cheap. enemies should not fear death..."*
 *
 * The last sentence is the ruling, and it is already the design: respawn is free
 * (GDD §2.3, §2.7). The flee latch (`./commitment`, folded in `wantsRetreat`)
 * released on `recovered || escaped` and on nothing else — and **both of those
 * are conditions the opponent controls**. Park inside `RETREAT_CLEAR_RANGE` and
 * `escaped` can never read true; keep the pressure on a game with no hull repair
 * and `recovered` never can either. So the retreat had no end, and a player who
 * found that had found a way to switch an opponent off by standing still:
 * measured at 7200 held ticks out of 7200, at every tier, in
 * `evidence/a0-105-standoff/`.
 *
 * What is pinned below is the *end*, not the retreat — a wounded bot running for
 * cover is good play and stays exactly as it was:
 *
 *  1. the reported scenario terminates, inside a stated bound;
 *  2. every tier terminates, with the personality spread only in how long;
 *  3. a retreat that is *working* is left alone — which is what makes the turn
 *     readable from outside as the bot deciding rather than a timer firing;
 *  4. the turn ends when its subject does.
 */

/** The photograph's hull: Rusty at 20 of 70. Under its 0.65 nerve, nowhere near
 *  the 0.80 it would have to climb back to — and nothing in the game heals a
 *  hull, so that exit is shut for the whole match. */
const HULL_20_OF_70 = 20 / 70;

/** Wounded for the **whole cast**: under the 0.15 floor `retreatThreshold`
 *  clamps to, so Sable (0.18) is as afraid as Rusty (0.65) and one number stages
 *  every tier. */
const WOUNDED_ANY_TIER = 0.14;

/** Where the player parks: inside `RETREAT_CLEAR_RANGE` (676) so the retreat can
 *  never read *escaped*, and inside `GUARD_RADIUS * 2` of the station so this is
 *  a siege on the doorstep rather than a blockade of the road home — `./cornered`
 *  owns that other case, and it already terminates. */
const PARK = 200;

interface Standoff {
  world: World;
  bot: Bot;
  me: World['ships'][number];
  player: World['ships'][number];
  /** Unit vector from the station out toward the field. */
  out: Vec2;
}

/**
 * Stage the photograph: the bot is already home — it ran, it arrived, and it is
 * out of road — with a hostile parked between it and the ore.
 */
function standoff(opts: { personality: PersonalityId; hull: number; park?: number }): Standoff {
  const world = createWorld({
    seed: 20260819,
    players: [0, 1].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
  }

  const home = world.stations.find((s) => s.owner === 0)!;
  const me = world.ships[0]!;
  const player = world.ships[1]!;

  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const out: Vec2 = { x: dx / d, y: dy / d };

  me.pos = { x: home.pos.x, y: home.pos.y };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * opts.hull;
  const park = opts.park ?? PARK;
  player.pos = { x: home.pos.x + out.x * park, y: home.pos.y + out.y * park };
  player.vel = { x: 0, y: 0 };

  return { world, bot: createBot({ id: 0, personality: opts.personality }, { seed: 3 }), me, player, out };
}

/** What one staging did, tick by tick. */
interface Held {
  /** Ticks the `retreat` leaf won. */
  retreatTicks: number;
  /** Tick the `turn-and-fight` leaf first won, or -1 if it never did. */
  turnedAt: number;
  /** Every leaf that won a tick after the turn. */
  after: Set<string>;
}

/**
 * Hold the standoff for `seconds` and watch the bot's own account of what it was
 * doing (`Brain.lastBehavior`).
 *
 * The geometry is **pinned**: both hulls go back where they started before every
 * step and the bot's hull is held at its staged fraction, so the player never
 * falls off and the bot never heals its way out — which is the player standing
 * still, exactly what the report describes. `drift` opens the gap by that many
 * units per second instead, for the case where the running IS working.
 * Everything else is the real sim and the real tree.
 */
function hold(state: Standoff, seconds: number, drift = 0): Held {
  const { world, bot, me, player } = state;
  const mePos = { ...me.pos };
  const playerPos = { ...player.pos };
  const hull = me.hull;
  const held: Held = { retreatTicks: 0, turnedAt: -1, after: new Set() };
  for (let tick = 0; tick < Math.round(seconds / TICK_DT); tick++) {
    const opened = drift * tick * TICK_DT;
    me.pos = { ...mePos };
    me.vel = { x: 0, y: 0 };
    me.hull = hull;
    player.pos = {
      x: playerPos.x + state.out.x * opened,
      y: playerPos.y + state.out.y * opened,
    };
    player.vel = { x: 0, y: 0 };
    player.hull = player.maxHull;
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);
    const leaf = bot.brain.lastBehavior;
    if (leaf === 'retreat') held.retreatTicks++;
    if (held.turnedAt < 0 && leaf === 'turn-and-fight') held.turnedAt = tick;
    else if (held.turnedAt >= 0) held.after.add(leaf);
  }
  return held;
}

/** The bound this file holds every tier to: eight seconds of a retreat that is
 *  going nowhere is already far longer than a player will watch, and it is more
 *  than twice the most patient character's own patience. */
const BOUND_S = 8;

describe('a retreat is a manoeuvre, not a state of mind (a0-105)', () => {
  it('a retreat that cannot recover and cannot escape ends in a fight', () => {
    // The photograph: Rusty, at its own station, at 20/70, with the developer
    // parked between it and the ore. Neither exit the flee latch had can ever
    // fire here — which is the whole defect.
    const state = standoff({ personality: 'rusty', hull: HULL_20_OF_70 });
    const ctx = decide(state);
    expect(ctx.self.hullFraction).toBeCloseTo(HULL_20_OF_70, 5);
    const seen = ctx.view.ships.find((s) => s.id === 1);
    expect(seen, 'the player is inside the bot\'s own fog').toBeTruthy();
    expect(seen!.distance).toBeLessThan(RETREAT_CLEAR_RANGE); // never *escaped*
    expect(seen!.distance).toBeLessThan(GUARD_RADIUS * 2); // a siege, not a blockade
    // Nothing in the game heals a hull, so *recovered* is shut for the match.
    expect(ctx.self.hullFraction).toBeLessThan(0.8);

    const held = hold(standoff({ personality: 'rusty', hull: HULL_20_OF_70 }), BOUND_S);

    // It ran first — the retreat itself is good play and is not deleted.
    expect(held.retreatTicks).toBeGreaterThan(0);
    // And then it stopped running and came at the thing that would not let go.
    // On today's code this is -1 for as long as anyone cares to run it.
    expect(held.turnedAt, 'the bot turns and fights inside the bound').toBeGreaterThan(0);
    expect(held.turnedAt).toBeLessThan(Math.round(BOUND_S / TICK_DT));
    // And it stays turned: a committed window, not a one-decision twitch.
    expect(held.after.has('retreat'), 'the turn is not a flap back into fleeing').toBe(false);
  });

  it('turns at every tier, and puts the personality spread in how long', () => {
    // "Keep the personality spread intact … but every tier turns." Timid Rusty
    // takes the longest, reckless Bolt the shortest, and the Hard seats — who
    // price their own hull the way the design does — barely hesitate. Nobody
    // gets a different rule, only a different amount of patience, and the clamp
    // in `standoffPatience` is what makes "every tier turns" structural.
    const ticks = new Map<PersonalityId, number>();
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      const held = hold(standoff({ personality: id, hull: WOUNDED_ANY_TIER }), BOUND_S);
      expect(held.retreatTicks, `${id} still retreats first`).toBeGreaterThan(0);
      expect(held.turnedAt, `${id} (${PERSONALITIES[id].difficulty}) turns`).toBeGreaterThan(0);
      ticks.set(id, held.turnedAt);
    }
    // The ladder the cast is built on, read straight off the measurement.
    expect(ticks.get('rusty')!).toBeGreaterThan(ticks.get('bolt')!);
    expect(ticks.get('bolt')!).toBeGreaterThan(ticks.get('sable')!);
    expect(ticks.get('patch')!).toBeGreaterThan(ticks.get('warden')!);

    // …and no character's patience can be tuned into a bot that never turns.
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      const ctx = {
        tuning: tuningFor(id),
        weights: PERSONALITIES[id].weights,
      } as unknown as BotCtx;
      expect(standoffPatience(ctx)).toBeLessThanOrEqual(5);
      expect(standoffPatience(ctx)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('leaves a retreat that is actually working alone', () => {
    // The half that makes this readable from outside rather than as a timer: the
    // clock runs on *failing to open ground*, not on the calendar. A player who
    // is being out-flown — here, losing 30 units a second, well inside the
    // sensor picture and never past the clear range — watches the same wounded
    // bot keep running for as long as they care to chase it.
    const held = hold(standoff({ personality: 'rusty', hull: HULL_20_OF_70 }), BOUND_S, 30);
    expect(held.turnedAt, 'a retreat that is gaining ground is not interrupted').toBe(-1);
    expect(held.retreatTicks).toBeGreaterThan(0);
  });

  it('gives the tick back when the thing it turned on breaks contact', () => {
    // The turn ends when its subject does. A committed window is not a grudge:
    // once the chaser is past the clear range there is nothing to fight, so the
    // commitment is dropped rather than swung at empty space.
    const state = standoff({ personality: 'sable', hull: WOUNDED_ANY_TIER });
    hold(state, 3);
    expect(state.bot.brain.lastBehavior).toBe('turn-and-fight');
    expect(state.bot.brain.standoff.until).toBeGreaterThan(0);

    state.player.pos = {
      x: state.player.pos.x + state.out.x * RETREAT_CLEAR_RANGE * 2,
      y: state.player.pos.y + state.out.y * RETREAT_CLEAR_RANGE * 2,
    };
    for (let tick = 0; tick < Math.round(1 / TICK_DT); tick++) {
      state.me.hull = state.me.maxHull * WOUNDED_ANY_TIER;
      step(state.world, botInputs(state.world, [state.bot], TICK_DT), TICK_DT);
    }
    expect(state.bot.brain.lastBehavior).not.toBe('turn-and-fight');
    expect(state.bot.brain.standoff.until, 'the commitment went with its subject').toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// a0-107 — the dead band, and the road (QA defect a0-106-01)
// ---------------------------------------------------------------------------

/**
 * Where the second player parks to reproduce a0-106's finding: **580 units**,
 * inside `RETREAT_CLEAR_RANGE` (676) so the flee latch can still never read
 * *escaped*, and outside the old `THREAT_RANGE` (416) gate so a0-105's fold was
 * never evaluated at all. The 260-unit annulus between those two ranges is the
 * dead band, and this is the cheapest opponent there is: parked, silent, and at
 * one fixed distance.
 */
const PARK_DEAD_BAND = 580;

/** Where a chased bot starts, far enough out that the road home is many seconds
 *  of flying — the case a0-105 protected with a positional gate. */
const RUN_HOME_FAR = 1600;

/** The range the chaser holds behind the bot: inside the clear range, so the
 *  retreat can never read *escaped* however far it flies. */
const CHASE_HOLD = 300;

/** What one flight home did. */
interface Flight {
  /** Tick `turn-and-fight` first won, or -1. */
  turnedAt: number;
  /** Distance from the bot to its own station on that tick. */
  turnedAtRange: number;
  /** The closest the bot ever got to its own station. */
  closest: number;
}

/**
 * Let the bot **fly**, with something exactly as fast holding station behind it.
 *
 * The `hold` staging above pins the bot's position, which is the right way to
 * ask "does a retreat that has arrived ever end?" and the wrong way to ask "is a
 * retreat that is still going ever interrupted?" — a pinned bot is not going
 * anywhere by construction. So this one moves nothing but the chaser: it is
 * placed each tick on the line from home through the bot, `CHASE_HOLD` units
 * out, which is a pursuer the bot can never shake and never out-run. Everything
 * the bot does is its own tree, its own thrusters and its own fog.
 */
function flyHome(personality: PersonalityId, seconds: number): Flight {
  const state = standoff({ personality, hull: WOUNDED_ANY_TIER });
  const { world, bot, me, player, out } = state;
  const home = world.stations.find((s) => s.owner === 0)!;
  me.pos = { x: home.pos.x + out.x * RUN_HOME_FAR, y: home.pos.y + out.y * RUN_HOME_FAR };
  me.vel = { x: 0, y: 0 };

  const flight: Flight = { turnedAt: -1, turnedAtRange: -1, closest: Infinity };
  for (let tick = 0; tick < Math.round(seconds / TICK_DT); tick++) {
    const dx = me.pos.x - home.pos.x;
    const dy = me.pos.y - home.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    player.pos = { x: me.pos.x + (dx / d) * CHASE_HOLD, y: me.pos.y + (dy / d) * CHASE_HOLD };
    player.vel = { x: 0, y: 0 };
    player.hull = player.maxHull;
    me.hull = me.maxHull * WOUNDED_ANY_TIER;
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);
    flight.closest = Math.min(flight.closest, Math.hypot(me.pos.x - home.pos.x, me.pos.y - home.pos.y));
    if (flight.turnedAt < 0 && bot.brain.lastBehavior === 'turn-and-fight') {
      flight.turnedAt = tick;
      flight.turnedAtRange = Math.hypot(me.pos.x - home.pos.x, me.pos.y - home.pos.y);
    }
  }
  return flight;
}

/** One dead-band staging: what the bot did, and the separation it actually
 *  held at — which is not the park distance, because the bot settles about 80
 *  units the far side of its own station while it holds there. QA's `park@580`
 *  cell reads ~660 for exactly the same reason, and the separation is the number
 *  the ranges are about. */
interface Band {
  held: Held;
  separation: number;
}

/**
 * Stage the dead band the way a player reaches it: **close first, then back off
 * into the annulus.**
 *
 * A bot cannot be held in a retreat it never started, and the flee latch only
 * *enters* on a threat inside `THREAT_RANGE` — so a hostile that begins at 580
 * is not the reproduction, it is a bot with nothing to run from. The
 * reproduction is a hostile that closes, wounds the bot into its retreat, and
 * then withdraws to a range where a0-105's fold could not be evaluated and the
 * flee latch's own `escaped` still cannot fire. That is what QA's `park@580`
 * cell reaches by drift and what this reaches deliberately.
 */
function deadBand(personality: PersonalityId, park: number, seconds: number): Band {
  const state = standoff({ personality, hull: WOUNDED_ANY_TIER });
  const home = state.world.stations.find((st) => st.owner === 0)!;
  // In contact: the flee latch commits, which is the retreat this is about.
  hold(state, 1);
  expect(committed(state.bot.brain.fleeing), `${personality} is fleeing at ${PARK}`).toBe(true);
  // …and now it backs off into the band and stands there.
  state.player.pos = { x: home.pos.x + state.out.x * park, y: home.pos.y + state.out.y * park };
  const held = hold(state, seconds);
  return {
    held,
    separation: Math.hypot(state.player.pos.x - state.me.pos.x, state.player.pos.y - state.me.pos.y),
  };
}

describe('an exit an opponent alone can satisfy is not an exit (a0-107)', () => {
  it('a hostile parked at 580 — the dead band — no longer holds a wounded bot', () => {
    // QA's `park@580`: the cheapest opponent there is, and the reproduction the
    // brief names. It is too far for a0-105's `THREAT_RANGE` fold to be
    // evaluated and too near for the flee latch to read *escaped*, so before
    // this branch the patience clock never started and the hold tracked whatever
    // ceiling you gave it — 17 860 ticks of 18 000 at 300 s
    // (`tests/reports/a0-107-dead-band.md`). Every character in the cast, so
    // this cannot pass by a tier falling out sideways into another branch.
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      const band = deadBand(id, PARK_DEAD_BAND, BOUND_S);
      // The staging is the defect's own geometry or it proves nothing: too far
      // for the old gate, too near for `escaped`.
      expect(band.separation, `${id} separation`).toBeGreaterThan(THREAT_RANGE);
      expect(band.separation, `${id} separation`).toBeLessThan(RETREAT_CLEAR_RANGE);
      expect(band.held.turnedAt, `${id} (${PERSONALITIES[id].difficulty}) turns in the dead band`)
        .toBeGreaterThan(0);
      expect(band.held.turnedAt).toBeLessThan(Math.round(BOUND_S / TICK_DT));
    }
  });

  it('the band it holds for is the flee latch\'s own — there is no annulus left', () => {
    // The structural half, and the reason widening a range would not have done:
    // the standoff now measures against the same read the flee latch's `escaped`
    // exit uses, so "still fleeing this" and "measuring this" are the same
    // predicate and no gap can open between them. Every separation inside the
    // clear range ends in the turn — swept across the old gate at 416, which is
    // where a0-105's band began.
    const swept: number[] = [];
    for (const park of [PARK, 300, 396, 480, PARK_DEAD_BAND]) {
      const band = deadBand('rusty', park, BOUND_S);
      swept.push(band.separation);
      expect(band.separation).toBeLessThan(RETREAT_CLEAR_RANGE); // never *escaped*
      expect(band.held.turnedAt, `separation ${band.separation.toFixed(0)}`).toBeGreaterThan(0);
    }
    // The sweep has to have crossed the old gate, or it is a sweep of one side.
    expect(Math.min(...swept)).toBeLessThan(THREAT_RANGE);
    expect(Math.max(...swept)).toBeGreaterThan(THREAT_RANGE);
    // Past the clear range there is nothing to measure: the retreat *succeeded*.
    const outside = deadBand('rusty', RETREAT_CLEAR_RANGE + 200, BOUND_S);
    expect(outside.separation).toBeGreaterThan(RETREAT_CLEAR_RANGE);
    expect(outside.held.turnedAt, 'an opponent past the clear range is escaped, not fought').toBe(-1);
  });

  it('never interrupts a bot that is still eating the road home', () => {
    // The a0-105 scope, kept — and kept as a measurement rather than as a gate
    // an opponent can flap. The chaser holds 300 units off the bot's tail for
    // the whole flight, so the gap NEVER opens and `escaped` can never fire; the
    // only reason this bot is not turning is that it is getting somewhere.
    const flight = flyHome('rusty', 20);
    expect(flight.closest, 'it flew home').toBeLessThan(ARRIVE_RADIUS);
    expect(flight.turnedAt, 'and it did not turn on the way').toBeGreaterThan(0);
    expect(
      flight.turnedAtRange,
      'the turn happens at its own doorstep, not out on the road',
    ).toBeLessThan(ARRIVE_RADIUS * 2);
  });

  it('and still ends the moment the road runs out, at every tier', () => {
    // The other half of the same flight: arriving is not an exemption. Every
    // character flies home, and every character turns once there is no more road
    // to eat and the thing is still on its tail.
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      const flight = flyHome(id, 16);
      expect(flight.turnedAt, `${id} (${PERSONALITIES[id].difficulty}) turns`).toBeGreaterThan(0);
    }
  });
});
