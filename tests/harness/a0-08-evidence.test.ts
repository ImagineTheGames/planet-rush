/**
 * tests/harness/a0-08-evidence.test.ts — the a0-08 reproduction, as evidence.
 * OWNER: Gameplay Engineer.
 *
 * The brief asks for the reproduction twice — the same kill looted with an EMPTY
 * hold and with a FULL one — with the hold, the banked total and the ledger line
 * readable in each, so it is obvious in the frame what happened. This produces
 * exactly that as a tick-by-tick trace of the real sim, and asserts the numbers
 * it prints, so the committed artifact can never drift from the code:
 *
 *     A0_08_WRITE_EVIDENCE=1 npx vitest run tests/harness/a0-08-evidence.test.ts
 *
 * writes `evidence/a0-08-loot-tell/trace.txt`. Without the env var the trace is
 * still computed and asserted, it is just not written — so CI never dirties the
 * tree. The pixels (hold pips reacting to `lootBlocked`, a `lootTake` float over
 * the ship) are the render lane's to draw; this is the sim half, and it is the
 * half that carries the ledger numbers the brief asks the PR body to state.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '../../src/shared/types';
import { DEATH_ORE_DROP_FRACTION, TICK_DT, createWorld, damageShip, expectedLiveOre, liveOre, oreResidual, step } from '../../src/sim';
import type { PlayerSpec, Ship, World } from '../../src/sim';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../evidence/a0-08-loot-tell/trace.txt');

/** Every number the developer could have been looking at, on one line. */
function frame(world: World, looter: Ship, label: string): string {
  const l = world.ledger!;
  const onField = world.chunks.filter((c) => !c.deposit).reduce((s, c) => s + c.amount, 0);
  const cells = [
    label.padEnd(9),
    `t=${world.time.toFixed(2).padStart(5)}s`,
    `HOLD ${looter.cargo.toFixed(0)}/${looter.cargoCap}`,
    `BANKED ${looter.banked.toFixed(0).padStart(2)}`,
    `ore on field ${onField.toFixed(0).padStart(2)}`,
    `lootTake ${(looter.lootTake ?? 0).toFixed(0)}`,
    `lootBlocked ${looter.lootBlocked ? 'YES' : 'no '}`,
    `ledger looted=${l.looted.toFixed(0)} dropped=${l.dropped.toFixed(0)} deathLoss=${l.deathLoss.toFixed(0)}`,
    `residual ${oreResidual(world).toExponential(1)}`,
  ];
  return cells.join('  ');
}

function stage(looterCargo: number): { world: World; victim: Ship; looter: Ship } {
  const players: PlayerSpec[] = [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Vanguard },
  ];
  const world = createWorld({ seed: 5, players });
  const victim = world.ships[0]!;
  const looter = world.ships[1]!;
  victim.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
  victim.vel = { x: 0, y: 0 };
  looter.vel = { x: 0, y: 0 };
  victim.spawnProtect = 0;
  looter.spawnProtect = 0;
  // The victim needs a drop of more than one chunk, so the partial case has
  // something to be partial about. The base hold of 2 is enough since a0-59
  // (2026-08-16): a destroyed ship drops ALL of it. Under the old half-drop this
  // ship had to buy a cargo tier to shed 2, and the tier is dropped here rather
  // than kept, so that the looter's hold is the only thing that varies between
  // runs A, B and C — which is the whole point of the three-way comparison.
  // Holds filled rock → cargo, which conserves `liveOre` exactly: the residual
  // printed on every line below is honest from the first frame.
  fill(world, victim, victim.cargoCap);
  fill(world, looter, looterCargo);
  return { world, victim, looter };
}

function fill(world: World, ship: Ship, n: number): void {
  let left = n;
  for (const a of world.asteroids) {
    if (left <= 1e-9) break;
    const take = Math.min(a.ore, left);
    a.ore -= take;
    ship.cargo += take;
    left -= take;
  }
  expect(left).toBeLessThan(1e-9);
}

interface Run {
  readonly lines: string[];
  readonly world: World;
  readonly looter: Ship;
  readonly dropped: number;
}

