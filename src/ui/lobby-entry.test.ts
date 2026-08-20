/**
 * src/ui/lobby-entry.test.ts — the door into a room, and the pad a code is
 * typed on. Model and geometry together, because they are one deliverable.
 *
 * What these assertions defend, in the order they would bite on a real phone:
 *
 *  1. **SOLO always works.** It is the one door that needs no server (GDD §4.8
 *     risks 2 and 6), so it is asserted to be offline, drawn as the screen's one
 *     affirmative action, and reachable in one tap from a cold screen — including
 *     now that CAMPAIGN (u9-01) sits above it and takes the first slot.
 *  1b. **CAMPAIGN answers and goes nowhere.** The teaser is first, lit, and
 *     pressable; pressing it says `Coming Soon…`, opens no transport, moves no
 *     screen, and leaves every other door behaving exactly as before.
 *  2. **A code cannot be mistyped into an unsendable state.** The pad holds only
 *     the ambiguity-free alphabet, the field cannot overflow, and a short code
 *     is refused here rather than by a round trip.
 *  3. **A double-tap cannot open two rooms.** Every control is dead while an
 *     attempt is in flight, and comes back — with the code intact — if it fails.
 *  4. **The pad is hittable on the smallest phone the game claims.** Keys stay
 *     inside the safe box, never overlap, and a tap maps back to the key it was
 *     drawn as — the same containment contract `./lobby-geometry.test.ts` holds
 *     the lobby to, since the entry screen is likewise invisible to QA's live
 *     layout check.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@shared/types';
import { rectContains } from '@platform/layout-registry';
import type { Rect, Viewport } from '@platform/layout-registry';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './lobby';
import {
  DOOR_OPTIONS,
  DOOR_ORDER,
  ENTRY_COMING_SOON,
  ENTRY_ERRORS,
  ENTRY_TAGLINE,
  KEYPAD_COLUMNS,
  KEYPAD_KEYS,
  backToDoors,
  canSubmitJoin,
  chooseDoor,
  chooseJoinMode,
  createEntry,
  entryConnected,
  entryErrorFor,
  entryFailed,
  entryLive,
  entryModel,
  eraseEntryCode,
  submitJoin,
  typeEntryCode,
} from './lobby-entry';
import type { EntryDoor, EntryState } from './lobby-entry';
import { JOIN_MODES } from './lobby-browser';
import { TOUCH_MIN } from '../art/materials';
import { singlePrimary } from './gantry';
import {
  DOOR_COUNT,
  KEYPAD_COLUMNS as GEOMETRY_KEYPAD_COLUMNS,
  KEYPAD_KEY_COUNT,
  KEY_MIN,
  entryHitTest,
  entryLayout,
  entryTargetKey,
} from './lobby-geometry';
import type { EntryLayout } from './lobby-geometry';

const rng = () => mulberry32(20260724);

/** A join screen with `code` already typed. */
function typed(code: string): EntryState {
  let state = chooseDoor(createEntry(), 'join', rng()).state;
  for (const ch of code) state = typeEntryCode(state, ch);
  return state;
}

// ---------------------------------------------------------------------------
// 1. The three doors
// ---------------------------------------------------------------------------

