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
 *    cast (`src/bots`), each bringing its character's hull — and since a0-06 the
 *    cast is **the one the lobby picked** ({@link MatchBootConfig.cast}), not a
 *    round-robin of the roster that ignored it.
 *  - The lobby's **sides**, onto both halves that need them: the roster the world
 *    is built from, and the **seat table the bot layer opens its team radios
 *    from** ({@link MatchBootConfig.teams}). Only the first was wired until b2-01,
 *    which left allied bots able to defend each other and unable to *call*.
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
import { MATCH_SLOTS, ROSTER, botLobby, createBots, fillEmptySlots, thinkOnce } from '../bots';
import type { Bot, PersonalityId } from '../bots';

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
  /**
   * Which side each seat fights for, indexed by player id — the lobby's TEAMS
   * assignment, in the dense order `createWorld` builds its roster in
   * (`src/sim/match-config` `configToPlayers`; m10 teams-wire).
   *
   * Omitted — under `?debug=1`, in the harness, and in every FFA match — each ship
   * defaults to its own side at world-build (`makeShip`), which IS free-for-all, so
   * the offline game is byte-identical to before. Supplied, it is the one thing that
   * makes an offline TEAMS match a teams match: the sim asks "are these two enemies?"
   * through a single `team` comparison (`src/sim/allegiance`), so allies stop being
   * targetable, their shots stop landing, and their homes spawn adjacent — all from
   * this table and nothing else.
   *
   * **It goes to the SEAT table as well as the roster** *(b2-01, 2026-08-09)*. This
   * table used to be stamped onto the roster only, which is the half the *world*
   * reads; the bot layer's seats were filled with no sides at all. `createBots`
   * groups seats by `BotSeat.team` to open one radio per side (`src/bots/harness`),
   * so every side was a side of one, `teamRadio` returned `null` for each, and the
   * team radio's whole Layer B — `help` and `siege` — was sent into a no-op. It was
   * invisible because Layer A (the ally klaxon and the `defend-ally` branch) reads
   * allies off the *world*, which this table did reach. `radio-seam.test.ts` is the
   * standing guard, and it asserts on a callout **arriving**: `send` on a `null`
   * radio returns quietly, so any test of the sender passes on the broken build.
   *
   * A seat the table does not name keeps its default (its own side), so a short or
   * absent table can never crash a boot, only leave a seat in FFA — where a side of
   * one gets no radio by the same rule, and no mode flag is consulted anywhere.
   */
  readonly teams?: readonly number[];
  /**
   * **The cast the lobby picked**, indexed by player id in the same dense order
   * `teams` uses (`src/ui/lobby` `lobbyRosterCast`) — the seam this file was
   * missing *(a0-06, 2026-08-07; GDD §2.1 amended)*.
   *
   * The lobby has resolved a character per seat since the day it shipped and
   * showed it on the roster; it just never travelled. This config had no cast
   * field at all, so the call below passed none, `fillEmptySlots` round-robined
   * the whole mixed roster, and every offline match was Rusty, Bolt, Foreman,
   * Patch, Sable, Vulture, Warden in seat order whatever the host had chosen —
   * the developer's *"i chose HARD for all enemies but they were at other
   * difficulties than i selected."* Selecting the character directly does not fix
   * that mismatch on its own; **this line is what fixes it**, and picking the
   * character is what makes a second, disagreeing control impossible afterwards.
   *
   * A slot the table does not name (a human seat, a short table, `?debug=1`, the
   * harness) falls back to roster order, so every existing boot is unchanged.
   * Repeats are honoured verbatim — two Wardens in, two Wardens out — because
   * eight slots over seven characters, three of them Hard, cannot avoid one.
   */
  readonly cast?: readonly (PersonalityId | null | undefined)[];
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

  // The lobby's cast AND the lobby's sides reach the seats here. `ROSTER` is
  // passed explicitly because it is now the *fallback* for a slot the cast does
  // not name, not the thing that decides the match; `config.teams` is the fourth
  // argument because a seat without a `team` is a side of one, and a side of one
  // gets no radio — which is b2-01's whole bug (see the `teams` field above).
  const seats = fillEmptySlots([config.localPlayer], slots, ROSTER, config.teams, config.cast);
  const bots = createBots(seats, { seed: config.seed });
  const roster: PlayerSpec[] = [
    { id: config.localPlayer, shipClass: config.shipClass },
    ...botLobby(seats),
  ];
  roster.sort((a, b) => a.id - b.id);
  // Stamp the lobby's sides onto the roster (m10 teams-wire). Only the `team` is
  // taken from the table — the hull stays whatever seated the slot, so a bot keeps
  // flying its character's silhouette (style-guide §4) while changing sides.
  const teams = config.teams;
  if (teams) {
    for (let i = 0; i < roster.length; i++) {
      const side = teams[roster[i]!.id];
      if (side !== undefined) roster[i] = { ...roster[i]!, team: side };
    }
  }

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
