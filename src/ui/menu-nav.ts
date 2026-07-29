/**
 * src/ui/menu-nav.ts — the navigation graph: every screen a player can be on, and
 * the ways out of it. OWNER: UI Engineer (u2 menu-back).
 *
 * The standing rule from the build wheels, generalised to the whole shell: **every
 * screen you can enter, you can leave** — and from anywhere, some input path leads
 * back to the main menu *without having to start (or finish) a match*. A screen
 * with no exit is a trap; a screen whose only exit starts a match is a trap with a
 * cover charge. This module writes that rule down as data so a test can prove it,
 * and so the audit is a thing the compiler and CI keep honest rather than a
 * paragraph that rots.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * It is a *contract*, not the wiring. The real transitions live in `src/main.ts`
 * (`openMainMenu`, `openLobby`, the pause overlay, the end overlay); each edge
 * below names the affordance and the handler that realises it, so a reader can
 * check the graph against the code. It is pure and DOM-free, so the reachability
 * proof runs headless in the unit suite ({@link ../ui/menu-nav.test} — the
 * "navigation graph test" the u2 brief asks for). Keep the two in step: if a screen
 * gains or loses an exit in `main.ts`, change the edge here in the same PR.
 */

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * Every screen the shell can show. The match itself is a "screen" here because a
 * player standing in a live match must also be able to reach the menu (through the
 * pause overlay) — the graph would lie if it stopped at the lobby.
 */
export type NavScreen =
  /** The front door and the one true destination — a clean boot opens here. */
  | 'main-menu'
  /** The ONLINE front door: PLAY SOLO / CREATE ROOM / JOIN ROOM / SETTINGS, and
   *  now BACK (u2 menu-back). `src/ui/lobby-entry`, `screen: 'home'`. */
  | 'online'
  /** The room-code keypad reached by JOIN ROOM. `lobby-entry`, `screen: 'join'`. */
  | 'online-keypad'
  /** The pre-match settings screen (fire mode / controls / VFX / volume). */
  | 'settings'
  /** The CODEX reference (GDD §2.10). */
  | 'codex'
  /** The lobby: roster, ship-class select, MAP SELECT, mode/abundance, RUSH — and
   *  now BACK (u2 menu-back). `src/ui/lobby`, drawn by `openLobby`. */
  | 'lobby'
  /** A live match (including spectating after elimination). */
  | 'match'
  /** The pause overlay over a match: RESUME / SETTINGS / EXIT TO MENU. */
  | 'pause'
  /** SETTINGS opened from within the pause overlay (no leaving the match). */
  | 'pause-settings'
  /** The "Leave the match?" confirm, so EXIT is never a one-tap accident. */
  | 'pause-confirm'
  /** The end-of-match summary once the whole match is over. */
  | 'end-over'
  /** The end-of-match summary while you are out but the others fight on. */
  | 'end-eliminated';

/** Every screen, in a stable order (the audit list). */
export const NAV_SCREENS: readonly NavScreen[] = [
  'main-menu',
  'online',
  'online-keypad',
  'settings',
  'codex',
  'lobby',
  'match',
  'pause',
  'pause-settings',
  'pause-confirm',
  'end-over',
  'end-eliminated',
];

/** The one screen everything must be able to reach: the main menu. */
export const NAV_ROOT: NavScreen = 'main-menu';

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** One directed transition between screens. */
export interface NavEdge {
  readonly from: NavScreen;
  readonly to: NavScreen;
  /** The affordance a player uses — the button word, or the key. Documentation,
   *  and what a failure message can name. */
  readonly via: string;
  /**
   * True when taking this edge *starts (or restarts) a match* — RUSH, or REMATCH.
   * The reachability proof forbids these: "back to the menu without starting a
   * match" is the whole point, so an exit that only works by launching a match
   * does not count as an exit.
   */
  readonly startsMatch?: boolean;
  /** True for an edge answerable by Escape on a pointer device (the u2 brief:
   *  "Escape also works on pointer"). Purely informational for the audit. */
  readonly escape?: boolean;
}

/**
 * The graph. Each edge names the `src/main.ts` handler that realises it, so the
 * contract can be checked against the code.
 *
 * Forward edges (menu → a screen) are included for completeness; the proof only
 * cares about the *return* edges, but a full graph reads as the map it is.
 */
