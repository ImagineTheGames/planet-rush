/**
 * evidence/a0-73-remote-shots/shot-path-probe.ts — does a remote shot fly the
 * line it was fired on?  OWNER: Netcode Engineer (a0-73).
 *
 * The developer, in a live online match:
 *
 *   "other players shots down follow the diretion they were fired in"
 *
 * This probe answers that with a number instead of an opinion. It drives the
 * REAL simulation, encodes REAL snapshots through the shipping codec
 * (`src/net/snapshot.ts`), plays them back through the shipping interpolation
 * buffer (`src/net/interpolation.ts`) at a real 60 Hz render clock, and — because
 * it also holds the authoritative world — knows, for every dot it draws, exactly
 * which shot that dot is and exactly which line that shot was fired along.
 *
 * Two errors are reported, both in WORLD UNITS, and they mean different things:
 *
 *  - **cross-track** — perpendicular distance from the drawn dot to the ray
 *    `(muzzle, heading)` the sim launched it on. This is "is it on its line at
 *    all". Non-zero means the dot is somewhere the shot never flew.
 *  - **along-track** — how far the dot is from where the shot TRULY was at that
 *    instant, measured along its own line. This is "is it where its heading
 *    would have put it". A frozen shot's line error is zero and its along-track
 *    error grows without bound; to a player reading the line to dodge, the two
 *    are the same defect.
 *
 * Scenes:
 *   `--scene=duel`   one shooter, empty field — every shot lives its full life.
 *   `--scene=field`  eight ships firing into a rock field — shots die early and
 *                    the pool slot they free is taken by the next shot fired.
 *                    This is ordinary play, and it is where the slot-keyed wire
 *                    record has two different shots in one slot.
 *
 *   npx vite-node evidence/a0-73-remote-shots/shot-path-probe.ts -- --scene=field
 *   npx vite-node evidence/a0-73-remote-shots/shot-path-probe.ts -- --stall=200
 *   npx vite-node evidence/a0-73-remote-shots/shot-path-probe.ts -- --jitter=15
 */

import { ShipClass } from '../../src/shared/types';
import type { Action, PlayerId } from '../../src/shared/types';
import { SHIP_WEAPON, TICK_DT, TURRET, createWorld, step } from '../../src/sim';
import type { WorldConfig } from '../../src/sim';
import { RemoteInterpolator } from '../../src/net/interpolation';
import {
  WORST_CASE_BYTES,
  decodeSnapshot,
  encodeWorldSnapshot,
  projIsShipShot,
  projOwner,
} from '../../src/net/snapshot';
import { SNAPSHOT_FRAME_HEADER_BYTES } from '../../src/net/wire';

// --- Options -----------------------------------------------------------------

