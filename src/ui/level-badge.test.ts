/**
 * src/ui/level-badge.test.ts — the level badge, and THE ABSENCE around it.
 *
 * Brief `docs/briefs/pr-06-lobby-level-badge.md`; plan
 * `docs/progression-plan.md` §Q2, §2.1. The developer's ruling, verbatim,
 * 2026-08-07:
 *
 *   > *"we can show the LEVEL but not XP (and show it only in the lobby)."*
 *
 * Three words, three rules, and the third is the one that needs a test.
 * **Level yes** — a badge on the lobby's seat row, read off the local profile.
 * **XP never** — not on the badge, not as a tooltip, not anywhere this screen
 * can reach. **Lobby only** — and that half is an *absence*, which is the kind
 * of property that quietly stops being true the first time somebody helpfully
 * adds a badge to a nameplate.
 *
 * So the absence is asserted here, with the ruling quoted in the test names, on
 * purpose: a future lane that wants a level over an enemy hull has to delete a
 * sentence the developer wrote in order to get a green suite. That is the whole
 * reason this file exists rather than the badge tests living in `lobby.test.ts`.
 *
 * **Why the absence is load-bearing, and not merely tidy.** The game fogs what a
 * player may read about a live opponent (GDD §2.2) — there are no accounts (plan
 * §2.2), so a level arriving from another client is a number that client
 * authored, and standing information about an opponent is exactly what §2.2
 * exists to withhold. The ruling resolves it cleanly by putting the badge on a
 * screen that is *gone before RUSH! is pressed*.
 *
 * **What this file does NOT claim.** Your own career, on your own screens, is a
 * different question and the developer answered it separately: the end-of-match
 * summary counts up **your** XP and fills **your** level bar (plan §6, ratified
 * in the same pass), and the hangar shows the same two numbers on the front door
 * (a0-14). Both are the owner reading their own record. What is asserted below
 * is the ruling's actual subject — **nobody else's level, ever, and no XP on any
 * in-match surface** — over the four surfaces the brief names.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ShipClass } from '@shared/types';
import {
  LEVEL_BADGE_PREFIX,
  applyLobbySlots,
  createLobby,
  cycleSeatState,
  levelBadgeLabel,
  lobbyModel,
  seatLocalPlayer,
} from './lobby';
import type { LobbyState } from './lobby';
import type { LobbySlot } from '../net/transport';
import { freshProfile, loadProfile, saveProfile } from '../progression/profile';
import type { ProfileStorage } from '../progression/profile';
import { levelForXp, xpToReach } from '../progression/curve';
import { nameplateModel } from './nameplates';
import { endOfMatchModel } from './end-of-match';
import type { MatchOutcome } from './end-of-match';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The seam the profile persists through, in a Map — the same injection
 *  `createBrowserHaptics(platform.storage)` uses, so nothing here needs a
 *  browser (plan §2.1). */
function memoryStorage(seed: Record<string, string> = {}): ProfileStorage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

/** An offline lobby — you in seat 0, bots in the rest — at a given career level.
 *  Offline because that is the flavour whose non-host seats seed as BOT, which
 *  is what gives us bot rows to assert the absence of a badge on. */
function lobbyAtLevel(level: number): LobbyState {
  return createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, online: false, level });
}

/** The badge on one row of a built model, or `null`. */
function badgeOf(state: LobbyState, player: number): string | null {
  const seat = lobbyModel(state).seats.find((s) => s.player === player);
  expect(seat, `seat ${player} is on the roster`).toBeDefined();
  return seat!.levelBadge;
}

// ---------------------------------------------------------------------------
// 1–2. The badge renders, and it renders for a fresh career too
// ---------------------------------------------------------------------------

