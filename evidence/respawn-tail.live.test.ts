/**
 * evidence/respawn-tail.live.test.ts — WHICH TERM IS FROZEN.
 * OWNER: QA Manager.
 *
 * The `online-feel` gate fails on three of the audit's six thresholds, and every
 * breaching second of it sits inside one window: the ~5 s after a death, in which
 * the telemetry charges the SAME correction — 1281.442 u in the diagnose run,
 * unchanged to three decimals — once per reconcile, roughly 150 times, while the
 * sampled ship provably sits still at its home spawn.
 *
 * `feel-diagnose.live.test.ts` established WHAT the window is (a death and a
 * respawn) and that the ship is stable inside it. It could not say why the
 * accounting keeps re-charging, and the round carried that as UNKNOWN rather than
 * guess at it.
 *
 * This instrument answers it by watching the subtraction itself. `prediction.ts`
 * computes the number the gate is failed on in one place (`reconcile`, :400-406):
 *
 *     this.error = checkpoint && authoritative
 *       ? Math.hypot(checkpoint.x - authoritative.posX, checkpoint.y - authoritative.posY)
 *       : 0;
 *
 * Two terms. `checkpoint` is this client's OWN recorded position at the snapshot's
 * tick, found in `history` by `rewind()`; `authoritative` is the server's ship in
 * that snapshot. A result that repeats to three decimals means at least one term
 * is not moving. Which one it is decides who owns the fix and what the fix is, so
 * this probe records BOTH, per reconcile, across a real death on the live fleet —
 * by wrapping the shipped `reconcile` and reading the predictor's own fields
 * before and after it runs. Nothing is stubbed and nothing is modified: the game
 * code is the code, and this only looks at it.
 *
 * Run: npx vitest run --config evidence/vitest.live.config.ts evidence/respawn-tail.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '@shared/types';
import type { World } from '../src/sim';
import { allocateRoom } from '../src/net/allocator-client';
import type { AllocatorClientConfig, ResolvedConnection } from '../src/net/allocator-client';
import { allocatorTransport, createOnlineSession } from '../src/net/session';
import type { OnlineSession } from '../src/net/session';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
const ALLOCATOR = process.env.QA_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
const client: AllocatorClientConfig = { baseUrl: ALLOCATOR, fetch };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** The audit's `MAX_CORRECTION_UNITS` (docs/netcode-audit.md §5). */
const MAX_CORRECTION_UNITS = 4;
/** How long to fly before giving up on dying. Bots killed the diagnose run at ~52 s. */
const FLY_MS = Number(process.env.QA_FLY_MS ?? 100_000);

function connOf(result: Awaited<ReturnType<typeof allocateRoom>>): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}

/** The live machine-pin is a coin flip on the deployed fleet (MATCH_ROUTER is not
 *  armed in the running Machines), so a welcome takes as many dials as it takes. */
async function connectWelcomed(conn: ResolvedConnection, maxDials = 25): Promise<OnlineSession> {
  for (let dial = 1; dial <= maxDials; dial++) {
    const seen: string[] = [];
    const session = createOnlineSession({
      url: conn.url,
      room: conn.room,
      shipClass: ShipClass.Interceptor,
      transport: allocatorTransport(conn, client) as never,
    });
    session.observe((m) => seen.push(m.type));
    const t0 = Date.now();
    while (Date.now() - t0 < 4_000 && !seen.includes('welcome')) await sleep(80);
    if (seen.includes('welcome')) return session;
    session.close();
    await sleep(150);
  }
  throw new Error(`never welcomed after ${maxDials} dials (live machine-pin miss)`);
}

interface Rec {
  n: number;
  ms: number;
  snapTick: number;
  /** Was there a history entry AT the snapshot's tick — i.e. did `rewind` find one. */
  histHit: boolean;
  histLen: number;
  histFirstTick: number | null;
  histLastTick: number | null;
  /** Term 1: this client's own recorded position at the snapshot's tick. */
  cp: { x: number; y: number } | null;
  /** Term 2: authority's ship in that snapshot (quantized ints on the wire). */
  auth: { x: number; y: number } | null;
  /** Is the local ship in the snapshot at all — a dead ship may not be. */
  authPresent: boolean;
  /** The predicted world's own ship, read before the reconcile ran. */
  world: { x: number; y: number; alive: boolean; hull: number } | null;
  queueLen: number;
  error: number;
  applied: boolean;
  resynced: boolean;
  snapped: boolean;
}

