/**
 * evidence/a0-39-additive-sky-artifacts/shoot.mjs — a0-39, the instrument.
 * OWNER: Art Agent.
 *
 * The developer: *"the maps have visual artifacts … its the nebulas that are
 * fucked"*, with a control — *"i played on compass and the bloom was correct"*.
 * So this takes one frame of the **backdrop alone** per map, at a real viewport,
 * over that map's real arena bounds, through `./sky-rig.ts`; and on each frame it
 * counts what a band is:
 *
 *  · **rings** — a scan line through the brightest blob's centre, run through a
 *    step detector. A true radial gradient steps by ≤ 1 luma unit per pixel over
 *    its whole falloff; a stack of filled discs steps by a whole stop's worth at
 *    each stop radius and by nothing in between. The count and the *radii* of
 *    those steps are the measurement that closes (or refutes) the diagnosis: if
 *    the steps land on `SOFT_STOPS`/`ADDITIVE_STOPS`, the bands are the stack.
 *  · **peak Y′** — the brightest pixel, so a fix can be shown not to have made
 *    the sky brighter (it must not: `NebulaSpec.peakLuma` is pinned in CI).
 *
 * Usage — it runs its own dev server and its own browser:
 *   node evidence/a0-39-additive-sky-artifacts/shoot.mjs <label>
 *
 * Writes `frames/<label>/<map>-<sky>.png` and `rings-<label>.json`.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LABEL = process.argv[2] ?? 'before';
const PORT = Number(process.env.SKY_RIG_PORT ?? 5189);
const OUT = join(HERE, 'frames', LABEL);

/** The desktop control screen from `docs/perf-gate.md`, at dpr 1. */
const VIEW = { viewW: 1280, viewH: 800 };

/**
 * The six boards, in the developer's own split: `compass` is the control they
 * played and found correct, `octagon` is the empty sky, and the other four are
 * the set under report.
 */
const MAPS = ['octagon', 'compass', 'oval', 'diamond', 'line', 'crescents'];

/** Y′ on gamma-encoded bytes — the scale every number in `backdrop.ts` is on. */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Ring detection on a starless frame.
 *
 * Find the brightest pixel — on a sky-only frame that is inside a blob's core —
 * then walk right along its row and record every **adjacent-pixel jump** of at
 * least `EDGE` luma. That is the whole test, and it is deliberately crude,
 * because the thing being detected is crude: a stack of filled discs steps by
 * one stop's worth of alpha at each stop radius and by *nothing* in between, so
 * its scan line is a staircase with a handful of treads. A true radial gradient
 * over the same span changes by at most one 8-bit code every few pixels and
 * produces a staircase with hundreds of one-code treads, none of them ≥ 0.5.
 *
 * `EDGE = 0.5` is half a luma unit. It is the right threshold because a sky's
 * whole peak is ~10 luma over a ground of 1.9: a step of 0.9 there is a **47%
 * relative change** across one pixel, which is exactly why these read as edges
 * on a near-black screen and why a rule tuned for a bright image would miss them.
 *
 * `edgeRadii` is the number that closes the diagnosis: each jump's distance from
 * the core, as a fraction of the outermost jump's. If the drawing is a stop
 * stack, those fractions are `SOFT_STOPS`/`ADDITIVE_STOPS` — 0.20 / 0.46 / 0.72
 * / 1.00 — read straight off the pixels.
 */
const EDGE = 0.5;

