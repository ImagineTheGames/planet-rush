/**
 * src/net/ticket.ts — signed connection tickets. OWNER: Netcode Engineer
 * (GDD §4.2; docs/hosting-plan.md).
 *
 * One match server is one process and every client on a room lands on it by
 * definition. The moment there is more than one Machine behind the allocator,
 * "which Machine does this room live on?" stops being obvious and becomes a
 * *decision* — and a decision a client is trusted to make for itself is a
 * decision an attacker makes for it (name someone else's Machine, name a room
 * you were never allocated). So the allocator states the decision and signs it:
 * a ticket names a room and a Machine, an HMAC-SHA256 over those bytes proves
 * the allocator issued it, and a Machine trusts a ticket only if the signature
 * checks out under the shared secret. The client carries the ticket; it cannot
 * forge one and cannot alter one without the signature falling apart.
 *
 * **Pure and clockless.** Signing and verifying read no clock and no global
 * state — `node:crypto` and their arguments, nothing else (no new dependency).
 * A ticket's lifetime is a plain field the allocator fills from its own injected
 * clock, and expiry is judged against a `nowMs` the *caller* supplies to
 * {@link verifyTicket}. This module never reads `Date.now()`; it only compares
 * the two numbers it is handed.
 *
 * Wire shape: `base64url(payloadJSON).base64url(hmac)`. The signature covers the
 * encoded payload segment verbatim, so verification recomputes the HMAC over the
 * exact bytes it received and only then decodes the claims — the payload is
 * never trusted before its signature is.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RoomCode } from './transport';

/** A Machine the allocator can route a room to — an opaque id, unique per host. */
export type MachineId = string;

/** What a ticket asserts: this room lives on this Machine until this instant. */
export interface TicketClaims {
  /** The room the bearer is allocated to. */
  readonly room: RoomCode;
  /** The Machine that room lives on — the routing decision the client may not make. */
  readonly machine: MachineId;
  /**
   * Epoch-ms after which the ticket is stale. The allocator computes it from its
   * own clock at issue time; {@link verifyTicket} judges it against a `nowMs`
   * argument. This module reads no clock of its own.
   */
  readonly expiresAt: number;
  /**
   * The requested match size (N, 2..8) for a *new* room, signed so the Machine
   * can trust it (variable-slots Task C1). A room is created by the first `join`
   * that reaches its code, so the size the allocator was asked for has to ride
   * to the Machine somehow; the ticket is the one channel a client cannot forge,
   * which is exactly why the room→Machine binding already lives here. Absent on a
   * plain join (the room exists, its size is set) and on the solo/self-hosted
   * path (no allocator signs a ticket), where the Machine falls back to its
   * process default.
   */
  readonly size?: number;
  /**
   * The requested match mode (`'ffa' | 'teams'`) for a *new* room, carried for
   * the same reason and on the same terms as {@link TicketClaims.size}. Typed as
   * a bare string here to keep this module below the sim layer that owns the
   * `MatchMode` union (`src/sim/match-config.ts`); the Machine narrows it.
   */
  readonly mode?: string;
  /**
   * **What the bearer was allocated to do** (a0-26 Milestone A) — the claim that
   * makes a dead room refusable.
   *
   * The match server has no "create room" verb: an unknown code *creates* the
   * room, and that is load-bearing, because it is how HOST works (the allocator
   * mints a code, and the creator's `join` is what brings the room into
   * existence). The cost is that the same mechanism silently resurrects a room
   * that has ended — type a code whose room was swept four seconds ago, or tap a
   * listing built from a heartbeat that has not caught up, and you land alone in
   * a brand-new room wearing the name of the one you asked for. Nothing errors,
   * because nothing can tell the two joins apart.
   *
   * This is what tells them apart, and it is signed because a client that could
   * declare its own intent could declare `create` on someone else's code:
   *
   *   • `'create'` — issued by `POST /rooms`, and by a join reaching a room the
   *     allocator knows only through its reservation (the **boot gap** — the room
   *     may not have booted yet). An unknown code opens a room, exactly as it
   *     always has.
   *   • `'join'`   — issued by a join to a room a **heartbeat has confirmed is
   *     there** (and by the listing join, which is built from those heartbeats
   *     alone). An unknown code is **refused** (`room-gone`), never opened.
   *
   * So the claim means precisely: *the allocator had been told this room exists.*
   * That is the only case where a Machine not hosting it proves the room ended.
   *
   * **Absent reads as `create`**, so a client older than this field and the
   * self-hosted path with no ticket secret behave byte-for-byte as they did.
   */
  readonly intent?: 'create' | 'join';
}

