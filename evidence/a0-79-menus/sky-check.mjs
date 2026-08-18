/**
 * evidence/a0-79-menus/sky-check.mjs — WHICH screens actually got the sky.
 * OWNER: UI Engineer (a0-79).
 *
 * The golden re-baseline moved six images — the phone's title, settings and codex
 * — and left the DOORS and every DESKTOP menu untouched. Either the void did not
 * reach those screens or the goldens are measuring something else, and the way to
 * tell them apart is a count, not an argument.
 *
 * For each (viewport, screen) this shoots the shipped bundle twice, `?sky=1` and
 * `?sky=0`, and counts the pixels that differ. `> 1%` is the goldens' own
 * `maxDiffPixelRatio`: anything under it would pass an old baseline unchanged,
 * which is exactly the ambiguity being resolved.
 *
 *   node evidence/a0-79-menus/sky-check.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT_DIR = 'dist-a079-after';
const PORT = Number(process.env.A079_DOORS_PORT ?? 4254);

async function serve() {
  if (!existsSync(`${ROOT}/${OUT_DIR}/index.html`)) throw new Error(`no bundle at ${OUT_DIR}`);
  try {
    const stale = await fetch(`http://127.0.0.1:${PORT}`, { signal: AbortSignal.timeout(1500) });
    if (stale.ok) throw new Error(`port ${PORT} already answers — kill it`);
  } catch (e) {
    if (e instanceof Error && e.message.includes('already answers')) throw e;
  }
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--outDir', OUT_DIR, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  const url = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return { url, proc };
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill('SIGTERM');
  throw new Error('preview never came up');
}

const settle = (page, frames = 8) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let left = n;
        const tick = () => (left-- <= 0 ? done(true) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );

/** The two device profiles the goldens use, and the screens each one shoots. */
const CASES = [
  { vp: 'desktop 1280x800', w: 1280, h: 800, dpr: 1, mobile: false, screen: 'menu' },
  { vp: 'desktop 1280x800', w: 1280, h: 800, dpr: 1, mobile: false, screen: 'doors' },
  { vp: 'phone 844x390 dpr3', w: 844, h: 390, dpr: 3, mobile: true, screen: 'menu' },
  { vp: 'phone 844x390 dpr3', w: 844, h: 390, dpr: 3, mobile: true, screen: 'doors' },
];

async function shoot(browser, url, sky, name, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: c.dpr,
    isMobile: c.mobile,
    hasTouch: c.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(`${url}/?gate=0&sky=${sky ? 1 : 0}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0, null, {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
  if (c.screen === 'doors') {
    // Press PLAY the way a player does, at the point the seam says it is drawn.
    const point = await page.evaluate(() => {
      const k = window.__mainMenu?.controls.find((x) => x.kind === 'play');
      return k ? { x: k.physicalCenter.x, y: k.physicalCenter.y } : null;
    });
    if (!point) throw new Error('the menu never reported where PLAY is drawn');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => !!window.__onlineMenu?.visible, null, { timeout: 20_000 });
    await page.mouse.move(1, 1);
    await settle(page);
  }
  const path = `${HERE}frames/sky-check/${name}.png`;
  await page.screenshot({ path });
  await ctx.close();
  return path;
}

const main = async () => {
  const served = await serve();
  const browser = await chromium.launch();
  const lines = [
    'a0-79 — WHICH menu screens actually got the sky',
    '='.repeat(70),
    '',
    'Pixels that differ between `?sky=1` and `?sky=0` on the same screen, same',
    'bundle. The goldens tolerate 1%, so anything under that would pass an old',
    'baseline unchanged.',
    '',
  ];
  try {
    mkdirSync(`${HERE}frames/sky-check`, { recursive: true });
    for (const c of CASES) {
      const slug = `${c.w}x${c.h}-${c.screen}`;
      const on = await shoot(browser, served.url, true, `${slug}-sky-on`, c);
      const off = await shoot(browser, served.url, false, `${slug}-sky-off`, c);
      const a = PNG.sync.read(readFileSync(on));
      const b = PNG.sync.read(readFileSync(off));
      let differing = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        if (
          Math.abs(a.data[i] - b.data[i]) > 8 ||
          Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 ||
          Math.abs(a.data[i + 2] - b.data[i + 2]) > 8
        ) {
          differing++;
        }
      }
      const total = a.width * a.height;
      const pct = (differing / total) * 100;
      const line = `  ${c.vp.padEnd(20)} ${c.screen.padEnd(6)} ${pct.toFixed(2)}% differ  ${pct > 1 ? 'SKY IS THERE' : '<<< NO SKY'}`;
      lines.push(line);
      console.log(line);
    }
  } finally {
    await browser.close();
    served.proc.kill('SIGTERM');
  }
  writeFileSync(`${HERE}sky-check.txt`, lines.join('\n') + '\n');
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
