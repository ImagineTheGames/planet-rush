/**
 * evidence/capture-round5.mjs — round-5 verification of the LANDSCAPE LOCK
 * (p1-05, PR #67) and the OWN-SHIP health bar (field request v0.1.1, PR #69) on
 * the LIVE preview build. OWNER: QA Manager.
 *
 * The developer opened the game in portrait, rotated the phone, and the menu
 * stranded itself off-screen unrecoverably. Three shots stage the exact tells on
 * the booted production bundle so a human LOOK can confirm or fail each:
 *
 *   menu-locked-landscape-in-portrait — a PORTRAIT-held phone (390×844) on a
 *     clean boot (no ?debug=1, so the real main menu runs). The game root is
 *     rotated 90° so the menu reads landscape, fully on-screen. We then tap PLAY
 *     at its PHYSICAL portrait position (the touch remap is what breaks silently)
 *     via a CDP touch event, and confirm the match world is built (matchStarted)
 *     AND document.fullscreenElement is set (p1-07 fullscreen-on-PLAY).
 *
 *   orientation-change-recovery — the report's exact sequence on the same phone:
 *     boot portrait → rotate to landscape → rotate back to portrait. Screenshot
 *     the end state; read the menu seam to attest every control is still inside
 *     the logical viewport (nothing stranded — the re-layout regression).
 *
 *   own-ship-healthbar — the LOCAL ship mid-fight (?debug=1&freeze=1). We damage
 *     the local ship to 50% and stage an enemy at 40% beside it, then read back
 *     the bars the real layer drew (the own bar carries the `local` style flag)
 *     and the HUD hull readout, to attest the over-ship own bar and the top-right
 *     readout read the SAME number (one source: sim hull).
 *
 * Every claim about a shot lives in evidence/manifest.json, written after LOOKING
 * at the PNG. This file only guarantees WHAT WAS ON SCREEN.
 *
 * Usage:  node evidence/capture-round5.mjs [shot-id ...]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

// A portrait-held phone: the developer's mistaken opening orientation. Touch +
// isMobile so the app's landscape lock (isTouch path) fires and rotates the root.
const PHONE_PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// A landscape desktop for the own-ship fight — the HUD hull readout (top-right)
// is unambiguous at this size and the centred ship's own bar is easy to read.
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

/** Wait for the clean-boot main-menu seam to be live (visible, laid out). */
async function waitMenu(page) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = window.__mainMenu;
      return !!m && m.visible && m.logicalViewport?.width > 0 && m.controls?.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(500);
}

/** Snapshot the menu seam as plain data (the live object can't shift under us). */
async function readMenu(page) {
  return page.evaluate(() => {
    const m = window.__mainMenu;
    return {
      visible: m.visible,
      matchStarted: m.matchStarted,
      rotated: m.rotated,
      logicalViewport: { width: m.logicalViewport.width, height: m.logicalViewport.height },
      controls: m.controls.map((c) => ({
        kind: c.kind,
        logical: { x: c.logical.x, y: c.logical.y, width: c.logical.width, height: c.logical.height },
        physicalCenter: { x: c.physicalCenter.x, y: c.physicalCenter.y },
      })),
    };
  });
}

/** True iff every control's logical rect sits inside the logical viewport (1px slop). */
function allInside(m) {
  const t = 1;
  return m.controls.every(
    (c) =>
      c.logical.width > 0 &&
      c.logical.height > 0 &&
      c.logical.x >= -t &&
      c.logical.y >= -t &&
      c.logical.x + c.logical.width <= m.logicalViewport.width + t &&
      c.logical.y + c.logical.height <= m.logicalViewport.height + t,
  );
}

/** Swap the viewport to a target orientation (portrait/landscape) and settle. */
async function setOrientation(page, mode) {
  const vp = page.viewportSize();
  const isLandscape = vp.width >= vp.height;
  if (isLandscape !== (mode === 'landscape')) {
    await page.setViewportSize({ width: vp.height, height: vp.width });
  }
  await page.waitForTimeout(400);
}

