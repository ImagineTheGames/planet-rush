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
import { MAX_PROJECTILES, SHOT_META } from './snapshot';
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
}

/** One stashed projectile slot. */
interface ShotStash {
  index: number;
  active: boolean;
  x: number;
  y: number;
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
      this.ships.push({ index: i, x: ship.pos.x, y: ship.pos.y, angle: ship.angle });
      ship.pos.x = remote.x;
      ship.pos.y = remote.y;
      ship.angle = remote.angle;
    }

    // Shots. The presentation layer owns the streamed half of the pool outright —
    // it decides which of those slots is drawn and where — because the buffer's
    // playback clock, not the newest snapshot, is what the picture follows. A shot
    // that landed 40 ms ago is still on screen if the render clock has not reached
    // its death yet, and one that is only in the newest snapshot is not on screen
    // until the render clock arrives at it.
    if (frame.shots.length > 0 || this.anyStreamedShotActive(world)) {
      for (let slot = 0; slot < Math.min(world.projectiles.length, LOCAL_SHOT_BASE); slot++) {
        const p = world.projectiles[slot]!;
        this.shots.push({ index: slot, active: p.active, x: p.pos.x, y: p.pos.y, owner: p.owner, kind: p.kind });
        p.active = false;
      }
      for (const shot of frame.shots) {
        if (shot.slot >= LOCAL_SHOT_BASE) continue;
        const p = this.growTo(world, shot.slot);
        if (!p) continue;
        p.active = true;
        p.pos.x = shot.x;
        p.pos.y = shot.y;
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
    }
    for (const stash of this.shots) {
      const p = world.projectiles[stash.index];
      if (!p) continue;
      p.active = stash.active;
      p.pos.x = stash.x;
      p.pos.y = stash.y;
      p.owner = stash.owner;
      if (stash.kind === undefined) delete p.kind;
      else p.kind = stash.kind;
    }
    this.ships.length = 0;
    this.shots.length = 0;
    this.presented = false;
  }

  // --- Internals ------------------------------------------------------------

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
