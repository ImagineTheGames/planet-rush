/**
 * Nameplate model tests (field request v0.2.1, GDD §2.9, style-guide §2 / §3).
 * The load-bearing contracts, straight from the field request:
 *
 *  - **Who gets a label:** every live ship and every owned (live) station; a dead
 *    ship and a destroyed station (a wreck — no longer owned) get none; un-owned
 *    hostiles are never named.
 *  - **The local ship's own label is optional-off** and defaults off, while the
 *    local STATION is still labelled.
 *  - **What text:** the lobby/room name for a slot, falling back to a `P{n}` tag
 *    when a slot has no name — identity never vanishes.
 *  - **Which colour:** the owner's identity colour from the ratified roster, never
 *    signal yellow / threat red (RESERVED).
 *  - **Always lit (a0-04):** a label over a damaged entity, over a fighting entity
 *    and over a calm one all draw at the SAME full opacity — and the label still
 *    sorts above the health-bar cluster, which is what the retired fade was
 *    actually protecting.
 */
import { describe, it, expect } from 'vitest';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import {
  nameplateModel,
  nameplateGetsLabel,
  resolveName,
  resolveDifficultySuffix,
  resolveTeamLabel,
  resolveTeamRelation,
  fallbackName,
  NAMEPLATE_FULL_ALPHA,
  NAMEPLATE_MAX_CHARS,
} from './nameplates';
import type { DifficultyTable, Nameable, Nameplate, NameTable, TeamTable } from './nameplates';
// The stack the label sits on top of — rule 3's surviving half after a0-04. The
// clearance is read from the label layer and the bar's own geometry from the bar
// layer, so the assertion below compares the two REAL numbers, not a restatement.
import {
  NAMEPLATE_SHIP_GAP,
  NAMEPLATE_SUFFIX_GAP,
  NAMEPLATE_TEAM_GAP,
  NAMEPLATE_FONT_SIZE,
  nameplateClusterClearance,
  nameplateRowLayout,
} from './nameplates-view';
// a0-32's discipline for a width claim: measure the real faces headlessly rather
// than guess an em budget. The side tag leads the row now, so what a plate costs
// in pixels is a load-bearing number, not a note in a PR body.
import { textWidth } from './font-metrics';
import { HUD_TRACKING } from './instrument';
import { HEALTHBAR_GAP, HEALTHBAR_HEIGHT, combatantGetsBar } from './healthbar';
import type { Combatant } from './healthbar';
// The side vocabulary and its motif colours live with the lobby's `teamName`, so
// the roster and the battlefield cannot drift (u3).
import { SIDE_COLORS } from './lobby';
import { playerColor } from './station-hp';

/** A live enemy SHIP at owner 3 — the labelled baseline each test perturbs. */
function ship(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'ship', alive: true, pos: { x: 100, y: 100 }, radius: 12, ...over };
}
/** A live OWNED station at owner 3. */
function station(over: Partial<Nameable> = {}): Nameable {
  return { owner: 3, kind: 'station', alive: true, pos: { x: 400, y: 400 }, radius: 40, ...over };
}

/** Names indexed by slot — local player 0 named "YOU", a couple of bots named. */
const NAMES: NameTable = ['YOU', 'Rusty', 'Bolt', 'Warden'];

/** Difficulty table mirroring {@link NAMES}: slot 0 is the HUMAN (left empty, no
 *  suffix), the bot seats each carry their tier. */
const DIFFS: DifficultyTable = [undefined, 'easy', 'medium', 'hard'];

/** A 2v2 split by slot: 0 and 2 on side A, 1 and 3 on side B — the same table
 *  `main.ts` builds from the live world's `ship.team` (m10 teams). */
const TEAMS: TeamTable = [0, 1, 0, 1];

/** TEAMS mode, seen by a player on side A (slot 0's side) — the gate every side
 *  label is behind, plus the viewer the WORD is relative to (u3). */
const IN_TEAMS = { showTeamLabels: true, viewerTeam: 0 } as const;

/** The same match with nobody in it: a spectator / replay HUD. Documented to read
 *  the neutral `TEAM <letter>` — never to call every hull an enemy. */
const SPECTATING = { showTeamLabels: true } as const;

