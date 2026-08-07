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
 *   wreck is now ore for the living to scavenge, and the other stations fight on
 *   (GDD §2 "when a station's core is destroyed … an immediate Rematch button plus
 *   spectate if they want to watch"). You get Rematch **and Spectate**, because
 *   there is still a match to watch.
 *
 * Spectate is offered on exactly the second case: a whole-match-over screen has
 * nothing live left to spectate. That single rule — `spectate ⟺ !matchOver` — is
 * the whole difference between the two summaries, and it is asserted headless.
 *
 * ── GANTRY / BONE, AND THE ACHE (u7-05) ─────────────────────────────────────
 * This is the screen a player stares at longest, and the one screen in the game
 * that carries the tone contract's planet-death beat (GDD §4.7 — *"when a station
 * dies, the game goes briefly quiet … nobody jokes for three seconds"*). So it is
 * made of the same material as every other screen, and of nothing else: beams, a
 * result set in the band, and two plates. No celebration, no fireworks, no fill
 * of colour — the restraint is the treatment.
 *
 * **REMATCH is the one bright plate.** GDD §4.7 makes Rematch the button that
 * always survives, §2.7 makes it the thing offered *immediately* on a death, and
 * a screen a player sits on needs its way forward to be unmistakable. The
 * alternative on each variant is a way *out* (BACK TO MENU) or a way to keep
 * watching (SPECTATE), and neither is the action the design ratified.
 *
 * Pure and DOM-free: this derives the words and the buttons from a plain
 * {@link MatchOutcome}; {@link endOfMatchLayout} places them and
 * `./end-of-match-view` draws them.
 */

import type { PlayerId } from '@shared/types';
import type { Rect, Viewport } from '@platform/layout-registry';
import { COLUMN, ROW_BAR_WIDTH, plateHeight } from '../art/materials';
import type { FrameMetrics, PlateRole, PlateScale, PlateState } from '../art/materials';
import { beamContent, gantryFrame, stackPlates } from './gantry';
import { MAIN_MENU_EYEBROW } from './main-menu';
import { playerColor } from './station-hp';
import { hitRect } from './menu-geometry';
import type { Insets } from './menu-geometry';

// ---------------------------------------------------------------------------
// The outcome, and what it means for you
// ---------------------------------------------------------------------------

/** How a core fell — the DEFEATED overlay's cause line (field report v0.1.2).
 *  The sim does not attribute a killing blow, so this is the coarse truth it
 *  *does* know: a rival finished you (`destroyed`) or the field's collapse did
 *  (`collapse`). Left off when the seat that built the outcome can't say. */
export type DeathCause = 'destroyed' | 'collapse';

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
  /** 1-based finishing place on an elimination — the "6th" of "6th of 8" (field
   *  report v0.1.2). First core to fall places last; the lone survivor is 1st.
   *  Omitted (and the placement line dropped) when the wiring didn't supply it. */
  readonly placement?: number;
  /** How many seats the match started with — the "8" of "6th of 8". */
  readonly totalPlayers?: number;
  /** Why your core fell, for the DEFEATED overlay's cause line. */
  readonly cause?: DeathCause;
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

/** The summary's actions. Rematch is always offered. Spectate rides only the
 *  elimination case (a match still live for others); BACK TO MENU rides only the
 *  whole-match-over case (nothing left to watch — field report v0.1.2). */
export type EndButton = 'rematch' | 'spectate' | 'menu';

/** A tap on the summary. */
export type EndTarget = { readonly kind: EndButton };

const BUTTON_LABELS: Record<EndButton, string> = {
  rematch: 'REMATCH',
  spectate: 'SPECTATE',
  menu: 'BACK TO MENU',
};

/**
 * The buttons this outcome offers, in draw order (Rematch first — it is the one
 * a player reaches for and the one that always survives, GDD §4.7). The second
 * button is the one that fits the moment: **spectate** while you are eliminated
 * but the others fight on, **back to menu** once the whole match is over and
 * there is nothing left to spectate.
 */
export function endButtons(outcome: MatchOutcome): readonly EndButton[] {
  return outcome.matchOver ? ['rematch', 'menu'] : ['rematch', 'spectate'];
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/**
 * The plate a button is drawn as. REMATCH is the `primary` `hero` plate — the
 * brightest and the largest, which is the whole of what Bone has to mark an
 * action with — and SPECTATE / BACK TO MENU are `secondary` `standard` plates:
 * fully active steel, never the greyed-out costume the field report caught.
 */
export function endButtonPlate(id: EndButton): { role: PlateRole; scale: PlateScale } {
  return id === 'rematch'
    ? { role: 'primary', scale: 'hero' }
    : { role: 'secondary', scale: 'standard' };
}

export interface EndButtonView {
  readonly id: EndButton;
  readonly label: string;
  /** Rematch is the affirmative action — under Gantry/Bone the brightest plate
   *  rather than the plasma one; spectate and the menu are chrome. */
  readonly primary: boolean;
  readonly role: PlateRole;
  readonly scale: PlateScale;
  /** Rest / hover / press — the handoff's three plate states, driven by the
   *  wiring layer's pointer routing (`src/main.ts`). Touch never hovers. */
  readonly state: PlateState;
}

/** What the pointer is doing on the summary: which button it is over, and which
 *  (if any) it is holding down. */
export interface EndPointer {
  readonly hover?: EndButton | null;
  readonly press?: EndButton | null;
}

/**
 * The standing tag in the header beam.
 *
 * **Not new copy** — it is the front door's own eyebrow, character for character
 * ({@link ./main-menu} `MAIN_MENU_EYEBROW`), so the screen that files the result
 * is signed by the same authority that issued the contract. The beam wanted a tag
 * and the alternative was inventing a sentence for the one screen a brief tells
 * you not to add words to.
 */
export const END_OF_MATCH_EYEBROW = MAIN_MENU_EYEBROW;

export interface EndOfMatchModel {
  readonly kind: EndKind;
  /** The standing authority tag in the header beam. */
  readonly eyebrow: string;
  /** VICTORY / DEFEAT / DRAW / ELIMINATED. */
  readonly headline: string;
  /** One line under it, in plain words. */
  readonly subhead: string;
  /**
   * The winner's player colour; `null` on a draw or an elimination, where there
   * is no one to colour.
   *
   * Under Gantry/Bone this no longer *letters* the result. It is drawn as the
   * 4px identity rule between the headline and its line — {@link ../art/materials}
   * `ROW_BAR_WIDTH`, the one place this direction puts an identity colour ("never
   * as a background wash — that was making identity read as chrome"). The screen
   * still reports exactly who took the claim: the rule says it in colour, the line
   * under it says it in words.
   */
  readonly accent: number | null;
  readonly buttons: readonly EndButtonView[];
}

const HEADLINES: Record<EndKind, string> = {
  victory: 'VICTORY',
  defeat: 'DEFEAT',
  draw: 'DRAW',
  eliminated: 'ELIMINATED',
};

/**
 * Build the frame model — the words and the buttons for one outcome. A press
 * outranks a hover on the same plate (a finger that is down is not hovering), and
 * a plate that is neither is at rest.
 */
export function endOfMatchModel(outcome: MatchOutcome, pointer: EndPointer = {}): EndOfMatchModel {
  const kind = endKind(outcome);
  const buttons: EndButtonView[] = endButtons(outcome).map((id) => {
    const { role, scale } = endButtonPlate(id);
    return {
      id,
      label: BUTTON_LABELS[id],
      primary: id === 'rematch',
      role,
      scale,
      state: (pointer.press === id ? 'press' : pointer.hover === id ? 'hover' : 'rest') as PlateState,
    };
  });
  return {
    kind,
    eyebrow: END_OF_MATCH_EYEBROW,
    headline: HEADLINES[kind],
    subhead: subheadFor(kind, outcome),
    accent: accentFor(kind, outcome),
    buttons,
  };
}

function subheadFor(kind: EndKind, outcome: MatchOutcome): string {
  switch (kind) {
    case 'victory':
      return 'You took the claim.';
    case 'defeat':
      return `${playerLabel(outcome.winner)} took the claim.`;
    case 'draw':
      return 'No reactor survived the collapse.';
    case 'eliminated':
      return eliminatedSubhead(outcome);
  }
}

/**
 * The DEFEATED overlay's line — the two things the field report asked for:
 * *placement* ("6th of 8") and *cause of death* ("your core was destroyed").
 * Both are optional, so this degrades cleanly: placement alone, cause alone, or
 * the plain fallback the pure model shipped with, in that order.
 */
function eliminatedSubhead(outcome: MatchOutcome): string {
  const place =
    outcome.placement && outcome.totalPlayers
      ? `${ordinal(outcome.placement)} of ${outcome.totalPlayers}`
      : null;
  const cause = causePhrase(outcome.cause);
  if (place && cause) return `${place} — ${cause}`;
  if (place) return place;
  if (cause) return capitalize(cause);
  return 'Your reactor is gone — but the fight goes on.';
}

/** The cause half of the elimination line, lower-case so it reads as the tail of
 *  "6th of 8 — …"; capitalised by {@link eliminatedSubhead} when it stands alone. */
function causePhrase(cause: DeathCause | undefined): string | null {
  switch (cause) {
    case 'destroyed':
      return 'your reactor was destroyed.';
    case 'collapse':
      return 'the collapse closed over your reactor.';
    default:
      return null;
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** "1st", "2nd", "3rd", "6th" — English ordinal for the placement line. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
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

/** The result's own strip, at the 1280×720 reference — the block the headline is
 *  set in. Scales with the frame like every other chrome metric. */
export const END_HEADLINE_HEIGHT = 72;
/** The line under the result, at the reference. */
export const END_SUBHEAD_HEIGHT = 28;
/** The identity rule's width at the reference: a short bar, not a divider across
 *  the screen — it marks a player, and a player is not a section break. */
export const END_RULE_WIDTH = 200;
/** Air above and below the identity rule, at the reference. */
export const END_RULE_GAP = 14;

export interface EndOfMatchLayoutOptions {
  readonly isTouch?: boolean;
  readonly insets?: Insets;
}

export interface EndOfMatchLayout {
  readonly content: Rect;
  /** The header beam, full width inside the safe area. */
  readonly header: Rect;
  /** The footer beam. */
  readonly footer: Rect;
  /** The strip inside the header beam the standing authority tag sits in. */
  readonly title: Rect;
  /** The result word's own block, centred in what the plates leave of the band. */
  readonly headline: Rect;
  /** The 4px identity rule under it — zero-extent when there is no one to mark. */
  readonly rule: Rect;
  /** The line under the rule. */
  readonly subhead: Rect;
  /** One rect per button, in the model's button order. */
  readonly buttons: readonly Rect[];
  readonly isTouch: boolean;
  readonly metrics: FrameMetrics;
}

/**
 * Lay the summary out for a viewport.
 *
 * The composition is the one that shipped — the result in the upper band, the
 * actions stacked below it — rebuilt on the frame every other screen uses
 * ({@link ./gantry} `gantryFrame`). The plates are laid out FIRST, bottom-anchored
 * at their own heights, and the result takes whatever band is left: on a
 * 390px-tall phone that is the difference between a result with room to breathe
 * and two buttons squeezed under it, and a stack that has quietly walked off the
 * bottom edge.
 *
 * `buttonIds` rather than a count, because REMATCH is a `hero` plate and its
 * companion is a `standard` one ({@link endButtonPlate}) — size is half of what
 * marks the primary, and a count cannot say which is which.
 */
export function endOfMatchLayout(
  viewport: Viewport,
  buttonIds: readonly EndButton[],
  options: EndOfMatchLayoutOptions = {},
): EndOfMatchLayout {
  const isTouch = options.isTouch ?? false;
  const frame = gantryFrame(viewport, options.insets);
  const m = frame.metrics;
  const band = frame.band;

  const title = beamContent(frame.header, m);

  // The plates, bottom-anchored in the band at their own heights.
  const columnWidth = Math.min(COLUMN.title, band.width);
  const heights = buttonIds.map((id) => plateHeight(endButtonPlate(id).scale, m));
  const stackHeight = Math.min(
    band.height,
    heights.reduce((a, b) => a + b, 0) + Math.max(0, heights.length - 1) * m.gap,
  );
  const stackBand: Rect = {
    x: band.x,
    y: band.y + band.height - stackHeight,
    width: band.width,
    height: stackHeight,
  };
  const buttons = stackPlates(stackBand, columnWidth, heights, m.gap);

  // …and the result, centred in what is left above them.
  const resultHeight = Math.max(0, band.height - stackHeight - m.gutter);
  const headlineHeight = Math.min(Math.round(END_HEADLINE_HEIGHT * m.scale), resultHeight);
  const ruleGap = Math.round(END_RULE_GAP * m.scale);
  const subheadHeight = Math.min(
    Math.round(END_SUBHEAD_HEIGHT * m.scale),
    Math.max(0, resultHeight - headlineHeight),
  );
  const ruleHeight = Math.min(ROW_BAR_WIDTH, Math.max(0, resultHeight - headlineHeight - subheadHeight));
  const ruleBlock = ruleHeight > 0 ? ruleHeight + ruleGap * 2 : 0;
  const blockHeight = headlineHeight + ruleBlock + subheadHeight;
  const blockTop = band.y + Math.max(0, (resultHeight - blockHeight) / 2);

  const headline: Rect = { x: band.x, y: blockTop, width: band.width, height: headlineHeight };
  const ruleWidth = Math.min(Math.round(END_RULE_WIDTH * m.scale), band.width);
  const rule: Rect = {
    x: band.x + (band.width - ruleWidth) / 2,
    y: headline.y + headlineHeight + ruleGap,
    width: ruleHeight > 0 ? ruleWidth : 0,
    height: ruleHeight,
  };
  const subhead: Rect = {
    x: band.x,
    y: headline.y + headlineHeight + ruleBlock,
    width: band.width,
    height: subheadHeight,
  };

  return {
    content: frame.content,
    header: frame.header,
    footer: frame.footer,
    title,
    headline,
    rule,
    subhead,
    buttons,
    isTouch,
    metrics: m,
  };
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
