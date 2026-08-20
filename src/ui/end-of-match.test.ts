/**
 * src/ui/end-of-match.test.ts — the summary, headless.
 *
 * The one rule that matters most — spectate is offered only while a match is
 * still live for others — is a pure function of the outcome, and is asserted
 * here for all four ends.
 *
 * Since u7-05 this file also holds the screen to its MATERIAL: one bright plate
 * and it is REMATCH, the winner's colour spent on the identity rule and nowhere
 * else, and the four results still saying exactly what they said before the
 * re-skin. The last of those is the one worth stating out loud — a re-skin that
 * edits the words is not a re-skin.
 */

import { describe, it, expect } from 'vitest';
import { BEAM, PLATE_SCALES, ROW_BAR_WIDTH, TOUCH_MIN } from '../art/materials';
import { deriveAlarmAllies } from '../art/audio/scope';
import { createWorld } from '../sim';
import { sameSide } from '../sim/allegiance';
import { ShipClass } from '../shared/types';
import { countPrimaries, singlePrimary } from './gantry';
import { MAIN_MENU_EYEBROW } from './main-menu';
import { playerColor } from './station-hp';
import {
  endButtons,
  endKind,
  endOfMatchHitTest,
  endOfMatchLayout,
  endOfMatchModel,
  onYourSide,
} from './end-of-match';
import type { EndButton, MatchOutcome } from './end-of-match';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

const over = (you: number, winner: number | null): MatchOutcome => ({ you, winner, matchOver: true });
const eliminated = (you: number): MatchOutcome => ({ you, winner: null, matchOver: false });

/** A TEAMS outcome: the whole match over, with the seat's own side named. The
 *  roster is the shape the wiring hands over — `main.ts` `alarmAllies()`, the
 *  same set the under-attack klaxon is scoped to. */
const teamOver = (
  you: number,
  winner: number | null,
  allies: readonly number[],
): MatchOutcome => ({ you, winner, matchOver: true, allies: new Set(allies) });

/** The 2v2 the developer played: you and Player 8 (slot 7) hold side A, slots 1
 *  and 3 hold side B. Slot 7 is the ally whose win read as a DEFEAT. */
const MY_SIDE = [0, 7] as const;

