/**
 * evidence/a0-78-menu-swipe/capture.spec.ts — OWNER: UI Engineer (a0-78).
 *
 * FILM IT BEFORE THEORISING. The developer's report is four words long — *"I
 * also managed to swipe on main menu and made it disappear and never
 * reappear"* — so this spec's job is to turn it into a named gesture, a named
 * stranded state, and a picture of both, on a phone-shaped viewport, before a
 * line of `src/` is touched.
 *
 * It opens the REAL door (no `?gate=0`), walks a matrix of gestures over the
 * front screen in portrait and in landscape, and after each one records four
 * facts:
 *
 *   1. `__mainMenu.visible` — does the menu still think it is up?
 *   2. What `document.elementFromPoint()` returns at PLAY's own tap point — is
 *      the menu still the thing a finger would land on, or has something been
 *      put in front of it?
 *   3. The overlay root's computed `opacity` / `visibility` / `pointer-events`
 *      — the three properties `setVisible(false)` writes to take the door out
 *      of the way once we are through.
 *   4. The alpha of the title gate's sky canvas at dead centre. This is the
 *      decisive one and it cannot be seen any other way: the doorway is a
 *      `destination-out` PUNCH in that canvas, so alpha 0 at the centre means
 *      the hole is open and alpha 255 means the starfield is a solid lid over
 *      the menu. A screenshot shows the lid; only this says what it is made of.
 *
 * Run: npx playwright test --config evidence/a0-78-menu-swipe/playwright.config.ts
 * Set CAPTURE_DIR=frames/fixed to shoot the after-the-fix set.
 */
import { test, expect, type Page, type CDPSession, type BrowserContext } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, process.env.CAPTURE_DIR ?? 'frames/broken');

/** The two shapes a phone is held in. Portrait is the default a phone boots at
 *  and the one the landscape lock rotates; landscape is the un-rotated control,
 *  so a difference between them isolates the lock rather than the gesture. */
const PROFILES = [
  { name: 'iphone-portrait', width: 390, height: 844, dpr: 3 },
  { name: 'iphone-landscape', width: 844, height: 390, dpr: 3 },
] as const;

interface Probe {
  readonly menuVisible: boolean;
  readonly menuScreen: string;
  /** What a finger landing on PLAY would actually hit. */
  readonly hitAtPlay: string;
  readonly overlayOpacity: string;
  readonly overlayVisibility: string;
  readonly overlayPointerEvents: string;
  /** Alpha of the sky canvas at its centre: 0 = doorway punched, 255 = lid. */
  readonly skyCentreAlpha: number | null;
}

/** Everything the audit needs to know about the front screen right now. */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const menu = (window as unknown as { __mainMenu?: { visible: boolean; screen: string; controls: readonly { kind: string; physicalCenter: { x: number; y: number } }[] } }).__mainMenu;
    const play = menu?.controls?.find((c) => c.kind === 'play');
    const at = play ? document.elementFromPoint(play.physicalCenter.x, play.physicalCenter.y) : null;
    const root = document.getElementById('pr-title-gate');
    const cs = root ? getComputedStyle(root) : null;
    let alpha: number | null = null;
    const sky = document.getElementById('pr-title-gate-sky') as HTMLCanvasElement | null;
    if (sky && sky.width > 0) {
      const g = sky.getContext('2d');
      if (g) alpha = g.getImageData(Math.floor(sky.width / 2), Math.floor(sky.height / 2), 1, 1).data[3] ?? null;
    }
    return {
      menuVisible: menu?.visible ?? false,
      menuScreen: menu?.screen ?? '(none)',
      hitAtPlay: at ? `${at.tagName.toLowerCase()}${at.id ? '#' + at.id : ''}` : '(nothing)',
      overlayOpacity: cs?.opacity ?? '(no overlay)',
      overlayVisibility: cs?.visibility ?? '(no overlay)',
      overlayPointerEvents: cs?.pointerEvents ?? '(no overlay)',
      skyCentreAlpha: alpha,
    };
  });
}

/** A real touch gesture, dispatched through CDP so it is a genuine touch stream
 *  — `touchstart`/`touchmove`/`touchend` — and not a synthesised mouse drag. */
async function swipe(
  client: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { steps?: number; cancel?: boolean } = {},
): Promise<void> {
  const steps = opts.steps ?? 12;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    });
  }
  // `touchCancel` is what the browser sends when it claims the gesture for
  // itself — which is exactly what a swipe on a phone is. It delivers no
  // `touchend`, so anything that only finishes on one never finishes.
  await client.send('Input.dispatchTouchEvent', {
    type: opts.cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  });
}

