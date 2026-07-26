/**
 * src/art/vfx/field.ts — tells in, particles out. OWNER: Art & Audio Agent.
 *
 * The routing table of the visible half of the mandate: one `switch` mapping
 * every {@link TELL} to the effect that shows it (`./emitters`). Its twin is
 * `../audio/engine.ts`, which switches over the same queue to *sound* the same
 * moments — so "every mechanic has a visible and audible tell" (GDD §3.6) is two
 * exhaustive switches over one enum rather than a promise.
 *
 * Owning both halves of the routing here also means the tone contract's quiet
 * has a single owner: the planet-death tell is what starts {@link DeathMoment},
 * and both the mix and the moment read the same object.
 *
 * ## Wiring it up (for the Platform Engineer's frame loop)
 *
 * ```ts
 * const field = new VfxField({ seed: matchSeed });
 * const observer = new WorldObserver({ local: mySlot });
 * const tells = new TellQueue();
 * // per frame:
 * tells.clear();
 * observer.observe(world, dt, tells);
 * field.consume(tells);          // and audio.consume(tells) — same queue
 * field.update(dt);
 * vfxLayer.draw(field.pool);     // ./layer, a plain Pixi Container
 * ```
 */

import { mulberry32, type Rng } from '@shared/types';
import { playerColor } from '../palette';
import { TELL, type TellQueue } from '../tells';
import { DeathMoment } from './death-moment';
import {
  asteroidBurst,
  asteroidCrack,
  bankOre,
  buildComplete,
  buildPlaced,
  collapsePulse,
  coreHit,
  explosion,
  holdFull,
  matchEnd,
  muzzleFlash,
  oreCollect,
  planetDeath,
  repairPulse,
  shieldDown,
  shieldShimmer,
  shotImpact,
  spawnGlow,
  spawnPulse,
  thrusterTrail,
  turretDown,
  upgradeBought,
  weaponImpact,
} from './emitters';
import { ParticlePool, PARTICLE_CAPACITY } from './particles';

/**
 * Minimum seconds between shot-impact bursts per player. A weapon fires every
 * tick it is held, and eight held weapons at 60 Hz would spend a third of the pool
 * on sparks nobody can resolve. Throttled, the impact still reads continuous —
 * sparks outlive the gap between bursts — at a fifth of the particles.
 */
const HIT_BURST_INTERVAL = 0.05;

/** Player slots the firing throttle tracks (the 8-slot roster, GDD §2.1, plus air). */
const SLOTS = 16;

/** Planet radius the tells' normalised magnitudes are unpacked against. */
const PLANET_RADIUS_REF = 64;

/** Ship radius the explosion magnitude is unpacked against. */
const SHIP_RADIUS_REF = 16;

/** Options for {@link VfxField}. */
export interface VfxFieldOptions {
  /** Particle capacity. Defaults to {@link PARTICLE_CAPACITY}. */
  readonly capacity?: number;
  /** Seed for the scatter RNG — pass the match seed and a replay looks identical. */
  readonly seed?: number;
  /**
   * Effect density, 0..1. This is the "reduce VFX" setting (GDD §4.3): it thins
   * every burst but removes no effect, so a phone dropping frames loses
   * particles and never loses a mechanic's tell.
   */
  readonly quality?: number;
}

/**
 * The visible half of the tell system: owns the particle pool, the scatter RNG,
 * and the planet-death moment.
 */
export class VfxField {
  /** The pool. Public so the draw layer can walk the columns (`./layer`). */
  readonly pool: ParticlePool;
  /** The three-second quiet. The audio engine reads the same object. */
  readonly death = new DeathMoment();

  /** Effect density, 0..1 — see {@link VfxFieldOptions.quality}. */
  quality: number;

  private rng: Rng;
  private readonly seed: number;
  private time = 0;
  /** Next time each slot's firing may burst again (see {@link HIT_BURST_INTERVAL}). */
  private readonly hitNext = new Float32Array(SLOTS);

  constructor(options: VfxFieldOptions = {}) {
    this.pool = new ParticlePool(options.capacity ?? PARTICLE_CAPACITY);
    this.seed = options.seed ?? 0x5f3759df;
    this.rng = mulberry32(this.seed);
    this.quality = options.quality ?? 1;
  }