describe('reading an outcome', () => {
  it('names victory, defeat, draw and elimination', () => {
    expect(endKind(over(2, 2))).toBe('victory');
    expect(endKind(over(2, 5))).toBe('defeat');
    expect(endKind(over(2, null))).toBe('draw');
    expect(endKind(eliminated(2))).toBe('eliminated');
  });

  /**
   * ── a0-09: THE BUG THIS FILE USED TO PIN ────────────────────────────────
   *
   * `endKind` was `winner === you` — a pure identity check on a type with no
   * notion of a side — and the case below did not exist, so the suite passed the
   * defect happily for as long as it shipped. The developer's report, 2026-08-07,
   * with a screenshot of the end screen: *"i lost somehow but my team is the one
   * that won..."* The screen read DEFEAT over a line naming Player 7 the way it
   * names an opponent, and Player 7 was their teammate.
   *
   * Not an edge case: in TEAMS an ally's win is arithmetically identical to an
   * enemy's under an identity check, so **every** Teams win by anyone other than
   * the local player reported a loss to that player.
   */
  describe('in TEAMS — whose side the winner is on, not whether they are you', () => {
    it('calls an ALLY’s win a VICTORY — the developer’s case', () => {
      expect(endKind(teamOver(0, 7, MY_SIDE))).toBe('victory');
    });

    it('still calls an ENEMY’s win a DEFEAT', () => {
      expect(endKind(teamOver(0, 1, MY_SIDE))).toBe('defeat');
      expect(endKind(teamOver(0, 3, MY_SIDE))).toBe('defeat');
    });

    it('calls YOUR own win a VICTORY, roster or no roster', () => {
      expect(endKind(teamOver(0, 0, MY_SIDE))).toBe('victory');
      // A roster that somehow forgot to list you cannot make you your own enemy —
      // the same self-immunity `sim/allegiance` guarantees ahead of any team
      // accounting.
      expect(endKind(teamOver(0, 0, [7]))).toBe('victory');
    });

    it('reads an ELIMINATED seat whose side then WINS as a VICTORY', () => {
      // The developer's screenshot in slow motion: your core dies, you take
      // SPECTATE, and your side finishes the job. The match-over screen that
      // follows must land on the right word — not DEFEAT, and not ELIMINATED
      // (that state ended when the match did).
      const watching = { you: 0, winner: null, matchOver: false, allies: new Set(MY_SIDE) };
      expect(endKind(watching)).toBe('eliminated');
      expect(endButtons(watching)).toContain('spectate');

      const sideWon = teamOver(0, 7, MY_SIDE);
      expect(endKind(sideWon)).toBe('victory');
      expect(endButtons(sideWon)).toEqual(['rematch', 'menu']);
    });

    it('leaves the draw and no-survivor ends exactly where they were', () => {
      expect(endKind(teamOver(0, null, MY_SIDE))).toBe('draw');
      expect(endKind({ you: 0, winner: null, matchOver: false, allies: new Set(MY_SIDE) })).toBe(
        'eliminated',
      );
    });

    it('is FFA character for character with no roster — teams-of-one', () => {
      // The absent `allies` IS the FFA case (`sim/allegiance`: "FFA is
      // teams-of-one"), and an explicit side of one must agree with it.
      for (const winner of [0, 1, 4, 7]) {
        expect(endKind(over(0, winner))).toBe(endKind(teamOver(0, winner, [0])));
      }
      expect(endKind(over(0, 0))).toBe('victory');
      expect(endKind(over(0, 7))).toBe('defeat');
    });

    /**
     * "One predicate, one answer, everywhere" is the claim a0-09 rests on, and
     * every case above tests it against a hand-written roster — which proves the
     * summary is self-consistent, not that it agrees with the SIM. Those are
     * different claims, and the bug was born of exactly that gap: the screen had
     * its own idea of who won and the sim had allegiance, and nobody compared
     * them.
     *
     * So compare them, on a real sided world, for every slot: the seat's verdict
     * must equal `sim/allegiance` `sameSide` — the same predicate the targeting
     * ladder and friendly fire read. The roster is not hand-written here either;
     * it comes from `deriveAlarmAllies`, the function the shipped client actually
     * hands `currentOutcome()`. If the UI's notion of a side ever drifts from the
     * sim's, this fails, and it fails for the drifting slot by name.
     */
    it('agrees with the SIM’s own sameSide, slot for slot, on a real sided world', () => {
      // 2v2, the developer's shape: slots 0 and 7 hold side A, 1 and 3 side B.
      const world = createWorld({
        seed: 9,
        asteroidCount: 0,
        players: [
          { id: 0, shipClass: ShipClass.Vanguard, team: 0 },
          { id: 1, shipClass: ShipClass.Vanguard, team: 1 },
          { id: 3, shipClass: ShipClass.Vanguard, team: 1 },
          { id: 7, shipClass: ShipClass.Vanguard, team: 0 },
        ],
      });
      const allies = deriveAlarmAllies(world, 0);

      for (const winner of [0, 1, 3, 7]) {
        const outcome: MatchOutcome = { you: 0, winner, matchOver: true, allies };
        expect(onYourSide(outcome, winner), `slot ${winner}: UI vs sim`).toBe(
          sameSide(world, 0, winner),
        );
        expect(endKind(outcome), `slot ${winner}: the word the player is told`).toBe(
          sameSide(world, 0, winner) ? 'victory' : 'defeat',
        );
      }

      // And the premise the whole comparison rests on: the world really is sided.
      // In FFA this set is {0} and the loop above would pass while proving nothing.
      expect([...allies].sort((a, b) => a - b), 'the derived side is you AND your ally').toEqual([
        0, 7,
      ]);
    });

    it('exposes the one predicate the whole screen asks', () => {
      // Headline, subhead and identity rule all route through this, so they
      // cannot answer "is that mine?" three different ways.
      const o = teamOver(0, 7, MY_SIDE);
      expect(onYourSide(o, 0)).toBe(true); // you
      expect(onYourSide(o, 7)).toBe(true); // your ally
      expect(onYourSide(o, 1)).toBe(false); // an enemy
      expect(onYourSide(o, null)).toBe(false); // nobody
      expect(onYourSide(over(0, 0), 7)).toBe(false); // FFA: nobody but you
    });
  });

  it('offers spectate ONLY while the match is still live for others', () => {
    expect(endButtons(eliminated(0))).toEqual(['rematch', 'spectate']);
    // A whole-match-over screen has nothing to watch — spectate never rides it.
    for (const outcome of [over(0, 0), over(0, 3), over(0, null)]) {
      expect(endButtons(outcome)).not.toContain('spectate');
    }
  });

  it('offers BACK TO MENU ONLY once the whole match is over', () => {
    expect(endButtons(over(0, 0))).toEqual(['rematch', 'menu']);
    expect(endButtons(over(0, 3))).toEqual(['rematch', 'menu']);
    expect(endButtons(over(0, null))).toEqual(['rematch', 'menu']);
    // Eliminated-but-live gets spectate instead, never the menu.
    expect(endButtons(eliminated(0))).not.toContain('menu');
  });

  it('always keeps Rematch (GDD §4.7), first', () => {
    for (const outcome of [over(0, 0), over(0, 1), over(0, null), eliminated(0)]) {
      expect(endButtons(outcome)[0]).toBe('rematch');
    }
  });
});