describe('who gets a label', () => {
  it('labels a live enemy ship', () => {
    expect(nameplateGetsLabel(ship())).toBe(true);
  });

  it('labels a live owned station', () => {
    expect(nameplateGetsLabel(station())).toBe(true);
  });

  it('never labels a dead ship', () => {
    expect(nameplateGetsLabel(ship({ alive: false }))).toBe(false);
  });

  it('never labels a destroyed station (a wreck is no longer owned)', () => {
    expect(nameplateGetsLabel(station({ alive: false }))).toBe(false);
  });

  it('never labels an un-owned hostile wave unit', () => {
    expect(nameplateGetsLabel(ship({ owner: -1 }))).toBe(false);
  });

  it('suppresses the local ship’s own label by default', () => {
    expect(nameplateGetsLabel(ship({ owner: 0, local: true }))).toBe(false);
  });

  it('shows the local ship’s own label when the setting opts in', () => {
    expect(nameplateGetsLabel(ship({ owner: 0, local: true }), { showOwnShipLabel: true })).toBe(true);
  });

  it('always labels the local player’s own STATION (no local flag on a station)', () => {
    expect(nameplateGetsLabel(station({ owner: 0 }))).toBe(true);
  });
});

describe('what text (the name table)', () => {
  it('shows a bot’s personality name from its slot', () => {
    expect(resolveName(NAMES, 1)).toBe('Rusty');
    expect(resolveName(NAMES, 3)).toBe('Warden');
  });

  it('shows the local player’s lobby name from slot 0', () => {
    expect(resolveName(NAMES, 0)).toBe('YOU');
  });

  it('falls back to a P{n} tag when a slot has no name', () => {
    expect(resolveName(NAMES, 5)).toBe('P6'); // 1-based, like the hull decal
    expect(fallbackName(4)).toBe('P5');
  });

  it('falls back for a blank / whitespace-only name too', () => {
    expect(resolveName(['   ', ''], 0)).toBe('P1');
    expect(resolveName(['   ', ''], 1)).toBe('P2');
  });

  it('truncates an over-long name with an ellipsis', () => {
    const long = 'A-Very-Long-Callsign-Indeed';
    const shown = resolveName([long], 0);
    expect(shown.length).toBe(NAMEPLATE_MAX_CHARS);
    expect(shown.endsWith('…')).toBe(true);
  });
});

describe('difficulty suffix (field request v0.2.2)', () => {
  it('shows a bot’s tier as a parenthesised, upper-cased metadata suffix', () => {
    expect(resolveDifficultySuffix(DIFFS, 1)).toBe('(EASY)');
    expect(resolveDifficultySuffix(DIFFS, 2)).toBe('(MEDIUM)');
    expect(resolveDifficultySuffix(DIFFS, 3)).toBe('(HARD)');
  });

  it('gives a HUMAN seat no suffix (slot left empty in the table)', () => {
    expect(resolveDifficultySuffix(DIFFS, 0)).toBe('');
  });

  it('gives a slot the table doesn’t name no suffix', () => {
    expect(resolveDifficultySuffix(DIFFS, 5)).toBe('');
    expect(resolveDifficultySuffix([], 1)).toBe('');
    expect(resolveDifficultySuffix(['  '], 0)).toBe('');
  });

  it('never suffixes an un-owned hostile', () => {
    expect(resolveDifficultySuffix(DIFFS, -1)).toBe('');
  });

  it('carries the suffix onto a bot’s SHIP and its STATION plate, per difficulty', () => {
    const [botShip] = nameplateModel([ship({ owner: 3 })], NAMES, {}, DIFFS);
    const [botStation] = nameplateModel([station({ owner: 1 })], NAMES, {}, DIFFS);
    expect(botShip!.suffix).toBe('(HARD)');
    expect(botStation!.suffix).toBe('(EASY)');
  });

  it('never suffixes a human’s own STATION label', () => {
    const [humanStation] = nameplateModel([station({ owner: 0 })], NAMES, {}, DIFFS);
    expect(humanStation!.suffix).toBe('');
  });

  it('emits an empty suffix when no difficulty table is fed (back-compat)', () => {
    const [plate] = nameplateModel([ship({ owner: 3 })], NAMES);
    expect(plate!.suffix).toBe('');
  });
});

