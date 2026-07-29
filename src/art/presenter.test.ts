/**
 * The façade, checked as the thing it exists to prevent.
 *
 * `06b5c31` in this repo is a retraction: *"M2 marked not-done — its features
 * were merged but never wired into the client."* Six well-tested objects that
 * have to be constructed in the right order and called in the right sequence
 * every frame is exactly the shape of work that gets merged and not wired, so
 * `./presenter` collapses them into one object and two calls — and this file
 * asserts those two calls actually do all of it.
 *
 * Runs headless: no PixiJS, no AudioContext. `attach()` is the only call that
 * needs a renderer, and it is deliberately separate from the constructor.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step, type World } from '../sim';
import { ArtPresenter } from './presenter';
import type { AudioContextLike } from './audio/context';
import { HUSH_S } from './vfx/death-moment';
import { TELL } from './tells';
import type { WorldView } from './vfx/observer';

function match(): World {
  return createWorld({
    seed: 4242,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Excavator },
    ],
    bounds: { width: 1400, height: 1400 },
    asteroidCount: 16,
  });
}

/** A 2v2 TEAMS world — team 0 is {0,2}, team 1 is {1,3}. The alarm must open to a
 *  teammate's home (owner 2 for slot 0) yet stay shut for either enemy (1, 3). */
function teamsMatch(): World {
  return createWorld({
    seed: 4242,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
      { id: 1, shipClass: ShipClass.Vanguard, team: 1 },
      { id: 2, shipClass: ShipClass.Vanguard, team: 0 },
      { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
    ],
    bounds: { width: 1400, height: 1400 },
    asteroidCount: 16,
  });
}

/** Sustained fire on the home owned by `victim`, seen from slot `localSlot`; the
 *  returned flag is whether that listener's under-attack alarm ended up ringing. */
function siegeRings(world: World, localSlot: number, victim: number): boolean {
  const art = new ArtPresenter({ local: localSlot });
  art.observe(world, 1 / 60); // prime in silence
  const home = world.stations.find((p) => p.owner === victim)!;
  for (let tick = 0; tick < 120; tick++) {
    home.coreHp -= 0.1; // sustained, not a taunt-tap
    art.observe(world, 1 / 60);
  }
  return art.underAttack;
}

