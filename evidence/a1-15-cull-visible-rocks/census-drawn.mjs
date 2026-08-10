/**
 * evidence/a1-15-cull-visible-rocks/census-drawn.mjs — a1-15, the instrument.
 * OWNER: QA Manager.
 *
 * The developer, from live play after the renderer night: *"the bloom orbs are
 * gone, but they are gone completely"*. a0-18 proved the star bloom is intact on
 * the running build and cleared all three of its suspects. a1-07 had separately
 * measured the large soft grey discs the developer originally pointed at and
 * found they are **rocks** (16.8–74.2 CSS px, median 62.7, opaque, neutral grey).
 * So this round asks the one question those two leave open: **did a1-12's
 * viewport cull remove a rock the player could actually see?**
 *
 * ── WHAT IS COUNTED, AND WHY IT DOES NOT TRUST THE CODE ────────────────────
 * `RENDER_EXTENT.rock = 1` is a CLAIM in `src/render/cull.ts` — that an
 * asteroid's art reaches exactly its collision radius. An attestation that rests
 * on that claim proves nothing about the frame. So the ground truth here is not
 * the extent table and not the sim: it is **`getBounds()` on the live display
 * object** — the rectangle PixiJS itself will rasterise, geometry and transform
 * included. The pre-cull build (`111db86`, before pooling and before the cull)
 * draws every rock unconditionally, so its scene graph carries a correct,
 * complete, per-rock drawn rectangle for the whole field. That is the reference.
 *
 *   VISIBLE_TRUE = { rocks whose live drawn rect intersects the visible viewport }
 *                  measured on the PRE-CULL build
 *   DRAWN        = { rocks the SERVED build actually left visible }
 *   MISSING      = VISIBLE_TRUE \ DRAWN   ← non-empty ⇒ the cull ate something
 *   OVERDRAW     = DRAWN \ VISIBLE_TRUE   ← harmless; the pad erring outward
 *
 * Rocks are matched between the two builds **by world position**, never by child
 * index: the pooled build creates a display object only for a slot it has drawn
 * at least once, so `layer.children[k]` is not slot `k` there. Position is exact
 * and identical across the pair — `src/sim/` and `src/platform/freeze.ts` are
 * byte-identical between `111db86` and `ebdae99` (checked with `git diff`), and
 * `?freeze=1` pins the world at `FREEZE_TICK`. `window.__planetRush.worldHash` is
 * recorded on both sides so "same world" is asserted, not assumed.
 *
 * ── PUSHING ON THE BOUNDARY ────────────────────────────────────────────────
 * A cull fails at the edge, so a single viewport would be a weak test. This
 * sweeps a range of widths and heights at the same frozen tick: every size slides
 * the four edges across a different subset of the field and manufactures fresh
 * straddle cases for free. Each rock is classified per profile as INSIDE (rect
 * wholly within the viewport), STRADDLE (rect crosses an edge — the case the cull
 * is most likely to get wrong) or OUTSIDE, and the straddlers are counted and
 * checked separately, because a cull that keeps every fully-inside rock and drops
 * the straddlers is exactly the bug this looks for.
 *
 * The ore chunks (`chunks` layer) get the identical treatment in the same pass.
 *
 * Nothing in `src/` is touched: the stage is reached through PixiJS's own
 * devtools hook (`globalThis.__PIXI_APP_INIT__`, called by pixi.js 8.6.6 with the
 * live `Application`), installed from a Playwright init script before any page
 * script runs. So the same file measures the served bundle of any commit.
 *
 *   node evidence/a1-15-cull-visible-rocks/census-drawn.mjs <distDir> <label>
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(process.argv[2] ?? resolve(HERE, '..', '..', 'dist'));
const LABEL = process.argv[3] ?? 'served';

/**
 * The profiles. The three named ones are the briefs' own: a1-13/a1-12's desktop
 * 1280x800, a0-18/a1-07's 1440x900 (so this round's rock counts sit beside the
 * bloom round's), and the 844x390 landscape phone — the profile a1-12 measured
 * its most aggressive cut on (200 rocks -> 6). The rest are the boundary sweep:
 * sizes chosen only to walk the viewport edges across the field in small steps.
 */
const PROFILES = [
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'phone-landscape-844x390', width: 844, height: 390 },
  // Boundary sweep — each step slides the edges onto different rocks.
  ...[380, 420, 460, 500, 540, 580, 620, 660, 700, 740, 780, 820, 860, 900, 940, 980, 1020, 1100, 1180, 1260, 1340].map(
    (w) => ({ name: `sweep-${w}x390`, width: w, height: 390, sweep: true }),
  ),
  ...[300, 340, 380, 420, 460, 500, 560, 620, 680, 740, 800].map((h) => ({
    name: `sweep-844x${h}`,
    width: 844,
    height: h,
    sweep: true,
  })),
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

/**
 * A static server over one `dist`, on an EPHEMERAL port. Ephemeral deliberately:
 * a1-12 lost a whole bench run to a stale vite holding a fixed `--strictPort`,
 * whose page answered and whose numbers were reported as the new build's. A port
 * the OS hands out cannot collide with a survivor, so the pair of builds in this
 * round cannot be confused for one another.
 */
