/**
 * src/net/room-code.test.ts — the room-code rules hold. OWNER: Netcode Engineer.
 *
 * The rules are small and the whole point is that they do not drift, so this
 * pins them: the alphabet has no look-alikes, a generated code is the right
 * length out of that alphabet, and generation is a pure function of the injected
 * stream — same seed, same code — because a seeded server and a seeded test must
 * agree.
 */

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@shared/types';
import { CODE_ALPHABET, CODE_LENGTH, makeRoomCode } from './room-code';

describe('room-code rules', () => {
  it('draws its alphabet from 32 look-alike-free characters', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    // The four ambiguous characters are the reason the alphabet is not 36 wide.
    for (const ambiguous of ['O', '0', 'I', '1']) {
      expect(CODE_ALPHABET).not.toContain(ambiguous);
    }
    // No duplicates — every draw is uniform over distinct characters.
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  });

  it('defaults to a four-character code', () => {
    expect(CODE_LENGTH).toBe(4);
    expect(makeRoomCode(mulberry32(1))).toHaveLength(CODE_LENGTH);
  });
});

describe('makeRoomCode', () => {
  it('emits only alphabet characters', () => {
    // Sweep many seeds so every position gets exercised across the alphabet.
    for (let seed = 0; seed < 500; seed++) {
      const code = makeRoomCode(mulberry32(seed));
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('is a pure function of the stream — same seed, same code', () => {
    expect(makeRoomCode(mulberry32(1234))).toBe(makeRoomCode(mulberry32(1234)));
    expect(makeRoomCode(mulberry32(1))).not.toBe(makeRoomCode(mulberry32(2)));
  });

  it('honours a custom length', () => {
    expect(makeRoomCode(mulberry32(7), 8)).toHaveLength(8);
    expect(makeRoomCode(mulberry32(7), 1)).toHaveLength(1);
    expect(makeRoomCode(mulberry32(7), 0)).toBe('');
  });

  it('never indexes off the alphabet, even for a broken Rng that returns 1', () => {
    // mulberry32 yields [0, 1); a pathological source that returns exactly 1
    // must still land on the last character, not `undefined`.
    const stuckHigh = { next: () => 1 };
    const code = makeRoomCode(stuckHigh, CODE_LENGTH);
    const lastChar = CODE_ALPHABET[CODE_ALPHABET.length - 1]!;
    expect(code).toBe(lastChar.repeat(CODE_LENGTH));
  });
});
