/**
 * src/net/fleet-auth.ts — proving a fleet control-plane request came from a
 * Machine the allocator trusts. OWNER: Netcode Engineer (GDD §4.2; M10 fleet
 * registration).
 *
 * A ticket (`./ticket`) proves the *allocator* made a routing decision, so a
 * *client* cannot forge one. This is the mirror the other way round: it proves a
 * *Machine* is who it says when it tells the allocator it exists, so a *stranger*
 * cannot register a phantom host, forge a heartbeat that hijacks a room code's
 * routing, or deregister a live Machine out from under its players. The fleet's
 * write routes — `POST /register`, `POST /fleet/heartbeat`, `POST /deregister` —
 * are exactly the ones that mutate who-hosts-what, so those are the ones this
 * guards; the read routes (`/health`, `/regions`, `/rooms/:code`) and the
 * client's own allocate/join carry no such proof and need none.
 *
 * **The same one shared secret.** There is no second key to distribute: a Machine
 * signs with the value it already holds as `TICKET_SECRET`, the allocator verifies
 * with the identical `ALLOCATOR_SECRET`, and a mismatch fails closed exactly as a
 * ticket mismatch does (server/README.md). The proof is an HMAC-SHA256 over the
 * request's raw body, so it authenticates the sender *and* pins the exact bytes
 * the allocator will act on — a tampered heartbeat is a broken signature.
 *
 * **Pure and clockless**, like `./ticket`: `node:crypto` and the two arguments,
 * nothing else (no new dependency, no clock, no global). The compare is
 * constant-time so a caller cannot probe the secret one byte at a time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The header a Machine carries its proof in. Lower-case because Node's HTTP layer
 * lower-cases header names on the way in, so the allocator reads it verbatim.
 */
export const FLEET_AUTH_HEADER = 'x-fleet-auth';

/**
 * Sign a fleet control-plane request body under the shared secret. Deterministic:
 * the same body and secret always produce the same proof (no clock, no nonce),
 * which is what lets a test assert the exact value. Sign the *exact* string that
 * will be sent as the body — the allocator recomputes over the bytes it receives.
 */
export function signFleetRequest(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Verify a {@link signFleetRequest} proof over `body`. Returns `true` only when
 * the signature was produced from this exact body under this exact secret;
 * anything else — a missing proof, a different secret, a byte-changed body, a
 * malformed signature — is `false`. The length guard runs first because
 * `timingSafeEqual` throws on a length mismatch, and a wrong length is already a
 * wrong signature.
 */
export function verifyFleetRequest(body: string, signature: string | undefined, secret: string): boolean {
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
