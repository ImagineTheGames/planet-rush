// Ad-hoc evidence shooter: the doors screen and the CODEX, desktop + phone.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/shots-before';
mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, dsf: 1, touch: false, mobile: false },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, dsf: 3, touch: true, mobile: true },
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, dsf: 3, touch: true, mobile: true },
];

const settle = async (page, n = 8) => {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
};

const bootMenu = async (page) => {
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(
    () => {
      const m = window.__mainMenu;
      return !!m && m.visible && m.controls.length > 0 && m.logicalViewport.width > 0;
    },
    undefined,
    { timeout: 30000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await settle(page, 12);
};

const pressControl = async (page, kind) => {
  const p = await page.evaluate((k) => {
    const c = window.__mainMenu?.controls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  if (!p) throw new Error(`no control ${kind}`);
  await page.mouse.click(Math.round(p.x), Math.round(p.y));
  await settle(page, 12);
  await page.mouse.move(1, 1);
  await settle(page, 6);
};

const browser = await chromium.launch();
for (const profile of PROFILES) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.dsf,
    isMobile: profile.mobile,
    hasTouch: profile.touch,
  });
  const page = await ctx.newPage();

  // The doors.
  await bootMenu(page);
  await pressControl(page, 'play');
  await page.screenshot({ path: `${OUT}/${profile.name}-doors.png` });

  // The CAMPAIGN teaser, answered.
  const doorPt = async (kind) => page.evaluate((k) => {
    const c = window.__onlineMenu?.doorControls.find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
  const campaign = await doorPt('campaign');
  if (campaign) {
    await page.mouse.click(Math.round(campaign.x), Math.round(campaign.y));
    await settle(page, 10);
    await page.mouse.move(1, 1);
    await settle(page, 6);
    await page.screenshot({ path: `${OUT}/${profile.name}-doors-coming-soon.png` });
  }

  // The keypad behind JOIN ROOM, with a couple of characters typed.
  const join = await doorPt('join');
  if (join) {
    await page.mouse.click(Math.round(join.x), Math.round(join.y));
    await settle(page, 10);
    for (const ch of ['Q', '5']) {
      const k = await page.evaluate((c) => {
        const t = window.__onlineMenu?.doorControls.find((x) => x.kind === `key:${c}`);
        return t ? { x: t.physicalCenter.x, y: t.physicalCenter.y } : null;
      }, ch);
      if (k) { await page.mouse.click(Math.round(k.x), Math.round(k.y)); await settle(page, 6); }
    }
    await page.mouse.move(1, 1);
    await settle(page, 6);
    await page.screenshot({ path: `${OUT}/${profile.name}-keypad.png` });
  }

  // The CODEX (fresh boot — the doors screen has no route to it).
  await bootMenu(page);
  await pressControl(page, 'codex');
  await page.screenshot({ path: `${OUT}/${profile.name}-codex.png` });

  // The CODEX on a long article: SYSTEMS tab, third entry.
  const tab = await page.evaluate(() => {
    const c = window.__mainMenu?.codexControls.filter((x) => x.kind === 'tab') ?? [];
    const t = c[2];
    return t ? { x: t.physicalCenter.x, y: t.physicalCenter.y } : null;
  });
  if (tab) {
    await page.mouse.click(Math.round(tab.x), Math.round(tab.y));
    await settle(page, 10);
    await page.mouse.move(1, 1);
    await settle(page, 6);
    await page.screenshot({ path: `${OUT}/${profile.name}-codex-systems.png` });
  }

  await ctx.close();
  console.log('shot', profile.name);
}
await browser.close();