function flag(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SCENE = flag('scene', 'duel');
const STALL_MS = Number(flag('stall', '0'));
const JITTER_MS = Number(flag('jitter', '0'));
const TICKS = Number(flag('ticks', '600'));

/** The viewer, whose own shots are predicted and never sampled from the wire. */
const VIEWER: PlayerId = 0;

/** 60 Hz sim, 30 Hz broadcast — `server/room.ts` `DEFAULT_SNAPSHOT_INTERVAL_TICKS`. */
const SNAPSHOT_INTERVAL_TICKS = 2;
/** One-way latency a snapshot spends on the wire before the buffer records it. */
const LATENCY_MS = 75;
/** The buffer's playback delay, pinned so the run is reproducible. */
const DELAY_MS = 100;
const TICK_MS = TICK_DT * 1000;

const SHIPS = SCENE === 'field' ? 8 : 2;
const MATCH: WorldConfig = {
  seed: 11,
  players: Array.from({ length: SHIPS }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
  // The duel runs an empty field so every shot lives its full 300-unit life; the
  // field scene is ordinary play, where a shot dies on the first rock it meets
  // and frees its pool slot after a few tens of units.
  asteroidCount: SCENE === 'field' ? 40 : 0,
};

/** A seeded LCG, so an injected jitter is identical run to run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Ground truth ------------------------------------------------------------

/** The line one shot was actually fired along, taken off the sim at launch. */
interface FiredLine {
  readonly entity: number;
  readonly owner: number;
  readonly ox: number;
  readonly oy: number;
  /** Unit heading — the direction the developer says the shot should follow. */
  readonly dx: number;
  readonly dy: number;
  readonly speed: number;
}

const crossTrack = (l: FiredLine, x: number, y: number): number =>
  Math.abs((x - l.ox) * l.dy - (y - l.oy) * l.dx);
const alongTrack = (l: FiredLine, x: number, y: number): number =>
  (x - l.ox) * l.dx + (y - l.oy) * l.dy;

// --- The run -----------------------------------------------------------------

interface Sample {
  readonly cross: number;
  readonly along: number;
  /** How far the dot moved since the previous frame it was drawn on. NaN on its
   *  first frame. Zero is a frozen shot. */
  readonly step: number;
  readonly inStall: boolean;
}

interface WireCost {
  frames: number;
  bytes: number;
  shots: number;
  peakShots: number;
  peakBytes: number;
}

function run(): { samples: Sample[]; shots: number; crabbed: number; crabWorst: number; wire: WireCost } {
  const world = createWorld(MATCH);
  const buffer = new RemoteInterpolator({ local: VIEWER, delayMs: DELAY_MS });
  const jitter = lcg(2026);

  const born = new Map<number, FiredLine>(); // sim entity id -> its fired line
  /** Where the shot in each slot truly was, per sim tick: `tick:slot`. */
  const truth = new Map<string, { x: number; y: number; entity: number }>();
  const drawnAt = new Map<string, { x: number; y: number }>();
  const samples: Sample[] = [];
  let shots = 0;
  let crabbed = 0; // frames whose dot is off its own line by more than a pixel
  let crabWorst = 0;
  const wire: WireCost = { frames: 0, bytes: 0, shots: 0, peakShots: 0, peakBytes: 0 };

  const stallStart = 1_500;
  const stallEnd = stallStart + STALL_MS;

  const actionsFor = (tick: number): { id: PlayerId; seq: number; actions: Action[] }[] => {
    const t = tick * TICK_DT;
    return Array.from({ length: SHIPS }, (_, id) => ({
      id,
      seq: tick,
      actions:
        id === VIEWER
          ? []
          : [
              { type: 'thrust', dir: { x: Math.cos(t * 0.3 + id), y: Math.sin(t * 0.3 + id) } },
              { type: 'aim', dir: { x: Math.cos(t * 0.9 + id * 2), y: Math.sin(t * 0.9 + id * 2) } },
              { type: 'fire', active: true, auto: false },
            ],
    }));
  };

  for (let tick = 1; tick <= TICKS; tick++) {
    step(world, actionsFor(tick), TICK_DT);
    const simMs = tick * TICK_MS;

    for (let slot = 0; slot < world.projectiles.length; slot++) {
      const p = world.projectiles[slot]!;
      if (!p.active) continue;
      if (!born.has(p.id)) {
        const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
        born.set(p.id, {
          entity: p.id,
          owner: p.owner,
          ox: p.pos.x,
          oy: p.pos.y,
          dx: p.vel.x / speed,
          dy: p.vel.y / speed,
          speed,
        });
        if (p.owner !== VIEWER && p.kind === 'ship') shots++;
      }
      truth.set(`${tick}:${slot}`, { x: p.pos.x, y: p.pos.y, entity: p.id });
    }

    const stalled = simMs >= stallStart && simMs < stallEnd;
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0 && !stalled) {
      const wobble = JITTER_MS > 0 ? (jitter() - 0.5) * 2 * JITTER_MS : 0;
      const buf = encodeWorldSnapshot(world);
      const decoded = decodeSnapshot(buf);
      // What this snapshot actually cost, and what it would have cost with the
      // 6-byte projectile record — the honest per-shot wire bill (a0-73).
      wire.frames++;
      wire.bytes += buf.byteLength;
      wire.shots += decoded.projectiles.length;
      wire.peakShots = Math.max(wire.peakShots, decoded.projectiles.length);
      wire.peakBytes = Math.max(wire.peakBytes, buf.byteLength);
      buffer.record(decoded, simMs + LATENCY_MS + wobble);
    }

    // Render one frame per sim tick, on the clock the arrivals are stamped with.
    const renderMs = simMs + LATENCY_MS;
    const playbackTick = Math.round((renderMs - DELAY_MS - LATENCY_MS) / TICK_MS);
    for (const dot of buffer.sampleShots(renderMs)) {
      if (!projIsShipShot(dot.meta) || projOwner(dot.meta) === VIEWER) continue;
      // Which shot is this dot SUPPOSED to be? The one authority had in that slot
      // at the instant the render clock is playing back.
      const actual = truth.get(`${playbackTick}:${dot.slot}`);
      if (!actual) continue;
      const line = born.get(actual.entity);
      if (!line) continue;
      const cross = crossTrack(line, dot.x, dot.y);
      const along = Math.abs(alongTrack(line, dot.x, dot.y) - alongTrack(line, actual.x, actual.y));
      const key = `${dot.slot}:${actual.entity}`;
      const prev = drawnAt.get(key);
      drawnAt.set(key, { x: dot.x, y: dot.y });
      if (cross > 1) {
        crabbed++;
        crabWorst = Math.max(crabWorst, cross);
      }
      samples.push({
        cross,
        along,
        step: prev ? Math.hypot(dot.x - prev.x, dot.y - prev.y) : Number.NaN,
        inStall: STALL_MS > 0 && simMs >= stallStart && simMs < stallEnd + 200,
      });
    }
  }

  return { samples, shots, crabbed, crabWorst, wire };
}

// --- Report ------------------------------------------------------------------

function stats(values: readonly number[]): { mean: number; p95: number; max: number } {
  if (values.length === 0) return { mean: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return {
    mean: round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p95: round(sorted[Math.floor(sorted.length * 0.95)]!),
    max: round(sorted[sorted.length - 1]!),
  };
}

const result = run();
const steps = result.samples.map((s) => s.step).filter((v) => Number.isFinite(v));
const stallSamples = result.samples.filter((s) => s.inStall);

console.log(
  JSON.stringify(
    {
      scene: {
        name: SCENE,
        ships: SHIPS,
        asteroids: MATCH.asteroidCount,
        simHz: Math.round(1 / TICK_DT),
        snapshotHz: Math.round(1 / (TICK_DT * SNAPSHOT_INTERVAL_TICKS)),
        latencyMs: LATENCY_MS,
        jitterMs: JITTER_MS,
        interpDelayMs: DELAY_MS,
        stallMs: STALL_MS,
        shipMuzzleSpeed: SHIP_WEAPON.projectileSpeed,
        turretMuzzleSpeed: TURRET.projectileSpeed,
      },
      wireCost: (() => {
        const w = result.wire;
        const hz = 1 / (TICK_DT * SNAPSHOT_INTERVAL_TICKS);
        const perFrame = w.bytes / Math.max(1, w.frames);
        const wouldBe = (w.bytes - w.shots * 2) / Math.max(1, w.frames); // the 6-byte record
        const kbs = (bytes: number): number => Math.round(((bytes + SNAPSHOT_FRAME_HEADER_BYTES) * hz) / 10.24) / 100;
        return {
          snapshots: w.frames,
          meanShotsPerSnapshot: Math.round((w.shots / Math.max(1, w.frames)) * 10) / 10,
          peakShotsPerSnapshot: w.peakShots,
          meanBytes: Math.round(perFrame * 10) / 10,
          meanBytesAtSixByteRecord: Math.round(wouldBe * 10) / 10,
          peakBytes: w.peakBytes,
          downstreamKBs: kbs(perFrame),
          downstreamKBsAtSixByteRecord: kbs(wouldBe),
          worstCaseBytes: WORST_CASE_BYTES,
          worstCaseKBs: kbs(WORST_CASE_BYTES),
        };
      })(),
      remoteShotsFired: result.shots,
      dotsMeasured: result.samples.length,
      crossTrackError: stats(result.samples.map((s) => s.cross)),
      alongTrackError: stats(result.samples.map((s) => s.along)),
      offItsOwnLine: { frames: result.crabbed, ofFrames: result.samples.length, worstUnits: Math.round(result.crabWorst * 1000) / 1000 },
      perFrameStep: {
        ...stats(steps),
        frozenFrames: steps.filter((v) => v === 0).length,
        ofFrames: steps.length,
      },
      duringStall:
        STALL_MS > 0
          ? {
              dots: stallSamples.length,
              crossTrackError: stats(stallSamples.map((s) => s.cross)),
              alongTrackError: stats(stallSamples.map((s) => s.along)),
            }
          : null,
    },
    null,
    2,
  ),
);
