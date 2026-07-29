/**
 * src/ui/lobby-entry.test.ts — the door into a room, and the pad a code is
 * typed on. Model and geometry together, because they are one deliverable.
 *
 * What these assertions defend, in the order they would bite on a real phone:
 *
 *  1. **SOLO always works.** It is the one door that needs no server (GDD §4.8
 *     risks 2 and 6), so it is asserted to be first, offline, and reachable in
 *     one tap from a cold screen.
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
  ENTRY_ERRORS,
  ENTRY_TAGLINE,
  KEYPAD_COLUMNS,
  KEYPAD_KEYS,
  backToDoors,
  canSubmitJoin,
  chooseDoor,
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
import type { EntryState } from './lobby-entry';
import {
  KEYPAD_COLUMNS as GEOMETRY_KEYPAD_COLUMNS,
  KEYPAD_KEY_COUNT,
  KEY_MIN,
  entryHitTest,
  entryLayout,
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

describe('the three doors (GDD §2.1, §4.2 — how a match is entered)', () => {
  it('offers solo first, and offers it WITHOUT a server (GDD §4.8 risk 6)', () => {
    expect(DOOR_ORDER[0]).toBe('solo');
    const solo = DOOR_OPTIONS[0];
    expect(solo?.door).toBe('solo');
    expect(solo?.needsNetwork).toBe(false);
    // …and it is the only one that does not.
    expect(DOOR_OPTIONS.filter((d) => !d.needsNetwork)).toHaveLength(1);
  });

  it('names all three doors exactly once, in DOOR_ORDER', () => {
    expect(DOOR_OPTIONS.map((d) => d.door)).toEqual([...DOOR_ORDER]);
    expect(new Set(DOOR_ORDER).size).toBe(DOOR_ORDER.length);
    for (const option of DOOR_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
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

      // SETTINGS — the fourth main-menu option — is live on the home screen only.
      const settings = center(layout.settings);
      expect(entryHitTest(layout, settings.x, settings.y, 'home'), `settings on ${name}`).toEqual({
        kind: 'settings',
      });
    });
  }

  it('keeps SETTINGS off the join screen — it shares the band with the keypad’s row', () => {
    const layout = entryLayout({ width: 1280, height: 800 });
    const settings = center(layout.settings);
    const onJoin = entryHitTest(layout, settings.x, settings.y, 'join');
    expect(onJoin === null || onJoin.kind !== 'settings').toBe(true);
  });

  it('gives the home screen a BACK exit that never collides with SETTINGS (u2)', () => {
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
      // BACK and SETTINGS split the home action band; they must never overlap.
      expect(overlaps(layout.back, layout.settings), `back/settings overlap on ${name}`).toBe(false);
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
