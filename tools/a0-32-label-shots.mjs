// Evidence capture for a0-32: the BUILD & UPGRADE button and the UPGRADE SHIP
// wedge (resting and selected), at 390px landscape, dpr 3.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const PORT = process.argv[3] ?? '4194';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
// 1. The BUILD & UPGRADE button. The ship spawns orbiting its own station, i.e.
//    docked, so the button is a fixture from the first live frame — `?debug=1`
//    without the freeze, exactly as `tests/mobile/build-flow.spec.ts` boots.
await page.goto(`http://localhost:${PORT}/?debug=1`);
await page.waitForFunction(
  () => {
    const pr = window.__planetRush;
    return !!pr && Array.isArray(pr.layout) && pr.layout.length > 0 && (pr.ticks ?? 0) > 3;
  },
  undefined,
  { timeout: 60000 },
);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
const btn = await page.evaluate(() => window.__planetRush.layout.find((e) => e.id === 'build-button')?.bounds);
console.log('build-button bounds', JSON.stringify(btn));
await page.screenshot({ path: `${OUT}/0-hud.png` });
if (btn) {
  await page.screenshot({
    path: `${OUT}/2-build-button.png`,
    clip: { x: btn.x - 18, y: btn.y - 18, width: btn.width + 36, height: btn.height + 36 },
  });
}

// 2. The wheel, frozen so the world under it is the same seeded scene every time.
await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await page.waitForFunction(() => !!window.__pressStage, undefined, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => window.__pressStage.openBuild(8));
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/1-wheel-open.png` });

// 2. The UPGRADE SHIP wedge, resting.
await page.screenshot({
  path: `${OUT}/3-upgrade-wedge.png`,
  clip: { x: 422 - 175, y: 195 - 100, width: 190, height: 200 },
});

// 3. …and SELECTED (u16-01). Driven with a real cursor rather than a real
//    thumb: on the UPGRADE SHIP wedge a press is the gesture that OPENS the
//    upgrade panel, so a touchStart there photographs the next screen instead of
//    this one. `pointermove` reaches the same selection through the same shipped
//    handler, at the same 844x390 dpr-3 profile.
const hover = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
});
const hp = await hover.newPage();
await hp.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
await hp.waitForFunction(() => !!window.__pressStage, undefined, { timeout: 60000 });
await hp.evaluate(() => document.fonts.ready);
await hp.evaluate(() => window.__pressStage.openBuild(8));
await hp.waitForTimeout(900);
const p = await hp.evaluate(() => window.__pressStage.wedgeClientPoint(4));
await hp.mouse.move(p.x, p.y);
await hp.waitForTimeout(600);
const sel = await hp.evaluate(() => window.__pressStage.wedges().map((w) => w.selected));
console.log('selected flags', JSON.stringify(sel));
await hp.screenshot({ path: `${OUT}/4-wheel-selected.png` });
await hp.screenshot({
  path: `${OUT}/5-upgrade-wedge-selected.png`,
  clip: { x: 422 - 175, y: 195 - 100, width: 190, height: 200 },
});

await browser.close();
console.log('shots in', OUT);
