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
 * Everything is quantized to fixed-point integers. Positions and velocities carry
 * **eighths of a world unit** ({@link POS_SCALE}) in the same two bytes they always
 * did: the original layout rounded them to whole units, which put a permanent
 * half-unit lie under client-side prediction and produced a correction on every
 * snapshot of every match (the M10 constant-correction hunt — the long note on
 * {@link POS_SCALE} is the diagnosis and the arithmetic). Velocity *is* sent, so a
 * client can dead-reckon a remote ship between snapshots instead of stuttering.
 *
 * **A shot carries its velocity too, since a0-73** — one byte of heading and one
 * of speed, taking the projectile record from 6 B to 8 B and the worst case from
 * 494 B to {@link WORST_CASE_BYTES}. It did not, and the developer could see it:
 * *"other players shots dont follow the direction they were fired in."* The long
 * note on {@link ProjSnap} is the diagnosis; {@link SHOT_ANGLE_SCALE} and
 * {@link SHOT_SPEED_QUANT} are why two bytes are enough and the four an `i16`
 * pair would cost are not spent.
 *
 * The wire's precision is the codec's own business: {@link ShipSnap} and
 * {@link ProjSnap} carry **world units** on both sides of the wire, and the
 * fixed-point step exists only between {@link encodeSnapshot} and
 * {@link decodeSnapshot}. Nothing upstream or downstream has to know the scale —
 * which is what let it change without touching a single consumer.
 *
 * The ship record lost its `aim` field in the v0.3 laser funeral
 * (`docs/design-amendments.md`): `aim` was the old firing-ray direction, and once
 * mining and combat became pooled projectiles a ship carries no standing line — its
 * shots stream in the projectile pool, its hull points at `heading`, and there
 * was nothing left for a second angle to say. Dropping it takes the ship record
 * from 15 bytes to 13 and the worst case from 510 to 494 (see
 * {@link WORST_CASE_BYTES}); `docs/netcode-spike.md` carries the re-derivation.
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
//                        heading u16                                    2
//                        hull u8                                        1
//                        flags u8                                       1
//                                                                    = 13 bytes
//   Proj   (per entity)  id u8 | posX i16 | posY i16                    5
//                        heading u8 | speed u8                          2
//                        meta u8                                        1
//                                                                    = 8 bytes

export const HEADER_BYTES = 6;
export const SHIP_BYTES = 13;
export const PROJECTILE_BYTES = 8;

/** GDD §4.2/§4.3 entity caps that bound one snapshot: 8 slots, 64 shots. */
export const MAX_SHIPS = 8;
/**
 * Worst-case concurrent shots in one snapshot. Re-derived for two shooters after
 * combat became a projectile (design amendment v0.2):
 *
 *  - **Turrets** — 4 per station × 8 stations = 32, each with a shot life
 *    (`TURRET.range / TURRET.projectileSpeed` ≈ 0.34 s) shorter than its fire
 *    interval (0.5 s), so at most one in flight per turret: **≤ 32**.
 *  - **Ships** — 8, firing on `SHIP_WEAPON.fireInterval` (0.35 s) with a shot
 *    life (`range / speed` ≈ 0.58 s) a little over one interval, so at most two
 *    in flight per ship: **≤ 16**.
 *
 * Peak ≈ 48, comfortably under this 64-slot budget, so the projectile stream is
 * unchanged by the amendment. The bound is a hard cap regardless: `snapshotWorld`
 * streams at most this many and drops any tail, so a snapshot can never exceed
 * {@link WORST_CASE_BYTES} even if a future retune pushes the real peak higher
 * (that would be the signal to raise this).
 */
export const MAX_PROJECTILES = 64;

/**
 * Worst-case snapshot payload, in bytes — the number bandwidth is billed against
 * in docs/netcode-spike.md (measured, not assumed; GDD risk 4).
 *
 * **622 B (a0-73), up from 494 B.** The projectile record gained the two bytes of
 * {@link SHOT_ANGLE_SCALE} heading and {@link SHOT_SPEED_QUANT} speed that let a
 * remote shot fly the line it was fired on instead of being frozen wherever the
 * packets are not (see {@link ProjSnap}). Before that it was 494 B, down from the
 * day-0 510 B when the v0.3 laser funeral dropped the ship `aim` field.
 */
export const WORST_CASE_BYTES =
  HEADER_BYTES + MAX_SHIPS * SHIP_BYTES + MAX_PROJECTILES * PROJECTILE_BYTES;

/** Ship `flags` byte — one bit per thing the renderer must know that isn't a
 *  number. Named here because a bare `0b101` in a decoder is unreadable. */
