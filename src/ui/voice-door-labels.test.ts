/**
 * src/ui/voice-door-labels.test.ts — the door-label trap, closed.
 *
 * The four doors are named in **two kinds of place**: the buttons themselves
 * ({@link DOOR_OPTIONS}), and the copy that points a stranded player back at one
 * of them. The second kind is the trap. `'Cannot reach the server. <the offline
 * door> still works.'` lives in `lobby-entry.ts`, `online-copy.ts` (twice) and
 * `connection-status.ts`, none of which read the label constant — so a door
 * rename leaves four strings quietly naming a button that no longer exists, and
 * nothing goes red.
 *
 * That is not a cosmetic drift. It is the accessibility clause of GDD §4.7 failing
 * in the one place it matters most: a refusal has to tell a player what to *do*,
 * and an instruction naming a button they cannot find is worse than no instruction.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CENTRAL TEST IS A SHAPE RULE AND NOT A LIST OF OLD WORDS (a0-15)
 * ---------------------------------------------------------------------------
 * This file used to hold a hand-written list of retired labels — `PLAY SOLO`,
 * `CREATE ROOM`, `JOIN ROOM` — and assert none of them survived in copy. That
 * catches the *last* rename and nothing else: the list is a third place to
 * remember, so the rename after it walks straight past. LESSONS §20 is exactly
 * this failure — two lists that must agree, with nothing connecting them at
 * runtime — and the fix there is the same as the fix here: **derive the check
 * from the live data instead of restating it.**
 *
 * So the rule below never names a door at all. A door label on this screen is an
 * ALL-CAPS phrase, and every all-caps phrase in player-facing copy is therefore
 * either a door that exists, or something that is admittedly not a door and is
 * listed as such with its reason ({@link NOT_A_DOOR}). Rename a door and forget
 * one error message and the message's now-orphaned phrase matches neither, which
 * is a failure with the old words printed in it. It works in both directions and
 * for renames nobody has thought of yet: re-word `SOLO` into a two-word label and
 * this reds just as loudly as the reverse, because the copy would still be
 * pointing at `SOLO` and `SOLO` would no longer be a door.
 *
 * (The DoD grep for the retired phrases is the belt to this file's braces: the
 * grep sweeps *source*, including comments and the docs the next agent reads;
 * this sweeps what is actually *rendered*. Neither sees what the other does.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOOR_OPTIONS, ENTRY_COMING_SOON, ENTRY_ERRORS } from './lobby-entry';
import { BROWSE_COPY, JOIN_MODES, JOIN_MODE_LABELS } from './lobby-browser';
import { listingFailureMessage, resolveFailureMessage, reconnectEndedCopy } from './online-copy';
import type { ListingJoinFailure } from '../net/lobby-list';
import { connectionStatusModel } from './connection-status';
import type { ConnectionState } from '../net/transport';
import type { ResolveFailure } from '../net/allocator-client';
import type { StopReason } from '../net/reconnect';

const RESOLVE_FAILURES: readonly ResolveFailure[] = [
  'not-found',
  'no-capacity',
  'bad-response',
  'network',
];
const LISTING_FAILURES: readonly ListingJoinFailure[] = [...RESOLVE_FAILURES, 'room-full'];
const STOP_REASONS: readonly StopReason[] = ['room-gone', 'grace-elapsed'];
const CONNECTION_STATES: readonly ConnectionState[] = [
  'connecting',
  'reconnecting',
  'closed',
  'open',
];

/** The current label on each door, read from the one place it is authored. */
const doorLabel = (door: 'solo' | 'create' | 'join'): string =>
  DOOR_OPTIONS.find((d) => d.door === door)!.label;

/**
 * Every player-facing string outside the door buttons that could name a door.
 * Machine copy is included on purpose: §4.7 keeps it plain and diagnostic, but a
 * door label quoted inside it still has to follow the door.
 *
 * The door **hints** are in here too — they sit under the buttons and are read in
 * the same glance, so a hint naming a sibling door is the same failure one line
 * lower down.
 */
function renderedCopy(): string[] {
  const out: string[] = [...Object.values(ENTRY_ERRORS), ENTRY_COMING_SOON];
  for (const option of DOOR_OPTIONS) out.push(option.hint);
  for (const reason of RESOLVE_FAILURES) out.push(resolveFailureMessage(reason));
  // The lobby browser's own lines (u17-01) — the two segment words, the sentence
  // an empty list says, and every refusal a ROW can earn. They point at controls
  // exactly as the door copy does, so they are swept exactly as the door copy is.
  for (const mode of JOIN_MODES) out.push(JOIN_MODE_LABELS[mode]);
  out.push(...Object.values(BROWSE_COPY));
  for (const reason of LISTING_FAILURES) out.push(listingFailureMessage(reason));
  for (const reason of STOP_REASONS) {
    const copy = reconnectEndedCopy(reason);
    out.push(copy.headline, copy.detail);
  }
  // Every state of the disconnect panel, including the fallback detail that is
  // NOT read out of RECONNECT_ENDED_COPY — the one a table-only sweep misses.
  for (const state of CONNECTION_STATES) {
    const model = connectionStatusModel({ state, online: true, closeReason: null });
    out.push(model.headline, model.detail, model.action ?? '');
  }
  return out.filter((s) => s.length > 0);
}

/**
 * Every ALL-CAPS phrase in one line, **maximal**, so a two-word label is one
 * phrase and not two. That is what makes the check honest: a substring test would
 * see `SOLO` inside a longer stale label and wave the sentence through.
 *
 * Single letters are not phrases (`'A room code is 4 characters.'`), and a word
 * that merely starts a sentence is mixed case and never matches.
 */