describe('the frame model', () => {
  it('headlines each end and marks Rematch primary', () => {
    const victory = endOfMatchModel(over(1, 1));
    expect(victory.headline).toBe('VICTORY');
    expect(endOfMatchModel(over(2, 5)).headline).toBe('DEFEAT');
    expect(endOfMatchModel(over(2, null)).headline).toBe('DRAW');
    expect(victory.buttons[0]).toMatchObject({ id: 'rematch', primary: true });

    const elim = endOfMatchModel(eliminated(1));
    expect(elim.headline).toBe('ELIMINATED');
    expect(elim.buttons.map((b) => b.id)).toEqual(['rematch', 'spectate']);
    expect(elim.buttons[1]).toMatchObject({ id: 'spectate', primary: false });
  });

  /**
   * a0-09 settled the colour seam: the identity rule carries **the winner's**
   * colour on every end that has one. It read `playerColor(you)` on victory and
   * `playerColor(winner)` on defeat, which were the same number while victory
   * meant "you won"; an ally victory is the first outcome to take the victory
   * path with someone else's name under it, and the rule must point at whoever
   * the line under it names — one fact, two carriers, never in disagreement.
   *
   * The SIDE is not drawn here on purpose: GDD §5.7 keeps the team motif's
   * blue/red off identity surfaces (*"never a hull, never a ship's trim, never an
   * HP bar"*), and this rule is the end screen's identity surface. The side is
   * carried in words, by the subhead.
   */
  it('accents every end that has a winner with THAT winner’s colour', () => {
    expect(endOfMatchModel(over(3, 3)).accent).toBe(playerColor(3)); // your win
    expect(endOfMatchModel(over(3, 6)).accent).toBe(playerColor(6)); // a loss
    expect(endOfMatchModel(teamOver(0, 7, MY_SIDE)).accent).toBe(playerColor(7)); // an ally's win
    // No one to colour on a draw or an elimination.
    expect(endOfMatchModel(over(3, null)).accent).toBeNull();
    expect(endOfMatchModel(eliminated(3)).accent).toBeNull();
  });

  it('names the victor in a defeat’s subhead, one-based', () => {
    expect(endOfMatchModel(over(0, 4)).subhead).toContain('Player 5');
  });

  /**
   * The other half of the developer's screenshot. DEFEAT was the wrong headline,
   * and the line under it named Player 7 the way it names an opponent — printed
   * about a friend. An ally's win gets its own sentence: who won, and that they
   * were on your side.
   */
  it('reads an ally’s win as YOUR SIDE winning, and names who won it', () => {
    const allyWon = endOfMatchModel(teamOver(0, 7, MY_SIDE));
    expect(allyWon.headline).toBe('VICTORY');
    expect(allyWon.subhead).toBe('Player 8 won it for your side.');
    // It is never the opponent's sentence…
    expect(allyWon.subhead).not.toBe('Player 8 won.');
    // …and never says YOU won a match your teammate won.
    expect(allyWon.subhead).not.toBe('You won.');

    // Your own win is untouched — no "your side" hedge when you did it yourself.
    expect(endOfMatchModel(teamOver(0, 0, MY_SIDE)).subhead).toBe('You won.');
    // And an enemy's win keeps the line it always had.
    expect(endOfMatchModel(teamOver(0, 1, MY_SIDE)).subhead).toBe('Player 2 won.');
  });

  /**
   * ---------------------------------------------------------------------------
   * THE §4.7 GUARD, REWRITTEN RATHER THAN RETIRED (a0-108)
   * ---------------------------------------------------------------------------
   * This test used to assert the *condition* on the old headlines: GDD §4.7's
   * accessibility clause permitted the three in-register headlines it then had
   * **only** while a plain line sat underneath, so if a refactor emptied
   * `subheadFor()` the headlines had to revert to plain words.
   *
   * a0-108 made the headlines plain, so that condition no longer has anything to
   * hold — but the thing the clause was *protecting* is untouched, and it is the
   * only reason the subhead exists at all: **`VICTORY` does not say who won.**
   * Four of the five outcomes here have a winner and three of those are somebody
   * other than the reader, which is exactly the confusion the developer's
   * screenshot caught (a0-09). Deleting the guard because its old trigger went
   * away would drop the protection with it.
   *
   * So it now asserts the thing itself: the headline states the *outcome*, the
   * line under it states *who*, and neither is ever asked to do the other's job.
   */
  it('never lets the headline be the only statement of who won', () => {
    // A win of your own: the headline says what happened, the line says who.
    const victory = endOfMatchModel(over(1, 1));
    expect(victory.headline).toBe('VICTORY');
    expect(victory.subhead).toBe('You won.');

    // A loss names the winner — never left to the headline's colour to carry.
    const defeat = endOfMatchModel(over(1, 4));
    expect(defeat.headline).toBe('DEFEAT');
    expect(defeat.subhead).toContain('Player 5');
    expect(defeat.subhead).toContain('won');

    // An ally's win is the pair that made this matter (a0-09): the headline is
    // the same `VICTORY` a solo win gets, so the line beneath is the ONLY place
    // the reader learns it was a teammate who did it, and which teammate.
    const allied = endOfMatchModel(teamOver(0, 7, MY_SIDE));
    expect(allied.headline).toBe('VICTORY');
    expect(allied.subhead).toContain('Player 8');
    expect(allied.subhead).toContain('your side');

    // Cover the whole map: every outcome with a winner names one, in words.
    for (const outcome of [over(1, 1), over(1, 4), teamOver(0, 7, MY_SIDE)]) {
      expect(endOfMatchModel(outcome).subhead).not.toBe('');
    }

    // The draw has no winner to name, so its line states the outcome instead —
    // and still says something `DRAW` does not: why there was nobody left.
    const draw = endOfMatchModel(over(1, null));
    expect(draw.headline).toBe('DRAW');
    expect(draw.subhead).toBe('No reactor survived the collapse.');
  });

  it('offers REMATCH + BACK TO MENU on a whole-match-over screen', () => {
    const model = endOfMatchModel(over(0, 3));
    expect(model.buttons.map((b) => b.id)).toEqual(['rematch', 'menu']);
    expect(model.buttons[1]).toMatchObject({ id: 'menu', primary: false });
  });

  it('writes placement and cause into the DEFEATED overlay line', () => {
    const model = endOfMatchModel({
      you: 2,
      winner: null,
      matchOver: false,
      placement: 6,
      totalPlayers: 8,
      cause: 'destroyed',
    });
    expect(model.headline).toBe('ELIMINATED');
    expect(model.subhead).toContain('6th of 8');
    expect(model.subhead).toContain('destroyed');
  });

  it('names the collapse as a cause of death', () => {
    const model = endOfMatchModel({
      you: 1,
      winner: null,
      matchOver: false,
      placement: 2,
      totalPlayers: 8,
      cause: 'collapse',
    });
    expect(model.subhead).toBe('2nd of 8 — the collapse closed over your reactor.');
  });

  it('falls back to the plain elimination line with no placement or cause', () => {
    // a0-87 trimmed the consolation clause off the end of this one; the fact is
    // the whole line, and REMATCH / SPECTATE sit right under it.
    expect(endOfMatchModel(eliminated(0)).subhead).toBe('Your reactor is gone.');
  });
});

