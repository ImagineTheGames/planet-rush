/**
 * src/net/shot-echo.test.ts — one trigger pull, ONE set of shots.
 * OWNER: Netcode Engineer (GDD §2.3, §4.2; M10 action-echo).
 *
 * *"Shooting produces 2 sets of shots."*
 *
 * The firer's own shots are drawn from prediction — spawned the instant the trigger
 * goes down and flown on this client's own physics — and the reconcile path
 * suppresses authority's copy of them for exactly that reason (`./prediction`
 * `applySnapshot` `suppressShipShotsFrom`, audit item 2b). That much shipped and
 * works.
 *
 * What shipped beside it was a second, entirely separate route from the wire to the
 * screen. `TransportSession` hands each decoded snapshot to the interpolation
 * buffer *raw* — own shots included — and the presentation layer draws whatever
 * that buffer samples straight into the pool slots the wire owns
 * (`./presentation`). So the suppressed copy was not suppressed at all; it took the
 * scenic route and arrived a jitter buffer late, in different slots, beside the
 * predicted volley it was a copy of. Two sets of shots, one trigger.
 *
 * (The buffer's own doc comment has claimed since it was written that own shots are
 * "absent from this stream by the time it gets here". They were not. This file is
 * what makes the sentence true.)
 */

import { describe, expect, it } from 'vitest';
import type { PlayerId } from '@shared/types';
import { RemoteInterpolator } from './interpolation';
import { SHOT_META } from './snapshot';
import type { DecodedSnapshot } from './snapshot';

const LOCAL: PlayerId = 3;
const RIVAL: PlayerId = 5;

/** A ship-weapon shot's `meta` byte: owner in the low three bits, kind in bit 3. */
const shipShot = (owner: PlayerId): number => owner | SHOT_META.shipKind;
/** A turret shot from the same owner — same slot space, different kind bit. */
const turretShot = (owner: PlayerId): number => owner;

/** One decoded snapshot carrying whatever shots a test wants to put on the wire. */
function snapshot(tick: number, shots: readonly { id: number; x: number; meta: number }[]): DecodedSnapshot {
  return {
    tick,
    ships: [],
    projectiles: shots.map((s) => ({ id: s.id, posX: s.x, posY: 0, velX: 520, velY: 0, meta: s.meta })),
  };
}

function buffer(): RemoteInterpolator {
  return new RemoteInterpolator({ local: LOCAL });
}

describe('the streamed shot buffer never carries the firer’s own shots', () => {
  it('drops the local player’s ship shots and keeps everyone else’s', () => {
    const interp = buffer();
    interp.record(
      snapshot(10, [
        { id: 0, x: 100, meta: shipShot(LOCAL) },
        { id: 1, x: 200, meta: shipShot(RIVAL) },
      ]),
      1000,
    );
    interp.record(
      snapshot(12, [
        { id: 0, x: 140, meta: shipShot(LOCAL) },
        { id: 1, x: 240, meta: shipShot(RIVAL) },
      ]),
      1033,
    );

    // Sampled at any instant in the buffer's range: the rival's shot is drawn, the
    // local player's is not — they are already watching their own, predicted.
    for (const at of [1000, 1050, 1100, 1140]) {
      const shots = interp.sampleShots(at);
      expect(shots.every((s) => (s.meta & SHOT_META.ownerMask) !== LOCAL)).toBe(true);
      expect(shots.some((s) => (s.meta & SHOT_META.ownerMask) === RIVAL)).toBe(true);
    }
  });

  it('keeps the local player’s TURRET shots — those are not predicted', () => {
    // A turret is a structure the server owns outright; the client does not predict
    // its trigger, so its shots must come off the wire like any other.
    const interp = buffer();
    interp.record(snapshot(10, [{ id: 4, x: 10, meta: turretShot(LOCAL) }]), 1000);
    interp.record(snapshot(12, [{ id: 4, x: 30, meta: turretShot(LOCAL) }]), 1033);

    const shots = interp.sampleShots(1120);
    expect(shots.length).toBe(1);
    expect(shots[0]!.meta & SHOT_META.shipKind).toBe(0);
  });

  it('drops them in the hold and extrapolate regimes too, not just the lerp', () => {
    const interp = buffer();
    // One snapshot only: every sample below the delay is a "hold", every sample
    // past it an "extrapolate" — the two paths a per-sample filter would have
    // missed, which is why the drop happens on ingest.
    interp.record(
      snapshot(10, [
        { id: 0, x: 100, meta: shipShot(LOCAL) },
        { id: 1, x: 200, meta: shipShot(RIVAL) },
      ]),
      1000,
    );

    expect(interp.sampleShots(900).every((s) => (s.meta & SHOT_META.ownerMask) !== LOCAL)).toBe(true);
    expect(interp.sampleShots(5000).every((s) => (s.meta & SHOT_META.ownerMask) !== LOCAL)).toBe(true);
    expect(interp.sampleShots(1100).length).toBe(1);
  });

  it('a whole volley from the local ship yields ZERO streamed shots', () => {
    // The steady state of holding the trigger: two of the firer's shots in flight
    // at once (`./prediction` MAX_PREDICTED_SHOTS reasons from the same numbers).
    // None of them may reach the screen twice.
    const interp = buffer();
    for (let i = 0; i < 6; i++) {
      interp.record(
        snapshot(10 + i * 2, [
          { id: 0, x: 100 + i * 40, meta: shipShot(LOCAL) },
          { id: 1, x: 300 + i * 40, meta: shipShot(LOCAL) },
        ]),
        1000 + i * 33,
      );
    }
    for (let at = 1000; at <= 1200; at += 16) expect(interp.sampleShots(at)).toEqual([]);
  });
});
