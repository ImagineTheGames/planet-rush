/**
 * evidence/a0-52-ore-underpay/probe.mjs — the two readings of "i had 2 ore",
 * run rather than argued.
 *
 *   npx vite-node evidence/a0-52-ore-underpay/probe.mjs
 *
 * a0-52 arrived as a sentence and two screenshots: *"i had 2 ore and was able to
 * build a turret"*, an Upgrade wheel with `4` in the hub and a CARGO wedge reading
 * `2 → 4` at cost `2`, and — after the build — a Build wheel hub reading `0 ORE`
 * with `1 / 4 BUILT`. `TURRET.cost` is 3. The playtest log carried no economy
 * events, so there was nothing to read.
 *
 * This prints what there was nothing to read. Three runs against the real
 * simulation, each ending on a screenshot's exact numbers, with the ore journal
 * (`src/sim/ore-journal`, added by this brief) printed line by line underneath:
 *
 *   A. the brief's innocent sequence — 5 ore, cargo upgrade, turret;
 *   B. the reading that explains the literal `2` — the top-left `ORE` readout is
 *      the BANK ALONE (GDD §2.2), so a player holding 1 + 2 is looking at a `2`
 *      while the wheel's hub correctly reads a spendable 3;
 *   C. the underpay itself, attempted — a turret ordered on exactly `cost - 1`,
 *      in each of the three ways a wallet can hold it.
 *
 * A and B both end where the screenshots end. C is refused every time, and the
 * overdraft alarm — the pre-clamp reading that would be the only surviving trace
 * of a real underpay — stays empty. That is the finding.
 */

import { ShipClass, UpgradeTrack } from '../../src/shared/types.ts';
import {
  STATION,
  TURRET,
  buyUpgrade,
  createWorld,
  drainOreJournal,
  oreEventLine,
  oreOverdrafts,
  placeOrder,
  spendableOre,
  trackSpec,
} from '../../src/sim/index.ts';

const CFG = { seed: 0xa052, players: [{ id: 0, shipClass: ShipClass.Vanguard }], asteroidCount: 4 };

/** A world with the local ship parked on its own station and a wallet set by hand. */
function docked(hold, bank) {
  const world = createWorld(CFG);
  const station = world.stations.find((s) => s.owner === 0);
  const ship = world.ships.find((s) => s.id === 0);
  ship.pos = { ...station.pos };
  ship.vel = { x: 0, y: 0 };
  ship.cargo = hold;
  ship.banked = bank;
  return { world, ship, station };
}

/** What the two on-screen ore readouts say, side by side (GDD §2.2, a0-03). */
const readouts = (ship) => `HUD top-left ORE (bank alone): ${ship.banked} | wheel hub (hold+bank): ${spendableOre(ship)}`;
const built = (station) => station.turrets.length + station.builds.length;

function dump(world) {
  for (const event of drainOreJournal(world)) console.log(`      ${oreEventLine(event)}`);
}

console.log(`dock range ${STATION.dockRange} · TURRET.cost ${TURRET.cost} · CARGO tier 1 costs ${trackSpec(UpgradeTrack.Cargo).costs[0]}\n`);

// --- A. the brief's innocent sequence ---------------------------------------
{
  // 2 in the hold and 3 banked, not 5 in the hold: the stock hold is 2 SLOTS, so
  // a player with 5 ore is a player who has banked most of it. That is the whole
  // reason the two readouts differ, and why the sequence is worth running rather
  // than doing in your head.
  console.log('A. 5 ore (2 held, 3 banked) → CARGO upgrade (-2) → TURRET (-3)');
  const { world, ship, station } = docked(2, 3);
  console.log(`   hold cap ${ship.cargoCap} — the "2" in the wedge's "2 → 4"`);
  console.log(`   ${buyUpgrade(world, ship, UpgradeTrack.Cargo)} · cap now ${ship.cargoCap} — the "→ 4", a CAPACITY, never a balance`);
  console.log(`   ${placeOrder(world, ship, 'turret')}`);
  console.log(`   ends: ${spendableOre(ship)} ORE · ${built(station)} / ${TURRET.capPerStation} BUILT   <-- the second screenshot`);
  dump(world);
  console.log(`   overdrafts: ${oreOverdrafts(world).length}\n`);
}

// --- B. the reading that explains the literal "2" ---------------------------
{
  console.log('B. 1 in the hold, 2 in the bank — "i had 2 ore", read off the HUD');
  const { world, ship, station } = docked(1, 2);
  console.log(`   ${readouts(ship)}`);
  console.log(`   ${placeOrder(world, ship, 'turret')}`);
  console.log(`   ends: ${spendableOre(ship)} ORE · ${built(station)} / ${TURRET.capPerStation} BUILT   <-- the same screenshot`);
  dump(world);
  console.log(`   overdrafts: ${oreOverdrafts(world).length}\n`);
}

// --- C. the underpay, attempted ---------------------------------------------
{
  console.log(`C. a turret ordered on exactly ${TURRET.cost - 1} ore, three ways`);
  for (const [hold, bank] of [
    [TURRET.cost - 1, 0],
    [0, TURRET.cost - 1],
    [(TURRET.cost - 1) / 2, (TURRET.cost - 1) / 2],
  ]) {
    const { world, ship, station } = docked(hold, bank);
    const verdict = placeOrder(world, ship, 'turret');
    console.log(
      `   hold ${hold} bank ${bank} -> ${verdict} · wallet now ${ship.cargo}/${ship.banked} · ` +
        `${built(station)} built · overdrafts ${oreOverdrafts(world).length}`,
    );
    dump(world);
  }
}
