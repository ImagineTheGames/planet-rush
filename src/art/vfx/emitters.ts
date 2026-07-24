/**
 * src/art/vfx/emitters.ts — the specified VFX set. OWNER: Art & Audio Agent.
 *
 * GDD §3.6 does not ask for "some effects", it names them: *"beam impacts,
 * asteroid crack-and-burst, shield shimmer, turret muzzle flashes, explosions,
 * thruster trails, spawn-protection glow, and the planet-death moment."* Each
 * one is a function here, each writes into the fixed-capacity pool
 * (`./particles`), and each is judged against the tone contract (style-guide §8):
 *
 * > *Arcade on the surface:* beam impacts, muzzle flashes, thruster trails and
 * > spawn glow lean **fun and readable** — bright, punchy, generous.
 * > *A small ache underneath:* the planet-death moment is the exception, and it
 * > is deliberately **not** a firework. See {@link planetDeath}.
 *
 * ## Determinism
 *
 * Every scatter draws from an injected `Rng` — the ratified mulberry32
 * (`@shared/types`), never `Math.random` — so a replay looks like the match it
 * replays and a golden test can assert exact particle counts and positions
 * (GDD §4.1).
 *
 * ## Quality
 *
 * Every emitter takes a trailing `quality` multiplier, 0..1. That is the hook
 * for the "reduce VFX" setting GDD §4.3 requires as the mobile escape hatch
 * ("sustained drops below the floor auto-engage the reduce-VFX setting"): the
 * *set* of effects never changes — every mechanic keeps its visible tell — only
 * how many particles each one spends. An effect that would vanish entirely at
 * low quality would be a mechanic going silent, so each emitter keeps at least
 * one particle.
 *
 * ## Budget
 *
 * The costly bursts, at `quality = 1`: explosion ≈ 34, planet death ≈ 96,
 * asteroid burst ≈ 20, muzzle flash ≈ 5, beam impact ≈ 4 per firing tick. Eight
 * ships beaming, four turrets firing and two rocks bursting on the same frame is
 * ≈ 120 particles against a 1600 capacity, so the pool only starts recycling in
 * genuinely extraordinary moments — which is exactly when nobody can tell.
 */

import type { Rng } from '@shared/types';
import { playerColor } from '../palette';
import { PARTICLE, particleKind, type ParticleKind } from './kinds';
import type { ParticlePool } from './particles';

// ---------------------------------------------------------------------------
// Scatter helpers
// ---------------------------------------------------------------------------

/** A number in [-a, a]. */
function spread(rng: Rng, a: number): number {
  return (rng.next() * 2 - 1) * a;
}

/** A number in [lo, hi]. */
function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng.next() * (hi - lo);
}

/** Scale a particle count by quality, never below one — see the module doc. */
function budget(base: number, quality: number): number {
  const q = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  return Math.max(1, Math.round(base * q));
}

/**
 * The colour a kind is allowed to be painted this emission.
 *
 * Kinds declaring `tint: 'fixed'` keep their own palette colour no matter what
 * a caller passes; only the two looks the style guide puts on the identity list
 * — engine flame and beam tint — accept a player's colour (`./kinds`). The rule
 * is enforced here rather than trusted, because "pass the right colour" is
 * exactly the kind of discipline that fails on the tenth call site.
 */
export function tintFor(kind: ParticleKind, requested: number): number {
  const spec = particleKind(kind);
  return spec.tint === 'identity' ? requested : spec.color;
}

// ---------------------------------------------------------------------------
// Mine — the beam, the rock, the payout
// ---------------------------------------------------------------------------

/**
 * **Beam impact** (GDD §3.6). The cutting torch biting something: a spray of
 * plasma sparks back along the beam, plus the debris of whatever it is chewing —
 * rock chips off an asteroid, red flecks off a hull.
 *
 * The two variants are the visible half of the same split the audio makes with
 * its two beam voices (`../audio/beams`), so a player looking away still knows
 * from the sound what a looking player knows from the sparks.
 *
 * @param power  Beam power 0..1 — mining speed and weapon damage are one stat.
 * @param tint   The firing player's colour (beams take player tint, §3).
 * @param onHull True when the beam is on hull/turret/shield/core, not rock.
 */