describe('layout and hit test', () => {
  it('routes a tap on each button to its id, in model order', () => {
    const model = endOfMatchModel(eliminated(0));
    const ids = model.buttons.map((b) => b.id) as EndButton[];
    const layout = endOfMatchLayout(VIEWPORT, ids);
    expect(layout.buttons).toHaveLength(2);

    layout.buttons.forEach((rect, i) => {
      const p = center(rect);
      expect(endOfMatchHitTest(layout, p.x, p.y, ids)).toEqual({ kind: ids[i] });
    });
  });

  it('lays a single Rematch button out when the match is fully over', () => {
    const layout = endOfMatchLayout(VIEWPORT, ['rematch']);
    expect(layout.buttons).toHaveLength(1);
    const p = center(layout.buttons[0]!);
    expect(endOfMatchHitTest(layout, p.x, p.y, ['rematch'])).toEqual({ kind: 'rematch' });
  });

  it('keeps the result above the buttons and everything inside the content box', () => {
    const layout = endOfMatchLayout(VIEWPORT, ['rematch', 'menu']);
    expect(layout.headline.y).toBeGreaterThanOrEqual(layout.content.y);
    for (const b of layout.buttons) {
      expect(b.y).toBeGreaterThanOrEqual(layout.subhead.y + layout.subhead.height - 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(layout.content.y + layout.content.height + 0.5);
    }
  });

  it('returns null off every button', () => {
    const layout = endOfMatchLayout(VIEWPORT, ['rematch', 'spectate']);
    expect(endOfMatchHitTest(layout, 5000, 5000, ['rematch', 'spectate'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GANTRY / BONE, AND THE ACHE (u7-05)
// ---------------------------------------------------------------------------
//
// This screen is the one a player stares at longest and the one carrying the tone
// contract's station-death beat, so its re-skin has two things to hold at once:
// the material's own rules, and the restraint that keeps a result from reading as
// a celebration. Both are here because both are decisions a later change can undo
// without noticing.

describe('the Gantry/Bone summary', () => {
  const ALL: readonly MatchOutcome[] = [over(0, 0), over(0, 3), over(0, null), eliminated(0)];

  it('draws exactly ONE bright plate, on every one of the four ends', () => {
    for (const outcome of ALL) {
      const roles = endOfMatchModel(outcome).buttons.map((b) => b.role);
      expect(singlePrimary(roles), `${endKind(outcome)} drew two bright plates`).toBe(true);
      expect(countPrimaries(roles), `${endKind(outcome)} drew none`).toBe(1);
    }
  });

  it('puts it on REMATCH — the button GDD §4.7 says always survives', () => {
    for (const outcome of ALL) {
      const primary = endOfMatchModel(outcome).buttons.find((b) => b.role === 'primary')!;
      expect(primary.id).toBe('rematch');
      expect(primary.scale).toBe('hero'); // brightness AND size
    }
  });

  it('never draws a plate in the disabled costume — SPECTATE is not greyed out', () => {
    for (const outcome of ALL) {
      for (const b of endOfMatchModel(outcome).buttons) expect(b.role).not.toBe('inert');
    }
  });

  it('spends the winner\'s colour on the identity RULE, and nowhere else', () => {
    // Bone spends no hue on chrome; a player's colour is not chrome, and this
    // direction gives it one place to live (a 4px bar, `ROW_BAR_WIDTH`).
    const victory = endOfMatchLayout(VIEWPORT, ['rematch', 'menu']);
    expect(victory.rule.height).toBe(ROW_BAR_WIDTH);
    expect(victory.rule.width).toBeGreaterThan(0);
    // …and it sits between the result and the line that names the victor in words,
    // so the fact is carried twice and the colour is never the only carrier.
    expect(victory.rule.y).toBeGreaterThanOrEqual(victory.headline.y + victory.headline.height);
    expect(victory.subhead.y).toBeGreaterThanOrEqual(victory.rule.y + victory.rule.height);
  });

  it('keeps the four results reporting exactly what they reported', () => {
    // The re-skin is not allowed to change a word or a button. Pinned here so a
    // later material pass cannot quietly edit the screen's content.
    //
    // l2-02, then a0-108: these words have been deliberately re-worded twice by
    // copy rulings, which is the one thing this pin does NOT guard against. Its
    // intent survives both and is re-pinned on the shipped words — a material
    // pass still cannot touch them, and what the subhead has to carry is
    // asserted above, on `subheadFor()`.
    expect(endOfMatchModel(over(1, 1)).headline).toBe('VICTORY');
    expect(endOfMatchModel(over(1, 2)).headline).toBe('DEFEAT');
    expect(endOfMatchModel(over(1, null)).headline).toBe('DRAW');
    expect(endOfMatchModel(eliminated(1)).headline).toBe('ELIMINATED');
    expect(endOfMatchModel(over(1, 2)).subhead).toBe('Player 3 won.');
  });

  it('signs the beam with the front door\'s own tag rather than new copy', () => {
    // The header beam wanted a standing tag and this screen is the one a brief
    // tells you not to add words to, so it reuses the authority the main menu
    // already prints, character for character.
    expect(endOfMatchModel(over(0, 0)).eyebrow).toBe(MAIN_MENU_EYEBROW);
  });

  it('carries the handoff\'s own numbers on the desktop it was drawn at', () => {
    const layout = endOfMatchLayout(VIEWPORT, ['rematch', 'menu']);
    expect(layout.metrics.margin).toBe(BEAM.margin); // 44
    expect(layout.header.height).toBe(BEAM.height); // 92
    expect(layout.buttons[0]!.height).toBe(PLATE_SCALES.hero.height); // 80
    expect(layout.buttons[1]!.height).toBe(PLATE_SCALES.standard.height); // 72
  });

  it('takes a press to rest → press, and a hover to rest → hover', () => {
    const pressed = endOfMatchModel(over(0, 1), { hover: 'rematch', press: 'rematch' });
    expect(pressed.buttons[0]!.state).toBe('press');
    expect(pressed.buttons[1]!.state).toBe('rest');
    expect(endOfMatchModel(over(0, 1), { hover: 'menu' }).buttons[1]!.state).toBe('hover');
  });

  describe('on a phone — the screen a match ends on, held either way', () => {
    for (const [name, vp] of [
      ['iPhone, 844×390 logical', { width: 844, height: 390 }],
      ['Pixel, 915×412 logical', { width: 915, height: 412 }],
    ] as const) {
      it(`${name}: both plates clear the 48px thumb floor`, () => {
        for (const ids of [['rematch', 'menu'], ['rematch', 'spectate']] as const) {
          const layout = endOfMatchLayout(vp, ids, { isTouch: true });
          for (const r of layout.buttons) expect(r.height).toBeGreaterThanOrEqual(TOUCH_MIN);
        }
      });

      it(`${name}: the result still has a band to sit in above them`, () => {
        // The plates are laid out FIRST and the result takes what is left, so the
        // squeeze lands on the result's air rather than on the buttons' height —
        // and the result is never squeezed out of existence.
        const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { isTouch: true });
        expect(layout.headline.height).toBeGreaterThan(0);
        expect(layout.subhead.height).toBeGreaterThan(0);
        const last = layout.buttons[1]!;
        expect(layout.subhead.y + layout.subhead.height).toBeLessThanOrEqual(layout.buttons[0]!.y + 0.001);
        expect(last.y + last.height).toBeLessThanOrEqual(layout.footer.y + 0.001);
      });
    }
  });

  it('yields zero-extent rects on a viewport with no room, never backwards ones', () => {
    for (const vp of [{ width: 4, height: 4 }, { width: 0, height: 0 }]) {
      const layout = endOfMatchLayout(vp, ['rematch', 'menu']);
      const rects = [layout.header, layout.footer, layout.content, layout.title, layout.headline, layout.rule, layout.subhead, ...layout.buttons];
      for (const r of rects) {
        expect(r.width).toBeGreaterThanOrEqual(0);
        expect(r.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// pr-05 — the summary block, and plan §6.4 rule 4: it FITS, at 390px, no scroll
// ---------------------------------------------------------------------------

describe('the summary block', () => {
  const ROWS = 7; // the plan's seven visible rows (§6.2)
  const rectsOf = (layout: ReturnType<typeof endOfMatchLayout>): { name: string; r: { x: number; y: number; width: number; height: number } }[] => {
    const s = layout.summary!;
    return [
      { name: 'headline', r: layout.headline },
      { name: 'rule', r: layout.rule },
      { name: 'subhead', r: layout.subhead },
      { name: 'matchTime', r: layout.matchTime },
      ...s.rows.map((r, i) => ({ name: `row ${i}`, r })),
      { name: 'xpTotal', r: s.xpTotal },
      { name: 'levelLabel', r: s.levelLabel },
      { name: 'bar', r: s.bar },
      { name: 'progress', r: s.progress },
      ...layout.buttons.map((r, i) => ({ name: `button ${i}`, r })),
    ];
  };

  it('is ABSENT unless the screen asks for it — the DEFEATED overlay is untouched', () => {
    // XP is never shown *in* a match (plan §Q2, Trap 14), and the elimination
    // overlay is shown while the others fight on. So it asks for no summary, and
    // its layout is the one a0-09 shipped, to the pixel.
    const bare = endOfMatchLayout(VIEWPORT, ['rematch', 'spectate']);
    expect(bare.summary).toBeNull();
    expect(bare.matchTime.height).toBe(0);
    const withSummary = endOfMatchLayout(VIEWPORT, ['rematch', 'menu'], { summaryRows: ROWS });
    expect(withSummary.summary).not.toBeNull();
    expect(withSummary.matchTime.height).toBeGreaterThan(0);
  });

  for (const [name, vp] of [
    ['portrait phone, 390×844', { width: 390, height: 844 }],
    ['landscape phone, 844×390', { width: 844, height: 390 }],
    ['the desktop control, 1280×800', { width: 1280, height: 800 }],
    ['the reference, 1280×720', { width: 1280, height: 720 }],
  ] as const) {
    it(`${name}: places every element inside the viewport, safe areas included`, () => {
      const insets = { top: 24, bottom: 20, left: 12, right: 12 };
      const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { isTouch: true, insets, summaryRows: ROWS });
      for (const { name: what, r } of rectsOf(layout)) {
        expect(r.width, `${what} width`).toBeGreaterThanOrEqual(0);
        expect(r.height, `${what} height`).toBeGreaterThanOrEqual(0);
        expect(r.x, `${what} left`).toBeGreaterThanOrEqual(insets.left - 0.001);
        expect(r.y, `${what} top`).toBeGreaterThanOrEqual(insets.top - 0.001);
        expect(r.x + r.width, `${what} right`).toBeLessThanOrEqual(vp.width - insets.right + 0.001);
        expect(r.y + r.height, `${what} bottom`).toBeLessThanOrEqual(vp.height - insets.bottom + 0.001);
      }
    });

    it(`${name}: draws all seven rows, in order, without overlapping`, () => {
      const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { isTouch: true, summaryRows: ROWS });
      const rows = layout.summary!.rows;
      expect(rows.length).toBe(ROWS);
      for (const r of rows) expect(r.height).toBeGreaterThan(0);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.y, `row ${i} under row ${i - 1}`).toBeGreaterThanOrEqual(
          rows[i - 1]!.y + rows[i - 1]!.height - 0.001,
        );
      }
      // …and the bar is under the total, which is under the last row.
      const s = layout.summary!;
      expect(s.xpTotal.y).toBeGreaterThanOrEqual(rows[ROWS - 1]!.y + rows[ROWS - 1]!.height - 0.001);
      expect(s.bar.y).toBeGreaterThanOrEqual(s.levelLabel.y + s.levelLabel.height - 0.001);
      expect(s.progress.y).toBeGreaterThanOrEqual(s.bar.y + s.bar.height - 0.001);
      expect(s.bar.height).toBeGreaterThan(0);
    });

    it(`${name}: keeps both plates over the 48px thumb floor with the sheet on screen`, () => {
      const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { isTouch: true, summaryRows: ROWS });
      for (const r of layout.buttons) expect(r.height).toBeGreaterThanOrEqual(TOUCH_MIN);
      for (const r of layout.buttons) expect(r.width).toBeGreaterThan(0);
    });
  }

  it('SPLITS the band when the screen is too short to stack, and stacks when it is not', () => {
    // The rule is measured height, not a device string: a landscape phone has
    // ~106px under the plates, which is not seven rows at any type size.
    expect(endOfMatchLayout({ width: 844, height: 390 }, ['rematch', 'menu'], { summaryRows: 7 }).summary!.mode)
      .toBe('split');
    expect(endOfMatchLayout({ width: 390, height: 844 }, ['rematch', 'menu'], { summaryRows: 7 }).summary!.mode)
      .toBe('stacked');
  });

  it('never lets the sheet collide with the result or the actions', () => {
    for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { summaryRows: 7 });
      const s = layout.summary!;
      const first = s.rows[0]!;
      const last = layout.buttons[layout.buttons.length - 1]!;
      if (s.mode === 'stacked') {
        expect(first.y).toBeGreaterThanOrEqual(layout.matchTime.y + layout.matchTime.height - 0.001);
        expect(s.progress.y + s.progress.height).toBeLessThanOrEqual(layout.buttons[0]!.y + 0.001);
      } else {
        // Two columns: the sheet starts to the right of everything on the left.
        expect(first.x).toBeGreaterThanOrEqual(layout.headline.x + layout.headline.width - 0.001);
        expect(first.x).toBeGreaterThanOrEqual(last.x + last.width - 0.001);
      }
    }
  });

  it('yields zero-extent rects on a viewport with no room, never backwards ones', () => {
    for (const vp of [{ width: 4, height: 4 }, { width: 0, height: 0 }]) {
      const layout = endOfMatchLayout(vp, ['rematch', 'menu'], { summaryRows: 7 });
      for (const { name, r } of rectsOf(layout)) {
        expect(r.width, `${name} width`).toBeGreaterThanOrEqual(0);
        expect(r.height, `${name} height`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
