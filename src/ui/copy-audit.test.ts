/**
 * src/ui/copy-audit.test.ts — the words a player is never shown again.
 *
 * The developer has now ruled the same word off the screen twice:
 *
 * > *"we still have words like 'claim' no player is going to know what that
 * > means just put it in everyday game terms like Visibility - Public … and Join
 * > Code instead of claim"* (2026-08-16, on the lobby chip)
 *
 * > *"remove alll this claim wording, its just Victory, Defeat, Draw,
 * > Eliminated…"* (2026-08-19, on the end screen)
 *
 * The first ruling was applied to the chip it was pointed at and **nowhere
 * else**, so three days later the word was still on nine other screens. That is
 * the failure this file exists to stop, and it is the third time in this class:
 * the CONTROLS row naming every device's hardware (a0-87), the SFX tooltip
 * teaching the alarm's routing (a0-87), and now this. All three came back
 * because a ruling was carried out by hand and nothing held it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WALKS THE LIVE EXPORTS INSTEAD OF LISTING FILES
 * ---------------------------------------------------------------------------
 * A hand-written list of files to grep is a second place to remember, and the
 * screen added next month is not on it — the same LESSONS §20 trap
 * `voice-door-labels.test.ts` documents. So this names no screen. It imports the
 * `src/ui` barrel, walks **every string reachable through every export**, and
 * reads the result as one question: is this word anywhere a player can see it?
 *
 * The walk alone is not enough, because the two worst offenders were never
 * constants. `You took the claim.` was assembled inside `subheadFor()` and
 * `ENTER THE CLAIM CODE` was a literal returned from `entryPrompt()` — neither
 * is an exported value, and a walk of exports would have declared the end screen
 * clean while it said the word in 48px type. {@link assembledCopy} therefore
 * *runs* the pure model builders and audits what they return, which is the only
 * way to see a string that does not exist until a match ends.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT AUDITED
 * ---------------------------------------------------------------------------
 * **Identifier names.** `CLAIM_LABELS`, `claimChipLabel`, `toggleClaim`, the
 * bots' `claim` callout kind, `LobbyLayoutOptions.claim` — code, not words. The
 * walk reads *values*, never keys, so the model may go on calling it whatever it
 * likes. That is the developer's own line: the chip's noun became `VISIBILITY`
 * while `CLAIM_CHIP_NOUN` kept its name.
 *
 * **`reclaim`.** `src/net` says *"reclaiming your seat"* of a player rejoining
 * after a drop, and that is ordinary English doing an ordinary job. {@link
 * BANNED} is matched on word boundaries, so `reclaim`, `unclaimed` and
 * `claimable` do not trip it — only the noun the rulings were about.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as UI from './index';
import { BROWSE_COPY, browseModel, createBrowse } from './lobby-browser';
import { ENTRY_ERRORS, createEntry, entryModel, entryStatusLine } from './lobby-entry';
import type { MatchOutcome } from './end-of-match';
import { endOfMatchModel } from './end-of-match';
import { mapSelectModel } from './map-select';
import { claimChipLabel } from './lobby';
import { WAVE_NAMES } from './wave-clock';

/**
 * The words a player is not shown, and the ruling that took each one out. Word
 * boundaries on purpose — see the note on `reclaim` in the header.
 */
const BANNED: readonly { readonly word: RegExp; readonly ruling: string }[] = [
  { word: /\bclaims?\b/i, ruling: 'a0-108 / a0-61 — nobody knows what a claim is' },
];

/** Every string reachable from a value, with a readable path to where it sat. */
function stringsIn(value: unknown, path: string, seen = new Set<unknown>()): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out: [string, string][] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    // Values only. A key may say `claim` all it likes — it is code (see header).
    out.push(...stringsIn(child, `${path}.${key}`, seen));
  }
  return out;
}

/**
 * The strings that do not exist until something happens — a match ends, a keypad
 * is opened, a browse comes back empty. Each entry is one pure model builder run
 * at the state that produces its copy.
 *
 * Every outcome shape the end screen can reach is here, including the ally win,
 * because that branch has its own sentence (a0-09) and its own history of being
 * the one nobody checked.
 */