export function beamImpact(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  power: number,
  tint: number,
  onHull: boolean,
  quality = 1,
): void {
  const back = angle + Math.PI;
  const sparks = budget(2 + Math.round(power * 2), quality);
  const color = tintFor(PARTICLE.spark, tint);
  for (let i = 0; i < sparks; i++) {
    const a = back + spread(rng, 0.9);
    const speed = between(rng, 40, 130) * (0.6 + power * 0.6);
    pool.emit(
      PARTICLE.spark,
      color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.1, 0.22),
      between(rng, 1.4, 2.6),
      0.2,
      a,
      0,
      6,
      0.9,
    );
  }

  const debris = budget(2, quality);
  for (let i = 0; i < debris; i++) {
    const a = back + spread(rng, 1.2);
    const speed = between(rng, 30, 90);
    if (onHull) {
      // Hull, turret, shield or core: this is damage, so it spatters red (§2).
      pool.emit(
        PARTICLE.fleck,
        particleKind(PARTICLE.fleck).color,
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        between(rng, 0.2, 0.4),
        between(rng, 0.8, 1.6),
        0.3,
        rng.next() * Math.PI * 2,
        spread(rng, 8),
        1.6,
        0.85,
      );
    } else {
      pool.emit(
        PARTICLE.chip,
        particleKind(PARTICLE.chip).color,
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        between(rng, 0.25, 0.5),
        between(rng, 0.9, 1.8),
        0.4,
        rng.next() * Math.PI * 2,
        spread(rng, 6),
        1.2,
        0.9,
      );
    }
  }
}

/**
 * **Asteroid crack** (GDD §3.6, §5.5). A rock advancing through one of its three
 * crack stages throws a handful of chips: the player's confirmation that beam
 * time is turning into a payout, on top of the sprite swap the atlas does.
 *
 * @param stage The new crack stage, 0..2 — later stages throw more.
 */
export function asteroidCrack(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  stage: number,
  quality = 1,
): void {
  const chips = budget(4 + stage * 2, quality);
  for (let i = 0; i < chips; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 25, 70);
    pool.emit(
      PARTICLE.chip,
      particleKind(PARTICLE.chip).color,
      x + Math.cos(a) * radius * 0.7,
      y + Math.sin(a) * radius * 0.7,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.35, 0.7),
      between(rng, 1.2, 2.4),
      0.5,
      rng.next() * Math.PI * 2,
      spread(rng, 5),
      1.1,
      0.95,
    );
  }
}

/**
 * **Asteroid burst** (GDD §3.6, §2.2 "burst into ore chunks"). The rock is
 * mined out: its body comes apart in chips and the ore it was holding flashes
 * out as yellow glints before the real chunks (sim entities) start drifting.
 *
 * The yellow here is legal and load-bearing: this *is* ore, which is one of the
 * two things signal yellow is allowed to mean (style-guide §2).
 */
export function asteroidBurst(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  quality = 1,
): void {
  const chips = budget(10, quality);
  for (let i = 0; i < chips; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 40, 140);
    pool.emit(
      PARTICLE.chip,
      particleKind(PARTICLE.chip).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.4, 0.9),
      between(rng, 1.6, 3.2),
      0.6,
      rng.next() * Math.PI * 2,
      spread(rng, 7),
      1.0,
      1,
    );
  }
  const glints = budget(8, quality);
  for (let i = 0; i < glints; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 25, 85);
    pool.emit(
      PARTICLE.oreBit,
      particleKind(PARTICLE.oreBit).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.5, 1.1),
      between(rng, 1.2, 2.2),
      0.8,
      rng.next() * Math.PI * 2,
      spread(rng, 4),
      1.4,
      1,
    );
  }
  ring(pool, x, y, radius * 0.6, radius * 2.2, 0.35, 0.5);
}

/** **Ore collected**: a couple of glints folding into the hold (GDD §2.3). */
export function oreCollect(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  quality = 1,
): void {
  const n = budget(2, quality);
  for (let i = 0; i < n; i++) {
    const a = angle + spread(rng, 2.4);
    pool.emit(
      PARTICLE.oreBit,
      particleKind(PARTICLE.oreBit).color,
      x + Math.cos(a) * 10,
      y + Math.sin(a) * 10,
      -Math.cos(a) * 40,
      -Math.sin(a) * 40,
      0.28,
      1.4,
      0.2,
      a,
      spread(rng, 6),
      2,
      1,
    );
  }
}

