/**
 * src/net/snapshot.ts — the binary snapshot wire format, against the real sim.
 * OWNER: Netcode Engineer (GDD §3.5, §4.2).
 *
 * This is the day-0 spike's measured layout (`./spike/snapshot.ts`, 510-byte
 * worst case — see docs/netcode-spike.md) promoted to production and wired to
 * the actual `World` from `src/sim/`. The spike module stays where it is as the
 * measurement artifact; `snapshot.test.ts` pins the two layouts to the same
 * byte cost so the number in the doc can never quietly drift.
 *
 * Only **ships and projectiles** stream as binary (GDD §4.2). Static entities —
 * asteroids, turrets, shields, wrecks — are events on join and on change, so
 * they cost nothing per tick and are deliberately absent from this layout.
 *
 * The projectile stream carries **both shooters** now (design amendment v0.2):
 * ship-vs-ship / ship-vs-structure combat became a pooled projectile, so ship
 * weapon shots ride the same `world.projectiles` pool the turret guns always did
 * and the same 6-byte record streams them. The worst case was re-derived rather
 * than assumed (see {@link MAX_PROJECTILES}) — it still fits the measured layout,
 * so the byte cost is deliberately unchanged. What the amendment adds is a shot
 * *kind* bit in the previously-reserved `meta` bits, at zero byte cost, so the
 * renderer can tint/size a ship shot apart from a turret shot (see {@link SHOT_META}).
 *
 * Everything is quantized to integers: the client renders at 60 fps and
 * interpolates between snapshots broadcast at 30 Hz (GDD §4.2), so sub-unit
 * precision is never worth its bytes. Velocity *is* sent, so a client can
 * dead-reckon a remote ship between snapshots instead of stuttering.
 *
 * Encoding is little-endian and hand-packed — we own every byte, the same
 * discipline the sim applies to collision (GDD §4.1).
 */

import type { World } from '../sim';

// ---------------------------------------------------------------------------
// Wire layout (little-endian) — identical to the measured spike layout
// ---------------------------------------------------------------------------
//
//   Header               tick u32 | shipCount u8 | projCount u8        6 bytes
//   Ship   (per entity)  id u8                                          1
//                        posX i16 | posY i16                            4
//                        velX i16 | velY i16                            4
//                        heading u16 | aim u16                          4
//                        hull u8                                        1
//                        flags u8                                       1
//                                                                    = 15 bytes
//   Proj   (per entity)  id u8 | posX i16 | posY i16 | meta u8          6 bytes

export const HEADER_BYTES = 6;
export const SHIP_BYTES = 15;
export const PROJECTILE_BYTES = 6;

/** GDD §4.2/§4.3 entity caps that bound one snapshot: 8 slots, 64 shots. */
export const MAX_SHIPS = 8;
/**
 * Worst-case concurrent shots in one snapshot. Re-derived for two shooters after
 * combat became a projectile (design amendment v0.2):
 *
 *  - **Turrets** — 4 per planet × 8 planets = 32, each with a shot life
 *    (`TURRET.range / TURRET.projectileSpeed` ≈ 0.34 s) shorter than its fire
 *    interval (0.5 s), so at most one in flight per turret: **≤ 32**.
 *  - **Ships** — 8, firing on `SHIP_WEAPON.fireInterval` (0.35 s) with a shot
 *    life (`range / speed` ≈ 0.58 s) a little over one interval, so at most two
 *    in flight per ship: **≤ 16**.
 *
 * Peak ≈ 48, comfortably under this 64-slot budget, so the measured wire layout
 * (and its 510-byte worst case) is unchanged by the amendment. The bound is a
 * hard cap regardless: `snapshotWorld` streams at most this many and drops any
 * tail, so a snapshot can never exceed {@link WORST_CASE_BYTES} even if a future
 * retune pushes the real peak higher (that would be the signal to raise this).
 */
export const MAX_PROJECTILES = 64;

/** Worst-case snapshot payload, in bytes — the number bandwidth is billed
 *  against in docs/netcode-spike.md (measured, not assumed; GDD risk 4). */
export const WORST_CASE_BYTES =
  HEADER_BYTES + MAX_SHIPS * SHIP_BYTES + MAX_PROJECTILES * PROJECTILE_BYTES;

/** Ship `flags` byte — one bit per thing the renderer must know that isn't a
 *  number. Named here because a bare `0b101` in a decoder is unreadable. */
export const SHIP_FLAG = {
  /** The ship is flying (clear while dead and waiting on the respawn timer). */
  alive: 1 << 0,
  /** The beam is on this tick — the renderer draws it, the audio layer sounds it. */
  firing: 1 << 1,
  /** Inside spawn protection (GDD §2.1) — drawn with the protection glow. */
  spawnProtected: 1 << 2,
  /** This player's home core is gone: out of the match, never respawning (§2.7). */
  eliminated: 1 << 3,
} as const;

