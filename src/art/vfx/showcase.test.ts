/**
 * The frozen review sheet (`./showcase`) and the draw tally it is read through
 * (`./field` `drawn`) — the two pieces a2-07 added so "is this effect actually
 * drawn?" stops being a question you answer by grepping.
 *
 * What is load-bearing here:
 *
 *  - the showcase is **byte-deterministic**, because a golden that flickers is a
 *    golden nobody can review and a gate nobody trusts;
 *  - it stages exactly the two effects the brief asked to be proven, at their
 *    real magnitudes, and nothing else — a review sheet that quietly showed a
 *    third would be evidence for a claim nobody made;
 *  - the tally counts **particles that reached the pool**, so the two honest
 *    zeroes stay zero: the audio-only wave tell, and a firing tick the spark
 *    throttle swallowed. A counter that called those "drawn" would recreate, in
 *    miniature, the exact confidence that let a whole dark subsystem look wired.
 *
 * These are unit tests, and they cannot prove the wire — nothing headless can,
 * which is the whole lesson. That proof is `tests/live-stage/vfx-alive.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { TELL, TELL_NAMES, TellQueue, type TellKind } from '../tells';
import { VfxField } from './field';
import { stageVfxShowcase, VFX_SHOWCASE_DT, VFX_SHOWCASE_STEPS } from './showcase';

/** A comparable fingerprint of the whole pool: every column of every particle. */
function poolSnapshot(field: VfxField): string {
  const p = field.pool;
  const rows: string[] = [];
  for (let i = 0; i < p.count; i++) {
    rows.push(
      [
        p.kind[i],
        p.color[i],
        p.x[i]!.toFixed(6),
        p.y[i]!.toFixed(6),
        p.rot[i]!.toFixed(6),
        p.alpha[i]!.toFixed(6),
        p.radiusAt(i).toFixed(6),
        p.progress(i).toFixed(6),
      ].join(','),
    );
  }
  return rows.join('\n');
}

const ANCHOR = { x: 1200, y: 900 };

describe('the frozen VFX review sheet (./showcase)', () => {
  it('is identical on two independent boots — the goldens cannot flicker', () => {
    // The reason the frozen scene can be diffed with nothing masked is that the
    // renderer is a pure function of a pinned world. Particles are the first
    // thing in that frame that animates off `dt`, so they earn their place in it
    // only by being played at a FIXED timestep from a reseeded RNG.
    const a = new VfxField({ seed: 1 });
    const b = new VfxField({ seed: 1 });
    stageVfxShowcase(a, new TellQueue(), ANCHOR);
    stageVfxShowcase(b, new TellQueue(), ANCHOR);

    expect(a.count).toBeGreaterThan(0);
    expect(poolSnapshot(b)).toBe(poolSnapshot(a));
  });

  it('is identical even on a field that has already drawn a whole match', () => {
    // A boot may draw before the freeze settles, which would leave the scatter
    // RNG somewhere unrepeatable. The stage resets first, so it cannot matter.
    const clean = new VfxField({ seed: 1 });
    const used = new VfxField({ seed: 1 });
    const noise = new TellQueue();
    for (let i = 0; i < 40; i++) {
      noise.clear();
      noise.push(TELL.rockBurst, i * 7, i * 3, 0, 0.5, i % 8);
      noise.push(TELL.thrust, i, i, 1, 1, i % 8);
      used.consume(noise);
      used.update(1 / 60);
    }

    stageVfxShowcase(clean, new TellQueue(), ANCHOR);
    stageVfxShowcase(used, new TellQueue(), ANCHOR);
    expect(poolSnapshot(used)).toBe(poolSnapshot(clean));
  });

  it('stages exactly one explosion and four ore pickups, and nothing else', () => {
    const field = new VfxField({ seed: 1 });
    stageVfxShowcase(field, new TellQueue(), ANCHOR);

    expect(field.drawn(TELL.shipExplode)).toBe(1);
    expect(field.drawn(TELL.oreCollect)).toBe(4);
    // Scope discipline (a2-07): two effects proven, the other twenty-three left
    // for a pass with the developer's eyes on them.
    const others = (Object.values(TELL) as TellKind[]).filter(
      (k) => k !== TELL.shipExplode && k !== TELL.oreCollect,
    );
    for (const kind of others) {
      expect({ kind: TELL_NAMES[kind], drawn: field.drawn(kind) }).toEqual({
        kind: TELL_NAMES[kind],
        drawn: 0,
      });
    }
  });

  it('leaves the borrowed queue clear, so the live path inherits nothing', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue();
    stageVfxShowcase(field, tells, ANCHOR);
    expect(tells.length).toBe(0);
    expect(tells.dropped).toBe(0);
  });

  it('catches the explosion mid-bang: the pre-roll is shorter than its flare', () => {
    // If the pre-roll outran the effect the sheet would photograph smoke, and the
    // reviewer would be asked to judge an explosion by its aftermath.
    expect(VFX_SHOWCASE_STEPS * VFX_SHOWCASE_DT).toBeLessThan(0.16);
    const field = new VfxField({ seed: 1 });
    stageVfxShowcase(field, new TellQueue(), ANCHOR);
    // Every staged particle is still alive — none has aged out of the pool.
    for (let i = 0; i < field.pool.count; i++) {
      expect(field.pool.progress(i)).toBeLessThan(1);
    }
  });

  it('puts both effects where the camera anchor says, not at the world origin', () => {
    const field = new VfxField({ seed: 1 });
    stageVfxShowcase(field, new TellQueue(), ANCHOR);
    for (let i = 0; i < field.pool.count; i++) {
      expect(Math.abs(field.pool.x[i]! - ANCHOR.x)).toBeLessThan(600);
      expect(Math.abs(field.pool.y[i]! - ANCHOR.y)).toBeLessThan(600);
    }
  });
});

