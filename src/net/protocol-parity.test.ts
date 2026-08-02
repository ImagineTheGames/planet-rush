/**
 * src/net/protocol-parity.test.ts — THE CLASS GUARD. OWNER: Netcode Engineer.
 *
 * Protocol parity is a contract: **every order the client can emit, the wire must
 * parse.** This file enumerates the shared order-type sources — the `Action`
 * union, the `BuildItem` union, the `UpgradeTrack` enum, and the two message
 * unions in `./transport` — and asserts that each member survives the real
 * encode/parse path. A verb that is neither parsed nor named in a ratified
 * exclusion list fails here.
 *
 * **Why this file exists.** Three times now the same defect class has shipped: a
 * gameplay verb existed on one side of a boundary and was silently absent from
 * the other, so the feature was not broken — it was *invisible*.
 *
 *  1. The build wheel excluded RADAR: the sim could build it, no wedge offered it.
 *  2. Teams mode ate the difficulty picker: the mode existed, its control did not.
 *  3. The wire ate upgrades and satellites (M10): `parseActions` switched on five
 *     verbs with `default: return null`, `upgradeOrder` was not among them, and
 *     `BUILD_ITEMS` was `[turret, shield, repair, bank]`. Online players could buy
 *     no ship upgrade at all and build no satellite — and worse, because one bad
 *     action rejected the *whole* message, the tick they tried to buy on lost
 *     their thrust, aim and fire too.
 *
 * Each time the fix was the missing entry. This is the fix for the *class*: the
 * enumerations below are pinned to the shared unions by exhaustive
 * `Record<…, …>` literals, so a new verb in `@shared/types` fails to compile here
 * until this table names it, and then fails at runtime until the wire parses it.
 * New verbs FAIL CI until the wire learns them.
 *
 * The companion guards, same shape, other boundaries: `src/platform/input-parity.test.ts`
 * (every action reachable from every device) and `src/ui/build-wheel.test.ts`
 * (every buildable item has a wedge).
 */

import { describe, expect, it } from 'vitest';
import type { Action, ActionType, BuildItem } from '@shared/types';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { ClientMessage, ServerMessage } from './transport';
import {
  WIRE_ACTION_TYPES,
  encodeClientMessage,
  parseActions,
  parseClientMessage,
  parseServerMessage,
} from './wire';

// ---------------------------------------------------------------------------
// The rows — pinned to the shared unions (a new member fails to compile here)
// ---------------------------------------------------------------------------

/**
 * One valid, representative instance of every action verb. Exhaustive by
 * construction: `Record<ActionType, Action>` means a seventh verb in
 * `@shared/types` breaks `tsc` on this literal.
 *
 * The samples are deliberately non-trivial — a real aim vector, a real track —
 * so "the wire parses it" means the payload survived, not that a bare `{type}`
 * was waved through.
 */
const ACTION_SAMPLES: Record<ActionType, Action> = {
  thrust: { type: 'thrust', dir: { x: 0.5, y: -0.25 } },
  aim: { type: 'aim', dir: { x: 128, y: -64 } },
  fire: { type: 'fire', active: true, auto: false },
  build: { type: 'build', active: true },
  // `satellite` on purpose: it is the build item the old wire refused (feature f1).
  buildOrder: { type: 'buildOrder', item: 'satellite' },
  upgradeOrder: { type: 'upgradeOrder', track: UpgradeTrack.Power },
};
const ACTION_TYPES = Object.keys(ACTION_SAMPLES) as ActionType[];

/**
 * Every build item the wheel can order. Same pin, same reason — this is the
 * literal that would have caught the missing `satellite`.
 */
const ALL_BUILD_ITEMS: Record<BuildItem, true> = {
  turret: true,
  shield: true,
  satellite: true,
  repair: true,
  bank: true,
};
const BUILD_ITEMS = Object.keys(ALL_BUILD_ITEMS) as BuildItem[];

/** Every client verb. The wire's front door must admit each one. */
const ALL_CLIENT_MESSAGES: Record<ClientMessage['type'], ClientMessage> = {
  join: { type: 'join', room: 'QK7P' },
  lobbyChoice: { type: 'lobbyChoice', shipClass: ShipClass.Vanguard, fireMode: 'manual' },
  startMatch: { type: 'startMatch' },
  input: { type: 'input', tick: 1, seq: 1, actions: [] },
  // The latency probe (M10 item 6). It is on this list for the same reason as the
  // rest: a verb the wire's front door does not admit is a feature that silently
  // does not exist, and this one's absence would read as "the network is fine".
  ping: { type: 'ping', id: 7 },
  // ABANDON MATCH (m10 disconnect honesty). On this list for the sharpest version
  // of the same reason: a `leave` the front door drops is not a visible bug at all
  // — the socket closes a moment later either way — it just silently downgrades a
  // stated exit into the sixty-second grace hold it was meant to skip.
  leave: { type: 'leave', reason: 'abandoned' },
};

/** Every server message type. `joinError` is here because its *absence* from the
 *  parse set was this same class of bug in the other direction (M10: a refused
 *  join read as a plain drop, and the client span a 60 s reconnect loop). */
const ALL_SERVER_MESSAGE_TYPES: Record<ServerMessage['type'], true> = {
  welcome: true,
  lobbyState: true,
  matchStart: true,
  snapshot: true,
  entityEvent: true,
  playerSubstituted: true,
  playerReclaimed: true,
  economy: true,
  orderEcho: true,
  matchEnd: true,
  joinError: true,
  pong: true,
};