  /**
   * Draw every tell in the queue. The queue is not consumed destructively — the
   * audio engine reads the same one — so the caller clears it once per frame.
   */
  consume(tells: TellQueue): void {
    const q = this.quality;
    const rng = this.rng;
    const pool = this.pool;

    for (let i = 0; i < tells.length; i++) {
      const x = tells.x[i]!;
      const y = tells.y[i]!;
      const angle = tells.angle[i]!;
      const mag = tells.magnitude[i]!;
      const player = tells.player[i]!;

      switch (tells.kindAt(i)) {
        case TELL.mineHit:
          if (this.hitReady(player)) weaponImpact(pool, rng, x, y, angle, mag, playerColor(player), false, q);
          break;
        case TELL.weaponHit:
          if (this.hitReady(player)) weaponImpact(pool, rng, x, y, angle, mag, playerColor(player), true, q);
          break;
        case TELL.rockCrack:
          asteroidCrack(pool, rng, x, y, 14, Math.round(mag * 2), q);
          break;
        case TELL.rockBurst:
          asteroidBurst(pool, rng, x, y, Math.max(6, mag * 24), q);
          break;
        case TELL.oreCollect:
          oreCollect(pool, rng, x, y, angle, q);
          break;
        case TELL.holdFull:
          holdFull(pool, rng, x, y, q);
          break;

        case TELL.turretFire:
          muzzleFlash(pool, rng, x, y, angle, q);
          break;
        case TELL.shotImpact:
          shotImpact(pool, rng, x, y, angle, q);
          break;
        case TELL.shieldHit:
          shieldShimmer(pool, rng, x, y, PLANET_RADIUS_REF * 1.35, mag, q);
          break;
        case TELL.shieldDown:
          shieldDown(pool, rng, x, y, Math.max(20, mag * PLANET_RADIUS_REF), q);
          break;
        case TELL.coreHit:
          coreHit(pool, rng, x, y, PLANET_RADIUS_REF * 0.5, q);
          break;
        case TELL.turretDown:
          turretDown(pool, rng, x, y, q);
          break;
        case TELL.shipExplode:
          explosion(pool, rng, x, y, Math.max(0.4, mag * SHIP_RADIUS_REF) / SHIP_RADIUS_REF, q);
          break;
        case TELL.shipSpawn:
          spawnGlow(pool, rng, x, y, 18, q);
          break;
        case TELL.spawnPulse:
          spawnPulse(pool, x, y, 18);
          break;
        case TELL.thrust:
          thrusterTrail(pool, rng, x, y, angle, mag, player, q);
          break;

        case TELL.buildPlaced:
          buildPlaced(pool, rng, x, y, angle, q);
          break;
        case TELL.buildComplete:
          buildComplete(pool, rng, x, y, angle, q);
          break;
        case TELL.repairTick:
          repairPulse(pool, rng, x, y, PLANET_RADIUS_REF * 0.6, q);
          break;
        case TELL.bankOre:
          bankOre(pool, rng, x, y, mag, q);
          break;
        case TELL.upgradeBought:
          upgradeBought(pool, rng, x, y, q);
          break;

        case TELL.collapseBegin:
          collapsePulse(pool, x, y, 420);
          break;
        case TELL.planetDeath:
          // The moment, and the quiet that goes with it (GDD §4.7).
          planetDeath(pool, rng, x, y, Math.max(24, mag * PLANET_RADIUS_REF), q);
          this.death.trigger();
          break;
        case TELL.matchEnd:
          matchEnd(pool, rng, x, y, q);
          break;

        // The wave clock is the HUD's tell for an arriving wave (GDD §2.2) and
        // the field spawns rocks the player can see; there is nothing useful to
        // draw at the arena centre, which is usually off screen. Audio only.
        case TELL.waveArrive:
          break;
      }
    }
  }

  /** Advance particles and the death moment. */
  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.time += step;
    this.pool.update(step);
    this.death.update(step);
  }

  /** Clear the field and reseed the scatter — a new match, or a rejoin. */
  reset(): void {
    this.pool.clear();
    this.death.reset();
    this.rng = mulberry32(this.seed);
    this.time = 0;
    this.hitNext.fill(0);
  }

  /** Live particles. */
  get count(): number {
    return this.pool.count;
  }

  /** Whether this slot's firing may throw sparks again yet. */
  private hitReady(player: number): boolean {
    const slot = player >= 0 && player < SLOTS ? player : SLOTS - 1;
    if (this.time < this.hitNext[slot]!) return false;
    this.hitNext[slot] = this.time + HIT_BURST_INTERVAL;
    return true;
  }
}
