/**
 * src/ui/end-of-match.test.ts — the summary, headless.
 *
 * The one rule that matters most — spectate is offered only while a match is
 * still live for others — is a pure function of the outcome, and is asserted
 * here for all four ends.
 */

import { describe, it, expect } from 'vitest';
import { playerColor } from './planet-hp';
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
    expect(endButtons(over(0, 0))).toEqual(['rematch']);
    expect(endButtons(over(0, 3))).toEqual(['rematch']);
    expect(endButtons(over(0, null))).toEqual(['rematch']);
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
});

describe('layout and hit test', () => {
  it('routes a tap on each button to its id, in model order', () => {
    const model = endOfMatchModel(eliminated(0));
    const ids = model.buttons.map((b) => b.id) as EndButton[];
    const layout = endOfMatchLayout(VIEWPORT, ids.length);
    expect(layout.buttons).toHaveLength(2);

    layout.buttons.forEach((rect, i) => {
      const p = center(rect);
      expect(endOfMatchHitTest(layout, p.x, p.y, ids)).toEqual({ kind: ids[i] });
    });
  });

  it('lays a single Rematch button out when the match is fully over', () => {
    const layout = endOfMatchLayout(VIEWPORT, 1);
    expect(layout.buttons).toHaveLength(1);
    const p = center(layout.buttons[0]!);
    expect(endOfMatchHitTest(layout, p.x, p.y, ['rematch'])).toEqual({ kind: 'rematch' });
  });

  it('keeps the headline above the buttons and both inside the content box', () => {
    const layout = endOfMatchLayout(VIEWPORT, 2);
    expect(layout.headline.y).toBeGreaterThanOrEqual(layout.content.y);
    for (const b of layout.buttons) {
      expect(b.y).toBeGreaterThanOrEqual(layout.subhead.y + layout.subhead.height - 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(layout.content.y + layout.content.height + 0.5);
    }
  });

  it('returns null off every button', () => {
    const layout = endOfMatchLayout(VIEWPORT, 2);
    expect(endOfMatchHitTest(layout, 5000, 5000, ['rematch', 'spectate'])).toBeNull();
  });
});
