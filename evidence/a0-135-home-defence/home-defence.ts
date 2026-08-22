/**
 * evidence/a0-135-home-defence/home-defence.ts — **does a wounded bot come and
 * defend its own station?** OWNER: Bot Engineer (a0-135).
 *
 * The developer, 2026-08-22, from a live match, with a screenshot of Rusty at
 * 25/70 hull and its own station ringed red:
 *
 * > *"as I was attacking rusty base he was scared to come engage like he was low
 * > on health, but ships are cheap you get a free one, they shouldn't fear death
 * > just cause they are low on health... protection of their base is essential
 * > to the game a player would defend at all costs"*
 *
 * This is the measurement behind that sentence: three boards, every character,
 * five hull fractions each, counting what the bot's own tree decided to do.
 *
 * ── The three boards ───────────────────────────────────────────────────────
 *
 *  - **`doorstep`** — the bot on its own doorstep, one attacker standing on the
 *    station. `A0135_SIEGE=0` stops pinning the station's alarm, which makes the
 *    attacker a *silent trespasser* rather than one opening fire. Note what that
 *    control is and is not: it is **not** a quiet home. `HOME_ALARM_RANGE` (520)
 *    is wider than `THREAT_RANGE` (416), so anything near enough to frighten a
 *    bot standing at its own station is inside its own alarm ring by
 *    construction, and `ownHomeThreatened` reads TRUE on both settings. On this
 *    board the two settings are the *same ruling* reached down the two halves of
 *    one predicate, and printing both is how that is shown rather than asserted.
 *  - **`field`** — the bot caught 900u out in the field with a chaser on its
 *    tail and **nothing at all near its station**: the genuine home-not-threatened
 *    control, and the case a0-105 and a0-107 own. Nothing this brief does may
 *    move a single number on it.
 *  - **`field-siege`** — `field`, plus a second hostile on the home doorstep and
 *    the station under attack. This is the developer's frame exactly: the bot is
 *    out there, wounded, being chased, and its home is burning. *"He was scared
 *    to come engage."* Read the **closest** column: it is the answer to whether
 *    the bot came.
 *
 * ── Why the core is staged HEALTHY ─────────────────────────────────────────
 *
 * `last-stand` (`coreUnderFinalAssault`) already outranks the retreat, but it
 * only fires once the core is under `CORE_FINAL_ASSAULT` (0.3). The gap this
 * brief is about is the whole span **above** that line: the alarm is ringing,
 * the core is still healthy, and nothing in the tree stopped the flee latch from
 * winning. So the default pins the core at {@link HEALTHY_CORE} — and
 * `A0135_CORE=0.2` re-runs the same board under the last stand, as the control
 * that says the instrument can see the difference.
 *
 * WHAT IS COUNTED, per (board × character × hull):
 *
 *  - **retreat** — ticks whose winning leaf was `retreat` (`Brain.lastBehavior`),
 *    the bot's own account of running away;
 *  - **keeping** — ticks on a leaf that keeps the station: `defend`,
 *    `last-stand`, `turn-and-fight`, `cornered-fight`;
 *  - **mean / closest** — distance from its own station, world units, averaged
 *    over the run and at its minimum. Read the **mean**, not the peak: a
 *    defending bot is still `engage`-ing at a stand-off (`WEAPON_RANGE * 0.6`
 *    off the intruder, so ~560u off the station at the far end of a circle), so
 *    the peaks of "defending" and "fleeing" sit close together and only the mean
 *    tells them apart. On the field boards **closest** is the load-bearing one.
 *
 * The hull is pinned at its staged fraction and the siege never resolves (the
 * station's `sinceDamage` held at 0, its core at a fixed fraction), for the same
 * reason `tests/adversarial/antagonist.ts` pins them: an exit gated on the
 * situation ending cannot be measured while the situation is allowed to end.
 * Everything else is the real sim and the real tree — the bot flies wherever it
 * likes, on its own cadence, through its own fog.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/home-defence.ts
 *         A0135_BOARD=field npx vite-node evidence/a0-135-home-defence/home-defence.ts
 *         A0135_BOARD=field-siege npx vite-node evidence/a0-135-home-defence/home-defence.ts
 *         A0135_SIEGE=0 npx vite-node evidence/a0-135-home-defence/home-defence.ts
 *         A0135_CORE=0.2 npx vite-node evidence/a0-135-home-defence/home-defence.ts
 * Prints: the table to stdout (pasted into ./before-*.txt and ./after-*.txt, and
 *         into tests/reports/a0-135-home-defence.md).
 */

