/**
 * src/bots/p16-teams-repro.probe.test.ts — THE REPRO, and nothing else.
 * OWNER: Bot Engineer. **Temporary**: this file exists to photograph the defect
 * before it is fixed, and is replaced by `./teams-hostility.test.ts` in the same
 * PR (p16-01, "team B bots was attacking each other").
 *
 * It is deliberately an **unstaged** match: eight bots, the roster cast, the
 * offline boot's own roster path (`fillEmptySlots` → `botLobby` → `createWorld`)
 * with nothing placed by hand — slots 0-3 on team A, slots 4-7 on team B, the
 * table `src/platform/match-boot` stamps for a TEAMS lobby. Nobody is parked in
 * front of anybody; whatever happens, the match arranged it.
 *
 * The instrument reads the bot's own target selectors on the bot's own view,
 * after its decision, on a context assembled by hand so nothing is mutated: the
 * three functions the three trees actually pick with (`nearestEnemy` for Easy's
 * potshot, `mediumTarget` for Medium, `bestTarget` for Hard's attack), plus
 * `homeIntruder` for the defence branch every tier shares. If any of them names
 * a slot on the observer's own team, that decision picked an ally.
 */

import { describe, it, expect } from 'vitest';
import {
  areEnemies,
  canDamage,
  createWorld,
  FRIENDLY_FIRE,
  TICK_DT,
  TURRET,
  WEAPON_RANGE,
  type PlayerSpec,
  type World,
} from '../sim';
import { createBots, botLobby, fillEmptySlots, runHeadlessMatch } from './harness';
import { Difficulty } from './personalities';
import type { BotCtx } from './tree';
import type { BotView } from './perception';
import { bestTarget, homeIntruder, nearestEnemy } from './targeting';
import { mediumTarget } from './medium';
import { hardAttackFloor } from './hard';
import type { Bot } from './bot';

/** Slots 0-3 fight for side 0, slots 4-7 for side 1 — a plain two-team lobby. */
const TEAM_OF = (id: number): number => (id < 4 ? 0 : 1);

/** A context built by hand from a view the bot has already decided on: same
 *  fields `tree.context` assembles, minus its side effects, so reading the
 *  selectors cannot perturb the match being measured. */
function shadowCtx(view: BotView, bot: Bot): BotCtx {
  return {
    view,
    self: view.self,
    brain: bot.brain,
    weights: bot.brain.weights,
    tuning: bot.brain.tuning,
    rng: bot.brain.rng,
    memory: bot.brain.memory,
  };
}

interface Row {
  readonly tick: number;
  readonly bot: number;
  readonly behavior: string;
  readonly what: string;
  readonly target: number;
  readonly ally: boolean;
  readonly firing: boolean;
}

