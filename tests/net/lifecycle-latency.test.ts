/**
 * tests/net/lifecycle-latency.test.ts — **the t=63 s signature, as a gate.**
 * OWNER: Netcode Engineer (M10, item 1 of the developer's gru playtest).
 *
 * *"At t=63 s corr jumps 0.5 → 288 → 509 units with mispred=1.0 for FIVE SECONDS,
 * one snap that does not take."* Five seconds is `RESPAWN_S` exactly, and that is the
 * whole diagnosis: the server killed and respawned the ship, the client kept
 * predicting a ship authority had lying at a death site, and no amount of
 * reconciliation could close a gap between two sims that were no longer simulating
 * the same ship. The same shape appears again at t=38 s in the RXS3 capture — two
 * independent recordings of one fault.
 *
 * The brief asks for that signature to *become a regression assertion on the latency
 * harness*, and this is it: the full two-client match on the shipping stack (real
 * server, real room, real codec, real sessions, real prediction and presentation),
 * with a death injected at a named instant and the correction, misprediction rate and
 * snap counter read off the same instrument the developer's log came from.
 *
 * Run at both ends of the acceptance range, 100 ms and 250 ms, because the fault's
 * cost scaled with the round trip: the client flew its ghost for the whole respawn
 * window either way, but the correction it fought was the distance the two ships had
 * drifted apart, and that grows with latency.
 */

import { describe, expect, it } from 'vitest';
import { RESPAWN_S, TICK_DT } from '../../src/sim';
import { SNAP_THRESHOLD } from '../../src/net/prediction';
import { MISPREDICTION_UNITS } from '../../src/net/telemetry';
import { runLatencyMatch } from './latency-harness';
import type { HarnessClient, LatencyMatchResult } from './latency-harness';
import { netBudget } from './budgets';

/** The two wires the M10 acceptance gate names. Clean, because a death is what is
 *  under test here and retransmit stalls are gated in `./latency-feel.test.ts`. */
const WIRES = [
  { name: '100 ms', profile: { rttMs: 100, jitterMs: 0, lossRate: 0 } },
  { name: '250 ms', profile: { rttMs: 250, jitterMs: 30, lossRate: 0 } },
];

/** The victim's slot. Client 0 flies it, so this run tests the *local* half of the
 *  fault — the ghost, the correction war, and the countdown a player has to see. */
const VICTIM = 0;

/** The death lands ten seconds in, leaving room either side: long enough for the
 *  client's lead and jitter buffer to have settled, and long enough after the respawn
 *  to prove the ship comes back and stays converged. */
const KILL_AT_S = 10;
const RUN_S = KILL_AT_S + Math.ceil(RESPAWN_S) + 6;

/**
 * The developer's signature, per second, from the same numbers the pasted log carries
 * (`src/net/telemetry`): a sustained correction with the misprediction rate pinned at
 * 1.0. One second of that is a death being reported; five in a row is the fault.
 */
function signatureSeconds(client: HarnessClient, fromMs: number): number {
  let worst = 0;
  let run = 0;
  for (const s of client.telemetry.samples) {
    if (s.atMs < fromMs || s.reconciles === 0) continue;
    const pinned = s.mispredictionRate >= 1 && s.correctionMaxUnits > 100;
    run = pinned ? run + 1 : 0;
    if (run > worst) worst = run;
  }
  return worst;
}

