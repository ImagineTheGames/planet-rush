/**
 * tests/mobile/team-fog-offline.spec.ts — shared team vision, proved in the mode
 * the developer actually plays: **SOLO, against bots, in TEAMS.** OWNER: QA Agent.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * a0-42 shipped shared team fog (GDD §2.2, amended 2026-08-13; `src/sim/sensing.ts`
 * `teamSensorSources` / `teamRememberedStationMask` / `teamRememberedOreIds`).
 * Reporting it, the Director wrote *"solo play is untouched"* meaning free-for-all.
 * The developer corrected them:
 *
 *   > *"what do you mean solo play is untouched, do you mean FFA instead? because
 *   > in solo play we can have teams"*
 *
 * They are right, and it is not a wording point. **Offline solo-vs-bots is a full
 * TEAMS mode** and it is the mode most matches are played in. a0-42's evidence
 * names only `?debug=1&sides=2` — the harness boot, which has no lobby — so the
 * feature could ship proven only in the mode nobody asked about.
 *
 * This is the END-TO-END proof, through the real front door and the shipped
 * bundle. It does not restate a0-42's unit proof (`src/sim/team-sensing.test.ts`
 * owns the union over the sensing module) and it does not weaken it.
 *
 * ── THE SEAM THIS FILE HAD TO WORK AROUND, STATED PLAINLY ──────────────────
 * The brief asks for one test that both (a) walks the REAL lobby so the `teams`
 * table travels exactly as a player's does, and (b) reads the client's minimap
 * seam. **Those two cannot be the same boot today.** `?debug=1` is a single flag
 * that installs every live-stage seam *and* skips the menu and the lobby:
 *
 *     const mainMenu = flags.debug ? null : openMainMenu(…);   // src/main.ts:969
 *     const lobby    = flags.debug ? null : openLobby(…);      // src/main.ts:1028
 *
 * So a lobby-booted match has no fog read-back, and a seam-readable match has no
 * lobby. QA does not own `src/`, so the answer is not to add a flag; it is to prove
 * the claim from both ends and say where they meet. Two acts:
 *
 *   ACT 1 — THE LOBBY IS REAL. A clean boot, no `?debug=1`: PLAY → PLAY SOLO →
 *     seven BOT seats → MODE → TEAMS → RUSH!, then the SAME match in free-for-all,
 *     same fixed seed, same arena, same seats, same cast, same sim tick, mode
 *     flipped. Measured on the **drawn** minimap (the expanded overlay opened with
 *     the player's own `M`), pixel by pixel. No seam is asked what it thinks; the
 *     picture is the witness.
 *
 *   ACT 2 — THE FOUR FOG RULES. `?debug=1&freeze=1&sides=2` (an OFFLINE teams
 *     match — `?debug=1` boots `LocalLoopback`, the same offline authority the
 *     lobby boots), staged through a0-42's own `__teamFogStage` and read back off
 *     `__minimapStage`, the minimap layer's own drawn-frame seam.
 *
 * **The two acts are the same table.** The lobby's default TEAMS assignment is
 * `defaultTeamForSlot(i) = i % 2` (`src/ui/lobby.ts`), and the debug boot's
 * `?sides=2` builds `Array.from({length: slots}, (_, i) => i % n)` with `n = 2`
 * (`src/main.ts` `readDebugSides`) — character for character the same sides, which
 * is why Act 2's world is the world Act 1's lobby authors. Act 1 asserts that
 * table off the drawn pixels rather than taking it on trust.
 *
 * ── DETERMINISM (GDD §4.8) ─────────────────────────────────────────────────
 * Nothing here reads the clock. The offline seed is the fixed `MATCH_SEED`
 * (`src/main.ts`: *"deterministic and never time-derived… every offline match is
 * the same arena"*), the arena is the persisted default `octagon`, and the cast is
 * the lobby's fixed seven. Act 1 waits on the SIM's own fixed-step counter, never
 * on wall time, and shoots at a tick the local ship has not moved from: the human
 * gives no input, so their two coverage discs (ship + home) are pinned in both
 * runs — which is what makes the TEAMS/FFA pair differ by allegiance alone. Act 2
 * runs frozen (`?freeze=1`), so its scene does not drift at all.
 *
 * ── DESKTOP ONLY, AND WHY ──────────────────────────────────────────────────
 * Fog is `src/sim/sensing.ts` plus a pure projection (`src/ui/minimap.ts`); it has
 * no device term, and the three device profiles would assert the identical thing
 * three times. What differs per device is where the map is DRAWN, and that is
 * already covered by the layout suite and by a0-42's re-baselined phone goldens.
 * The desktop control is also the profile where these frames are readable as
 * evidence and where a full-frame decode costs 1.0 MP instead of a phone's 2.96
 * (tests/mobile/shot-budget.ts).
 */
