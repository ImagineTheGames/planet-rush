/**
 * evidence/a0-36-name-the-blobs/walk-stage.mjs — a0-36, reconnaissance.
 * OWNER: QA Manager.
 *
 * Before anything can be isolated it has to be NAMED. This boots the served
 * bundle once per arena, at a phone-class viewport, in a real match, and dumps
 * the WHOLE live scene graph — every labelled node, its class, its child count
 * and its bounds — not just the void container a1-07 walked.
 *
 * The stage is reached through Pixi's own devtools hook (`__PIXI_APP_INIT__`),
 * exactly as a1-07 did it, because this is a READ-ONLY round: nothing in `src/`
 * may gain a seam. See a1-07/shoot-skies.mjs for the provenance of that hook.
 *
 *   node evidence/a0-36-name-the-blobs/walk-stage.mjs [port]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'frames');
const PORT = process.argv[2] ?? '4336';
const BASE = `http://127.0.0.1:${PORT}`;

/** Phone-class, as the developer plays. 390×844 is the a0-33 phone. */
const VP = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };

const MAPS = ['octagon', 'compass', 'oval', 'diamond', 'line', 'crescents'];

const settle = (page, n = 30) =>
  page.evaluate(
    (frames) =>
      new Promise((done) => {
        let i = 0;
        const tick = () => (++i < frames ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

function initScript(mapId) {
  return `
    try { localStorage.setItem('planet-rush:mapId', ${JSON.stringify(mapId)}); } catch (e) {}
    globalThis.__PIXI_APP_INIT__ = function (app) { globalThis.__qaApp = app; };
  `;
}

/** Walk the ENTIRE stage. Every node, labelled or not, to a sane depth. */
const WALK = () => {
  const app = globalThis.__qaApp;
  if (!app || !app.stage) return { error: 'no __qaApp — the Pixi devtools hook did not fire' };
  const out = [];
  const walk = (node, depth, path) => {
    if (depth > 8) return;
    const kids = node.children || [];
    let b = null;
    try {
      const r = node.getBounds();
      b = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (e) {
      /* no geometry, no bounds — recorded as null rather than guessed */
    }
    out.push({
      depth,
      path,
      label: node.label ?? null,
      type: node.constructor?.name ?? '?',
      visible: node.visible,
      alpha: node.alpha,
      blend: node.blendMode ?? null,
      kids: kids.length,
      bounds: b,
      pos: { x: Math.round(node.position?.x ?? 0), y: Math.round(node.position?.y ?? 0) },
    });
    // Do not descend into the huge homogeneous pools (hundreds of rock sprites);
    // record the parent's child count instead, which is the number that matters.
    if (kids.length > 40) return;
    for (const c of kids) walk(c, depth + 1, `${path}/${c.label || c.constructor?.name || '?'}`);
  };
  walk(app.stage, 0, 'stage');
  return { nodes: out, renderer: { w: app.renderer?.width, h: app.renderer?.height } };
};

async function shoot(browser, mapId) {
  const ctx = await browser.newContext(VP);
  await ctx.addInitScript(initScript(mapId));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?debug=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__qaApp?.stage?.children?.length > 0, null, { timeout: 30000 });
  await settle(page, 90); // let a real match get going: bots move, VFX fire
  const graph = await page.evaluate(WALK);
  const version = await page.evaluate(() => globalThis.__debug?.build ?? null);
  await page.screenshot({ path: join(OUT, `recon-${mapId}.png`) });
  await ctx.close();
  return { mapId, version, ...graph };
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
const all = [];
for (const m of MAPS) {
  const r = await shoot(browser, m);
  all.push(r);
  console.log(`\n=== ${m} === (${r.error ?? `${r.nodes.length} nodes`})`);
  for (const n of r.nodes ?? []) {
    if (n.depth > 4) continue;
    console.log(
      `${'  '.repeat(n.depth)}${n.label ?? `(${n.type})`} [${n.type}] kids=${n.kids}` +
        `${n.visible ? '' : ' HIDDEN'}${n.blend && n.blend !== 'normal' ? ` blend=${n.blend}` : ''}` +
        `${n.bounds ? ` b=${n.bounds.w}x${n.bounds.h}@${n.bounds.x},${n.bounds.y}` : ''}`,
    );
  }
}
await browser.close();
writeFileSync(join(HERE, 'stage-graph.json'), JSON.stringify(all, null, 2));
console.log(`\nwrote stage-graph.json and ${MAPS.length} recon frames`);