describe('the post-respawn correction tail', () => {
  it('records BOTH terms of the correction across a real death, and names the frozen one', async () => {
    const a = connOf(await allocateRoom(client, {}));
    const session = await connectWelcomed(a);
    session.startMatch();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && session.world === null) await sleep(100);
    if (!session.world) throw new Error('the live match never started');
    const seat = session.you;

    // Wrap the SHIPPED reconcile. TypeScript's `private` is a compile-time rule,
    // so the predictor's own `history` and `local` are readable at runtime — this
    // reads them, and changes nothing.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const pred = session.prediction as any;
    const original = pred.reconcile.bind(pred);
    const recs: Rec[] = [];
    const t0 = Date.now();
    let n = 0;
    pred.reconcile = (snapshot: any, ackSeq: number) => {
      const history = pred.history as { tick: number; x: number; y: number }[];
      const found = history.find((c) => c.tick === snapshot.tick) ?? null;
      const auth = snapshot.ships.find((s: any) => s.id === pred.local) ?? null;
      const w = pred.world as World;
      const me = w.ships.find((s) => s.id === pred.local) ?? null;
      const before: Omit<Rec, 'error' | 'applied' | 'resynced' | 'snapped'> = {
        n: n++,
        ms: Date.now() - t0,
        snapTick: snapshot.tick,
        histHit: found !== null,
        histLen: history.length,
        histFirstTick: history.length ? history[0]!.tick : null,
        histLastTick: history.length ? history[history.length - 1]!.tick : null,
        cp: found ? { x: +found.x.toFixed(3), y: +found.y.toFixed(3) } : null,
        auth: auth ? { x: auth.posX, y: auth.posY } : null,
        authPresent: auth !== null,
        world: me
          ? { x: Math.round(me.pos.x), y: Math.round(me.pos.y), alive: me.alive, hull: Math.round(me.hull) }
          : null,
        queueLen: (pred.queue as unknown[]).length,
      };
      const report = original(snapshot, ackSeq);
      recs.push({
        ...before,
        error: +report.error.toFixed(3),
        applied: report.applied,
        resynced: report.resynced,
        snapped: report.snapped,
      });
      return report;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Fly at the sim's own rate — a slow cadence leaves the history empty and every
    // snapshot resyncs instead of correcting (feel-diagnose learned that the hard
    // way). Fire held down so the bots answer and the death actually happens.
    const dirs = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    let frame = 0;
    const flying = setInterval(() => {
      const d = dirs[Math.floor(frame / 300) % 4]!;
      frame++;
      session.sendInput([
        { type: 'thrust', dir: d },
        { type: 'fire', active: true, auto: true },
      ] as never);
    }, 33);

    // Stop once the interesting thing has been seen AND enough tail recorded to
    // characterise it. The trigger is a breach OR a death: if the defect is fixed
    // there will be no breach, and a probe that only watched for breaches would
    // fly the whole budget and then report a death-free run as evidence.
    const flyUntil = Date.now() + FLY_MS;
    let triggeredAt: number | null = null;
    while (Date.now() < flyUntil) {
      if (triggeredAt === null) {
        const hit = recs.find(
          (r) =>
            (r.applied && r.error > MAX_CORRECTION_UNITS) || (r.world !== null && !r.world.alive),
        );
        if (hit) triggeredAt = hit.n;
      } else if (recs.length > triggeredAt + 260) break;
      await sleep(100);
    }
    clearInterval(flying);

    const applied = recs.filter((r) => r.applied);
    const breaches = applied.filter((r) => r.error > MAX_CORRECTION_UNITS);
    const first = breaches[0] ?? null;

    // The window: from just before the first breach to well past the last one.
    const lo = first ? Math.max(0, first.n - 6) : 0;
    const last = breaches.length ? breaches[breaches.length - 1]!.n : 0;
    const window = recs.filter((r) => r.n >= lo && r.n <= last + 12);

    // Which term is frozen? Over the breaching reconciles, count how many DISTINCT
    // values each side of the subtraction took. A frozen term shows exactly one.
    const key = (p: { x: number; y: number } | null): string => (p ? `${p.x},${p.y}` : 'null');
    const cpValues = [...new Set(breaches.map((r) => key(r.cp)))];
    const authValues = [...new Set(breaches.map((r) => key(r.auth)))];
    const worldValues = [...new Set(breaches.map((r) => key(r.world)))];
    const errValues = [...new Set(breaches.map((r) => r.error))];

    // DID THE SHIP ACTUALLY DIE? Without this the probe is unfalsifiable: a run
    // with zero breaches reads identically whether the defect is fixed or whether
    // the bots simply never killed anyone, and those are opposite conclusions.
    // `world.alive` is read off the predicted world before every reconcile, so a
    // death is a true→false edge in that column.
    const withShip = recs.filter((r) => r.world !== null);
    let deathEdges = 0;
    for (let i = 1; i < withShip.length; i++) {
      if (withShip[i - 1]!.world!.alive && !withShip[i]!.world!.alive) deathEdges++;
    }
    const deadRecs = withShip.filter((r) => !r.world!.alive);
    const hulls = withShip.map((r) => r.world!.hull);

    const out = {
      probe: 'respawn-tail',
      allocator: ALLOCATOR,
      room: a.room,
      capturedAt: new Date().toISOString(),
      seat,
      reconcilesRecorded: recs.length,
      reconcilesApplied: applied.length,
      /** The falsifier: a breach-free run only means something if a death happened. */
      deathsObserved: deathEdges,
      deadReconciles: deadRecs.length,
      deadSpanMs: deadRecs.length
        ? deadRecs[deadRecs.length - 1]!.ms - deadRecs[0]!.ms
        : null,
      minHullSeen: hulls.length ? Math.min(...hulls) : null,
      maxHullSeen: hulls.length ? Math.max(...hulls) : null,
      breachingReconciles: breaches.length,
      breachSpanMs: first && breaches.length ? breaches[breaches.length - 1]!.ms - first.ms : null,
      distinctErrorValuesInBreach: errValues,
      distinctCheckpointValuesInBreach: cpValues,
      distinctAuthorityValuesInBreach: authValues,
      distinctWorldShipValuesInBreach: worldValues,
      histHitDuringBreach: [...new Set(breaches.map((r) => r.histHit))],
      resyncedDuringBreach: [...new Set(breaches.map((r) => r.resynced))],
      authPresentDuringBreach: [...new Set(breaches.map((r) => r.authPresent))],
      window,
    };
    writeFileSync(join(OUT, 'online-feel-respawn-tail.json'), JSON.stringify(out, null, 2));
    console.log(
      'RESPAWN-TAIL:',
      JSON.stringify({ ...out, window: `${window.length} reconciles` }, null, 2),
    );

    session.close();
    // The instrument's own liveness — not a verdict on the game.
    expect(applied.length).toBeGreaterThan(50);
  }, 180_000);
});