describe('which colour (identity, never RESERVED)', () => {
  it('tints a label the owner’s identity colour', () => {
    const [plate] = nameplateModel([ship({ owner: 2 })], NAMES);
    expect(plate!.color).toBe(PLAYER_COLORS[2]);
  });

  it('never uses signal yellow or threat red', () => {
    for (let slot = 0; slot < PLAYER_COLORS.length; slot++) {
      const [plate] = nameplateModel([ship({ owner: slot })], NAMES);
      expect(plate!.color).not.toBe(PALETTE.signalYellow);
      expect(plate!.color).not.toBe(PALETTE.threatRed);
    }
  });
});

// ---------------------------------------------------------------------------
// Always lit (a0-04 — the developer: "sometimes other ships names are dim and
// sometimes they are lit, they should always be lit")
// ---------------------------------------------------------------------------
//
// These three tests were the fade's pins. They are re-pointed, not deleted: the
// same three entities — damaged, fighting, calm — now have to come out at ONE
// brightness. The old rule (a label steps back so the health bar owns the eye)
// was legible in a spec and illegible on screen, because its trigger was the
// other ship's combat state and the player is not tracking that.
//
// The entity states are built as the health-bar model's OWN `Combatant`s and
// asserted to be bar-worthy by `combatantGetsBar`, because after this change the
// nameplate model cannot represent "damaged" or "fighting" at all — it takes no
// such field. So "damaged" and "in combat" mean here exactly what they mean to
// the layer that draws the bar, and the pairing is the test: the bar layer sees a
// fight, the label layer does not dim for it.

/** The health-bar model's view of the same ship — the definition of "damaged"
 *  and "in combat" this suite borrows, rather than inventing a second one. */
function combatant(over: Partial<Combatant> = {}): Combatant {
  return {
    owner: 3,
    hp: 70,
    maxHp: 70,
    alive: true,
    inCombat: false,
    pos: { x: 100, y: 100 },
    radius: 12,
    turret: false,
    ...over,
  };
}
const LOCAL_SLOT = 0;

