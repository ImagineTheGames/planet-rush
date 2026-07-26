/**
 * The specified VFX set, checked against the two contracts it answers to:
 * GDD §3.6 (which *names* the effects, so the set is a checklist rather than a
 * matter of taste) and `style-guide.md` §2 (the RESERVED rule, which a particle
 * can break as easily as a hull can).
 *
 * The load-bearing assertions here:
 *
 *  - every one of the eleven particle looks passes the same palette audit the
 *    ship sprites do — a spark that quietly went signal yellow fails CI;
 *  - every tell kind routes to an effect, so no mechanic is silent visually;
 *  - `quality` thins bursts but never removes an effect, because the "reduce
 *    VFX" escape hatch (GDD §4.3) must cost particles, never mechanics;
 *  - the death moment holds exactly the three seconds the tone paragraph
 *    promises (GDD §4.7) — the one piece of "polish" the guide says cannot be
 *    cut.
 */

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@shared/types';
import { auditAll, auditSprite, formatViolations } from '../compliance';
import { DERIVED, PALETTE, PLAYER_COLORS, playerColor } from '../palette';
import { spriteColors } from '../shapes';
import { TELL, TELL_COUNT, TELL_NAMES, TELL_PAYLOAD, TellQueue, type TellKind } from '../tells';
import { DeathMoment, HUSH_CUT_S, HUSH_RETURN_S, HUSH_S } from './death-moment';
import {
  asteroidBurst,
  asteroidCrack,
  explosion,
  muzzleFlash,
  planetDeath,
  shieldShimmer,
  spawnGlow,
  thrusterTrail,
  tintFor,
  weaponImpact,
} from './emitters';
import { VfxField } from './field';
import { fadeAt, PARTICLE, PARTICLE_KINDS, PARTICLE_SPRITES, particleKind, particleSprite } from './kinds';
import { ParticlePool } from './particles';

const ALL_KINDS: TellKind[] = Object.values(TELL);