/*
 * ── a0-50: `?gate=0` on the clean boot below ────────────────────────────────
 * OWNED BY QA, EDITED BY THE UI ENGINEER — one line, and it drops cleanly.
 *
 * The title gate is a DOOR in front of the title screen: the wordmark is stamped
 * into the leaves of an airlock and it is opened by a press, over four beats.
 * This spec walks through the front door on its way somewhere else, so without
 * the flag its first click lands on the door instead of on the menu.
 *
 * `?gate=0` turns off that screen and NOTHING else — the menu, the doors and the
 * lobby below are the real ones, exactly as they were. It is deliberately much
 * narrower than `?debug=1`, which skips the whole front of the game. The read is
 * `src/ui/title-gate.ts` `gateEnabled`, and its doc carries the reasoning.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetTest } from './budgets';
import { settleFrames } from './render-settle';
import { waitForSimTicks } from './sim-clock';
import { count, decode, type Img, type Pred } from './pixels';
// The shipped geometry and the shipped tables — imported, never restated. A
// hand-copied rect or a hand-copied side rule is a second source of truth that
// can drift away from the client while this file keeps passing.
import { minimapRect } from '../../src/ui/minimap';
import { defaultTeamForSlot, SIDE_COLORS } from '../../src/ui/lobby';

// ---------------------------------------------------------------------------
// The seams this spec reads (all read-back; the presses are real)
// ---------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}
interface Control {
  readonly kind: string;
  readonly physicalCenter: Point;
}
/** `window.__lobby`, narrowed to what the journey drives and asserts. */
interface LobbySeam {
  readonly visible: boolean;
  readonly online: boolean;
  readonly mode: string;
  readonly size: number;
  readonly slotCount: number;
  readonly selectedMapId: string;
  readonly seatStates: readonly { readonly index: number; readonly label: string; readonly live: boolean; readonly physicalCenter: Point }[];
  readonly seatCharacters: readonly (string | null)[];
  readonly modeControl: { readonly physicalCenter: Point };
  readonly rushControl: { readonly physicalCenter: Point };
  readonly worldMapId: string | null;
  readonly worldStations: readonly Point[] | null;
  readonly worldCast: readonly (string | null)[] | null;
}
/** `window.__pauseStage` — installed on BOTH boots, which is why a lobby-booted
 *  match has a sim clock to wait on at all (src/main.ts `installPauseStage`). */
interface PauseSeam {
  read(): { readonly simTicks: number; readonly online: boolean; readonly ship: Point | null };
}
/** a0-42's `?debug=1` team-fog stage (src/main.ts `installTeamFogStage`). */
interface TeamFogSeam {
  state(): {
    ally: number | null;
    allyOnYourSide: boolean;
    ownDiscs: number;
    teamDiscs: number;
    sensedRivals: number[];
    rememberedMask: number;
    rememberedOre: number;
    allyClearance: number;
  };
  stage(): { ally: number; rival: number; at: Point; rivalDist: number; clearance: number } | null;
  share(on: boolean): { ally: number; team: number } | null;
  scout(): { ally: number; at: Point; learned: number } | null;
  killAlly(): number | null;
}
/** The minimap layer's own drawn-frame seam (src/ui/minimap-view.ts DrawnMinimap). */
interface MinimapSeam {
  state(): {
    expanded: boolean;
    rect: { x: number; y: number; width: number; height: number };
    stationCount: number;
    shipCount: number;
    oreCount: number;
    satelliteCount: number;
    coverageCount: number;
  };
}
interface StageWindow {
  __mainMenu?: { controls: readonly Control[] };
  __onlineMenu?: { visible: boolean; doorControls: readonly Control[] };
  __lobby?: LobbySeam;
  __pauseStage?: PauseSeam;
  __teamFogStage?: TeamFogSeam;
  __minimapStage?: MinimapSeam;
  __planetRush?: { frozen?: boolean };
}
declare const window: Window & StageWindow;

// ---------------------------------------------------------------------------
// The board, read off the shipped tables
// ---------------------------------------------------------------------------

/** The desktop control profile (playwright.config.ts). Stated here because the
 *  minimap rect is a pure function of it and the analysis needs both. */
const VIEWPORT = { width: 1280, height: 800 } as const;

/** Where the EXPANDED minimap overlay is drawn on that viewport — the client's
 *  own geometry, not a measured guess (`src/ui/minimap.ts` `expandedRect`). */
const MAP = minimapRect('expanded', VIEWPORT, false, {});

/** The local player's seat. Offline you are always seat 0 (src/main.ts: *"a
 *  creator, and every offline match, stays seat 0"*), and with no seat closed the
 *  lobby's slot index IS the sim's dense player id. */
const YOU = 0;

/** The sides a default TEAMS lobby authors, from the lobby's own rule. At eight
 *  active seats this is a 4v4: you and slots 2, 4, 6 — three bot ALLIES — against
 *  slots 1, 3, 5, 7. */
const ALLIES = [1, 2, 3, 4, 5, 6, 7].filter((i) => defaultTeamForSlot(i) === defaultTeamForSlot(YOU));
const ENEMIES = [1, 2, 3, 4, 5, 6, 7].filter((i) => defaultTeamForSlot(i) !== defaultTeamForSlot(YOU));

/**
 * Sim ticks of match to let pass, from the first tick the match is observable at
 * ({@link bootLobbyMatch} `firstTick`), before the pair of frames is shot.
 *
 * One second, and EARLY on purpose. The human never touches a control, so their
 * ship and their home — their whole coverage — sit exactly where they spawned in
 * both runs; the bots have barely left theirs; nothing has died; and the whole
 * frame is still inside the 10-second spawn protection. Everything the TEAMS
 * frame carries and the FFA frame does not is therefore attributable to the side
 * table, not to something that has had time to move.
 *
 * It is timed from `firstTick` rather than from zero because a match has already
 * simulated a few hundred ticks by the time anything outside the page can see it
 * (the boot path installs the whole HUD before it yields). Both runs pay the same
 * cost, so both land at the same point of the match, ±one frame's catch-up.
 */
const SHOT_TICK = 60;