// ---------------------------------------------------------------------------
// The ratified exclusions — empty, and that is the point
// ---------------------------------------------------------------------------

/**
 * Action verbs the wire deliberately does NOT carry. **Empty, and ratified so.**
 *
 * Every abstract action is a thing a player does with their hands, and the online
 * game is the same game — there is no verb that is sensibly offline-only. If a
 * future one exists, it belongs here *with a comment naming who ratified the cut
 * and why*, which makes excluding a verb a deliberate, reviewed act instead of a
 * `default: return null` nobody noticed for three milestones.
 */
const WIRE_EXCLUDED_ACTIONS: readonly ActionType[] = [];

/** Build items the wire deliberately does not carry. Empty, same rule. */
const WIRE_EXCLUDED_BUILD_ITEMS: readonly BuildItem[] = [];

// ---------------------------------------------------------------------------
// Helpers — every check runs through the REAL encode/parse path
// ---------------------------------------------------------------------------

/** Send one action the way a client actually sends it (`encodeClientMessage` →
 *  socket text → `parseClientMessage`) and return what the server got back. */
function throughTheWire(action: Action): readonly Action[] | null {
  const frame = encodeClientMessage({ type: 'input', tick: 7, seq: 3, actions: [action] });
  const parsed = parseClientMessage(frame);
  return parsed?.type === 'input' ? parsed.actions : null;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe('THE CLASS GUARD — the wire parses every order the client can emit', () => {
  it('parses, or explicitly excludes, every action verb — never neither, never both', () => {
    for (const type of ACTION_TYPES) {
      const excluded = WIRE_EXCLUDED_ACTIONS.includes(type);
      const parsed = throughTheWire(ACTION_SAMPLES[type]);
      const carried = parsed !== null && parsed.some((a) => a.type === type);

      // Neither = the regression: a verb the client emits and the wire eats.
      expect(
        carried || excluded,
        `the wire does not parse '${type}', and it is not in WIRE_EXCLUDED_ACTIONS — ` +
          `teach parseActions the verb, or ratify the exclusion with a reason`,
      ).toBe(true);
      // Both = a contradiction (excluded yet carried).
      expect(carried && excluded, `'${type}' is both parsed and excluded`).toBe(false);
    }
  });

  it('carries every action verb through unchanged, payload and all', () => {
    for (const type of ACTION_TYPES) {
      if (WIRE_EXCLUDED_ACTIONS.includes(type)) continue;
      // Round trip, not merely "an action of that type came back": a verb that
      // arrives with its track or its item quietly dropped is still a dead verb.
      expect(throughTheWire(ACTION_SAMPLES[type]), `'${type}' did not survive the wire`).toEqual([
        ACTION_SAMPLES[type],
      ]);
    }
  });

  it('parses, or explicitly excludes, every BuildItem', () => {
    for (const item of BUILD_ITEMS) {
      const excluded = WIRE_EXCLUDED_BUILD_ITEMS.includes(item);
      const parsed = throughTheWire({ type: 'buildOrder', item });
      const carried = parsed?.length === 1 && parsed[0]?.type === 'buildOrder' && parsed[0].item === item;

      expect(
        carried || excluded,
        `the wire refuses buildOrder '${item}' — add it to the wire's BUILD_ITEM_TABLE ` +
          `or ratify the exclusion`,
      ).toBe(true);
      expect(carried && excluded, `buildOrder '${item}' is both parsed and excluded`).toBe(false);
    }
  });

  it('parses every UpgradeTrack the shared enum defines', () => {
    // The enum is the runtime source here — no restatement to drift from it.
    for (const track of Object.values(UpgradeTrack)) {
      expect(throughTheWire({ type: 'upgradeOrder', track }), `track '${track}' is dead on the wire`).toEqual([
        { type: 'upgradeOrder', track },
      ]);
    }
  });

  it('excludes exactly the ratified sets — nothing padded in to silence the guard', () => {
    // Adding an entry above has to change these lines too, in a diff a reviewer
    // reads. That is the whole mechanism.
    expect([...WIRE_EXCLUDED_ACTIONS]).toEqual([]);
    expect([...WIRE_EXCLUDED_BUILD_ITEMS]).toEqual([]);
  });

  it('keeps the wire’s own verb table honest against its parser', () => {
    // The table and the `switch` are separate code. A verb the table claims and
    // the switch forgot would land in `default` and be silently dropped — which
    // is precisely the failure this file exists to make loud.
    expect([...WIRE_ACTION_TYPES].sort()).toEqual([...ACTION_TYPES].sort());
    for (const type of WIRE_ACTION_TYPES) {
      const sample = ACTION_SAMPLES[type as ActionType];
      expect(parseActions([sample]), `'${type}' is advertised but not parsed`).toEqual([sample]);
    }
  });

  it('admits every client message verb at the front door', () => {
    for (const [type, message] of Object.entries(ALL_CLIENT_MESSAGES)) {
      expect(parseClientMessage(encodeClientMessage(message)), `client verb '${type}' is refused`)
        .not.toBeNull();
    }
  });

  it('admits every server message type on the client', () => {
    for (const type of Object.keys(ALL_SERVER_MESSAGE_TYPES)) {
      expect(parseServerMessage(JSON.stringify({ type })), `server message '${type}' is dropped`)
        .not.toBeNull();
    }
  });
});