function serve(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = join(root, decodeURIComponent(url.pathname));
    if (!path.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
    if (!existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

/** Capture the live Application before any page script runs. */
const INIT = `
  globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
`;

/** Settle by counting frames, not by timing them (the a0-07b lesson). */
const settle = (page, n = 12) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

/**
 * The read-back. For the `asteroids` and `chunks` layers: every child, its world
 * position (`x`/`y` — the renderer writes the entity's own world coords there),
 * whether it is visible, and its LIVE global bounds — the rectangle PixiJS will
 * rasterise, in canvas CSS px.
 *
 * `getBounds()` is taken on the node itself, so it is the art's real silhouette
 * and not `RENDER_EXTENT`'s claim about it. Pixi 8 returns a `Bounds` with
 * minX/minY/maxX/maxY; the `x/y/width/height` shape is accepted too so this file
 * is not hostage to a point release.
 */
const READ = `
  (() => {
    const app = globalThis.__qaApp;
    if (!app || !app.stage) return { error: 'no pixi app on the stage' };

    const findLayer = (label) => {
      let found = null;
      const walk = (node, depth) => {
        if (found || depth > 24) return;
        for (const c of node.children || []) {
          if (c.label === label) { found = c; return; }
          walk(c, depth + 1);
        }
      };
      walk(app.stage, 0);
      return found;
    };

    const rect = (node) => {
      const b = node.getBounds();
      const minX = b.minX !== undefined ? b.minX : b.x;
      const minY = b.minY !== undefined ? b.minY : b.y;
      const maxX = b.maxX !== undefined ? b.maxX : b.x + b.width;
      const maxY = b.maxY !== undefined ? b.maxY : b.y + b.height;
      return { minX, minY, maxX, maxY };
    };

    const census = (label) => {
      const layer = findLayer(label);
      if (!layer) return { error: 'no layer ' + label };
      const items = layer.children.map((c) => {
        const r = rect(c);
        return {
          x: Math.round(c.x * 1e3) / 1e3,
          y: Math.round(c.y * 1e3) / 1e3,
          visible: c.visible === true,
          renderable: c.renderable !== false,
          alpha: c.alpha,
          minX: Math.round(r.minX * 1e3) / 1e3,
          minY: Math.round(r.minY * 1e3) / 1e3,
          maxX: Math.round(r.maxX * 1e3) / 1e3,
          maxY: Math.round(r.maxY * 1e3) / 1e3,
        };
      });
      return { children: items.length, items };
    };

    const pr = window.__planetRush || {};
    return {
      worldHash: pr.worldHash === undefined ? null : pr.worldHash,
      seam: pr.viewport ? { ...pr.viewport } : null,
      screen: { width: app.renderer.screen.width, height: app.renderer.screen.height },
      resolution: app.renderer.resolution,
      asteroids: census('asteroids'),
      chunks: census('chunks'),
    };
  })()
`;

/** Does a drawn rect touch the visible viewport rect? Inclusive, as the cull is. */
const touches = (r, vp) =>
  r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;

/** Is the drawn rect wholly inside the visible viewport? */
const inside = (r, vp) =>
  r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;

const key = (it) => `${it.x.toFixed(2)},${it.y.toFixed(2)}`;

async function run() {
  const { server, port } = await serve(DIST);
  const version = JSON.parse(readFileSync(join(DIST, 'version.json'), 'utf8'));
  const browser = await chromium.launch();
  const out = { label: LABEL, dist: DIST, buildSha: version.sha, builtAt: version.time, profiles: {} };

  for (const profile of PROFILES) {
    const ctx = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: 1,
    });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/?debug=1&freeze=1`, { waitUntil: 'load' });
    await page.waitForFunction('!!globalThis.__qaApp', null, { timeout: 30000 });
    await settle(page, 15);

    const read = await page.evaluate(READ);
    read.profile = profile.name;
    read.viewport = { width: profile.width, height: profile.height };
    read.pageErrors = errors;
    // The visible rectangle the cull is judged against. On desktop the canvas IS
    // the visible area (camera.ts: origin 0,0), and the seam is recorded so that
    // assumption is visible in the data rather than buried here.
    read.visibleRect = { left: 0, top: 0, right: read.screen.width, bottom: read.screen.height };
    out.profiles[profile.name] = read;
    await ctx.close();
  }

  await browser.close();
  server.close();

  mkdirSync(HERE, { recursive: true });
  const file = join(HERE, `census-${LABEL}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));

  // A short console summary so a run is legible without opening the JSON.
  for (const [name, p] of Object.entries(out.profiles)) {
    const vp = p.visibleRect;
    for (const layer of ['asteroids', 'chunks']) {
      const c = p[layer];
      if (c.error) {
        console.log(`${name} ${layer}: ${c.error}`);
        continue;
      }
      const drawn = c.items.filter((i) => i.visible && i.renderable && i.alpha > 0);
      const onScreen = c.items.filter((i) => touches(i, vp));
      const straddle = onScreen.filter((i) => !inside(i, vp));
      console.log(
        `${name.padEnd(24)} ${layer.padEnd(9)} children=${String(c.children).padStart(3)} drawn=${String(drawn.length).padStart(3)} rectsTouchingViewport=${String(onScreen.length).padStart(3)} straddling=${String(straddle.length).padStart(2)}`,
      );
    }
  }
  console.log(`\nbuild ${out.buildSha} → ${file}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