import { ShipClass } from '../../src/shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, WEAPON_RANGE, createWorld, step } from '../../src/sim';
import type { World } from '../../src/sim';
import { PERSONALITIES, botInputs, createBot } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';

/** Seconds of sim per cell. Twelve is well past every character's own standoff
 *  patience (the clamp is 5 s) and past every commitment window in the trees, so
 *  a bot that is going to come back has come back. */
const CEILING_S = Number(process.env.A0135_SECONDS ?? 12);

/** Core fraction the station is held at. Above `CORE_FINAL_ASSAULT` (0.3), so
 *  the `last-stand` branch is switched OFF and the only thing that can bring the
 *  bot home is the ruling this brief is about. */
const HEALTHY_CORE = Number(process.env.A0135_CORE ?? 0.8);

/** Is the station's alarm held on? `A0135_SIEGE=0` lifts the pin and leaves
 *  everything else identical. See the header on what that control means. */
const SIEGE = process.env.A0135_SIEGE !== '0';

type BoardId = 'doorstep' | 'field' | 'field-siege';
const BOARD = (process.env.A0135_BOARD ?? 'doorstep') as BoardId;

/** How far out in the field the bot is caught on the two `field` boards — a
 *  plausible way back, and the same 900u `src/bots/behaviors.test.ts` uses. */
const RUN_HOME = 900;

/** The hull fractions swept, the developer's own first. 5/70 is the brief's "not
 *  at 5/70" — the floor of the ruling, where a bot has the most reason to run
 *  and is still not allowed to. */
const HULLS: readonly [string, number][] = [
  ['25/70', 25 / 70],
  ['0.50', 0.5],
  ['0.35', 0.35],
  ['0.20', 0.2],
  ['5/70', 5 / 70],
];

/** Leaves that mean the bot is keeping its station. */
const KEEPING = new Set(['defend', 'last-stand', 'turn-and-fight', 'cornered-fight']);

interface Reading {
  retreat: number;
  keeping: number;
  meanAway: number;
  closest: number;
  first: string;
}

/**
 * Stage one board for one character at one hull fraction and run it to the
 * ceiling. Slot 0 is the bot; slot 1 is the ship in contact with it; slot 2 is
 * the one standing on its station.
 *
 * All three boards seat all three slots, so the world seed lays the stations out
 * identically and `field` and `field-siege` differ by **one thing only**. Slot 2
 * is not killed off on the boards that do not want it — a dead ship respawns
 * five seconds later (GDD §2.7) and would walk back onto the board mid-run — it
 * is parked on its **own** doorstep instead, where it is a hostile that is
 * plainly somewhere else. (The first cut of this file did kill it, and the
 * respawn then got pinned to the *subject's* doorstep by the line below, which
 * quietly turned the home-not-threatened control into a second siege board. The
 * `field` numbers moved and it took a tick-by-tick probe to find out why.)
 */
