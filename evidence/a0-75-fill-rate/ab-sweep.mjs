/**
 * evidence/a0-75-fill-rate/ab-sweep.mjs — the shipped bundle before AND after,
 * INTERLEAVED. OWNER: Art Agent (a0-75).
 *
 * ## Why this exists, and why `./sweep.mjs` alone was not enough
 *
 * `./sweep.mjs` measures one bundle across six viewports. That is the right
 * instrument for *"does frame time follow a fragment model"* — every row is
 * taken minutes apart, but the model is fitted across rows, so a slow patch
 * shifts the intercept rather than the shape.
 *
 * It is the WRONG instrument for before-vs-after, on this box, for one reason:
 * the studio image is shared. Four lanes run their suites on the same eight
 * cores, and a `vitest --run` next door is a 300%-CPU neighbour. Measured, that
 * is worth up to **+44%** on a reading — an early attempt at the "after" table
 * came back slower than "before" purely because a `vite build` of my own was
 * running beside it, and the clean A/B says −60%. A comparison between two runs
 * taken twenty minutes apart is a comparison between two machine loads.
 *
 * So this file builds **both** bundles, serves them on two ports, and takes the
 * two readings for a viewport **back to back in the same minute**, alternating
 * which goes first so a monotonic drift in load cannot land on one column. That
 * is the only shape of before/after this box can support honestly.
 *
 *   git worktree add /tmp/a075-before <pre-branch-sha>
 *   ln -sfn "$PWD/node_modules" /tmp/a075-before/node_modules
 *   (cd /tmp/a075-before && npx vite build)
 *   npx vite build
 *   node evidence/a0-75-fill-rate/ab-sweep.mjs
 *
 * Same caveat as every timing file here: SwiftShader, no GPU, so the ratios
 * travel and the absolute milliseconds do not. `./overdraw.ts` is the portable
 * half.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const AFTER_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BEFORE_ROOT = process.env.A075_BEFORE_ROOT ?? '/tmp/a075-before';

const argv = process.argv.slice(2);
const arg = (n, f) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : f;
};
const FRAMES = Number(arg('frames', 45));
const SETTLE = Number(arg('settle', 25));
const MAP = arg('map', 'oval');

const BUILDS = [
  { name: 'before', root: BEFORE_ROOT, port: Number(process.env.A075_BEFORE_PORT ?? 4241) },
  { name: 'after', root: AFTER_ROOT, port: Number(process.env.A075_AFTER_PORT ?? 4242) },
];

const VIEWPORTS = [
  { name: 'phone', w: 798, h: 384 },
  { name: '1280x720', w: 1280, h: 720 },
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '2560x1440', w: 2560, h: 1440 },
  { name: '3440x1440', w: 3440, h: 1440 },
  { name: '5120x1440', w: 5120, h: 1440 },
];

/**
 * Frozen by default: `?freeze=1` pins the sim at the golden tick, so the only
 * difference between the two columns is the render path and the only difference
 * between rows is the viewport.
 *
 * `--live` runs the same A/B on a running match instead. The brief asks for
 * both, and they answer different halves: the frozen scene is the controlled
 * measurement, and the live one is the frame a player actually pays for — bot AI
 * on eight seats, projectiles in flight, ore chunks, and a camera that moves, so
 * the cull admits a different entity count at every viewport. It carries more
 * variance, which is why it is the second table and not the first.
 */
const QUERY = argv.includes('--live') ? '?debug=1' : '?debug=1&freeze=1';
const LABEL = argv.includes('--live') ? 'live' : 'frozen';
const ONLY = arg('only', null);

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

async function serve(build) {
  if (!existsSync(`${build.root}/dist/index.html`)) {
    throw new Error(`${build.name}: no built bundle at ${build.root}/dist — run vite build there first`);
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

async function reading(browser, served, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((mapId) => localStorage.setItem('planet-rush:mapId', mapId), MAP);
  await page.goto(`${served.url}/${QUERY}`, { waitUntil: 'load' });
  await page.waitForTimeout(3000); // boot, texture uploads, the one backdrop bake
  const deltas = await page.evaluate(
    ({ frames, settle }) =>
      new Promise((done) => {
        const a = [];
        let last = performance.now();
        let seen = 0;
        const tick = (now) => {
          const dt = now - last;
          last = now;
          seen++;
          if (seen > settle) a.push(dt);
          if (a.length < frames) {
            requestAnimationFrame(tick);
            return;
          }
          done(a);
        };
        requestAnimationFrame(tick);
      }),
    { frames: FRAMES, settle: SETTLE },
  );
  await ctx.close();
  const sorted = [...deltas].sort((x, y) => x - y);
  return { median: pct(sorted, 0.5), p95: pct(sorted, 0.95), frames: sorted.length };
}

async function main() {
  const served = [];
  for (const b of BUILDS) served.push(await serve(b));

  const browser = await chromium.launch({
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });

  const rows = [];
  const chosen = ONLY ? VIEWPORTS.filter((v) => ONLY.split(',').includes(v.name)) : VIEWPORTS;
  for (const [i, vp] of chosen.entries()) {
    // Alternate the order. If the machine's load drifts monotonically over the
    // run, a fixed order would push all of that drift into one column.
    const order = i % 2 === 0 ? served : [...served].reverse();
    const got = {};
    for (const s of order) got[s.name] = await reading(browser, s, vp);
    const row = {
      scene: LABEL,
      viewport: vp.name,
      megapixels: (vp.w * vp.h) / 1e6,
      firstMeasured: order[0].name,
      before: got.before,
      after: got.after,
    };
    rows.push(row);
    console.log(
      `${LABEL.padEnd(7)} ${vp.name.padEnd(10)} ${row.megapixels.toFixed(2).padStart(5)} Mpx  ` +
        `before ${row.before.median.toFixed(1).padStart(7)} ms (p95 ${row.before.p95.toFixed(0).padStart(5)})  ` +
        `after ${row.after.median.toFixed(1).padStart(7)} ms (p95 ${row.after.p95.toFixed(0).padStart(5)})  ` +
        `${(((row.after.median - row.before.median) / row.before.median) * 100).toFixed(0).padStart(4)}%  ` +
        `[${row.firstMeasured} first]`,
    );
  }

  await browser.close();
  for (const s of served) s.proc.kill('SIGTERM');
  writeFileSync(
    new URL(`./ab-sweep-${LABEL}.json`, import.meta.url),
    `${JSON.stringify({ scene: LABEL, map: MAP, frames: FRAMES, settle: SETTLE, query: QUERY, rows }, null, 2)}\n`,
  );
  console.log(`\nwrote ab-sweep-${LABEL}.json`);
}

await main();