/** **Hold full** (GDD §2.2, the flashing ore HUD): a tight yellow pulse. */
export function holdFull(pool: ParticlePool, rng: Rng, x: number, y: number, quality = 1): void {
  const n = budget(6, quality);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + spread(rng, 0.2);
    pool.emit(
      PARTICLE.oreBit,
      particleKind(PARTICLE.oreBit).color,
      x,
      y,
      Math.cos(a) * 55,
      Math.sin(a) * 55,
      0.4,
      1.6,
      0.4,
      a,
      0,
      3,
      1,
    );
  }
}

/** **Ore banked** (GDD §2.3): the safe half of the economy, landing home. */
export function bankOre(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  amount: number,
  quality = 1,
): void {
  const n = budget(3 + Math.round(amount * 5), quality);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = between(rng, 26, 44);
    pool.emit(
      PARTICLE.oreBit,
      particleKind(PARTICLE.oreBit).color,
      x + Math.cos(a) * r,
      y + Math.sin(a) * r,
      -Math.cos(a) * r * 1.6,
      -Math.sin(a) * r * 1.6,
      between(rng, 0.35, 0.6),
      1.8,
      0.3,
      a,
      0,
      0.8,
      1,
    );
  }
}

// ---------------------------------------------------------------------------
// Fight — flashes, shimmer, fireworks
// ---------------------------------------------------------------------------

/**
 * **Turret muzzle flash** (GDD §3.6). One flare at the barrel tip and a short
 * cone of sparks: turrets "telegraph their threat" (style-guide §6), and the
 * flash is what tells a besieger, from off screen, that a turret is live.
 */
export function muzzleFlash(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  quality = 1,
): void {
  pool.emit(
    PARTICLE.flare,
    particleKind(PARTICLE.flare).color,
    x,
    y,
    0,
    0,
    0.09,
    5.5,
    1.5,
    angle,
    0,
    0,
    0.95,
  );
  const sparks = budget(4, quality);
  for (let i = 0; i < sparks; i++) {
    const a = angle + spread(rng, 0.35);
    const speed = between(rng, 80, 190);
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.08, 0.16),
      1.8,
      0.3,
      a,
      0,
      5,
      0.9,
    );
  }
}

/** **Turret shot landing**: a small bite, distinct from the beam's. */
export function shotImpact(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  quality = 1,
): void {
  const back = angle + Math.PI;
  const n = budget(3, quality);
  for (let i = 0; i < n; i++) {
    const a = back + spread(rng, 1.1);
    const speed = between(rng, 40, 110);
    pool.emit(
      PARTICLE.fleck,
      particleKind(PARTICLE.fleck).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.15, 0.3),
      1.3,
      0.3,
      a,
      spread(rng, 8),
      2,
      0.9,
    );
  }
}

/**
 * **Shield shimmer** (GDD §3.6). A bubble taking a hit lights up as a ring at
 * its own radius — and the weaker it is, the thinner and shorter the shimmer,
 * so "pressure beats regeneration" (GDD §2.6) is legible from outside: an
 * attacker can *see* a shield failing before it pops.
 *
 * @param strength Remaining shield strength, 0..1.
 */
export function shieldShimmer(
  pool: ParticlePool,
  rng: Rng,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
  quality = 1,
): void {
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  ring(pool, cx, cy, radius * 0.94, radius * 1.06, 0.22 + 0.2 * s, 0.25 + 0.5 * s);
  const sparks = budget(2 + Math.round(s * 3), quality);
  for (let i = 0; i < sparks; i++) {
    const a = rng.next() * Math.PI * 2;
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      cx + Math.cos(a) * radius,
      cy + Math.sin(a) * radius,
      Math.cos(a) * 30,
      Math.sin(a) * 30,
      between(rng, 0.15, 0.3),
      between(rng, 1.2, 2.2),
      0.3,
      a,
      0,
      3,
      0.5 + 0.4 * s,
    );
  }
}

