/**
 * harness/strategies.ts — QA probe strategies. OWNER: QA Agent (GDD §3.8).
 *
 * The balance targets are phrased in strategies: "no strategy and no ship class
 * exceeds 55% win rate across bot mirrors" (GDD §2.11, §3.8). That sentence
 * needs strategies to exist before it can be falsified — and on `main` today
 * every difficulty tier still runs the do-nothing baseline (`src/bots/bot.ts`,
 * "day 2 ships one tree"). The Easy/Medium/Hard trees are the Bot Engineer's,
 * and they are not merged yet.
 *
 * So these are **measuring instruments, not game AI.** Each one is the smallest
 * honest expression of one corner of the triangle (GDD §2.3 — mine / defend /
 * attack), written to answer "does the ruleset reward this?" rather than to be
 * good at the game. They live in `harness/` on purpose: nothing here ships in
 * the client, and when the real trees land the harness measures those instead,
 * with these kept as the fixed reference the trees are compared against.
 *
 * Three rules they honor, the same three the shipped bots honor:
 *
 *  1. **Fog-honest.** A strategy sees a `BotView` (`src/bots/perception.ts`) and
 *     nothing else. It cannot read a core's HP it has not scouted.
 *  2. **The same action interface a human uses** (GDD §2.4). Every strategy's
 *     entire output is `Action[]`; the sim validates every order and never
 *     trusts the sender.
 *  3. **No `Math.random`, no wall clock.** Every decision is a pure function of
 *     the view, so a recorded match replays to the same state hash (GDD §4.8).
 *
 * Upgrades are bought by *pressing the row* rather than by computing the price:
 * `SelfView` deliberately does not expose upgrade tiers (the HUD does not show
 * them either — GDD §2.2), so a strategy presses when it is rich and lets the
 * sim refuse what it cannot afford. That is exactly what a player does.
 */

import type { Action, PlayerId, Vec2 } from '@shared/types';
import { UpgradeTrack } from '@shared/types';
import type { BotView, PerceivedAsteroid, PerceivedPlanet, PerceivedShip } from '../src/bots';
import { WEAPON_RANGE, PLANET, SPAWN_PROTECTION_S, TURRET, SHIELD } from '../src/sim';

// ---------------------------------------------------------------------------
// The strategy contract
// ---------------------------------------------------------------------------

/** The five probes. `idle` is the shipped do-nothing baseline (`src/bots`). */
export type StrategyId = 'idle' | 'miner' | 'turtle' | 'rusher' | 'raider';

/** Every probe, in report order. */
export const STRATEGY_IDS: readonly StrategyId[] = ['idle', 'miner', 'turtle', 'rusher', 'raider'];

/** One probe: a name, a one-line hypothesis, and a decision function factory.
 *  The factory exists so a probe may hold per-slot memory; none of them holds
 *  anything time- or random-derived. */
export interface Strategy {
  readonly id: StrategyId;
  /** What this probe is testing about the ruleset. */
  readonly hypothesis: string;
  create(id: PlayerId): (view: BotView) => readonly Action[];
}

// ---------------------------------------------------------------------------
// Shared motor skills
// ---------------------------------------------------------------------------

/** Hands on the stick, nothing pressed. Shared and frozen — an idle eight-slot
 *  match allocates nothing per decision (GDD §4.3). */
const IDLE: readonly Action[] = Object.freeze([
  Object.freeze({ type: 'thrust', dir: Object.freeze({ x: 0, y: 0 }) }),
  Object.freeze({ type: 'fire', active: false, auto: false }),
] as Action[]);