function capsPhrases(line: string): string[] {
  const runs = line.match(/\b[A-Z][A-Z0-9]*(?:\s+[A-Z][A-Z0-9]*)*\b/g) ?? [];
  return runs.filter((run) => run.replace(/\s+/g, '').length >= 2);
}

/**
 * The all-caps phrases in rendered copy that are **admittedly not doors**, each
 * with the reason it is allowed to shout. Anything else must be a live door.
 *
 * Keep this list short and hostile. It is the escape hatch, and every entry is a
 * promise that a player reading that word will not go hunting the entry screen
 * for a button with it on.
 */
const NOT_A_DOOR: ReadonlyMap<string, string> = new Map([
  // The connection overlay's own headlines — states, not controls. They are the
  // *subject* of the panel a player is already looking at.
  ['CONNECTING', 'connection-status headline: a state'],
  ['RECONNECTING', 'connection-status headline: a state'],
  ['DISCONNECTED', 'connection-status headline: a state'],
  ['MATCH ENDED', 'online-copy headline: a state'],
  ['AWAY TOO LONG', 'online-copy headline: a state'],
  // A control, but not a door — it is drawn inside the overlay that names it, so
  // it can never send anybody to the entry screen looking for it.
  ['BACK TO MENU', 'connection-status action: the button on that same panel'],
  // The JOIN screen's two modes (u17-01). Controls, and they are drawn on the
  // very screen the copy naming them is drawn on — a player told to press ENTER
  // ROOM CODE is looking at it while they read the line.
  ['BROWSE', 'lobby-browser: the JOIN screen’s own mode switch'],
  ['ENTER ROOM CODE', 'lobby-browser: the JOIN screen’s own mode switch'],
  ['BACK', 'the footer plate every screen carries (u2 menu-back)'],
  ['NO OPEN ROOMS RIGHT NOW', 'lobby-browser headline: a state, and the one it names'],
]);

describe('door labels quoted in other copy', () => {
  it('names no door that is not on the entry screen', () => {
    // THE RULE (see the file header): every all-caps phrase in rendered copy is a
    // live door, or is declared not to be one. No list of old words anywhere.
    const doors = new Set(DOOR_OPTIONS.map((d) => d.label));
    const orphans: string[] = [];
    for (const line of renderedCopy()) {
      for (const phrase of capsPhrases(line)) {
        if (doors.has(phrase) || NOT_A_DOOR.has(phrase)) continue;
        orphans.push(`"${phrase}" in "${line}" — not a door (doors: ${[...doors].join(', ')})`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('points every offline refusal at the offline door by its current label', () => {
    const solo = doorLabel('solo');
    const pointers = renderedCopy().filter((s) => /still works/.test(s));
    // Three today: the entry screen's offline error, the network resolve failure,
    // and the lost-server detail. If one is ever dropped this count is the alarm.
    expect(pointers.length).toBeGreaterThanOrEqual(3);
    for (const line of pointers) expect(line).toContain(solo);
  });

  it('keeps every door label distinguishable from every other one', () => {
    // The rule above compares whole phrases, and the "still works" rule above
    // compares a substring — which is only sound while no label contains another.
    // `SOLO` inside a hypothetical `SOLO GAME` would make a stale sentence pass
    // the second test, so the two doors may never nest.
    for (const a of DOOR_OPTIONS) {
      for (const b of DOOR_OPTIONS) {
        if (a.door === b.door) continue;
        expect(a.label.includes(b.label), `${a.label} contains ${b.label}`).toBe(false);
      }
    }
  });

  it('keeps the two copies of the unknown-code refusal in agreement', () => {
    // Authored twice with no shared constant (copy-sweep §5.5): fixing one and not
    // the other is worse than fixing neither, because the disagreement is invisible.
    expect(resolveFailureMessage('not-found')).toBe(ENTRY_ERRORS.unknown);
  });

  it('leaves no door word measured only in a stale copy of itself', () => {
    // `tests/mobile/voice-copy-fit.spec.ts` is a Playwright spec — it cannot import
    // this module (the graph reaches Pixi through `./lobby`), so it QUOTES the copy
    // it measures, and a quoted string is a second list that can go stale. r6-01
    // lost 43 hours to exactly that in exactly that file: a font stack retyped
    // there had been retired here, so the spec measured a face the app no longer
    // drew and reported a confident, wrong headroom.
    //
    // A hint that is edited without re-measuring is the same bug with the copy
    // moving instead of the font — and this hint is the only text in the game that
    // has actually overflowed its box. So: every label and every hint must appear
    // verbatim in the spec. This does not measure anything; it asserts the
    // measurement is pointed at the words that ship.
    const spec = readFileSync(
      fileURLToPath(new URL('../../tests/mobile/voice-copy-fit.spec.ts', import.meta.url)),
      'utf8',
    );
    const unmeasured = DOOR_OPTIONS.flatMap((d) =>
      [d.label, d.hint].filter((text) => !spec.includes(text)),
    );
    expect(unmeasured).toEqual([]);
  });

  it('keeps every refusal readable with the fiction word stripped out', () => {
    // §4.7's accessibility clause: delete the flavour noun and the meaning must
    // survive. a0-108 took the last one out of these four — they now read plainly
    // with nothing to strip, which is the strongest form of passing this. Each
    // still names its reason and what to do about it.
    expect(ENTRY_ERRORS.unknown).toContain('Check it and try again');
    expect(ENTRY_ERRORS.full).toMatch(/is full/);
    expect(ENTRY_ERRORS.offline).toMatch(/Cannot reach the server/);
    expect(ENTRY_ERRORS.short).toMatch(/\d+ characters/);
  });
});
