/**
 * evidence/r9-01-sky-survives-reducer/probe-sky-survives.mjs — r9-01, the live
 * proof. OWNER: Art Agent.
 *
 * a1-07 measured the defect on the served build `dd1d3f5` with a control: The
 * Oval booted **with** `void-nebula-plasmaReef` on the stage, held it for three
 * polls, and at **t+8.3 s the layer was gone**, while Line kept
 * `void-nebula-deepEmber` for the full 40 s on the same box under the same load.
 * A single frame proves nothing here — the bug needed 8.3 s to appear.
 *
 * This run is the same shape with one more axis: **both builds, same box, same
 * throttle, back to back.**
 *
 *   before  dd1d3f5   — main, the code as it stood
 *   after   <branch>  — r9-01
 *
 * and in each build, two arenas in parallel:
 *
 *   oval  → plasmaReef, the sky that left
 *   line  → deepEmber,  the control that never did
 *
 * ## Two things this reads off the live scene graph, and why both
 *
 *  1. **`void-nebula-*`** — the subject. `Void.build()` writes the label from the
 *     same `nebula.id` the geometry is drawn from, so the label cannot disagree
 *     with what is on the stage (a1-07's argument, reused unchanged).
 *
 *  2. **The station atmosphere halo's instruction count** — the *reducer's own
 *     state*, positively, with no debug seam added for it. `drawAtmosphere`
 *     rebuilds the owned station's halo as **rings alone** when `reduceVfx` is
 *     on: `atmosphereHaloSprite` is 53 shapes full and 13 reduced (the
 *     `haloGradient` discs are what goes), and `drawSprite` plays one instruction
 *     per shape. So `atmosphere-*` at 53 means the tier is full and 13 means it
 *     is reduced, read off the same page in the same poll.
 *
 * That second readout is what makes the *after* run mean anything. Before the
 * fix, "the reef is gone" was itself the proof the reducer had engaged; after the
 * fix the sky no longer answers that question, so something else has to.
 *
 * ## Why the CPU is throttled on purpose
 *
 * `VfxAutoQuality` engages when the smoothed rate holds at or below 30 fps for
 * 3 s (`DEFAULT_VFX_QUALITY`). a1-07 got that for free from two contexts at
 * `deviceScaleFactor 2` on a loaded box; "for free" is not repeatable, so this
 * run drives it with CDP `Emulation.setCPUThrottlingRate` instead — applied
 * AFTER boot, so every case boots at full speed with its sky on the stage and is
 * then throttled while a player is looking at it. That is the reported bug's
 * exact sequence.
 *
 *   node evidence/r9-01-sky-survives-reducer/probe-sky-survives.mjs <beforePort> <afterPort>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'images'); // the manifest's own folder — one copy, not two
const BEFORE_PORT = process.argv[2] ?? '4288';
const AFTER_PORT = process.argv[3] ?? '4287';
const VP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
/** Longer than a1-07's 40 s, because 40 s is the number the claim is made about
 *  and evidence should outlast the claim rather than land exactly on it. */
const SECONDS = 45;
/** The poll at which the CPU is throttled — after the sky is demonstrably up. */
const THROTTLE_AT = 3;
/** Enough to put a 1440×900 @2× canvas well under the 30 fps floor and hold it. */
const CPU_RATE = 8;

/** Instruction counts of `atmosphereHaloSprite` (src/art/stations.ts), per tier. */
const HALO_FULL = 53;
const HALO_REDUCED = 13;

const BUILDS = [
  { id: 'before', label: 'dd1d3f5 — the code as it stood', port: BEFORE_PORT },
  { id: 'after', label: 'r9-01 — the sky may thin, never leave', port: AFTER_PORT },
];