/** Unit vector from `a` to `b`, or zero when they coincide. */
function toward(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Distance between two points (`Math.sqrt`, not `Math.hypot` — see the
 *  determinism note in `src/bots/perception.ts`). */
function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Fly at `target`, easing off inside `standoff` so the ship parks instead of
 * orbiting it forever. Drag does the braking (GDD §4.1), so "ease off" is
 * literally releasing the stick — which is what a player does.
 */
function approach(view: BotView, target: Vec2, standoff: number): Action {
  const d = dist(view.self.pos, target);
  if (d <= standoff) {
    const speed = Math.sqrt(view.self.vel.x ** 2 + view.self.vel.y ** 2);
    // Still carrying speed into the stop: thrust against it rather than coast.
    if (speed > 60) {
      return { type: 'thrust', dir: { x: -view.self.vel.x / speed, y: -view.self.vel.y / speed } };
    }
    return { type: 'thrust', dir: { x: 0, y: 0 } };
  }
  return { type: 'thrust', dir: toward(view.self.pos, target) };
}

/** Hold the trigger in Auto-aim: the sim engages the nearest valid target
 *  across the full 360° (GDD §2.4), which is precisely "point the ship at the
 *  work and pull". Every probe fires this way — none of them is a marksmanship
 *  test. */
const FIRE: Action = { type: 'fire', active: true, auto: true };
const HOLD_FIRE: Action = { type: 'fire', active: false, auto: false };

/** Nearest asteroid in view, or null. Ties break on id so two runs agree. */
function nearestAsteroid(view: BotView): PerceivedAsteroid | null {
  let best: PerceivedAsteroid | null = null;
  for (const a of view.asteroids) {
    if (!best || a.distance < best.distance || (a.distance === best.distance && a.id < best.id)) {
      best = a;
    }
  }
  return best;
}

/** Nearest enemy home still standing, by public position (GDD §2.2: a planet's
 *  position and beacon ring are public at any range). */
function nearestEnemyPlanet(view: BotView): PerceivedPlanet | null {
  let best: PerceivedPlanet | null = null;
  for (const p of view.planets) {
    if (p.owner === view.self.id || !p.alive) continue;
    if (!best || p.distance < best.distance || (p.distance === best.distance && p.owner < best.owner)) {
      best = p;
    }
  }
  return best;
}

/** Nearest enemy ship worth shooting: alive, not eliminated, not glowing with
 *  spawn protection, and close enough to be on screen at all. */
function nearestEnemyShip(view: BotView): PerceivedShip | null {
  let best: PerceivedShip | null = null;
  for (const s of view.ships) {
    if (s.id === view.self.id || !s.alive || s.eliminated) continue;
    if (s.spawnProtected === true) continue;
    if (s.distance > view.perception.visualRange) continue;
    if (!best || s.distance < best.distance || (s.distance === best.distance && s.id < best.id)) {
      best = s;
    }
  }
  return best;
}

/** True while nothing can be attacked yet (GDD §2.1: 10 s of spawn protection
 *  on ship and core). The match clock is public information — the wave clock is
 *  on the HUD (GDD §2.2) — so reading it is not a fog violation. */
function opening(view: BotView): boolean {
  return view.time < SPAWN_PROTECTION_S;
}

/**
 * The spending pass every economically-minded probe runs while docked. Order is
 * fixed and documented, because it *is* the strategy's economy: bank first (held
 * ore is not safe — GDD §2.3), then the probe's own priority list.
 *
 * Only one purchase press is emitted per decision. The wheel is one press at a
 * time for a human too, and it keeps a rich probe from emptying its bank into
 * four turrets on a single tick.
 */
function bankAndSpend(view: BotView, wants: readonly Action[]): Action[] {
  const out: Action[] = [];
  if (view.self.cargo > 1e-9) out.push({ type: 'buildOrder', item: 'bank' });
  const first = wants[0];
  if (first) out.push(first);
  return out;
}

/** Upgrade-row presses, cycled so no track starves. The sim refuses what the
 *  ship cannot afford or has maxed, which is the whole validation this needs. */
function upgradePress(order: readonly UpgradeTrack[], n: number): Action {
  return { type: 'upgradeOrder', track: order[n % order.length]! };
}

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

/** Mine → bank → upgrade, and never fight anyone on purpose. The economy's
 *  upper bound: if a match cannot be won by pure income, the field yield is
 *  right; if it always is, the field is too rich (GDD §2.3). */
function miner(): (view: BotView) => readonly Action[] {
  let presses = 0;
  return (view) => {
    const self = view.self;
    if (!self.alive) return IDLE;

    const home = self.planet;
    const goHome = self.cargoFull || (view.collapsed && self.cargo > 0);

    if (goHome && home) {
      if (self.docked) {
        presses++;
        return [
          ...bankAndSpend(view, [upgradePress([UpgradeTrack.Cargo, UpgradeTrack.Power, UpgradeTrack.Engine], presses)]),
          HOLD_FIRE,
        ];
      }
      return [approach(view, home.pos, PLANET.dockRange * 0.6), HOLD_FIRE];
    }

    // Loose chunks are free ore and closer than a rock's worth of weapon time.
    const chunk = view.chunks[0];
    const rock = nearestAsteroid(view);
    if (chunk && (!rock || chunk.distance < rock.distance * 0.5)) {
      return [approach(view, chunk.pos, 0), HOLD_FIRE];
    }
    if (!rock) return [approach(view, view.center, 0), HOLD_FIRE];
    // Stand off inside weapon range and hold the trigger: mining is a shot, not a
    // ram (GDD §2.3).
    return [approach(view, rock.pos, WEAPON_RANGE * 0.7), rock.distance < WEAPON_RANGE ? FIRE : HOLD_FIRE];
  };
}

/** Mine close to home and pour everything into the planet: turrets, then a
 *  shield, then repair. Tests GDD §2.6's "an undefended planet falls; a defended
 *  planet is nearly uncrackable" from the defender's side, and §2.6's warning
 *  that "a turtle spends ore to stand still". */
function turtle(): (view: BotView) => readonly Action[] {
  return (view) => {
    const self = view.self;
    if (!self.alive) return IDLE;
    const home = self.planet;
    if (!home) return IDLE;

    // Home is being hit: come back and defend it in person. Turrets deter, the
    // ship defends (GDD §2.6).
    const defending = home.underAttack || self.cargoFull || view.collapsed;

    // What this tick's ore could buy, in priority order. Computed before the
    // docking check, because "is there anything to do at home?" is what decides
    // whether the ship should be at home at all — a ship parked on a planet it
    // has nothing to spend at is a turtle that has forgotten to earn.
    const wants: Action[] = [];
    if (home.turrets + home.builds < TURRET.capPerPlanet && self.spendable >= TURRET.cost) {
      wants.push({ type: 'buildOrder', item: 'turret' });
    } else if (home.shields < SHIELD.capPerPlanet && self.spendable >= SHIELD.cost) {
      wants.push({ type: 'buildOrder', item: 'shield' });
    } else if (home.coreHp < home.maxCoreHp && !view.collapsed && self.spendable > 0) {
      wants.push({ type: 'buildOrder', item: 'repair' });
    }
    const hasBusiness = defending || wants.length > 0 || self.cargo > 1e-9;

    if (self.docked && hasBusiness) {
      const enemy = nearestEnemyShip(view);
      const fire = enemy && enemy.distance < WEAPON_RANGE ? FIRE : HOLD_FIRE;
      return [...bankAndSpend(view, wants), { type: 'thrust', dir: { x: 0, y: 0 } }, fire];
    }

    if (defending) return [approach(view, home.pos, PLANET.dockRange * 0.6), HOLD_FIRE];

    // Otherwise mine — but only rocks it can get home from quickly. A turtle
    // that chases the field is not a turtle.
    const rock = nearestAsteroid(view);
    if (rock && dist(rock.pos, home.pos) < view.perception.visualRange) {
      return [approach(view, rock.pos, WEAPON_RANGE * 0.7), rock.distance < WEAPON_RANGE ? FIRE : HOLD_FIRE];
    }
    return [approach(view, home.pos, PLANET.dockRange * 0.6), HOLD_FIRE];
  };
}

/** Fly at the nearest surviving enemy home and hold the trigger on it, forever.
 *  The siege hypothesis (GDD §2.6) at its crudest: a lone attacker against
 *  whatever the defender built. It mines only while spawn protection is up,
 *  because there is nothing else to do in the first ten seconds. */
function rusher(): (view: BotView) => readonly Action[] {
  return (view) => {
    const self = view.self;
    if (!self.alive) return IDLE;

    if (opening(view)) {
      const rock = nearestAsteroid(view);
      if (rock) {
        return [approach(view, rock.pos, WEAPON_RANGE * 0.7), rock.distance < WEAPON_RANGE ? FIRE : HOLD_FIRE];
      }
      return [approach(view, view.center, 0), HOLD_FIRE];
    }

    const target = nearestEnemyPlanet(view);
    if (!target) return [approach(view, view.center, 0), HOLD_FIRE];

    // Park at the edge of weapon range: outside turret range (240 < 260) is the
    // skill GDD §2.6 names, and standing off is how it is expressed.
    const standoff = target.radius + WEAPON_RANGE * 0.75;
    return [approach(view, target.pos, standoff), target.distance < WEAPON_RANGE + target.radius ? FIRE : HOLD_FIRE];
  };
}

/** Hunt ships, not planets: chase whatever is on screen and shoot it, and mine
 *  when the screen is empty. Tests GDD §2.6's "pulling the owner away … is the
 *  skill" and §2.9's Hard-bot thesis that punishing the miner far from home is
 *  the profitable play. */
function raider(): (view: BotView) => readonly Action[] {
  const mine = miner();
  return (view) => {
    const self = view.self;
    if (!self.alive) return IDLE;
    if (opening(view)) return mine(view);

    const prey = nearestEnemyShip(view);
    if (!prey) {
      // Nothing in sight and the hold is full — bank it, then go back on patrol.
      if (self.cargoFull || self.cargo > 0) return mine(view);
      return [approach(view, view.center, 0), HOLD_FIRE];
    }
    // Close to inside weapon range and hold the trigger. Auto-aim engages the
    // nearest valid target, so a rock between them eats the shot — that is the
    // honest cost of hunting inside the field, not a bug to code around.
    return [approach(view, prey.pos, WEAPON_RANGE * 0.6), prey.distance < WEAPON_RANGE ? FIRE : HOLD_FIRE];
  };
}

/** Hands off the controls, forever — the shipped `doNothing` tree, restated
 *  here so the report can name it alongside the others (`src/bots/bot.ts`). */
function idle(): (view: BotView) => readonly Action[] {
  return () => IDLE;
}

/** The probe table, keyed by id. */
export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = {
  idle: {
    id: 'idle',
    hypothesis: 'The baseline: a match of eight passive players must still reach an ending (GDD §2.3).',
    create: () => idle(),
  },
  miner: {
    id: 'miner',
    hypothesis: 'Pure income. If mining alone wins, the field is too rich to force a fight.',
    create: () => miner(),
  },
  turtle: {
    id: 'turtle',
    hypothesis: 'Pure defense. GDD §2.6 says a turtle spends ore to stand still and loses the endgame.',
    create: () => turtle(),
  },
  rusher: {
    id: 'rusher',
    hypothesis: 'Pure siege. GDD §2.6 says attacking an occupied planet is a mistake.',
    create: () => rusher(),
  },
  raider: {
    id: 'raider',
    hypothesis: 'Pure interception. GDD §2.9 says punishing the miner far from home is the profitable play.',
    create: () => raider(),
  },
};

/** Look a probe up by id, with a real error rather than `undefined` on a typo. */
export function strategy(id: StrategyId): Strategy {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`unknown strategy: ${String(id)}`);
  return s;
}
