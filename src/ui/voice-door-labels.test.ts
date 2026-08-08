/**
 * src/ui/voice-door-labels.test.ts — the door-label trap, closed.
 *
 * The three doors are named in **two kinds of place**: the buttons themselves
 * ({@link DOOR_OPTIONS}), and the error copy that points a stranded player back at
 * one of them. The second kind is the trap. `'Cannot reach the server. PLAY SOLO
 * still works.'` lives in `lobby-entry.ts`, `online-copy.ts` (twice) and
 * `connection-status.ts`, none of which read the label constant — so a door rename
 * leaves four strings quietly naming a button that no longer exists, and nothing
 * goes red.
 *
 * That is not a cosmetic drift. It is the accessibility clause of GDD §4.7 failing
 * in the one place it matters most: a refusal has to tell a player what to *do*,
 * and an instruction naming a button they cannot find is worse than no instruction.
 *
 * So this file asserts the relationship rather than the prose — the shape
 * `lobby-entry.test.ts:213` already uses (`toContain('SOLO')`, a substring, not a
 * sentence). Every string that points at the offline door must name it by its
 * *current* label, and no rendered copy anywhere may still carry a retired one.
 * Rename a door and this fails loudly, which is the whole point.
 */

import { describe, it, expect } from 'vitest';
import { DOOR_OPTIONS, ENTRY_ERRORS } from './lobby-entry';
import { resolveFailureMessage, reconnectEndedCopy } from './online-copy';
import { connectionStatusModel } from './connection-status';
import type { ResolveFailure } from '../net/allocator-client';
import type { StopReason } from '../net/reconnect';

const RESOLVE_FAILURES: readonly ResolveFailure[] = [
  'not-found',
  'no-capacity',
  'bad-response',
  'network',
];
const STOP_REASONS: readonly StopReason[] = ['room-gone', 'grace-elapsed'];

/** The current label on each door, read from the one place it is authored. */
const doorLabel = (door: 'solo' | 'create' | 'join'): string =>
  DOOR_OPTIONS.find((d) => d.door === door)!.label;

/**
 * Every player-facing string outside the door buttons that could name a door.
 * Machine copy is included on purpose: §4.7 keeps it plain and diagnostic, but a
 * door label quoted inside it still has to follow the door.
 */
function renderedCopy(): string[] {
  const out: string[] = [...Object.values(ENTRY_ERRORS)];
  for (const reason of RESOLVE_FAILURES) out.push(resolveFailureMessage(reason));
  for (const reason of STOP_REASONS) {
    const copy = reconnectEndedCopy(reason);
    out.push(copy.headline, copy.detail);
  }
  // The disconnect panel's own fallback detail — the one that is NOT read out of
  // RECONNECT_ENDED_COPY, and so the one a table-only sweep misses.
  const disconnected = connectionStatusModel({
    state: 'closed',
    online: true,
    closeReason: null,
  });
  out.push(disconnected.headline, disconnected.detail);
  return out.filter((s) => s.length > 0);
}

describe('door labels quoted in other copy', () => {
  it('points every offline refusal at the offline door by its current label', () => {
    const solo = doorLabel('solo');
    const pointers = renderedCopy().filter((s) => /still works/.test(s));
    // Three today: the entry screen's offline error, the network resolve failure,
    // and the lost-server detail. If one is ever dropped this count is the alarm.
    expect(pointers.length).toBeGreaterThanOrEqual(3);
    for (const line of pointers) expect(line).toContain(solo);
  });

  it('leaves no retired door label anywhere in rendered copy', () => {
    // The pre-voice labels (l2-02). A hit here means a rename stopped half-done.
    const retired = ['PLAY SOLO', 'CREATE ROOM', 'JOIN ROOM'];
    const live = new Set(DOOR_OPTIONS.map((d) => d.label));
    for (const label of retired) expect(live.has(label)).toBe(false);

    for (const line of renderedCopy()) {
      for (const label of retired) expect(line).not.toContain(label);
    }
  });

  it('keeps the two copies of the unknown-code refusal in agreement', () => {
    // Authored twice with no shared constant (copy-sweep §5.5): fixing one and not
    // the other is worse than fixing neither, because the disagreement is invisible.
    expect(resolveFailureMessage('not-found')).toBe(ENTRY_ERRORS.unknown);
  });

  it('keeps every refusal readable with the fiction word stripped out', () => {
    // §4.7's accessibility clause: delete "claim" and the meaning must survive.
    // Each refusal still names its reason and what to do about it.
    expect(ENTRY_ERRORS.unknown.replace(/claim/gi, 'room')).toContain('Check it and try again');
    expect(ENTRY_ERRORS.full).toMatch(/is full/);
    expect(ENTRY_ERRORS.offline).toMatch(/Cannot reach the server/);
    expect(ENTRY_ERRORS.short).toMatch(/\d+ characters/);
  });
});
