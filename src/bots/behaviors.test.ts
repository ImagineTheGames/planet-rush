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
  ownHomeThreatened,
  retreat,
  roam,
  scavenge,
  standoffPatience,
  wantsRetreat,
} from './behaviors';
import { createBot, type Bot } from './bot';
import { committed } from './commitment';
import { ARRIVE_RADIUS } from './steering';
import { HOME_ALARM_RANGE } from './targeting';
import { standoffCommitted } from './standoff';
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

/** Core fraction a besieged station is held at: comfortably above
 *  `CORE_FINAL_ASSAULT` (0.3), so `last-stand` — which has outranked the retreat
 *  since v0.2.2 — cannot fire and take the credit for a0-135's ruling. The whole
 *  span above that line is the gap this brief is about. */
const HEALTHY_CORE = 0.8;

/** Where the player parks, measured **from the bot** along the outward lane:
 *  inside `RETREAT_CLEAR_RANGE` (676) so the retreat can never read *escaped*,
 *  and inside `GUARD_RADIUS * 2` so this is a siege at knife range rather than a
 *  blockade of the road home — `./cornered` owns that other case, and it already
 *  terminates. */
const PARK = 200;

/**
 * **How far out in the field these cells stage the bot, and why they had to move
 * there** (a0-135).
 *
 * Until a0-135 every cell below staged the bot *at its own station*, because the
 * a0-105 photograph was a bot camped on its own doorstep. That board is no longer
 * a retreat board at all, and the arithmetic says so without needing a run:
 * `HOME_ALARM_RANGE` (520) is wider than `THREAT_RANGE` (416), so **anything near
 * enough to make a bot standing at its own station want to run is inside that
 * station's alarm ring by construction**. `ownHomeThreatened` reads true, and
 * a0-135's ruling — a threatened home outranks self-preservation, at any hull —
 * takes the tick for `defend` before the flee latch is ever consulted.
 *
 * That is the ruling working, not a regression, and the cell that pins it is in
 * the a0-135 block below: on the old `PARK` board every character now goes
 * straight to `defend` and never retreats at all.
 *
 * But it would leave the a0-105 and a0-107 properties — *a retreat ends*, and
 * *no annulus an opponent can hold the patience clock at zero from* — measured
 * nowhere. Those properties are about a retreat, so they need a board with a
 * retreat on it: the bot **out in the field**, far enough that its own home is
 * quiet, with the same hostile at the same separations. Far enough means the
 * hostile's distance from the station clears the alarm ring even at the widest
 * separation these cells sweep, and this clears it by better than 2×.
 *
 * Nothing else about these cells moved: the same hulls, the same separations,
 * the same pins, the same assertions.
 */
const OUT_OF_RING = 900;

interface Standoff {
  world: World;
  bot: Bot;
  me: World['ships'][number];
  player: World['ships'][number];
  /** Unit vector from the station out toward the field. */
  out: Vec2;
  /** The bot's own station. */
  home: World['stations'][number];
  /** Hold that station under attack for every tick of the run. */
  siege: boolean;
}

/**
 * Stage the photograph: the bot is already home — it ran, it arrived, and it is
 * out of road — with a hostile parked between it and the ore.
 */