/**
 * Mint a signed ticket for `claims` under `secret`. Deterministic: the same
 * claims and secret always produce the same string, because the only entropy
 * that could vary — a clock, a nonce — is absent by design. The `secret` is the
 * allocator↔Machine shared key; it never travels with the ticket.
 */
export function signTicket(claims: TicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify a ticket and return its claims, or `null` if it is not to be trusted:
 * malformed, signed under a different secret, tampered with, or expired at
 * `nowMs`. The signature is checked *before* the payload is decoded, so a forged
 * or corrupt payload is never parsed as claims; the compare is constant-time
 * (`timingSafeEqual`) so a caller cannot probe the secret one byte at a time.
 *
 * @param ticket The `payload.sig` string from {@link signTicket}.
 * @param secret The shared allocator↔Machine key.
 * @param nowMs  The verifier's current epoch-ms — expiry is judged against this.
 */
export function verifyTicket(ticket: string, secret: string, nowMs: number): TicketClaims | null {
  const claims = readTicket(ticket, secret);
  if (claims === null) return null;
  if (nowMs >= claims.expiresAt) return null; // stale at the verifier's clock
  return claims;
}

/**
 * **Authenticity without the clock** (a0-72): the same signature and shape checks
 * {@link verifyTicket} makes, minus the expiry test. Returns claims for a ticket
 * this secret genuinely signed, however old it is; `null` for one it did not.
 *
 * This exists because *expiry and authenticity answer different questions*, and
 * exactly one caller needs to tell them apart. A returning player's ticket proves
 * a **routing decision** — which Machine hosts this room — and that decision does
 * not rot: the room is either still on this Machine or it is not, and the Machine
 * can see which. What proves the returning player is the seat's *owner* is the
 * per-seat `reclaimToken` the server itself minted (`server/room.ts`), which has
 * nothing to do with this file. So a Machine that already holds the room may admit
 * a **reclaim** on a lapsed-but-genuine ticket (`server/match-server.ts`
 * `admitsJoin`) without weakening anything: a forged, tampered, wrong-room or
 * wrong-Machine ticket still fails here, and a lapsed one still buys nothing more
 * than the right to *present a token*.
 *
 * Every other caller must keep using {@link verifyTicket}: a fresh join, a room
 * this Machine does not host, and the upgrade router's routing hint are all cases
 * where an expired pass is exactly as good as no pass at all.
 */
export function readTicket(ticket: string, secret: string): TicketClaims | null {
  const dot = ticket.indexOf('.');
  if (dot <= 0) return null; // no payload, or leading dot
  const payload = ticket.slice(0, dot);
  const sig = ticket.slice(dot + 1);
  // Exactly two segments: base64url has no '.', so a second dot is malformed.
  if (sig.length === 0 || sig.includes('.')) return null;

  const expected = createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(sig, 'base64url');
  // Length guard first: timingSafeEqual throws on a mismatch, and a wrong length
  // is already a wrong signature.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  // Signature holds — only now is it safe to read the payload as claims.
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isTicketClaims(claims)) return null;
  return claims;
}

/** Structural check on a decoded, signature-verified payload. The optional room
 *  config (`size`/`mode`, variable-slots Task C1) is validated only for *type*
 *  when present — the payload's authenticity is already proven by the signature,
 *  so this guards against a malformed field, not a hostile one. */
function isTicketClaims(value: unknown): value is TicketClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  if (c.size !== undefined && (typeof c.size !== 'number' || !Number.isFinite(c.size))) return false;
  if (c.mode !== undefined && typeof c.mode !== 'string') return false;
  // An intent that is neither word is not a claim this build understands. It is
  // dropped to a malformed ticket rather than read as the permissive `create`,
  // because the whole value of the claim is that a `join` cannot be talked out
  // of being one — fail closed, exactly as the signature check above does.
  if (c.intent !== undefined && c.intent !== 'create' && c.intent !== 'join') return false;
  return (
    typeof c.room === 'string' &&
    typeof c.machine === 'string' &&
    typeof c.expiresAt === 'number' &&
    Number.isFinite(c.expiresAt)
  );
}
