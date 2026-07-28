/**
 * src/platform/match-boot.ts — standing up a real match. OWNER: Platform
 * Engineer.
 *
 * The composition `main.ts` boots into, lifted out of the browser so it can be
 * run headless. That is the point of the file rather than a nicety: M2's
 * features were all merged, all unit-tested, and none of them were on screen,
 * because "does the client actually assemble these into a match" was the one
 * thing nothing tested. It is testable now (`match-boot.test.ts`), and `main.ts`
 * boots through this same function, so the two cannot diverge.
 *
 * What it assembles (GDD §2.1, §2.9, §4.2):
 *
 *  - Eight slots, eight stations. This client flies one; the other seven are the
 *    cast (`src/bots`), each bringing its character's hull.
 *  - A `LocalLoopback` holding the authoritative sim in this process — no
 *    server, no internet, and the same protocol the online match speaks.
 *  - One pulse per fixed tick: the bots file first, then the local client, whose
 *    input *is* the offline clock. `InputQueue` hands every slot to the sim in
 *    id order regardless of arrival order, so the match stays deterministic
 *    (GDD §4.8).
 *
 * No PixiJS, no DOM, no `window`.
 */

import type { Action, PlayerId, ShipClass } from '@shared/types';
import { TICK_DT } from '../sim';
import type { PlayerSpec, World } from '../sim';
import { LocalLoopback, OFFLINE_ROOM, TransportSession } from '../net';
import { MATCH_SLOTS, botLobby, createBots, fillEmptySlots, thinkOnce } from '../bots';
import type { Bot } from '../bots';

/** How to stand up the offline match. */
export interface MatchBootConfig {
  /** Deterministic match seed — never time-derived (GDD §4.8). */
  readonly seed: number;
  /** The slot this client flies. */
  readonly localPlayer: PlayerId;
  /** The hull picked in the lobby (GDD §2.11). */
  readonly shipClass: ShipClass;
  /** Which ratified arena to build (`src/sim/maps`) — the map the player picked
   *  on the PLAY screen (m8-02). Omitted, the sim's default (`octagon`) is used;
   *  an unknown id falls back to it, so a stale saved key can never crash boot. */
  readonly mapId?: string;
  /** Slots in the match. Defaults to the design's eight (GDD §2.1). */
  readonly slots?: number;
  /** Fixed timestep. Defaults to the sim's canonical 60 Hz tick. */
  readonly dt?: number;
}

/** A booted match: the world to render, and the one call the loop makes. */
export interface MatchBoot {
  /** The authoritative world. Offline this is the one true state at zero
   *  latency, so the renderer reads it directly (GDD §4.2). */
  readonly world: World;
  /** The seated cast — held so a debug overlay can name who is in which slot. */
  readonly bots: readonly Bot[];
  /** The session the local client speaks through. */
  readonly session: TransportSession;
  /**
   * Advance one fixed tick: every bot files its actions for the tick, then this
   * client files `localActions` — which is the pulse that runs the sim.
   */
  tick(localActions: readonly Action[]): void;
  /** Leave the match. */
  close(): void;
}

/**
 * Boot the offline match. Deterministic: the same seed and the same slot produce
 * the same arena and the same cast, every time.
 */
export function bootOfflineMatch(config: MatchBootConfig): MatchBoot {
  const slots = config.slots ?? MATCH_SLOTS;
  const dt = config.dt ?? TICK_DT;

  const seats = fillEmptySlots([config.localPlayer], slots);
  const bots = createBots(seats, { seed: config.seed });
  const roster: PlayerSpec[] = [
    { id: config.localPlayer, shipClass: config.shipClass },
    ...botLobby(seats),
  ];
  roster.sort((a, b) => a.id - b.id);

  const transport = new LocalLoopback({
    match: {
      seed: config.seed,
      players: roster,
      // The arena the player picked (m8-02). `WorldConfig.mapId` threads straight
      // through `LocalLoopback.startMatch` → `createWorld`, which builds the layout
      // (or falls back to the default for an unknown id).
      ...(config.mapId !== undefined ? { mapId: config.mapId } : {}),
    },
    localPlayer: config.localPlayer,
    dt,
    // Offline the client reads the authoritative world directly, so the binary
    // snapshot stream is pure cost. It turns on with the WebSocket transport.
    snapshotIntervalTicks: 0,
  });
  const session = new TransportSession(transport, { dt });
  session.open({ room: OFFLINE_ROOM, shipClass: config.shipClass });

  const world = transport.world;
  // `startMatch` is synchronous in-process, so the world exists by now; the
  // check makes the impossible case loud instead of a null three frames later.
  if (!world) throw new Error('LocalLoopback did not start the match');

  return {
    world,
    bots,
    session,
    tick(localActions: readonly Action[]): void {
      const tick = session.tick;
      for (const bot of bots) {
        transport.sendAs(bot.seat.id, {
          type: 'input',
          tick,
          // One message per bot per tick, so the tick *is* a monotonic sequence.
          // Offline nothing acknowledges it back — `ackSeq` is the online
          // predictor's business — but the protocol carries one, so it does.
          seq: tick,
          actions: thinkOnce(world, bot, dt),
        });
      }
      // The local client's input is the offline clock: this is what advances the
      // authoritative sim to `tick` (GDD §4.2).
      session.sendInput(localActions);
    },
    close(): void {
      session.close();
    },
  };
}