function standoff(opts: {
  personality: PersonalityId;
  hull: number;
  park?: number;
  /** How far out from its own station the bot sits. `0` is the a0-105
   *  photograph — on its own doorstep — and is what the a0-135 cells use; the
   *  a0-105 and a0-107 cells pass {@link OUT_OF_RING} (see its note). */
  from?: number;
  /** Hold the bot's own station under attack, the developer's red ring. */
  siege?: boolean;
}): Standoff {
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

  const from = opts.from ?? 0;
  me.pos = { x: home.pos.x + out.x * from, y: home.pos.y + out.y * from };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * opts.hull;
  // The park is measured from the BOT, so moving the staging out into the field
  // moves the whole picture and leaves every separation these cells sweep exactly
  // where it was. At `from: 0` this is the a0-105 photograph verbatim.
  const park = opts.park ?? PARK;
  player.pos = { x: me.pos.x + out.x * park, y: me.pos.y + out.y * park };
  player.vel = { x: 0, y: 0 };

  return {
    world,
    bot: createBot({ id: 0, personality: opts.personality }, { seed: 3 }),
    me,
    player,
    out,
    home,
    siege: opts.siege === true,
  };
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
    // The red ring, held: `underAttack` is `sinceDamage < alarmWindow`
    // (`./perception`), so pinning it at zero is an attacker who never lets up —
    // and the core is held healthy, well above `CORE_FINAL_ASSAULT` (0.3), so
    // `last-stand` stays switched off and the only branch that can bring this bot
    // home is the a0-135 ruling itself.
    if (state.siege && state.home.alive) {
      state.home.sinceDamage = 0;
      state.home.coreHp = state.home.maxCoreHp * HEALTHY_CORE;
    }
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
    // The photograph: Rusty at 20/70 with the developer parked between it and the
    // ore, staged {@link OUT_OF_RING} out in the field rather than on the
    // doorstep it was originally staged on (a0-135 took the doorstep; see that
    // constant's note). Neither exit the flee latch had can ever fire here —
    // which is the whole defect.
    const state = standoff({ personality: 'rusty', hull: HULL_20_OF_70, from: OUT_OF_RING });
    const ctx = decide(state);
    expect(ctx.self.hullFraction).toBeCloseTo(HULL_20_OF_70, 5);
    const seen = ctx.view.ships.find((s) => s.id === 1);
    expect(seen, 'the player is inside the bot\'s own fog').toBeTruthy();
    expect(seen!.distance).toBeLessThan(RETREAT_CLEAR_RANGE); // never *escaped*
    expect(seen!.distance).toBeLessThan(GUARD_RADIUS * 2); // a siege, not a blockade
    // …and this bot's own home is quiet, or a0-135's ruling would take the tick
    // before the flee latch was ever consulted and this cell would be measuring
    // that instead.
    expect(ownHomeThreatened(ctx), 'the a0-105 property needs a retreat to measure').toBe(false);
    // Nothing in the game heals a hull, so *recovered* is shut for the match.
    expect(ctx.self.hullFraction).toBeLessThan(0.8);

    const held = hold(standoff({ personality: 'rusty', hull: HULL_20_OF_70, from: OUT_OF_RING }), BOUND_S);

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
      const held = hold(standoff({ personality: id, hull: WOUNDED_ANY_TIER, from: OUT_OF_RING }), BOUND_S);
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
    const held = hold(standoff({ personality: 'rusty', hull: HULL_20_OF_70, from: OUT_OF_RING }), BOUND_S, 30);
    expect(held.turnedAt, 'a retreat that is gaining ground is not interrupted').toBe(-1);
    expect(held.retreatTicks).toBeGreaterThan(0);
  });

  it('gives the tick back when the thing it turned on breaks contact', () => {
    // The turn ends when its subject does. A committed window is not a grudge:
    // once the chaser is past the clear range there is nothing to fight, so the
    // commitment is dropped rather than swung at empty space.
    const state = standoff({ personality: 'sable', hull: WOUNDED_ANY_TIER, from: OUT_OF_RING });
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

/**
 * The leaves that mean **the bot stopped running and did something about it**.
 *
 * a0-107's claim is about the *end of a retreat*, not about which branch serves
 * it: the road anchor must not interrupt a retreat that is still getting
 * somewhere, and the retreat must end once the road runs out. Which fighting
 * leaf takes that tick is a question of tree order, and a0-135 changed the
 * answer at the doorstep — a chaser that follows a bot home is inside
 * `HOME_ALARM_RANGE` by the time the bot arrives, so `defend` outranks the turn
 * and takes it. Measured on this branch: every character still flies the whole
 * road (closest 201-211u, inside `ARRIVE_RADIUS`), still shows nothing but
 * `retreat` out on the road past 440u, and still stops at t≈620 at 207-216u from
 * its own station. Same flight, same ending, different leaf — so this set is
 * what the cells below read, and the a0-105 block above still pins the turn
 * itself by name on the board where it is the branch that answers.
 */
const STOPPED_RUNNING = new Set(['turn-and-fight', 'defend', 'cornered-fight', 'last-stand']);

/** What one flight home did. */
interface Flight {
  /** Tick a leaf in {@link STOPPED_RUNNING} first won, or -1. */
  turnedAt: number;
  /** Distance from the bot to its own station on that tick. */
  turnedAtRange: number;
  /** Which leaf it was. */
  turnedTo: string;
  /** The closest the bot ever got to its own station. */
  closest: number;
  /** Every leaf that won a tick while the bot was still **inbound** and more
   *  than `ARRIVE_RADIUS * 2` from home — the half of the claim that says a
   *  working retreat is not interrupted. Inbound is load-bearing: an arrived bot
   *  fighting at its doorstep drifts back past that range routinely, and counting
   *  those ticks would make this read "interrupted" for a flight that was over. */
  onRoad: Set<string>;
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

  const flight: Flight = {
    turnedAt: -1,
    turnedAtRange: -1,
    turnedTo: '—',
    closest: Infinity,
    onRoad: new Set(),
  };
  for (let tick = 0; tick < Math.round(seconds / TICK_DT); tick++) {
    const dx = me.pos.x - home.pos.x;
    const dy = me.pos.y - home.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    player.pos = { x: me.pos.x + (dx / d) * CHASE_HOLD, y: me.pos.y + (dy / d) * CHASE_HOLD };
    player.vel = { x: 0, y: 0 };
    player.hull = player.maxHull;
    me.hull = me.maxHull * WOUNDED_ANY_TIER;
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);
    const range = Math.hypot(me.pos.x - home.pos.x, me.pos.y - home.pos.y);
    const inbound = flight.closest > ARRIVE_RADIUS;
    flight.closest = Math.min(flight.closest, range);
    if (inbound && range > ARRIVE_RADIUS * 2) flight.onRoad.add(bot.brain.lastBehavior);
    if (flight.turnedAt < 0 && STOPPED_RUNNING.has(bot.brain.lastBehavior)) {
      flight.turnedAt = tick;
      flight.turnedAtRange = range;
      flight.turnedTo = bot.brain.lastBehavior;
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
  const state = standoff({ personality, hull: WOUNDED_ANY_TIER, from: OUT_OF_RING });
  // In contact: the flee latch commits, which is the retreat this is about.
  hold(state, 1);
  expect(committed(state.bot.brain.fleeing), `${personality} is fleeing at ${PARK}`).toBe(true);
  // …and now it backs off into the band and stands there. Measured from the bot,
  // which is pinned by `hold`, so the separation IS the park distance.
  state.player.pos = { x: state.me.pos.x + state.out.x * park, y: state.me.pos.y + state.out.y * park };
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
    expect(flight.turnedAt, 'and it stopped running once it got there').toBeGreaterThan(0);
    expect(
      flight.turnedAtRange,
      'the turn happens at its own doorstep, not out on the road',
    ).toBeLessThan(ARRIVE_RADIUS * 2);
    // The direct statement of the same thing, and the one an opponent cannot
    // argue with: out on the road this bot did exactly one thing, and that thing
    // was run. No fighting leaf ever interrupted the flight itself.
    expect([...flight.onRoad], 'nothing but the retreat, all the way home').toEqual(['retreat']);
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

// ---------------------------------------------------------------------------
// a0-135 — a wounded bot that would not come and defend its own home
// ---------------------------------------------------------------------------

/**
 * The developer, 2026-08-22, from a live match, with a screenshot of Rusty at
 * **25/70** hull and its own station ringed red:
 *
 * > *"as I was attacking rusty base he was scared to come engage like he was low
 * > on health, but ships are cheap you get a free one, they shouldn't fear death
 * > just cause they are low on health... protection of their base is essential
 * > to the game a player would defend at all costs"*
 *
 * **The ruling: a threatened home outranks self-preservation, at any hull
 * fraction.** It is a0-105's "a respawn is free" (GDD §2.3, §2.7) applied to the
 * one situation where retreating is not merely passive but actively losing the
 * match.
 *
 * ── What was wrong, and it was one missing call ────────────────────────────
 *
 * `wantsRetreat` consulted `collapsed`, the cornered commitment, the standoff,
 * the tier's nerve and `incomingThreat` — and **never asked whether this bot's
 * own home was under attack**. `ownHomeThreatened` already existed and was
 * already read on both ally-defence paths, so a bot would abandon a retreat to
 * answer a *teammate's* alarm and not its own. The `defend` leaf that should have
 * taken the tick sits BELOW `retreat` in all three trees, so the flee latch won.
 *
 * The before-picture, measured over the whole cast at five hull fractions
 * (`evidence/a0-135-home-defence/`): the table is **byte-identical with the
 * siege on and the siege off**, because nothing in the retreat read the home at
 * all. Rusty at 25/70 spent 310 of 720 ticks on the `retreat` leaf and averaged
 * 431 units from the station it was supposed to be holding.
 *
 * ── Why this survived a0-106's adversarial sweep ───────────────────────────
 *
 * That sweep's `siege-home` antagonist pins the subject's core at 0.2, below
 * `CORE_FINAL_ASSAULT` (0.3), which switches on `last-stand` — a branch that has
 * outranked the retreat since v0.2.2 and answers the whole board. Nothing in the
 * suite staged a home under attack with a **healthy** core, and the entire span
 * above 0.3 was the gap. So every cell below pins the core at
 * {@link HEALTHY_CORE}, and `last-stand` is switched off throughout.
 *
 * What is pinned:
 *
 *  1. the ruling itself, at the developer's own hull and at every tier's;
 *  2. **no hull-fraction exception** — the whole cast, swept down to 5/70;
 *  3. an in-flight retreat is *released*, not shadowed, and the standoff with it;
 *  4. the nerve is re-read from scratch when the siege lifts;
 *  5. the ruling is the *home* reading and not the geometry — lift the siege at
 *    the same range and the same bot runs;
 *  6. the doorstep board a0-105 was staged on now answers through `defend`.
 */
describe('a bot never retreats while its own home is under attack (a0-135)', () => {
  /** The photograph's hull: Rusty at 25 of 70, which is under its 0.65 nerve. */
  const HULL_25_OF_70 = 25 / 70;

  /** The board: the bot on its own doorstep at `hull`, a hostile standing on the
   *  station at knife range, the station's alarm held on and its core healthy. */
  const besieged = (personality: PersonalityId, hull: number) =>
    standoff({ personality, hull, park: PARK, siege: true });

  it('a bot never retreats while its own home is under attack', () => {
    // The developer's frame, decision-level and one tick deep, so the claim is
    // about the *test* rather than about how a run happened to go.
    const state = besieged('rusty', HULL_25_OF_70);
    state.home.sinceDamage = 0;
    state.home.coreHp = state.home.maxCoreHp * HEALTHY_CORE;
    const ctx = decide(state);

    // The staging is the defect's own, or it proves nothing. Wounded below
    // Rusty's own nerve...
    expect(ctx.self.hullFraction).toBeCloseTo(HULL_25_OF_70, 5);
    expect(ctx.self.hullFraction).toBeLessThan(ctx.tuning.retreatHullFraction);
    // ...with something engageable inside the break-off band, so the flee
    // latch's enter condition is genuinely live...
    const seen = ctx.view.ships.find((s) => s.id === 1);
    expect(seen, 'the hostile is inside the bot\'s own fog').toBeTruthy();
    expect(seen!.distance).toBeLessThan(THREAT_RANGE);
    // ...its own home reading true...
    expect(ownHomeThreatened(ctx), 'the alarm is ringing').toBe(true);
    // ...and its core nowhere near the last stand, which would otherwise be the
    // branch answering this and would make the cell prove nothing about a0-135.
    expect(ctx.self.station!.coreHp).toBeGreaterThan(ctx.self.station!.maxCoreHp * 0.3);

    // **The ruling.** On the code this brief replaces, this reads `true`.
    expect(wantsRetreat(ctx), 'a threatened home outranks self-preservation').toBe(false);
  });

  it('makes no hull-fraction exception — not at 25/70, not at 5/70', () => {
    // "No hull-fraction exception. Not at 25/70, not at 5/70. That is the ruling
    // and it is the whole point of it." Every character, every fraction, down to
    // a hull that is one good burst from gone.
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      for (const hull of [HULL_25_OF_70, 0.5, 0.35, 0.2, 5 / 70]) {
        const ctx = decide(besieged(id, hull));
        expect(ownHomeThreatened(ctx), `${id} @${hull.toFixed(3)}`).toBe(true);
        expect(
          wantsRetreat(ctx),
          `${id} (${PERSONALITIES[id].difficulty}) at hull ${hull.toFixed(3)}`,
        ).toBe(false);
      }
    }
  });

  it('releases a retreat already in flight, rather than shadowing it', () => {
    // The shape the brief asks for, and the shape `corneredCommitted` already
    // uses: the latch is *dropped*, so when the siege lifts the bot re-reads its
    // nerve from scratch instead of silently resuming the run it abandoned.
    // Stage the commitment out in the field first, where the home is quiet.
    const state = standoff({ personality: 'rusty', hull: WOUNDED_ANY_TIER, from: OUT_OF_RING });
    hold(state, 1);
    expect(committed(state.bot.brain.fleeing), 'it is running').toBe(true);

    // Now its home comes under attack. Nothing else about the board changes.
    state.home.sinceDamage = 0;
    state.home.coreHp = state.home.maxCoreHp * HEALTHY_CORE;
    const ctx = decide(state);
    expect(wantsRetreat(ctx)).toBe(false);
    expect(committed(state.bot.brain.fleeing), 'the flee latch is released, not ignored').toBe(false);
    // And the standoff with it — leaving that committed would hand the tick to
    // `turn-and-fight`, which outranks `defend` in all three trees, and the bot
    // would fight whoever chased it instead of the ship on its core.
    expect(standoffCommitted(state.bot.brain.standoff, state.world.time)).toBe(false);
  });

  it('re-reads the nerve from scratch once the siege lifts', () => {
    // The other half of *released rather than shadowed*: this is a suppression
    // with an end, not a mode the bot gets stuck in. Same board, same hull, same
    // hostile — only the alarm goes quiet.
    const state = standoff({ personality: 'rusty', hull: WOUNDED_ANY_TIER, from: OUT_OF_RING });
    state.home.sinceDamage = 0;
    state.home.coreHp = state.home.maxCoreHp * HEALTHY_CORE;
    expect(wantsRetreat(decide(state))).toBe(false);

    state.home.sinceDamage = 999;
    const ctx = decide(state);
    expect(ownHomeThreatened(ctx), 'the alarm has stopped').toBe(false);
    expect(wantsRetreat(ctx), 'and the nerve is back to being the nerve').toBe(true);
  });

  it('is the home reading and not the geometry — the control', () => {
    // The cell that says this is a0-135's ruling rather than a range being
    // widened somewhere. Two boards identical in every particular except the
    // distance from the bot's own station, at the same hull, with the same
    // hostile at the same separation and no alarm on either.
    const near = decide(standoff({ personality: 'rusty', hull: WOUNDED_ANY_TIER, from: 0 }));
    const far = decide(standoff({ personality: 'rusty', hull: WOUNDED_ANY_TIER, from: OUT_OF_RING }));

    // Same separation, so the flee latch sees the same threat on both.
    const gap = (ctx: BotCtx) => ctx.view.ships.find((s) => s.id === 1)!.distance;
    expect(gap(near)).toBeCloseTo(gap(far), 3);
    expect(gap(near)).toBeLessThan(THREAT_RANGE);

    // What differs is one reading, and it differs because `HOME_ALARM_RANGE`
    // (520) is wider than `THREAT_RANGE` (416): anything near enough to frighten
    // a bot standing at its own station is inside that station's alarm ring by
    // construction, so a bot on its own doorstep can no longer be frightened off
    // it — ever, at any hull. Out in the field, nothing changed.
    expect(HOME_ALARM_RANGE).toBeGreaterThan(THREAT_RANGE);
    expect(ownHomeThreatened(near)).toBe(true);
    expect(ownHomeThreatened(far)).toBe(false);
    expect(wantsRetreat(near), 'on its own doorstep it stands').toBe(false);
    expect(wantsRetreat(far), 'out in the field it still runs').toBe(true);
  });

  it('answers the a0-105 doorstep board through defend, at every tier', () => {
    // a0-105's own staging — the bot at its own station with the developer parked
    // 200 units off — is a *home-threatened* board under this ruling, and it now
    // resolves one branch higher up the tree. The a0-105 property is not weakened
    // by that, it is reached sooner: the bot never runs at all, and it fights.
    // (The standoff that a0-105 built is still pinned by name, on the field board
    // that block is now staged on.)
    for (const id of Object.keys(PERSONALITIES) as PersonalityId[]) {
      const held = hold(standoff({ personality: id, hull: HULL_25_OF_70, siege: true }), BOUND_S);
      expect(held.retreatTicks, `${id} (${PERSONALITIES[id].difficulty}) never runs`).toBe(0);
      expect(held.turnedAt, `${id} never needs the standoff`).toBe(-1);
    }
  });
});
