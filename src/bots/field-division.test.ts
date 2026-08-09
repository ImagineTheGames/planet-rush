/**
 * src/bots/field-division.test.ts — **allies stop racing each other to the same
 * rock.** OWNER: Bot Engineer (`docs/team-bots-plan.md` Stage 3; b3-01).
 *
 * The plan's §1.6 is the case, and it is a measurement:
 *
 * > two teammates spend 79% of the match inside one visual range of each other,
 * > at a mean separation of 434 units against the enemies' 1042. They are not
 * > covering a board; they are flying formation by accident.
 *
 * **That figure no longer reproduces, and the re-measurement is in the PR rather
 * than hidden here** — the same spike (`spikes/team-bots/measure-team-gaps.ts`),
 * same seeds, at today's `origin/main` reads **692**, not 434, because p16-01 and
 * Stages 1–2 stopped bots chasing, fleeing and besieging their own teammates.
 * What survives is the half this stage is actually about: **allied pairs commit
 * to the *same rock* about twice as often as enemy pairs do**, which is two
 * economies doing one economy's work. The last case in this file is the
 * end-to-end guard on exactly that ratio.
 *
 * Two mechanisms, tested separately because they answer different halves:
 *
 *  1. **The ally-proximity discount** (`./targeting` `allyCrowding`) — plan
 *     §2.1's candidate (b), needing no channel at all: a rock a visible teammate
 *     is nearer to than I am scores lower for me. A *multiplier*, never a veto,
 *     with the worst single ally setting it.
 *  2. **The `claim` callout** (`./radio`, `./behaviors` `callClaim`) — for the
 *     contention the first cannot see. It lands in `Brain.tabu`, which is the
 *     exclusion this bot already applies to a site it broke off from itself.
 *
 * And the properties that are not about either mechanism but must survive both:
 * **FFA does not move** (structurally — no allies, no channel, and provably no
 * RNG draw), fog honesty (a claim carries an id and a position, never an ore
 * count), and determinism (no wall clock, and the channel's ≥1-tick floor).
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId, Rng, Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, isOver, step } from '../sim';
import type { Asteroid, PlayerSpec, Ship, World } from '../sim';
import { callClaim, mine } from './behaviors';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import { Difficulty, DIFFICULTY_TUNING, PERSONALITIES, ROSTER } from './personalities';
import type { PersonalityId } from './personalities';
import { HEARSAY_STALENESS, NO_KEY, send, teamRadio } from './radio';
import type { TeamRadio } from './radio';
import { hashState } from '../../harness/hash';
import { botInputs, botLobby, createBots, fillEmptySlots } from './harness';
import { CLAIM_TABU_SECONDS, PATH_THREAT_RADIUS, allyCrowding, bestRock, pathClearance } from './targeting';
import type { BotCtx } from './tree';
import { context, createBrain } from './tree';

const SELF = 0;
const MATE = 1;
const FOE = 2;
const FOE2 = 3;

/** Two rocks, equally rich, equally far from the bot — so the *only* thing that
 *  can separate them is a term under test. `NEAR` is the one a teammate will be
 *  standing on; `FAR` is the open one it should concede to. */
const NEAR = 900;
const FAR = 901;

type Table = 'teams' | 'ffa';

/** `ffa` supplies **no `team` field at all** — the shape the offline client boots
 *  with, and the one that makes every ship hostile and every ally list empty. */
function roster(table: Table): PlayerSpec[] {
  const teams = [0, 0, 1, 1];
  return [SELF, MATE, FOE, FOE2].map((id) => {
    const spec: PlayerSpec = { id, shipClass: ShipClass.Vanguard };
    return table === 'ffa' ? spec : { ...spec, team: teams[id]! };
  });
}

function shipOf(world: World, id: PlayerId): Ship {
  return world.ships.find((s) => s.id === id)!;
}

