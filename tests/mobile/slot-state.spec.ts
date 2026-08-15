/**
 * tests/mobile/slot-state.spec.ts — the lobby's seat-state affordance, on a
 * phone. OWNER: UI Engineer (u5-01).
 *
 * ── THE DEFECT THIS SUITE EXISTS FOR ───────────────────────────────────────
 * Developer, 2026-08-05: *"theres no way visible way to know that you can close
 * slots right now."* The OPEN → BOT → CLOSED cycle worked — it fired on a plain
 * tap of a roster row's body — and **nothing was drawn to say so**. So every test
 * that asserted the cycle *works* passed on every day the bug existed, which is
 * exactly why this file asserts something else: that the control is **drawn**,
 * **named**, **where it should be**, and **honest about being dead**.
 *
 * It lives in the mobile suite rather than in a unit test for the reason the
 * mobile suite exists at all (`playwright.config.ts`): Planet Rush draws its
 * whole presentation into one PixiJS/WebGL canvas, so a model that returns the
 * right label proves nothing about a screen that never painted it — and the M1
 * miss this suite was created by was *invisible touch UI*, the identical failure
 * mode one screen earlier. This is primarily a TOUCH discoverability defect, so
 * the phone profiles are the point and the desktop project is the control.
 *
 * ── HOW IT TESTS ───────────────────────────────────────────────────────────
 * **The door is tested as a door.** Every press here is real synthesized input on
 * the canvas — a CDP touch on the phones, a mouse click on the desktop — landing
 * on the physical point the app itself reports for the control, through the
 * landscape-lock rotation. Nothing is driven by calling a seam method. The
 * `window.__lobby` seam is read-only here: it is how the test *observes* what the
 * screen did, never how it opens it.
 *
 * **Pixels decide "drawn".** The control's rect is turned into a screenshot
 * region and the pixels inside it are counted, against the frozen palette
 * (style-guide §1): a live control carries a plasma edge, a dead one does not.
 * That comparison is made *within one frame* — the row you sit in is permanently
 * un-cyclable while the row below it is live — so "dead looks different from
 * live" is proven without racing a countdown.
 *
 * ── ORIENTATION ────────────────────────────────────────────────────────────
 * The phone projects declare PORTRAIT viewports, and portrait is deliberately the
 * case walked here: the developer holds the phone, the landscape lock rotates the
 * screen, and the tap has to un-rotate back onto the logical control. Landscape
 * is walked too, in the second test, because both are real ways to hold it.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { decode, count, isNonVacuum, type Img, type Pred, type Region } from './pixels';
import { budgetTest } from './budgets';

const TOUCH_PROJECTS = ['iphone', 'pixel'];
const isTouchProject = (name: string): boolean => TOUCH_PROJECTS.includes(name);

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The `window.__mainMenu` seam (src/main.ts `MenuSeam`) — only PLAY is needed. */
interface MenuSeam {
  readonly visible: boolean;
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly controls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
}

/** The `window.__onlineMenu` seam — PLAY SOLO, the offline door. */
interface DoorsSeam {
  readonly visible: boolean;
  readonly doorControls: ReadonlyArray<{
    readonly kind: string;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  }>;
}

/** One row's STATE control, as the lobby reports having drawn it (u5). */
interface StateControl {
  readonly index: number;
  readonly label: string;
  readonly live: boolean;
  readonly logical: Rect;
  readonly physicalCenter: { readonly x: number; readonly y: number };
  readonly physicalBounds: Rect;
}

/** The `window.__lobby` seam (src/main.ts `LobbySeam`), narrowed to what u5 reads. */
interface LobbySeam {
  readonly visible: boolean;
  readonly slotCount: number;
  readonly online: boolean;
  readonly isHost: boolean;
  readonly size: number;
  readonly counting: boolean;
  readonly content: Rect;
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly seatRows: readonly Rect[];
  readonly seatStates: readonly StateControl[];
  readonly rushControl: {
    readonly logical: Rect;
    readonly physicalCenter: { readonly x: number; readonly y: number };
  };
}

// --- Thresholds -------------------------------------------------------------