/** **Shield down**: the bubble collapsing inward, not outward — it failed. */
export function shieldDown(
  pool: ParticlePool,
  rng: Rng,
  cx: number,
  cy: number,
  radius: number,
  quality = 1,
): void {
  ring(pool, cx, cy, radius * 1.1, radius * 0.4, 0.5, 0.7);
  const n = budget(10, quality);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + spread(rng, 0.3);
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      cx + Math.cos(a) * radius,
      cy + Math.sin(a) * radius,
      -Math.cos(a) * between(rng, 20, 60),
      -Math.sin(a) * between(rng, 20, 60),
      between(rng, 0.3, 0.55),
      2.2,
      0.4,
      a,
      0,
      1.5,
      0.8,
    );
  }
}

/** **Core hit** (GDD §2.2): the damage half of the under-attack tell. */
export function coreHit(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  quality = 1,
): void {
  const n = budget(5, quality);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 35, 95);
    pool.emit(
      PARTICLE.fleck,
      particleKind(PARTICLE.fleck).color,
      x + Math.cos(a) * radius * 0.4,
      y + Math.sin(a) * radius * 0.4,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.25, 0.5),
      between(rng, 1.4, 2.4),
      0.4,
      a,
      spread(rng, 6),
      1.4,
      0.9,
    );
  }
}

/**
 * **Explosion** (GDD §3.6). A ship dying, and the tone paragraph is explicit
 * about what that should feel like: *"ships are toys, explosions are
 * fireworks."* So: a bright flare, embers thrown wide, a shockwave ring, and a
 * little debris — generous and quickly over. Ships are cheap and respawn free
 * (GDD §2.7); this is a firework, not a funeral. The funeral is
 * {@link planetDeath}.
 *
 * @param scale 0..1, from the hull that made it.
 */
export function explosion(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  scale = 1,
  quality = 1,
): void {
  const s = 0.6 + scale * 0.8;
  pool.emit(PARTICLE.flare, particleKind(PARTICLE.flare).color, x, y, 0, 0, 0.16, 14 * s, 3, 0, 0, 0, 1);
  ring(pool, x, y, 4 * s, 46 * s, 0.42, 0.8);

  const embers = budget(18, quality);
  for (let i = 0; i < embers; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 60, 240) * s;
    pool.emit(
      PARTICLE.ember,
      particleKind(PARTICLE.ember).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.35, 0.8),
      between(rng, 2.2, 4.4) * s,
      0.5,
      a,
      0,
      1.8,
      1,
    );
  }
  const shards = budget(8, quality);
  for (let i = 0; i < shards; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 40, 150) * s;
    pool.emit(
      PARTICLE.shard,
      particleKind(PARTICLE.shard).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.6, 1.3),
      between(rng, 1.8, 3.4) * s,
      0.8,
      rng.next() * Math.PI * 2,
      spread(rng, 9),
      1.0,
      0.9,
    );
  }
  const smoke = budget(6, quality);
  for (let i = 0; i < smoke; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 10, 40) * s;
    pool.emit(
      PARTICLE.smoke,
      particleKind(PARTICLE.smoke).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.9, 1.6),
      3 * s,
      12 * s,
      rng.next() * Math.PI * 2,
      spread(rng, 1),
      0.9,
      0.55,
    );
  }
}

/** **Turret destroyed** (GDD §2.6): a deterrent picked off. Small, and metal. */
export function turretDown(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  quality = 1,
): void {
  pool.emit(PARTICLE.flare, particleKind(PARTICLE.flare).color, x, y, 0, 0, 0.12, 8, 2, 0, 0, 0, 0.9);
  const shards = budget(7, quality);
  for (let i = 0; i < shards; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 40, 130);
    pool.emit(
      PARTICLE.shard,
      particleKind(PARTICLE.shard).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.5, 1.0),
      between(rng, 1.6, 3),
      0.7,
      rng.next() * Math.PI * 2,
      spread(rng, 8),
      1.2,
      0.9,
    );
  }
}

// ---------------------------------------------------------------------------
// Fly — thrust, spawn
// ---------------------------------------------------------------------------

/**
 * **Thruster trail** (GDD §3.6). Emitted every frame a ship is under power, in
 * the pilot's colour — engine flame is one of the few places identity colour is
 * allowed to live (style-guide §3 rule 2), and it is the cheapest way to read
 * *who* is coming at you before the hull decal is legible.
 *
 * @param throttle 0..1, measured from the ship's own acceleration (`./observer`).
 */
