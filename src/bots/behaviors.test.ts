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
import { coveringFire, haulHome, retreat, roam, scavenge } from './behaviors';
import { createBot, type Bot } from './bot';
import { botInputs } from './harness';
import { perceive } from './perception';
import { Difficulty, PERSONALITIES, type PersonalityId } from './personalities';
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

/** One decision's context, perceived through the bot's own fog. */
function decide(chaseState: Chase): BotCtx {
  return context(perceive(chaseState.world, 0), chaseState.bot.brain);
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
