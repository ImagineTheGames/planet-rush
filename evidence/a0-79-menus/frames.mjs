/**
 * evidence/a0-79-menus/frames.mjs — the four menu screens, before and after,
 * from the SHIPPED bundles. OWNER: UI Engineer (a0-79).
 *
 *   git worktree add /tmp/a079-before origin/main
 *   ln -sfn "$PWD/node_modules" /tmp/a079-before/node_modules
 *   (cd /tmp/a079-before && npx vite build --outDir dist-a079-before)
 *   npx vite build --outDir dist-a079-after
 *   node evidence/a0-79-menus/frames.mjs
 *
 * Both bundles are served at once and each viewport's pair is shot back to back,
 * which is a0-75's discipline for a shared box: a picture is not a timing, but
 * two pictures taken twenty minutes apart can still differ by a font that had
 * loaded in one of them and not the other.
 *
 * Every screen is reached the way a PLAYER reaches it — a real press at the
 * point the menu's own seam says the plate is drawn, through the landscape-lock
 * remap — rather than by calling a debug method. A frame of a screen reached by
 * a seam proves the screen renders; one reached by a press proves it is also
 * reachable, which is the failure this repo has actually shipped before.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const AFTER_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BEFORE_ROOT = process.env.A079_BEFORE_ROOT ?? '/tmp/a079-before';

const BUILDS = [
  { name: 'before', root: BEFORE_ROOT, out: 'dist-a079-before', port: 4251 },
  { name: 'after', root: AFTER_ROOT, out: 'dist-a079-after', port: 4252 },
];

/**
 * The developer's own screenshot viewport, a PORTRAIT phone (the opposite
 * constraint — the landscape lock rotates it to 844×390 logical), and the
 * ultrawide the cost half of the brief names.
 */
const VIEWPORTS = [
  { name: '798x384-landscape-phone', w: 798, h: 384, dpr: 2, mobile: true },
  { name: '390x844-portrait-phone', w: 390, h: 844, dpr: 3, mobile: true },
  { name: '1280x720-desktop', w: 1280, h: 720, dpr: 1, mobile: false },
  { name: '3440x1440-ultrawide', w: 3440, h: 1440, dpr: 1, mobile: false },
];

/** The four screens the brief names, in the order a player meets them. */
const SCREENS = ['menu', 'settings', 'codex', 'hangar'];

async function serve(build) {
  if (!existsSync(`${build.root}/${build.out}/index.html`)) {
    throw new Error(`${build.name}: no bundle at ${build.root}/${build.out} — build it first`);
  }
  // **Refuse to attach to a server this rig did not start.** `vite preview` on a
  // busy port exits, and a loop that only polls for a 200 will happily measure —
  // or photograph — WHOSE EVER bundle is already there. That is not a theory:
  // playwright.config.ts carries the same warning because a0-06 got a local PASS
  // against another lane's pixels, and this rig hit it too, silently re-shooting
  // the previous run's bundle from an orphaned preview.
  try {
    const stale = await fetch(`http://127.0.0.1:${build.port}`, { signal: AbortSignal.timeout(1500) });
    if (stale.ok) throw new Error(`port ${build.port} already answers — kill it, this rig will not measure a stranger's bundle`);
  } catch (e) {
    if (e instanceof Error && e.message.includes('already answers')) throw e;
  }
  const proc = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      build.out,
      '--host',
      '127.0.0.1',
      '--port',
      String(build.port),
      '--strictPort',
    ],
    { cwd: build.root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[${build.name}] ${d}`));
  // Node's `fetch` resolves `localhost` to ::1 and vite binds IPv4 — the trap
  // a0-75 hit twice. Both ends say 127.0.0.1 here.
  const url = `http://127.0.0.1:${build.port}`;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return { ...build, url, proc };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill('SIGTERM');
  throw new Error(`${build.name}: preview never came up on ${build.port}`);
}

const settle = (page, frames = 6) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let left = n;
        const tick = () => (left-- <= 0 ? done(true) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );

async function stableViewport(page) {
  const read = () =>
    page.evaluate(() => {
      const m = window.__mainMenu;
      return m ? `${m.logicalViewport.width}x${m.logicalViewport.height}` : '';
    });
  let previous = await read();
  for (let i = 0; i < 20; i++) {
    await settle(page, 2);
    const next = await read();
    if (next !== '' && next === previous) return next;
    previous = next;
  }
  return previous;
}