/** Projectile `meta` byte layout. The owner slot lives in the low 3 bits; the
 *  shot-kind bit was one of the bits the spike reserved for exactly this
 *  (design amendment v0.2). Named so a bare `0b1011` in a decoder is readable. */
export const SHOT_META = {
  /** Owner player slot, 0..7, in bits 0..2. */
  ownerMask: 0x7,
  /** Bit 3 set ⇒ a ship weapon shot; clear ⇒ a turret shot. Lets the renderer
   *  size/tint the two apart without a second query (all shooters, GDD §2.6). */
  shipKind: 1 << 3,
} as const;

/** Owner slot carried by a projectile `meta` byte. */
export function projOwner(meta: number): number {
  return meta & SHOT_META.ownerMask;
}

/** Whether a projectile `meta` byte marks a ship weapon shot (vs a turret shot). */
export function projIsShipShot(meta: number): boolean {
  return (meta & SHOT_META.shipKind) !== 0;
}

/** Angle quantization: a full turn over the u16 range (~0.005° per step). */
const ANGLE_SCALE = 65536 / (2 * Math.PI);

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A ship's streamed state for one snapshot. Integers, already quantized. */
export interface ShipSnap {
  id: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  /** Hull facing, `angle * 65536 / 2π`. */
  heading: number;
  /** Beam direction while firing, same quantization; equals `heading` when the
   *  beam is off (there is nothing else to point at). */
  aim: number;
  hull: number;
  flags: number;
}

/** A projectile's streamed state. `id` is its **pool slot**, not an entity id:
 *  slots are reused and stable, which is exactly what a u8 can carry and what a
 *  client needs to correlate a shot across snapshots. */
export interface ProjSnap {
  id: number;
  posX: number;
  posY: number;
  /** `owner` in bits 0..2; bit 3 is the ship-vs-turret shot-kind flag (design
   *  amendment v0.2); bits 4..7 still reserved. Decode with {@link projOwner} /
   *  {@link projIsShipShot}. */
  meta: number;
}

/** A decoded snapshot, as the client-side read path hands it on. */
export interface DecodedSnapshot {
  tick: number;
  ships: ShipSnap[];
  projectiles: ProjSnap[];
}

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

/** Clamp into the i16 the wire carries. World bounds are ~2000 units, so this
 *  only ever bites on a pathological value — but a wrapped coordinate would
 *  teleport a ship, so it is clamped rather than truncated. */
function quantize(v: number): number {
  const q = Math.round(v);
  return q > 32767 ? 32767 : q < -32768 ? -32768 : q;
}

/** Angle → u16, normalized into one turn first so negatives encode correctly. */
function quantizeAngle(radians: number): number {
  const turns = radians * ANGLE_SCALE;
  return ((Math.round(turns) % 65536) + 65536) % 65536;
}

/** u16 → radians in [0, 2π) — the client-side inverse of {@link quantizeAngle}. */
export function dequantizeAngle(wire: number): number {
  return (wire & 0xffff) / ANGLE_SCALE;
}

// ---------------------------------------------------------------------------
// The sim → wire adapter
// ---------------------------------------------------------------------------

/** Project one tick of the real world onto the wire records. Reads the world;
 *  never writes it — the encoder is a pure observer of authoritative state. */
export function snapshotWorld(world: World): { ships: ShipSnap[]; projectiles: ProjSnap[] } {
  const ships: ShipSnap[] = [];
  for (const ship of world.ships) {
    if (ships.length >= MAX_SHIPS) break;
    const heading = quantizeAngle(ship.angle);
    const beam = ship.beam;
    ships.push({
      id: ship.id & 0xff,
      posX: quantize(ship.pos.x),
      posY: quantize(ship.pos.y),
      velX: quantize(ship.vel.x),
      velY: quantize(ship.vel.y),
      heading,
      aim: beam ? quantizeAngle(Math.atan2(beam.dir.y, beam.dir.x)) : heading,
      hull: Math.max(0, Math.min(255, Math.round(ship.hull))),
      flags:
        (ship.alive ? SHIP_FLAG.alive : 0) |
        (beam ? SHIP_FLAG.firing : 0) |
        (ship.spawnProtect > 0 ? SHIP_FLAG.spawnProtected : 0) |
        (ship.eliminated ? SHIP_FLAG.eliminated : 0),
    });
  }

  // The projectile pool is sparse — `active === false` slots are dead shots
  // waiting to be reused, and must be skipped rather than streamed (sim/state).
  const projectiles: ProjSnap[] = [];
  for (let slot = 0; slot < world.projectiles.length; slot++) {
    const p = world.projectiles[slot]!;
    if (!p.active) continue;
    // The pool is bounded by the GDD §4.3 budget; if it ever overruns, the tail
    // is dropped so a snapshot can never exceed its measured worst case.
    if (projectiles.length >= MAX_PROJECTILES) break;
    projectiles.push({
      id: slot & 0xff,
      posX: quantize(p.pos.x),
      posY: quantize(p.pos.y),
      // Owner in bits 0..2; the shot-kind bit marks a ship weapon shot so the
      // renderer can draw it apart from a turret shot (design amendment v0.2).
      meta: (p.owner & SHOT_META.ownerMask) | (p.kind === 'ship' ? SHOT_META.shipKind : 0),
    });
  }

  return { ships, projectiles };
}

