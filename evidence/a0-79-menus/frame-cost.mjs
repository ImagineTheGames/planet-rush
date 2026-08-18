/**
 * evidence/a0-79-menus/frame-cost.mjs — what the menu backdrop costs per frame.
 * OWNER: UI Engineer (a0-79).
 *
 *   npx vite build --outDir dist-a079-after
 *   node evidence/a0-79-menus/frame-cost.mjs
 *
 * The brief requires a MEASURED per-frame cost at 798×384 and at 3440×1440, and
 * it requires it because a0-75 is concurrently proving that the void's cost
 * scales with window size. So this is the honest shape of that measurement:
 *
 *  - **one bundle, two samples, back to back.** `?sky=0` turns the menu backdrop
 *    off and nothing else (`src/ui/menu-backdrop.ts` `menuSkyEnabled`), so the
 *    only difference between the two readings is the thing being priced. a0-75
 *    lost a whole sweep to two bundles timed twenty minutes apart on a shared
 *    box — an "after" run read 183 ms where "before" read 133, purely from a
 *    concurrent `vite build`.
 *  - **order alternated across repeats**, so a monotonic drift in machine load
 *    cannot land entirely on one column.
 *  - **the live match sampled in the same run**, as the denominator. This box has
 *    no GPU (SwiftShader), so no millisecond here is the developer's; what
 *    travels is the RATIO against the heaviest screen the game legitimately
 *    draws — which is also the invariant `tests/mobile/menu-frame-cost.spec.ts`
 *    already gates on.
 *
 * **Run it alone.** Not beside a build, not beside vitest.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT_DIR = 'dist-a079-after';
const PORT = Number(process.env.A079_PORT ?? 4253);

const argv = process.argv.slice(2);
const arg = (n, f) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : f;
};
/** A fixed WINDOW, not a fixed frame count — a0-00b's lesson: "60 frames" is a
 *  minute of wall clock on a host that renders at 1 fps. */
const WINDOW_MS = Number(arg('window', 3000));
const MIN_FRAMES = Number(arg('min-frames', 9));
const MAX_FRAMES = Number(arg('max-frames', 90));
const REPEATS = Number(arg('repeats', 3));

const VIEWPORTS = [
  { name: 'phone 798x384', w: 798, h: 384, dpr: 2, mobile: true },
  { name: 'desktop 1280x720', w: 1280, h: 720, dpr: 1, mobile: false },
  { name: 'ultrawide 3440x1440', w: 3440, h: 1440, dpr: 1, mobile: false },
];

