/**
 * server/upgrade-router.ts — the machine-pin, moved to the socket hop.
 * OWNER: Netcode Engineer (GDD §4.2; docs/hosting-plan.md, M10).
 *
 * On Fly the allocate/join JSON response can carry no `fly-replay` header — the
 * edge would replay the POST at the gameserver and the client would never receive
 * its `{room, ticket}` (allocator/index.ts `decided()`). So the client is handed
 * the gameserver app's *shared* hostname and the routing decision moves here, to
 * the WebSocket upgrade: the edge picks some gameserver machine, and if that is
 * not the one the room's ticket names, this file answers the upgrade with a
 * same-app `fly-replay instance=<host machine>` *before* the handshake completes.
 * The edge re-delivers the upgrade to the host, which then completes it as usual.
 *
 * The routing hint is the ticket itself, carried on the upgrade URL's `?ticket=`
 * query (`src/net/websocket-transport.ts`) — the same signed ticket the join
 * message will later present for auth. We **verify** it (not merely decode it) so
 * a replay is only ever emitted for a machine the allocator genuinely named; an
 * absent, malformed, forged or expired ticket is left to land here and be refused
 * honestly by the join gate (`MatchServer.admitsJoin`), never bounced around the
 * fleet on an unverified claim.
 *
 * **Pure and reused.** The directive is built by the same {@link FlyReplayRouter}
 * the allocator uses (`allocator/router.ts`), constructed bare so it emits a
 * same-app `instance=` pin and nothing else. This module reads no clock of its
 * own — the caller supplies `now` — so it stays testable to the millisecond.
 */

import { verifyTicket } from '../src/net/ticket';
import { FlyReplayRouter } from '../allocator/router';

/** What the upgrade router needs to decide: who am I, what's the key, what time is it. */
export interface UpgradeRouterConfig {
  /** This gameserver machine's own id — a ticket naming it means "serve here". */
  readonly machineId: string;
  /** The allocator↔Machine shared key, to verify the ticket the upgrade carries. */
  readonly secret: string;
  /** Epoch-ms clock, read once per decision (expiry is judged against it). */
  readonly now: () => number;
}

/**
 * Decide whether a WS upgrade to `url` must be replayed to another gameserver
 * machine. Returns the `fly-replay` headers to answer the upgrade with, or `null`
 * to complete the upgrade here. `null` covers every "serve here" case: no ticket
 * on the URL, a ticket that will not verify, or a ticket that names *this*
 * machine.
 */
export function replayForUpgrade(
  url: string | undefined,
  config: UpgradeRouterConfig,
): Readonly<Record<string, string>> | null {
  const ticket = ticketFromUrl(url);
  if (ticket === null) return null; // no routing hint — serve here
  const claims = verifyTicket(ticket, config.secret, config.now());
  if (claims === null) return null; // unverifiable — let the join gate refuse it honestly
  if (claims.machine === config.machineId) return null; // we host it — proceed
  // A bare router: same app, so no `app=`; no region in a ticket, so `instance=` alone.
  return new FlyReplayRouter().routeTo({ machine: claims.machine, region: '' }).headers;
}

/** Pull the `ticket` query param off an upgrade URL, or `null` if there is none
 *  (or the URL will not parse). The base is a throwaway — only the query matters. */
function ticketFromUrl(url: string | undefined): string | null {
  if (url === undefined || url.length === 0) return null;
  try {
    return new URL(url, 'http://gameserver.internal').searchParams.get('ticket');
  } catch {
    return null;
  }
}
