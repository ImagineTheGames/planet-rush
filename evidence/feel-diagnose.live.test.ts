/**
 * evidence/feel-diagnose.live.test.ts — what the COPY LOG numbers MEAN.
 * OWNER: QA Manager.
 *
 * The `online-feel` capture (evidence/capture-online-feel.mjs) pressed COPY LOG on
 * two live browser clients and got a log whose per-second rows were quiet — worst
 * correction 1.5 u, snap 0 — for 65 of 71 seconds, and then, on BOTH clients at
 * once, pinned at a correction of ~360 world units with a misprediction rate of
 * 1.0 for five straight seconds, with one visual snap at the leading edge.
 *
 * A number that large held that steadily is not jitter. This instrument exists to
 * say what it IS, because "the gate is breached" and "the gate is breached BY
 * this" are different reports and only the second one is useful to the lane that
 * owns the fix.
 *
 * It runs ONE client of the shipped net stack against the same live fleet, flies
 * it, and samples four times a second: the telemetry the log would export, AND the
 * local ship's own `alive` / `hull` / position, which the playtest log does not carry
 * (`src/net/playtest-log-attach.ts` records `matchStart`, substitution, reclaim and
 * match end — there is no local spawn/death entry, despite `docs/playtest-log.md`
 * listing one). Every second whose correction clears the audit's 4 u ceiling is
 * written out beside what the ship was doing in it.
 *
 * Run: npx vitest run --config evidence/vitest.live.config.ts evidence/feel-diagnose.live.test.ts
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

function connOf(result: Awaited<ReturnType<typeof allocateRoom>>): ResolvedConnection {
  if (!result.ok) throw new Error(`allocator refused: ${result.reason}`);
  return result.connection;
}

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

describe('what the online-feel outliers are', () => {
  it('samples the ship beside the telemetry, and names what the big corrections were', async () => {
    const a = connOf(await allocateRoom(client, {}));
    const session = await connectWelcomed(a);
    session.startMatch();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && session.world === null) await sleep(100);
    if (!session.world) throw new Error('the live match never started');
    const seat = session.you;

    /** One 250 ms sample: what the ship was, beside what the instrument said. */
    const track: Record<string, unknown>[] = [];
    const t0 = Date.now();
    let i = 0;
    const flyUntil = Date.now() + 75_000;
    // Input at the SIM's own rate, which is what makes this comparable to a
    // browser client. A 4 Hz cadence leaves the prediction history empty, so every
    // snapshot rewinds to a checkpoint that is not there and reports a wholesale
    // `resync` instead of a correction — the instrument's numbers then describe
    // the instrument, not the game. (Measured: a first pass at 250 ms read
    // `resync 30/s, lead 0, corr 0` for the whole run.)
    const dirsLive = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    let frame = 0;
    const flying = setInterval(() => {
      const d = dirsLive[Math.floor(frame / 300) % 4]!;
      frame++;
      session.sendInput([
        { type: 'thrust', dir: d },
        { type: 'fire', active: true, auto: true },
      ] as never);
    }, 33);
    while (Date.now() < flyUntil) {
      const w = session.world as World;
      const me = w.ships.find((s) => s.id === seat) ?? null;
      const newest = session.telemetry.samples.at(-1) ?? null;
      track.push({
        ms: Date.now() - t0,
        tick: w.tick,
        alive: me?.alive ?? null,
        hull: me ? Math.round(me.hull) : null,
        maxHull: me ? Math.round(me.maxHull) : null,
        respawnTimer: me ? +me.respawnTimer.toFixed(1) : null,
        pos: me ? { x: Math.round(me.pos.x), y: Math.round(me.pos.y) } : null,
        lastError: session.prediction?.lastError ?? null,
        sampleAtMs: newest?.atMs ?? null,
        corrMax: newest?.correctionMaxUnits ?? null,
        snaps: newest?.visualSnaps ?? null,
        mispred: newest?.mispredictionRate ?? null,
      });
      i++;
      await sleep(250);
    }
    clearInterval(flying);

    // The seconds that breach the audit's ceiling, and what the ship was in them.
    const samples = session.telemetry.samples.map((s) => ({
      atMs: s.atMs,
      corr: +s.correctionMeanUnits.toFixed(3),
      corrMax: +s.correctionMaxUnits.toFixed(3),
      mispred: +s.mispredictionRate.toFixed(3),
      snap: s.visualSnaps,
      resync: s.resyncs,
      rtt: s.rttMeanMs,
      lead: Math.round(s.leadMeanTicks),
    }));
    const breaches = samples.filter((s) => s.corrMax > MAX_CORRECTION_UNITS);
    // For each breaching second, the ship states seen inside it.
    const explained = breaches.map((s) => {
      const inWindow = track.filter((p) => (p.sampleAtMs as number | null) === s.atMs);
      const alive = new Set(inWindow.map((p) => p.alive));
      return {
        ...s,
        shipAliveDuringSecond: [...alive],
        hullRange: inWindow.length
          ? [
              Math.min(...inWindow.map((p) => (p.hull as number) ?? NaN)),
              Math.max(...inWindow.map((p) => (p.hull as number) ?? NaN)),
            ]
          : null,
        respawnTimers: [...new Set(inWindow.map((p) => p.respawnTimer))],
      };
    });
    const deaths = track.filter((p, n) => n > 0 && track[n - 1]!.alive === true && p.alive === false).length;
    const respawns = track.filter((p, n) => n > 0 && track[n - 1]!.alive === false && p.alive === true).length;

    const out = {
      probe: 'feel-diagnose',
      allocator: ALLOCATOR,
      room: a.room,
      capturedAt: new Date().toISOString(),
      seat,
      seconds: samples.length,
      breachingSeconds: breaches.length,
      worstCorrectionUnits: samples.length ? Math.max(...samples.map((s) => s.corrMax)) : null,
      totalVisualSnaps: samples.reduce((n, s) => n + s.snap, 0),
      deathsObserved: deaths,
      respawnsObserved: respawns,
      explained,
      samples,
      track,
    };
    writeFileSync(join(OUT, 'online-feel-diagnose.json'), JSON.stringify(out, null, 2));
    console.log(
      'FEEL-DIAGNOSE:',
      JSON.stringify({ ...out, track: `${track.length} samples`, samples: `${samples.length} seconds` }, null, 2),
    );

    session.close();
    // The instrument's own liveness — not a verdict on the game.
    expect(samples.length).toBeGreaterThan(10);
  }, 180_000);
});