/**
 * The tick band this test's thresholds were measured across, and the band the
 * shot must land inside.
 *
 * A census of this exact journey (the pair of frames re-taken at ticks 30, 60,
 * 120, 300 and 900) found every number below flat over the whole range: the
 * human's own revealed area constant at 47,536 px, `ffaOnly` 0 at every tick, the
 * three allies drawn and wholly outside the human's coverage at every tick, and
 * nothing of theirs on the FFA map at any tick. The ceiling is a guard on the
 * PREMISE, not an assertion about fog: past it the bots have flown far enough
 * that the spawn geometry these thresholds were read off no longer holds, and the
 * right response would be to re-measure rather than to nudge a number.
 */
const SHOT_TICK_CEILING = 900;

// ---------------------------------------------------------------------------
// Reading a minimap frame
// ---------------------------------------------------------------------------

/**
 * Luminance of a pixel, 0..255. The fog wash and the revealed floor differ by a
 * wide, flat margin — measured on this build: fog is `rgb(13,16,21)` everywhere,
 * a single coverage disc lifts the floor to `rgb(31,36,43)` and an overlap to
 * `rgb(59,64,72)` — so one threshold between them separates the two states with
 * ~10 levels of clearance on either side.
 */
const lum = (r: number, g: number, b: number): number => (r + g + b) / 3;

/** Inside a coverage disc: the minimap floor has been lifted out of the fog. */
const isRevealed: Pred = (r, g, b) => lum(r, g, b) >= 26;

/**
 * An ore-field hint. The dots are `PALETTE.signalYellow` (`src/ui/minimap.ts`:
 * `color: PALETTE.signalYellow`) but they are drawn as a WASH, not as the colour —
 * `MINIMAP_ORE_ALPHA` is 0.28 under live coverage and `MINIMAP_REMEMBERED_ORE_ALPHA`
 * 0.14 once the field is only remembered — so a `signalYellow` match finds nothing.
 * What survives the composite is the HUE: gold over a blue-grey floor, measured on
 * this build at `rgb(147,134,74)` lit and `rgb(110,105,73)` remembered. This tests
 * for that — blue is the smallest channel by a wide margin, and the pixel is well
 * clear of both the fog and a white dot.
 */
const isOreHint: Pred = (r, g, b) =>
  b < g && b < r && (r + g) / 2 - b >= 28 && lum(r, g, b) >= 45 && lum(r, g, b) <= 210;

/** Whether a pixel is within `tol` of a packed 0xRRGGBB colour on every channel.
 *  Dots draw at `MINIMAP_DOT_ALPHA` over the map floor, so an exact match would
 *  find nothing; the tolerance is the composite, not slack in the assertion — the
 *  eight identity colours are far further apart than this from each other. */
function nearColour(p: readonly [number, number, number], packed: number, tol: number): boolean {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return Math.abs(p[0] - r) <= tol && Math.abs(p[1] - g) <= tol && Math.abs(p[2] - b) <= tol;
}

/** The whole minimap rect as a {@link Region} in the 0..1 coordinates ./pixels
 *  counts in — derived from {@link MAP} so the two can never disagree. */
const MAP_REGION = {
  x0: MAP.x / VIEWPORT.width,
  y0: MAP.y / VIEWPORT.height,
  x1: (MAP.x + MAP.width) / VIEWPORT.width,
  y1: (MAP.y + MAP.height) / VIEWPORT.height,
};

const px = (img: Img, x: number, y: number): [number, number, number] => {
  const i = (img.width * y + x) << 2;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};

/**
 * Compare the two frames pixel for pixel inside the minimap, and answer the three
 * populations the whole proof rests on.
 *
 * `allyOnly` is the load-bearing one, and it is defined by the CONTROL rather than
 * by geometry: a pixel revealed in TEAMS and fogged in FFA is, by construction,
 * outside every disc the human projects — because in FFA (teams-of-one) the human's
 * own discs are the *entire* coverage set. No radius is assumed, no position is
 * trusted, and a change to the sensor constants cannot make this lie.
 */
function comparePair(teams: Img, ffa: Img): {
  ffaRevealed: number;
  teamsRevealed: number;
  allyOnly: number;
  ffaOnly: number;
  oreInAllyOnly: number;
} {
  let ffaRevealed = 0;
  let teamsRevealed = 0;
  let allyOnly = 0;
  let ffaOnly = 0;
  let oreInAllyOnly = 0;
  for (let y = MAP.y; y < MAP.y + MAP.height; y++) {
    for (let x = MAP.x; x < MAP.x + MAP.width; x++) {
      const t = px(teams, x, y);
      const f = px(ffa, x, y);
      const rt = isRevealed(t[0], t[1], t[2], 255);
      const rf = isRevealed(f[0], f[1], f[2], 255);
      if (rt) teamsRevealed++;
      if (rf) ffaRevealed++;
      if (rt && !rf) {
        allyOnly++;
        if (isOreHint(t[0], t[1], t[2], 255)) oreInAllyOnly++;
      }
      if (rf && !rt) ffaOnly++;
    }
  }
  return { ffaRevealed, teamsRevealed, allyOnly, ffaOnly, oreInAllyOnly };
}