export const NAV_EDGES: readonly NavEdge[] = [
  // --- Main menu → the four screens it opens (openMainMenu.onPointerDown) ------
  { from: 'main-menu', to: 'online', via: 'ONLINE' },
  { from: 'main-menu', to: 'settings', via: 'SETTINGS' },
  { from: 'main-menu', to: 'codex', via: 'CODEX' },
  // PLAY builds the offline match's *lobby* first (openLobby) — the match itself
  // does not begin until RUSH, so PLAY is a normal edge, not a match-start.
  { from: 'main-menu', to: 'lobby', via: 'PLAY' },

  // --- ONLINE front door (openMainMenu.applyEntryTarget / chooseEntryDoor) -----
  // BACK leaves for the menu (closeOnline); Escape does the same on a pointer.
  { from: 'online', to: 'main-menu', via: 'BACK', escape: true },
  { from: 'online', to: 'online-keypad', via: 'JOIN ROOM' },
  // PLAY SOLO drops into the offline lobby (chooseEntryDoor('solo') → play()).
  { from: 'online', to: 'lobby', via: 'PLAY SOLO' },

  // --- Room-code keypad (backToDoors / Escape) --------------------------------
  { from: 'online-keypad', to: 'online', via: 'BACK', escape: true },

  // --- Settings (closeSettings / Escape) --------------------------------------
  { from: 'settings', to: 'main-menu', via: 'DONE', escape: true },

  // --- Codex (closeCodex / Escape / Backspace) --------------------------------
  { from: 'codex', to: 'main-menu', via: 'BACK', escape: true },

  // --- Lobby (openLobby.act('leave') / Escape — u2 menu-back) -----------------
  { from: 'lobby', to: 'main-menu', via: 'BACK', escape: true },
  { from: 'lobby', to: 'match', via: 'RUSH', startsMatch: true },

  // --- A live match → the pause overlay (ESC / the corner pause button) --------
  { from: 'match', to: 'pause', via: 'PAUSE', escape: true },
  // The match ends, or you are eliminated: the summary overlay takes the screen.
  { from: 'match', to: 'end-over', via: '(match over)' },
  { from: 'match', to: 'end-eliminated', via: '(eliminated)' },

  // --- Pause overlay (pause-menu; the pause wiring in main.ts) -----------------
  { from: 'pause', to: 'match', via: 'RESUME', escape: true },
  { from: 'pause', to: 'pause-settings', via: 'SETTINGS' },
  { from: 'pause', to: 'pause-confirm', via: 'EXIT TO MENU' },
  { from: 'pause-settings', to: 'pause', via: 'BACK', escape: true },
  { from: 'pause-confirm', to: 'pause', via: 'STAY', escape: true },
  // LEAVE reloads onto a fresh main menu (exitToMenu) — the maximal teardown.
  { from: 'pause-confirm', to: 'main-menu', via: 'LEAVE' },

  // --- End-of-match summary (end-of-match; handleEndTarget) -------------------
  // Whole match over: BACK TO MENU (a clean reload).
  { from: 'end-over', to: 'main-menu', via: 'BACK TO MENU' },
  // REMATCH stands up a fresh match — an exit, but a match-starting one.
  { from: 'end-over', to: 'match', via: 'REMATCH', startsMatch: true },
  // Eliminated but the others fight on: SPECTATE dismisses the overlay back to the
  // live match (startSpectate) — from there the pause overlay carries the menu
  // exit, so an eliminated player is never trapped. REMATCH restarts a match.
  { from: 'end-eliminated', to: 'match', via: 'SPECTATE' },
  { from: 'end-eliminated', to: 'match', via: 'REMATCH', startsMatch: true },
];

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

/** The ways out of a screen that do NOT start a match — the genuine exits. Empty
 *  for {@link NAV_ROOT} (it is the destination); non-empty for every other screen,
 *  which is the "every screen you can leave" half of the rule. */
export function screenExits(screen: NavScreen): readonly NavEdge[] {
  return NAV_EDGES.filter((e) => e.from === screen && !e.startsMatch);
}

/**
 * Whether the main menu is reachable from `screen` following only non-match edges.
 * A breadth-first walk that refuses {@link NavEdge.startsMatch} edges — so a path
 * that "escapes" only by launching a match does not count. `main-menu` reaches
 * itself trivially.
 */
export function reachesMainMenuWithoutMatch(screen: NavScreen): boolean {
  const seen = new Set<NavScreen>([screen]);
  const queue: NavScreen[] = [screen];
  while (queue.length > 0) {
    const at = queue.shift() as NavScreen;
    if (at === NAV_ROOT) return true;
    for (const edge of NAV_EDGES) {
      if (edge.from !== at || edge.startsMatch || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return false;
}
