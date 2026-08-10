/**
 * evidence/a1-07-sky-registry/probe-throttle.mjs — a1-07, the one thing the six
 * frames turned up. OWNER: QA Manager.
 *
 * `shoot-skies.mjs` read The Oval's sky twice and got two different answers:
 * `?debug=1&freeze=1` had `void-nebula-plasmaReef` on the stage, and the LIVE
 * `?debug=1` boot of the same bundle had **no nebula layer at all**. Every other
 * arena answered the same both ways.
 *
 * That is not a registry fault and this run is here to say so with a watched
 * transition rather than a guess. `Void.build()`:
 *
 *     const density = this.reduced ? this.nebula.reducedDensity : 1;
 *     const drawSky = this.nebula.id !== 'none' && density > 0;
 *
 * and `plasmaReef.reducedDensity` is **0** — alone among the five coloured skies
 * (coalsack 1, deepEmber 1, ironVeil 0.5, patinaDrift 0.45). So when
 * `VfxAutoQuality` engages (smoothed fps ≤ 30 held for 3 s, `DEFAULT_VFX_QUALITY`)
 * the reef is the one sky that goes to nothing. `?debug=1&freeze=1` never
 * throttles — `main.ts` passes `flags.freeze ? false : vfxQuality.sample(...)` —
 * which is exactly why the frozen frame still has it.
 *
 * The probe polls both arenas' live boots side by side for 40 s, recording the
 * published fps and the nebula layer present on the stage each second:
 *
 *   • `oval`  — plasmaReef, reducedDensity 0    → expected to VANISH mid-run
 *   • `line`  — deepEmber,  reducedDensity 1    → the CONTROL: same box, same
 *                                                 throttle, sky must survive
 *
 * A control is the whole point. Without `line` in the same run, "the reef left"
 * is equally well explained by the box, the bundle or the harness.
 *
 *   node evidence/a1-07-sky-registry/probe-throttle.mjs [port]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4287';
const BASE = `http://127.0.0.1:${PORT}`;
const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const SECONDS = 40;

const CASES = [
  { id: 'oval', sky: 'plasmaReef', reducedDensity: 0, role: 'subject' },
  { id: 'line', sky: 'deepEmber', reducedDensity: 1, role: 'control' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = () => {
  const app = globalThis.__qaApp;
  let found = null;
  const walk = (n, d) => {
    if (found || d > 24) return;
    const kids = n.children || [];
    if (kids.some((c) => c.label === 'void-ground')) {
      found = n;
      return;
    }
    for (const c of kids) walk(c, d + 1);
  };
  if (app?.stage) walk(app.stage, 0);
  const labels = found ? found.children.map((c) => c.label).filter(Boolean) : [];
  const pr = globalThis.__planetRush;
  return {
    fps: Math.round((pr?.fps ?? 0) * 10) / 10,
    ticks: pr?.ticks ?? null,
    nebula: labels.find((l) => l.startsWith('void-nebula-'))?.replace('void-nebula-', '') ?? null,
    layers: labels.length,
  };
};

mkdirSync(OUT, { recursive: true });
const served = await (await fetch(`${BASE}/version.json`)).json();
console.log(`served ${JSON.stringify(served)}   probing ${SECONDS}s per arena, in parallel\n`);

const browser = await chromium.launch();

async function open(c) {
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(`
    try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(c.id)}); } catch (e) {}
    globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
  `);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
  return { c, ctx, page, samples: [] };
}

// Both arenas run at once, on the same box under the same load — the control is
// only a control if it is throttled by the same thing at the same time.
const runs = await Promise.all(CASES.map(open));
const t0 = Date.now();
for (let s = 0; s < SECONDS; s++) {
  await sleep(1000);
  for (const r of runs) {
    const sample = await r.page.evaluate(SAMPLE);
    sample.t = Math.round((Date.now() - t0) / 100) / 10;
    r.samples.push(sample);
  }
  const line = runs.map((r) => {
    const l = r.samples[r.samples.length - 1];
    return `${r.c.id} fps ${String(l.fps).padStart(5)} sky ${(l.nebula ?? '—').padEnd(11)}`;
  });
  console.log(`  t+${String(s + 1).padStart(2)}s   ${line.join('   ')}`);
}

const report = { served, seconds: SECONDS, cases: [] };
for (const r of runs) {
  const f = `throttle-${r.c.id}-after-${SECONDS}s.png`;
  await r.page.screenshot({ path: join(OUT, f) });
  const first = r.samples[0];
  const last = r.samples[r.samples.length - 1];
  const dropAt = r.samples.find((s, i) => i > 0 && r.samples[i - 1].nebula && !s.nebula);
  report.cases.push({
    ...r.c,
    frame: f,
    fpsFirst: first.fps,
    fpsLast: last.fps,
    fpsMedian: [...r.samples.map((s) => s.fps)].sort((a, b) => a - b)[Math.floor(r.samples.length / 2)],
    skyAtStart: first.nebula,
    skyAtEnd: last.nebula,
    droppedAtSeconds: dropAt ? dropAt.t : null,
    samples: r.samples,
  });
  console.log(
    `\n${r.c.id} (${r.c.sky}, reducedDensity ${r.c.reducedDensity}): sky ${first.nebula ?? '—'} -> ${last.nebula ?? '—'}` +
      `${dropAt ? `, dropped at t+${dropAt.t}s` : ''}   fps ${first.fps} -> ${last.fps}`,
  );
  await r.ctx.close();
}
writeFileSync(join(OUT, 'throttle.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(`\nwrote ${OUT}/throttle.json`);