export const SHIP_FLAG = {
  /** The ship is flying (clear while dead and waiting on the respawn timer). */
  alive: 1 << 0,
  /** The weapon is firing this tick (`Ship.firing`) — the renderer's in-combat
   *  glow keys off it and the audio layer sounds the shot. */
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

/**
 * A **shot's** heading quantization: a full turn over one byte, 1.406° per step
 * and ±0.703° of error. A ship's hull spends two bytes on the same job and a shot
 * spends one, which is not an inconsistency — the two angles are read over
 * different distances.
 *
 * A hull's heading is what it is *drawn* at, and a visibly-crooked sprite is a
 * defect at any range. A shot's heading is only ever used to reach forward from a
 * position the wire just gave us, and the reach is bounded
 * ({@link ../interpolation} `MAX_SHOT_EXTRAPOLATION_MS`, 200 ms): the fastest
 * muzzle in the game (a turret's 700 u/s) covers 140 u in that time, and
 * `140 · tan(0.703°)` is **1.7 world units** of cross-track error at the very end
 * of the longest reach the buffer will take. Over the ordinary one-broadcast-
 * interval reach (33 ms, 23 u) it is **0.28 u** — under the wire's own
 * eighth-unit position step ({@link POS_SCALE}) times three, and far inside the
 * 5-unit shot radius a player is reading. The next snapshot then re-anchors the
 * position exactly, so the error never accumulates across a flight.
 *
 * The second byte would buy 0.0066 u at that reach, against 64 shots × 30 Hz =
 * 1.92 KB/s. Shot volume is the highest-frequency entity traffic in the game, so
 * the byte is not spent.
 */
const SHOT_ANGLE_SCALE = 256 / (2 * Math.PI);

/**
 * A shot's muzzle-speed quantization: **world units per second per step**, one
 * byte, so the wire carries 0 … 1020 u/s with ±2 u/s of error.
 *
 * The whole game has four muzzle speeds — a turret's 700 (`src/sim/constants`
 * `TURRET.projectileSpeed`, flat across Mk I–III) and a ship's 520 scaled by the
 * SPEED ladder's `[1, 1.15, 1.3]`, i.e. 520 / 598 / 676 — so this range is
 * generous headroom rather than a tight fit, and a retune has room to move in.
 * Three of the four land exactly on a step; 598 rounds to 600.
 *
 * Speed is carried rather than derived because a shot's *first* packet is a
 * shot with no history, and that is the packet a player reads to decide whether
 * to move into its line (GDD §2.6 — dodging is the skill). Two positions are a
 * velocity only once there are two.
 *
 * ±2 u/s over the 200 ms maximum reach is **0.4 u** along-track; over one
 * broadcast interval, 0.07 u.
 */
export const SHOT_SPEED_QUANT = 4;

/** Largest muzzle speed the wire can carry, world units per second. */
export const MAX_WIRE_SHOT_SPEED = 255 * SHOT_SPEED_QUANT;

/**
 * Fixed-point steps per world unit for every streamed position and velocity —
 * **the wire's precision, and the floor under every prediction error there is.**
 *
 * ── WHY THIS NUMBER EXISTS (M10 tick-alignment, the constant-correction hunt) ──
 *
 * The developer's telemetry showed a *correction on every single snapshot*: mean
 * 0.3–0.6 u, worst 1.0–1.2 u, all match, at 250 ms. A constant small correction is
 * systematic rather than stochastic, so the instrument went in first
 * (`./telemetry` `appliedDeltaMean`, `server/room.ts` `ackTick`) to test the prime
 * suspect — the client predicting an input at one tick and the server running it at
 * another. It said no: on the developer's wire **93 % of inputs are applied at
 * exactly the tick they were predicted for**, and the remaining 7 % are one tick
 * out. Alignment was not the fault.
 *
 * The fault was here. Positions streamed as **whole world units**, so a client whose
 * physics were *perfect* still landed up to half a unit from the number authority
 * sent — every ship, every snapshot, forever. In two axes that is a mean error of
 * 0.38 u and a worst case of 0.71 u, which is the developer's capture almost
 * exactly; velocity rounding (a whole unit per second, then replayed across a
 * round trip's worth of ticks) supplies the rest. It is not a misprediction — the
 * client and the server agreed — it is the wire *telling* the client something
 * slightly untrue and reconciliation dutifully steering to it, 30 times a second.
 *
 * So the same two bytes now carry eighths of a unit. The error floor drops by 8×,
 * to ~0.05 u mean — under the renderer's pixel and far under the blend
 * ({@link ../prediction} `SMOOTHING_EPSILON`) — and steady-state flight reconciles
 * to *nothing*, which is what "prediction is right" is supposed to look like.
 *
 * **Why 8 and not 16.** The field is an `i16`, so the representable range is
 * `±32767 / POS_SCALE`. The widest arena the game ships is 3200 × 2000 (`src/sim`
 * `maps.ts`, the oval and diamond), with coordinates measured from the corner, so
 * the range must clear 3200 with room for a ship that has been kicked past a wall.
 * At 8 the ceiling is 4095.9 u — 28 % of headroom. At 16 it is 2047.9 u, *inside*
 * the arena, and a ship at the far end of an oval map would clamp to the wall on
 * the wire. Eight is therefore the finest power of two the map catalogue permits,
 * and `snapshot.test.ts` pins that relationship so a future wider map fails the
 * build instead of teleporting a ship.
 *
 * Velocity shares the scale and has range to spare: a maxed Interceptor tops out
 * near 300 u/s against a 4095 u/s ceiling.
 *
 * Byte cost of all of this: **zero**. The layout is unchanged (`WORST_CASE_BYTES`);
 * only the meaning of the integer moved, which is why `WIRE_VERSION` moved with it
 * (`./wire`) — a v1 client reading v2 numbers would draw the whole match at an
 * eighth scale, so the two must never meet.
 */
export const POS_SCALE = 8;

/** Largest world coordinate the wire can carry at {@link POS_SCALE}, in world
 *  units. Any arena wider than this cannot be streamed without clamping — the
 *  bound `snapshot.test.ts` holds the map catalogue against. */
export const MAX_WIRE_COORD = 32767 / POS_SCALE;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A ship's streamed state for one snapshot, in **world units** — the wire's
 *  fixed-point step ({@link POS_SCALE}) is applied inside {@link encodeSnapshot}
 *  and undone inside {@link decodeSnapshot}, so a record is the same units either
 *  side of the socket. `heading` and `hull` are the exception: they are already
 *  their own wire encodings (see {@link dequantizeAngle}). */
export interface ShipSnap {
  id: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  /** Hull facing, `angle * 65536 / 2π`. */
  heading: number;
  hull: number;
  flags: number;
}

/**
 * A projectile's streamed state, in **world units** on both sides of the socket.
 * `id` is its **pool slot**, not an entity id: slots are reused and stable, which
 * is exactly what a u8 can carry and what a client needs to correlate a shot
 * across snapshots.
 *
 * **`velX` / `velY` are new in wire v3 (a0-73), and they are the whole point.**
 * The developer, from a live online match: *"other players shots dont follow the
 * direction they were fired in."* Measured (evidence/a0-73-remote-shots) they did
 * not, and could not: a shot record carried a position and an owner and nothing
 * else, so a remote shot only ever moved when a packet moved it. Between two
 * packets that bracket it a client can chord-interpolate and the chord happens to
 * lie on the fired line — but at the head of a flight, at the tail of one, and for
 * the whole of any gap in the stream there is no pair, and a shot with no velocity
 * simply **stopped**, up to 104 u behind where its own heading had it. A player
 * reading a shot's line to decide whether to move into it was reading a dot that
 * was not travelling that line at all.
 *
 * The pair is carried as **polar** on the wire — one byte of heading
 * ({@link SHOT_ANGLE_SCALE}) and one of speed ({@link SHOT_SPEED_QUANT}), 2 B
 * rather than the 4 B two `i16` components would cost — because a shot is a
 * straight line at a constant speed and those are exactly its two degrees of
 * freedom. The polar step is the codec's own business, like {@link POS_SCALE}:
 * this record is a plain velocity vector either side of the socket, so no consumer
 * has to know the wire is polar. It does mean `decode(encode(v))` returns `v`
 * rounded to the two quantizations above, exactly as positions are.
 */
export interface ProjSnap {
  id: number;
  posX: number;
  posY: number;
  /** Muzzle velocity, world units per second. Constant for a shot's whole life —
   *  a projectile takes no input and no acceleration (`src/sim/projectiles.ts`). */
  velX: number;
  velY: number;
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

/**
 * World units → the fixed-point `i16` the wire carries ({@link POS_SCALE} steps
 * per unit), clamped into range. The widest shipping arena leaves 28 % headroom,
 * so this only ever bites on a pathological value — but a wrapped coordinate would
 * teleport a ship, so it is clamped rather than truncated.
 */
function quantize(v: number): number {
  const q = Math.round(v * POS_SCALE);
  return q > 32767 ? 32767 : q < -32768 ? -32768 : q;
}

/** The wire's fixed-point `i16` → world units — the exact inverse of
 *  {@link quantize} up to the eighth-unit step it rounds to. */
function dequantize(wire: number): number {
  return wire / POS_SCALE;
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

/** A shot's velocity vector → the wire's `heading u8 | speed u8` pair. A zero
 *  vector encodes as speed 0, and decodes back to one — a shot the encoder was
 *  handed with no velocity is streamed as having none, never as a guess. */
function quantizeShotVelocity(velX: number, velY: number): { heading: number; speed: number } {
  const speed = Math.hypot(velX, velY);
  if (!(speed > 0)) return { heading: 0, speed: 0 };
  const turns = Math.atan2(velY, velX) * SHOT_ANGLE_SCALE;
  const q = Math.round(speed / SHOT_SPEED_QUANT);
  return {
    heading: ((Math.round(turns) % 256) + 256) % 256,
    speed: q > 255 ? 255 : q,
  };
}

/** The wire's `heading u8 | speed u8` pair → a velocity vector in world units. */
function dequantizeShotVelocity(heading: number, speed: number): { velX: number; velY: number } {
  if (speed === 0) return { velX: 0, velY: 0 };
  const radians = (heading & 0xff) / SHOT_ANGLE_SCALE;
  const magnitude = speed * SHOT_SPEED_QUANT;
  return { velX: Math.cos(radians) * magnitude, velY: Math.sin(radians) * magnitude };
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
    ships.push({
      id: ship.id & 0xff,
      posX: ship.pos.x,
      posY: ship.pos.y,
      velX: ship.vel.x,
      velY: ship.vel.y,
      heading: quantizeAngle(ship.angle),
      hull: Math.max(0, Math.min(255, Math.round(ship.hull))),
      flags:
        (ship.alive ? SHIP_FLAG.alive : 0) |
        (ship.firing ? SHIP_FLAG.firing : 0) |
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
      posX: p.pos.x,
      posY: p.pos.y,
      // The line the shot was fired on, straight off authority (a0-73). A shot
      // flies this vector unchanged for its whole life, so one reading of it is
      // the whole trajectory — which is what lets a client advance a remote shot
      // by its own heading between snapshots instead of freezing it.
      velX: p.vel.x,
      velY: p.vel.y,
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
    dv.setInt16(o, quantize(s.posX), true);
    o += 2;
    dv.setInt16(o, quantize(s.posY), true);
    o += 2;
    dv.setInt16(o, quantize(s.velX), true);
    o += 2;
    dv.setInt16(o, quantize(s.velY), true);
    o += 2;
    dv.setUint16(o, s.heading & 0xffff, true);
    o += 2;
    dv.setUint8(o, s.hull & 0xff);
    o += 1;
    dv.setUint8(o, s.flags & 0xff);
    o += 1;
  }

  for (const p of projectiles) {
    dv.setUint8(o, p.id & 0xff);
    o += 1;
    dv.setInt16(o, quantize(p.posX), true);
    o += 2;
    dv.setInt16(o, quantize(p.posY), true);
    o += 2;
    const v = quantizeShotVelocity(p.velX, p.velY);
    dv.setUint8(o, v.heading);
    o += 1;
    dv.setUint8(o, v.speed);
    o += 1;
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
    const posX = dequantize(dv.getInt16(o, true));
    o += 2;
    const posY = dequantize(dv.getInt16(o, true));
    o += 2;
    const velX = dequantize(dv.getInt16(o, true));
    o += 2;
    const velY = dequantize(dv.getInt16(o, true));
    o += 2;
    const heading = dv.getUint16(o, true);
    o += 2;
    const hull = dv.getUint8(o);
    o += 1;
    const flags = dv.getUint8(o);
    o += 1;
    ships.push({ id, posX, posY, velX, velY, heading, hull, flags });
  }

  const projectiles: ProjSnap[] = [];
  for (let i = 0; i < projCount; i++) {
    const id = dv.getUint8(o);
    o += 1;
    const posX = dequantize(dv.getInt16(o, true));
    o += 2;
    const posY = dequantize(dv.getInt16(o, true));
    o += 2;
    const heading = dv.getUint8(o);
    o += 1;
    const speed = dv.getUint8(o);
    o += 1;
    const meta = dv.getUint8(o);
    o += 1;
    const { velX, velY } = dequantizeShotVelocity(heading, speed);
    projectiles.push({ id, posX, posY, velX, velY, meta });
  }

  return { tick, ships, projectiles };
}
