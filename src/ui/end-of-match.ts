/**
 * src/ui/end-of-match.ts — the summary a match ends on. OWNER: UI Engineer.
 *
 * Two ways a player's match can end (GDD §2.2, §2 wreck rule, §4.7 degrade path):
 *
 *   The whole match resolves — one core left standing, or none. The server says
 *   so with `matchEnd` (`src/net/transport.ts`), naming the `winner` (or `null`
 *   on the degenerate no-survivor case). Everyone sees VICTORY, DEFEAT or DRAW,
 *   and the one button that matters is **Rematch** (GDD §4.7: the summary reduces
 *   to a plain winner screen, and the Rematch button *stays*).
 *
 *   *You* are eliminated but the match goes on — your core is destroyed, your
 *   wreck is now ore for the living to scavenge, and the other planets fight on
 *   (GDD §2 "when a planet's core is destroyed … an immediate Rematch button plus
 *   spectate if they want to watch"). You get Rematch **and Spectate**, because
 *   there is still a match to watch.
 *
 * Spectate is offered on exactly the second case: a whole-match-over screen has
 * nothing live left to spectate. That single rule — `spectate ⟺ !matchOver` — is
 * the whole difference between the two summaries, and it is asserted headless.
 *
 * Pure and DOM-free: this derives the words and the buttons from a plain
 * {@link MatchOutcome}; {@link endOfMatchLayout} places them and
 * `./end-of-match-view` draws them.
 */

import type { PlayerId } from '@shared/types';
import type { Rect, Viewport } from '@platform/layout-registry';
import { playerColor } from './planet-hp';
import { centeredColumn, hitRect, menuContent } from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The outcome, and what it means for you
// ---------------------------------------------------------------------------

/** How a match ended, from one player's seat. */
export interface MatchOutcome {
  /** The seat reading this summary — whose victory or defeat it is. */
  readonly you: PlayerId;
  /** The surviving winner, or `null` for a draw / no-survivor end. Only
   *  meaningful when {@link matchOver} — an elimination has no winner yet. */
  readonly winner: PlayerId | null;
  /** `true`: the whole match is over. `false`: you were eliminated and the
   *  others fight on — the case that still has something to spectate. */
  readonly matchOver: boolean;
}

/** What the summary says happened. */
export type EndKind = 'victory' | 'defeat' | 'draw' | 'eliminated';

/** Read a raw outcome as one of the four things a player can be told. */
export function endKind(outcome: MatchOutcome): EndKind {
  if (!outcome.matchOver) return 'eliminated';
  if (outcome.winner === null) return 'draw';
  return outcome.winner === outcome.you ? 'victory' : 'defeat';
}

// ---------------------------------------------------------------------------
// The two buttons
// ---------------------------------------------------------------------------

/** The summary's actions. Rematch is always offered; spectate only while a match
 *  is still live for others to watch. */
export type EndButton = 'rematch' | 'spectate';

/** A tap on the summary. */
export type EndTarget = { readonly kind: EndButton };

const BUTTON_LABELS: Record<EndButton, string> = {
  rematch: 'REMATCH',
  spectate: 'SPECTATE',
};

/**
 * The buttons this outcome offers, in draw order (Rematch first — it is the one
 * a player reaches for and the one that always survives, GDD §4.7). Spectate is
 * appended only when the match is still running for others.
 */