/** Open the real door with a real press and wait until we are through it. */
async function enter(page: Page, client: CDPSession, w: number, h: number): Promise<void> {
  await page.waitForFunction(() => !!document.getElementById('pr-title-gate'), null, { timeout: 30_000 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: w / 2, y: h / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Four beats, 3460 ms, plus slack for a software-GL runner.
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('pr-title-gate')!).pointerEvents === 'none',
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => (window as unknown as { __mainMenu?: { visible: boolean } }).__mainMenu?.visible === true,
    null,
    { timeout: 30_000 },
  );
}

const log: string[] = [];
function record(profile: string, step: string, p: Probe): void {
  const verdict =
    p.menuVisible && p.hitAtPlay.startsWith('canvas') && p.overlayPointerEvents === 'none'
      ? 'MENU REACHABLE'
      : 'MENU LOST';
  log.push(
    `[${profile}] ${step.padEnd(46)} ${verdict}  ` +
      `menu.visible=${p.menuVisible} screen=${p.menuScreen} hit@PLAY=${p.hitAtPlay} ` +
      `overlay(op=${p.overlayOpacity} vis=${p.overlayVisibility} pe=${p.overlayPointerEvents}) ` +
      `skyCentreAlpha=${p.skyCentreAlpha}`,
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/**
 * THE MINIMAL REPRODUCTION — the main menu, untouched, and one resize.
 *
 * Kept separate from the gesture matrix below on purpose. A swipe on this screen
 * also NAVIGATES (see the audit, section 5: the front screen acts on
 * pointer-DOWN with no slop test, so the start of a swipe is a press), which
 * means the matrix run ends up on the doors screen with an online connect
 * failure showing — true, filmed, and a distraction from the thing under test.
 *
 * This test presses nothing. It opens the door, waits until the main menu is
 * what is on the screen, and then does the one thing a swipe does to a phone
 * browser: collapses its URL bar. The before/after pair is the whole bug.
 */
for (const profile of PROFILES) {
  test(`the menu, then one resize — ${profile.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    // Anything the page says for itself, so a frame with something unexpected in
    // it is never presented as a clean one.
    const noise: string[] = [];
    page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') noise.push(`console.error: ${m.text()}`);
    });
    const client = await context.newCDPSession(page);
    const { width: W, height: H } = profile;
    const lines: string[] = [];

    await page.goto('/');
    await enter(page, client, W, H);
    const before = await probe(page);
    lines.push(`[${profile.name}] the main menu, nothing pressed:`);
    lines.push(`    menu.visible=${before.menuVisible} screen=${before.menuScreen} hit@PLAY=${before.hitAtPlay}`);
    lines.push(`    overlay(op=${before.overlayOpacity} vis=${before.overlayVisibility} pe=${before.overlayPointerEvents}) skyCentreAlpha=${before.skyCentreAlpha}`);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${profile.name}-min-1-menu.png`) });
    expect(before.menuScreen, 'the main menu is what is on screen').toBe('menu');

    // The URL bar collapses under the swipe. One event, nothing pressed.
    await page.setViewportSize({ width: W, height: H - 60 });
    await page.waitForTimeout(500);
    const after = await probe(page);
    lines.push(`[${profile.name}] after ONE resize, nothing pressed:`);
    lines.push(`    menu.visible=${after.menuVisible} screen=${after.menuScreen} hit@PLAY=${after.hitAtPlay}`);
    lines.push(`    overlay(op=${after.overlayOpacity} vis=${after.overlayVisibility} pe=${after.overlayPointerEvents}) skyCentreAlpha=${after.skyCentreAlpha}`);
    await page.screenshot({ path: join(OUT, `${profile.name}-min-2-menu-gone.png`) });

    // Everything a player can do next.
    await page.setViewportSize({ width: W, height: H });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: H / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await swipe(client, { x: W / 2, y: H * 0.7 }, { x: W / 2, y: H * 0.2 });
    await page.waitForTimeout(1200);
    const back = await probe(page);
    lines.push(`[${profile.name}] after pressing and swiping to get it back:`);
    lines.push(`    menu.visible=${back.menuVisible} screen=${back.menuScreen} hit@PLAY=${back.hitAtPlay}`);
    lines.push(`    overlay(op=${back.overlayOpacity} vis=${back.overlayVisibility} pe=${back.overlayPointerEvents}) skyCentreAlpha=${back.skyCentreAlpha}`);
    await page.screenshot({ path: join(OUT, `${profile.name}-min-3-still-gone.png`) });
    lines.push(`[${profile.name}] page errors during the run: ${noise.length === 0 ? '(none)' : noise.join(' | ')}`);
    writeFileSync(join(OUT, `probe-minimal-${profile.name}.txt`), lines.join('\n') + '\n');

    expect(back.overlayPointerEvents, 'the door is not eating taps').toBe('none');
    expect(back.hitAtPlay, 'a finger on PLAY reaches the menu').toContain('canvas');
    expect(back.skyCentreAlpha, 'the doorway is not painted shut').not.toBe(255);
    await context.close();
  });
}

