/**
 * evidence/probe-copylog-reach.mjs — CAN A PLAYER ACTUALLY PRESS COPY LOG?
 * OWNER: QA Manager.
 *
 * Written because the `online-feel` capture could press COPY LOG on a desktop and
 * could not press it on a phone, and "the automation is fussy about phones" and
 * "the button is unreachable on phones" look identical from inside a test runner.
 * So this asks the PAGE, not the runner.
 *
 * The question is answered with `document.elementFromPoint` at the button's own
 * centre — the browser's own hit test, which is what a thumb resolves against. If
 * it returns the button, a finger lands on the button. If it returns the canvas,
 * the button is not there to be pressed however present it is in the DOM.
 *
 * WHAT IT FOUND (and why the phone answer is not a bug in this probe):
 * `src/platform/orientation.ts` `requestLandscape` enters ELEMENT fullscreen on
 * the game root at PLAY, to make the native orientation lock legal on mobile. The
 * Fullscreen API renders only the fullscreen element's subtree — so the COPY LOG
 * affordance, which `src/net/playtest-log-button.ts` appends to `document.body`
 * (deliberately, so it survives a screen the renderer is failing to draw), is
 * outside that subtree and is neither painted nor hit-tested, at any z-index.
 *
 * Both form factors walk the same path: PLAY → PLAY SOLO → RUSH! → pause. Offline,
 * because the reach of a button is not a netcode question and a solo match removes
 * every live-fleet variable from the answer.
 *
 * Usage: node evidence/probe-copylog-reach.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images');
mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] ?? process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1, touch: false },
  { name: 'phone-portrait-held', width: 390, height: 844, dpr: 3, touch: true },
  { name: 'phone-landscape', width: 844, height: 390, dpr: 3, touch: true },
];

async function walk(browser, profile) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
    const box = await page.locator('canvas').boundingBox();
    const press = async (p) =>
      profile.touch
        ? page.touchscreen.tap(box.x + p.x, box.y + p.y)
        : page.mouse.click(box.x + p.x, box.y + p.y);

    await press(
      await page.evaluate(() => {
        const c = window.__mainMenu.controls.find((x) => x.kind === 'play');
        return { x: c.physicalCenter.x, y: c.physicalCenter.y };
      }),
    );
    await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await press(
      await page.evaluate(() => {
        const c = window.__onlineMenu.doorControls.find((x) => x.kind === 'solo');
        return { x: c.physicalCenter.x, y: c.physicalCenter.y };
      }),
    );
    await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
    await press(await page.evaluate(() => window.__lobby.rushControl.physicalCenter));
    await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
    await sleep(2_500);

    // Open the pause menu — the screen the brief puts COPY LOG on — with the
    // affordance each form factor actually has: the corner pause button under a
    // finger, ESC under a hand. The touch point is the drawn rect from
    // `src/ui/pause-menu.ts` put back through the landscape lock's remap
    // (`src/platform/orientation.ts` logicalToPhysical: rotated → (physW − ly, lx)).
    if (profile.touch) {
      const lx = 72 + 20;
      const ly = 16 + 20;
      const pts =
        profile.width < profile.height
          ? [{ x: profile.width - ly, y: lx }, { x: lx, y: ly }]
          : [{ x: lx, y: ly }, { x: profile.width - ly, y: lx }];
      for (const p of pts) {
        await page.touchscreen.tap(box.x + p.x, box.y + p.y);
        await sleep(900);
        if (await page.evaluate(() => !!document.getElementById('playtest-copy-log-button'))) break;
      }
    } else {
      await page.keyboard.press('Escape');
      await sleep(900);
    }

    const read = await page.evaluate(() => {
      const root = document.getElementById('playtest-copy-log');
      const btn = document.getElementById('playtest-copy-log-button');
      const fs = document.fullscreenElement;
      const rect = btn ? btn.getBoundingClientRect() : null;
      const hit = rect
        ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        : null;
      return {
        pauseOverlayUp: !!(window.__pauseStage ? window.__pauseStage.read().open : null),
        buttonInDom: !!btn,
        buttonLabel: btn ? btn.textContent.trim() : null,
        buttonRect: rect
          ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
          : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rectInsideViewport: rect
          ? rect.x >= 0 && rect.y >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
          : null,
        // THE ANSWER: what the browser says is at the button's own centre.
        elementAtButtonCentre: hit ? hit.id || hit.tagName : null,
        pressable: !!(hit && btn && (hit === btn || btn.contains(hit))),
        fullscreenElement: fs ? `${fs.tagName}${fs.id ? '#' + fs.id : ''}` : null,
        copyLogRootParent: root ? root.parentElement.tagName : null,
        copyLogInsideFullscreenSubtree: !!(fs && root && fs.contains(root)),
      };
    });
    await page.screenshot({ path: join(OUT, `copylog-reach-${profile.name}.png`) });
    return { profile: profile.name, viewport: `${profile.width}x${profile.height}@${profile.dpr}`, ...read, pageErrors: errors };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const results = [];
for (const p of PROFILES) {
  try {
    const r = await walk(browser, p);
    results.push(r);
    console.log(
      `${r.profile.padEnd(22)} inDom=${r.buttonInDom} rectInViewport=${r.rectInsideViewport} ` +
        `atCentre=${r.elementAtButtonCentre} PRESSABLE=${r.pressable} fullscreen=${r.fullscreenElement}`,
    );
  } catch (e) {
    results.push({ profile: p.name, error: String(e).split('\n')[0] });
    console.log(`${p.name}: ${String(e).split('\n')[0]}`);
  }
}
await browser.close();
writeFileSync(
  join(OUT, 'copylog-reach.json'),
  JSON.stringify({ probe: 'copylog-reach', base: BASE, capturedAt: new Date().toISOString(), results }, null, 2),
);
console.log('\nwrote evidence/images/copylog-reach.json');