describe('the draw tally (./field `drawn`)', () => {
  it('counts a tell only when particles actually reached the pool', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue();
    tells.push(TELL.rockBurst, 0, 0, 0, 1, -1);
    field.consume(tells);
    expect(field.drawn(TELL.rockBurst)).toBe(1);
    expect(field.drawnTotal).toBe(1);
  });

  it('reports the wave tell as NOT drawn — it is audio-only by design', () => {
    // The wave clock is the HUD's tell for an arriving wave (GDD §2.2) and there
    // is nothing useful to draw at an off-screen arena centre. That is a design
    // decision, and the readout says so rather than implying a dead route.
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue();
    tells.push(TELL.waveArrive, 0, 0, 0, 0.2, -1);
    field.consume(tells);
    expect(field.drawn(TELL.waveArrive)).toBe(0);
    expect(field.drawnTotal).toBe(0);
  });

  it('does not count a firing tick the spark throttle swallowed', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue();
    // Two hits from the same slot inside one throttle window: the second draws
    // nothing (`HIT_BURST_INTERVAL`), and the tally must not claim it did.
    tells.push(TELL.weaponHit, 0, 0, 0, 1, 2);
    tells.push(TELL.weaponHit, 1, 1, 0, 1, 2);
    field.consume(tells);
    expect(field.drawn(TELL.weaponHit)).toBe(1);
  });

  it('still counts every effect at the reduced-VFX floor — thinning, not vanishing', () => {
    // r9-01's rule, as a number: the throttle costs particles and never a tell.
    const field = new VfxField({ seed: 1, quality: 0.01 });
    const tells = new TellQueue();
    const kinds: TellKind[] = [
      TELL.shipExplode,
      TELL.oreCollect,
      TELL.rockBurst,
      TELL.stationDeath,
      TELL.shieldDown,
      TELL.coreHit,
    ];
    for (const kind of kinds) tells.push(kind, 0, 0, 0, 1, 0);
    field.consume(tells);
    for (const kind of kinds) {
      expect({ kind: TELL_NAMES[kind], drawn: field.drawn(kind) }).toEqual({
        kind: TELL_NAMES[kind],
        drawn: 1,
      });
    }
  });

  it('is forgotten on reset, like every other trace of the last match', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue();
    tells.push(TELL.rockBurst, 0, 0, 0, 1, -1);
    field.consume(tells);
    field.reset();
    expect(field.drawnTotal).toBe(0);
    expect(field.drawn(TELL.rockBurst)).toBe(0);
  });
});