/**
 * Device pixels of *anything at all* inside a control's own rect, below which the
 * control is not on the screen. Deliberately a low bar: this is the "was it drawn"
 * check, and the defect it guards against draws NOTHING — the number that matters
 * is 0 vs. hundreds, not the exact hundreds. A 52×13 CSS-px control at dpr 3 is
 * ~6000 device pixels, of which the border and the word are a healthy slice.
 */
const DRAWN_MIN_PX = 60;

/**
 * …and of the BRIGHT HAIRLINE specifically, which is the "reads as pressable"
 * edge a live control carries and a dead one does not.
 *
 * **It used to be plasma** (`./pixels` `isPlasma`, keyed off the frozen
 * `#4DC3FF`), because the lobby's selection accent was plasma. The ratified
 * Gantry/Bone direction spends **no hue at all** on a menu — *"the primary action
 * is simply the brightest plate on screen … it spends no colour on the menu,
 * which leaves the palette's hues free to mean things during a match"* — so a
 * live control is now the brightest METAL rather than the only blue thing, and
 * the predicate has to move with it or it would be testing a colour the
 * direction deliberately removed.
 *
 * What the test asserts is unchanged, and it is the thing that matters: a
 * control the host can cycle reads differently from one they cannot, within one
 * frame, in pixels.
 */
const LIVE_EDGE_MIN_PX = 20;

/**
 * A Bone hairline: a bright, COOL NEUTRAL pixel — no channel warmer than blue,
 * and light enough to be the bordered edge of a `secondary` chip rather than the
 * shaded face of an `inert` one. `boneLo` is `#8c95a0`, the face tones are all
 * under `#33`, so the bar sits between them with room on both sides.
 */
const isBoneEdge: Pred = (r, g, b) => b >= g && g >= r && b >= 110 && b - r < 40;

// --- Input ------------------------------------------------------------------

/** A real physical tap at a raw canvas coordinate: CDP touch on the phones, a
 *  mouse click on the desktop control. The app's own pointer handlers see the
 *  same event a finger or a mouse produces — no seam is called. */
async function press(page: Page, projectName: string, x: number, y: number): Promise<void> {
  if (!isTouchProject(projectName)) {
    await page.mouse.click(Math.round(x), Math.round(y));
    return;
  }
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

// --- Fixtures ---------------------------------------------------------------

async function setOrientation(page: Page, mode: 'landscape' | 'portrait'): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const isLandscape = vp.width >= vp.height;
  if (isLandscape !== (mode === 'landscape')) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
}

/** Boot the real preview build clean (no `?debug=1`, which skips the lobby by
 *  contract) and walk the ratified play flow to the lobby with REAL presses:
 *  PLAY → the doors → PLAY SOLO → the roster.
 *
 *  `?gate=0` because this walks through the front door on its way somewhere
 *  else, and the title gate (a0-50) is a DOOR — a thing a person operates. The
 *  flag turns off that screen and nothing else: the menu, the doors and the
 *  lobby below are the real ones. See `src/ui/title-gate.ts` `gateEnabled`. */