for (const profile of PROFILES) {
  test(`front screen survives every gesture — ${profile.name}`, async ({ browser }) => {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    const { width: W, height: H } = profile;

    await page.goto('/');
    await enter(page, client, W, H);
    record(profile.name, 'through the door (baseline)', await probe(page));
    await shoot(page, `${profile.name}-1-menu`);

    // --- The gesture matrix ------------------------------------------------
    // Across the wordmark, across the buttons, from each edge, fast and slow,
    // and one that starts on a button and leaves it. Every direction, because
    // "a swipe" names none of them.
    const mid = { x: W / 2, y: H / 2 };
    const gestures: { name: string; from: { x: number; y: number }; to: { x: number; y: number }; steps?: number; cancel?: boolean }[] = [
      { name: 'swipe up, across the middle', from: { x: W / 2, y: H * 0.75 }, to: { x: W / 2, y: H * 0.25 } },
      { name: 'swipe down, across the middle', from: { x: W / 2, y: H * 0.25 }, to: { x: W / 2, y: H * 0.75 } },
      { name: 'swipe left', from: { x: W * 0.8, y: H / 2 }, to: { x: W * 0.2, y: H / 2 } },
      { name: 'swipe right', from: { x: W * 0.2, y: H / 2 }, to: { x: W * 0.8, y: H / 2 } },
      { name: 'edge swipe from the left', from: { x: 1, y: H / 2 }, to: { x: W * 0.7, y: H / 2 } },
      { name: 'edge swipe from the bottom', from: { x: W / 2, y: H - 1 }, to: { x: W / 2, y: H * 0.3 } },
      { name: 'edge swipe from the top', from: { x: W / 2, y: 1 }, to: { x: W / 2, y: H * 0.7 } },
      { name: 'fast flick (3 samples)', from: { x: W / 2, y: H * 0.7 }, to: { x: W / 2, y: H * 0.2 }, steps: 3 },
      { name: 'slow drag (40 samples)', from: { x: W / 2, y: H * 0.7 }, to: { x: W / 2, y: H * 0.2 }, steps: 40 },
      { name: 'press then CANCEL, no touchend', from: mid, to: { x: mid.x + 6, y: mid.y + 6 }, steps: 2, cancel: true },
      { name: 'swipe off a button and CANCEL', from: mid, to: { x: W * 0.9, y: H * 0.1 }, cancel: true },
    ];
    for (const g of gestures) {
      await swipe(client, g.from, g.to, { steps: g.steps, cancel: g.cancel });
      await page.waitForTimeout(120);
      record(profile.name, g.name, await probe(page));
    }
    await shoot(page, `${profile.name}-2-after-gestures`);

    // --- What a swipe DOES to a phone browser, which no gesture alone can ---
    // A swipe on a phone scrolls the page's chrome: the URL bar collapses or
    // expands, the layout viewport changes height, and the window fires
    // `resize`. Chromium under emulation has no URL bar to collapse, so the
    // height change is applied directly — the same event, from the same cause,
    // stripped of the chrome that cannot be emulated.
    await page.setViewportSize({ width: W, height: H - 60 });
    await page.waitForTimeout(400);
    record(profile.name, 'URL bar collapses (window resize)', await probe(page));
    await shoot(page, `${profile.name}-3-after-urlbar-resize`);

    // …and back, the way it goes when the swipe stops. If the menu comes back
    // on its own, this is a flicker; if it does not, it is the soft-lock.
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(400);
    record(profile.name, 'URL bar returns (window resize back)', await probe(page));
    await shoot(page, `${profile.name}-4-urlbar-returned`);

    // --- Is there a way back? ----------------------------------------------
    // Every input a player has on a phone, in order: press the middle, press
    // PLAY where the menu says PLAY is, and swipe again.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: H / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
    record(profile.name, 'press the middle (a player trying)', await probe(page));

    const play = await page.evaluate(() => {
      const m = (window as unknown as { __mainMenu?: { controls: readonly { kind: string; physicalCenter: { x: number; y: number } }[] } }).__mainMenu;
      return m?.controls?.find((c) => c.kind === 'play')?.physicalCenter ?? null;
    });
    if (play) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: play.x, y: play.y }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
      record(profile.name, 'press PLAY where the menu says it is', await probe(page));
    }
    await swipe(client, { x: W / 2, y: H * 0.7 }, { x: W / 2, y: H * 0.2 });
    await page.waitForTimeout(400);
    record(profile.name, 'swipe again (trying to undo it)', await probe(page));
    await shoot(page, `${profile.name}-5-no-way-back`);

    const final = await probe(page);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `probe-${profile.name}.txt`), log.join('\n') + '\n');

    // The invariant the front screen must hold. On today's code this fails.
    expect(final.menuVisible, 'the menu is still up').toBe(true);
    expect(final.overlayPointerEvents, 'the door is not eating taps').toBe('none');
    expect(final.hitAtPlay, 'a finger on PLAY reaches the menu').toContain('canvas');
    await context.close();
  });
}