/**
 * How many pixels of a given SIDE's colour are drawn on this minimap, and how many
 * of those sit where the CONTROL frame is fog.
 *
 * ── WHY THIS IS A SIDE AND NOT A SLOT (a0-110, ratified 2026-08-20) ─────────
 * This was `identityPixels(…, slot)` and it counted one player's ROSTER colour,
 * because colour on the minimap used to be roster identity. The developer
 * overruled that for this surface: *"i feel like on minimap friendlies should all
 * be blue, and enemies all red"*. Every friendly mark — the human and all three
 * allies — is now `SIDE_COLORS.friendly`, and every hostile is `SIDE_COLORS.enemy`
 * (`src/ui/minimap.ts` `MINIMAP_SIDE_COLORS`). A per-slot pixel census is no
 * longer possible on this surface, by design, and that is the ratified trade.
 *
 * **Nothing this file proves is weakened by that, with one honest exception.**
 * Every fog claim below is a claim about WHERE a mark is drawn relative to the
 * human's own coverage, and the CONTROL frame still decides that pixel by pixel.
 * What is lost is only the ability to name WHICH ally: "P2, P4 and P6 are each
 * individually on the map" becomes "ally-side ink is on the map, in ally-only
 * territory, and none of it is in FFA". The slot list is still asserted against
 * the lobby's own `defaultTeamForSlot`, so the side table is still checked — just
 * from the table rather than from the pixels.
 */
function sidePixels(
  img: Img,
  control: Img,
  side: 'friendly' | 'enemy',
): { drawn: number; inAllyOnly: number; inOwnCoverage: number } {
  const colour = SIDE_COLORS[side];
  let drawn = 0;
  let inAllyOnly = 0;
  let inOwnCoverage = 0;
  for (let y = MAP.y; y < MAP.y + MAP.height; y++) {
    for (let x = MAP.x; x < MAP.x + MAP.width; x++) {
      const p = px(img, x, y);
      if (!nearColour(p, colour, 26)) continue;
      drawn++;
      const c = px(control, x, y);
      if (isRevealed(c[0], c[1], c[2], 255)) inOwnCoverage++;
      else inAllyOnly++;
    }
  }
  return { drawn, inAllyOnly, inOwnCoverage };
}

// ---------------------------------------------------------------------------
// Act 1 — the journey through the real front door
// ---------------------------------------------------------------------------

/** Press a control the client itself reported the position of. Real mouse, real
 *  hit test — the seam says WHERE it drew the button, never opens it. */
async function pressAt(page: Page, at: Point): Promise<void> {
  await page.mouse.click(at.x, at.y);
}

/**
 * Boot clean and walk the ratified play flow to a running OFFLINE match in
 * `mode`, with real presses at every step: PLAY → PLAY SOLO → every open seat
 * cycled to BOT → (TEAMS only) MODE → RUSH!.
 *
 * Returns what the lobby says it built, read back off the world the sim actually
 * assembled — the half that would have caught the class of bug this whole feature
 * family keeps hitting (a pick that is drawn and never travels).
 */
async function bootLobbyMatch(page: Page, mode: 'ffa' | 'teams'): Promise<{
  seats: string[];
  cast: readonly (string | null)[];
  mapId: string;
  stations: number;
  online: boolean;
  /** The sim tick at the first moment this match is observable at all. Not zero:
   *  `boot()` builds the world, then installs the HUD, the layers and the seams,
   *  and only yields to the browser once the loop is running — so by the time any
   *  poll can see `__pauseStage`, some match has already been simulated. Returned
   *  so the caller can time its frame from a fixed point in the MATCH rather than
   *  from a count that has already been running. */
  firstTick: number;
}> {
  await page.goto('/?gate=0', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });

  await page.waitForFunction(() => (window.__mainMenu?.controls.length ?? 0) > 0, undefined, { timeout: 20_000 });
  const play = await page.evaluate(() => {
    const c = window.__mainMenu!.controls.find((k) => k.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(play, 'the menu reports where PLAY is drawn').not.toBeNull();
  await pressAt(page, play!);

  await page.waitForFunction(
    () => !!window.__onlineMenu?.visible && window.__onlineMenu.doorControls.length > 0,
    undefined,
    { timeout: 20_000 },
  );
  const solo = await page.evaluate(() => {
    const c = window.__onlineMenu!.doorControls.find((k) => k.kind === 'solo');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(solo, 'the doors report where PLAY SOLO is drawn').not.toBeNull();
  await pressAt(page, solo!);

  await page.waitForFunction(
    () => !!window.__lobby?.visible && window.__lobby.seatStates.length === 8,
    undefined,
    { timeout: 20_000 },
  );

  // Seven bots and one human. The offline lobby already seats the cast this way,
  // so this loop is usually a no-op — it is here because "the rest are bots" is a
  // premise of the proof and must be *established*, not assumed, and because a
  // default that changes should re-shape this match rather than silently weaken it.
  for (let i = 0; i < 8; i++) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const seat = await page.evaluate((idx) => {
        const s = window.__lobby!.seatStates[idx]!;
        return { label: s.label, live: s.live, x: s.physicalCenter.x, y: s.physicalCenter.y };
      }, i);
      if (seat.label === 'BOT' || !seat.live) break;
      await pressAt(page, { x: seat.x, y: seat.y });
      await settleFrames(page);
    }
  }

  // MODE is a two-state cycle (FFA ⇄ TEAMS) and the lobby opens on **the last mode
  // this client RUSHed with** — it is persisted (`planet-rush:matchMode`,
  // src/main.ts), so the second run of this pair finds the room already in the
  // first run's mode. Press until the roster reads the mode this run wants, which
  // is what a host does and is correct from either starting state. Read-back proof
  // that the ROSTER re-worded itself, never a seam call.
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.evaluate(() => window.__lobby!.mode)) === mode) break;
    const modeControl = await page.evaluate(() => ({
      x: window.__lobby!.modeControl.physicalCenter.x,
      y: window.__lobby!.modeControl.physicalCenter.y,
    }));
    await pressAt(page, modeControl);
    await page.waitForFunction((want) => window.__lobby?.mode === want, mode, { timeout: 10_000 });
  }

  const before = await page.evaluate(() => ({
    mode: window.__lobby!.mode,
    size: window.__lobby!.size,
    online: window.__lobby!.online,
    mapId: window.__lobby!.selectedMapId,
    seats: window.__lobby!.seatStates.map((s) => s.label),
    characters: window.__lobby!.seatCharacters,
  }));
  expect(before.mode, 'the lobby is in the mode this run asked for').toBe(mode);
  expect(before.online, 'PLAY SOLO is the OFFLINE flavour of the lobby — no socket').toBe(false);
  expect(before.size, 'eight participants: one human, seven bots (GDD §2.1)').toBe(8);
  expect(before.seats, 'seat 0 is the human; every other seat is a bot').toEqual([
    'TAKEN',
    'BOT',
    'BOT',
    'BOT',
    'BOT',
    'BOT',
    'BOT',
    'BOT',
  ]);

  const rush = await page.evaluate(() => ({
    x: window.__lobby!.rushControl.physicalCenter.x,
    y: window.__lobby!.rushControl.physicalCenter.y,
  }));
  await pressAt(page, rush);

  // The world is not built until the RUSH! countdown reaches zero (GDD §4.2), and
  // `worldStations` is null until it is — so this is the wait for "there is a match".
  await page.waitForFunction(() => window.__lobby?.worldStations != null, undefined, { timeout: 60_000 });
  const built = await page.evaluate(() => ({
    visible: window.__lobby!.visible,
    mapId: window.__lobby!.worldMapId!,
    stations: window.__lobby!.worldStations!.length,
    cast: window.__lobby!.worldCast!,
  }));
  expect(built.visible, 'the lobby hands the screen to the match').toBe(false);
  expect(built.stations, 'eight homes, one per participant').toBe(8);

  // The pause seam is the only sim read-out a clean boot has; its presence is also
  // this journey's proof that the match is the OFFLINE one (`online: false`).
  await page.waitForFunction(() => typeof window.__pauseStage?.read === 'function', undefined, { timeout: 20_000 });
  const pause = await page.evaluate(() => window.__pauseStage!.read());
  expect(pause.online, 'a PLAY SOLO match runs on the in-process LocalLoopback (GDD §4.2)').toBe(false);

  return {
    seats: before.seats,
    cast: built.cast,
    mapId: built.mapId,
    stations: built.stations,
    online: before.online,
    firstTick: pause.simTicks,
  };
}