export function thrusterTrail(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  throttle: number,
  playerId: number,
  quality = 1,
): void {
  const t = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
  if (t <= 0) return;
  const color = tintFor(PARTICLE.trail, playerColor(playerId));
  const n = budget(1 + Math.round(t), quality);
  for (let i = 0; i < n; i++) {
    const a = angle + spread(rng, 0.25);
    const speed = between(rng, 20, 70) * t;
    pool.emit(
      PARTICLE.trail,
      color,
      x + spread(rng, 1.5),
      y + spread(rng, 1.5),
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 0.18, 0.34) * (0.6 + t * 0.6),
      between(rng, 2.2, 3.6) * (0.5 + t * 0.6),
      0.4,
      a,
      0,
      2.2,
      0.55 + 0.35 * t,
    );
  }
}

/**
 * **Spawn-protection glow** (GDD §3.6, §2.1). A ship arriving under ten seconds
 * of protection: one bright ring outward, so a player knows their own respawn
 * landed and an attacker knows not to waste a beam on it.
 */
export function spawnGlow(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  quality = 1,
): void {
  ring(pool, x, y, radius * 0.5, radius * 4, 0.55, 0.85);
  const sparks = budget(8, quality);
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * Math.PI * 2 + spread(rng, 0.2);
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      x + Math.cos(a) * radius,
      y + Math.sin(a) * radius,
      Math.cos(a) * 70,
      Math.sin(a) * 70,
      between(rng, 0.25, 0.45),
      2.4,
      0.4,
      a,
      0,
      2.4,
      0.85,
    );
  }
}

/** The heartbeat of the same glow while protection lasts — small, and quiet. */
export function spawnPulse(pool: ParticlePool, x: number, y: number, radius: number): void {
  ring(pool, x, y, radius * 1.2, radius * 2.1, 0.5, 0.32);
}

// ---------------------------------------------------------------------------
// Spend — building and repair
// ---------------------------------------------------------------------------

/** **Order placed** (GDD §2.5): ore is gone, the clock on a turret starts. */
export function buildPlaced(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  quality = 1,
): void {
  const n = budget(5, quality);
  for (let i = 0; i < n; i++) {
    const a = angle + spread(rng, 0.9);
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      x + Math.cos(a) * 26,
      y + Math.sin(a) * 26,
      Math.cos(a) * 18,
      Math.sin(a) * 18,
      between(rng, 0.3, 0.6),
      1.8,
      0.4,
      a,
      0,
      1.5,
      0.7,
    );
  }
}

/** **Construction finished**: the defence a player paid for, arriving. */
export function buildComplete(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  angle: number,
  quality = 1,
): void {
  pool.emit(PARTICLE.flare, particleKind(PARTICLE.flare).color, x, y, 0, 0, 0.2, 9, 2, angle, 0, 0, 0.9);
  ring(pool, x, y, 6, 34, 0.4, 0.6);
  const n = budget(6, quality);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      x,
      y,
      Math.cos(a) * between(rng, 40, 90),
      Math.sin(a) * between(rng, 40, 90),
      between(rng, 0.25, 0.45),
      2,
      0.3,
      a,
      0,
      2.5,
      0.8,
    );
  }
}

/**
 * **Repair channel** (GDD §2.5). Patina motes drifting into the core while the
 * channel is held — patina is the repair colour by contract (style-guide §1),
 * and the pulse stopping the instant a hit lands is the visible form of "any
 * damage interrupts the channel."
 */
export function repairPulse(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  quality = 1,
): void {
  const n = budget(4, quality);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = radius * between(rng, 1.05, 1.5);
    pool.emit(
      PARTICLE.mote,
      particleKind(PARTICLE.mote).color,
      x + Math.cos(a) * r,
      y + Math.sin(a) * r,
      -Math.cos(a) * r * 1.1,
      -Math.sin(a) * r * 1.1,
      between(rng, 0.5, 0.9),
      2.4,
      0.6,
      a,
      0,
      0.6,
      0.75,
    );
  }
}

/** **Upgrade bought** (GDD §2.5): the other half of the economy, confirmed. */
export function upgradeBought(pool: ParticlePool, rng: Rng, x: number, y: number, quality = 1): void {
  const n = budget(5, quality);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + spread(rng, 0.6);
    pool.emit(
      PARTICLE.spark,
      particleKind(PARTICLE.spark).color,
      x + spread(rng, 8),
      y + spread(rng, 8),
      Math.cos(a) * between(rng, 30, 70),
      Math.sin(a) * between(rng, 30, 70),
      between(rng, 0.35, 0.6),
      1.8,
      0.3,
      a,
      0,
      1.2,
      0.85,
    );
  }
}