describe('a death at latency (M10 item 1: the t=63 s signature)', () => {
  for (const wire of WIRES) {
    describe(wire.name, () => {
      /** One match with a scripted death, and the frames each client's own ship spent
       *  dead / counting down, sampled off the *presented* world every frame. */
      function run(): {
        result: LatencyMatchResult;
        deadFrames: number;
        countdownFrames: number;
        countdownOpenedAt: number | null;
        countdownMonotonic: boolean;
      } {
        let deadFrames = 0;
        let countdownFrames = 0;
        let countdownOpenedAt: number | null = null;
        let countdownMonotonic = true;
        let lastCountdown = Number.POSITIVE_INFINITY;
        const result = runLatencyMatch({
          profile: wire.profile,
          frames: RUN_S * 60,
          kill: { atFrame: KILL_AT_S * 60, player: VICTIM },
          onFrame: (frame, clients) => {
            const ship = clients[VICTIM]!.world?.ships.find((s) => s.id === VICTIM);
            if (!ship) return;
            if (!ship.alive) deadFrames++;
            // The countdown the death presentation reads is `Ship.respawnTimer` —
            // the same field an offline match shows, which is the parity the brief
            // asks for (`src/ui/respawn-countdown.ts`, GDD §2.7, §2.4).
            if (!ship.alive && ship.respawnTimer > 0) {
              countdownFrames++;
              countdownOpenedAt ??= frame;
              if (ship.respawnTimer > lastCountdown + 1e-6) countdownMonotonic = false;
              lastCountdown = ship.respawnTimer;
            }
          },
        });
        return { result, deadFrames, countdownFrames, countdownOpenedAt, countdownMonotonic };
      }

      it('stops predicting the dead ship, and the correction never becomes a snap', () => {
        const { result, deadFrames } = run();
        const client = result.clients[VICTIM]!;
        const killedAtMs = result.killedAtMs;
        expect(killedAtMs).not.toBeNull();

        const respawnFrames = RESPAWN_S / TICK_DT;
        // The client honoured the death for most of the respawn window — not for the
        // one or two frames it took to revive the ship locally, which is what the old
        // client did (and is why `mispred` sat at 1.0 for five seconds afterwards).
        expect(deadFrames).toBeGreaterThan(respawnFrames * 0.7);
        // …and the ship came back. A corpse that never revives is the same bug facing
        // the other way.
        const ship = client.world?.ships.find((s) => s.id === VICTIM);
        expect(ship?.alive).toBe(true);

        // The signature itself, over every second from the death onward.
        const after = client.telemetry.samples.filter((s) => s.atMs >= killedAtMs!);
        expect(after.length).toBeGreaterThan(Math.ceil(RESPAWN_S));
        const worstCorrection = Math.max(...after.map((s) => s.correctionMaxUnits));
        const snaps = after.reduce((n, s) => n + s.visualSnaps, 0);

        // eslint-disable-next-line no-console
        console.log(
          `    death at ${wire.name}: dead ${deadFrames}f  ` +
            `worst corr ${worstCorrection.toFixed(1)}u  snaps ${snaps}  ` +
            `signature ${signatureSeconds(client, killedAtMs!)}s`,
        );

        // No *misprediction* was ever big enough to teleport the ship: the whole
        // fault was a correction the client could not converge, and the worst one
        // here is under the wire's own quantization floor.
        expect(worstCorrection).toBeLessThan(SNAP_THRESHOLD);
        // At most one visual snap, and if there is one it is the **respawn** — a hull
        // that really did move from a death site to its home station, which
        // `SNAP_THRESHOLD` exists to leave unsmoothed ("a respawn or a genuine
        // teleport", `src/net/prediction`). The capture's *"one snap that does not
        // take"* is a different animal: a snap followed by the divergence continuing,
        // which is what the settling assertion below rules out.
        expect(snaps).toBeLessThanOrEqual(1);
        if (snaps === 1) {
          const snapped = after.filter((s) => s.visualSnaps > 0);
          const revivalMs = killedAtMs! + RESPAWN_S * 1000;
          expect(Math.abs(snapped[0]!.atMs - revivalMs)).toBeLessThanOrEqual(1500);
        }
        // And the sustained-misprediction run is gone. One second of raised
        // correction as the news crosses the wire is honest; the fault was five.
        expect(signatureSeconds(client, killedAtMs!)).toBeLessThan(2);
      }, netBudget({
        work: 'one scripted match with a death at t=63 s → assert the client stops predicting the corpse and never snaps',
        measuredSeconds: 2.2,
      }));

      it('settles back to a quiet wire once the news has crossed it', () => {
        const { result } = run();
        const client = result.clients[VICTIM]!;
        // Two seconds after the respawn, the correction is back to what the same
        // client was reconciling before anyone died — a death costs a correction while
        // its news is in flight, and nothing afterwards.
        const settledFromMs = result.killedAtMs! + (RESPAWN_S + 2) * 1000;
        const settled = client.telemetry.samples.filter(
          (s) => s.atMs >= settledFromMs && s.reconciles > 0,
        );
        expect(settled.length).toBeGreaterThan(1);
        for (const s of settled) {
          // The wire's own quantization floor is the bar a *correct* prediction sits
          // under (`src/net/telemetry` MISPREDICTION_UNITS); allow a couple of those.
          expect(s.correctionMaxUnits).toBeLessThan(8 * MISPREDICTION_UNITS);
        }
      }, netBudget({
        work: 'one scripted match with a death → assert the correction settles once the news has crossed the wire',
        measuredSeconds: 1.2,
      }));

      it('runs the respawn countdown the offline flow runs', () => {
        const { countdownFrames, countdownOpenedAt, countdownMonotonic } = run();
        // The countdown is *visible* — the whole respawn window bar the round trip its
        // news spends on the wire — so the player is told what is happening rather
        // than watching a frozen hull.
        const respawnFrames = RESPAWN_S / TICK_DT;
        expect(countdownFrames).toBeGreaterThan(respawnFrames * 0.7);
        expect(countdownOpenedAt).not.toBeNull();
        // It opens within a round trip of the death and never runs backwards, however
        // many times the world is rewound and replayed over it
        // (`src/net/prediction` `holdLifecycle`).
        const roundTripFrames = Math.ceil(wire.profile.rttMs / (TICK_DT * 1000)) + 2;
        expect(countdownOpenedAt!).toBeLessThanOrEqual(KILL_AT_S * 60 + roundTripFrames);
        expect(countdownMonotonic).toBe(true);
      }, netBudget({
        work: 'one scripted match with a death → assert the online countdown is the offline one',
        measuredSeconds: 1.0,
      }));

      it('shows the other client a corpse, not a ship flying itself home', () => {
        const observer = 1 - VICTIM;
        let drawnAlive = 0;
        let drawnDead = 0;
        const result = runLatencyMatch({
          profile: wire.profile,
          frames: RUN_S * 60,
          kill: { atFrame: KILL_AT_S * 60, player: VICTIM },
          onFrame: (frame, clients) => {
            // The *presented* world, which is what this client's screen shows: the
            // rival's hull is drawn one interpolation delay in the past, and since the
            // M10 lifecycle pass its life is drawn from the same instant
            // (`src/net/presentation`).
            const rival = clients[observer]!.world?.ships.find((s) => s.id === VICTIM);
            if (!rival) return;
            // Sampled over the middle of the respawn window, clear of both edges'
            // round trips.
            const from = KILL_AT_S * 60 + 60;
            const to = KILL_AT_S * 60 + (RESPAWN_S - 1) * 60;
            if (frame < from || frame > to) return;
            if (rival.alive) drawnAlive++;
            else drawnDead++;
          },
        });
        expect(result.killedAtMs).not.toBeNull();
        // Every sampled frame of the respawn window, the rival read as dead on the
        // observer's screen. *"Dead enemies linger"* was this the other way round: a
        // corpse the client had quietly revived and went on drawing for five seconds.
        expect(drawnDead).toBeGreaterThan(0);
        expect(drawnAlive).toBe(0);
      }, netBudget({
        work: 'one scripted match with a death → assert the rival\'s screen shows a corpse, not a ship flying itself home',
        measuredSeconds: 1.4,
      }));
    });
  }
});
