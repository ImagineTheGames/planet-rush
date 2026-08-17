/**
 * evidence/a0-75-fill-rate/frames-ab.mjs — the SHIPPED screens, before and after.
 * OWNER: Art Agent (a0-75).
 *
 * ## Why this exists when the goldens passed
 *
 * All 50 baselines in `tests/mobile/goldens.spec.ts-snapshots` pass unchanged on
 * this branch. That is a real result and it is not the whole answer, for a reason
 * that spec states about itself: its tolerance (`maxDiffPixelRatio` 1%, over a
 * frame that is mostly star-field) is set to survive font and GPU antialiasing,
 * and a change can sit under it and still be a change — *"a complete re-skin of
 * the screen a player spends the entire match on sat on the knife-edge of the one
 * gate that is supposed to catch it"*.
 *
 * So the baselines are NOT re-generated: regenerating them would write 50
 * byte-different PNGs recording a difference the studio's own gate calls
 * immaterial, which is churn that also throws away the useful fact that it IS
 * under the gate. Instead this file captures the same frames from **both
 * bundles** and measures the difference directly, on the whole shipped screen —
 * entities, HUD and all — so it can be looked at rather than inferred.
 *
 * Needs the two bundles `./ab-sweep.mjs` needs. Writes `./frames-shipped/`.
 *
 *   node evidence/a0-75-fill-rate/frames-ab.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const AFTER_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BEFORE_ROOT = process.env.A075_BEFORE_ROOT ?? '/tmp/a075-before';
const OUT = new URL('./frames-shipped/', import.meta.url);

const BUILDS = [
  { name: 'before', root: BEFORE_ROOT, port: Number(process.env.A075_BEFORE_PORT ?? 4243) },
  { name: 'after', root: AFTER_ROOT, port: Number(process.env.A075_AFTER_PORT ?? 4244) },
];

/**
 * The scenes. The three maps are the three the golden suite singles out — `oval`
 * is the additive sky, `line` is *"the frame the developer photographed"*, and
 * `compass` is the control the suite says has to stay still. `octagon` is the
 * default board and its sky is NONE, so it is the case where only the star field
 * and the ground are in the frame: if THAT one moves, something is wrong that has
 * nothing to do with either fix.
 *
 * 1280×800 is `docs/perf-gate.md`'s desktop control profile and the golden
 * baseline's own size. 3440×1440 is the developer's, where the aspect fix bites
 * hardest and no golden exists at all.
 */
const SCENES = [
  { map: 'octagon', name: 'octagon-none', w: 1280, h: 800 },
  { map: 'compass', name: 'compass-coalsack', w: 1280, h: 800 },
  { map: 'oval', name: 'oval-plasma-reef', w: 1280, h: 800 },
  { map: 'line', name: 'line-deep-ember', w: 1280, h: 800 },
  { map: 'oval', name: 'oval-plasma-reef-ultrawide', w: 3440, h: 1440 },
  { map: 'line', name: 'line-deep-ember-ultrawide', w: 3440, h: 1440 },
];

async function serve(build) {
  if (!existsSync(`${build.root}/dist/index.html`)) {
    throw new Error(`${build.name}: no built bundle at ${build.root}/dist`);
  }
  const proc = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(build.port), '--strictPort'],
    { cwd: build.root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(`[${build.name}] ${d}`));
  const url = `http://127.0.0.1:${build.port}`;
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return { ...build, url, proc };
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill('SIGTERM');
  throw new Error(`${build.name}: preview did not come up on ${build.port}`);
}