// ---------------------------------------------------------------------------
// The one serious thing
// ---------------------------------------------------------------------------

/**
 * **The planet-death moment** (GDD §3.6, §4.7 tone paragraph).
 *
 * > *"But homes are the one serious thing in it — when a planet dies, the game
 * > goes briefly quiet, the wreck stays on the map all match, and nobody jokes
 * > for three seconds."*
 *
 * This is the one effect in the set that is deliberately **not** a firework. A
 * ship exploding is bright, fast and over; a home dying is slow, grey and long:
 * a single wide shockwave, crust shards thrown lazily, and smoke that keeps
 * rising for seconds afterwards — the burning planet that "reads from further
 * away than its numbers do" (style-guide §5). The colour drains out of it too:
 * shards and smoke are ash, not plasma.
 *
 * The audible half is the *absence* of sound — see `./death-moment` for the
 * three-second hush this fires alongside.
 */
export function planetDeath(
  pool: ParticlePool,
  rng: Rng,
  x: number,
  y: number,
  radius: number,
  quality = 1,
): void {
  // One slow shockwave, four times the planet's own size. It expands over most
  // of the hush, so the moment has a shape a player can watch end.
  ring(pool, x, y, radius * 0.8, radius * 4.5, 2.4, 0.5);

  const shards = budget(26, quality);
  for (let i = 0; i < shards; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 25, 110);
    pool.emit(
      PARTICLE.shard,
      particleKind(PARTICLE.shard).color,
      x + Math.cos(a) * radius * 0.7,
      y + Math.sin(a) * radius * 0.7,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 1.6, 3.2),
      between(rng, 3, 7),
      1.2,
      rng.next() * Math.PI * 2,
      spread(rng, 3),
      0.5,
      0.95,
    );
  }

  const smoke = budget(34, quality);
  for (let i = 0; i < smoke; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 8, 45);
    pool.emit(
      PARTICLE.smoke,
      particleKind(PARTICLE.smoke).color,
      x + spread(rng, radius * 0.8),
      y + spread(rng, radius * 0.8),
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 2.2, 4.5),
      between(rng, 6, 14),
      between(rng, 28, 46),
      rng.next() * Math.PI * 2,
      spread(rng, 0.6),
      0.7,
      0.5,
    );
  }

  // A few embers, and only a few: this is a home burning, not a firework.
  const embers = budget(8, quality);
  for (let i = 0; i < embers; i++) {
    const a = rng.next() * Math.PI * 2;
    const speed = between(rng, 20, 80);
    pool.emit(
      PARTICLE.ember,
      particleKind(PARTICLE.ember).color,
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      between(rng, 1.0, 2.0),
      between(rng, 2, 4),
      0.6,
      a,
      0,
      1.1,
      0.7,
    );
  }
}

/** **Collapse phase** (GDD §2.3): entropy arriving, as a wide cold pulse. */
export function collapsePulse(pool: ParticlePool, x: number, y: number, radius: number): void {
  ring(pool, x, y, radius * 0.2, radius, 3.5, 0.35);
}

/** **Match over** (GDD §1): one bright ring, and then the summary screen. */
export function matchEnd(pool: ParticlePool, rng: Rng, x: number, y: number, quality = 1): void {
  ring(pool, x, y, 10, 260, 1.6, 0.5);
  const n = budget(12, quality);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pool.emit(
      PARTICLE.ember,
      particleKind(PARTICLE.ember).color,
      x,
      y,
      Math.cos(a) * between(rng, 60, 160),
      Math.sin(a) * between(rng, 60, 160),
      between(rng, 0.8, 1.6),
      3,
      0.6,
      a,
      0,
      1.2,
      0.9,
    );
  }
}

// ---------------------------------------------------------------------------

/** One expanding ring. Every shockwave, shimmer and glow in the set is this. */
export function ring(
  pool: ParticlePool,
  x: number,
  y: number,
  from: number,
  to: number,
  ttl: number,
  alpha: number,
): void {
  pool.emit(PARTICLE.ring, particleKind(PARTICLE.ring).color, x, y, 0, 0, ttl, from, to, 0, 0, 0, alpha);
}