/**
 * THE PURE-GESTURE ROUTE — one swipe, no simulated browser chrome.
 *
 * The front screen acts on pointer-DOWN, so the START of a swipe is a press
 * (`src/main.ts` `onPointerDown`). A swipe that begins on PLAY therefore presses
 * PLAY, and PLAY is the one control that calls `enterImmersive()` — fullscreen
 * plus the native landscape lock, on a valid user gesture. Entering fullscreen
 * reshapes the window, the window fires `resize`, and the title gate is still
 * mounted behind the menu because `Escape` has to be able to bring it back.
 *
 * That is a soft-lock reachable by a gesture alone, on a device with no keyboard
 * to press `Escape` on. This test is the film of it.
 */
for (const profile of PROFILES) {
  test(`a swipe that starts on PLAY — ${profile.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    const { width: W, height: H } = profile;
    const play: string[] = [];

    await page.goto('/');
    await enter(page, client, W, H);
    const before = await probe(page);
    play.push(`[${profile.name}] before the swipe: menu.visible=${before.menuVisible} screen=${before.menuScreen} hit@PLAY=${before.hitAtPlay} overlay(op=${before.overlayOpacity} vis=${before.overlayVisibility} pe=${before.overlayPointerEvents}) skyCentreAlpha=${before.skyCentreAlpha}`);

    const target = await page.evaluate(() => {
      const m = (window as unknown as { __mainMenu?: { controls: readonly { kind: string; physicalCenter: { x: number; y: number } }[] } }).__mainMenu;
      return m?.controls?.find((c) => c.kind === 'play')?.physicalCenter ?? null;
    });
    expect(target, 'the menu reports where PLAY is').not.toBeNull();

    // A swipe that BEGINS on PLAY and travels well off it — the gesture a thumb
    // makes when it means to scroll a screen that does not scroll.
    await swipe(client, target!, { x: target!.x, y: Math.max(2, target!.y - H * 0.4) });
    await page.waitForTimeout(1500);
    const after = await probe(page);
    const fs = await page.evaluate(() => document.fullscreenElement !== null);
    play.push(`[${profile.name}] after the swipe:  menu.visible=${after.menuVisible} screen=${after.menuScreen} hit@PLAY=${after.hitAtPlay} overlay(op=${after.overlayOpacity} vis=${after.overlayVisibility} pe=${after.overlayPointerEvents}) skyCentreAlpha=${after.skyCentreAlpha} fullscreen=${fs}`);

    // Every way back a phone has.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W / 2, y: H / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(800);
    const retry = await probe(page);
    play.push(`[${profile.name}] after pressing:   menu.visible=${retry.menuVisible} screen=${retry.menuScreen} hit@PLAY=${retry.hitAtPlay} overlay(op=${retry.overlayOpacity} vis=${retry.overlayVisibility} pe=${retry.overlayPointerEvents}) skyCentreAlpha=${retry.skyCentreAlpha}`);

    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${profile.name}-6-swipe-on-play.png`) });
    writeFileSync(join(OUT, `probe-play-${profile.name}.txt`), play.join('\n') + '\n');

    expect(retry.overlayPointerEvents, 'the door is not eating taps after a swipe on PLAY').toBe('none');
    expect(retry.hitAtPlay, 'the screen is still reachable after a swipe on PLAY').toContain('canvas');
    await context.close();
  });
}
