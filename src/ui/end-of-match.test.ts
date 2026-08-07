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
} from './end-of-match';
import type { EndButton, MatchOutcome } from './end-of-match';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

const over = (you: number, winner: number | null): MatchOutcome => ({ you, winner, matchOver: true });
const eliminated = (you: number): MatchOutcome => ({ you, winner: null, matchOver: false });

describe('reading an outcome', () => {
  it('names victory, defeat, draw and elimination', () => {
    expect(endKind(over(2, 2))).toBe('victory');
    expect(endKind(over(2, 5))).toBe('defeat');
    expect(endKind(over(2, null))).toBe('draw');
    expect(endKind(eliminated(2))).toBe('eliminated');
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
    expect(victory.buttons[0]).toMatchObject({ id: 'rematch', primary: true });

    const elim = endOfMatchModel(eliminated(1));
    expect(elim.headline).toBe('ELIMINATED');
    expect(elim.buttons.map((b) => b.id)).toEqual(['rematch', 'spectate']);
    expect(elim.buttons[1]).toMatchObject({ id: 'spectate', primary: false });
  });

  it('accents victory with your colour and defeat with the victor’s', () => {
    expect(endOfMatchModel(over(3, 3)).accent).toBe(playerColor(3));
    expect(endOfMatchModel(over(3, 6)).accent).toBe(playerColor(6));
    // No one to colour on a draw or an elimination.
    expect(endOfMatchModel(over(3, null)).accent).toBeNull();
    expect(endOfMatchModel(eliminated(3)).accent).toBeNull();
  });

  it('names the victor in a defeat’s subhead, one-based', () => {
    expect(endOfMatchModel(over(0, 4)).subhead).toContain('Player 5');
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
    expect(endOfMatchModel(over(1, 1)).headline).toBe('VICTORY');
    expect(endOfMatchModel(over(1, 2)).headline).toBe('DEFEAT');
    expect(endOfMatchModel(over(1, null)).headline).toBe('DRAW');
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