function assembledCopy(): [string, string][] {
  const you = 0;
  const ended = (winner: number | null, allies?: readonly number[]): MatchOutcome =>
    allies
      ? { you, winner, matchOver: true, allies: new Set(allies) }
      : { you, winner, matchOver: true };
  const browsing = (everReceived: boolean) => browseModel(
    { ...createBrowse(), everReceived },
    { now: 0, capacity: 6 },
  );

  const models: [string, unknown][] = [
    ['endOfMatchModel(you won)', endOfMatchModel(ended(you))],
    ['endOfMatchModel(ally won)', endOfMatchModel(ended(7, [you, 7]))],
    ['endOfMatchModel(opponent won)', endOfMatchModel(ended(4))],
    ['endOfMatchModel(draw)', endOfMatchModel(ended(null))],
    ['endOfMatchModel(eliminated)', endOfMatchModel({
      you,
      winner: null,
      matchOver: false,
      placement: 6,
      totalPlayers: 8,
    })],
    ['BROWSE_COPY', BROWSE_COPY],
    ['browseModel(nothing read yet)', browsing(false)],
    ['browseModel(read, and empty)', browsing(true)],
    ['ENTRY_ERRORS', ENTRY_ERRORS],
    ['WAVE_NAMES', WAVE_NAMES],
    ['claimChipLabel(public)', claimChipLabel(true)],
    ['claimChipLabel(private)', claimChipLabel(false)],
  ];

  // The entry screen's own state machine: the doors, the keypad, and the browse
  // half, which is where `PICK A CLAIM` and `ENTER THE CLAIM CODE` lived.
  const home = createEntry();
  for (const [label, state] of [
    ['home', home],
    ['join/code', { ...home, screen: 'join' as const, mode: 'code' as const }],
    ['join/browse', { ...home, screen: 'join' as const, mode: 'browse' as const }],
  ] as const) {
    models.push([`entryModel(${label})`, entryModel(state)]);
    models.push([`entryStatusLine(${label})`, entryStatusLine(state)]);
  }

  // Both halves of the host rule: the pick, and the line a guest reads instead.
  for (const canPick of [true, false]) {
    models.push([
      `mapSelectModel(canPick=${canPick})`,
      mapSelectModel({ mapId: 'octagon', canPick }),
    ]);
  }

  return models.flatMap(([label, model]) => stringsIn(model, label));
}

/**
 * Every string literal in a `src/ui` source file, with comments removed first so
 * that a doc-comment quoting a retired string — this file's own header does it —
 * is not read as copy.
 *
 * A character scanner rather than a regex: `//` inside a string and an apostrophe
 * inside a comment both break the regex version, and both occur here.
 */
function literalsInSource(): [string, string][] {
  const dir = join(__dirname);
  const out: [string, string][] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    let quote = '';
    let buffer = '';
    let line = 1;
    let startedAt = 1;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\n') line++;
      if (quote) {
        if (c === '\\') { buffer += src[i + 1] ?? ''; i++; continue; }
        if (c === quote) { out.push([`${file}:${startedAt}`, buffer]); quote = ''; continue; }
        buffer += c;
        continue;
      }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; line++; continue; }
      if (c === '/' && src[i + 1] === '*') { 
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        i++;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; buffer = ''; startedAt = line; }
    }
  }
  return out.filter(([, text]) => !isIdentifier(text));
}

/**
 * A bare lowerCamel token — `'claim'` as a union tag, an event name, a CSS
 * keyword. Code, and the brief's explicit carve-out: the model may go on calling
 * a thing whatever it likes as long as the player never sees the word.
 *
 * This exemption applies to the **source scan only**, and that is the point of
 * having three nets. A single lowercase word that genuinely reaches a screen
 * arrives at the player through an export or a model builder, and those two
 * walks read it with no exemption at all.
 */
function isIdentifier(text: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(text);
}

describe('player-facing copy', () => {
  /**
   * The check the two hand-applied rulings did not have. It names no screen and
   * no file: add one tomorrow with the word on it and this still goes red.
   */
  it('no player-facing string says claim', () => {
    const audited = [...stringsIn(UI, 'src/ui'), ...assembledCopy(), ...literalsInSource()];

    // If this ever reads zero the walk has broken and the test is passing on an
    // empty set, which is the failure mode a scanner dies of quietly.
    expect(audited.length).toBeGreaterThan(1000);

    for (const { word, ruling } of BANNED) {
      const offenders = audited
        .filter(([, text]) => word.test(text))
        .map(([where, text]) => `${where} → ${JSON.stringify(text)}`);
      expect(offenders, `${word} is still on screen — ${ruling}`).toEqual([]);
    }
  });
});
