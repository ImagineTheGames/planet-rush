/**
 * src/net/presentation.ts — the seam that was missing. OWNER: Netcode Engineer
 * (GDD §4.2; M10 netcode audit, docs/netcode-audit.md).
 *
 * **The audit's first finding.** PR #238 built three things the developer asked
 * for at ~150 ms — a decaying correction offset for the local ship
 * (`./prediction` `renderOffset`), an interpolation buffer for remote ships
 * (`./interpolation`), and the telemetry to prove both (`./telemetry`). All three
 * shipped. **None of them reached the screen.** The client renders straight off
 * the predicted `World` (`renderer.draw(world, …)`), and nothing ever read
 * `renderOffset` or called `sampleRemotes()` — verified in the deployed bundle
 * itself, where both names occur exactly once each, at their own definitions,
 * with no call site. The smoothing was real, shipped, and dead.
 *
 * This module is the missing half, built where it can ship without reaching into
 * the render layer: **the world the renderer reads is the seam.** Once per fixed
 * tick, after prediction has advanced the simulation, the presented state is
 * written *over* the world's render-visible fields — the local ship shifted by its
 * decaying correction offset, remote hulls placed where the interpolation buffer
 * says they were {@link RemoteInterpolator.delayMs} ago, streamed shots placed the
 * same way. The renderer, the camera, the audio listener and the aim cursor then
 * all agree, because they all read one world.
 *
 * **And it is put back before anything simulates.** Presented state is a lie the
 * picture tells; the simulation must never see it, or the lie compounds into
 * drift. So every entry point that steps or reconciles calls {@link restore}
 * first, which writes the stashed authoritative values back exactly. The
 * invariant, stated once and tested:
 *
 * > Between {@link apply} and {@link restore} the world is a *picture*. Outside
 * > that window it is the *simulation*, byte for byte what prediction left.
 *
 * The stash is preallocated and reused — no per-frame allocation, the same
 * discipline the sim holds itself to (GDD §4.3).
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { PROJECTILE } from '../sim';
import type { World } from '../sim';
import { MAX_PROJECTILES, SHIP_FLAG, SHOT_META } from './snapshot';
import type { InterpolatedShip, InterpolatedShot } from './interpolation';

/**
 * The first projectile pool slot reserved for the **local player's own predicted
 * shots** (`./prediction`). The wire's projectile id is a u8 pool slot bounded by
 * {@link MAX_PROJECTILES}, so every slot at or above this one is unreachable from
 * the wire by construction — which is what lets a predicted shot fly its whole
 * life without a snapshot landing on top of it.
 */
export const LOCAL_SHOT_BASE = MAX_PROJECTILES;

/** What one {@link PresentationLayer.apply} draws with. */
export interface PresentedFrame {
  /** The local ship's decaying correction offset (`./prediction` `renderOffset`),
   *  added to its position for the picture only. */
  readonly localOffset: Vec2;
  /** Remote hulls, ~one jitter-buffer delay in the past (`./interpolation`). */
  readonly remotes: readonly InterpolatedShip[];
  /** Streamed shots at the same instant. Empty before the first snapshot. */
  readonly shots: readonly InterpolatedShot[];
}

/** One stashed ship field-set — what {@link PresentationLayer.apply} overwrote. */
interface ShipStash {
  index: number;
  x: number;
  y: number;
  angle: number;
  /** The remote entity view ({@link PresentationLayer.presentRemote}). Undefined on
   *  the local slot, whose only presented field is its offset position. */
  hull?: number;
  alive?: boolean;
  eliminated?: boolean;
  firing?: boolean;
}

/** One stashed projectile slot. */
interface ShotStash {
  index: number;
  active: boolean;
  x: number;
  y: number;
  /** The simulation's own muzzle velocity for this slot. Stashed since a0-73,
   *  because the presented shot now writes one — and a picture that wrote a
   *  velocity the simulation never had, and did not put it back, would be the
   *  exact "the lie compounds into drift" this module exists to prevent. */
  vx: number;
  vy: number;
  owner: PlayerId;
  kind: 'ship' | 'turret' | undefined;
}

export class PresentationLayer {
  private readonly ships: ShipStash[] = [];
  private readonly shots: ShotStash[] = [];
  private presented = false;

  constructor(private readonly local: PlayerId) {}

  /** True while the world is holding presented (render-only) values. */
  get isPresented(): boolean {
    return this.presented;
  }