describe('the doors (GDD §2.1, §4.2 — how a match is entered)', () => {
  it('offers CAMPAIGN first, above the solo door (u9-01 — "it goes ontop of Solo")', () => {
    // The ratified thing here is the ORDER — CAMPAIGN sits above SOLO in every
    // shape this screen has. The labels are asserted alongside it: l2-02 re-worded
    // the solo door into the industrial voice and a0-15 put the plain word back,
    // and neither of those moved the order u9-01 asked for.
    expect(DOOR_ORDER[0]).toBe('campaign');
    expect(DOOR_ORDER[1]).toBe('solo');
    expect(DOOR_OPTIONS[0]?.label).toBe('CAMPAIGN');
    expect(DOOR_OPTIONS[1]?.label).toBe('SOLO');
  });

  it('offers SOLO WITHOUT a server, and as the only door that needs none (GDD §4.8 risk 6)', () => {
    const solo = DOOR_OPTIONS.find((d) => d.door === 'solo');
    expect(solo?.needsNetwork).toBe(false);
    expect(solo?.comingSoon).toBe(false);
    // Both online doors need one; the teaser above never asks for one either, but
    // it is the ONLY other door that does not — and it is not a way into a match.
    expect(DOOR_OPTIONS.filter((d) => !d.needsNetwork && !d.comingSoon)).toHaveLength(1);
    expect(DOOR_OPTIONS.filter((d) => d.needsNetwork)).toHaveLength(2);
  });

  it('says the four plain words the developer ratified (a0-15)', () => {
    // Developer, 2026-08-07, reading the entry screen after the voice sweep:
    // "you took this too far, its too complicated, you can switch it back to how
    // it was CAMPAIGN, SOLO, HOST, JOIN... its way too complex for new players to
    // understand". These four are therefore NOT the voice's to take — the
    // exception is written down in `docs/copy-sweep-industrial-voice.md` §0 and
    // `docs/lore-copy-sweep.md` §0, and pinned here so a sweep that skips the
    // docs still trips over it.
    expect(DOOR_OPTIONS.map((d) => d.label)).toEqual(['CAMPAIGN', 'SOLO', 'HOST', 'JOIN']);
    // One word each, and it is the word the button does. A door label that grew a
    // second word is the shape of the change that was reverted.
    for (const option of DOOR_OPTIONS) {
      expect(option.label.split(' '), `${option.door} label`).toHaveLength(1);
    }
  });

  it('explains the room code on the two doors that need it, and nowhere else', () => {
    // A first-time player can guess what SOLO does. They cannot guess that HOST
    // hands out a code and JOIN takes one — that is the one mechanic this screen
    // genuinely has to teach, so both online hints have to carry it (a0-15).
    const hint = (door: EntryDoor): string => DOOR_OPTIONS.find((d) => d.door === door)!.hint;
    expect(hint('create')).toMatch(/code/i);
    expect(hint('join')).toMatch(/code/i);
    // …and SOLO keeps the offline promise (GDD §4.8 risk 6) in words a player can
    // act on, rather than in the register's word for it.
    expect(hint('solo')).toMatch(/no internet needed/i);
  });

  it('names all four doors exactly once, in DOOR_ORDER', () => {
    expect(DOOR_OPTIONS.map((d) => d.door)).toEqual([...DOOR_ORDER]);
    expect(new Set(DOOR_ORDER).size).toBe(DOOR_ORDER.length);
    expect(DOOR_ORDER).toHaveLength(DOOR_COUNT);
    for (const option of DOOR_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
      // Words only — this screen has no numbers (the screen's standing rule).
      expect(option.label, `${option.door} label`).not.toMatch(/[0-9]/);
      expect(option.hint, `${option.door} hint`).not.toMatch(/[0-9]/);
    }
  });

  it('puts a solo player into a match in ONE tap, offline', () => {
    const { state, intent } = chooseDoor(createEntry(), 'solo', rng());
    expect(intent).not.toBeNull();
    expect(intent?.door).toBe('solo');
    expect(intent?.online).toBe(false);
    // Solo still gets a room code, so the lobby it opens is the same lobby.
    expect(intent?.room).toHaveLength(ROOM_CODE_LENGTH);
    expect(state.status).toBe('connecting');
  });

  it('creates an online room with a fresh, readable code', () => {
    const { intent } = chooseDoor(createEntry(), 'create', rng());
    expect(intent?.door).toBe('create');
    expect(intent?.online).toBe(true);
    expect(intent?.room).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of intent?.room ?? '') expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('draws that code from the ratified seeded PRNG, never Math.random()', () => {
    const a = chooseDoor(createEntry(), 'create', mulberry32(99)).intent?.room;
    const b = chooseDoor(createEntry(), 'create', mulberry32(99)).intent?.room;
    expect(a).toBe(b);
  });

  it('opens the keypad for JOIN rather than resolving anything', () => {
    const { state, intent } = chooseDoor(createEntry(), 'join', rng());
    expect(intent).toBeNull();
    expect(state.screen).toBe('join');
    expect(state.code).toBe('');
  });

  it('comes back to a clean home screen from the keypad', () => {
    const { state } = backToDoors(typed('K7Q'));
    expect(state).toEqual(createEntry());
  });
});

// ---------------------------------------------------------------------------
// 1b. CAMPAIGN — the teaser (u9-01)
// ---------------------------------------------------------------------------

describe('the CAMPAIGN door says Coming Soon… and goes nowhere (u9-01)', () => {
  it('is a coming-soon door and NOT a disabled one', () => {
    const campaign = DOOR_OPTIONS.find((d) => d.door === 'campaign');
    expect(campaign?.comingSoon).toBe(true);
    // "Disabled" on this screen means "needs a server and there isn't one", and it
    // must always carry its reason (p4-03). The teaser is neither of those: the
    // model draws it live, exactly like every other door.
    expect(entryModel(createEntry()).doors[0]?.enabled).toBe(true);
    expect(entryModel(createEntry()).doors[0]?.comingSoon).toBe(true);
  });

  it('answers with the message, and does not navigate, connect, or mint a code', () => {
    const { state, intent } = chooseDoor(createEntry(), 'campaign', rng());
    // No intent at all — the caller's ONLY cue to open a transport (`EntryResult`),
    // so this door cannot reach the network even by accident.
    expect(intent).toBeNull();
    expect(state.notice).toBe(ENTRY_COMING_SOON);
    // Still on the doors, still idle, still nothing typed and nothing wrong.
    expect(state.screen).toBe('home');
    expect(state.status).toBe('idle');
    expect(state.code).toBe('');
    expect(state.error).toBe('');
    expect(entryLive(state)).toBe(true);
    expect(entryModel(state).notice).toBe(ENTRY_COMING_SOON);
  });

  it('is not an error — the message is never the red line', () => {
    const model = entryModel(chooseDoor(createEntry(), 'campaign', rng()).state);
    expect(model.error).toBe('');
    // …and the standing tagline is still what `prompt` carries, so the notice
    // cannot be mistaken for the screen's own line by anything reading the model.
    expect(model.prompt).toBe(ENTRY_TAGLINE);
  });

  it('says the same thing on a second press, without churning state', () => {
    const once = chooseDoor(createEntry(), 'campaign', rng()).state;
    const twice = chooseDoor(once, 'campaign', rng());
    expect(twice.intent).toBeNull();
    expect(twice.state.notice).toBe(ENTRY_COMING_SOON);
    expect(twice.state).toBe(once); // a no-op returns the same value
  });

  it('leaves every other door behaving exactly as before', () => {
    const noticed = chooseDoor(createEntry(), 'campaign', rng()).state;

    // SOLO still resolves offline in one press, from the noticed screen.
    const solo = chooseDoor(noticed, 'solo', rng());
    expect(solo.intent?.door).toBe('solo');
    expect(solo.intent?.online).toBe(false);
    expect(solo.state.notice).toBe('');

    // CREATE still mints a code and goes online.
    const create = chooseDoor(noticed, 'create', rng());
    expect(create.intent?.online).toBe(true);
    expect(create.intent?.room).toHaveLength(ROOM_CODE_LENGTH);
    expect(create.state.notice).toBe('');

    // JOIN still opens the keypad, clean.
    const join = chooseDoor(noticed, 'join', rng());
    expect(join.intent).toBeNull();
    expect(join.state.screen).toBe('join');
    expect(join.state.notice).toBe('');
    expect(backToDoors(join.state).state).toEqual(createEntry());
  });

  it('is dead while an attempt is in flight, like every other door', () => {
    const flight = chooseDoor(createEntry(), 'create', rng()).state;
    expect(chooseDoor(flight, 'campaign', rng()).state).toBe(flight);
    expect(chooseDoor(flight, 'campaign', rng()).intent).toBeNull();
  });

  it('yields the message slot to a real refusal, and to a live narration', () => {
    const noticed = chooseDoor(createEntry(), 'campaign', rng()).state;
    // A refusal is the thing that is genuinely wrong, so it takes the line.
    const failed = entryFailed(noticed, ENTRY_ERRORS.offline);
    expect(failed.notice).toBe('');
    expect(entryModel(failed).error).toBe(ENTRY_ERRORS.offline);
    // …and a connect narrating its way to a seat is not interrupted by a teaser.
    expect(entryModel(noticed, { line: 'ALLOCATING ROOM…', failed: false }).notice).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. Typing a code
// ---------------------------------------------------------------------------

describe('typing a room code (GDD §2.4 — a canvas, so the pad is taps)', () => {
  it('offers the whole ambiguity-free alphabet and nothing else', () => {
    expect(KEYPAD_KEYS.join('')).toBe(ROOM_CODE_ALPHABET);
    for (const ambiguous of ['O', '0', 'I', '1']) {
      expect(KEYPAD_KEYS).not.toContain(ambiguous);
    }
  });

  it('accepts a tap and a keypress by the same rule', () => {
    // The pad hands back a character; a desktop keyboard hands back a key. Both
    // go through typeEntryCode, and lower case is folded like the wire folds it.
    expect(typeEntryCode(typed(''), KEYPAD_KEYS[3] as string).code).toBe(KEYPAD_KEYS[3]);
    expect(typed('k7qm').code).toBe('K7QM');
  });

  it('drops characters that could never be part of a code', () => {
    expect(typed('K-7 Q?M').code).toBe('K7QM');
    expect(typed('O0I1').code).toBe('');
  });

  it('never overflows the code length', () => {
    expect(typed('K7QMZZZZ').code).toHaveLength(ROOM_CODE_LENGTH);
    expect(typed('K7QMZZZZ').code).toBe('K7QM');
  });

  it('erases one character at a time, and stops at empty', () => {
    expect(eraseEntryCode(typed('K7Q')).code).toBe('K7');
    const blank = typed('');
    expect(eraseEntryCode(blank).code).toBe('');
    expect(eraseEntryCode(blank)).toBe(blank); // a no-op returns the same value
  });

  it('ignores typing on the home screen — there is no field there', () => {
    const home = createEntry();
    expect(typeEntryCode(home, 'K')).toBe(home);
    expect(eraseEntryCode(home)).toBe(home);
  });
});

// ---------------------------------------------------------------------------
// 3. Submitting, failing, and trying again
// ---------------------------------------------------------------------------

describe('sending the code (and what happens when it comes back refused)', () => {
  it('refuses a short code HERE, with a sentence, not by a round trip', () => {
    expect(canSubmitJoin(typed('K7Q'))).toBe(false);
    const { state, intent } = submitJoin(typed('K7Q'));
    expect(intent).toBeNull();
    expect(state.status).toBe('error');
    expect(state.error).toBe(ENTRY_ERRORS.short);
    // The three characters they typed are still there to finish.
    expect(state.code).toBe('K7Q');
  });

  it('sends a complete code as an online join', () => {
    expect(canSubmitJoin(typed('K7QM'))).toBe(true);
    const { state, intent } = submitJoin(typed('K7QM'));
    expect(intent).toEqual({ door: 'join', room: 'K7QM', online: true });
    expect(state.status).toBe('connecting');
    expect(state.error).toBe('');
  });

  it('goes DEAD while an attempt is in flight — a double-tap cannot open two rooms', () => {
    const flight = chooseDoor(createEntry(), 'create', rng()).state;
    expect(entryLive(flight)).toBe(false);
    expect(chooseDoor(flight, 'create', rng()).intent).toBeNull();
    expect(chooseDoor(flight, 'solo', rng()).intent).toBeNull();
    expect(backToDoors(flight).state).toBe(flight);

    const joining = submitJoin(typed('K7QM')).state;
    expect(submitJoin(joining).intent).toBeNull();
    expect(typeEntryCode(joining, 'Z')).toBe(joining);
  });

  it('comes back live on a failure, with the code KEPT for another try', () => {
    const failed = entryFailed(submitJoin(typed('K7QM')).state, ENTRY_ERRORS.full);
    expect(entryLive(failed)).toBe(true);
    expect(failed.error).toBe(ENTRY_ERRORS.full);
    expect(failed.code).toBe('K7QM');
    expect(canSubmitJoin(failed)).toBe(true);
  });

  it('names the door that still works when the server cannot be reached', () => {
    expect(entryFailed(createEntry()).error).toBe(ENTRY_ERRORS.offline);
    expect(ENTRY_ERRORS.offline).toContain('SOLO');
  });

  it('clears the error as soon as the player starts fixing it', () => {
    const failed = entryFailed(submitJoin(typed('K7Q')).state, ENTRY_ERRORS.unknown);
    expect(typeEntryCode(failed, 'M').error).toBe('');
    expect(eraseEntryCode(failed).error).toBe('');
  });

  it('rests the screen once the lobby has taken over', () => {
    expect(entryConnected()).toEqual(createEntry());
  });
});

// ---------------------------------------------------------------------------
// 4. The frame model
// ---------------------------------------------------------------------------

describe('the frame model', () => {
  it('lays out one cell per code character, with the caret on the next', () => {
    const model = entryModel(typed('K7'));
    expect(model.cells).toHaveLength(ROOM_CODE_LENGTH);
    expect(model.cells.map((c) => c.char)).toEqual(['K', '7', '', '']);
    expect(model.cells.map((c) => c.filled)).toEqual([true, true, false, false]);
    expect(model.cells.filter((c) => c.active)).toHaveLength(1);
    expect(model.cells[2]?.active).toBe(true);
  });

  it('puts no caret on a full code — there is nowhere for one to go', () => {
    expect(entryModel(typed('K7QM')).cells.some((c) => c.active)).toBe(false);
  });

  it('greys every control while connecting, and says so', () => {
    const model = entryModel(chooseDoor(createEntry(), 'create', rng()).state);
    expect(model.connecting).toBe(true);
    expect(model.doors.every((d) => !d.enabled)).toBe(true);
    expect(model.prompt).toContain('CONNECTING');
  });

  it('carries the failure line for the view to draw', () => {
    expect(entryModel(entryFailed(createEntry(), ENTRY_ERRORS.full)).error).toBe(ENTRY_ERRORS.full);
    expect(entryModel(createEntry()).error).toBe('');
  });

  // --- The title carries the connect narration (M10 status-in-title) --------

  it('gives the TITLE to the live connect narration, not to the word CONNECTING', () => {
    // "show it at the top where it says CONNECTING… we don't need a separate
    // pop-up for it" — so the one text element at the top of the screen advances,
    // and the static word is never what a player watching an online join reads.
    const connecting = chooseDoor(createEntry(), 'create', rng()).state;
    const titles = [
      'ALLOCATING ROOM…',
      'ROOM Q5RN · TICKET SIGNED',
      'DIALING MACHINE 0800d5b6…',
      'JOINED · SEAT 2',
    ].map((line) => entryModel(connecting, { line, failed: false }));

    expect(titles.map((m) => m.prompt)).toEqual([
      'ALLOCATING ROOM…',
      'ROOM Q5RN · TICKET SIGNED',
      'DIALING MACHINE 0800d5b6…',
      'JOINED · SEAT 2',
    ]);
    expect(titles.every((m) => m.narrating)).toBe(true);
    // Nothing is *wrong* on the way to a seat, so nothing is red.
    expect(titles.every((m) => m.error === '')).toBe(true);
  });

  it('puts the exact refusal in the title, and says it once', () => {
    const failed = entryFailed(chooseDoor(createEntry(), 'create', rng()).state, ENTRY_ERRORS.offline);
    const line = 'REFUSED: bad-ticket — machine mismatch';
    const model = entryModel(failed, { line, failed: true });
    // The narration's own last step IS the failure, said exactly — so it takes the
    // title AND the red, and the screen's generic sentence stands down rather than
    // becoming a second explanation of one refusal.
    expect(model.prompt).toBe(line);
    expect(model.error).toBe(line);
    expect(model.error).not.toBe(ENTRY_ERRORS.offline);
  });

  it('leaves the screen exactly as it was when nobody is narrating', () => {
    // SOLO opens no socket, so it has no story and keeps the plain word; a
    // mistyped code is still the screen's own error, not the netcode's.
    const solo = entryModel(chooseDoor(createEntry(), 'create', rng()).state, null);
    expect(solo.prompt).toContain('CONNECTING');
    expect(solo.narrating).toBe(false);
    // An empty line is no narration at all — a trace that has not taken its first
    // step must never blank the title.
    expect(entryModel(createEntry(), { line: '', failed: false }).prompt).toBe(ENTRY_TAGLINE);
    expect(entryModel(entryFailed(createEntry(), ENTRY_ERRORS.full), null).error).toBe(ENTRY_ERRORS.full);
  });

  it('subtitles the home screen with the tagline, not the title repeated (u2)', () => {
    // The field report: the line under the wordmark used to say "PLANET RUSH"
    // again. The subtitle is the pitch (GDD §2.3 triangle), never the name twice.
    const prompt = entryModel(createEntry()).prompt;
    expect(prompt).toBe(ENTRY_TAGLINE);
    expect(prompt).not.toBe('PLANET RUSH');
  });

  it('enables JOIN only on a complete code', () => {
    expect(entryModel(typed('K7Q')).canSubmit).toBe(false);
    expect(entryModel(typed('K7QM')).canSubmit).toBe(true);
    expect(entryModel(typed('')).canErase).toBe(false);
    expect(entryModel(typed('K')).canErase).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Geometry — the pad has to be hittable on the smallest phone
// ---------------------------------------------------------------------------

interface Profile {
  readonly name: string;
  readonly vp: Viewport;
  readonly touch: boolean;
}

const PROFILES: readonly Profile[] = [
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, touch: true },
  { name: 'pixel/landscape', vp: { width: 915, height: 412 }, touch: true },
  { name: 'iphone/portrait', vp: { width: 390, height: 844 }, touch: true },
  { name: 'iphone-se/portrait', vp: { width: 375, height: 667 }, touch: true },
  { name: 'small/portrait', vp: { width: 320, height: 568 }, touch: true },
  { name: 'ipad/portrait', vp: { width: 820, height: 1180 }, touch: true },
  { name: 'desktop', vp: { width: 1280, height: 800 }, touch: false },
  { name: 'desktop/wide', vp: { width: 1920, height: 1080 }, touch: false },
];

const PORTRAIT_INSETS = { top: 47, right: 0, bottom: 34, left: 0 };
const LANDSCAPE_INSETS = { top: 0, right: 47, bottom: 21, left: 47 };
const insetsFor = (vp: Viewport) => (vp.width > vp.height ? LANDSCAPE_INSETS : PORTRAIT_INSETS);

const fmt = (r: Rect): string =>
  `{x:${r.x.toFixed(1)}, y:${r.y.toFixed(1)}, w:${r.width.toFixed(1)}, h:${r.height.toFixed(1)}}`;

function allRects(layout: EntryLayout): Array<{ label: string; rect: Rect }> {
  return [
    { label: 'title', rect: layout.title },
    { label: 'message', rect: layout.message },
    ...layout.doors.map((rect, i) => ({ label: `door[${i}]`, rect })),
    ...layout.cells.map((rect, i) => ({ label: `cell[${i}]`, rect })),
    ...layout.keys.map((rect, i) => ({ label: `key[${i}]`, rect })),
    // The join screen's other half (u17-01) rides the same containment contract:
    // a0-24 had just finished pulling two elements back off this exact edge, and a
    // JOIN button that clips is the one thing this list may not do.
    ...layout.segments.map((rect, i) => ({ label: `segment[${i}]`, rect })),
    ...layout.browseRows.map((rect, i) => ({ label: `browseRow[${i}]`, rect })),
    ...layout.browseJoins.map((rect, i) => ({ label: `browseJoin[${i}]`, rect })),
    { label: 'browseStamp', rect: layout.browseStamp },
    { label: 'browseList', rect: layout.browseList },
    { label: 'back', rect: layout.back },
    { label: 'erase', rect: layout.erase },
    { label: 'submit', rect: layout.submit },
  ];
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

const center = (r: Rect): { x: number; y: number } => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe('the entry screen stays inside the screen it was given', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`keeps every rect inside the safe content box — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (const { label, rect } of allRects(layout)) {
        expect(
          rectContains(layout.content, rect),
          `${label} ${fmt(rect)} escaped content ${fmt(layout.content)}`,
        ).toBe(true);
      }
    });

    it(`honours the safe area — ${name}`, () => {
      const insets = insetsFor(vp);
      const layout = entryLayout(vp, { isTouch: touch, insets });
      expect(layout.content.x).toBeGreaterThanOrEqual(insets.left);
      expect(layout.content.y).toBeGreaterThanOrEqual(insets.top);
      expect(layout.content.x + layout.content.width).toBeLessThanOrEqual(vp.width - insets.right);
      expect(layout.content.y + layout.content.height).toBeLessThanOrEqual(
        vp.height - insets.bottom,
      );
    });

    it(`lays the pad out without overlap — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      // Doors and the keypad belong to different screens and are never drawn
      // together, so only same-screen rects are compared.
      const join = [
        ...layout.cells.map((rect, i) => ({ label: `cell[${i}]`, rect })),
        ...layout.keys.map((rect, i) => ({ label: `key[${i}]`, rect })),
        { label: 'back', rect: layout.back },
        { label: 'erase', rect: layout.erase },
        { label: 'submit', rect: layout.submit },
      ];
      for (const group of [join, layout.doors.map((rect, i) => ({ label: `door[${i}]`, rect }))]) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i];
            const b = group[j];
            if (!a || !b) continue;
            expect(overlaps(a.rect, b.rect), `${a.label} overlaps ${b.label}`).toBe(false);
          }
        }
      }
    });
  }

  it('degrades to zero-extent rather than to a backwards box', () => {
    const layout = entryLayout({ width: 40, height: 30 });
    for (const { label, rect } of allRects(layout)) {
      expect(rect.width, `${label} width`).toBeGreaterThanOrEqual(0);
      expect(rect.height, `${label} height`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('four doors are still four buttons (u9-01)', () => {
  it('lays out one rect per door, mirroring the model’s own count', () => {
    expect(DOOR_COUNT).toBe(DOOR_ORDER.length);
    expect(entryLayout({ width: 1280, height: 800 }).doors).toHaveLength(DOOR_OPTIONS.length);
  });

  for (const { name, vp, touch } of PROFILES) {
    it(`keeps CAMPAIGN directly above SOLO — ${name}`, () => {
      // The developer's words are literal: the campaign door goes ON TOP of solo.
      // In the stack that is the reading order; in the two-column shape the doors
      // fill column-major *precisely so this stays true* — same column, next row.
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const campaign = layout.doors[DOOR_ORDER.indexOf('campaign')] as Rect;
      const solo = layout.doors[DOOR_ORDER.indexOf('solo')] as Rect;
      expect(campaign.x, `same column on ${name}`).toBeCloseTo(solo.x, 5);
      expect(campaign.y, `campaign above solo on ${name}`).toBeLessThan(solo.y);
    });

    it(`keeps every door a THUMB target — ${name}`, () => {
      // The trap the fourth door set: four stacked blocks of button-plus-hint did
      // not fit a landscape phone's band, and a door compressed to a 20px stripe
      // is not a control. Under Gantry (u7-04) the hint moved INSIDE the plate, so
      // a door is one plate tall and the bar is the real one — the shared thumb
      // floor, not a bespoke "at least it's visible" number.
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (const [i, door] of layout.doors.entries()) {
        expect(door.height, `door[${i}] height on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(door.width, `door[${i}] width on ${name}`).toBeGreaterThan(0);
      }
    });
  }

  it('stacks where the band has the height, and columns where it does not', () => {
    // A desktop and a portrait phone both stack: one column, four rows.
    expect(entryLayout({ width: 1280, height: 800 }).doorShape).toBe('stack');
    expect(
      entryLayout({ width: 390, height: 844 }, { isTouch: true, insets: PORTRAIT_INSETS }).doorShape,
    ).toBe('stack');
    // A phone in LANDSCAPE — the primary mobile layout of this screen — still
    // cannot stack four, and the reason is now a *shared* one rather than this
    // screen's own: two beams and their gutters take 122 of that handset's 369
    // logical px, and four thumb-sized plates do not fit the 210 that are left.
    // So it does what every short band in this file does — changes ARRANGEMENT
    // rather than shrinking a control past usefulness.
    const phone = entryLayout({ width: 844, height: 390 }, { isTouch: true, insets: LANDSCAPE_INSETS });
    expect(phone.doorShape).toBe('columns');
    expect(new Set(phone.doors.map((d) => Math.round(d.x))).size).toBe(2);
    expect(new Set(phone.doors.map((d) => Math.round(d.y))).size).toBe(2);
    // Both columns come back to FULL plate height there — that is the whole point
    // of trading the stack away rather than compressing it.
    for (const door of phone.doors) expect(door.height).toBeGreaterThanOrEqual(TOUCH_MIN);
  });

  it('keeps the two columns’ rows in register, with the hero hanging lower', () => {
    // The left column carries the hero and is therefore taller than the right.
    // Centring each column in the band on its own would put the two rows visibly
    // out of register; they are top-aligned instead, so the rows line up and the
    // primary simply hangs lower — which is the size difference doing its job.
    const phone = entryLayout({ width: 844, height: 390 }, { isTouch: true, insets: LANDSCAPE_INSETS });
    const [campaign, solo, create, join] = phone.doors as [Rect, Rect, Rect, Rect];
    expect(campaign.y).toBeCloseTo(create.y, 5);
    expect(solo.y).toBeCloseTo(join.y, 5);
    expect(solo.height).toBeGreaterThan(join.height);
  });

  it('never lets the columns shape produce doors too narrow to read', () => {
    // A short, extremely narrow window has no width to halve, so it keeps the
    // stack — two unreadable columns are worse than one readable list.
    const narrow = entryLayout({ width: 300, height: 260 }, { isTouch: true });
    expect(narrow.doorShape).toBe('stack');
  });
});

// ---------------------------------------------------------------------------
// The Gantry re-skin (u7-04) — the material rules a screen can only break itself
// ---------------------------------------------------------------------------

describe('the doors in Gantry/Bone (u7-04)', () => {
  it('draws exactly ONE bright plate, and it is SOLO', () => {
    // Bone spends no colour: the primary action is simply the brightest and
    // biggest plate, which is only a signal while there is exactly one of them.
    const model = entryModel(createEntry());
    const roles = model.doors.map((d) => d.role);
    expect(singlePrimary(roles)).toBe(true);
    const primaries = model.doors.filter((d) => d.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.door).toBe('solo');
    expect(primaries[0]?.scale).toBe('hero');
  });

  it('draws CAMPAIGN as a full-contrast SECONDARY plate, never an inert surface', () => {
    // The re-skin's one way to get u9-01 wrong: `inert` is Gantry's word for a
    // surface that holds content rather than inviting a press, which is the
    // greyed-out door that brief exists to prevent, wearing a bevel.
    const campaign = entryModel(createEntry()).doors.find((d) => d.door === 'campaign');
    expect(campaign?.role).toBe('secondary');
    expect(campaign?.comingSoon).toBe(true);
    expect(campaign?.enabled).toBe(true);
    // …the same material as the two doors that are fully built, so it cannot be
    // told apart from them by anything except its own words.
    const create = entryModel(createEntry()).doors.find((d) => d.door === 'create');
    expect(campaign?.role).toBe(create?.role);
    expect(campaign?.scale).toBe(create?.scale);
  });

  it('gives SOLO the tallest plate on the screen at every profile', () => {
    // Size is half of what marks the primary (brightness is the other half, and
    // there is no third half, because Bone spends no hue). The stack compresses
    // proportionally, so the ratio has to survive the phone as well as the desk.
    for (const { name, vp, touch } of PROFILES) {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const solo = layout.doors[DOOR_ORDER.indexOf('solo')] as Rect;
      for (const [i, door] of layout.doors.entries()) {
        if (i === DOOR_ORDER.indexOf('solo')) continue;
        expect(solo.height, `solo taller than door[${i}] on ${name}`).toBeGreaterThan(door.height);
      }
    }
  });

  it('presses and hovers a plate, and a dead screen does neither', () => {
    const rest = entryModel(createEntry());
    expect(rest.doors.map((d) => d.state)).toEqual(['rest', 'rest', 'rest', 'rest']);

    const hovered = entryModel(createEntry(), null, { hover: 'door:1' });
    expect(hovered.doors[1]?.state).toBe('hover');
    // A press outranks a hover on the same plate — a finger that is down is not
    // hovering.
    const pressed = entryModel(createEntry(), null, { hover: 'door:1', press: 'door:1' });
    expect(pressed.doors[1]?.state).toBe('press');

    // Mid-connect every control is dead, so no plate lights up under a finger it
    // will not answer.
    const connecting = chooseDoor(createEntry(), 'solo', rng()).state;
    const busy = entryModel(connecting, null, { hover: 'door:1', press: 'door:1' });
    expect(busy.doors[1]?.state).toBe('rest');
    expect(busy.hover).toBeNull();
    expect(busy.press).toBeNull();
  });

  it('carries the title screen’s letterhead, and names the screen you are on', () => {
    // No new voice is invented for a screen the handoff never drew: the authority
    // line is the title screen's, verbatim, and the keypad's status names that
    // panel in the word a player already has — `ROOM` (a0-108), and a code is
    // still a CODE.
    expect(entryModel(createEntry()).eyebrow).toBe('DEEP FIELD MINING AUTHORITY');
    expect(entryModel(createEntry()).status).toBe('CONTRACT OPEN · SECTOR 04');
    // JOIN now lands on BROWSE (u17-01, plan D2), so the keypad's line is reached
    // through the mode switch — and each mode names the thing it actually is.
    const join = chooseDoor(createEntry(), 'join', rng()).state;
    expect(entryModel(join).status).toBe('OPEN ROOMS');
    expect(entryModel(chooseJoinMode(join, 'code')).status).toBe('ROOM CODE');
  });

  it('never lets the keypad hold two vocabularies at once (l2-02 merge gap)', () => {
    // u7-04 added the header beam's status line AFTER the sweep had read this file,
    // so the screen shipped saying ROOM CODE directly above ENTER THE CLAIM CODE.
    // Encoded as a condition rather than pinned prose: whatever these two say, they
    // may not disagree about what the thing is called.
    //
    // It used to be pinned prose — `toContain('CLAIM')` on both halves — which is
    // why a0-108 had to come here and retype the answer. Now it names no noun at
    // all: the status line's nouns must reappear in the prompt drawn under it, so
    // renaming the thing in one place and not the other is what goes red, whatever
    // it is renamed to.
    const nouns = (line: string) =>
      (line.match(/\b[A-Z]{2,}\b/g) ?? []).map((w) => w.replace(/S$/, ''));

    const join = chooseDoor(createEntry(), 'join', rng()).state;
    for (const mode of ['browse', 'code'] as const) {
      const model = entryModel(chooseJoinMode(join, mode));
      const shared = nouns(model.status).filter((n) => nouns(model.prompt).includes(n));
      expect(shared, `${mode}: "${model.status}" and "${model.prompt}" name nothing in common`)
        .not.toEqual([]);
    }

    // …and the two halves agree with EACH OTHER, so switching mode does not switch
    // vocabulary either. This is the half l2-02's gap actually fell through.
    const browse = entryModel(chooseJoinMode(join, 'browse'));
    const code = entryModel(chooseJoinMode(join, 'code'));
    expect(nouns(browse.status).filter((n) => nouns(code.status).includes(n))).not.toEqual([]);
  });

  it('keeps the footer plates inside the footer BEAM, and BACK where it was', () => {
    for (const { name, vp, touch } of PROFILES) {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const { footer } = layout;
      for (const [label, rect] of [
        ['back', layout.back],
        ['erase', layout.erase],
        ['submit', layout.submit],
      ] as const) {
        expect(rect.y, `${label} below the footer beam top on ${name}`).toBeGreaterThanOrEqual(footer.y - 0.5);
        expect(rect.y + rect.height, `${label} inside the footer beam on ${name}`).toBeLessThanOrEqual(
          footer.y + footer.height + 0.5,
        );
      }
      // BACK is the exit every screen carries, and it is the SAME rect on both —
      // it must not move as the screen changes under it (u2 menu-back). That is
      // also why losing the doors' SETTINGS plate (a0-100c) did not re-centre it:
      // a beam whose one plate slid to the middle on the doors would jump back to
      // the leading end the moment JOIN drew ERASE beside it.
      expect(layout.back.x, `back is leading on ${name}`).toBeLessThan(layout.submit.x);
      // ERASE sits inboard of JOIN, never across it.
      expect(layout.erase.x + layout.erase.width, `erase clears submit on ${name}`).toBeLessThanOrEqual(
        layout.submit.x + 0.5,
      );
    }
  });
});

describe('the keypad is a thumb target, not a lottery (GDD §2.4)', () => {
  it('mirrors the model’s pad shape — one key per alphabet character', () => {
    expect(KEYPAD_KEY_COUNT).toBe(KEYPAD_KEYS.length);
    expect(GEOMETRY_KEYPAD_COLUMNS).toBe(KEYPAD_COLUMNS);
    expect(entryLayout({ width: 1280, height: 800 }).keys).toHaveLength(KEYPAD_KEYS.length);
  });

  for (const { name, vp, touch } of PROFILES.filter((p) => p.touch)) {
    it(`keeps the keys at or above the fingertip floor — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const key = layout.keys[0];
      expect(key, 'a pad with no keys').toBeDefined();
      expect(key?.height ?? 0, `key height on ${name}`).toBeGreaterThanOrEqual(KEY_MIN - 0.5);
      expect(key?.width ?? 0, `key width on ${name}`).toBeGreaterThan(0);
    });

    it(`keeps the code you are typing VISIBLE beside the pad — ${name}`, () => {
      // The regression this catches: reserving the pad's *maximum* key height
      // leaves a landscape phone's band with nothing, and the four cells
      // collapse to zero — a code you cannot watch yourself type.
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (const cell of layout.cells) {
        expect(cell.height, `cell height on ${name}`).toBeGreaterThan(0);
        expect(cell.width, `cell width on ${name}`).toBeGreaterThan(0);
      }
    });
  }

  it('lays the pad out in reading order — across a row, then down', () => {
    const { keys } = entryLayout({ width: 1280, height: 800 });
    for (let i = 1; i < keys.length; i++) {
      const previous = keys[i - 1] as Rect;
      const key = keys[i] as Rect;
      if (i % KEYPAD_COLUMNS === 0) {
        expect(key.y, `row break at ${i}`).toBeGreaterThan(previous.y);
      } else {
        expect(key.y).toBeCloseTo(previous.y, 5);
        expect(key.x, `key ${i} left of key ${i - 1}`).toBeGreaterThan(previous.x);
      }
    }
  });
});

describe('a tap hits what it looks like it hits', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`maps a tap back to the rect it was drawn in — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });

      layout.doors.forEach((rect, i) => {
        const point = center(rect);
        expect(entryHitTest(layout, point.x, point.y, 'home'), `door[${i}] on ${name}`).toEqual({
          kind: 'door',
          index: i,
        });
      });

      layout.keys.forEach((rect, i) => {
        const point = center(rect);
        expect(entryHitTest(layout, point.x, point.y, 'join'), `key[${i}] on ${name}`).toEqual({
          kind: 'key',
          index: i,
        });
      });

      for (const [rect, expected] of [
        [layout.back, { kind: 'back' }],
        [layout.erase, { kind: 'erase' }],
        [layout.submit, { kind: 'submit' }],
      ] as const) {
        const point = center(rect);
        expect(entryHitTest(layout, point.x, point.y, 'join'), `${expected.kind} on ${name}`).toEqual(
          expected,
        );
      }

      // …and the doors' footer beam carries BACK and NOTHING ELSE (a0-100c). The
      // trailing end — where the keypad draws JOIN, and where the doors drew
      // SETTINGS until the developer ruled settings opens from the main menu and
      // the pause menu only — answers nothing on the home screen.
      const trailing = center(layout.submit);
      expect(entryHitTest(layout, trailing.x, trailing.y, 'home'), `dead trailing end on ${name}`).toBeNull();
    });
  }

  it('gives the doors a footer beam with ONE live control on it: BACK (a0-100c)', () => {
    // The developer's ruling: settings opens from the main menu and the pause
    // menu, and nowhere else. The doors screen carried a third route, and it is
    // gone — so the only thing on this beam that answers a press is the way out.
    for (const { name, vp, touch } of PROFILES) {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const live = ([
        ['back', layout.back],
        ['erase', layout.erase],
        ['submit', layout.submit],
      ] as const).filter(([, rect]) => {
        const point = center(rect);
        return entryHitTest(layout, point.x, point.y, 'home') !== null;
      });
      expect(live.map(([label]) => label), `the doors' live footer plates on ${name}`).toEqual(['back']);
    }
  });

  it('gives the home screen a BACK exit, in the keypad’s own BACK rect (u2)', () => {
    for (const { name, vp, touch } of PROFILES) {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      const back = center(layout.back);
      // BACK is live on the home screen — the online front door's exit to the
      // main menu (the field-report bug: there was no way back).
      expect(entryHitTest(layout, back.x, back.y, 'home'), `home BACK on ${name}`).toEqual({
        kind: 'back',
      });
      // It is the SAME rect the keypad's BACK uses, so the button holds its place
      // as the screen changes under it.
      expect(entryHitTest(layout, back.x, back.y, 'join'), `join BACK on ${name}`).toEqual({
        kind: 'back',
      });
      // BACK is alone on the doors' beam now (a0-100c), so the collision it must
      // still be clear of is the KEYPAD's pair — the same rect serves both screens.
      expect(overlaps(layout.back, layout.erase), `back/erase overlap on ${name}`).toBe(false);
      expect(overlaps(layout.back, layout.submit), `back/submit overlap on ${name}`).toBe(false);
    }
  });

  it('never lets a tap land on a control the screen is not showing', () => {
    const layout = entryLayout({ width: 1280, height: 800 });
    // The doors' band is where the keypad is drawn, so a tap there on the join
    // screen must resolve to a key — never to the door underneath it.
    const door = center(layout.doors[0] as Rect);
    const onJoin = entryHitTest(layout, door.x, door.y, 'join');
    expect(onJoin === null || onJoin.kind !== 'door').toBe(true);

    const key = center(layout.keys[0] as Rect);
    const onHome = entryHitTest(layout, key.x, key.y, 'home');
    expect(onHome === null || onHome.kind !== 'key').toBe(true);
  });

  it('returns null for a tap on nothing, and never hits a zero-extent rect', () => {
    const layout = entryLayout({ width: 1280, height: 800 });
    expect(entryHitTest(layout, -50, -50, 'home')).toBeNull();
    expect(entryHitTest(layout, 5000, 5000, 'join')).toBeNull();

    const empty = entryLayout({ width: 0, height: 0 });
    expect(entryHitTest(empty, 0, 0, 'home')).toBeNull();
    expect(entryHitTest(empty, 0, 0, 'join')).toBeNull();
  });

  it('maps a keypad index straight through to the character it draws', () => {
    const layout = entryLayout({ width: 1280, height: 800 });
    const target = entryHitTest(layout, center(layout.keys[9] as Rect).x, center(layout.keys[9] as Rect).y, 'join');
    expect(target?.kind).toBe('key');
    const index = target && target.kind === 'key' ? target.index : -1;
    // The index the geometry returns indexes the model's own key list — this is
    // the seam where a drifted order would silently type the wrong letter.
    expect(typeEntryCode(typed(''), KEYPAD_KEYS[index] as string).code).toBe(KEYPAD_KEYS[9]);
  });
});

describe('the allocator refuses (M3/online)', () => {
  it('turns each allocator failure into a distinct sentence the screen can show', () => {
    const messages = (['no-capacity', 'not-found', 'network', 'bad-response'] as const).map((r) =>
      entryErrorFor(r),
    );
    // Three (here four) failures, three different messages — never one line.
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) expect(m.length).toBeGreaterThan(0);
  });

  it('feeds straight into entryFailed and keeps the typed code for a retry', () => {
    // A join that came back 503 (fleet full) leaves the code intact — retrying is
    // one tap, not four keys re-typed.
    const state = submitJoin(typed(KEYPAD_KEYS.slice(0, ROOM_CODE_LENGTH).join(''))).state;
    const failed = entryFailed(state, entryErrorFor('no-capacity'));
    expect(failed.status).toBe('error');
    expect(failed.error).toBe(entryErrorFor('no-capacity'));
    expect(failed.error).toMatch(/full/i);
    expect(failed.code).toBe(state.code); // the code survives the refusal
  });
});

// ---------------------------------------------------------------------------
// 6. JOIN's two modes, and the list under the BROWSE one (u17-01)
// ---------------------------------------------------------------------------

describe('the mode switch under JOIN', () => {
  const joined = (): EntryState => chooseDoor(createEntry(), 'join', rng()).state;

  it('opens on BROWSE and reaches the keypad in one tap (plan D2)', () => {
    // The player this feature is for is the one with NO code; a keypad is the one
    // thing they cannot use. The friend WITH a code pays one tap, once.
    const join = joined();
    expect(join.mode).toBe('browse');
    expect(chooseJoinMode(join, 'code').mode).toBe('code');
  });

  it('remembers the mode across a trip back to the doors', () => {
    // The caller persists it; the model must at least not throw it away on the way
    // past, or "remembered" would be a promise the screen breaks every BACK.
    const code = chooseJoinMode(joined(), 'code');
    const home = backToDoors(code).state;
    expect(home.screen).toBe('home');
    expect(home.mode).toBe('code');
    expect(chooseDoor(home, 'join', rng()).state.mode).toBe('code');
  });

  it('keeps what was typed when the player looks at the list and comes back', () => {
    const code = typed('K7Q');
    const there = chooseJoinMode(code, 'browse');
    expect(chooseJoinMode(there, 'code').code).toBe('K7Q');
  });

  it('is DEAD while an attempt is in flight', () => {
    // The same gate that stops a double-tap on HOST opening two rooms: a segment
    // tap mid-connect must not start a second story.
    const connecting = submitJoin(typed('K7QM')).state;
    expect(entryLive(connecting)).toBe(false);
    expect(chooseJoinMode(connecting, 'browse')).toBe(connecting);
  });

  it('changes nothing on the doors screen', () => {
    const home = createEntry();
    expect(chooseJoinMode(home, 'code')).toBe(home);
  });

  it('draws two segments, in JOIN_MODES order, with exactly one active', () => {
    const model = entryModel(joined());
    expect(model.segments.map((s) => s.mode)).toEqual([...JOIN_MODES]);
    expect(model.segments.map((s) => s.label)).toEqual(['BROWSE', 'ENTER ROOM CODE']);
    expect(model.segments.filter((s) => s.active)).toHaveLength(1);
    expect(model.segments.find((s) => s.active)?.mode).toBe('browse');
  });

  it('leaves the four doors exactly four (Trap 8 — no fifth door)', () => {
    // a0-15 was a rollback of an over-complicated entry flow. JOIN grows modes;
    // the home screen grows nothing.
    expect(DOOR_OPTIONS.map((d) => d.label)).toEqual(['CAMPAIGN', 'SOLO', 'HOST', 'JOIN']);
    expect(entryModel(createEntry()).doors).toHaveLength(4);
    expect(entryModel(createEntry()).screen).toBe('home');
  });
});

describe('the browse list’s geometry (u17-01)', () => {
  for (const { name, vp, touch } of PROFILES) {
    it(`gives the switch a thumb target, in the same place in both modes — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      expect(layout.segments).toHaveLength(2);
      for (const [i, segment] of layout.segments.entries()) {
        expect(segment.height, `segment[${i}] height on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
        expect(segment.width, `segment[${i}] width on ${name}`).toBeGreaterThan(TOUCH_MIN);
      }
      // One layout serves both modes, so "the same place in both" is a property of
      // the construction rather than of a comparison — what is asserted here is
      // that the switch never lands on top of what either mode draws beside it.
      for (const cell of layout.cells) {
        for (const segment of layout.segments) {
          expect(overlaps(segment, cell), `switch over a code cell on ${name}`).toBe(false);
        }
      }
      for (const row of layout.browseRows) {
        for (const segment of layout.segments) {
          expect(overlaps(segment, row), `switch over a row on ${name}`).toBe(false);
        }
      }
    });

    it(`keeps every row and every JOIN button a thumb target — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (const [i, row] of layout.browseRows.entries()) {
        expect(row.height, `row[${i}] height on ${name}`).toBeGreaterThanOrEqual(TOUCH_MIN);
        const join = layout.browseJoins[i] as Rect;
        // The button lives INSIDE its row — the a0-24 failure was two elements
        // hanging off the phone's edge, and a JOIN drawn past its own row is the
        // same bug one nesting level down.
        expect(rectContains(row, join), `join[${i}] escaped its row on ${name}`).toBe(true);
      }
    });

    it(`never overlaps two rows, or a row and the list’s own box — ${name}`, () => {
      const layout = entryLayout(vp, { isTouch: touch, insets: insetsFor(vp) });
      for (let i = 0; i < layout.browseRows.length; i++) {
        expect(
          rectContains(layout.browseList, layout.browseRows[i] as Rect),
          `row[${i}] escaped the list box on ${name}`,
        ).toBe(true);
        for (let j = i + 1; j < layout.browseRows.length; j++) {
          expect(
            overlaps(layout.browseRows[i] as Rect, layout.browseRows[j] as Rect),
            `row[${i}] overlaps row[${j}] on ${name}`,
          ).toBe(false);
        }
      }
    });
  }

  it('costs the keypad nothing at 390px — the keys got BIGGER, not smaller', () => {
    // The measurement this shape was chosen from (see `JOIN_SEGMENT_WIDTH`): at
    // the developer's own 844×390 the band is 221px and the pad's floor is 148 of
    // it. A switch on a row of its own would have left the code cells 2px. Sharing
    // the cells' row instead spends the difference on the cells — which had 61px
    // and had them to spare — and the keypad comes out ahead.
    const phone = entryLayout({ width: 844, height: 390 }, { isTouch: true, insets: LANDSCAPE_INSETS });
    expect(phone.segmentShape).toBe('inline');
    for (const key of phone.keys) expect(key.height).toBeGreaterThanOrEqual(KEY_MIN);
    for (const cell of phone.cells) expect(cell.width).toBeGreaterThan(40);
    // …and the pad still ends above the footer beam it must never run under.
    const lastKey = phone.keys[phone.keys.length - 1] as Rect;
    expect(lastKey.y + lastKey.height).toBeLessThanOrEqual(phone.footer.y);
  });

  it('stacks the switch only where the band is too narrow to seat it beside them', () => {
    // The stacked shape is the tall-and-narrow one, which has the height to spend
    // precisely because it is tall — and there it keeps the cells at full size.
    const narrow = entryLayout({ width: 390, height: 844 }, { isTouch: true, insets: PORTRAIT_INSETS });
    expect(narrow.segmentShape).toBe('stacked');
    for (const cell of narrow.cells) expect(cell.width).toBeGreaterThan(40);
    for (const key of narrow.keys) expect(key.height).toBeGreaterThanOrEqual(KEY_MIN);
  });

  it('shows MORE rooms on a wide, short band by halving it', () => {
    // The same trade the doors and the roster make. At 390px a single column shows
    // two rooms of the fleet's twelve with 400px of band doing nothing.
    const phone = entryLayout({ width: 844, height: 390 }, { isTouch: true, insets: LANDSCAPE_INSETS });
    expect(phone.browseRows.length).toBeGreaterThanOrEqual(4);
    // Column-major, like every other list in this file: the sorted order still
    // reads top-to-bottom, so the nearest room is the top-left row.
    const first = phone.browseRows[0] as Rect;
    const second = phone.browseRows[1] as Rect;
    expect(second.x).toBeCloseTo(first.x, 5);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('degrades to zero-extent rather than to a backwards row', () => {
    const layout = entryLayout({ width: 40, height: 30 });
    for (const rect of [...layout.segments, ...layout.browseRows, ...layout.browseJoins]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hit testing the join screen’s two modes (u17-01)', () => {
  const layout = entryLayout({ width: 844, height: 390 }, { isTouch: true, insets: LANDSCAPE_INSETS });

  it('answers the switch on BOTH modes — it is how you get back', () => {
    for (const mode of ['browse', 'code'] as const) {
      for (const [i, segment] of layout.segments.entries()) {
        const at = center(segment);
        expect(entryHitTest(layout, at.x, at.y, 'join', mode)).toEqual({ kind: 'segment', index: i });
      }
    }
  });

  it('answers a row — and its JOIN button — with the SAME target', () => {
    // One action, two rects: the button is what the developer asked for and the
    // row is what a thumb actually lands on.
    const row = layout.browseRows[1] as Rect;
    const join = layout.browseJoins[1] as Rect;
    expect(entryHitTest(layout, center(row).x, center(row).y, 'join', 'browse')).toEqual({
      kind: 'row',
      index: 1,
    });
    expect(entryHitTest(layout, center(join).x, center(join).y, 'join', 'browse')).toEqual({
      kind: 'row',
      index: 1,
    });
  });

  it('never lands a browse tap on a key, or a code tap on a row', () => {
    // Geometry that is always laid out is not geometry that is always live: both
    // modes have rects, and only the drawn one answers.
    const key = center(layout.keys[9] as Rect);
    expect(entryHitTest(layout, key.x, key.y, 'join', 'browse')?.kind).not.toBe('key');
    const row = center(layout.browseRows[0] as Rect);
    expect(entryHitTest(layout, row.x, row.y, 'join', 'code')?.kind).not.toBe('row');
  });

  it('keeps BACK live on the browse list', () => {
    // The exit every screen carries (u2 menu-back), in the one state that did not
    // exist before this brief.
    const back = center(layout.back);
    expect(entryHitTest(layout, back.x, back.y, 'join', 'browse')).toEqual({ kind: 'back' });
  });

  it('names each control once, and stably', () => {
    expect(entryTargetKey({ kind: 'segment', index: 1 })).toBe('segment:1');
    expect(entryTargetKey({ kind: 'row', index: 3 })).toBe('row:3');
  });
});