describe('particle kinds (style-guide §1, §2, §3)', () => {
  it('is eleven looks — the whole effects layer, eleven textures', () => {
    expect(PARTICLE_KINDS).toHaveLength(11);
    expect(PARTICLE_SPRITES).toHaveLength(11);
    // Kind is the index: the draw layer reads `textures[kind]` with no lookup.
    PARTICLE_KINDS.forEach((spec, i) => expect(spec.kind).toBe(i));
  });

  it('passes the same palette audit as every hull and planet', () => {
    const violations = auditAll(PARTICLE_SPRITES);
    expect(formatViolations(violations)).toBe('');
    expect(violations).toEqual([]);
  });

  it('puts signal yellow on the ore particle and nowhere else', () => {
    // The rule that carries the most weight (style-guide §2): a player scanning
    // a chaotic screen must be able to trust yellow completely, and a chaotic
    // screen is made of particles.
    const yellows = new Set<number>([PALETTE.signalYellow, DERIVED.oreDeep, DERIVED.coreHot]);
    for (const spec of PARTICLE_KINDS) {
      const used = spriteColors(particleSprite(spec.kind)).filter((c) => yellows.has(c));
      if (spec.kind === PARTICLE.oreBit) expect(used.length).toBeGreaterThan(0);
      else expect(used).toEqual([]);
    }
  });

  it('puts threat red only on damage looks', () => {
    const reds = new Set<number>([PALETTE.threatRed]);
    for (const spec of PARTICLE_KINDS) {
      const used = spriteColors(particleSprite(spec.kind)).filter((c) => reds.has(c));
      const isDamage = spec.kind === PARTICLE.fleck || spec.kind === PARTICLE.ember;
      if (!isDamage) expect(used).toEqual([]);
    }
  });

  it('only lets the two identity looks take a player colour', () => {
    // Style-guide §3 rule 2 lists exactly where identity colour may live; of
    // that list, particles cover engine flame and weapon tint.
    const identity = PARTICLE_KINDS.filter((k) => k.tint === 'identity').map((k) => k.name);
    expect(identity.sort()).toEqual(['flare', 'spark', 'trail']);
  });

  it('refuses a player colour on a fixed look, however it is called', () => {
    // Enforced in `tintFor` rather than trusted at the call site, because "pass
    // the right colour" is the discipline that fails on the tenth caller.
    expect(tintFor(PARTICLE.chip, PLAYER_COLORS[4])).toBe(particleKind(PARTICLE.chip).color);
    expect(tintFor(PARTICLE.oreBit, PLAYER_COLORS[4])).toBe(PALETTE.signalYellow);
    expect(tintFor(PARTICLE.trail, PLAYER_COLORS[4])).toBe(PLAYER_COLORS[4]);
    expect(tintFor(PARTICLE.spark, PLAYER_COLORS[2])).toBe(PLAYER_COLORS[2]);
  });

  it('fades from 1 to 0 over every curve, and never pops in', () => {
    for (const spec of PARTICLE_KINDS) {
      expect(fadeAt(spec.kind, 1)).toBeCloseTo(0, 6);
      expect(fadeAt(spec.kind, 2)).toBeCloseTo(0, 6); // clamped past death
      expect(fadeAt(spec.kind, -1)).toBeGreaterThanOrEqual(0); // and before birth
      for (let p = 0; p <= 1; p += 0.05) {
        const a = fadeAt(spec.kind, p);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
    // Rings and shimmers rise first, so a shockwave never appears at full alpha.
    expect(fadeAt(PARTICLE.ring, 0)).toBe(0);
    expect(fadeAt(PARTICLE.ring, 0.2)).toBeCloseTo(1, 6);
  });

  it('falls back to a real spec for an unknown kind rather than crashing', () => {
    expect(particleKind(99).name).toBe('spark');
    expect(auditSprite(particleSprite(PARTICLE.smoke))).toEqual([]);
  });
});

describe('emitters (GDD §3.6 — the set, by name)', () => {
  const pool = () => new ParticlePool(4096);

  it('draws every named effect', () => {
    // The brief lists them; this is that list, as a test.
    const named: [string, (p: ParticlePool) => void][] = [
      ['shot impact', (p) => weaponImpact(p, mulberry32(1), 0, 0, 0, 1, playerColor(0), false)],
      ['crack', (p) => asteroidCrack(p, mulberry32(1), 0, 0, 14, 2)],
      ['burst', (p) => asteroidBurst(p, mulberry32(1), 0, 0, 14)],
      ['shield shimmer', (p) => shieldShimmer(p, mulberry32(1), 0, 0, 80, 0.5)],
      ['muzzle flash', (p) => muzzleFlash(p, mulberry32(1), 0, 0, 0)],
      ['explosion', (p) => explosion(p, mulberry32(1), 0, 0, 1)],
      ['thruster trail', (p) => thrusterTrail(p, mulberry32(1), 0, 0, 0, 1, 3)],
      ['spawn glow', (p) => spawnGlow(p, mulberry32(1), 0, 0, 18)],
      ['planet death', (p) => planetDeath(p, mulberry32(1), 0, 0, 64)],
    ];
    for (const [name, emit] of named) {
      const p = pool();
      emit(p);
      expect(p.count, `${name} drew nothing`).toBeGreaterThan(0);
    }
  });

  it('is deterministic — a replay looks like the match it replays (GDD §4.1)', () => {
    const a = pool();
    const b = pool();
    explosion(a, mulberry32(1234), 10, 20, 1);
    explosion(b, mulberry32(1234), 10, 20, 1);
    expect(a.count).toBe(b.count);
    expect([...a.x.subarray(0, a.count)]).toEqual([...b.x.subarray(0, b.count)]);
    expect([...a.vy.subarray(0, a.count)]).toEqual([...b.vy.subarray(0, b.count)]);
  });

  it('thins with quality but never removes an effect (GDD §4.3 escape hatch)', () => {
    // "Sustained drops below the floor auto-engage the reduce-VFX setting" — a
    // phone dropping frames must lose particles, never a mechanic's tell.
    for (const quality of [1, 0.5, 0.25, 0]) {
      const p = pool();
      explosion(p, mulberry32(5), 0, 0, 1, quality);
      asteroidBurst(p, mulberry32(5), 0, 0, 14, quality);
      muzzleFlash(p, mulberry32(5), 0, 0, 0, quality);
      planetDeath(p, mulberry32(5), 0, 0, 64, quality);
      expect(p.count, `quality ${quality} drew nothing`).toBeGreaterThan(0);
    }
    const full = pool();
    const thin = pool();
    explosion(full, mulberry32(5), 0, 0, 1, 1);
    explosion(thin, mulberry32(5), 0, 0, 1, 0.25);
    expect(thin.count).toBeLessThan(full.count);
  });

  it('splits rock from hull the way the two firing voices do', () => {
    const rock = pool();
    const hull = pool();
    weaponImpact(rock, mulberry32(2), 0, 0, 0, 1, playerColor(0), false);
    weaponImpact(hull, mulberry32(2), 0, 0, 0, 1, playerColor(0), true);
    const kinds = (p: ParticlePool) => new Set([...p.kind.subarray(0, p.count)]);
    expect(kinds(rock).has(PARTICLE.chip)).toBe(true);
    expect(kinds(rock).has(PARTICLE.fleck)).toBe(false);
    expect(kinds(hull).has(PARTICLE.fleck)).toBe(true); // damage spatters red
    expect(kinds(hull).has(PARTICLE.chip)).toBe(false);
  });

  it('tints the thruster trail with the pilot, and nothing else with anything', () => {
    const p = pool();
    thrusterTrail(p, mulberry32(3), 0, 0, 0, 1, 5);
    for (let i = 0; i < p.count; i++) expect(p.color[i]).toBe(PLAYER_COLORS[5]);
  });

  it('draws nothing for a closed throttle — a coasting ship has no flame', () => {
    const p = pool();
    thrusterTrail(p, mulberry32(3), 0, 0, 0, 0, 5);
    expect(p.count).toBe(0);
  });

  it('makes a failing shield read thinner than a healthy one (GDD §2.6)', () => {
    const strong = pool();
    const weak = pool();
    shieldShimmer(strong, mulberry32(4), 0, 0, 80, 1);
    shieldShimmer(weak, mulberry32(4), 0, 0, 80, 0.1);
    // "Pressure beats regeneration" is legible from outside: an attacker can
    // see a shield failing before it pops.
    expect(weak.count).toBeLessThan(strong.count);
    expect(weak.alpha[0]!).toBeLessThan(strong.alpha[0]!);
  });

  it('makes the planet death slow and grey, not a firework (GDD §4.7)', () => {
    const home = pool();
    const ship = pool();
    planetDeath(home, mulberry32(6), 0, 0, 64);
    explosion(ship, mulberry32(6), 0, 0, 1);

    const longest = (p: ParticlePool) => Math.max(...[...p.ttl.subarray(0, p.count)]);
    const share = (p: ParticlePool, kind: number) =>
      [...p.kind.subarray(0, p.count)].filter((k) => k === kind).length / p.count;

    // The one effect in the set that takes its time…
    expect(longest(home)).toBeGreaterThan(longest(ship) * 2);
    // …and is mostly smoke and crust rather than embers.
    expect(share(home, PARTICLE.smoke)).toBeGreaterThan(share(ship, PARTICLE.smoke));
    expect(share(home, PARTICLE.ember)).toBeLessThan(share(ship, PARTICLE.ember));
  });
});

describe('VfxField — the routing table', () => {
  it('draws something for every tell kind except the one that is audio-only', () => {
    for (const kind of ALL_KINDS) {
      const field = new VfxField({ seed: 1 });
      const tells = new TellQueue(8);
      tells.push(kind, 100, 100, 0.5, 0.6, 1);
      field.consume(tells);
      if (kind === TELL.waveArrive) {
        // Documented: the wave's tell is the HUD clock and the rocks themselves;
        // the arena centre is usually off screen. Audio carries this one.
        expect(field.count).toBe(0);
      } else {
        expect(field.count, `${TELL_NAMES[kind]} drew nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('has a documented payload for every kind, so the columns cannot rot', () => {
    expect(Object.keys(TELL_PAYLOAD)).toHaveLength(TELL_COUNT);
    for (const kind of ALL_KINDS) {
      const note = TELL_PAYLOAD[kind];
      expect(note.at.length, TELL_NAMES[kind]).toBeGreaterThan(0);
      expect(note.angle.length, TELL_NAMES[kind]).toBeGreaterThan(0);
      expect(note.magnitude.length, TELL_NAMES[kind]).toBeGreaterThan(0);
    }
  });

  it('throttles held fire instead of spending the pool on it', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue(8);
    tells.push(TELL.mineHit, 0, 0, 0, 1, 0);

    field.consume(tells); // first tick bursts
    const first = field.count;
    field.update(1 / 60);
    field.consume(tells); // second tick, 16 ms later: too soon
    expect(field.count).toBe(first);

    field.update(0.06); // past the interval
    field.consume(tells);
    expect(field.count).toBeGreaterThan(first);
  });

  it('throttles each shooter on its own clock, per player', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue(8);
    tells.push(TELL.mineHit, 0, 0, 0, 1, 0);
    tells.push(TELL.mineHit, 0, 0, 0, 1, 1);
    field.consume(tells);
    // Two ships mining is two bursts, not one ship shadowing the other.
    expect(field.count).toBeGreaterThan(0);
    const both = field.count;
    field.update(1 / 60);
    field.consume(tells);
    expect(field.count).toBe(both);
  });

  it('holds the beat when a planet dies, and hands the same object to the mix', () => {
    const field = new VfxField({ seed: 1 });
    const tells = new TellQueue(8);
    tells.push(TELL.planetDeath, 500, 500, 0, 1, 2);
    field.consume(tells);
    expect(field.death.active).toBe(true);
    expect(field.death.gain).toBe(1); // the cut has not started yet
    field.update(HUSH_CUT_S);
    expect(field.death.gain).toBeCloseTo(0, 5);
  });

  it('resets to a fresh match, reseeded', () => {
    const field = new VfxField({ seed: 42 });
    const tells = new TellQueue(8);
    tells.push(TELL.shipExplode, 0, 0, 0, 1, 0);
    field.consume(tells);
    const first = [...field.pool.vx.subarray(0, field.pool.count)];

    field.reset();
    expect(field.count).toBe(0);
    expect(field.death.active).toBe(false);
    field.consume(tells);
    expect([...field.pool.vx.subarray(0, field.pool.count)]).toEqual(first);
  });

  it('thins every burst at low quality without losing a tell', () => {
    const counts = [1, 0.3].map((quality) => {
      const field = new VfxField({ seed: 1, quality });
      const tells = new TellQueue(64);
      for (const kind of ALL_KINDS) tells.push(kind, 0, 0, 0, 0.8, 0);
      field.consume(tells);
      return field.count;
    });
    expect(counts[1]!).toBeLessThan(counts[0]!);
    expect(counts[1]!).toBeGreaterThan(0);
  });
});

describe('the planet-death moment (GDD §4.7 — the tone contract)', () => {
  it('is three seconds of silence, cut fast and returned slowly', () => {
    const death = new DeathMoment();
    expect(death.gain).toBe(1);
    expect(death.active).toBe(false);

    death.trigger();
    expect(death.gain).toBe(1);

    death.update(HUSH_CUT_S / 2);
    expect(death.gain).toBeCloseTo(0.5, 5); // a fast cut, not a slow fade

    death.update(HUSH_CUT_S / 2);
    expect(death.gain).toBeCloseTo(0, 5);
    expect(death.silent).toBe(true);

    death.update(HUSH_S - HUSH_CUT_S - 0.01);
    expect(death.gain).toBe(0); // still nobody joking
    expect(death.remaining).toBeCloseTo(0.01, 5);

    death.update(0.01);
    expect(death.silent).toBe(false);
    expect(death.gain).toBeCloseTo(0, 5); // the return starts from zero

    death.update(HUSH_RETURN_S / 2);
    expect(death.gain).toBeCloseTo(0.5, 4); // …and takes its time

    death.update(HUSH_RETURN_S / 2);
    expect(death.gain).toBe(1);
    expect(death.active).toBe(false);
  });

  it('holds silence for the full three seconds, sampled the whole way', () => {
    const death = new DeathMoment();
    death.trigger();
    let t = 0;
    while (t < HUSH_S - 0.001) {
      death.update(1 / 60);
      t += 1 / 60;
      if (t > HUSH_CUT_S) expect(death.gain, `t=${t.toFixed(2)}`).toBe(0);
    }
  });

  it('refreshes rather than stacks — two deaths are one long quiet', () => {
    const death = new DeathMoment();
    death.trigger();
    death.update(1);
    death.trigger(); // a second home, a second later
    expect(death.remaining).toBe(HUSH_S);
    expect(death.count).toBe(2);
    death.update(HUSH_S + HUSH_RETURN_S);
    expect(death.active).toBe(false); // and not six seconds of it
  });

  it('ignores a negative or zero dt rather than running backwards', () => {
    const death = new DeathMoment();
    death.trigger();
    death.update(-5);
    expect(death.gain).toBe(1);
    expect(death.since).toBe(0);
  });

  it('resets for a rematch', () => {
    const death = new DeathMoment();
    death.trigger();
    death.update(0.5);
    death.reset();
    expect(death.active).toBe(false);
    expect(death.gain).toBe(1);
    expect(death.count).toBe(0);
  });
});
