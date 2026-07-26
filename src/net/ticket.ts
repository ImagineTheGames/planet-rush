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
  if (nowMs >= claims.expiresAt) return null; // stale at the verifier's clock
  return claims;
}

/** Structural check on a decoded, signature-verified payload. */
function isTicketClaims(value: unknown): value is TicketClaims {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.room === 'string' &&
    typeof c.machine === 'string' &&
    typeof c.expiresAt === 'number' &&
    Number.isFinite(c.expiresAt)
  );
}