async function pressThroughToLobby(page: Page, projectName: string): Promise<void> {
  await page.goto('/?gate=0');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu;
      return !!m && m.visible && m.controls.length > 0 && m.logicalViewport.width > 0;
    },
    undefined,
    { timeout: 30_000 },
  );

  const play = await page.evaluate(() => {
    const c = (window as unknown as { __mainMenu?: MenuSeam }).__mainMenu?.controls.find(
      (x) => x.kind === 'play',
    );
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(play, 'PLAY control present on a clean boot').not.toBeNull();
  await press(page, projectName, play!.x, play!.y);

  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu;
      return !!d && d.visible && d.doorControls.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const solo = await page.evaluate(() => {
    const c = (window as unknown as { __onlineMenu?: DoorsSeam }).__onlineMenu?.doorControls.find(
      (x) => x.kind === 'solo',
    );
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  expect(solo, 'PLAY SOLO door present').not.toBeNull();
  await press(page, projectName, solo!.x, solo!.y);

  await page.waitForFunction(
    () => {
      const l = (window as unknown as { __lobby?: LobbySeam }).__lobby;
      return !!l && l.visible && l.slotCount > 0 && l.seatStates.length > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Snapshot the lobby seam (structured-cloned, so the live object cannot shift
 *  under the assertions that read it). */
async function readLobby(page: Page): Promise<LobbySeam> {
  const s = await page.evaluate(() => {
    const l = (window as unknown as { __lobby?: LobbySeam }).__lobby;
    if (!l) return null;
    return {
      visible: l.visible,
      slotCount: l.slotCount,
      online: l.online,
      isHost: l.isHost,
      size: l.size,
      counting: l.counting,
      content: { ...l.content },
      logicalViewport: { ...l.logicalViewport },
      seatRows: l.seatRows.map((r) => ({ ...r })),
      seatStates: l.seatStates.map((c) => ({
        index: c.index,
        label: c.label,
        live: c.live,
        logical: { ...c.logical },
        physicalCenter: { ...c.physicalCenter },
        physicalBounds: { ...c.physicalBounds },
      })),
      rushControl: {
        logical: { ...l.rushControl.logical },
        physicalCenter: { ...l.rushControl.physicalCenter },
      },
    } satisfies LobbySeam;
  });
  expect(s, '__lobby present after PLAY SOLO').not.toBeNull();
  return s as LobbySeam;
}

/** A control's own physical rect as a screenshot region. The shot is the CSS
 *  viewport scaled uniformly by the device pixel ratio, so CSS px ÷ CSS viewport
 *  is the fraction the region wants — no dpr arithmetic and no assumption about
 *  which orientation the canvas ended up in. */
function regionOf(bounds: Rect, vp: { width: number; height: number }): Region {
  return {
    x0: bounds.x / vp.width,
    y0: bounds.y / vp.height,
    x1: (bounds.x + bounds.width) / vp.width,
    y1: (bounds.y + bounds.height) / vp.height,
  };
}

/**
 * Just the control's LEADING BORDER — a 4px strip down its left edge, with the
 * top and bottom fifths trimmed off.
 *
 * The affordance being measured is the chip's own hairline, and the two things
 * that would otherwise swamp it both live outside this strip: the WORD, which is
 * centred and is bright on a dead control too (a dead control still has to say
 * `TAKEN`), and the *"this row is yours"* marker, which runs along the row's top
 * and bottom edges. Trimming to the border is what makes the count a fact about
 * whether the control reads pressable rather than about how many letters it has.
 */
function edgeRegion(bounds: Rect, vp: { width: number; height: number }): Region {
  const trim = bounds.height * 0.2;
  return {
    x0: bounds.x / vp.width,
    y0: (bounds.y + trim) / vp.height,
    x1: (bounds.x + 4) / vp.width,
    y1: (bounds.y + bounds.height - trim) / vp.height,
  };
}

function contains(outer: Rect, inner: Rect, tol = 0.5): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
}

async function shoot(page: Page): Promise<Img> {
  return decode(await page.screenshot());
}

// ===========================================================================
// 1. The affordance: it is DRAWN, it is NAMED, and it is where it says it is
// ===========================================================================

test('every roster row draws a labelled seat-state control, in its row, in pixels', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'portrait boot → press PLAY → doors → press PLAY SOLO → lobby → screenshot → pixel-check all eight state controls',
    measuredSeconds: 11,
  });

  // Portrait: the way the phone is held when the developer looked at this screen
  // and could not tell a slot could be closed. The landscape lock rotates the
  // canvas; the control's reported physical box has to come back through it.
  await setOrientation(page, 'portrait');
  await pressThroughToLobby(page, testInfo.project.name);

  const lobby = await readLobby(page);
  expect(lobby.online, 'the SOLO door opens the offline lobby').toBe(false);
  expect(lobby.isHost, 'offline you are the host, so the slot editor is live').toBe(true);
  expect(lobby.seatStates, 'one state control per seat (GDD §2.1 — eight slots)').toHaveLength(
    lobby.slotCount,
  );

  const vp = page.viewportSize()!;
  const img = await shoot(page);

  for (const control of lobby.seatStates) {
    const row = lobby.seatRows[control.index]!;
    const tag = `row ${control.index}`;

    // 1. NAMED — with a word from the model's own vocabulary. A control that
    //    states the current state cannot state it as ''.
    expect(['OPEN', 'BOT', 'CLOSED', 'TAKEN'], `${tag}: unknown state word`).toContain(control.label);

    // 2. WHERE IT SAYS IT IS — inside its own row (its anchor), inside the safe
    //    content box, and at the row's LEADING edge, which is the shape that has
    //    to survive a later re-skin.
    expect(contains(row, control.logical), `${tag}: control escapes its row`).toBe(true);
    expect(contains(lobby.content, control.logical), `${tag}: control escapes the content box`).toBe(
      true,
    );
    expect(control.logical.x, `${tag}: control is not leading`).toBeLessThan(row.x + row.width / 2);

    // 3. DRAWN — the assertion the whole brief reduces to. Every pixel of this
    //    control's own rect was vacuum on the build the developer reported.
    const region = regionOf(control.physicalBounds, vp);
    const ink = count(img, region, isNonVacuum);
    expect(ink.total, `${tag}: control maps to an empty screenshot region`).toBeGreaterThan(0);
    expect(ink.matched, `${tag}: nothing is drawn where the control claims to be`).toBeGreaterThan(
      DRAWN_MIN_PX,
    );
  }
});

// ===========================================================================
// 2. Honesty: a live control reads pressable, a dead one does not
// ===========================================================================

test('the control reads pressable where it works and dead where it refuses', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'landscape boot → press through to the lobby → screenshot → compare the Bone edge on a live row against the un-cyclable one → press RUSH! → re-read',
    measuredSeconds: 14,
  });

  // Landscape this time — the orientation the game is played in, and the other
  // half of "cover both paths explicitly".
  await setOrientation(page, 'landscape');
  await pressThroughToLobby(page, testInfo.project.name);

  const lobby = await readLobby(page);
  const vp = page.viewportSize()!;
  const img = await shoot(page);

  // Your own seat can never be cycled — you are sitting in it — so its control is
  // permanently dead, while the rows below it are live. Both are on screen in the
  // SAME frame, which is what makes this comparison a fact about the drawing
  // rather than a race against a countdown.
  const dead = lobby.seatStates.find((c) => !c.live);
  const live = lobby.seatStates.find((c) => c.live);
  expect(dead, 'a lobby with a seat you cannot cycle (your own)').toBeTruthy();
  expect(live, 'a lobby with a seat the host can cycle').toBeTruthy();
  expect(dead!.label, 'the seat you are sitting in reads as taken').toBe('TAKEN');

  const liveEdge = count(img, edgeRegion(live!.physicalBounds, vp), isBoneEdge).matched;
  const deadEdge = count(img, edgeRegion(dead!.physicalBounds, vp), isBoneEdge).matched;

  // A live control carries the bright Bone hairline every other pressable thing
  // on this screen carries (the MODE / ORE chips, the difficulty chip, the
  // selected hull tile)…
  expect(liveEdge, 'a live state control has no bright edge — it does not read as pressable').toBeGreaterThan(
    LIVE_EDGE_MIN_PX,
  );
  // …and the dead one does not wear it. A dead-looking button beats a lying one:
  // this is the assertion that a guest, a locked lobby or an occupied seat cannot
  // be given a control that looks live and then refuses.
  expect(deadEdge, 'an un-cyclable seat is drawn as if it were pressable').toBeLessThan(liveEdge / 2);
  // …but it is still DRAWN, in steel — dead is not absent. The row still has to
  // say what state it is in.
  expect(
    count(img, regionOf(dead!.physicalBounds, vp), isNonVacuum).matched,
    'the un-cyclable control vanished instead of going dim',
  ).toBeGreaterThan(DRAWN_MIN_PX);

  // …and past RUSH! the whole roster goes dead, because the match shape is locked
  // (`./ui/lobby` `cycleSeatState` refuses, so the control must stop inviting).
  // Read inside the countdown, in ONE evaluate that waits and captures together —
  // never a round trip that could land after the match has taken the screen.
  await press(page, testInfo.project.name, lobby.rushControl.physicalCenter.x, lobby.rushControl.physicalCenter.y);
  const counting = await page.evaluate(
    () =>
      new Promise<{ counting: boolean; live: number; labels: string[] }>((resolve) => {
        const step = (): void => {
          const l = (window as unknown as { __lobby?: LobbySeam }).__lobby;
          if (l?.counting) {
            resolve({
              counting: true,
              live: l.seatStates.filter((c) => c.live).length,
              labels: l.seatStates.map((c) => c.label),
            });
            return;
          }
          requestAnimationFrame(step);
        };
        step();
      }),
  );
  expect(counting.counting, 'RUSH! started the countdown').toBe(true);
  expect(counting.live, 'a state control is still live after RUSH!').toBe(0);
  // …and the words are unchanged: the lobby went read-only, it did not lie about
  // what the match is made of.
  expect(counting.labels.every((l) => ['OPEN', 'BOT', 'CLOSED', 'TAKEN'].includes(l))).toBe(true);
});