describe('ArtPresenter — one object, two calls a frame', () => {
  it('runs a real match with no renderer and no audio hardware', () => {
    const art = new ArtPresenter({ local: 0, seed: 4242 });
    const world = match();
    const inputs: never[] = [];

    for (let tick = 0; tick < 900; tick++) {
      step(world, inputs, 1 / 60);
      art.observe(world, 1 / 60);
      art.render(); // a no-op until attach(): safe to call unconditionally
    }
    expect(art.tells.dropped).toBe(0);
    expect(art.particleCount).toBeGreaterThanOrEqual(0);
  });

  it('primes in silence, so a fresh match does not open with a barrage', () => {
    const art = new ArtPresenter({ local: 0 });
    const world = match();
    art.observe(world, 1 / 60);
    expect(art.tells.length).toBe(0);
    expect(art.particleCount).toBe(0);
  });

  it('draws and sounds from the same frame of tells', () => {
    const art = new ArtPresenter({ local: 0 });
    const world = match();
    art.observe(world, 1 / 60); // prime

    // A rock vanishes: mined out. Both halves should react to the one tell.
    world.asteroids.length = 0;
    art.observe(world, 1 / 60);

    expect(art.tells.has(TELL.rockBurst)).toBe(true);
    expect(art.particleCount).toBeGreaterThan(0);
    expect(art.audio.audible).toBe(false); // silent, but it consumed the queue
  });

  it('shares one death moment between the picture and the mix (GDD §4.7)', () => {
    const art = new ArtPresenter({ local: 0 });
    const world = match();
    art.observe(world, 1 / 60);

    const station = world.stations[1]!;
    station.coreHp = 0;
    station.alive = false;
    art.observe(world, 1 / 60);

    expect(art.tells.has(TELL.stationDeath)).toBe(true);
    expect(art.field.death).toBe(art.audio.death); // literally the same object
    expect(art.field.death.count).toBe(1); // triggered once, not twice
    for (let t = 0; t < 0.2; t += 1 / 60) art.observe(world, 1 / 60);
    expect(art.hushed).toBe(true);
    for (let t = 0; t < HUSH_S; t += 1 / 60) art.observe(world, 1 / 60);
    expect(art.hushed).toBe(false);
  });

  it('exposes the alarm the HUD arrow should read (GDD §2.2)', () => {
    const art = new ArtPresenter({ local: 0 });
    const world = match();
    art.observe(world, 1 / 60);

    const home = world.stations.find((p) => p.owner === 0)!;
    // Sustained fire held on the core: sustained, not a taunt-tap.
    for (let tick = 0; tick < 120; tick++) {
      home.coreHp -= 0.1;
      art.observe(world, 1 / 60);
    }
    expect(art.underAttack).toBe(true);

    // …and it does not ring for a siege three stations away.
    const other = new ArtPresenter({ local: 1 });
    const world2 = match();
    other.observe(world2, 1 / 60);
    const notMine = world2.stations.find((p) => p.owner === 0)!;
    for (let tick = 0; tick < 120; tick++) {
      notMine.coreHp -= 0.1;
      other.observe(world2, 1 / 60);
    }
    expect(other.underAttack).toBe(false);
  });

  it('TEAMS: a teammate under siege rings your alarm; neither enemy under siege does (s5)', () => {
    // The alarm belongs to your SIDE, not your slot (developer report s5). Each
    // call is its own world so the sieges do not bleed together.
    expect(siegeRings(teamsMatch(), 0, 0)).toBe(true); // your own home
    expect(siegeRings(teamsMatch(), 0, 2)).toBe(true); // your TEAMMATE's home — the fix
    expect(siegeRings(teamsMatch(), 0, 1)).toBe(false); // an enemy's home
    expect(siegeRings(teamsMatch(), 0, 3)).toBe(false); // the other enemy's home
  });

  it('does not ring for the collapse core-entropy — the "alarm out of nowhere" phantom (s5)', () => {
    const art = new ArtPresenter({ local: 0 });
    const world = match();
    art.observe(world, 1 / 60); // prime

    // Enter collapse and let the reactor decay on its own — no attacker present.
    world.match.phase = 'collapse';
    const home = world.stations.find((p) => p.owner === 0)!;
    for (let tick = 0; tick < 240; tick++) {
      home.coreHp -= 0.1; // exactly the entropy the sim applies during collapse
      art.observe(world, 1 / 60);
    }
    expect(art.underAttack).toBe(false); // entropy is not a siege (GDD §2.3 vs §2.2)
  });

  it('thins effects on the reduce-VFX setting without losing one (GDD §4.3)', () => {
    const counts = [1, 0.25].map((quality) => {
      const art = new ArtPresenter({ local: 0, seed: 7 });
      const world = match();
      art.observe(world, 1 / 60);
      art.setQuality(quality);
      world.asteroids.length = 0;
      art.observe(world, 1 / 60);
      return art.particleCount;
    });
    expect(counts[1]!).toBeLessThan(counts[0]!);
    expect(counts[1]!).toBeGreaterThan(0);
  });

  it('clamps a nonsense quality rather than emitting nothing', () => {
    const art = new ArtPresenter();
    art.setQuality(-3);
    expect(art.field.quality).toBe(0);
    art.setQuality(50);
    expect(art.field.quality).toBe(1);
  });

  it('resets for a rematch and replays the same match identically', () => {
    const run = (art: ArtPresenter): number[] => {
      const world = match();
      const inputs: never[] = [];
      const counts: number[] = [];
      for (let tick = 0; tick < 300; tick++) {
        step(world, inputs, 1 / 60);
        art.observe(world, 1 / 60);
        counts.push(art.particleCount);
      }
      return counts;
    };
    const art = new ArtPresenter({ local: 0, seed: 99 });
    const first = run(art);
    art.reset();
    expect(art.particleCount).toBe(0);
    expect(run(art)).toEqual(first); // same seed, same scatter (GDD §4.1)
  });

  it('is safe to unlock, dispose and configure with no audio at all', () => {
    const art = new ArtPresenter({ local: 0 });
    art.unlock(null); // Node, the server, the harness
    art.setListener(100, 200);
    art.setMasterVolume(0.5);
    art.setAmbient(false);
    art.setLocal(3);
    art.dispose();
    expect(art.audio.audible).toBe(false);
  });

  it('arms the unlock when there is a context to unlock', () => {
    // The mobile gesture (GDD risk 7), reached through the façade rather than
    // left as a step the caller has to remember.
    const gestures: string[] = [];
    const target = {
      addEventListener: (type: string) => gestures.push(type),
      removeEventListener: () => undefined,
    };
    const ctx: AudioContextLike = {
      sampleRate: 44100,
      currentTime: 0,
      state: 'suspended',
      destination: { connect: () => undefined, disconnect: () => undefined },
      createGain: () => ({
        gain: {
          value: 1,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        connect: () => undefined,
        disconnect: () => undefined,
      }),
      createBufferSource: () => ({
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: {
          value: 1,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        start: () => undefined,
        stop: () => undefined,
        connect: () => undefined,
        disconnect: () => undefined,
      }),
      createBuffer: (_c: number, length: number, sampleRate: number) => ({
        duration: length / sampleRate,
        length,
        sampleRate,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(length),
      }),
      createStereoPanner: () => ({
        pan: {
          value: 0,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        connect: () => undefined,
        disconnect: () => undefined,
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: {
          value: 20000,
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          cancelScheduledValues: () => undefined,
        },
        connect: () => undefined,
        disconnect: () => undefined,
      }),
      resume: async () => undefined,
    };

    const art = new ArtPresenter({ local: 0, context: ctx });
    expect(art.audio.audible).toBe(true);
    art.unlock(target);
    expect(gestures.length).toBeGreaterThan(0);
    art.unlock(target); // idempotent — one presenter, one unlock
    const armed = gestures.length;
    art.observe({ ...(match() as unknown as WorldView) }, 1 / 60);
    expect(gestures.length).toBe(armed);
    art.dispose();
  });
});