async function serve() {
  if (!existsSync(`${ROOT}/${OUT_DIR}/index.html`)) {
    throw new Error(`no bundle at ${ROOT}/${OUT_DIR} — npx vite build --outDir ${OUT_DIR}`);
  }
  // **Refuse to attach to a server this rig did not start.** `vite preview` on a
  // busy port exits, and a loop that only polls for a 200 will happily measure —
  // or photograph — WHOSE EVER bundle is already there. That is not a theory:
  // playwright.config.ts carries the same warning because a0-06 got a local PASS
  // against another lane's pixels, and this rig hit it too, silently re-shooting
  // the previous run's bundle from an orphaned preview.
  try {
    const stale = await fetch(`http://127.0.0.1:${PORT}`, { signal: AbortSignal.timeout(1500) });
    if (stale.ok) throw new Error(`port ${PORT} already answers — kill it, this rig will not measure a stranger's bundle`);
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
      const r = await fetch(url);
      if (r.ok) return { url, proc };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill('SIGTERM');
  throw new Error('preview never came up');
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

/** Median rAF delta over a fixed window — the browser's own main-thread frame
 *  time, the same measure `tests/mobile/menu-frame-cost.spec.ts` asserts on. */
const sample = (page) =>
  page.evaluate(
    ({ windowMs, minFrames, maxFrames }) =>
      new Promise((done) => {
        const deltas = [];
        let last = performance.now();
        const started = last;
        const tick = (now) => {
          deltas.push(now - last);
          last = now;
          if (deltas.length >= maxFrames || (now - started >= windowMs && deltas.length >= minFrames)) {
            // Drop the first delta: it carries whatever the page was doing when
            // the sample was armed rather than a steady frame.
            done(deltas.slice(1));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { windowMs: WINDOW_MS, minFrames: MIN_FRAMES, maxFrames: MAX_FRAMES },
  );

async function menuSample(browser, url, vp, sky) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(`${url}/?gate=0&sky=${sky ? 1 : 0}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible, null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  // The bake is a one-off: give it, the font loads and the first screen cache
  // room to happen before the window opens, or the sample prices the boot.
  await page.waitForTimeout(3000);
  const deltas = await sample(page);
  await ctx.close();
  return median(deltas);
}

async function matchSample(browser, url, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  await page.goto(`${url}/?debug=1`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const deltas = await sample(page);
  await ctx.close();
  return median(deltas);
}

const main = async () => {
  const served = await serve();
  // **Vsync off, or this instrument cannot see the thing it is measuring.**
  // a0-75 wrote it down and this rig re-learned it: headless Chromium presents
  // on the compositor's clock, so a median rAF delta is QUANTISED to 16.7 ms.
  // The first run of this file read 16.7 -> 33.3 ms at every phone pass — three
  // passes, perfectly repeatable, and completely uninformative: all it says is
  // "the frame crossed one vsync boundary", which is true of a 0.1 ms regression
  // and of a 16 ms one alike. With the limiter off, rAF fires as fast as the
  // frame is drawn and the delta is the frame.
  const browser = await chromium.launch({
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  const rows = [];
  try {
    for (const vp of VIEWPORTS) {
      const withSky = [];
      const without = [];
      for (let r = 0; r < REPEATS; r++) {
        // Alternate which goes first, so a load drift cannot land on one column.
        if (r % 2 === 0) {
          without.push(await menuSample(browser, served.url, vp, false));
          withSky.push(await menuSample(browser, served.url, vp, true));
        } else {
          withSky.push(await menuSample(browser, served.url, vp, true));
          without.push(await menuSample(browser, served.url, vp, false));
        }
        process.stdout.write(
          `  ${vp.name} pass ${r + 1}: sky=0 ${without[without.length - 1].toFixed(1)} ms · ` +
            `sky=1 ${withSky[withSky.length - 1].toFixed(1)} ms\n`,
        );
      }
      const match = await matchSample(browser, served.url, vp);
      rows.push({
        viewport: vp.name,
        pixels: vp.w * vp.h * vp.dpr * vp.dpr,
        skyOff: median(without),
        skyOn: median(withSky),
        offPasses: without,
        onPasses: withSky,
        match,
      });
    }
  } finally {
    await browser.close();
    served.proc.kill('SIGTERM');
  }

  const lines = [];
  const say = (t = '') => {
    lines.push(t);
    console.log(t);
  };
  say('a0-79 — what the MENU BACKDROP costs per frame');
  say('='.repeat(78));
  say('');
  say('Median rAF delta on the MAIN MENU, one bundle, `?sky=0` vs `?sky=1`, taken');
  say(`back to back, ${REPEATS} alternated passes, ~${WINDOW_MS} ms window each. The match column`);
  say('is `?debug=1` in the same run: this box has NO GPU (SwiftShader), so the');
  say('milliseconds are this box\'s and the RATIO is what travels.');
  say('');
  say('  viewport               device px    sky=0     sky=1     backdrop   match    menu/match');
  for (const r of rows) {
    const delta = r.skyOn - r.skyOff;
    say(
      `  ${r.viewport.padEnd(22)} ${String((r.pixels / 1e6).toFixed(2) + ' Mpx').padEnd(11)}` +
        ` ${r.skyOff.toFixed(1).padStart(7)} ms ${r.skyOn.toFixed(1).padStart(7)} ms` +
        ` ${(delta >= 0 ? '+' : '') + delta.toFixed(1)} ms`.padStart(11) +
        ` ${r.match.toFixed(1).padStart(7)} ms  ${(r.skyOn / r.match).toFixed(2)}x`,
    );
  }
  say('');
  say('`menu/match` is the invariant tests/mobile/menu-frame-cost.spec.ts gates on');
  say('(ceiling 4x): the static front door must not cost more than the running game.');
  writeFileSync(`${HERE}frame-cost.txt`, lines.join('\n') + '\n');
  writeFileSync(`${HERE}frame-cost.json`, JSON.stringify(rows, null, 2) + '\n');
};

main()
  .then(() => {
    // The spawned previews keep the event loop alive even after SIGTERM, so say
    // so explicitly rather than leaving a rig that has finished looking hung.
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