const CASES = [
  { id: 'oval', sky: 'plasmaReef', role: 'subject' },
  { id: 'line', sky: 'deepEmber', role: 'control' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One poll of the live scene graph. Runs in the page. */
const SAMPLE = () => {
  const app = globalThis.__qaApp;
  let backdrop = null;
  let halo = null;
  const walk = (n, d) => {
    if (d > 24) return;
    const kids = n.children || [];
    if (!backdrop && kids.some((c) => c.label === 'void-ground')) backdrop = n;
    for (const c of kids) {
      if (!halo && typeof c.label === 'string' && c.label.startsWith('atmosphere-') && c.visible) halo = c;
      walk(c, d + 1);
    }
  };
  if (app?.stage) walk(app.stage, 0);
  const labels = backdrop ? backdrop.children.map((c) => c.label).filter(Boolean) : [];
  const pr = globalThis.__planetRush;
  return {
    fps: Math.round((pr?.fps ?? 0) * 10) / 10,
    ticks: pr?.ticks ?? null,
    nebula: labels.find((l) => l.startsWith('void-nebula-'))?.replace('void-nebula-', '') ?? null,
    layers: labels,
    halo: halo?.context?.instructions?.length ?? null,
  };
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { seconds: SECONDS, throttleAtSeconds: THROTTLE_AT, cpuThrottlingRate: CPU_RATE, builds: [] };

for (const build of BUILDS) {
  const base = `http://127.0.0.1:${build.port}`;
  const served = await (await fetch(`${base}/version.json`)).json();
  console.log(`\n=== ${build.id}: ${build.label}   served ${JSON.stringify(served)} ===`);

  const runs = await Promise.all(
    CASES.map(async (c) => {
      const ctx = await browser.newContext(VP);
      await ctx.addInitScript(`
        try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(c.id)}); } catch (e) {}
        globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
      `);
      const page = await ctx.newPage();
      await page.goto(`${base}/?debug=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__planetRush?.shipWorld, undefined, { timeout: 30_000 });
      const cdp = await ctx.newCDPSession(page);
      return { c, ctx, page, cdp, samples: [] };
    }),
  );

  const t0 = Date.now();
  for (let s = 0; s < SECONDS; s++) {
    await sleep(1000);
    // Both arenas are throttled at the same poll, so the control is throttled by
    // the same thing at the same time as the subject.
    if (s + 1 === THROTTLE_AT) {
      for (const r of runs) await r.cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
      console.log(`  --- CPU throttled ${CPU_RATE}x at t+${THROTTLE_AT}s ---`);
    }
    for (const r of runs) {
      const sample = await r.page.evaluate(SAMPLE);
      sample.t = Math.round((Date.now() - t0) / 100) / 10;
      r.samples.push(sample);
    }
    const line = runs.map((r) => {
      const l = r.samples[r.samples.length - 1];
      const tier = l.halo === HALO_FULL ? 'full' : l.halo === HALO_REDUCED ? 'REDUCED' : `?${l.halo}`;
      return `${r.c.id} fps ${String(l.fps).padStart(5)} vfx ${tier.padEnd(7)} sky ${(l.nebula ?? '— GONE').padEnd(11)}`;
    });
    console.log(`  t+${String(s + 1).padStart(2)}s   ${line.join('  ')}`);
  }

  const cases = [];
  for (const r of runs) {
    const frame = `r9-01-${build.id}-${r.c.id}-t${SECONDS}s.png`;
    await r.page.screenshot({ path: join(OUT, frame) });
    const first = r.samples[0];
    const last = r.samples[r.samples.length - 1];
    const dropAt = r.samples.find((s, i) => i > 0 && r.samples[i - 1].nebula && !s.nebula);
    const reducedAt = r.samples.find((s) => s.halo === HALO_REDUCED);
    const fps = r.samples.map((s) => s.fps);
    cases.push({
      ...r.c,
      frame,
      skyAtStart: first.nebula,
      skyAtEnd: last.nebula,
      skyPresentEverySample: r.samples.every((s) => s.nebula === first.nebula),
      droppedAtSeconds: dropAt ? dropAt.t : null,
      reduceVfxEngagedAtSeconds: reducedAt ? reducedAt.t : null,
      reduceVfxEngagedAtEnd: last.halo === HALO_REDUCED,
      fpsFirst: first.fps,
      fpsLast: last.fps,
      fpsMedianAfterThrottle: [...fps.slice(THROTTLE_AT)].sort((a, b) => a - b)[
        Math.floor((fps.length - THROTTLE_AT) / 2)
      ],
      samples: r.samples,
    });
    console.log(
      `\n  ${r.c.id} (${r.c.sky}, ${r.c.role}): sky ${first.nebula ?? '—'} -> ${last.nebula ?? '—'}` +
        `${dropAt ? `, DROPPED at t+${dropAt.t}s` : ', held every poll'}` +
        `   reduce-vfx ${reducedAt ? `engaged t+${reducedAt.t}s` : 'never engaged'}` +
        `   fps ${first.fps} -> ${last.fps}`,
    );
    await r.ctx.close();
  }
  report.builds.push({ ...build, served, cases });
}

writeFileSync(join(HERE, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(`\nwrote ${join(HERE, 'measurements.json')} and ${OUT}/`);
