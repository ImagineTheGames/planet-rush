/**
 * src/ui/log-offer.ts — WHERE THE DOWNLOAD LOG OFFER MAY STAND, in a match.
 * OWNER: UI Engineer (a0-98; a0-97's rule, generalised past pause).
 *
 * The affordance itself is `src/net/playtest-log-button` and it is one 44-px DOM
 * button, `position:fixed` in the bottom-right at `z-index:2147483647` — the
 * largest the platform has. Where it is drawn is not negotiable from here. What is
 * negotiable, and what this module decides, is **whether it is drawn at all**,
 * given what the match has put in that corner this frame.
 *
 * ── THE RULE, AND WHERE IT CAME FROM ────────────────────────────────────────
 * a0-97 found the affordance sitting on the settings screen's DONE plate and
 * withdrew it for every screen layered over pause ({@link pauseAllowsDownloadLog}).
 * That was its whole brief, and it said so. But the mechanism it documented — a DOM
 * button at the maximum z-index beats a canvas — has nothing to do with pause, and
 * the offer is raised from four places. The one a0-97 never had to look at is the
 * one that can arrive on any screen without being asked for:
 *
 *     const state = onlineSession?.state;
 *     if (state === 'reconnecting' || state === 'closed') { showDownloadLog(…); }
 *
 * That branch sits BELOW the pause guard and ABOVE the pause check, so it fires
 * with the overlay CLOSED — which is where a player flying a match actually is.
 * A networked match is never pausable (`shouldFreezeSim`), so "the overlay is
 * closed" is the normal state of an online match from RUSH! to the last shot.
 *
 * Measured on the built bundle, against a real allocator and a real match server,
 * with the wire really cut: on a 798x384 phone the offer's box is x477-786 y290-372
 * and the minimap's is x586-666 y292-372 — **the map is 100% under the offer**.
 * `document.elementFromPoint` at the minimap's own reported centre (626,332)
 * answers `BUTTON#playtest-download-log-button`, and a real tap there did not
 * toggle the map: it downloaded `planet-rush-log-17d1979-…json`. A thumb reaching
 * for the map got a JSON file
 * (`evidence/a0-98-corner-collisions-everywhere-else`, `phone-798x384-press-proof.json`).
 *
 * On a 1280x800 desktop the same drop is NOT a collision, and the offer is left
 * alone there: no fullscreen, so the kick-out card really is the screen, its two
 * buttons are centred and clear, and the offer sits in an empty corner doing its
 * job. That asymmetry is the whole reason {@link kickOutClaimsTheGlass} exists.
 *
 * ── WHY THIS IS A RESTORATION, NOT A NEW POLICY ─────────────────────────────
 * The affordance's own header already states the contract the disconnect branch
 * broke, in its own words: it *"appears only when a screen is already claiming the
 * display (pause, or an error) and hides the instant the match owns the screen
 * again"*, and *"Nothing here draws during play."* A dropped connection is not a
 * screen. The kick-out card that a dropped connection RAISES is
 * (`src/net/link-loss-view` — a full-bleed scrim with RECONNECT and ABANDON MATCH
 * on it), and so is the pause menu. So the rule is the one that was always written
 * down: **the corner belongs to the match while the match owns the glass.**
 *
 * The offer is never more than one press away from the player who needs it. ESC
 * (or the touch corner button) opens the pause menu on every match, online
 * included, and the offer is waiting there with the drop named on it. The
 * CONNECTION LOST card — which any real drop raises within
 * `src/net/link-loss` `SILENCE_FLOOR_MS` — carries it too. What a player filing
 * *"it kept dropping"* loses is nothing; what they get back is the map, and on a
 * touch build the thumb controls beside it.
 *
 * Pure and total: every state has an answer, and the answer is a value, so the
 * whole rule is asserted in node with no browser
 * (`src/net/playtest-log-button.test.ts`, *the offer never lands on a control the
 * player needs*).
 */

import type { PauseScreen } from './pause-menu';
import { isPauseOpen, pauseAllowsDownloadLog } from './pause-menu';

/**
 * Who owns the glass over a running match this frame — the one question that
 * decides whether the bottom-right corner is the match's or a screen's.
 *
 * `match` is the case the whole module exists for: the HUD is the screen, and the
 * bottom-right corner of it is the minimap (GDD §2.2) with, on touch, the aim
 * stick and FIRE beside it (`right-half-bottom`).
 */
export type MatchGlassOwner =
  /** Nothing is PAINTED over the HUD. The player is looking at the match. */
  | 'match'
  /** The CONNECTION LOST kick-out (`src/net/link-loss-view`) is painted over the
   *  game root: a full-bleed scrim that takes every press, raised by the same drop
   *  that raises the offer. **Painted**, not merely raised — see
   *  {@link kickOutClaimsTheGlass}. */
  | 'kicked-out';