function place(world: World, id: PlayerId, ship: Vec2, home: Vec2): void {
  const s = shipOf(world, id);
  s.pos = { ...ship };
  s.vel = { x: 0, y: 0 };
  s.home = { ...home };
  s.spawnProtect = 0;
  s.cargo = 0;
  const p = world.stations.find((x) => x.owner === id)!;
  p.pos = { ...home };
  p.spawnProtect = 0;
  p.sinceDamage = 999;
}

function rock(world: World, id: number, pos: Vec2): Asteroid {
  const a: Asteroid = {
    id,
    pos: { ...pos },
    radius: 40,
    ore: 30,
    maxOre: 30,
    crackStage: 0,
    mineBuffer: 0,
    home: null,
  };
  world.asteroids.push(a);
  return a;
}

/**
 * **The board.** The bot sits at the origin of the case with two identical rocks
 * 600 units away in opposite directions, so an untouched `bestRock` sees a dead
 * heat and takes the lower id ({@link NEAR}). Everything below moves exactly one
 * thing and watches the pick.
 *
 * `mate` is where slot 1 parks. Its default puts it 150 units from {@link NEAR}
 * — well inside one visual range of that rock, and much nearer to it than the
 * bot is, which is the whole trigger.
 */
function board(table: Table, mate: Vec2 = { x: 2000, y: 1450 }): World {
  const world = createWorld({
    seed: 16,
    players: roster(table),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 5;
  world.asteroids.length = 0;

  place(world, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 3000 });
  place(world, MATE, mate, { x: 2200, y: 3000 });
  place(world, FOE, { x: 200, y: 200 }, { x: 200, y: 400 });
  place(world, FOE2, { x: 3800, y: 3800 }, { x: 3800, y: 3600 });

  rock(world, NEAR, { x: 2000, y: 1400 });
  rock(world, FAR, { x: 2000, y: 2600 });
  return world;
}

function ctxOf(world: World, personality: PersonalityId = 'foreman', id: PlayerId = SELF, rng?: Rng): BotCtx {
  const brain = createBrain(PERSONALITIES[personality], rng ?? { next: () => 0.5 });
  return context(perceive(world, id), brain);
}

/** A context whose brain is on a live two-member channel, so a claim has
 *  somewhere to land. FFA gets `null`, which is the point of the `table`. */
function ctxOnRadio(
  world: World,
  personality: PersonalityId = 'foreman',
  id: PlayerId = SELF,
  rng?: Rng,
): { ctx: BotCtx; radio: TeamRadio } {
  const radio = teamRadio([SELF, MATE])!;
  const brain = createBrain(PERSONALITIES[personality], rng ?? { next: () => 0.5 }, radio);
  return { ctx: context(perceive(world, id), brain), radio };
}

/** Slot 1 says it is working `site`, `secondsAgo` seconds ago. Latency 0 here
 *  because the delivery floor is `./team-radio.test.ts`'s subject, not this
 *  file's; miss chance 0 because "did it arrive" is not what is under test. */
function mateClaims(radio: TeamRadio, now: number, site: number, at: Vec2, secondsAgo = 0): void {
  send(
    radio,
    { kind: 'claim', from: MATE, about: MATE, pos: { ...at }, key: site, seenAt: now - secondsAgo },
    0,
    0,
    { next: () => 0.5 },
  );
}

const rockPos = (world: World, id: number): Vec2 => world.asteroids.find((a) => a.id === id)!.pos;

// ---------------------------------------------------------------------------
// 1. The ally-proximity discount — no channel required
// ---------------------------------------------------------------------------

describe('a rock a teammate is nearer to is worth less to me', () => {
  it('concedes the crowded rock and takes the open one — and does not without the teammate', () => {
    // The control first: with nobody near either rock, the dead heat resolves
    // to the lower id, which is what makes the case below a *change* rather
    // than a coincidence of the board.
    const clear = board('teams', { x: 3500, y: 3500 });
    expect(bestRock(ctxOf(clear))?.id).toBe(NEAR);

    // And with the teammate parked on it, at every character in the cast.
    for (const character of ROSTER) {
      expect(bestRock(ctxOf(board('teams'), character))?.id, character).toBe(FAR);
    }
  });

  it('is a multiplier, never a veto — the only rock in view is still mined', () => {
    // Plan §4.3's named risk is over-division: two allies each politely
    // deferring until neither mines the good rock. A bot with one rock in view
    // and a teammate sitting on it still mines it, because two miners on one
    // rock beats one miner and one bot flying in circles.
    for (const character of ROSTER) {
      const world = board('teams');
      world.asteroids = world.asteroids.filter((a) => a.id === NEAR);
      const ctx = ctxOf(world, character);
      expect(allyCrowding(ctx, ctx.view.asteroids[0]!), character).toBeLessThan(1);
      expect(bestRock(ctx)?.id, character).toBe(NEAR);
    }
  });

  it('defers only to a teammate NEARER the rock than I am — never to one behind me', () => {
    // This gate is why over-division is unreachable rather than merely
    // unlikely: deference is strictly ordered by distance, so of two teammates
    // eyeing one rock the nearer one never yields. Slot 1 sits 100 units the
    // *far* side of the bot — inside one visual range of the rock's owner but
    // further from the rock than the bot is.
    const world = board('teams', { x: 2000, y: 2100 });
    const ctx = ctxOf(world);
    const near = ctx.view.asteroids.find((a) => a.id === NEAR)!;
    expect(ctx.view.ships.find((s) => s.id === MATE)).toBeDefined();
    expect(allyCrowding(ctx, near)).toBe(1);
    expect(bestRock(ctx)?.id).toBe(NEAR);
  });

  it('decays with distance, and is exactly 1 at one visual range', () => {
    // The reach is `visualRange` and it is not a constant: an ally further off
    // than that is not in `view.ships` at all, so the term cannot reach further
    // and must not reach less far.
    const reach = DEFAULT_PERCEPTION.visualRange;
    const at = (gap: number): number => {
      const world = board('teams', { x: 2000, y: 1400 + gap });
      const ctx = ctxOf(world);
      return allyCrowding(ctx, ctx.view.asteroids.find((a) => a.id === NEAR)!);
    };
    // Monotone in the gap: the closer the teammate is to the rock, the less it
    // is worth to me.
    const curve = [10, 100, 300, 500].map(at);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeGreaterThan(curve[i - 1]!);
    for (const c of curve) expect(c).toBeLessThan(1);
    // At the reach the discount is gone, exactly — no epsilon, because the term
    // must multiply by the identity when it does not apply.
    expect(at(reach)).toBe(1);
  });

  it('the worst single ally sets it — three teammates are not three penalties', () => {
    // The same discipline `pathClearance` keeps: a field with two teammates in
    // it is not twice as taken as one, it is just taken.
    const one = board('teams');
    const three = createWorld({
      seed: 16,
      players: [0, 1, 2, 3].map((id) => ({ id, shipClass: ShipClass.Vanguard, team: id === FOE2 ? 1 : 0 })),
      bounds: { width: 4000, height: 4000 },
      asteroidCount: 0,
    });
    three.time = SPAWN_PROTECTION_S + 5;
    three.asteroids.length = 0;
    place(three, SELF, { x: 2000, y: 2000 }, { x: 2000, y: 3000 });
    place(three, MATE, { x: 2000, y: 1450 }, { x: 2200, y: 3000 });
    place(three, FOE, { x: 2050, y: 1470 }, { x: 2400, y: 3000 });
    place(three, FOE2, { x: 3800, y: 3800 }, { x: 3800, y: 3600 });
    rock(three, NEAR, { x: 2000, y: 1400 });
    rock(three, FAR, { x: 2000, y: 2600 });

    const ctxOne = ctxOf(one);
    const ctxThree = ctxOf(three);
    // The nearest teammate is at the identical distance in both, so the term is
    // identical — the second one contributes nothing.
    expect(allyCrowding(ctxThree, ctxThree.view.asteroids.find((a) => a.id === NEAR)!)).toBe(
      allyCrowding(ctxOne, ctxOne.view.asteroids.find((a) => a.id === NEAR)!),
    );
  });

  it('a greedy character defers less readily — `greed`, not a new knob', () => {
    // Plan §4.5 names the dial and this is it: reuse before invention. Vulture
    // (greed 0.9) barely yields; Rusty (0.3) yields most.
    const value = (character: PersonalityId): number => {
      const ctx = ctxOf(board('teams'), character);
      return allyCrowding(ctx, ctx.view.asteroids.find((a) => a.id === NEAR)!);
    };
    const byGreed = [...ROSTER].sort((a, b) => PERSONALITIES[a].weights.greed - PERSONALITIES[b].weights.greed);
    for (let i = 1; i < byGreed.length; i++) {
      const lo = PERSONALITIES[byGreed[i - 1]!].weights.greed;
      const hi = PERSONALITIES[byGreed[i]!].weights.greed;
      if (lo === hi) continue;
      expect(value(byGreed[i]!), `${byGreed[i]!} vs ${byGreed[i - 1]!}`).toBeGreaterThan(value(byGreed[i - 1]!));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The `claim` callout
// ---------------------------------------------------------------------------

describe('a bot says which rock it is working', () => {
  it('claims a new site exactly once, not once per decision', () => {
    // `Brain.lastCallAt` is a single voice shared across kinds, so a claim sent
    // every decision would sit on the mouth a teammate needs for `help`. The
    // bound is that a claim goes out on a *change* of site, and a bot works one
    // rock for a whole errand.
    const world = board('teams');
    const { ctx, radio } = ctxOnRadio(world);
    const near = ctx.view.asteroids.find((a) => a.id === NEAR)!;

    expect(mine(ctx, near)).not.toBeNull();
    expect(radio.calls.filter((c) => c.kind === 'claim')).toHaveLength(1);
    // Same rock, next decision: nothing said.
    mine(ctx, near);
    mine(ctx, near);
    expect(radio.calls.filter((c) => c.kind === 'claim')).toHaveLength(1);
  });

  it('carries the rock id and where it is — and nothing about what is in it', () => {
    // Fog honesty, structurally: a receiver learns "my teammate is going there",
    // never "there is ore there". `Callout` has nowhere to put an ore count, and
    // this is the assertion that would catch a field being added for one.
    const world = board('teams');
    const { ctx, radio } = ctxOnRadio(world);
    const near = ctx.view.asteroids.find((a) => a.id === NEAR)!;
    mine(ctx, near);

    const claim = radio.calls.find((c) => c.kind === 'claim')!;
    expect(claim.key).toBe(NEAR);
    expect(claim.from).toBe(SELF);
    expect(claim.about).toBe(SELF); // a claim is a statement about MYSELF
    expect(claim.pos).toEqual(rockPos(world, NEAR));
    expect(claim.seenAt).toBe(ctx.view.time);
    expect(Object.keys(claim).sort()).toEqual(
      ['about', 'from', 'heardBy', 'key', 'kind', 'pos', 'readableAt', 'seenAt', 'seq'].sort(),
    );
    // …and the rock's true ore is not among them, at any remove.
    expect(JSON.stringify(claim)).not.toContain('ore');
    expect(JSON.stringify(claim)).not.toContain('crackStage');
  });

  it('says nothing about a rock it merely flew past', () => {
    // The claim is the sender's *committed* intent (`Brain.mineSite`), so a
    // decision that commits to nothing says nothing.
    const world = board('teams');
    const { ctx, radio } = ctxOnRadio(world);
    expect(mine(ctx, null)).toBeNull();
    expect(radio.calls).toHaveLength(0);
    // A full hold is the other way a mining decision declines the tick.
    shipOf(world, SELF).cargo = shipOf(world, SELF).cargoCap;
    const { ctx: full, radio: r2 } = ctxOnRadio(world);
    mine(full, full.view.asteroids[0]!);
    expect(r2.calls).toHaveLength(0);
  });
});

describe('a teammate\'s claim is honoured like my own tabu', () => {
  it('excludes the claimed rock, and lets it go when the claim ages out', () => {
    const world = board('teams', { x: 3500, y: 3500 }); // teammate far away: the discount is OFF
    const { ctx, radio } = ctxOnRadio(world);
    expect(bestRock(ctx)?.id).toBe(NEAR); // control: it would take the near rock

    mateClaims(radio, ctx.view.time, NEAR, rockPos(world, NEAR));
    expect(bestRock(ctx)?.id).toBe(FAR);
    expect(ctx.brain.tabu.has(NEAR)).toBe(true);

    // The exclusion is anchored to when the claim was MADE, so it expires on
    // its own clock rather than being renewed every time it is re-read.
    const later = board('teams', { x: 3500, y: 3500 });
    later.time = world.time + CLAIM_TABU_SECONDS + 1;
    const brain = ctx.brain;
    brain.tabu.clear();
    const aged = context(perceive(later, SELF), brain);
    mateClaims(radio, world.time, NEAR, rockPos(world, NEAR));
    expect(bestRock(aged)?.id).toBe(NEAR);
  });

  it('folds idempotently — re-reading a claim does not renew it', () => {
    // The fold runs on every decision for as long as the call stays readable,
    // so it has to be a pure write of the same value. If it were `now + hold`
    // instead of `seenAt + hold`, a stale rumour would become fresh
    // intelligence every time it was re-read — omniscience with extra steps.
    const world = board('teams', { x: 3500, y: 3500 });
    const { ctx, radio } = ctxOnRadio(world);
    mateClaims(radio, ctx.view.time, NEAR, rockPos(world, NEAR));
    bestRock(ctx);
    const first = ctx.brain.tabu.get(NEAR);
    bestRock(ctx);
    bestRock(ctx);
    expect(ctx.brain.tabu.get(NEAR)).toBe(first);
  });

  it('never shortens an exclusion this bot booked itself', () => {
    // A site this bot broke off from under fire is a decision about its own
    // safety (p11); a teammate's intent is not grounds to revisit it early.
    const world = board('teams', { x: 3500, y: 3500 });
    const { ctx, radio } = ctxOnRadio(world);
    const mine_ = ctx.view.time + 999;
    ctx.brain.tabu.set(NEAR, mine_);
    mateClaims(radio, ctx.view.time, NEAR, rockPos(world, NEAR));
    bestRock(ctx);
    expect(ctx.brain.tabu.get(NEAR)).toBe(mine_);
  });

  it('ignores a claim about a slot that is not on my side', () => {
    // Stage 3 never sends one; a branch that would defer a rock on the strength
    // of a malformed record is not a branch worth shipping. The same refusal
    // `allyDistress` makes, for the same reason.
    const world = board('teams', { x: 3500, y: 3500 });
    const { ctx, radio } = ctxOnRadio(world);
    send(
      radio,
      { kind: 'claim', from: MATE, about: FOE, pos: rockPos(world, NEAR), key: NEAR, seenAt: ctx.view.time },
      0,
      0,
      { next: () => 0.5 },
    );
    expect(bestRock(ctx)?.id).toBe(NEAR);
    expect(ctx.brain.tabu.has(NEAR)).toBe(false);
  });

  it('settles a dead heat by who called it first — and a tie moves nobody', () => {
    // Two teammates that pick the same rock on the same tick must not BOTH
    // defer: that is the ping-pong where a side leaves a good rock together and
    // goes to contest the next one together. Strictly-earlier-wins, so an exact
    // tie leaves both where they are, which is exactly the behaviour that
    // shipped before this stage and therefore never worse.
    const world = board('teams', { x: 3500, y: 3500 });

    // (a) The teammate committed FIRST — I yield.
    const early = ctxOnRadio(world);
    early.ctx.brain.mineSite = NEAR;
    early.ctx.brain.mineSiteAt = early.ctx.view.time;
    mateClaims(early.radio, early.ctx.view.time, NEAR, rockPos(world, NEAR), 1);
    expect(bestRock(early.ctx)?.id).toBe(FAR);

    // (b) The same instant — nobody yields.
    const tied = ctxOnRadio(world);
    tied.ctx.brain.mineSite = NEAR;
    tied.ctx.brain.mineSiteAt = tied.ctx.view.time;
    mateClaims(tied.radio, tied.ctx.view.time, NEAR, rockPos(world, NEAR), 0);
    expect(bestRock(tied.ctx)?.id).toBe(NEAR);

    // (c) I committed first — I keep it.
    const later = ctxOnRadio(world);
    later.ctx.brain.mineSite = NEAR;
    later.ctx.brain.mineSiteAt = later.ctx.view.time - 5;
    mateClaims(later.radio, later.ctx.view.time, NEAR, rockPos(world, NEAR), 0);
    expect(bestRock(later.ctx)?.id).toBe(NEAR);
  });

  it('honours a claim for longer at a higher tier — out of the dials, not a new knob', () => {
    // Plan §4.5's row ("Easy often ignores a claim, Medium usually, Hard
    // always") falls straight out of what Stage 2 already shipped: an Easy bot
    // misses 35% of calls outright, hears the rest 1.2 s late, and expires them
    // on a 6 s memory at a hearsay discount — so it honours a claim for about
    // three seconds if at all, where a Hard bot honours it for ten. There is no
    // `claimHonour` probability anywhere, and there must not be one.
    const life = (tier: Difficulty): number => DIFFICULTY_TUNING[tier].memorySeconds / HEARSAY_STALENESS;
    expect(life(Difficulty.Easy)).toBeLessThan(life(Difficulty.Medium));
    expect(life(Difficulty.Medium)).toBeLessThan(life(Difficulty.Hard));
    expect(DIFFICULTY_TUNING[Difficulty.Easy].callMissChance).toBeGreaterThan(
      DIFFICULTY_TUNING[Difficulty.Hard].callMissChance,
    );

    // And it is real, not merely arithmetic: the same claim, made 5 s ago, is
    // still live for a Hard bot and already gone for an Easy one.
    for (const [character, honoured] of [
      ['rusty', false], // Easy
      ['warden', true], // Hard
    ] as const) {
      const world = board('teams', { x: 3500, y: 3500 });
      const { ctx, radio } = ctxOnRadio(world, character);
      expect(DIFFICULTY_TUNING[PERSONALITIES[character].difficulty]).toBeDefined();
      mateClaims(radio, ctx.view.time, NEAR, rockPos(world, NEAR), 5);
      expect(bestRock(ctx)?.id, character).toBe(honoured ? FAR : NEAR);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. FFA does not move — structurally, and provably
// ---------------------------------------------------------------------------

describe('FFA is untouched, structurally', () => {
  it('crowds nothing and multiplies by exactly 1.0', () => {
    // Every ship in an FFA view is hostile (teams-of-one), so the loop finds no
    // candidate and the term is the identity — and an IEEE multiply by 1.0 is
    // exact, which is what keeps `ffa-parity.test.ts`'s pinned hashes green.
    //
    // **Slot 1 is placed off the approach corridor on purpose**, at a lateral
    // offset derived from `PATH_THREAT_RADIUS` rather than eyeballed, so that
    // `pathClearance` is provably 1 in both tables and the *only* thing that
    // could move the pick between them is the term under test. The default
    // board would not do: it parks the teammate on the line, where in FFA a
    // hostile costs the site the pick for p11's reason and the case would prove
    // nothing about crowding.
    const off = { x: 2000 + PATH_THREAT_RADIUS + 50, y: 1450 };
    const nearAt = { x: 2000, y: 1400 };
    for (const character of ROSTER) {
      const teams = ctxOf(board('teams', off), character);
      const ffa = ctxOf(board('ffa', off), character);
      const nearOf = (c: BotCtx) => c.view.asteroids.find((a) => a.id === NEAR)!;

      // The fixture is doing what it claims: nobody is on either corridor.
      expect(pathClearance(teams, nearAt), character).toBe(1);
      expect(pathClearance(ffa, nearAt), character).toBe(1);
      expect(ffa.view.ships.find((s) => s.id === MATE), character).toBeDefined();

      // FFA: no allies, no crowding anywhere, and the pick is the untouched one.
      expect(ffa.view.allies, character).toHaveLength(0);
      for (const a of ffa.view.asteroids) expect(allyCrowding(ffa, a), `${character}/${a.id}`).toBe(1);
      expect(bestRock(ffa)?.id, character).toBe(NEAR);

      // TEAMS: the identical geometry, and the pick moves. One table, one
      // difference — the `team` field.
      expect(allyCrowding(teams, nearOf(teams)), character).toBeLessThan(1);
      expect(bestRock(teams)?.id, character).toBe(FAR);
    }
  });

  it('draws no random number it did not draw before — the byte-identical argument', () => {
    // A claim that cost an RNG value in FFA would shift every later decision
    // that bot makes, and the pinned FFA hashes would move. `callClaim` reaches
    // `callOut`, which returns before touching `ctx.rng` when the radio is null.
    let draws = 0;
    const counting: Rng = {
      next: () => {
        draws++;
        return 0.5;
      },
    };
    const world = board('ffa');
    const ctx = ctxOf(world, 'foreman', SELF, counting);
    expect(ctx.brain.radio).toBeNull();
    const before = draws;
    expect(callClaim(ctx, { id: NEAR, pos: rockPos(world, NEAR) })).toBe(false);
    expect(draws).toBe(before);
  });

  it('has nowhere to put a claim: a side of one gets no channel at all', () => {
    expect(teamRadio([SELF])).toBeNull();
    expect(teamRadio([])).toBeNull();
    // …and `NO_KEY` is what the three kinds that predate Stage 3 still stamp,
    // so their records did not change shape.
    const radio = teamRadio([SELF, MATE])!;
    send(radio, { kind: 'help', from: SELF, about: SELF, pos: { x: 0, y: 0 }, seenAt: 0 }, 0, 0, { next: () => 0.5 });
    expect(radio.calls[0]!.key).toBe(NO_KEY);
  });
});

// ---------------------------------------------------------------------------
// 4. End to end — the ratio §1.6 is actually about
// ---------------------------------------------------------------------------

/**
 * A real seeded 2v2 with the shipped cast, counting the pair-ticks §1.6 counts:
 * how often two live ships hold the **same committed `Brain.mineSite`**, allied
 * pairs against the enemy-pair control in the same match.
 *
 * The enemy control is what makes this a measurement rather than a number: it is
 * subject to the identical board, the identical rock supply and the identical
 * match, and nothing in Stage 3 touches how a bot treats a foe — so it should
 * not move, and the ally figure should fall toward it.
 */
function contention(seed: number, seconds: number): { ally: number; foe: number; allyTicks: number } {
  const seats = fillEmptySlots([], 4, undefined, [0, 0, 1, 1]);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots = createBots(seats, { seed });
  const brainOf = new Map(bots.map((b) => [b.seat.id, b]));
  const team = new Map(world.stations.map((s) => [s.owner, s.team]));

  let ally = 0;
  let foe = 0;
  let allyTicks = 0;
  let foeTicks = 0;
  while (world.time < seconds && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    for (let i = 0; i < world.ships.length; i++) {
      const a = world.ships[i]!;
      if (!a.alive || a.eliminated) continue;
      for (let j = i + 1; j < world.ships.length; j++) {
        const b = world.ships[j]!;
        if (!b.alive || b.eliminated) continue;
        const sa = brainOf.get(a.id)!.brain.mineSite;
        const same = sa >= 0 && sa === brainOf.get(b.id)!.brain.mineSite;
        if (team.get(a.id) === team.get(b.id)) {
          allyTicks++;
          if (same) ally++;
        } else {
          foeTicks++;
          if (same) foe++;
        }
      }
    }
  }
  return { ally: ally / Math.max(1, allyTicks), foe: foe / Math.max(1, foeTicks), allyTicks };
}

describe('a new callout kind does not reach a decision through seat order', () => {
  it('runs the identical 2v2 with the bots array REVERSED, with claims on the channel', () => {
    // `./team-radio.test.ts` owns this guard and already runs it over full 2v2
    // matches, so it covers `claim` the moment `claim` exists. What it cannot
    // say is whether the traffic was *there* — a determinism guard over a
    // channel nobody spoke on is vacuous. This is the non-vacuity half, kept
    // beside the mechanism it is about.
    const run = (reversed: boolean): { hash: string; claims: number } => {
      const seats = fillEmptySlots([], 4, undefined, [0, 0, 1, 1]);
      const world = createWorld({ seed: 11, players: botLobby(seats) });
      const bots = createBots(seats, { seed: 11 });
      const order = reversed ? [...bots].reverse() : bots;
      while (world.time < 180 && !isOver(world)) step(world, botInputs(world, order, TICK_DT), TICK_DT);
      // The ring is a fixed capacity, so this counts what is *still* on the
      // channel, which is a lower bound on what was said. A lower bound above
      // zero is all this case needs.
      const claims = bots.reduce(
        (n, b) => n + (b.brain.radio?.calls.filter((c) => c.kind === 'claim').length ?? 0),
        0,
      );
      return { hash: hashState(world), claims };
    };

    const forward = run(false);
    const backward = run(true);
    expect(forward.claims).toBeGreaterThan(0);
    expect(backward.hash).toBe(forward.hash);
  });
});

describe('two economies stop doing one economy\'s work', () => {
  it('brings allied rock contention down to the enemy-pair control', () => {
    // **The finding this stage exists for, and the number that replaces §1.6's
    // stale 434.** Measured over full 2v2 matches at `origin/main`, allied pairs
    // hold the same committed site 12.5% / 12.0% of their pair-ticks (two
    // disjoint 8-seed sets) against an enemy control of 6.1% / 7.1% — allies
    // contend about **twice as often as enemies**, on the same board, in the
    // same match. With both Stage 3 mechanisms the ally figure lands at 8.0% /
    // 8.4% against a control of 7.2% / 7.4%: the ratio closes from ~2× to ~1.1×.
    //
    // Pooled over three seeds here rather than run on one, for the reason
    // `./ally-defence.test.ts` records: two builds do not produce the same match
    // with a small difference, they produce different matches.
    const runs = [11, 23, 37].map((s) => contention(s, 300));
    const ally = runs.reduce((a, r) => a + r.ally, 0) / runs.length;
    const foe = runs.reduce((a, r) => a + r.foe, 0) / runs.length;

    // The instrument is live: bots really are committing to rocks.
    expect(runs.every((r) => r.allyTicks > 1000)).toBe(true);
    expect(ally).toBeGreaterThan(0);

    // And allies no longer contend like a pair that spawned next to each other.
    // Asserted as a *ratio* against the in-match control, so it survives a
    // change to the rock supply, the map or the cast — any of which would move
    // both numbers together.
    expect(ally / foe).toBeLessThan(1.6);
  });
});
