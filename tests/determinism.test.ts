/**
 * tests/determinism.test.ts — the determinism replay test. OWNER: QA Agent
 * (GDD §4.1, §4.8; wired as a real CI step in `.github/workflows/ci.yml`).
 *
 * > "Determinism policy: netcode is authoritative state-sync, not lockstep;
 * > determinism is asserted **per build by a CI replay test (same inputs, same
 * > final state hash)**, with a table-based math fallback if it ever fails."
 * > — GDD §4.1
 *
 * This file is that assertion. It is not a smoke test with a hash bolted on: it
 * records a real eight-slot bot-vs-bot match tick by tick, rebuilds the world
 * **from the seed**, replays the recorded input stream into it, and compares the
 * full-state hash (`harness/hash.ts` — every ship, rock, chunk, planet, turret,
 * shield, build job, projectile, and the match clock).
 *
 * Three properties are asserted, and the third is the one that makes the first
 * two mean anything:
 *
 *  1. **Replay reproduces the run.** Same seed + same inputs ⇒ same final hash.
 *  2. **Construction is deterministic.** Two worlds built from one config are
 *     identical before a single tick — so a replay failure is a *step* failure,
 *     never a spawn failure wearing its coat.
 *  3. **The hash can actually fail.** A one-tick difference, a different seed,
 *     and a single altered field each produce a different hash. A determinism
 *     test whose hash cannot distinguish two worlds passes forever and proves
 *     nothing; these are the negative controls.
 *
 * Deliberately sized for CI: 60 sim-seconds of a full eight-slot match (~3 600
 * ticks) runs in well under a second and exercises every subsystem — waves,
 * beams, mining, chunks, construction, turret fire, and elimination.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step } from '../src/sim';
import { digestDiff, hashState, stateDigest } from '../harness/hash';
import { buildWorld, recordMatch, replay, roundRobinLineup } from '../harness/match';
import type { MatchSetup } from '../harness/match';

/** The recorded match: four probes round-robin across eight seats, one hull, so
 *  every subsystem the sim has is exercised by somebody. */
const SETUP: MatchSetup = {
  seed: 20260724,
  lineup: roundRobinLineup([
    { strategy: 'miner', shipClass: ShipClass.Vanguard },
    { strategy: 'turtle', shipClass: ShipClass.Excavator },
    { strategy: 'rusher', shipClass: ShipClass.Interceptor },
    { strategy: 'raider', shipClass: ShipClass.Hauler },
  ]),
};

/** Sim seconds recorded. Long enough to cover construction (15 s shields) and
 *  the first eliminations; short enough that CI never notices. */
const RECORD_SECONDS = 60;

describe('determinism replay — same inputs, same final state hash (GDD §4.8)', () => {
  const run = recordMatch(SETUP, { maxSeconds: RECORD_SECONDS });

  it('records a real match rather than an idle one', () => {
    // A replay test over a world where nothing happened would pass forever.
    expect(run.recording.inputs.length).toBeGreaterThan(1000);
    expect(run.result.world.chunks.length + run.result.world.projectiles.length).toBeGreaterThan(0);
    expect(run.result.world.time).toBeGreaterThan(RECORD_SECONDS - 1);
  });

  it('replays to the same final state hash', () => {
    const again = replay(run.recording);
    const before = stateDigest(run.result.world);
    const after = stateDigest(again.world);
    // The diff is in the failure message, not just the two hashes: a desync
    // that only says "8f3a2b1c != 2d09ffae" costs an afternoon to localize.
    expect(digestDiff(before, after)).toEqual([]);
    expect(after.hash).toBe(before.hash);
  });

  it('replays identically twice — the replay itself is deterministic', () => {
    expect(replay(run.recording).hash).toBe(replay(run.recording).hash);
  });

  it('builds an identical world from the same setup, before any stepping', () => {
    expect(hashState(buildWorld(SETUP))).toBe(hashState(buildWorld(SETUP)));
  });
});

describe('the state hash can fail (negative controls)', () => {
  const players = [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Vanguard },
  ];

  it('differs after one more tick', () => {
    const w = createWorld({ seed: 4, players });
    const before = hashState(w);
    step(w, []);
    expect(hashState(w)).not.toBe(before);
  });

  it('differs for a different seed', () => {
    expect(hashState(createWorld({ seed: 4, players }))).not.toBe(
      hashState(createWorld({ seed: 5, players })),
    );
  });

  it('differs when a single ship field moves by more than float noise', () => {
    const w = createWorld({ seed: 4, players });
    const before = hashState(w);
    w.ships[0]!.pos.x += 0.001;
    expect(hashState(w)).not.toBe(before);
  });

  it('differs when a planet takes a single point of core damage', () => {
    const w = createWorld({ seed: 4, players });
    const before = hashState(w);
    w.planets[0]!.coreHp -= 1;
    expect(hashState(w)).not.toBe(before);
  });

  it('differs when the elimination order differs — the last-to-die tiebreak', () => {
    const a = createWorld({ seed: 4, players });
    const b = createWorld({ seed: 4, players });
    a.match.eliminated.push(0, 1);
    b.match.eliminated.push(1, 0);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('is stable across repeated reads of one world', () => {
    const w = createWorld({ seed: 4, players });
    expect(hashState(w)).toBe(hashState(w));
  });
});
