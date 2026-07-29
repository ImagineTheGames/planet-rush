/**
 * src/net/fleet-auth.test.ts — the proof a Machine carries on a fleet write
 * (M10). Mirrors `ticket.test.ts`: the same secret round-trips, a different secret
 * or a changed byte does not, and a fail-closed verify never throws on garbage.
 * OWNER: Netcode Engineer.
 */

import { describe, it, expect } from 'vitest';
import { signFleetRequest, verifyFleetRequest, FLEET_AUTH_HEADER } from './fleet-auth';

const SECRET = 'allocator-and-machine-share-this';
const BODY = JSON.stringify({ machine: 'm-1', region: 'iad', capacity: 32 });

describe('signFleetRequest / verifyFleetRequest', () => {
  it('verifies a proof it signed under the same secret', () => {
    const sig = signFleetRequest(BODY, SECRET);
    expect(verifyFleetRequest(BODY, sig, SECRET)).toBe(true);
  });

  it('is deterministic — same body and secret, same proof', () => {
    expect(signFleetRequest(BODY, SECRET)).toBe(signFleetRequest(BODY, SECRET));
  });

  it('rejects a proof made under a different secret', () => {
    const sig = signFleetRequest(BODY, 'some-other-secret');
    expect(verifyFleetRequest(BODY, sig, SECRET)).toBe(false);
  });

  it('rejects a proof over a different (tampered) body', () => {
    const sig = signFleetRequest(BODY, SECRET);
    const tampered = JSON.stringify({ machine: 'm-1', region: 'iad', capacity: 64 });
    expect(verifyFleetRequest(tampered, sig, SECRET)).toBe(false);
  });

  it('rejects a missing, empty, or malformed proof without throwing', () => {
    expect(verifyFleetRequest(BODY, undefined, SECRET)).toBe(false);
    expect(verifyFleetRequest(BODY, '', SECRET)).toBe(false);
    expect(verifyFleetRequest(BODY, 'not-a-real-signature', SECRET)).toBe(false);
    // A base64url string of the wrong length is a wrong signature, not a crash.
    expect(verifyFleetRequest(BODY, 'AAAA', SECRET)).toBe(false);
  });

  it('exposes a lower-case header name Node reads verbatim', () => {
    expect(FLEET_AUTH_HEADER).toBe(FLEET_AUTH_HEADER.toLowerCase());
  });
});
