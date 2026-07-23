/**
 * src/net/spike/spike.bench.test.ts — runs the day-0 netcode spike and prints
 * the MEASUREMENTS block for docs/netcode-spike.md (GDD §4.2; risks 3 & 4).
 *
 * Assertions guard only structural invariants (wire size, encode round-trip,
 * that the benchmark actually ran) — NOT wall-clock thresholds, so this stays
 * green on any CI runner regardless of load. The timing numbers are logged, not
 * asserted; the doc records the numbers from a real run.
 *
 * Reproduce / regenerate the doc numbers: `npx vitest run src/net/spike`.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeSnapshot,
  decodeSnapshot,
  buildWorstCaseSnapshot,
  WORST_CASE_BYTES,
  HEADER_BYTES,
  SHIP_BYTES,
  PROJECTILE_BYTES,
  MAX_SHIPS,
  MAX_PROJECTILES,
} from './snapshot';
import { runBench, formatReport } from './bench';

describe('binary snapshot layout', () => {
  it('worst case is the GDD entity cap and stays well under the 2 KB assumption', () => {
    expect(WORST_CASE_BYTES).toBe(
      HEADER_BYTES + MAX_SHIPS * SHIP_BYTES + MAX_PROJECTILES * PROJECTILE_BYTES,
    );
    expect(buildWorstCaseSnapshot().byteLength).toBe(WORST_CASE_BYTES);
    // GDD risk 4 assumed ~2 KB snapshots — the measured worst case is far under.
    expect(WORST_CASE_BYTES).toBeLessThan(2048);
  });

  it('round-trips ship and projectile records through the wire format', () => {
    const ships = [
      { id: 3, posX: 1200, posY: -800, velX: 90, velY: -40, heading: 40000, aim: 12345, hull: 61, flags: 0b101 },
    ];
    const projectiles = [
      { id: 7, posX: -300, posY: 250, meta: (5 & 0x7) | (2 << 3) },
    ];
    const decoded = decodeSnapshot(encodeSnapshot(4242, ships, projectiles));
    expect(decoded.tick).toBe(4242);
    expect(decoded.ships).toEqual(ships);
    expect(decoded.projectiles).toEqual(projectiles);
  });
});

describe('tick-rate + bandwidth benchmark', () => {
  it('runs and reports a sustainable rate on this hardware', () => {
    const result = runBench();

    // Emit the block that docs/netcode-spike.md records.
    // eslint-disable-next-line no-console
    console.log('\n===== NETCODE SPIKE — MEASUREMENTS =====\n' + formatReport(result) + '\n');

    expect(result.rates).toHaveLength(3);
    for (const r of result.rates) {
      expect(Number.isFinite(r.avgTickMs)).toBe(true);
      expect(r.avgTickMs).toBeGreaterThan(0);
      expect(r.ticks).toBe(r.hz * result.simSeconds);
      // Live snapshot never exceeds the worst case we bill bandwidth against.
      expect(r.snapshotBytesLive).toBeLessThanOrEqual(WORST_CASE_BYTES);
      expect(r.broadcastHz).toBeLessThanOrEqual(30);
    }
  });
});