/** Encode one tick of the real world straight to the wire — what the server
 *  broadcasts and what `LocalLoopback` produces offline, byte for byte. */
export function encodeWorldSnapshot(world: World): ArrayBuffer {
  const { ships, projectiles } = snapshotWorld(world);
  return encodeSnapshot(world.tick, ships, projectiles);
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * Serialize one snapshot into a tightly packed little-endian buffer. Counts are
 * u8, so callers must respect {@link MAX_SHIPS} / {@link MAX_PROJECTILES} —
 * {@link snapshotWorld} already does.
 */
export function encodeSnapshot(
  tick: number,
  ships: readonly ShipSnap[],
  projectiles: readonly ProjSnap[],
): ArrayBuffer {
  const bytes = HEADER_BYTES + ships.length * SHIP_BYTES + projectiles.length * PROJECTILE_BYTES;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  let o = 0;

  dv.setUint32(o, tick >>> 0, true);
  o += 4;
  dv.setUint8(o, ships.length);
  o += 1;
  dv.setUint8(o, projectiles.length);
  o += 1;

  for (const s of ships) {
    dv.setUint8(o, s.id & 0xff);
    o += 1;
    dv.setInt16(o, s.posX | 0, true);
    o += 2;
    dv.setInt16(o, s.posY | 0, true);
    o += 2;
    dv.setInt16(o, s.velX | 0, true);
    o += 2;
    dv.setInt16(o, s.velY | 0, true);
    o += 2;
    dv.setUint16(o, s.heading & 0xffff, true);
    o += 2;
    dv.setUint16(o, s.aim & 0xffff, true);
    o += 2;
    dv.setUint8(o, s.hull & 0xff);
    o += 1;
    dv.setUint8(o, s.flags & 0xff);
    o += 1;
  }

  for (const p of projectiles) {
    dv.setUint8(o, p.id & 0xff);
    o += 1;
    dv.setInt16(o, p.posX | 0, true);
    o += 2;
    dv.setInt16(o, p.posY | 0, true);
    o += 2;
    dv.setUint8(o, p.meta & 0xff);
    o += 1;
  }

  return buf;
}

/** Decode a snapshot buffer back into records — the client-side read path. */
export function decodeSnapshot(buf: ArrayBuffer): DecodedSnapshot {
  const dv = new DataView(buf);
  let o = 0;

  const tick = dv.getUint32(o, true);
  o += 4;
  const shipCount = dv.getUint8(o);
  o += 1;
  const projCount = dv.getUint8(o);
  o += 1;

  const ships: ShipSnap[] = [];
  for (let i = 0; i < shipCount; i++) {
    const id = dv.getUint8(o);
    o += 1;
    const posX = dv.getInt16(o, true);
    o += 2;
    const posY = dv.getInt16(o, true);
    o += 2;
    const velX = dv.getInt16(o, true);
    o += 2;
    const velY = dv.getInt16(o, true);
    o += 2;
    const heading = dv.getUint16(o, true);
    o += 2;
    const aim = dv.getUint16(o, true);
    o += 2;
    const hull = dv.getUint8(o);
    o += 1;
    const flags = dv.getUint8(o);
    o += 1;
    ships.push({ id, posX, posY, velX, velY, heading, aim, hull, flags });
  }

  const projectiles: ProjSnap[] = [];
  for (let i = 0; i < projCount; i++) {
    const id = dv.getUint8(o);
    o += 1;
    const posX = dv.getInt16(o, true);
    o += 2;
    const posY = dv.getInt16(o, true);
    o += 2;
    const meta = dv.getUint8(o);
    o += 1;
    projectiles.push({ id, posX, posY, meta });
  }

  return { tick, ships, projectiles };
}