  /**
   * Write the presented frame over the world's render-visible fields, stashing
   * every value it overwrites. Idempotent in the sense that matters: applying
   * twice without a {@link restore} in between would stash the *presented* values
   * as if they were authoritative, so it refuses to.
   */
  apply(world: World, frame: PresentedFrame): void {
    if (this.presented) return;
    this.ships.length = 0;
    this.shots.length = 0;

    for (let i = 0; i < world.ships.length; i++) {
      const ship = world.ships[i]!;
      if (ship.id === this.local) {
        // The local hull: authoritative *now*, drawn where it was a moment ago,
        // catching up over RECONCILE_BLEND_FRAMES. This one line is the entire
        // difference between "a correction" and "a rollback" at 150 ms.
        if (frame.localOffset.x === 0 && frame.localOffset.y === 0) continue;
        this.ships.push({ index: i, x: ship.pos.x, y: ship.pos.y, angle: ship.angle });
        ship.pos.x += frame.localOffset.x;
        ship.pos.y += frame.localOffset.y;
        continue;
      }
      const remote = frame.remotes.find((r) => r.id === ship.id);
      if (!remote) continue;
      this.ships.push({
        index: i,
        x: ship.pos.x,
        y: ship.pos.y,
        angle: ship.angle,
        hull: ship.hull,
        alive: ship.alive,
        eliminated: ship.eliminated,
        firing: ship.firing,
      });
      ship.pos.x = remote.x;
      ship.pos.y = remote.y;
      ship.angle = remote.angle;
      this.presentRemote(ship, remote);
    }

    // Shots. The presentation layer owns the streamed half of the pool outright —
    // it decides which of those slots is drawn and where — because the buffer's
    // playback clock, not the newest snapshot, is what the picture follows. A shot
    // that landed 40 ms ago is still on screen if the render clock has not reached
    // its death yet, and one that is only in the newest snapshot is not on screen
    // until the render clock arrives at it.
    if (frame.shots.length > 0 || this.anyStreamedShotActive(world)) {
      const stashedUpTo = Math.min(world.projectiles.length, LOCAL_SHOT_BASE);
      for (let slot = 0; slot < stashedUpTo; slot++) {
        const p = world.projectiles[slot]!;
        this.shots.push({ index: slot, active: p.active, x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, owner: p.owner, kind: p.kind });
        p.active = false;
      }
      for (const shot of frame.shots) {
        if (shot.slot >= LOCAL_SHOT_BASE) continue;
        const p = this.growTo(world, shot.slot);
        if (!p) continue;
        // A slot this world had never allocated — the client's own pool only grows
        // when it fires. It still needs a stash entry, or `restore` would leave the
        // presented shot behind as if the simulation had produced it.
        if (shot.slot >= stashedUpTo && !this.shots.some((s) => s.index === shot.slot)) {
          this.shots.push({ index: shot.slot, active: false, x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, owner: p.owner, kind: p.kind });
        }
        p.active = true;
        p.pos.x = shot.x;
        p.pos.y = shot.y;
        // The line it was fired on, off the wire (a0-73). A slot the wire owns used
        // to keep whatever velocity its previous occupant left in it, so anything
        // reading the world for a shot's heading — a renderer drawing a streak, an
        // audio pan, a debug overlay — read a direction that belonged to a
        // different shot.
        p.vel.x = shot.vx;
        p.vel.y = shot.vy;
        p.owner = (shot.meta & SHOT_META.ownerMask) as PlayerId;
        p.kind = (shot.meta & SHOT_META.shipKind) !== 0 ? 'ship' : 'turret';
      }
    }

    this.presented = true;
  }

  /**
   * Put the simulation back. Every field {@link apply} touched is written from the
   * stash, so what steps next is exactly what prediction left — never the picture.
   * A no-op when nothing is presented, so callers may call it unconditionally
   * (and they do: it is the first line of every sim-touching entry point).
   */
  restore(world: World): void {
    if (!this.presented) return;
    for (const stash of this.ships) {
      const ship = world.ships[stash.index];
      if (!ship) continue;
      ship.pos.x = stash.x;
      ship.pos.y = stash.y;
      ship.angle = stash.angle;
      if (stash.hull !== undefined) ship.hull = stash.hull;
      if (stash.alive !== undefined) ship.alive = stash.alive;
      if (stash.eliminated !== undefined) ship.eliminated = stash.eliminated;
      if (stash.firing !== undefined) ship.firing = stash.firing;
    }
    for (const stash of this.shots) {
      const p = world.projectiles[stash.index];
      if (!p) continue;
      p.active = stash.active;
      p.pos.x = stash.x;
      p.pos.y = stash.y;
      p.vel.x = stash.vx;
      p.vel.y = stash.vy;
      p.owner = stash.owner;
      if (stash.kind === undefined) delete p.kind;
      else p.kind = stash.kind;
    }
    this.ships.length = 0;
    this.shots.length = 0;
    this.presented = false;
  }