export function endButtons(outcome: MatchOutcome): readonly EndButton[] {
  return outcome.matchOver ? ['rematch'] : ['rematch', 'spectate'];
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

export interface EndButtonView {
  readonly id: EndButton;
  readonly label: string;
  /** Rematch is the affirmative action and reads as plasma; spectate is chrome. */
  readonly primary: boolean;
}

export interface EndOfMatchModel {
  readonly kind: EndKind;
  /** VICTORY / DEFEAT / DRAW / ELIMINATED. */
  readonly headline: string;
  /** One line under it, in plain words. */
  readonly subhead: string;
  /** The winner's player colour, to accent a victory or name a defeat's victor;
   *  `null` on a draw or an elimination, where there is no one to colour. */
  readonly accent: number | null;
  readonly buttons: readonly EndButtonView[];
}

const HEADLINES: Record<EndKind, string> = {
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  draw: 'DRAW',
  eliminated: 'ELIMINATED',
};

/** Build the frame model — the words and the buttons for one outcome. */
export function endOfMatchModel(outcome: MatchOutcome): EndOfMatchModel {
  const kind = endKind(outcome);
  const buttons: EndButtonView[] = endButtons(outcome).map((id) => ({
    id,
    label: BUTTON_LABELS[id],
    primary: id === 'rematch',
  }));
  return {
    kind,
    headline: HEADLINES[kind],
    subhead: subheadFor(kind, outcome.winner),
    accent: accentFor(kind, outcome),
    buttons,
  };
}

function subheadFor(kind: EndKind, winner: PlayerId | null): string {
  switch (kind) {
    case 'victory':
      return 'You took the system.';
    case 'defeat':
      return `${playerLabel(winner)} took the system.`;
    case 'draw':
      return 'No core survived the collapse.';
    case 'eliminated':
      return 'Your core is gone — but the fight goes on.';
  }
}

function accentFor(kind: EndKind, outcome: MatchOutcome): number | null {
  if (kind === 'victory') return playerColor(outcome.you);
  if (kind === 'defeat' && outcome.winner !== null) return playerColor(outcome.winner);
  return null;
}

/** A player as a person, not a number: "Player 3", one-based, the way the roster
 *  numbers seats for a human reading them (GDD §5.2). */
function playerLabel(player: PlayerId | null): string {
  return player === null ? 'No one' : `Player ${player + 1}`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const END_HEADLINE_HEIGHT = 72;
export const END_SUBHEAD_HEIGHT = 28;
export const END_BUTTON_HEIGHT = 52;
export const END_BUTTON_HEIGHT_TOUCH = 60;
export const END_BUTTON_WIDTH_MAX = 320;

export interface EndOfMatchLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

export interface EndOfMatchLayout {
  readonly content: Rect;
  readonly headline: Rect;
  readonly subhead: Rect;
  /** One rect per button, in the model's button order. */
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
}

/**
 * Lay the summary out: the headline and its line sit in the upper half, the
 * buttons stack at the bottom. `buttonCount` is passed rather than a model so the
 * geometry stays pure — one or two buttons, placed the same way.
 */
export function endOfMatchLayout(
  viewport: Viewport,
  buttonCount: number,
  options: EndOfMatchLayoutOptions = {},
): EndOfMatchLayout {
  const isTouch = options.isTouch ?? false;
  const content = menuContent(viewport, options.insets);

  const headlineHeight = Math.min(END_HEADLINE_HEIGHT, content.height);
  const subheadHeight = Math.min(END_SUBHEAD_HEIGHT, Math.max(0, content.height - headlineHeight));
  // The headline block sits a little above centre, so the eye lands on the
  // result and travels down to the buttons rather than starting on them.
  const blockTop = content.y + Math.max(0, content.height * 0.28 - headlineHeight / 2);
  const headline: Rect = { x: content.x, y: blockTop, width: content.width, height: headlineHeight };
  const subhead: Rect = {
    x: content.x,
    y: headline.y + headlineHeight,
    width: content.width,
    height: subheadHeight,
  };

  const rowHeight = isTouch ? END_BUTTON_HEIGHT_TOUCH : END_BUTTON_HEIGHT;
  // The button stack lives in the bottom third, clear of the subhead.
  const stackTop = Math.max(subhead.y + subheadHeight, content.y + content.height * 0.62);
  const band: Rect = {
    x: content.x,
    y: stackTop,
    width: content.width,
    height: Math.max(0, content.y + content.height - stackTop),
  };
  const buttons = centeredColumn(band, Math.max(0, buttonCount), END_BUTTON_WIDTH_MAX, rowHeight);

  return { content, headline, subhead, buttons, isTouch };
}

/**
 * The button a tap hit, or `null`. `buttonIds` is the model's button order, so
 * rect `i` is button `buttonIds[i]` — the same index-mapping the door and the
 * lobby use, which keeps the drawn button and the routed button the same one.
 */
export function endOfMatchHitTest(
  layout: EndOfMatchLayout,
  x: number,
  y: number,
  buttonIds: readonly EndButton[],
): EndTarget | null {
  for (let i = 0; i < layout.buttons.length; i++) {
    const rect = layout.buttons[i];
    const id = buttonIds[i];
    if (rect && id && hitRect(rect, x, y)) return { kind: id };
  }
  return null;
}

/** The summary's layout-registry id and anchor: it owns the screen. */
export const END_OF_MATCH_ID = 'end-of-match';