function scanRings(png) {
  const { width, height, data } = png;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return luma(data[i], data[i + 1], data[i + 2]);
  };
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = at(x, y);
      if (l > best) {
        best = l;
        bx = x;
        by = y;
      }
    }
  }
  const row = [];
  for (let x = 0; x < width; x++) row.push(at(x, by));

  let maxJump = 0;
  const all = [];
  for (let x = 1; x < width; x++) {
    const d = row[x] - row[x - 1];
    maxJump = Math.max(maxJump, Math.abs(d));
    if (Math.abs(d) >= EDGE) all.push({ x, dist: Math.abs(x - bx), jump: +d.toFixed(2) });
  }
  // The rightward walk out of the core: one edge per ring, in radius order.
  const right = all.filter((e) => e.x > bx).sort((a, b) => a.dist - b.dist);
  const outer = right.length > 0 ? right[right.length - 1].dist : 0;
  const edgeRadii = outer > 0 ? right.map((e) => +(e.dist / outer).toFixed(3)) : [];
  return {
    peakLuma: +best.toFixed(2),
    peakAt: { x: bx, y: by },
    bandEdges: all.length,
    ringsRightOfCore: right.length,
    edgeRadii,
    maxAdjacentJump: +maxJump.toFixed(2),
    edges: all.slice(0, 60),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // **Wait for the server WE started, and die if the port was already taken.**
  // Not defensive coding: on the first run of this rig a stale dev server from a
  // previous invocation held 5189, the new one exited with "port in use", and
  // the browser happily connected to the OLD build and produced a full set of
  // "after" frames that were byte-identical to the "before" ones. `--strictPort`
  // is what makes that detectable; this is what makes it fatal. (a0-06 lost a
  // whole result to the same shape of mistake across lanes.)
  // `node_modules/.bin/vite` directly rather than `npx vite`: SIGTERM to an npx
  // wrapper does not reach the server it spawned, so the run before this one
  // left a live dev server on the port and the run after it aborted on the
  // guard above. One process, one signal, no orphan.
  const server = spawn(join(ROOT, 'node_modules', '.bin', 'vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    const onOut = (b) => {
      const s = String(b);
      process.stdout.write(`[vite] ${s}`);
      if (s.includes('ready in')) resolve();
    };
    const onErr = (b) => {
      const s = String(b);
      process.stderr.write(`[vite] ${s}`);
      if (/already in use/i.test(s)) {
        reject(
          new Error(
            `port ${PORT} is already in use — refusing to shoot against a server this run did not start. ` +
              `Kill it, or set SKY_RIG_PORT.`,
          ),
        );
      }
    };
    server.stdout.on('data', onOut);
    server.stderr.on('data', onErr);
    server.on('exit', (code) => reject(new Error(`vite exited with ${code} before it was ready`)));
    setTimeout(() => reject(new Error('vite did not report ready within 60 s')), 60_000);
  });
  await ready;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`http://localhost:${PORT}/evidence/a0-39-additive-sky-artifacts/sky-rig.html`);
  await page.waitForFunction(() => document.title === 'sky-rig ready', null, { timeout: 60_000 });

  const report = { label: LABEL, view: VIEW, edgeThreshold: EDGE, maps: {} };
  for (const map of MAPS) {
    // Two frames per map: the whole backdrop, which is what the developer is
    // looking at, and the sky alone, which is what the ring count can honestly
    // be run on (a star's core is a hard edge and would swamp every threshold).
    const meta = await page.evaluate((shot) => window.__skyRig.show(shot), {
      map,
      ...VIEW,
      offX: 0,
      offY: 0,
    });
    // Screenshotted off the canvas element rather than read back through
    // `getImageData`: the rig's WebGL context does not preserve its drawing
    // buffer, so a read-back after the frame has been composited returns black.
    // The compositor's own copy is also the truer instrument — it is literally
    // the pixels a player is looking at.
    const full = await page.locator('canvas').screenshot();
    writeFileSync(join(OUT, `${map}-${meta.nebula}.png`), full);

    await page.evaluate((shot) => window.__skyRig.show(shot), {
      map,
      ...VIEW,
      offX: 0,
      offY: 0,
      starless: true,
    });
    const sky = await page.locator('canvas').screenshot();
    writeFileSync(join(OUT, `${map}-${meta.nebula}-skyonly.png`), sky);

    const rings = scanRings(PNG.sync.read(sky));
    report.maps[map] = {
      ...meta,
      file: `${map}-${meta.nebula}.png`,
      skyOnly: `${map}-${meta.nebula}-skyonly.png`,
      ...rings,
    };
    console.log(
      `${map.padEnd(10)} ${meta.nebula.padEnd(12)} sky peak Y′ ${rings.peakLuma.toFixed(2).padStart(6)}` +
        `  ring edges ${String(rings.bandEdges).padStart(3)}` +
        `  max jump ${rings.maxAdjacentJump.toFixed(2).padStart(5)}` +
        `  radii [${rings.edgeRadii.join(' ')}]`,
    );
  }
  writeFileSync(join(HERE, `rings-${LABEL}.json`), `${JSON.stringify(report, null, 2)}\n`);

  await browser.close();
  server.kill('SIGTERM');
  process.exit(0);
}

void main();
