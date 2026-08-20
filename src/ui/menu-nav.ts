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
  /**
   * **THE TITLE GATE** (a0-50; `src/ui/title-gate`) — the airlock the wordmark is
   * stamped into, and the screen a clean boot actually opens on. A press operates
   * the door and the main menu is behind it; `Escape` reseals it, but only from
   * the menu's top level (`canReseal: () => mainMenu.atTopLevel()`), which is why
   * this node has exactly one way in and one way out.
   *
   * Added by the a0-100c audit, which is the first time this graph was checked
   * against the SCREENS rather than trusted. It is a DOM overlay rather than a
   * Pixi screen, and that is precisely how it stayed off a map of the shell for
   * this long — the omission was about where the code lives, not about what the
   * player can be looking at. Skipped by `?gate=0`, which is how the live-stage
   * and evidence harnesses boot straight to the menu.
   */
  | 'title-gate'
  /** The front door and the one true destination — a clean boot opens here. */
  | 'main-menu'
  /** **The doors** — the one screen PLAY opens (ratified: one play flow): SOLO
   *  / HOST / JOIN, and BACK (u2 menu-back). `src/ui/lobby-entry`,
   *  `screen: 'home'`. Kept named `online` because that is the screen id `main.ts`
   *  and the `__mainMenu` seam already use. */
  | 'online'
  /** The room-code keypad reached by JOIN. `lobby-entry`, `screen: 'join'`. */
  | 'online-keypad'
  /** The pre-match settings screen (fire mode / controls / VFX / volume). */
  | 'settings'
  /** The CODEX reference (GDD §2.10). */
  | 'codex'
  /** The HANGAR (a0-14): your ship, your level, and the cosmetics a level has
   *  unlocked. A door that opens and comes back, like the two above it — it
   *  builds no world and holds no settings. `src/ui/hangar`. */
  | 'hangar'
  /** The lobby in its OFFLINE flavour (SOLO): roster, ship-class select, MAP
   *  SELECT, mode/abundance, RUSH — and BACK (u2 menu-back). `src/ui/lobby`, drawn
   *  by `openLobby` with no session. */
  | 'lobby'
  /** The SAME lobby component, online (HOST / JOIN): one screen, one
   *  model, one view — plus the room code up top and live seats. It is a distinct
   *  *node* here for one reason only: its BACK has a room to give back, so the exit
   *  it owes is stronger than the offline one (close the socket, free the seat, let
   *  the room deallocate — no ghost rooms). `openLobby` with a session. */
  | 'lobby-online'
  /**
   * **SHIP SELECT** (u10-01) — the four hulls with their full stats, opened from
   * the lobby's one ship card. `src/ui/ship-select`.
   *
   * One node for both lobby flavours, unlike the lobby itself: the two lobbies are
   * separate nodes because their BACK differs (the online one owes the room a
   * closed socket), and this screen's BACK owes nothing — it returns to whichever
   * roster opened it, with the pick applied. Modelled as returning to the offline
   * `lobby`, which is the reachability the proof cares about.
   */
  | 'ship-select'
  /** **MAP SELECT** — the six arenas, opened from the lobby's one arena card. A
   *  guest reaches it too and reads it; the pick is the host's (`src/ui/map-select`). */
  | 'map-select'
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
  'title-gate',
  'main-menu',
  'online',
  'online-keypad',
  'settings',
  'codex',
  'hangar',
  'lobby',
  'lobby-online',
  'ship-select',
  'map-select',
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
  // --- The title gate, in front of the menu (a0-50; main.ts `titleGate`) ------
  // A press operates the door; the menu was behind it the whole time. Escape
  // reseals from the menu's top level and nowhere deeper — a reseal over an open
  // settings panel is the wrong answer to the same key.
  { from: 'title-gate', to: 'main-menu', via: '(operate the door)' },
  { from: 'main-menu', to: 'title-gate', via: 'ESCAPE (reseal)', escape: true },

  // --- Main menu → the three screens it opens (openMainMenu.onPointerDown) -----
  // PLAY is now the ONE door into a match, and what it opens is the doors screen
  // (ratified: one play flow). It builds no world and no lobby of its own — the
  // second front door that used to live here (ONLINE) is gone, and with it the
  // offline-lobby shortcut that made PLAY redundant with the SOLO door.
  { from: 'main-menu', to: 'online', via: 'PLAY' },
  { from: 'main-menu', to: 'settings', via: 'SETTINGS' },
  { from: 'main-menu', to: 'codex', via: 'CODEX' },
  // The fourth door (a0-14). Added in the same PR as the screen and its route,
  // which is the rule this file states in its header — a graph that lags the
  // code is a map of a building that has been rebuilt.
  { from: 'main-menu', to: 'hangar', via: 'HANGAR' },

  // --- The doors (openMainMenu.applyEntryTarget / chooseEntryDoor) -------------
  // FOUR doors are drawn here since u9-01, but only three are edges: **CAMPAIGN
  // adds none.** It is a teaser (`src/ui/lobby-entry` `comingSoon`) — pressing it
  // writes `Coming Soon…` into the screen's message slot and moves nothing, so
  // there is no screen to travel to and no exit it could owe. Recorded here
  // deliberately rather than left to be noticed: this graph is the audit, and a
  // control that navigates nowhere is a fact about the map, not a gap in it. The
  // day CAMPAIGN is built it gains a node and an edge, in the same PR as the code.
  //
  // **There is no `online -> settings` edge, and that is now the truth rather
  // than an omission (a0-100c).** Until this PR the doors drew a SETTINGS plate
  // on the trailing end of their footer beam; it reached `openSettings()` in
  // `main.ts` and really did open the screen, and this graph never recorded it —
  // the first control the audit below caught, and the reason the audit was run.
  // The developer's ruling deleted the control: **settings opens from the main
  // menu and the pause menu, and nowhere else** (held by `menu-nav.test.ts`
  // `settings opens from the main menu and the pause menu, and nowhere else`).
  // BACK is what the screen keeps, and it reaches the menu where settings lives
  // one press away — which is the developer's own argument for why the button
  // was redundant.
  //
  // BACK leaves for the menu (closeOnline); Escape does the same on a pointer.
  { from: 'online', to: 'main-menu', via: 'BACK', escape: true },
  { from: 'online', to: 'online-keypad', via: 'JOIN' },
  // SOLO opens the lobby offline (chooseEntryDoor('solo') → play()).
  { from: 'online', to: 'lobby', via: 'SOLO' },
  // HOST opens the SAME lobby online, host flavour: the allocator mints the
  // code, the socket opens, and the room's `welcome` hands the lobby the seat.
  { from: 'online', to: 'lobby-online', via: 'HOST' },

  // --- Room-code keypad (backToDoors / Escape) --------------------------------
  { from: 'online-keypad', to: 'online', via: 'BACK', escape: true },
  // A submitted code joins the host's room and lands in the same lobby, guest
  // flavour — the seats fill live, the map and mode read-only.
  { from: 'online-keypad', to: 'lobby-online', via: 'JOIN (code)' },
  // The SAME node, by the OTHER affordance: JOIN's second mode is a live listing
  // (u17-01), and pressing a row goes to the allocator and lands in the identical
  // guest lobby (`main.ts` `pressBrowseRowAt` -> `startListingJoin`). Recorded in
  // its own right by the a0-100c audit: the destination was already covered by the
  // edge above, so reachability never lied — but a map that names one of a
  // screen's two ways to a room and not the other is a map you have to read the
  // code to trust.
  { from: 'online-keypad', to: 'lobby-online', via: '(a listing row)' },
  // The keypad's remaining controls navigate NOWHERE, and are recorded here for
  // the same reason CAMPAIGN is: the mode switch (CODE <-> BROWSE) changes which
  // half of this screen is drawn and never which screen you are on; the pad's
  // keys and ERASE edit the code in place. Three controls, one node, no edges.

  // --- Settings (closeSettings / Escape) --------------------------------------
  { from: 'settings', to: 'main-menu', via: 'DONE', escape: true },

  // --- Codex (closeCodex / Escape / Backspace) --------------------------------
  { from: 'codex', to: 'main-menu', via: 'BACK', escape: true },

  // --- Hangar (closeHangar / Escape / Backspace) ------------------------------
  // One way out, and it is the only edge the screen has: equipping a cosmetic
  // moves nothing, so the hangar is a leaf.
  { from: 'hangar', to: 'main-menu', via: 'BACK', escape: true },

  // --- Lobby, offline (openLobby.act('leave') / Escape — u2 menu-back) --------
  { from: 'lobby', to: 'main-menu', via: 'BACK', escape: true },
  { from: 'lobby', to: 'match', via: 'RUSH', startsMatch: true },

  // --- The two screens a lobby card opens (u10-01; openLobby.goToScreen) -------
  // Added in the same PR as the screens and their routes, which is the rule this
  // file's header states — a graph that lags the code is a map of a building that
  // has been rebuilt.
  //
  // The exits are the load-bearing half here, and they are why Escape on these two
  // screens returns to the ROSTER rather than to the main menu: BACK is one step.
  // An Escape that skipped the roster would drop a player out of a room they had
  // only opened a card in — and would make these the only two screens in the shell
  // where the exit key does two things at once.
  { from: 'lobby', to: 'ship-select', via: 'SHIP · CHANGE' },
  { from: 'lobby', to: 'map-select', via: 'MAP · CHANGE' },
  { from: 'lobby-online', to: 'ship-select', via: 'SHIP · CHANGE' },
  // A GUEST reaches this one too, and reads it: what the arena screen refuses is
  // the pick, never the look (`src/ui/lobby` `openMapSelect`). A card that would
  // not open would read as broken and withhold the board they are about to fly.
  { from: 'lobby-online', to: 'map-select', via: 'MAP · CHANGE' },
  // …and both come back with the pick applied, by BACK, by Escape, or by picking.
  { from: 'ship-select', to: 'lobby', via: 'BACK', escape: true },
  { from: 'ship-select', to: 'lobby', via: '(pick a hull)' },
  { from: 'map-select', to: 'lobby', via: 'BACK', escape: true },
  { from: 'map-select', to: 'lobby', via: '(pick an arena)' },

  // --- Lobby, online (the same component; openLobby with a session) ------------
  // BACK closes the socket BEFORE reloading onto the menu, so the seat is freed
  // and an empty room deallocates — a lobby that leaked its room would leave a
  // code the classroom can still type and nobody is behind (u2 item 4).
  { from: 'lobby-online', to: 'main-menu', via: 'BACK', escape: true },
  // The host's RUSH sends `startMatch`; a guest's match arrives when the host
  // presses it. Both are match-starts, so neither counts as an exit.
  { from: 'lobby-online', to: 'match', via: 'RUSH', startsMatch: true },
  { from: 'lobby-online', to: 'match', via: '(host started)', startsMatch: true },

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

/**
 * The ways out of a screen that do NOT start a match — the genuine exits.
 * Non-empty for every screen, which is the "every screen you can leave" half of
 * the rule.
 *
 * {@link NAV_ROOT} is the one screen whose exits are not what the rule is about:
 * it is the destination, so it owes nobody a way out. It is no longer *empty*,
 * though — since the a0-100c audit put the title gate on the map, the menu can
 * reseal the door in front of itself (`ESCAPE`), and a graph that omitted that
 * to keep a sentence true would be the omission this file exists to prevent.
 */
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