// ===========================================================================
// 3. The door as a door: a real press on it closes a slot
// ===========================================================================

test('a real press on the control walks BOT ⇄ CLOSED and shrinks the match — and never offers OPEN', async ({
  page,
}, testInfo) => {
  budgetTest({
    work: 'portrait boot → press through to the lobby → three real presses on one row’s state control → read the label and N back',
    measuredSeconds: 15,
  });

  await setOrientation(page, 'portrait');
  await pressThroughToLobby(page, testInfo.project.name);

  const before = await readLobby(page);
  // The SOLO lobby opens on the bot cast (a0-11; GDD §2.1 amended 2026-08-07 —
  // an OPEN seat means "waiting for a human", and offline there is no wire for
  // one to arrive on, so it would be a chair nobody could ever take). Since a0-31
  // that is true of the CONTROL as well as of the opening state: the solo ring is
  // BOT ⇄ CLOSED, two rungs, and OPEN is not one of them.
  const target = before.seatStates.find((c) => c.live && c.label === 'BOT');
  expect(target, 'a BOT seat the host can cycle').toBeTruthy();
  const slot = target!.index;
  expect(before.size, 'the offline lobby opens on a full house').toBe(before.slotCount);

  /** Press this row's control for real, then wait for the label the press should
   *  produce. The wait is the assertion: a press that missed leaves the old word. */
  const pressControl = async (expected: string): Promise<LobbySeam> => {
    const now = await readLobby(page);
    const control = now.seatStates[slot]!;
    // Re-read every time: the row re-renders under the finger, and pressing a
    // remembered point is how a test passes against geometry that has moved.
    expect(control.physicalCenter.x, 'the press point is off-canvas').toBeGreaterThanOrEqual(0);
    expect(control.physicalCenter.y, 'the press point is off-canvas').toBeGreaterThanOrEqual(0);
    await press(page, testInfo.project.name, control.physicalCenter.x, control.physicalCenter.y);
    await page.waitForFunction(
      ([i, want]) =>
        (window as unknown as { __lobby?: LobbySeam }).__lobby?.seatStates[i as number]?.label === want,
      [slot, expected] as [number, string],
      { timeout: 15_000 },
    );
    return readLobby(page);
  };

  // BOT → CLOSED: the state the developer could not find. N drops by one, which
  // is the whole point of the control — this is how a host runs a 3-station duel.
  const closed = await pressControl('CLOSED');
  expect(closed.size, 'closing a slot did not shrink the match').toBe(before.size - 1);

  // CLOSED → BOT: the control is the way back, so a slot shut by accident is one
  // press from carrying a bot again. This press used to land on OPEN — an empty
  // chair, out of the match, that a joiner could take. Nobody can join a solo
  // lobby, so a0-31 took that rung out: *"in solo play there should be no slot
  // open it's either closed or bot."*
  const reopened = await pressControl('BOT');
  expect(reopened.size, 'seating a bot did not restore the match size').toBe(before.size);

  // A third press proves it is a RING and not a truncated line: it lands back on
  // CLOSED, and at no point in the walk did any row read OPEN.
  const shutAgain = await pressControl('CLOSED');
  expect(shutAgain.size, 'the second close did not shrink the match').toBe(before.size - 1);
  for (const seen of [before, closed, reopened, shutAgain]) {
    expect(
      seen.seatStates.filter((c) => c.label === 'OPEN'),
      'a solo lobby offered an OPEN seat — nobody can take it (a0-31)',
    ).toHaveLength(0);
  }

  // Nothing else on the row moved: pressing the state control is not a way to
  // change somebody's side or a bot's tier.
  expect(shutAgain.seatStates.filter((c) => c.label === 'CLOSED')).toHaveLength(1);
  expect(shutAgain.visible, 'the lobby is still up — no press escaped into the match').toBe(true);
});