async function pressPlate(page, kind, screen) {
  const point = await page.evaluate(
    (k) => {
      const c = window.__mainMenu?.controls.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    kind,
  );
  if (!point) throw new Error(`the menu never reported where ${kind} is drawn`);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction((s) => window.__mainMenu?.screen === s, screen, { timeout: 15_000 });
  // Park the pointer off every plate: a hovered plate is a brighter plate, and
  // the frame wanted here is the screen at REST.
  await page.mouse.move(1, 1);
  await settle(page);
}

/** The plate rects the menu reports, in LOGICAL space — the margin, measured on
 *  the same frame that was photographed rather than predicted beside it. */
async function plateReport(page) {
  return page.evaluate(() => {
    const m = window.__mainMenu;
    if (!m) return null;
    return {
      viewport: m.logicalViewport,
      rotated: m.rotated,
      plates: m.controls.map((c) => ({ kind: c.kind, ...c.logical })),
    };
  });
}

async function capture(browser, served, vp, rows) {
  const dir = `${HERE}frames/${vp.name}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await ctx.newPage();
  // `?gate=0` skips the title door and NOTHING else — the menu behind it is the
  // real one. Without it the first click lands on the airlock.
  await page.goto(`${served.url}/?gate=0`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__mainMenu?.visible && window.__mainMenu.controls.length > 0, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts?.ready);
  await stableViewport(page);
  await settle(page);

  for (const screen of SCREENS) {
    if (screen === 'settings') await pressPlate(page, 'settings', 'settings');
    if (screen === 'codex') {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', null, { timeout: 15_000 });
      await settle(page);
      await pressPlate(page, 'codex', 'codex');
    }
    if (screen === 'hangar') {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__mainMenu?.screen === 'menu', null, { timeout: 15_000 });
      await settle(page);
      await pressPlate(page, 'hangar', 'hangar');
    }
    await page.screenshot({ path: `${dir}/${served.name}-${screen}.png` });
    if (screen === 'menu') {
      const report = await plateReport(page);
      // `...report` carries a `viewport` of its own (the LOGICAL one), so the
      // sweep's row name is spelled differently — spreading it over `viewport`
      // was what left the first summary empty.
      if (report) rows.push({ build: served.name, at: vp.name, ...report });
    }
  }
  await ctx.close();
}

const main = async () => {
  const served = [];
  for (const b of BUILDS) served.push(await serve(b));
  const browser = await chromium.launch();
  const rows = [];
  try {
    for (const vp of VIEWPORTS) {
      for (const s of served) {
        process.stdout.write(`${vp.name} · ${s.name}\n`);
        await capture(browser, s, vp, rows);
      }
    }
  } finally {
    await browser.close();
    for (const s of served) s.proc.kill('SIGTERM');
  }

  const lines = [];
  const say = (t = '') => {
    lines.push(t);
    console.log(t);
  };
  say('a0-79 — the plate margin, measured on the SHIPPED bundles');
  say('='.repeat(74));
  say('');
  for (const vp of VIEWPORTS) {
    const before = rows.find((r) => r.at === vp.name && r.build === 'before');
    const after = rows.find((r) => r.at === vp.name && r.build === 'after');
    if (!before || !after) continue;
    say(`── ${vp.name}  (logical ${after.viewport.width}x${after.viewport.height}${after.rotated ? ', rotated' : ''})`);
    const one = (r) => {
      const p = r.plates[0];
      const left = p.x;
      const right = r.viewport.width - (p.x + p.width);
      return `plate ${p.width.toFixed(0)}px · field ${left.toFixed(0)}/${right.toFixed(0)}px · ${(
        (left / r.viewport.width) *
        100
      ).toFixed(2)}% a side`;
    };
    say(`   before : ${one(before)}`);
    say(`   after  : ${one(after)}`);
    say('');
  }
  writeFileSync(`${HERE}frames.txt`, lines.join('\n') + '\n');
  writeFileSync(`${HERE}frames.json`, JSON.stringify(rows, null, 2) + '\n');
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