/**
 * Open the minimap overlay with the player's OWN control (the `M` key, GDD §2.4)
 * and hand back the settled frame.
 *
 * The overlay rather than the docked corner map for one reason: it is the same fog
 * decision drawn at 560 px instead of 148, and a proof whose evidence a human
 * cannot read is half a proof. The toggle is also a real press — a picture reached
 * by a keystroke is a picture that is reachable.
 */
async function shootMinimap(page: Page): Promise<{ png: Buffer; img: Img }> {
  await page.keyboard.press('KeyM');
  await settleFrames(page, 6);
  const png = await page.screenshot();
  return { png, img: decode(png) };
}

test('offline TEAMS through the real lobby: the human sees what only a bot ally covers — and the same match in FFA sees none of it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one control profile — fog has no device term (see the file header)');
  budgetTest({
    work:
      'TWO clean boots of the shipped bundle, each: menu → PLAY → PLAY SOLO → lobby → (TEAMS) MODE → RUSH! → match assembles → 60 sim ticks → M → settle → full-frame capture; then a 313,600-pixel comparison of the pair',
    measuredSeconds: 34,
  });

  const frames: Record<'teams' | 'ffa', Img> = {} as Record<'teams' | 'ffa', Img>;
  const shots: Record<'teams' | 'ffa', Buffer> = {} as Record<'teams' | 'ffa', Buffer>;
  /** The sim tick each frame was actually shot at — attached with the numbers, so
   *  a surprising census in CI can be read against the clock that produced it. */
  const shotTicks: Record<'teams' | 'ffa', number> = {} as Record<'teams' | 'ffa', number>;

  for (const mode of ['teams', 'ffa'] as const) {
    const built = await bootLobbyMatch(page, mode);
    // Same arena, same eight seats, same seven characters, in both runs — the pair
    // differs by the MODE press and by nothing else. Asserted rather than assumed:
    // if the two runs ever build different boards, the comparison below is void.
    expect(built.mapId, 'both runs build the persisted default arena').toBe('octagon');
    expect(built.cast, 'both runs seat the same seven characters').toEqual([
      null,
      'rusty',
      'bolt',
      'foreman',
      'patch',
      'sable',
      'vulture',
      'warden',
    ]);

    // Land at the same point of the MATCH in both runs — `firstTick` + SHOT_TICK,
    // not "60 ticks after the last read-back finished". The two runs do not cost
    // the same number of CDP round trips (the FFA one presses MODE a different
    // number of times), and timing off "now" is how a frame that should be pinned
    // starts drifting with the host's speed instead.
    const now = await page.evaluate(() => window.__pauseStage!.read().simTicks);
    const owed = built.firstTick + SHOT_TICK - now;
    if (owed > 0) {
      await waitForSimTicks(page, owed, {
        instrument: 'pause',
        what: `${mode}: ${SHOT_TICK} ticks of match before the frame`,
      });
    }
    // The human has pressed nothing since RUSH!, so their ship is where it spawned
    // — which is what pins their coverage identically in both runs.
    const ship = await page.evaluate(() => window.__pauseStage!.read().ship);
    expect(ship, 'the local ship is on the board').not.toBeNull();

    shotTicks[mode] = await page.evaluate(() => window.__pauseStage!.read().simTicks);
    const { png, img } = await shootMinimap(page);
    shots[mode] = png;
    frames[mode] = img;
    await testInfo.attach(`minimap-${mode}`, { body: png, contentType: 'image/png' });
  }

  // ── 0. The premise: both frames were shot inside the band the thresholds below
  //       were measured across ({@link SHOT_TICK_CEILING}). This is not a claim
  //       about fog; it is the guard that stops a slow or wedged boot from turning
  //       a measured comparison into a comparison of two unrelated moments.
  for (const mode of ['teams', 'ffa'] as const) {
    expect(
      shotTicks[mode],
      `the ${mode} frame was shot inside the tick band this test's numbers were measured over`,
    ).toBeLessThan(SHOT_TICK_CEILING);
  }

  const pair = comparePair(frames.teams, frames.ffa);

  // ── 1. The human's OWN sight is unchanged, and TEAMS only ever ADDS ───────
  // Free-for-all is teams-of-one, so the FFA frame's revealed set IS exactly the
  // discs the human projects alone. Every one of those pixels must still be
  // revealed in TEAMS: shared vision is a union, and a union cannot subtract.
  expect(
    pair.ffaOnly,
    'no pixel the human could see alone went dark when they gained teammates — the team read is a UNION',
  ).toBe(0);

  // ── 2. …and it adds a lot, all of it outside every disc of the human's ────
  // 76,147 px measured on this build — a quarter of the whole arena. The floor is
  // set well under that because it is a claim about "an ally's coverage is on my
  // map", not a pinned number; a build that shares nothing scores 0 here.
  expect(
    pair.allyOnly,
    'a large area of the arena is revealed to the human in TEAMS that is FOG in the identical FFA match',
  ).toBeGreaterThan(40_000);
  expect(pair.teamsRevealed, 'TEAMS reveals strictly more of the arena than FFA').toBeGreaterThan(pair.ffaRevealed);

  // ── 3. The bot ALLIES are on the human's map, and only in ally-only territory.
  //       Since a0-110 their dots are the FRIENDLY SIDE colour rather than each
  //       bot's own (`src/ui/minimap.ts` MINIMAP_SIDE_COLORS) — see `sidePixels`
  //       for what that costs this assertion and what it does not. The side table
  //       the LOBBY authored is still checked, from the table itself: slots 2, 4
  //       and 6 are `defaultTeamForSlot(i) === defaultTeamForSlot(0)`.
  expect(ALLIES, 'a default TEAMS lobby gives the human three bot allies at eight seats').toEqual([2, 4, 6]);
  const alliesTeams = sidePixels(frames.teams, frames.ffa, 'friendly');
  const alliesFfa = sidePixels(frames.ffa, frames.ffa, 'friendly');
  expect(
    alliesTeams.inAllyOnly,
    'ally marks are drawn on the human\'s minimap in TEAMS, out where their own coverage does not reach',
  ).toBeGreaterThan(300);
  expect(
    alliesFfa.inAllyOnly,
    'in the identical FFA match there is no ally ink out there at all',
  ).toBe(0);

  // ── 4. The human's own dot is on both maps — the control that says the
  //       comparison is between two live minimaps and not against a blank one.
  //       The human wears the friendly colour too (a0-110), so what separates
  //       them from their allies here is exactly what separates them on screen:
  //       theirs is the friendly ink INSIDE their own coverage.
  expect(alliesFfa.inOwnCoverage, 'the human is on their own FFA map').toBeGreaterThan(300);
  expect(alliesTeams.inOwnCoverage, 'the human is on their own TEAMS map').toBeGreaterThan(300);

  // ── 5. Whatever the human can see of the OTHER side, they see it through a
  //       teammate and nowhere else.
  //
  //       Stated as an implication rather than as "no enemy is visible", because
  //       whether one is depends on where the bots have flown: the census run for
  //       this spec found the enemy side wholly fogged at ticks 30, 60 and 120 and
  //       an enemy home inside an ally's disc by tick 300. Pinning the absence
  //       would be pinning a bot's flight path, which is the flake this file must
  //       not have. What is invariant at every tick measured — 30 through 900 — is
  //       that every enemy pixel the human's map carries sits outside the human's
  //       own coverage. That is the brief's *"an enemy ship sitting in that area
  //       appears on the human's minimap"*, in the form that cannot flake; Act 2
  //       proves the same thing with the enemy parked deliberately.
  expect(ENEMIES, 'the other side is slots 1, 3, 5, 7').toEqual([1, 3, 5, 7]);
  const enemiesSeen = sidePixels(frames.teams, frames.ffa, 'enemy');
  expect(
    enemiesSeen.inOwnCoverage,
    "every pixel of the enemy side the human can see is one a teammate's coverage bought them",
  ).toBe(0);
  expect(enemiesSeen.inAllyOnly, 'stated the other way round, for the same population').toBe(
    enemiesSeen.drawn,
  );

  // …and the union widened the VIEWER'S SIDE, not the world: most of the arena is
  // still fog. A read that had quietly become "reveal everything" passes 1–4 and
  // fails here.
  const mapPixels = MAP.width * MAP.height;
  expect(
    pair.teamsRevealed,
    'shared vision is not omniscience — most of the claim is still dark for the human',
  ).toBeLessThan(mapPixels * 0.75);

  // ── 6. Static geography a teammate alone is standing over: the ore field.
  //       Gold hints inside ally-only territory, and by construction none in FFA,
  //       where that territory is fog.
  expect(
    pair.oreInAllyOnly,
    "ore the human cannot reach is on their map because a teammate's coverage is over it",
  ).toBeGreaterThan(300);
  const oreInFfa = count(frames.ffa, MAP_REGION, isOreHint);
  const oreInTeams = count(frames.teams, MAP_REGION, isOreHint);
  expect(oreInTeams.matched, 'the TEAMS map carries more of the ore field than the FFA one').toBeGreaterThan(
    oreInFfa.matched,
  );

  writeEvidence('lobby-teams-minimap.png', shots.teams);
  writeEvidence('lobby-ffa-minimap.png', shots.ffa);
  await attachSummary(testInfo, 'act-1-lobby-pair', {
    shotTicks,
    allies: ALLIES,
    enemies: ENEMIES,
    // Per-SIDE since a0-110 — see `sidePixels`. The per-slot census this used to
    // carry is not recoverable from the pixels any more, by ratified design.
    sides: (['friendly', 'enemy'] as const).map((side) => ({
      side,
      teams: sidePixels(frames.teams, frames.ffa, side),
      ffa: sidePixels(frames.ffa, frames.ffa, side),
    })),
    // The slot->side table itself still travels in the summary; what no longer
    // does is a per-slot PIXEL census, which a0-110 made unrecoverable from this
    // surface on purpose.
    slots: [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => ({ slot, side: defaultTeamForSlot(slot) })),
    ...pair,
    oreInFfa: oreInFfa.matched,
    oreInTeams: oreInTeams.matched,
  });
});

