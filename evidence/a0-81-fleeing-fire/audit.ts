/**
 * evidence/a0-81-fleeing-fire/audit.ts — **does a retreating bot shoot back?**
 * OWNER: Bot Engineer (a0-81).
 *
 * The developer, 2026-08-17, from a live match: *"when rusty was fleeing from me
 * he could have auto fired at me but instead he didnt … thats dumb because its
 * unfair for him to just target his base and not fire at me at same time because
 * thats what i would do."*
 *
 * This is the measurement behind that sentence: real eight-slot matches, the
 * shipped cast, no fixtures and no staging — the bots pick their own fights,
 * take their own damage, and break off when their own nerve says to. Every
 * number below is read out of the running sim and the bots' own `Brain`;
 * nothing here writes to `src/`.
 *
 * WHAT IS COUNTED, precisely, because the headline number is easy to fudge:
 *
 *  - a **retreat tick** is a tick on which that bot's winning behavior-tree leaf
 *    was `retreat` (`Brain.lastBehavior`) — the bot's own account of what it was
 *    doing, not an inference from its velocity;
 *  - a **chased** retreat tick is one where a *hostile ship* was inside
 *    `WEAPON_RANGE` at the same moment, read through the bot's own fog-honest
 *    view. That is the only denominator the developer's complaint is about: a
 *    bot retreating across empty space has nothing to shoot at, and counting
 *    those ticks would dilute the answer toward zero on both builds;
 *  - a **shot** is a projectile actually loosed, detected from the weapon
 *    reload going from ready to full inside the step — so a held trigger on
 *    cooldown counts once, when the shot leaves, exactly like a human's.
 *
 * Run:    npx vite-node evidence/a0-81-fleeing-fire/audit.ts
 * Prints: a per-tier table to stdout (pasted into ./audit.txt, before and after).
 */

import {
  SHIP_WEAPON,
  TICK_DT,
  WEAPON_RANGE,
  createWorld,
  isOver,
  step,
  type World,
} from '../../src/sim';
import {
  Difficulty,
  MATCH_SLOTS,
  PERSONALITIES,
  ROSTER,
  botInputs,
  botLobby,
  createBots,
  fillEmptySlots,
  type Bot,
} from '../../src/bots';

/** Seeds. Eight full matches, not one: a single match is one story about one
 *  cast, and the quantity here (how often a bot is chased at all) swings hard
 *  with who happened to meet whom. */
const SEEDS = [1, 7, 23, 37, 101, 991, 20260806, 20260817];

/** Sim seconds per match. Long enough for the economy to fund upgrades, for
 *  hulls to get hurt, and therefore for retreats to happen in bulk. */
const SECONDS = 300;

interface Row {
  /** Ticks the bot's own winning leaf was `retreat`. */
  retreatTicks: number;
  /** …of those, ticks with a hostile inside weapon range: it is being CHASED. */
  chasedTicks: number;
  /** …of those, ticks the emitted action stream held the trigger down. */
  triggerTicks: number;
  /** Projectiles actually loosed while chased-and-retreating. */
  shots: number;
  /** Hull HP this tier landed on enemy ships across the whole match, for the
   *  "what does this do to difficulty in practice" question. */
  damageToShips: number;
  bots: number;
}

const blank = (): Row => ({
  retreatTicks: 0,
  chasedTicks: 0,
  triggerTicks: 0,
  shots: 0,
  damageToShips: 0,
  bots: 0,
});

/** Is a hostile ship inside weapon range of this bot right now? Read off the
 *  world rather than the view only because the view is rebuilt on the bot's own
 *  reaction cadence and this is a per-TICK question; hostility itself still comes
 *  from the sim's one allegiance predicate, which is what the view stamps. */
function chased(world: World, id: number): boolean {
  const me = world.ships.find((s) => s.id === id);
  if (!me || !me.alive) return false;
  for (const other of world.ships) {
    if (other.id === id || !other.alive || other.eliminated) continue;
    if (other.team === me.team) continue;
    const dx = other.pos.x - me.pos.x;
    const dy = other.pos.y - me.pos.y;
    if (Math.sqrt(dx * dx + dy * dy) <= WEAPON_RANGE) return true;
  }
  return false;
}

function runMatch(seed: number, rows: Map<Difficulty, Row>): void {
  const seats = fillEmptySlots([], MATCH_SLOTS, ROSTER);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots: Bot[] = createBots(seats, { seed });
  const tierOf = new Map<number, Difficulty>();
  for (const bot of bots) {
    const tier = PERSONALITIES[bot.seat.personality].difficulty;
    tierOf.set(bot.seat.id, tier);
    rows.get(tier)!.bots += 1;
  }

  const cooldown = new Map<number, number>();
  while (!isOver(world) && world.time < SECONDS) {
    // The behaviour label and the stream are read BEFORE the step, because they
    // are what this tick's decision was; the shot is read after, because it is
    // what the step did with it.
    const inputs = botInputs(world, bots, TICK_DT);
    const state = bots.map((bot) => {
      const ship = world.ships.find((s) => s.id === bot.seat.id);
      cooldown.set(bot.seat.id, ship?.weaponCooldown ?? 0);
      const stream = inputs.find((i) => i.id === bot.seat.id)?.actions ?? [];
      return {
        id: bot.seat.id,
        retreating: bot.brain.lastBehavior === 'retreat',
        trigger: stream.some((a) => a.type === 'fire' && a.active),
        chased: chased(world, bot.seat.id),
      };
    });

    step(world, inputs, TICK_DT);

    for (const s of state) {
      if (!s.retreating) continue;
      const row = rows.get(tierOf.get(s.id)!)!;
      row.retreatTicks += 1;
      if (!s.chased) continue;
      row.chasedTicks += 1;
      if (s.trigger) row.triggerTicks += 1;
      const after = world.ships.find((sh) => sh.id === s.id)?.weaponCooldown ?? 0;
      // The reload only ever counts DOWN inside a step; it jumps back to full
      // exactly when a projectile leaves the barrel (`fireWeapon`).
      if (after > (cooldown.get(s.id) ?? 0) + SHIP_WEAPON.fireInterval * 0.5) row.shots += 1;
    }
  }

  const credit = world.credit;
  if (credit) {
    for (const bot of bots) {
      rows.get(tierOf.get(bot.seat.id)!)!.damageToShips += credit.dealtToShips[bot.seat.id] ?? 0;
    }
  }
}

const rows = new Map<Difficulty, Row>([
  [Difficulty.Easy, blank()],
  [Difficulty.Medium, blank()],
  [Difficulty.Hard, blank()],
]);
for (const seed of SEEDS) runMatch(seed, rows);

const pad = (s: string | number, n: number): string => String(s).padStart(n);
console.log(`seeds=${SEEDS.join(',')}  seconds=${SECONDS}  slots=${MATCH_SLOTS}  cast=${ROSTER.join(',')}`);
console.log('');
console.log('tier    bot-matches  retreat-ticks  chased-ticks  trigger-ticks   shots  shots/chased-sec  dmg-to-ships');
for (const tier of [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard]) {
  const r = rows.get(tier)!;
  const chasedSec = r.chasedTicks * TICK_DT;
  const rate = chasedSec > 0 ? (r.shots / chasedSec).toFixed(2) : '—';
  console.log(
    `${tier.padEnd(8)}${pad(r.bots, 11)}${pad(r.retreatTicks, 15)}${pad(r.chasedTicks, 14)}` +
      `${pad(r.triggerTicks, 15)}${pad(r.shots, 8)}${pad(rate, 18)}${pad(r.damageToShips.toFixed(0), 14)}`,
  );
}