async function shoot(browser, served, scene, file) {
  const ctx = await browser.newContext({
    viewport: { width: scene.w, height: scene.h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript((id) => localStorage.setItem('planet-rush:mapId', id), scene.map);
  await page.goto(`${served.url}/?debug=1&freeze=1`, { waitUntil: 'load' });

  // ── THE SETTLE, AND WHY IT IS THREE THINGS AND NOT ONE ──────────────────
  //
  // The first version of this waited eight animation frames, on the reasoning
  // tests/mobile/render-settle.ts gives: wait for FRAMES, never for
  // milliseconds. That reasoning is right and eight is not enough, and the
  // failure was loud enough to be worth recording — the "after" capture of the
  // reef came back as a **blank Vacuum rectangle** while the "before" came back
  // as a full match, and the diff duly reported maxΔ 242 and 100% of pixels
  // changed. A number that large is not a rendering difference on a backdrop
  // whose peak luma is 59; it is two different moments.
  //
  // Eight frames is a real wait only once the app is DRAWING. On a shared
  // software-GL box this bundle takes seconds to boot — fonts, the texture
  // bakes, the backdrop's own geometry build — and eight rAF ticks can all land
  // inside that. So:
  //
  //  1. wait for the debug hook, which only exists after the boot path has run
  //     to the point of installing it (`?debug=1`, platform/debug-hook.ts);
  //  2. wait for the sim's own clock to be readable AND the canvas to be
  //     non-blank, which is the first thing that proves a frame was drawn;
  //  3. and only then count frames, generously, so the a0-75 sky cache has
  //     certainly baked and the frozen frame has certainly been presented twice.
  await page.waitForFunction(() => window.__planetRush !== undefined, null, { timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      // A blank frame is the clear colour everywhere. Sample a coarse grid off a
      // 2d copy and require some variance — cheap, and it cannot pass on Vacuum.
      const s = document.createElement('canvas');
      s.width = 64;
      s.height = 40;
      const g = s.getContext('2d');
      if (!g) return false;
      g.drawImage(c, 0, 0, 64, 40);
      const px = g.getImageData(0, 0, 64, 40).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (y < min) min = y;
        if (y > max) max = y;
      }
      return max - min > 8; // a drawn frame has a station and a star-field in it
    },
    null,
    { timeout: 180_000 },
  );
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const tick = () => (++n >= 30 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  await page.screenshot({ path: file });
  await ctx.close();
}

/** Per-channel and luma difference between two PNGs of the same size. */
function compare(aPath, bPath) {
  const a = PNG.sync.read(readFileSync(aPath));
  const b = PNG.sync.read(readFileSync(bPath));
  const n = Math.min(a.data.length, b.data.length) / 4;
  let maxCh = 0;
  let sumCh = 0;
  let changed = 0;
  let over2 = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const m = Math.max(dr, dg, db);
    if (m > maxCh) maxCh = m;
    sumCh += (dr + dg + db) / 3;
    if (m > 0) changed++;
    if (m > 2) over2++;
  }
  return {
    pixels: n,
    maxChannel: maxCh,
    meanChannel: sumCh / n,
    changedFraction: changed / n,
    over2Fraction: over2 / n,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const served = [];
  for (const b of BUILDS) served.push(await serve(b));
  const browser = await chromium.launch();
  const rows = [];
  for (const scene of SCENES) {
    const paths = {};
    for (const s of served) {
      paths[s.name] = fileURLToPath(new URL(`./${scene.name}-${s.name}.png`, OUT));
      await shoot(browser, s, scene, paths[s.name]);
    }
    const d = compare(paths.before, paths.after);
    rows.push({ scene: scene.name, map: scene.map, width: scene.w, height: scene.h, ...d });
    console.log(
      `${scene.name.padEnd(28)} ${scene.w}x${scene.h}  maxΔ ${String(d.maxChannel).padStart(3)}  ` +
        `meanΔ ${d.meanChannel.toFixed(4)}  any ${(d.changedFraction * 100).toFixed(1)}%  ` +
        `>2 codes ${(d.over2Fraction * 100).toFixed(2)}%`,
    );
  }
  await browser.close();
  for (const s of served) s.proc.kill('SIGTERM');
  writeFileSync(new URL('./frames-ab.json', import.meta.url), `${JSON.stringify({ rows }, null, 2)}\n`);
  console.log('\nwrote frames-ab.json and frames-shipped/');
}

await main();