// ---------------------------------------------------------------------------
// Act 2 — the four rules, on the client's own minimap seam
// ---------------------------------------------------------------------------

/** Boot the harness match frozen, the way the golden suite waits: canvas
 *  attached, the sim reporting itself pinned, fonts in, then COUNTED frames. */
async function bootFrozen(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settleFrames(page, 6);
}

/**
 * Force the minimap's cached content to rebuild, through the real `M` toggle.
 *
 * Not belt-and-braces — required. The overlay's content is a cached texture
 * rebuilt every `MINIMAP_REDRAW_TICKS` sim ticks **or on a state change**
 * (`src/ui/minimap-view.ts`). Under `?freeze=1` the tick never advances, so
 * without the toggle the seam would report the scene as it was at the first
 * rebuild however many times the world is re-staged: the sim numbers would move
 * and the drawn ones would not. Closing and reopening is the state change that
 * forces an honest redraw, and it is a player's own keystroke.
 */
async function redrawMinimap(page: Page): Promise<ReturnType<MinimapSeam['state']>> {
  if (await page.evaluate(() => window.__minimapStage!.state().expanded)) {
    await page.keyboard.press('KeyM');
    await settleFrames(page, 4);
  }
  await page.keyboard.press('KeyM');
  await settleFrames(page, 4);
  const drawn = await page.evaluate(() => window.__minimapStage!.state());
  expect(drawn.expanded, 'the minimap overlay is open after the toggle').toBe(true);
  return drawn;
}