describe('always lit (a0-04)', () => {
  it('draws a calm label at full opacity', () => {
    const [plate] = nameplateModel([ship()], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('draws a label over a FIGHTING entity at that same full opacity', () => {
    // The bar layer agrees this one is in a fight…
    expect(combatantGetsBar(combatant({ inCombat: true }), LOCAL_SLOT)).toBe(true);
    // …and its name is lit exactly as brightly as a calm ship's.
    const [plate] = nameplateModel([ship()], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('draws a label over a DAMAGED entity at that same full opacity', () => {
    expect(combatantGetsBar(combatant({ hp: 35 }), LOCAL_SLOT)).toBe(true);
    const [plate] = nameplateModel([ship()], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('gives the same brightness to the calm, the damaged and the fighting ship', () => {
    // The developer's sentence, as one assertion: three ships in three states,
    // one number. The states are the health-bar model's, all three bar-worthy or
    // not — the label layer is told none of it.
    const states: Combatant[] = [
      combatant({ owner: 1 }), // calm, full hull → no bar
      combatant({ owner: 2, hp: 20 }), // shot up → bar
      combatant({ owner: 3, inCombat: true }), // firing → bar
    ];
    expect(states.map((c) => combatantGetsBar(c, LOCAL_SLOT))).toEqual([false, true, true]);

    const plates = nameplateModel(
      states.map((c) => ship({ owner: c.owner, pos: c.pos, radius: c.radius })),
      NAMES,
    );
    expect(plates).toHaveLength(3);
    expect(new Set(plates.map((p) => p.alpha)).size).toBe(1);
    for (const p of plates) expect(p.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('takes no combat or HP fact at all — there is nothing left to dim on', () => {
    // The mechanism is retired, not neutered (a0-04): no fade constant, no fade
    // knob, and no field on `Nameable` for a caller to feed one from. A stray
    // combat fact on the record cannot change a single drawn pixel.
    const withStrayCombatState = { ...ship(), inCombat: true, hpFraction: 0.1 } as Nameable;
    const [plate] = nameplateModel([withStrayCombatState], NAMES);
    expect(plate!.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
  });

  it('still dims the whole layer together when a caller asks it to', () => {
    // The one alpha knob that survives is per-LAYER, never per-plate: it cannot
    // reproduce the bug, because it cannot make two ships differ.
    const plates = nameplateModel([ship({ owner: 1 }), ship({ owner: 3 })], NAMES, {
      fullAlpha: 0.5,
    });
    expect(plates.map((p) => p.alpha)).toEqual([0.5, 0.5]);
  });
});

describe('the label still sorts above the bar cluster (rule 3’s intent)', () => {
  // What the fade was protecting: the health bar owns the eye in a brawl. That
  // never rested on opacity — the view floats the label above the whole bar
  // cluster, so it cannot cover a bar at ANY brightness. With the fade gone this
  // is the only thing left holding the promise, so it is pinned here.

  /** The bar layer's own top edge for this entity (healthbar-view.ts:
   *  `bottom = y - radius - GAP`, `top = bottom - height`). */
  function barTop(y: number, radius: number): number {
    return y - radius - HEALTHBAR_GAP - HEALTHBAR_HEIGHT;
  }

  function plateFor(over: Partial<Nameable> = {}): Nameplate {
    return nameplateModel([ship(over)], NAMES)[0]!;
  }

  it('puts the label’s bottom edge strictly above the health bar’s top edge', () => {
    const plate = plateFor();
    const labelBottom = plate.y - nameplateClusterClearance(plate);
    expect(labelBottom).toBeLessThan(barTop(plate.y, plate.radius));
    // …by exactly the declared gap, off the bar's own geometry — one number, not
    // two drifting copies.
    expect(labelBottom).toBeCloseTo(barTop(plate.y, plate.radius) - NAMEPLATE_SHIP_GAP, 5);
  });

  it('holds for a damaged and a fighting ship — the two that used to fade', () => {
    // Same entities as the re-pointed tests above: bar-worthy by the bar layer's
    // own predicate, fully lit, and still stacked clear of the bar.
    for (const c of [combatant({ hp: 20 }), combatant({ inCombat: true })]) {
      expect(combatantGetsBar(c, LOCAL_SLOT)).toBe(true);
      const plate = plateFor({ pos: c.pos, radius: c.radius });
      expect(plate.alpha).toBeCloseTo(NAMEPLATE_FULL_ALPHA, 5);
      expect(plate.y - nameplateClusterClearance(plate)).toBeLessThan(barTop(c.pos.y, c.radius));
    }
  });

  it('holds for any ship radius, so a big hull cannot push the label onto its bar', () => {
    for (const radius of [4, 12, 28, 64]) {
      const plate = plateFor({ radius });
      expect(plate.y - nameplateClusterClearance(plate)).toBeLessThan(barTop(plate.y, radius));
    }
  });

  it('floats a station label clear of its HP pin too', () => {
    const [plate] = nameplateModel([station()], NAMES);
    expect(nameplateClusterClearance(plate!)).toBeGreaterThan(plate!.radius);
  });
});

describe('the whole frame', () => {
  it('emits one plate per labelled entity, passing screen position through', () => {
    const plates = nameplateModel(
      [
        ship({ owner: 1, pos: { x: 10, y: 20 }, radius: 12 }),
        station({ owner: 1, pos: { x: 30, y: 40 }, radius: 40 }),
        ship({ owner: 0, local: true }), // suppressed by default
        ship({ owner: 2, alive: false }), // dead → dropped
      ],
      NAMES,
    );
    expect(plates.map((p) => ({ owner: p.owner, kind: p.kind, text: p.text }))).toEqual([
      { owner: 1, kind: 'ship', text: 'Rusty' },
      { owner: 1, kind: 'station', text: 'Rusty' },
    ]);
    expect(plates[0]!.x).toBe(10);
    expect(plates[0]!.y).toBe(20);
    expect(plates[0]!.radius).toBe(12);
  });

  it('marks only the local ship’s label local (when shown), never a station’s', () => {
    const [shipPlate, stationPlate] = nameplateModel(
      [ship({ owner: 0, local: true }), station({ owner: 0 })],
      NAMES,
      { showOwnShipLabel: true },
    );
    expect(shipPlate!.local).toBe(true);
    expect(stationPlate!.local).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// The side label (m10 teams — ratified: colour alone is insufficient;
// u3 — FRIENDLY/ENEMY + letter, the word relative to the viewer)
// ---------------------------------------------------------------------------

describe('the side label', () => {
  it('names the side in words, not as a letter or a hue', () => {
    // The developer could not tell who was on their team. `A` is a legend nobody
    // was given, and `TEAM A` only helped a player who remembered which team they
    // were; `FRIENDLY A` answers the question that was actually asked. Same string
    // the lobby chip carries (`./lobby` teamName).
    expect(resolveTeamLabel(TEAMS, 0, IN_TEAMS)).toBe('FRIENDLY A');
    expect(resolveTeamLabel(TEAMS, 1, IN_TEAMS)).toBe('ENEMY B');
    expect(resolveTeamLabel(TEAMS, 2, IN_TEAMS)).toBe('FRIENDLY A');
  });

  it('flips the WORD with the viewer and never the LETTER', () => {
    // The same table, read by a player on the other side. Slot 1 is `B` on both
    // screens; it is FRIENDLY on one and ENEMY on the other.
    const asB = { showTeamLabels: true, viewerTeam: 1 } as const;
    expect(resolveTeamLabel(TEAMS, 1, asB)).toBe('FRIENDLY B');
    expect(resolveTeamLabel(TEAMS, 0, asB)).toBe('ENEMY A');
    expect(resolveTeamRelation(TEAMS, 1, asB)).toBe('friendly');
    expect(resolveTeamRelation(TEAMS, 1, IN_TEAMS)).toBe('enemy');
  });

  it('colours the tag blue for an ally and red for a rival, never the name', () => {
    const [ally, rival] = nameplateModel(
      [ship({ owner: 2 }), ship({ owner: 1 })],
      NAMES,
      IN_TEAMS,
      DIFFS,
      TEAMS,
    );
    expect(ally!.teamColor).toBe(SIDE_COLORS.friendly);
    expect(rival!.teamColor).toBe(SIDE_COLORS.enemy);
    // The NAME keeps the owner's identity colour — per-SLOT, style-guide §3.1 —
    // because that is how a player tells two enemies apart. Side colour lives on
    // the side tag alone, as reinforcement for a word that already says it.
    expect(ally!.color).toBe(playerColor(2));
    expect(rival!.color).toBe(playerColor(1));
    expect(rival!.teamLabel).toBe('ENEMY B');
  });

  it('reads the neutral TEAM <letter> with no viewer — a spectator has no enemies', () => {
    expect(resolveTeamLabel(TEAMS, 0, SPECTATING)).toBe('TEAM A');
    expect(resolveTeamLabel(TEAMS, 1, SPECTATING)).toBe('TEAM B');
    const plates = nameplateModel([ship({ owner: 1 })], NAMES, SPECTATING, DIFFS, TEAMS);
    expect(plates[0]!.teamLabel).toBe('TEAM B');
    expect(plates[0]!.teamColor).toBe(SIDE_COLORS.neutral);
  });

  it('names three and four sides with one FRIENDLY and distinct ENEMYs', () => {
    for (const sides of [3, 4]) {
      const table: TeamTable = Array.from({ length: sides }, (_, i) => i);
      const named = table.map((_, owner) => resolveTeamLabel(table, owner, IN_TEAMS));
      expect(named.filter((n) => n.startsWith('FRIENDLY'))).toEqual(['FRIENDLY A']);
      const enemies = named.filter((n) => n.startsWith('ENEMY'));
      expect(enemies).toHaveLength(sides - 1);
      expect(new Set(enemies).size).toBe(enemies.length);
    }
  });

  it('says nothing at all in FFA', () => {
    // Teams-of-one: every plate would read a different side, which is noise
    // dressed as information — and the free-for-all HUD must be unchanged.
    expect(resolveTeamLabel([0, 1, 2, 3], 2)).toBe('');
    expect(nameplateModel([ship({ owner: 2 })], NAMES, {}, DIFFS, [0, 1, 2, 3])[0]!.teamLabel).toBe('');
  });

  it('makes no claim about a slot the table does not name', () => {
    // A partially-known roster degrades to no claim rather than a wrong one.
    expect(resolveTeamLabel([0, undefined, 1], 1, IN_TEAMS)).toBe('');
    expect(resolveTeamLabel([], 0, IN_TEAMS)).toBe('');
    expect(resolveTeamLabel(TEAMS, -1, IN_TEAMS)).toBe('');
  });

  it('folds a side number past the roster back into a readable letter', () => {
    // Four sides is the lobby's ceiling; a stray value must still READ, because a
    // blank where a side belongs is the exact failure this label exists to fix.
    expect(resolveTeamLabel([4], 0, IN_TEAMS)).toBe('ENEMY A');
    expect(resolveTeamLabel([5], 0, IN_TEAMS)).toBe('ENEMY B');
  });

  it('puts the side on every plate in a teams match — ships and homes alike', () => {
    const plates = nameplateModel(
      [ship({ owner: 0 }), station({ owner: 1 }), ship({ owner: 3 })],
      NAMES,
      IN_TEAMS,
      DIFFS,
      TEAMS,
    );
    expect(plates.map((p) => [p.owner, p.kind, p.teamLabel])).toEqual([
      [0, 'ship', 'FRIENDLY A'],
      [1, 'station', 'ENEMY B'],
      [3, 'ship', 'ENEMY B'],
    ]);
  });

  it('keeps the side separate from the name and the difficulty tag', () => {
    // Three fields, not one string: the view weights them differently, and a test
    // must be able to say WHICH part is the side without parsing a run-on label.
    const [plate] = nameplateModel([ship({ owner: 3 })], NAMES, IN_TEAMS, DIFFS, TEAMS);
    expect(plate!.text).toBe('Warden');
    expect(plate!.suffix).toBe('(HARD)');
    expect(plate!.teamLabel).toBe('ENEMY B');
  });

  it('leaves a human seat its side and no difficulty tag', () => {
    const [plate] = nameplateModel([ship({ owner: 0 })], NAMES, IN_TEAMS, DIFFS, TEAMS);
    expect(plate!.suffix).toBe(''); // humans never carry a tier
    expect(plate!.teamLabel).toBe('FRIENDLY A'); // but they do carry a side
  });
});

// ---------------------------------------------------------------------------
// The side reads FIRST (a0-38 — the developer: "friendly or enemy should be the
// first thing displayed on a name so thats its easier to identify")
// ---------------------------------------------------------------------------
//
// The plate used to read `Bolt FRIENDLY A (EASY)`: the fact a player scans for
// sat second, behind a name that varies in length, so it had no fixed place on
// the row. It leads now — `FRIENDLY A Bolt (EASY)`.
//
// The three parts were ALREADY separate fields on the model (deliberately: m10 /
// u3 / v0.2.2), so nothing above this line changed — every side-label assertion in
// the block before it still passes verbatim, which is the proof that this is an
// ordering change in the view and not a restructure. The order itself lives in
// `nameplateRowLayout`, the pure half of the draw loop, and is asserted here
// without a GPU the same way the cluster clearance is.

/** The row a plate lays out for the given token widths, centred at x = 100. */
function row(side: number, name: number, suffix: number) {
  return nameplateRowLayout(100, { side, name, suffix });
}

describe('the side leads the row (a0-38)', () => {
  it('puts the side tag before the name, and the difficulty tag after it', () => {
    const r = row(50, 30, 20);
    expect(r.sideX).toBeLessThan(r.nameX);
    expect(r.nameX).toBeLessThan(r.suffixX);
    // …and by exactly the declared gaps, so "before" is a measured beat and not
    // an overlap that happens to sort correctly.
    expect(r.nameX - (r.sideX + 50)).toBeCloseTo(NAMEPLATE_TEAM_GAP, 10);
    expect(r.suffixX - (r.nameX + 30)).toBeCloseTo(NAMEPLATE_SUFFIX_GAP, 10);
  });

  it('keeps the name centred on the entity, whatever flanks it', () => {
    // The name is the thing pinned to the ship; the tags flank it. So a plate does
    // not slide out from under its own hull when a side tag appears — which is
    // what centring the whole ROW would have done to every plate in the game.
    for (const r of [row(50, 30, 20), row(50, 30, 0), row(0, 30, 20), row(0, 30, 0)]) {
      expect(r.nameX).toBeCloseTo(100 - 30 / 2, 10);
    }
  });

  it('opens an FFA plate with the NAME — no gap, no stray separator', () => {
    // `side` is '' on every plate in a free-for-all (asserted in the block above),
    // so the leading gap must not be charged: the row starts at the name itself.
    const ffa = row(0, 30, 20);
    expect(ffa.left).toBeCloseTo(ffa.nameX, 10);
    expect(ffa.left).toBeCloseTo(100 - 30 / 2, 10);
    // The bare case too — an FFA human seat, which has neither tag.
    const bare = row(0, 30, 0);
    expect(bare.left).toBeCloseTo(100 - 30 / 2, 10);
    expect(bare.width).toBeCloseTo(30, 10);
  });

  it('leaves the FFA plate exactly where it drew before a0-38', () => {
    // The FFA HUD has no side and no business moving for a change about sides.
    // The pre-a0-38 arrangement was: name centred on the entity, suffix hanging
    // off its right edge. Spelled out here as the old arithmetic, so a future
    // rearrangement of the row cannot quietly drag free-for-all along with it.
    for (const [name, suffix] of [[30, 20], [44, 0], [12, 33]] as const) {
      const oldLeft = 100 - name / 2;
      const oldRight = oldLeft + name + (suffix > 0 ? NAMEPLATE_SUFFIX_GAP + suffix : 0);
      const r = row(0, name, suffix);
      expect(r.left).toBeCloseTo(oldLeft, 10);
      expect(r.right).toBeCloseTo(oldRight, 10);
    }
  });

  it('charges the trailing gap only for a seat that HAS a difficulty tag', () => {
    const human = row(50, 30, 0);
    expect(human.right).toBeCloseTo(human.nameX + 30, 10);
    const bot = row(50, 30, 20);
    expect(bot.right).toBeCloseTo(bot.nameX + 30 + NAMEPLATE_SUFFIX_GAP + 20, 10);
  });

  it('leads the LOCAL player’s own plate with the side too — `FRIENDLY A YOU`', () => {
    // a0-38 asks which the local plate becomes, and the answer is the same rule as
    // every other plate: the side leads, the name follows. `YOU` alone was the
    // alternative — it is already unambiguous, and a side tag over your own home
    // is arguably noise — but it was rejected on two counts. The tag is the ONE
    // place in a match that tells the viewer which letter is theirs, and u3's whole
    // ratification is that a letter only helps a player who knows that ("`TEAM A`
    // only helps a player who remembers which team they are"): in a 1v1 teams match
    // with no ally on screen, dropping it leaves `ENEMY B` with nothing to be read
    // against. And it would be a content change — dropping a ratified tag from a
    // plate — inside a brief that is an ordering change. Width is not the reason to
    // do it either: `YOU` is the shortest name in the game and a human seat carries
    // no difficulty tag, so this is the narrowest plate on the screen, not the one
    // the width risk lives in.
    const [own] = nameplateModel([station({ owner: 0 })], NAMES, IN_TEAMS, DIFFS, TEAMS);
    expect(own!.text).toBe('YOU');
    expect(own!.teamLabel).toBe('FRIENDLY A');
    expect(own!.suffix).toBe('');
    const r = nameplateRowLayout(100, {
      side: widthOf(own!.teamLabel),
      name: widthOf(own!.text),
      suffix: 0,
    });
    expect(r.sideX).toBeLessThan(r.nameX);
    expect(r.left).toBeCloseTo(r.sideX, 10);
  });

  it('spans side → name → tag as ONE piece, which is what the cull measures', () => {
    const r = row(50, 30, 20);
    expect(r.left).toBeCloseTo(r.sideX, 10);
    expect(r.right).toBeCloseTo(r.suffixX + 20, 10);
    expect(r.width).toBeCloseTo(50 + NAMEPLATE_TEAM_GAP + 30 + NAMEPLATE_SUFFIX_GAP + 20, 10);
  });
});

// ---------------------------------------------------------------------------
// Width, measured — the risk a0-38 names (and a0-32's method for answering it)
// ---------------------------------------------------------------------------

/** The plate's own type, as the view styles it (`./nameplates-view`): Oxanium at
 *  the exported size, `name`-tier tracking. Read from the source, not restated. */
const PLATE_TYPE = { face: 'body', size: NAMEPLATE_FONT_SIZE, tracking: HUD_TRACKING.name } as const;
/** The widest thing that can stand in each of the three slots: the longer side
 *  word, a name at the model's own 12-character clamp in the widest Latin glyph
 *  this UI draws, and the longest difficulty tier. */
const WIDEST_SIDE = 'FRIENDLY A';
const WIDEST_NAME = 'W'.repeat(NAMEPLATE_MAX_CHARS);
const WIDEST_SUFFIX = '(MEDIUM)';
/** The landscape phone the brief measures at — 390px tall, 844 wide. */
const PHONE_LANDSCAPE = { width: 844, height: 390 } as const;

function widthOf(text: string): number {
  return text.length > 0 ? textWidth(text, PLATE_TYPE) : 0;
}

describe('the widest possible plate, measured on the real faces', () => {
  const side = widthOf(WIDEST_SIDE);
  const name = widthOf(WIDEST_NAME);
  const suffix = widthOf(WIDEST_SUFFIX);
  const worst = nameplateRowLayout(PHONE_LANDSCAPE.width / 2, { side, name, suffix });

  it('fits across the landscape phone with the screen to spare', () => {
    // Leading with `FRIENDLY A` makes the common case wider in WORDS; the drawn
    // row is the same three tokens and the same two gaps it always was, so what
    // is at stake is the cull, not the truncation. The worst row is a third of
    // the 844px screen, so a plate is culled only near an edge — never for being
    // long in itself.
    expect(worst.width).toBeLessThan(PHONE_LANDSCAPE.width / 2);
    expect(worst.left).toBeGreaterThan(0);
    expect(worst.right).toBeLessThan(PHONE_LANDSCAPE.width);
  });

  it('reaches LESS far from its ship than the old name-first plate did', () => {
    // The width answer in one number. Before a0-38 both tags hung off the name's
    // right edge, so the row's whole reach was one-sided; now it is split either
    // side of a name that has not moved. Same tokens, same gaps, smaller radius —
    // the plate sits over the ship it names instead of trailing off one side of it.
    const centre = PHONE_LANDSCAPE.width / 2;
    const reachNow = Math.max(centre - worst.left, worst.right - centre);
    const reachBefore =
      name / 2 + NAMEPLATE_TEAM_GAP + side + NAMEPLATE_SUFFIX_GAP + suffix;
    expect(reachNow).toBeLessThan(reachBefore);
  });

  it('costs the cull nothing — the row is the same width it always was', () => {
    // The claim that is NOT made above, kept separate so it cannot be read into
    // it: the band of ship positions that keep a plate is `viewport − row width`,
    // and the row is a rigid body a0-38 only re-anchored. So the band is exactly
    // as wide as before — it shifts right rather than shrinking, and no plate is
    // culled for being long that was not culled before.
    const rowBefore = name + NAMEPLATE_TEAM_GAP + side + NAMEPLATE_SUFFIX_GAP + suffix;
    expect(worst.width).toBeCloseTo(rowBefore, 10);
    const bandNow = PHONE_LANDSCAPE.width - worst.width;
    expect(bandNow).toBeCloseTo(PHONE_LANDSCAPE.width - rowBefore, 10);
    expect(bandNow).toBeGreaterThan(0);
  });

  it('keeps the model’s 12-character clamp doing the truncating, not the layer', () => {
    // The name is the only variable-length token — the side words and the tier
    // tags are a closed set — and it is clamped in the model with a visible
    // ellipsis. So no drawn plate is wider than the one measured here.
    const clamped = resolveName(['A-Very-Long-Callsign-Indeed'], 0);
    expect(clamped.length).toBe(NAMEPLATE_MAX_CHARS);
    expect(widthOf(clamped)).toBeLessThanOrEqual(name);
  });
});