/** The transport states `src/net/session` reports. `null` offline, where there is
 *  no session to lose. */
export type SessionLinkState = 'connecting' | 'open' | 'reconnecting' | 'closed' | null;

/** Everything the decision reads. Nothing here is a DOM fact. */
export interface MatchLogOfferState {
  /** The pause stack: `closed`, `menu`, or one of the screens layered on it. */
  readonly pauseScreen: PauseScreen;
  /** The session's transport state, or `null` offline. */
  readonly session: SessionLinkState;
  /** What is over the HUD besides the pause stack. */
  readonly glass: MatchGlassOwner;
}

/**
 * Why the offer would stand, or `null` for "not on this screen".
 *
 * `disconnect` and `pause` are kept apart because they say different words
 * (`src/net/playtest-log-button` `disconnectOfferHint` names what dropped; the
 * pause menu's offer is silent), and because a drop that happens while the menu is
 * up must still be the one that gets named.
 */
export type MatchLogOfferReason = 'pause' | 'disconnect' | null;

/**
 * Whether the CONNECTION LOST card is actually **on the glass**, given that it has
 * been raised.
 *
 * This is one function rather than a boolean at the call site because the answer
 * is not the obvious one, and a0-98 measured it rather than assuming it.
 *
 * The card is DOM appended to `body` — a SIBLING of the game root. On a touch boot
 * PLAY puts that root into the browser's **top layer** (`@platform/fullscreen`,
 * the landscape lock's other half), and the top layer is not a z-index: it paints
 * above every normal-flow box no matter what. So while the root is fullscreen the
 * card is laid out, un-hidden, and **painted under the canvas** — at
 * `RECONNECT NOW`'s own reported centre on a 798x384 touch boot,
 * `document.elementFromPoint` answers `CANVAS#app`, and the capture's frame shows
 * a live HUD with no card on it at all.
 *
 * That is exactly a0-28's mechanism, which this affordance already knows about
 * from the other side: `src/net/playtest-log-button` re-homes ITSELF into
 * `document.fullscreenElement` for this reason, which is why the offer is on top
 * in that frame and the card is not.
 *
 * So a kicked-out player on a phone is not looking at a screen — they are looking
 * at the match, with a diagnostic button on the map. The offer has to know the
 * difference. If the card is ever re-homed the way the affordance was, this
 * function is the one place that changes.
 */
export function kickOutClaimsTheGlass(cardIsUp: boolean, rootIsFullscreen: boolean): MatchGlassOwner {
  return cardIsUp && !rootIsFullscreen ? 'kicked-out' : 'match';
}

/** The two transport states a *"it kept dropping"* report is about. */
export function sessionHasDropped(session: SessionLinkState): boolean {
  return session === 'reconnecting' || session === 'closed';
}

/**
 * Whether a screen — rather than the match — is claiming the display, which is the
 * whole of the affordance's own stated precondition for existing.
 *
 * The pause menu counts and the screens layered over it do not: that is a0-97's
 * finding unchanged ({@link pauseAllowsDownloadLog}), and it composes here rather
 * than being restated. The pause overlay is drawn IN THE CANVAS, inside the game
 * root, so it claims the display on every platform — which is precisely what the
 * kick-out card does not do ({@link kickOutClaimsTheGlass}).
 */
export function screenClaimsTheDisplay(state: MatchLogOfferState): boolean {
  if (isPauseOpen(state.pauseScreen)) return pauseAllowsDownloadLog(state.pauseScreen);
  return state.glass === 'kicked-out';
}

/**
 * The decision. Total — every `(pauseScreen, session, glass)` triple has an
 * answer.
 *
 * Order matters and is the same order the wiring used before: the pause stack's
 * refusal comes first, because *"nothing is drawn over DONE"* is a property of the
 * screen and a dropped connection does not make it less true (a0-97). Then the
 * new clause: **if the match owns the glass, the corner is the match's.** Only
 * then does the drop get to name itself.
 */
export function matchLogOffer(state: MatchLogOfferState): MatchLogOfferReason {
  // a0-97: settings / confirm draw their own controls into this corner.
  if (!pauseAllowsDownloadLog(state.pauseScreen)) return null;
  // a0-98: so does the match itself — the minimap, and on touch the fire column.
  if (!screenClaimsTheDisplay(state)) return null;
  if (sessionHasDropped(state.session)) return 'disconnect';
  return isPauseOpen(state.pauseScreen) ? 'pause' : null;
}