  // --- Internals ------------------------------------------------------------

  /**
   * **One entity, one instant.** A remote ship's hull, its life, and its trigger are
   * presented from the *same* interpolation sample its position came from — the M10
   * lifecycle pass, items 3 and 4 of the developer's gru report.
   *
   * Position was already sampled {@link RemoteInterpolator.delayMs} in the past; every
   * other field a viewer reads was taken straight off the world, where it is the
   * *newest snapshot* as the reconcile left it. One entity drawn from two clocks, and
   * the two symptoms the developer named come out of the gap:
   *
   *  - **"HP bars and numbers flicker."** The bar shows while an entity is damaged or
   *    *in combat*, and in-combat is `Ship.firing` — a flag `step()` clears on every
   *    tick and only the wire can set (a client has no input for a rival, so its
   *    replay never fires that gun: `./prediction` `paintRemoteFiring`). Snapshots
   *    land 30 times a second and frames are drawn 60, so the flag was true on the
   *    frames a reconcile touched and false on the frames between: a bar strobing at
   *    30 Hz over an enemy that is holding its trigger down. The hull number beside it
   *    moved on a third clock again — authority's newest, one round trip ahead of the
   *    hull the player is watching get shot at.
   *  - **"Dead enemies linger."** The `alive` bit from the newest snapshot kills the
   *    corpse the moment authority does, while the *body* is still being drawn a
   *    hundred milliseconds in the past — and worse, before the lifecycle wire the
   *    client would quietly revive that ship locally on its next tick and go on
   *    drawing it for the whole respawn window (`./prediction` `holdLifecycle`).
   *    Sampled here, the corpse clears exactly when the render clock reaches the death
   *    — one interpolation delay behind, the same delay everything else about that
   *    ship is drawn at, and not a second more.
   *
   * The flag bits are carried, not blended: {@link RemoteInterpolator} takes them from
   * the nearer of the two bracketing snapshots, so each moves at most once per
   * snapshot interval and only ever forward. That is what "no flap" means here — not
   * that the state is smoothed, but that it has one source and one clock.
   *
   * Spawn protection is deliberately left where it is: it is a three-second glow whose
   * *edges* the snapshot path already resolves against the client's own countdown
   * (`./prediction` `applySnapshot`), and re-deriving it from a flag bit here would
   * re-arm the glow rather than sharpen it.
   */
  private presentRemote(ship: World['ships'][number], remote: InterpolatedShip): void {
    ship.hull = remote.hull;
    ship.alive = (remote.flags & SHIP_FLAG.alive) !== 0;
    ship.eliminated = (remote.flags & SHIP_FLAG.eliminated) !== 0;
    ship.firing = (remote.flags & SHIP_FLAG.firing) !== 0;
  }

  /** Whether any wire-owned slot is currently drawn — so a frame with no sampled
   *  shots still clears the last one off the screen instead of freezing it there. */
  private anyStreamedShotActive(world: World): boolean {
    const end = Math.min(world.projectiles.length, LOCAL_SHOT_BASE);
    for (let slot = 0; slot < end; slot++) if (world.projectiles[slot]!.active) return true;
    return false;
  }

  /** The pool slot at `index`, growing the pool to reach it — the same bounded
   *  growth the reconcile path uses, for the same reason (a client's pool only
   *  grows when it fires, and the wire can name a slot it never allocated). */
  private growTo(world: World, index: number): World['projectiles'][number] | null {
    if (index >= LOCAL_SHOT_BASE) return null;
    while (world.projectiles.length <= index) {
      world.projectiles.push({
        id: 0,
        active: false,
        owner: -1,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        damage: 0,
        radius: PROJECTILE.radius,
        life: 0,
      });
    }
    return world.projectiles[index] ?? null;
  }
}