describe('p16 REPRO — an unstaged TEAMS match', () => {
  it('bots select, chase and fire on their own teammates', () => {
    const seats = fillEmptySlots();
    const players: PlayerSpec[] = botLobby(seats).map((p) => ({ ...p, team: TEAM_OF(p.id) }));
    const world: World = createWorld({ seed: 9021, players });
    const bots = createBots(seats, { seed: 9021 });

    const rows: Row[] = [];
    for (const bot of bots) {
      const decide = bot.decide;
      bot.decide = (view: BotView) => {
        const actions = decide(view);
        const ctx = shadowCtx(view, bot);
        const firing = actions.some((a) => a.type === 'fire' && a.active);
        const note = (what: string, target: number | null): void => {
          if (target === null || target < 0) return;
          rows.push({
            tick: view.tick,
            bot: bot.seat.id,
            behavior: bot.brain.lastBehavior,
            what,
            target,
            ally: !areEnemies(world, bot.seat.id, target),
            firing,
          });
        };
        note('intruder', homeIntruder(ctx)?.id ?? null);
        if (bot.difficulty === Difficulty.Easy) note('potshot', nearestEnemy(ctx)?.id ?? null);
        if (bot.difficulty === Difficulty.Medium) {
          const t = mediumTarget(ctx);
          note(t?.kind === 'station' ? 'siege' : 'attack', t?.id ?? null);
        }
        if (bot.difficulty === Difficulty.Hard) {
          const t = bestTarget(ctx, hardAttackFloor(ctx));
          note(t?.kind === 'station' ? 'siege' : 'attack', t?.id ?? null);
        }
        return actions;
      };
    }

    // The damage half of the report, MEASURED in the same natural run: hull lost
    // in any tick where the only guns that could bear on a ship were its own
    // team's — no enemy ship inside weapon range, no enemy station inside turret
    // reach. If allied fire hurt, this is where it would show up.
    let alliedFireTicks = 0;
    let hullLostUnderAlliedFireOnly = 0;
    const hullBefore = new Map<number, number>(world.ships.map((s) => [s.id, s.hull]));
    const onTick = (w: World): void => {
      for (const s of w.ships) {
        const was = hullBefore.get(s.id) ?? s.hull;
        hullBefore.set(s.id, s.hull);
        if (!s.alive) continue;
        let alliedGun = false;
        let enemyCouldBear = false;
        for (const o of w.ships) {
          if (o.id === s.id || !o.alive) continue;
          const d = Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y);
          if (d > WEAPON_RANGE) continue;
          if (areEnemies(w, o.id, s.id)) enemyCouldBear = true;
          else if (o.firing) alliedGun = true;
        }
        for (const p of w.stations) {
          if (!p.alive || !areEnemies(w, p.owner, s.id)) continue;
          if (Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y) <= p.radius + TURRET.range) enemyCouldBear = true;
        }
        if (!alliedGun || enemyCouldBear) continue;
        alliedFireTicks++;
        if (s.hull < was) hullLostUnderAlliedFireOnly += was - s.hull;
      }
    };

    // Two minutes of sim time: long enough for the opening spend, the first two
    // waves, and the first real contact.
    runHeadlessMatch(world, bots, { dt: TICK_DT, maxSeconds: 120, onTick });

    const allied = rows.filter((r) => r.ally);
    const line = (r: Row): string =>
      `t=${(r.tick * TICK_DT).toFixed(2)}s bot ${r.bot} (team ${TEAM_OF(r.bot)}) ` +
      `behavior=${r.behavior.padEnd(14)} ${r.what}→slot ${r.target} (team ${TEAM_OF(r.target)}) ` +
      `${r.ally ? 'ALLY' : 'foe '} firing=${r.firing}`;
    const firedOnAlly = allied.filter((r) => r.firing);
    const perBot = new Map<number, number>();
    for (const r of allied) perBot.set(r.bot, (perBot.get(r.bot) ?? 0) + 1);
    // One bot's own continuous story, allies and foes together — the sequence a
    // developer watching that slot would have seen.
    const worst = [...perBot.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const firstShot = rows.findIndex((r) => r.bot === worst && r.ally && r.firing);

    // eslint-disable-next-line no-console
    console.log(
      `\n=== p16 REPRO: ${allied.length} of ${rows.length} target picks named an ALLY` +
        ` (${rows.length - allied.length} named a real foe)\n` +
        `=== ${firedOnAlly.length} allied picks had the trigger down\n` +
        `=== allied picks per bot: ${[...perBot.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([b, n]) => `${b}:${n}`)
          .join(' ')}\n` +
        `=== ${alliedFireTicks} ship-ticks spent under ALLIED fire only,` +
        ` ${hullLostUnderAlliedFireOnly} hull lost in them\n` +
        `--- first eight decisions that fired on an ally, any bot:\n` +
        firedOnAlly.slice(0, 8).map(line).join('\n') +
        `\n--- slot ${worst}, twelve consecutive target picks from its first shot at an ally:\n` +
        rows
          .filter((r, i) => r.bot === worst && i >= firstShot)
          .slice(0, 12)
          .map(line)
          .join('\n') +
        '\n',
    );

    // The photograph: this is the DEFECT, asserted so the file is honest about
    // what it found. `./teams-hostility.test.ts` asserts the opposite.
    expect(allied.length).toBeGreaterThan(0);

    // The damage half of the report: friendly fire is off and projectiles route
    // through `canDamage`, so those shots land on nothing. The bots burn their
    // turns anyway.
    expect(FRIENDLY_FIRE).toBe(false);
    expect(canDamage(world, 0, 1)).toBe(false);
    expect(hullLostUnderAlliedFireOnly).toBe(0);
    expect(areEnemies(world, 0, 1)).toBe(false);
    expect(areEnemies(world, 0, 4)).toBe(true);
  });
});
