/**
 * src/net/spike/snapshot.ts — binary snapshot wire layout + measurement.
 *
 * Day-0 netcode spike (GDD §4.2, risk 4). OWNER: Netcode Engineer.
 *
 * Only **ships and projectiles** stream as binary snapshots; static entities
 * (asteroids, turrets, shields, wrecks) are sent as **events** on join/change
 * (GDD §4.2), so they are deliberately absent from this layout. The purpose of
 * this module is to make the snapshot's byte cost a MEASURED number, not the
 * assumed ~2 KB in GDD risk 4: `buildWorstCaseSnapshot()` serializes the GDD
 * entity caps (8 ships + 64 projectiles) into a real buffer whose `.byteLength`
 * is the worst case we then bill bandwidth against.
 *
 * Layout is little-endian and hand-packed — the same discipline the sim uses
 * for collision (GDD §4.1): we own every byte, which is what makes the number
 * trustworthy. Values are quantized to integers on the wire; the client
 * interpolates between snapshots at 60 fps render (GDD §4.2), so sub-unit
 * precision is not sent.
 *
 * Pure module, no runtime dependencies and no enums, so it type-checks under
 * the repo's strict config and runs under `node --experimental-strip-types`.
 * Reproduce the measurement with: `npx vitest run src/net/spike`.
 */

// ---------------------------------------------------------------------------
// Wire layout (little-endian)
// ---------------------------------------------------------------------------
//
//   Header               tick u32 | shipCount u8 | projCount u8        6 bytes
//   Ship   (per entity)  id u8                                          1
//                        posX i16 | posY i16                            4
//                        velX i16 | velY i16                            4   (dead-reckoning between snapshots)
//                        heading u16 | aim u16                          4   (facing + beam/aim direction)
//                        hull u8                                        1   (0..255; over-ship HP bar, GDD §2.2)
//                        flags u8                                       1   (firing/boost/spawn-protect/alive)
//                                                                    = 15 bytes
//   Proj   (per entity)  id u8 | posX i16 | posY i16 | meta u8          6 bytes
//                        meta = owner (bits 0..2) | kind (bits 3..7)
//
// Worst case is the GDD entity cap: 8 ships + 64 projectiles.

export const HEADER_BYTES = 6;
export const SHIP_BYTES = 15;
export const PROJECTILE_BYTES = 6;

/** GDD entity counts that bound a single binary snapshot (GDD §4.2). */
export const MAX_SHIPS = 8;
export const MAX_PROJECTILES = 64;

/** Worst-case snapshot payload size, in bytes (ship/projectile stream only). */
export const WORST_CASE_BYTES =
  HEADER_BYTES + MAX_SHIPS * SHIP_BYTES + MAX_PROJECTILES * PROJECTILE_BYTES;

// ---------------------------------------------------------------------------
// Plain snapshot records (spike-local; the sim's own types land with the sim)
// ---------------------------------------------------------------------------

/** A ship's streamed state for one snapshot. Integers, already quantized. */
export interface ShipSnap {
  id: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  heading: number;
  aim: number;
  hull: number;
  flags: number;
}

/** A projectile's streamed state for one snapshot. */
export interface ProjSnap {
  id: number;
  posX: number;
  posY: number;
  meta: number;
}

/** A decoded snapshot, as the client-side decoder would hand it to the sim. */
export interface DecodedSnapshot {
  tick: number;
  ships: ShipSnap[];
  projectiles: ProjSnap[];
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/**
 * Serialize one snapshot into a tightly packed little-endian buffer. Counts are
 * u8, so callers must respect {@link MAX_SHIPS} / {@link MAX_PROJECTILES}.
 */
export function encodeSnapshot(
  tick: number,
  ships: readonly ShipSnap[],
  projectiles: readonly ProjSnap[],
): ArrayBuffer {
  const bytes =
    HEADER_BYTES + ships.length * SHIP_BYTES + projectiles.length * PROJECTILE_BYTES;
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

// ---------------------------------------------------------------------------
// Worst-case builder — the MEASUREMENT
// ---------------------------------------------------------------------------

/**
 * Build and serialize a realistic worst-case snapshot: all 8 ships alive and
 * firing, and the full 64-projectile pool in flight. Its `.byteLength` is the
 * worst case bandwidth is billed against (GDD risk 4). Values are plausible
 * mid-match numbers, not zeros, so nothing is optimized away.
 */
export function buildWorstCaseSnapshot(): ArrayBuffer {
  const ships: ShipSnap[] = [];
  for (let i = 0; i < MAX_SHIPS; i++) {
    ships.push({
      id: i,
      posX: 1000 + i * 137,
      posY: -1400 + i * 91,
      velX: 120 - i * 11,
      velY: -90 + i * 7,
      heading: (i * 8123) & 0xffff,
      aim: (i * 4099) & 0xffff,
      hull: 70 - i * 3,
      flags: 0b10111, // alive | firing | boosting | spawn-protect sample
    });
  }
  const projectiles: ProjSnap[] = [];
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    projectiles.push({
      id: i,
      posX: -900 + i * 27,
      posY: 900 - i * 19,
      meta: (i % MAX_SHIPS) | ((i % 4) << 3),
    });
  }
  return encodeSnapshot(0xdeadbeef, ships, projectiles);
}