function measure(personality: PersonalityId, hull: number): Reading {
  const world: World = createWorld({
    seed: 20260822,
    players: [0, 1, 2].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
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
  const contact = world.ships[1]!;
  const raider = world.ships[2]!;

  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.hypot(dx, dy);
  const out = { x: dx / d, y: dy / d };

  /** Where the ship standing on the station stands: the same doorstep spot
   *  `tests/adversarial/antagonist.ts` puts its `siege-home` body-blocker. */
  const doorstep = {
    x: home.pos.x + out.x * (home.radius + 40),
    y: home.pos.y + out.y * (home.radius + 40),
  };

  const onDoorstep = BOARD === 'doorstep';
  const homeUnderAttack = SIEGE && (onDoorstep || BOARD === 'field-siege');
  /** Only `field-siege` wants a second hostile on the subject's station: on
   *  `doorstep` the ship in contact is already standing on it, and on `field`
   *  the whole point is that nothing is. */
  const raiderAtHome = BOARD === 'field-siege';
  const away = world.stations.find((s) => s.owner === 2)?.pos ?? { x: 0, y: 0 };

  if (onDoorstep) {
    me.pos = { x: home.pos.x, y: home.pos.y };
  } else {
    // Caught out in the field with the chaser on its tail, on the far side from
    // home — a tail, not a blockade (`./cornered` owns that other case).
    me.pos = { x: home.pos.x + out.x * RUN_HOME, y: home.pos.y + out.y * RUN_HOME };
  }
  me.vel = { x: 0, y: 0 };
  const pinnedHull = me.maxHull * hull;

  /** Where the ship in contact holds station, this tick. */
  const contactAt = onDoorstep
    ? doorstep
    : {
        x: home.pos.x + out.x * (RUN_HOME + WEAPON_RANGE * 0.7),
        y: home.pos.y + out.y * (RUN_HOME + WEAPON_RANGE * 0.7),
      };

  const bot = createBot({ id: 0, personality }, { seed: 3 });
  const reading: Reading = {
    retreat: 0,
    keeping: 0,
    meanAway: 0,
    closest: Number.POSITIVE_INFINITY,
    first: '—',
  };
  let sumAway = 0;
  let living = 0;

  for (let tick = 0; tick < Math.round(CEILING_S / TICK_DT); tick++) {
    if (me.alive) me.hull = pinnedHull;
    contact.pos = { ...contactAt };
    contact.vel = { x: 0, y: 0 };
    contact.hull = contact.maxHull;
    raider.pos = raiderAtHome ? { ...doorstep } : { ...away };
    raider.vel = { x: 0, y: 0 };
    raider.hull = raider.maxHull;
    if (homeUnderAttack && home.alive) {
      home.sinceDamage = 0;
      home.coreHp = home.maxCoreHp * HEALTHY_CORE;
    }
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);

    const leaf = bot.brain.lastBehavior;
    if (leaf === 'retreat') reading.retreat++;
    if (KEEPING.has(leaf)) reading.keeping++;
    if (reading.first === '—' && leaf !== 'dead') reading.first = leaf;
    if (me.alive) {
      const gone = Math.hypot(me.pos.x - home.pos.x, me.pos.y - home.pos.y);
      if (gone < reading.closest) reading.closest = gone;
      sumAway += gone;
      living++;
    }
  }
  reading.meanAway = living > 0 ? sumAway / living : 0;
  if (!Number.isFinite(reading.closest)) reading.closest = 0;
  return reading;
}

const ROSTER = Object.keys(PERSONALITIES) as PersonalityId[];
const TICKS = Math.round(CEILING_S / TICK_DT);
const WHAT: Record<BoardId, string> = {
  doorstep: 'the bot on its own doorstep, an attacker standing on the station',
  field: `the bot caught ${RUN_HOME}u out with a chaser on its tail, nothing near its station`,
  'field-siege': `the bot caught ${RUN_HOME}u out with a chaser on its tail, AND a raider on its station`,
};

console.log(`a0-135 — board \`${BOARD}\`: ${WHAT[BOARD]}`);
console.log(`station ${SIEGE ? 'UNDER ATTACK' : 'alarm not pinned (control)'}; core at ${HEALTHY_CORE} of max (last-stand fires below 0.3)`);
console.log(`ceiling ${CEILING_S}s = ${TICKS} ticks`);
console.log('');
console.log('character  tier    hull    retreat  keeping  mean away   closest  first leaf');
console.log('---------- ------- ------- -------- -------- ---------- --------- ----------');
for (const id of ROSTER) {
  for (const [label, hull] of HULLS) {
    const r = measure(id, hull);
    console.log(
      `${id.padEnd(10)} ${String(PERSONALITIES[id].difficulty).padEnd(7)} ${label.padEnd(7)} ` +
        `${String(r.retreat).padStart(8)} ${String(r.keeping).padStart(8)} ` +
        `${`${Math.round(r.meanAway)}u`.padStart(10)} ${`${Math.round(r.closest)}u`.padStart(9)}  ${r.first}`,
    );
  }
}