const SHOTS = [
  {
    // Portrait phone, clean boot: the menu must render landscape, fully on-screen,
    // and a tap at PLAY's PHYSICAL portrait point must start the match + take
    // fullscreen. Shoot the menu FIRST (PLAY dismisses it), then drive the tap.
    id: 'menu-locked-landscape-in-portrait',
    device: PHONE_PORTRAIT,
    url: '/',
    async run(page) {
      await waitMenu(page);
      const menu = await readMenu(page);
      // Shoot the resting landscape menu on the portrait phone BEFORE pressing PLAY.
      await page.screenshot({ path: join(OUT, 'menu-locked-landscape-in-portrait.png') });

      const play = menu.controls.find((c) => c.kind === 'play');
      const vp = page.viewportSize();
      // Tap the PHYSICAL spot the logical PLAY button occupies (CDP touch — a real
      // finger, un-rotated by the DOM edge back to the logical PLAY rect).
      const client = await page.context().newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: Math.round(play.physicalCenter.x), y: Math.round(play.physicalCenter.y) }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();

      let matchStarted = false;
      try {
        await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 15_000 });
        matchStarted = true;
      } catch {
        matchStarted = false;
      }
      const after = await page.evaluate(() => ({
        matchStarted: window.__mainMenu?.matchStarted ?? null,
        menuVisible: window.__mainMenu?.visible ?? null,
        fullscreenElement: document.fullscreenElement
          ? document.fullscreenElement.id || document.fullscreenElement.tagName
          : null,
        fullscreenEnabled: document.fullscreenEnabled,
      }));
      const playInside =
        play.physicalCenter.x >= 0 &&
        play.physicalCenter.x <= vp.width &&
        play.physicalCenter.y >= 0 &&
        play.physicalCenter.y <= vp.height;
      console.log(
        'menu-locked-landscape-in-portrait:',
        JSON.stringify({ menu, playPhysicalInsidePortrait: playInside, tapped: play.physicalCenter, matchStarted, after }),
      );
      return { skipShot: true };
    },
  },
  {
    // The report's exact rotation sequence. Boot portrait, rotate to landscape,
    // rotate back to portrait; shoot the END state and read the seam to attest
    // nothing stranded.
    id: 'orientation-change-recovery',
    device: PHONE_PORTRAIT,
    url: '/',
    async run(page) {
      await waitMenu(page);
      const bootPortrait = await readMenu(page);

      // Rotate to landscape — the moment the old build stranded the menu.
      await setOrientation(page, 'landscape');
      await page.waitForFunction(() => window.__mainMenu?.rotated === false, undefined, { timeout: 10_000 }).catch(() => {});
      const landscape = await readMenu(page);

      // Rotate back to portrait — must re-layout (not a one-shot).
      await setOrientation(page, 'portrait');
      await page.waitForFunction(() => window.__mainMenu?.rotated === true, undefined, { timeout: 10_000 }).catch(() => {});
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(400);
      const endPortrait = await readMenu(page);

      console.log(
        'orientation-change-recovery:',
        JSON.stringify({
          bootPortrait: { rotated: bootPortrait.rotated, lvp: bootPortrait.logicalViewport, inside: allInside(bootPortrait) },
          landscape: { rotated: landscape.rotated, lvp: landscape.logicalViewport, inside: allInside(landscape) },
          endPortrait: {
            rotated: endPortrait.rotated,
            lvp: endPortrait.logicalViewport,
            visible: endPortrait.visible,
            inside: allInside(endPortrait),
            controls: endPortrait.controls.map((c) => ({ kind: c.kind, logical: c.logical })),
          },
        }),
      );
    },
  },
  {
    // The local ship mid-fight with its own first-class health bar. Frozen so the
    // staged frame holds still. Damage the LOCAL ship to 50% and stage an enemy at
    // 40% beside it; read back the drawn bars (own bar flagged `local`) and the HUD
    // hull readout to attest the over-ship own bar and the readout agree.
    id: 'own-ship-healthbar',
    device: DESKTOP,
    url: '/?debug=1&freeze=1',
    async run(page) {
      await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 }).catch(() => {});
      await page.waitForFunction(
        () => typeof window.__healthbarStage?.damageLocal === 'function',
        undefined,
        { timeout: 20_000 },
      );
      await page.evaluate(() => document.fonts?.ready);

      const staged = await page.evaluate(() => {
        const stg = window.__healthbarStage;
        const local = stg.damageLocal(0.5);
        const enemy = stg.damageEnemy(0.4);
        return { local, enemy };
      });
      // Let the render loop draw a frame with the damaged own ship + enemy.
      await page.waitForFunction(
        () => window.__healthbarStage.bars().some((b) => b.local),
        undefined,
        { timeout: 20_000 },
      );
      await page.waitForTimeout(400);
      const readback = await page.evaluate(() => {
        const stg = window.__healthbarStage;
        return { bars: stg.bars(), hullReadout: stg.hullReadout(), viewport: window.__planetRush.viewport };
      });
      const own = readback.bars.find((b) => b.local) ?? null;
      const enemyBar = readback.bars.find((b) => !b.local) ?? null;
      console.log(
        'own-ship-healthbar:',
        JSON.stringify({ staged, own, enemyBar, hullReadout: readback.hullReadout, viewport: readback.viewport }),
      );

      // Full frame, plus a centre crop (ship + own bar) and a top-right crop (HUD
      // hull readout) so the two numbers can be read side by side.
      const vp = page.viewportSize();
      return {
        crops: [
          {
            id: 'own-ship-healthbar-center',
            clip: { x: vp.width / 2 - 220, y: vp.height / 2 - 200, width: 440, height: 360 },
          },
          {
            id: 'own-ship-healthbar-hud',
            clip: { x: vp.width - 460, y: 0, width: 460, height: 200 },
          },
        ],
      };
    },
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
  if (!shots.length) throw new Error(`no shots matched: ${only.join(', ')}`);

  const browser = await chromium.launch();
  try {
    for (const shot of shots) {
      const context = await browser.newContext(shot.device);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(BASE + shot.url, { waitUntil: 'load' });
      const result = await shot.run(page);
      const file = join(OUT, `${shot.id}.png`);
      if (!result?.skipShot) await page.screenshot({ path: file });
      for (const crop of result?.crops ?? []) {
        await page.screenshot({ path: join(OUT, `${crop.id}.png`), clip: crop.clip });
        console.log(`crop ${crop.id}:`, JSON.stringify(crop.clip));
      }
      const build = await page.evaluate(
        () => window.__planetRush?.build ?? window.__mainMenu?.build ?? null,
      );
      console.log(JSON.stringify({ id: shot.id, url: shot.url, viewport: shot.device.viewport, build, errors }));
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
