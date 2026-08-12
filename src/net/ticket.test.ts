/**
 * src/net/ticket.test.ts — a ticket is trusted only when it should be. OWNER:
 * Netcode Engineer.
 *
 * The whole value of a signed ticket is the set of things it *refuses*, so most
 * of this file is refusal: a payload the client edited, a signature it forged, a
 * different secret, an expired window, and every malformed shape. The one thing
 * it must accept — an unaltered ticket inside its window — is the round trip.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signTicket, verifyTicket } from './ticket';
import type { TicketClaims } from './ticket';

const SECRET = 'allocator-and-machine-share-this';
const claims: TicketClaims = { room: 'K7QM', machine: 'iad-3', expiresAt: 10_000 };

describe('signTicket', () => {
  it('is a pure function of claims and secret — no clock, no nonce', () => {
    expect(signTicket(claims, SECRET)).toBe(signTicket(claims, SECRET));
  });

  it('changes when any signed field changes', () => {
    const base = signTicket(claims, SECRET);
    expect(signTicket({ ...claims, room: 'K7QN' }, SECRET)).not.toBe(base);
    expect(signTicket({ ...claims, machine: 'iad-4' }, SECRET)).not.toBe(base);
    expect(signTicket({ ...claims, expiresAt: 10_001 }, SECRET)).not.toBe(base);
    expect(signTicket(claims, 'a-different-secret')).not.toBe(base);
  });

  it('emits exactly two base64url segments', () => {
    const parts = signTicket(claims, SECRET).split('.');
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('verifyTicket', () => {
  it('round-trips an unaltered ticket inside its window', () => {
    const ticket = signTicket(claims, SECRET);
    expect(verifyTicket(ticket, SECRET, 9_999)).toEqual(claims);
  });

  it('rejects a ticket signed under a different secret', () => {
    const ticket = signTicket(claims, SECRET);
    expect(verifyTicket(ticket, 'wrong-secret', 0)).toBeNull();
  });

  it('rejects a tampered payload — the routing decision cannot be re-made', () => {
    const ticket = signTicket(claims, SECRET);
    const [, sig] = ticket.split('.');
    // Re-encode a payload that names a different Machine, keep the old signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, machine: 'attacker-box' }),
      'utf8',
    ).toString('base64url');
    expect(verifyTicket(`${forgedPayload}.${sig}`, SECRET, 0)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const ticket = signTicket(claims, SECRET);
    const [payload, sig] = ticket.split('.') as [string, string];
    const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyTicket(`${payload}.${flipped}`, SECRET, 0)).toBeNull();
  });

  it('rejects an expired ticket even when the signature is valid', () => {
    const ticket = signTicket(claims, SECRET);
    expect(verifyTicket(ticket, SECRET, claims.expiresAt - 1)).toEqual(claims); // last live ms
    expect(verifyTicket(ticket, SECRET, claims.expiresAt)).toBeNull(); // exactly expired
    expect(verifyTicket(ticket, SECRET, claims.expiresAt + 1)).toBeNull();
  });

  it('rejects every malformed shape without throwing', () => {
    for (const junk of [
      '',
      '.',
      'onlyonesegment',
      '.nopayload',
      'nosig.',
      'a.b.c', // three segments
      'not base64url!.also-not',
      'ΩΩΩ.ΩΩΩ',
    ]) {
      expect(verifyTicket(junk, SECRET, 0)).toBeNull();
    }
  });

  it('rejects a signature of the wrong length without throwing (timing-safe guard)', () => {
    const ticket = signTicket(claims, SECRET);
    const [payload] = ticket.split('.');
    expect(verifyTicket(`${payload}.QQ`, SECRET, 0)).toBeNull(); // short but valid base64url
  });

  it('rejects a validly-signed payload that is not a claims object', () => {
    // Sign a well-formed-but-wrong payload the way the module would, so the
    // signature passes and only the structural check can reject it.
    const badPayload = Buffer.from(JSON.stringify({ room: 'K7QM' }), 'utf8').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(badPayload).digest('base64url');
    expect(verifyTicket(`${badPayload}.${sig}`, SECRET, 0)).toBeNull();
  });
});

/**
 * The intent claim (a0-26 Milestone A) — the one bit that tells "create this
 * room" apart from "put me in the room that is already there". A0-26 §2 measured
 * what its absence costs: a code whose room ended a beat ago is silently
 * re-created as an empty lobby, and a browse row multiplies that failure by
 * making dead rooms tappable.
 */
describe('the intent claim', () => {
  /** Sign a payload the module's own way, so only the structural check can fail
   *  it — the way a hostile-but-well-signed claim would actually arrive. */
  const signRaw = (payload: unknown): string => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
  };

  it('round-trips a join intent', () => {
    const ticket = signTicket({ ...claims, intent: 'join' }, SECRET);
    expect(verifyTicket(ticket, SECRET, 0)?.intent).toBe('join');
  });

  it('round-trips a create intent', () => {
    const ticket = signTicket({ ...claims, intent: 'create' }, SECRET);
    expect(verifyTicket(ticket, SECRET, 0)?.intent).toBe('create');
  });

  it('reads as undefined on a ticket that carries none — the pre-a0-26 shape', () => {
    const verified = verifyTicket(signTicket(claims, SECRET), SECRET, 0);
    expect(verified).not.toBeNull();
    expect(verified?.intent).toBeUndefined();
  });

  it('is signed — flipping create to join breaks the HMAC', () => {
    const created = signTicket({ ...claims, intent: 'create' }, SECRET);
    const joined = signTicket({ ...claims, intent: 'join' }, SECRET);
    expect(created).not.toBe(joined);
    // Splice the joined ticket's payload onto the created one's signature: the
    // claim a client would most like to edit, and the one it cannot.
    const forged = `${joined.split('.')[0]}.${created.split('.')[1]}`;
    expect(verifyTicket(forged, SECRET, 0)).toBeNull();
  });

  it('refuses a word that is neither, rather than reading it as create', () => {
    // Fail closed: a claim the verifier cannot understand is not quietly
    // downgraded to the permissive one.
    expect(verifyTicket(signRaw({ ...claims, intent: 'joinish' }), SECRET, 0)).toBeNull();
    expect(verifyTicket(signRaw({ ...claims, intent: 7 }), SECRET, 0)).toBeNull();
  });
});