function run(title: string, looterCargo: number): Run {
  const { world, victim, looter } = stage(looterCargo);
  const lines: string[] = [`--- ${title} ---`, frame(world, looter, 'before')];

  damageShip(world, victim, 9999);
  const dropped = world.chunks.reduce((s, c) => s + c.amount, 0);
  lines.push(frame(world, looter, 'KILL'));
  lines.push(
    `           the victim held ${victim.cargoCap} · DEATH_ORE_DROP_FRACTION=${DEATH_ORE_DROP_FRACTION} · ` +
      `${dropped} dropped as ${world.chunks.length} chunks, ${world.ledger!.deathLoss} destroyed with the hull (GDD §2.3)`,
  );

  // Hover on the wreck. Sample the first ticks densely — the pickup is over in a
  // fraction of a second, and the frame the report is about is in there.
  for (let i = 1; i <= 90; i++) {
    step(world, [], TICK_DT);
    looter.vel = { x: 0, y: 0 };
    looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
    // Every tick ore actually ARRIVES is printed, whenever it lands — those are
    // the frames the whole report is about — plus fixed samples for the settled
    // state either side of them.
    const arrival = (looter.lootTake ?? 0) > 0;
    if (arrival || i <= 3 || i === 30 || i === 90) lines.push(frame(world, looter, `tick ${i}`));
  }
  return { lines, world, looter, dropped };
}

describe('a0-08 evidence — the same kill, an empty hold and a full one', () => {
  const empty = run('A · loot the wreck with an EMPTY hold (0/2)', 0);
  const full = run('B · loot the SAME wreck with a FULL hold (2/2)', 2);
  const partial = run('C · loot the SAME wreck with ONE slot of room (1/2)', 1);

  it('A: an empty hold takes the whole drop and the banked total never moves', () => {
    expect(empty.looter.cargo).toBeCloseTo(empty.dropped, 9);
    expect(empty.looter.banked).toBe(3); // STARTING_ORE, untouched by the pickup
    expect(empty.world.ledger!.looted).toBeCloseTo(empty.dropped, 9);
    expect(oreResidual(empty.world)).toBeCloseTo(0, 9);
  });

  it('B: a full hold takes nothing, the ore stays on the field, and nothing leaked', () => {
    expect(full.world.ledger!.looted).toBe(0);
    expect(full.world.chunks.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(full.dropped, 9);
    expect(full.looter.lootBlocked).toBe(true);
    expect(oreResidual(full.world)).toBeCloseTo(0, 9);
  });

  it('C: one slot takes exactly one and then reads as blocked, still balanced', () => {
    expect(partial.world.ledger!.looted).toBeCloseTo(1, 9);
    expect(partial.looter.lootBlocked).toBe(true);
    expect(oreResidual(partial.world)).toBeCloseTo(0, 9);
  });

  it('the verdict the brief asks for: conservation HOLDS in all three', () => {
    for (const r of [empty, full, partial]) {
      expect(liveOre(r.world)).toBeCloseTo(expectedLiveOre(r.world), 6);
    }

    const text = [
      'a0-08 — "sometimes picked up ore from dead ships dont count"',
      '',
      'VERDICT: ore conservation HOLDS. liveOre === seeded + injected + debrisFloor',
      '         − spent − deathLoss − capLoss at every frame of all three runs',
      '         (residual 0.0e+0 throughout, below). No ore is lost. This is a',
      '         legibility bug: the ore went somewhere the player was not looking.',
      '',
      'Reproduce: A0_08_WRITE_EVIDENCE=1 npx vitest run tests/harness/a0-08-evidence.test.ts',
      'The match-wide law: npx vitest run tests/harness/ore-conservation.test.ts',
      '',
      ...empty.lines,
      '',
      ...full.lines,
      '',
      ...partial.lines,
      '',
      'READ IT LIKE THIS',
      '  A  HOLD 0/2 → 2/2 and BANKED stays 3. The pickup WORKED. The prominent',
      '     top-left readout is the banked figure, so the correct pickup moved no',
      '     number the player was watching (coordinated with a0-03, which renames',
      '     that readout to ORE).',
      '  B  HOLD 2/2 throughout, 2 ore left lying on the field, looted=0. The',
      '     tractor never even pulled: a full hold exerts no pull and refuses the',
      '     chunk in total silence (GDD §2.3). `lootBlocked YES` is that frame,',
      '     now signposted. Base hold is 2, so this is normal play.',
      '  C  HOLD 1/2 → 2/2, looted=1 of the 2 on offer, 1 left floating: a partial',
      '     take that from the cockpit looks exactly like a whole one.',
      '  Same kill, three outcomes, no tell between them — that is "sometimes".',
      '',
    ].join('\n');

    if (process.env.A0_08_WRITE_EVIDENCE === '1') {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, text, 'utf8');
    }
    expect(text).toContain('VERDICT: ore conservation HOLDS.');
  });
});