test('offline TEAMS, staged: an ally-only disc reveals a rival, their scouting is remembered, and their death collapses it the same tick', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one control profile — fog has no device term (see the file header)');
  budgetTest({
    work:
      'frozen 2v2 offline TEAMS boot → stage an ally across the arena with a rival under their sensor → four staged states, each with a real M-toggle redraw and a drawn-frame read-back → one FFA control boot',
    measuredSeconds: 60,
  });

  // A 2v2 rather than the default 4v4: with ONE teammate, every disc over there is
  // theirs and the frames are unambiguous. The size travels the shipped way — the
  // debug boot reads the size the lobby last RUSHed with out of its own storage key
  // (src/main.ts `readMatchSize`), so this is the same request the lobby's size
  // control makes, not a back door into the world.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('planet-rush:matchSize', '4');
    } catch {
      /* storage disabled — the default size still boots, and the test still runs */
    }
  });

  await bootFrozen(page, '/?debug=1&freeze=1&sides=2');
  await page.waitForFunction(() => typeof window.__teamFogStage?.stage === 'function', undefined, { timeout: 20_000 });

  const staged = await page.evaluate(() => window.__teamFogStage!.stage());
  expect(staged, 'the stage found an ally to post and a rival to park under their sensor').not.toBeNull();
  // "A map big enough that an ally can sit outside every disc the human projects":
  // the clearance is how far the ally stands beyond the EDGE of the nearest disc
  // the viewer projects alone. Anything the viewer sees over there is the ally's
  // coverage and can be nothing else.
  expect(staged!.clearance, "the ally is posted well outside every one of the human's own discs").toBeGreaterThan(500);

  // ── BEFORE: the same world, the same tick, that ship on the ENEMY side ────
  await page.evaluate(() => window.__teamFogStage!.share(false));
  const before = await redrawMinimap(page);
  const beforeSim = await page.evaluate(() => window.__teamFogStage!.state());
  expect(beforeSim.allyOnYourSide, 'the staged ship is a stranger for this frame').toBe(false);
  expect(before.coverageCount, "only the human's own discs are drawn").toBe(beforeSim.ownDiscs);
  expect(before.shipCount, 'no rival is on the map: nobody of yours is near one').toBe(0);
  await testInfo.attach('act2-1-ally-not-yours', { body: await page.screenshot(), contentType: 'image/png' });

  // ── AFTER: one thing changes — that ship is on your side ─────────────────
  await page.evaluate(() => window.__teamFogStage!.share(true));
  const after = await redrawMinimap(page);
  const afterSim = await page.evaluate(() => window.__teamFogStage!.state());
  expect(afterSim.allyOnYourSide, 'the same ship, now a teammate').toBe(true);
  expect(after.coverageCount, "the teammate's discs are drawn on the human's map").toBeGreaterThan(
    before.coverageCount,
  );
  expect(
    afterSim.sensedRivals,
    'the rival parked under the teammate\'s sensor is now in the human\'s sensed set',
  ).toContain(staged!.rival);
  expect(after.shipCount, 'and a live enemy DOT is drawn for them').toBeGreaterThan(before.shipCount);
  expect(after.stationCount, "the teammate's half of the board arrives with them").toBeGreaterThan(
    before.stationCount,
  );
  const afterEvidence = await page.screenshot();
  await testInfo.attach('act2-2-ally-is-yours', { body: afterEvidence, contentType: 'image/png' });

  // ── REMEMBERED: the teammate flies over a distant field and comes back ────
  const scouted = await page.evaluate(() => window.__teamFogStage!.scout());
  expect(scouted, 'the stage flew the ally over the furthest ore field').not.toBeNull();
  expect(scouted!.learned, 'the sim\'s own memory fold recorded rocks the human has never been near').toBeGreaterThan(0);
  const remembered = await redrawMinimap(page);
  const rememberedSim = await page.evaluate(() => window.__teamFogStage!.state());
  expect(remembered.oreCount, 'the scouted field stays on the map after the ally leaves it').toBeGreaterThan(
    after.oreCount,
  );
  expect(rememberedSim.rememberedOre, "the ore half of the SIDE's memory grew").toBeGreaterThan(
    afterSim.rememberedOre,
  );
  await testInfo.attach('act2-3-remembered', { body: await page.screenshot(), contentType: 'image/png' });

  // ── COLLAPSE: the tick after the teammate's ship dies ────────────────────
  const killed = await page.evaluate(() => window.__teamFogStage!.killAlly());
  expect(killed, 'the stage killed the posted ally').not.toBeNull();
  const dead = await redrawMinimap(page);
  const deadSim = await page.evaluate(() => window.__teamFogStage!.state());
  expect(dead.coverageCount, "the dead ally's own disc is gone — live coverage is recomputed, never remembered").toBe(
    remembered.coverageCount - 1,
  );
  expect(deadSim.sensedRivals, 'and the rival who was only under it drops off the human\'s map').toEqual([]);
  expect(dead.shipCount, 'no live enemy dot survives the coverage that carried it').toBe(0);
  // …while the geography a teammate taught them does NOT collapse. This is the
  // live/remembered split, across a side: a home does not move, and neither does
  // a rock (GDD §2.7; src/sim/sensing.ts).
  expect(dead.stationCount, 'the stations the teammate showed them stay').toBe(remembered.stationCount);
  expect(dead.oreCount, 'and so does the field they scouted').toBe(remembered.oreCount);
  expect(deadSim.rememberedMask, 'the remembered station mask is untouched by the death').toBe(
    rememberedSim.rememberedMask,
  );
  const deadEvidence = await page.screenshot();
  await testInfo.attach('act2-4-collapse', { body: deadEvidence, contentType: 'image/png' });

  // ── THE CONTROL: the same harness boot with no sides at all is FFA, and the
  //     team read collapses to the viewer alone — by construction rather than by
  //     a mode check (src/sim/sensing.ts: every player's team defaults to their
  //     own id, so the union over `sameSide` is "self").
  await bootFrozen(page, '/?debug=1&freeze=1');
  await page.waitForFunction(() => typeof window.__teamFogStage?.state === 'function', undefined, { timeout: 20_000 });
  const ffa = await page.evaluate(() => window.__teamFogStage!.state());
  const ffaDrawn = await redrawMinimap(page);
  expect(ffa.ally, 'in free-for-all there is nobody on your side but you').toBeNull();
  expect(ffa.teamDiscs, "so the team's coverage IS the viewer's own, disc for disc").toBe(ffa.ownDiscs);
  expect(ffaDrawn.coverageCount, 'and the map draws exactly those').toBe(ffa.ownDiscs);
  expect(ffa.sensedRivals, 'no rival is sensed through anybody').toEqual([]);
  expect(ffaDrawn.shipCount, 'and no enemy dot is drawn').toBe(0);
  await testInfo.attach('act2-5-ffa-control', { body: await page.screenshot(), contentType: 'image/png' });

  writeEvidence('staged-teams-ally-shared.png', afterEvidence);
  writeEvidence('staged-teams-ally-dead.png', deadEvidence);
  await attachSummary(testInfo, 'act-2-staged', {
    staged,
    before: { drawn: before, sim: beforeSim },
    after: { drawn: after, sim: afterSim },
    remembered: { drawn: remembered, sim: rememberedSim },
    dead: { drawn: dead, sim: deadSim },
    ffa: { drawn: ffaDrawn, sim: ffa },
  });
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Where a capture run drops the PR's frames. */
const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../evidence/a0-43-team-fog-offline');

/**
 * Write a frame into `evidence/` — but only when explicitly asked
 * (`A0_43_CAPTURE=1 npm run test:mobile -- team-fog-offline`).
 *
 * A test that writes into the working tree on every CI run is a test that makes
 * `git status` lie, so the default is to write nothing: the frames ride the run as
 * Playwright ATTACHMENTS (uploaded with `playwright-report/` by ci.yml) and the
 * committed pair in `evidence/` is regenerated deliberately, by the command in
 * that folder's README.
 */
function writeEvidence(name: string, png: Buffer): void {
  if (!process.env.A0_43_CAPTURE) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, name), png);
}

/** Attach the numbers behind the pictures, so a failing run in CI is diagnosable
 *  from the report rather than only from a reproduction. */
async function attachSummary(testInfo: TestInfo, name: string, body: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  });
}