describe('"we can show the LEVEL" — the badge on a lobby seat row', () => {
  it('draws the local player’s level: a profile at level 7 puts LVL 7 on their row', () => {
    // The level comes from the profile module, not from a number typed here —
    // the badge's whole job is to report what `loadProfile` actually holds.
    const storage = memoryStorage();
    const xp = xpAtLevel(7);
    expect(saveProfile(storage, { ...freshProfile(), xp, level: levelForXp(xp) })).toBe(true);
    const profile = loadProfile(storage);
    expect(profile.level).toBe(7);

    expect(badgeOf(lobbyAtLevel(profile.level), 0)).toBe('LVL 7');
  });

  it('a FRESH profile reads level 1 — the row is neither blank nor undefined', () => {
    // The failure this pins is the one a lane ships by accident: an absent
    // profile folding to `LVL undefined`, or to an empty chip that reads as a
    // rendering bug rather than as a new player.
    const fresh = loadProfile(memoryStorage());
    expect(fresh.level).toBe(1);

    const badge = badgeOf(lobbyAtLevel(fresh.level), 0);
    expect(badge).toBe('LVL 1');
    expect(badge).not.toBe('');
    expect(badge).not.toContain('undefined');
    expect(badge).not.toContain('NaN');
  });

  it('a lobby opened with no level at all still reads LVL 1, never a hole', () => {
    // `createLobby` is called by tests, by the offline boot and by the online
    // one; a missing level is a fresh career, which is level 1 (plan §2.1's
    // `freshProfile`), and never a blank chip.
    const state = createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, online: false });
    expect(badgeOf(state, 0)).toBe('LVL 1');
  });

  it('folds a junk level the way every other persisted value is folded', () => {
    // `readMapId`'s discipline (plan §2.1): a value that cannot be a level reads
    // as level 1 rather than reaching a chip. The profile reader already refuses
    // these, so this is the second line of defence and it is cheap.
    expect(levelBadgeLabel(1)).toBe('LVL 1');
    expect(levelBadgeLabel(7)).toBe('LVL 7');
    expect(levelBadgeLabel(0)).toBe('LVL 1');
    expect(levelBadgeLabel(-3)).toBe('LVL 1');
    expect(levelBadgeLabel(7.8)).toBe('LVL 7');
    expect(levelBadgeLabel(Number.NaN)).toBe('LVL 1');
    expect(levelBadgeLabel(Number.POSITIVE_INFINITY)).toBe('LVL 1');
  });

  it('the badge follows the local seat when the server seats you somewhere else', () => {
    // Online, the seat is the server's (`welcome`), and `seatLocalPlayer` moves
    // it. The badge is derived from "the seat the local player is in", not from
    // a slot index captured when the lobby was built, so it moves with them —
    // and, critically, does NOT stay behind on the seat somebody else now holds.
    const state = seatLocalPlayer(
      createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, level: 4 }),
      3,
      0,
    );
    expect(badgeOf(state, 3)).toBe('LVL 4');
    expect(badgeOf(state, 0)).toBeNull();
  });

  it('the badge is a LEVEL and never an XP total — no lobby row carries XP', () => {
    // The ruling's second word. There is no XP on this screen at all: not on the
    // badge, not beside it, not in any other string the roster produces.
    const model = lobbyModel(lobbyAtLevel(7));
    const strings = model.seats.flatMap((s) =>
      Object.values(s).filter((v): v is string => typeof v === 'string'),
    );
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(s).not.toMatch(/\bxp\b/i);
    expect(LEVEL_BADGE_PREFIX).not.toMatch(/\bxp\b/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Bots and remote seats show no badge
// ---------------------------------------------------------------------------

describe('…and nobody else’s — a bot has no career, and a stranger’s is a claim', () => {
  it('a BOT seat carries no badge: a bot has no profile to read one from', () => {
    const state = lobbyAtLevel(7);
    const bots = lobbyModel(state).seats.filter((s) => s.isBot);
    expect(bots.length).toBeGreaterThan(0);
    for (const seat of bots) expect(seat.levelBadge).toBeNull();
  });

  it('a REMOTE HUMAN’s seat carries no badge — it is not read, requested or drawn', () => {
    // Plan §2.2: m9 has no accounts, so a level arriving from another client is
    // a number that client authored. This folds in a real `lobbyState` broadcast
    // — a person seated in slot 3 by the server — and asserts two things at once:
    // their row draws no badge, and there was nothing on the wire to draw it from
    // (`../net/transport` `LobbySlot` carries no level, and none may be added).
    const slots: LobbySlot[] = [
      { player: 0, isBot: false, shipClass: ShipClass.Vanguard, ready: true },
      { player: 1, isBot: true, botDifficulty: 'hard', shipClass: ShipClass.Vanguard, ready: false },
      { player: 2, isBot: false, shipClass: ShipClass.Vanguard, ready: false, state: 'open' },
      { player: 3, isBot: false, shipClass: ShipClass.Interceptor, ready: true },
    ];
    for (const slot of slots) expect(Object.keys(slot)).not.toContain('level');

    const state = applyLobbySlots(
      seatLocalPlayer(createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, level: 9 }), 0, 0),
      slots,
    );
    const rows = lobbyModel(state).seats;
    const remote = rows.find((s) => s.player === 3);
    expect(remote?.state).toBe('human');
    expect(remote?.isYou).toBe(false);
    expect(remote?.levelBadge).toBeNull();
    // …and only your own row still carries one, in a room with two people in it.
    expect(rows.filter((s) => s.levelBadge !== null).map((s) => s.player)).toEqual([0]);
  });

  it('OPEN and CLOSED seats carry no badge — an empty chair has no career', () => {
    let state = createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, level: 7 });
    const open = lobbyModel(state).seats.find((s) => s.state === 'open');
    expect(open?.levelBadge).toBeNull();
    state = cycleSeatState(cycleSeatState(state, 1), 1); // open → bot → closed
    const closed = lobbyModel(state).seats.find((s) => s.player === 1);
    expect(closed?.state).toBe('closed');
    expect(closed?.levelBadge).toBeNull();
  });

  it('exactly ONE row on the roster carries a badge, at every match size', () => {
    // The invariant stated as a count rather than as seven separate nulls: one
    // player has a profile on this machine, so one row may report a level.
    for (const size of [2, 3, 5, 8]) {
      const state = createLobby({ room: 'ABCD', you: 0, host: 0, slots: 8, size, level: 7 });
      const badged = lobbyModel(state).seats.filter((s) => s.levelBadge !== null);
      expect(badged.map((s) => s.player), `size ${size}`).toEqual([0]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. THE ABSENCE
// ---------------------------------------------------------------------------

/** Strip line and block comments, so a scan reads what the file *draws* rather
 *  than what it *explains* — this very file, and the four it scans, discuss
 *  levels and XP at length in prose and must be allowed to. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every string literal in a module, comments removed — the candidate set for
 *  "what could this file put in front of a player". */
function drawnStrings(file: string): string[] {
  const source = stripComments(readFileSync(new URL(file, import.meta.url), 'utf8'));
  return source.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
}

/**
 * The surfaces the brief names, and the reason each one is on the list.
 *
 * They are the three places a level would be *most* tempting and *least*
 * allowed: over a live opponent's hull, on the match HUD, and on the standing
 * chrome that frames both.
 */
const IN_MATCH_SURFACES = [
  './nameplates.ts',
  './nameplates-view.ts',
  './hud.ts',
  './chrome.ts',
] as const;

describe('"…but not XP (and show it only in the lobby)" — THE ABSENCE, developer 2026-08-07', () => {
  it.each(IN_MATCH_SURFACES)('%s draws no level and no XP, in any string it can print', (file) => {
    const offenders = drawnStrings(file).filter((s) => /\b(lvl|level|xp)\b/i.test(s));
    expect(
      offenders,
      `${file} may not print a level or an XP total: the badge is a LOBBY row and nowhere else (plan §Q2, Trap 14)`,
    ).toEqual([]);
  });

  it('an in-match NAMEPLATE for the same seat carries no level — the badge is gone before RUSH!', () => {
    // The evidence pair, as an assertion: the seat that carries `LVL 7` on the
    // lobby row is drawn here the way a match draws it, over a hull, in TEAMS,
    // with a tier suffix — every channel a level could ride in on — and every
    // string it produces is checked.
    const plates = nameplateModel(
      [
        { owner: 0, kind: 'ship', alive: true, pos: { x: 100, y: 100 }, radius: 12 },
        { owner: 1, kind: 'ship', alive: true, pos: { x: 200, y: 100 }, radius: 12 },
        { owner: 1, kind: 'station', alive: true, pos: { x: 200, y: 300 }, radius: 40 },
      ],
      ['YOU', 'WARDEN'],
      { showTeamLabels: true, viewerTeam: 0, showOwnShipLabel: true },
      [undefined, 'HARD'],
      [0, 1],
    );
    expect(plates.length).toBe(3);
    for (const plate of plates) {
      const strings = Object.values(plate).filter((v): v is string => typeof v === 'string');
      expect(strings.length).toBeGreaterThan(0);
      for (const s of strings) expect(s).not.toMatch(/\b(lvl|level|xp)\b/i);
      for (const key of Object.keys(plate)) expect(key.toLowerCase()).not.toMatch(/lvl|level|xp/);
    }
  });

  it('the END SCREEN names no opponent’s level and no opponent’s XP', () => {
    // The opponent-facing half of `end-of-match.ts` — the headline, the subhead
    // and the buttons, which is everything that screen says about anybody who is
    // not you. (Your OWN count-up and level bar are `summary-sequence.ts`, and
    // are the ratified §6 screen; they are the owner reading their own record.)
    const outcomes: readonly MatchOutcome[] = [
      { you: 0, winner: 1, matchOver: true },
      { you: 0, winner: 0, matchOver: true },
      { you: 0, winner: null, matchOver: true },
      { you: 0, winner: null, matchOver: false, placement: 6, totalPlayers: 8, cause: 'destroyed' },
    ];
    for (const outcome of outcomes) {
      const model = endOfMatchModel(outcome);
      const strings = [
        model.eyebrow,
        model.headline,
        model.subhead,
        ...model.buttons.map((b) => b.label),
      ];
      for (const s of strings) expect(s).not.toMatch(/\b(lvl|level|xp)\b/i);
      for (const key of Object.keys(model)) expect(key.toLowerCase()).not.toMatch(/lvl|level|xp/);
    }
  });

  it('the LOBBY SEAT is the only UI model with a level field at all', () => {
    // Stated as a shape rather than as a string, because the string test above
    // cannot see a level that arrives as a number and is formatted by a view.
    // If a second model ever grows one, this is the line that says so — and the
    // lobby's own is on the SEAT, which is what lets it be per-row and therefore
    // absent on the seven rows that are not yours.
    expect(Object.keys(lobbyModel(lobbyAtLevel(7)).seats[0]!)).toContain('levelBadge');
    expect(Object.keys(lobbyModel(lobbyAtLevel(7)))).not.toContain('level');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The XP that reaches `level`, read off the shipped curve rather than typed —
 *  the curve is `TUNABLE` (plan §1.4) and a literal here would pin this file to
 *  today's `base`/`exp`. */
function xpAtLevel(level: number): number {
  return xpToReach(level);
}
