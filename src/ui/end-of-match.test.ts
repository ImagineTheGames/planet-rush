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
   * that won..."* The screen read DEFEAT over *"Player 7 took the claim."* and
   * Player 7 was their teammate.
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
    expect(victory.headline).toBe('CLAIM HELD');
    expect(endOfMatchModel(over(2, 5)).headline).toBe('CLAIM LOST');
    expect(endOfMatchModel(over(2, null)).headline).toBe('NO CLAIMANT');
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
   * and *"Player 7 took the claim."* was the wrong sentence under it — that is an
   * opponent's line, printed about a friend. An ally's win gets its own: your
   * side took the claim, and here is who held it.
   */
  it('reads an ally’s win as YOUR SIDE taking the claim, and names who held it', () => {
    const allyWon = endOfMatchModel(teamOver(0, 7, MY_SIDE));
    expect(allyWon.headline).toBe('CLAIM HELD');
    expect(allyWon.subhead).toBe('Your side took the claim — Player 8 held it.');
    // It is never the opponent's sentence…
    expect(allyWon.subhead).not.toBe('Player 8 took the claim.');
    // …and never claims YOU held a claim your teammate held.
    expect(allyWon.subhead).not.toBe('You took the claim.');

    // Your own win is untouched — no "your side" hedge on a solo hold.
    expect(endOfMatchModel(teamOver(0, 0, MY_SIDE)).subhead).toBe('You took the claim.');
    // And an enemy's win keeps the line it always had.
    expect(endOfMatchModel(teamOver(0, 1, MY_SIDE)).subhead).toBe('Player 2 took the claim.');
  });

  /**
   * The condition on the in-register headlines, not a nicety. GDD §4.7's
   * accessibility clause permits `CLAIM HELD` / `CLAIM LOST` / `NO CLAIMANT`
   * **only** while the line underneath states the outcome plainly — the headline
   * may never be the sole statement of who won. If a refactor empties
   * `subheadFor()`, this fails and the headlines must revert to plain words
   * rather than the screen shipping an outcome the player has to infer.
   */
  it('never lets an in-register headline be the only statement of the outcome', () => {
    const victory = endOfMatchModel(over(1, 1));
    expect(victory.headline).toBe('CLAIM HELD');
    expect(victory.subhead).toBe('You took the claim.');

    const defeat = endOfMatchModel(over(1, 4));
    expect(defeat.headline).toBe('CLAIM LOST');
    // Says who took it — the loss is stated, not left to the headline's colour.
    expect(defeat.subhead).toContain('took the claim');
    expect(defeat.subhead).toContain('Player 5');

    // An ally's win is the newest headline/line pair (a0-09) and it obeys the
    // same clause: strip `CLAIM HELD` and the sentence still says who won and
    // that they were on your side.
    const allied = endOfMatchModel(teamOver(0, 7, MY_SIDE));
    expect(allied.headline).toBe('CLAIM HELD');
    expect(allied.subhead).toContain('Your side');
    expect(allied.subhead).toContain('took the claim');
    expect(allied.subhead).toContain('Player 8');

    // The draw's plain line names the outcome without the fiction word, which is
    // the clause working as written: strip "NO CLAIMANT" and the meaning survives.
    const draw = endOfMatchModel(over(1, null));
    expect(draw.headline).toBe('NO CLAIMANT');
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
    expect(endOfMatchModel(eliminated(0)).subhead).toBe('Your reactor is gone — but the fight goes on.');
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
    // l2-02: the three in-register headlines were re-worded by the ratified voice
    // sweep (§4.7) — a deliberate copy change, which is the one thing this pin does
    // NOT guard against. Its intent is intact and re-pinned on the new words: a
    // material pass still cannot touch them, and the accessibility condition that
    // makes them legal is asserted above, on `subheadFor()`.
    expect(endOfMatchModel(over(1, 1)).headline).toBe('CLAIM HELD');
    expect(endOfMatchModel(over(1, 2)).headline).toBe('CLAIM LOST');
    expect(endOfMatchModel(over(1, null)).headline).toBe('NO CLAIMANT');
    expect(endOfMatchModel(eliminated(1)).headline).toBe('ELIMINATED');
    expect(endOfMatchModel(over(1, 2)).subhead).toBe('Player 3 took the claim.');
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
