/**
 * evidence/capture-turret-leads.mjs — evidence for the claim `turret-leads-shots`:
 * a defensive turret LEADS a moving attacker, firing AHEAD of where the target IS
 * (an intercept on the target's arc), so its shots go where the target WILL be.
 * OWNER: capture tooling for the QA Manager (who writes the attestation).
 *
 * ── HOW THE SCENE IS STAGED (honest scope) ─────────────────────────────────
 * There is no live-stage seam that injects an arbitrary turret + a scripted
 * moving probe, and offline bots rarely fly into a home turret's 240u range
 * naturally. So the moving attacker we CAN read exactly is the LOCAL ship, and
 * the turret we make fire at it is an ENEMY one:
 *
 *   1. Boot /?debug=1 LIVE (no ?freeze — the turret must actually step & fire).
 *   2. Wait until a bot has BUILT a turret (~tick 900), then `__nameplateStage
 *      .stageBot()` — the ratified seam that parks that bot's HOME PLANET (turrets
 *      and all) ~185u down-right of the centred local ship. It moves the bot &
 *      planet, NOT the local ship, so the local ship's world pos/vel stay clean.
 *   3. Hold `KeyW` — the local ship flies straight UP at full speed: a
 *      constant-velocity crosser across the enemy turret's face (the exact
 *      clean-lead case tests/sim/turret-aim.test.ts pins). Re-`stageBot()` every
 *      ~0.35s so the enemy planet stays inside the turret's 240u range as we drift.
 *   4. Poll `window.__planetRush.muzzles` (combat-debug.ts: one record per FIRING
 *      turret this tick — shooter, barrel `origin`, `end` = origin+dir·len). The
 *      enemy turret firing AT US is the muzzle whose endpoint sits near our ship.
 *
 * ── WHAT IS MEASURED (the proof) ───────────────────────────────────────────
 * The muzzle `dir` is the turret's real firing bearing — `turretAimBearing`,
 * which is the shared intercept solve (`leadAim`) PLUS the tier's seeded angular
 * deviance (`aimSpread`) (src/sim/buildings.ts). `hitPoint` is null in the
 * projectile era, so a shot's hit/miss is NOT in the muzzle — that lives in the
 * per-tier hit-rate table below. Per firing frame we record, in WORLD units:
 *   - turret pos (muzzle origin), our ship pos (shipWorld) + velocity (shipWorld
 *     differenced over ticks), and the fired bearing (muzzle dir);
 *   - LEAD ANGLE = signed angle between turret→ship-now and turret→aim, signed
 *     POSITIVE when the aim is rotated toward our motion (i.e. the turret aimed
 *     where we are GOING). A turret shooting where we WERE would sit at ~0°/behind.
 * The MEAN lead over many shots is the intercept; the per-shot scatter (some even
 * negative) is the seeded deviance that lets a mover dodge — shown honestly.
 *
 * ── HIT-RATE TABLE (quoted, not measured here) ─────────────────────────────
 * From `npx vitest run tests/sim/turret-aim.test.ts` (a full-speed planet-orbiter,
 * pooled radii 245/285/315u):
 *   Mk I   orbiting 40.4% (57/141) | stationary 100.0% (31/31)
 *   Mk II  orbiting 68.6% (107/156)| stationary 100.0% (35/35)
 *   Mk III orbiting 79.9% (139/174)| stationary 100.0% (39/39)
 * A stationary target is hit ~always; a mover slips a real share of shots (the
 * deviance). That table is the honest hit/miss deliverable for the caption.
 *
 * ── OUTPUT ─────────────────────────────────────────────────────────────────
 *   evidence/images/turret-leads-frameNN.png  — annotated live frames: turret
 *       (magenta), our ship at centre, velocity arrow (cyan), turret→ship-now
 *       ray (dashed grey = where we ARE), turret→aim ray (solid yellow = where it
 *       FIRED, leading). The angle between the rays is the lead.
 *   evidence/images/turret-leads-strip.png     — captioned strip of those frames.
 *   evidence/images/turret-leads-raw-NN.png    — the un-annotated frames.
 *   /tmp/turret-leads-readback.json            — per-frame world geometry + lead
 *       angles + summary stats + the hit-rate table.
 *
 * Reproduce:
 *   export LD_LIBRARY_PATH=/tmp/pwlibs/root/usr/lib/x86_64-linux-gnu:/tmp/pwlibs/root/lib/x86_64-linux-gnu
 *   export EVIDENCE_BASE_URL=http://localhost:4191
 *   node evidence/capture-turret-leads.mjs [flightSeconds]
 */
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const FLIGHT_S = Number(process.argv[2] ?? 40);

const HITRATE = {
  source: 'tests/sim/turret-aim.test.ts (npx vitest run)',
  scenario: 'a full-speed Interceptor orbiting a defended planet, pooled radii 245/285/315u',
  tiers: [
    { tier: 'Mk I', orbiting: '40.4%', orbitHits: '57/141', stationary: '100.0%', statHits: '31/31' },
    { tier: 'Mk II', orbiting: '68.6%', orbitHits: '107/156', stationary: '100.0%', statHits: '35/35' },
    { tier: 'Mk III', orbiting: '79.9%', orbitHits: '139/174', stationary: '100.0%', statHits: '39/39' },
  ],
};

const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const dot = (ax, ay, bx, by) => ax * bx + ay * by;

// ── pngjs drawing helpers ──────────────────────────────────────────────────
function px(img, x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}
function thick(img, x, y, r, g, b, w = 1) {
  for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) px(img, x + dx, y + dy, r, g, b);
}
function line(img, x0, y0, x1, y1, r, g, b, w = 1, dash = 0) {
  const dx = x1 - x0, dy = y1 - y0; const n = Math.ceil(Math.hypot(dx, dy));
  for (let i = 0; i <= n; i++) {
    if (dash && Math.floor(i / dash) % 2 === 1) continue;
    thick(img, x0 + (dx * i) / n, y0 + (dy * i) / n, r, g, b, w);
  }
}
function ring(img, cx, cy, rad, r, g, b, w = 1) {
  for (let a = 0; a < 360; a += 1) line(img, cx + rad * Math.cos(a * Math.PI / 180), cy + rad * Math.sin(a * Math.PI / 180), cx + rad * Math.cos((a + 1) * Math.PI / 180), cy + rad * Math.sin((a + 1) * Math.PI / 180), r, g, b, w);
}
function box(img, cx, cy, s, r, g, b, w = 1) {
  line(img, cx - s, cy - s, cx + s, cy - s, r, g, b, w); line(img, cx - s, cy + s, cx + s, cy + s, r, g, b, w);
  line(img, cx - s, cy - s, cx - s, cy + s, r, g, b, w); line(img, cx + s, cy - s, cx + s, cy + s, r, g, b, w);
}
function arrow(img, x0, y0, x1, y1, r, g, b, w = 1) {
  line(img, x0, y0, x1, y1, r, g, b, w);
  const ang = Math.atan2(y1 - y0, x1 - x0); const h = 12;
  line(img, x1, y1, x1 - h * Math.cos(ang - 0.4), y1 - h * Math.sin(ang - 0.4), r, g, b, w);
  line(img, x1, y1, x1 - h * Math.cos(ang + 0.4), y1 - h * Math.sin(ang + 0.4), r, g, b, w);
}
function crop(png, x0, y0, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y, di = (y * w + x) * 4;
    if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) { o.data[di + 3] = 255; continue; }
    const si = (sy * png.width + sx) * 4;
    o.data[di] = png.data[si]; o.data[di + 1] = png.data[si + 1]; o.data[di + 2] = png.data[si + 2]; o.data[di + 3] = 255;
  }
  return o;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + '/?debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__planetRush?.viewport?.width > 0, undefined, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__nameplateStage?.stageBot === 'function', undefined, { timeout: 20000 });
  const build = await page.evaluate(() => window.__planetRush?.build ?? null);
  console.log('build', JSON.stringify(build));

  await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 900, undefined, { timeout: 90000 });
  await page.mouse.click(640, 400); // trusted gesture (focus)
  const staged = await page.evaluate(() => window.__nameplateStage.stageBot());
  console.log('stageBot', JSON.stringify(staged));

  const shots = [];      // every enemy-turret firing frame aimed at us
  const caps = [];       // screenshots + geometry for annotation
  let prev = null, lastStage = Date.now();
  const t0 = Date.now();
  // The local ship flies straight UP at full speed — a clean CONSTANT-VELOCITY
  // crosser across the enemy turret's face (the case turret-aim.test.ts pins,
  // where the lead is isolated from juke/stale-velocity noise). stageBot re-parks
  // the enemy planet ~185u down-right every 0.35s so it stays in the 240u range;
  // over a long flight we also drift near OTHER real planets, whose turrets fire
  // and lead us too — the same effect, un-staged.
  await page.keyboard.down('KeyW');
  while ((Date.now() - t0) / 1000 < FLIGHT_S) {
    if (Date.now() - lastStage > 350) { await page.evaluate(() => window.__nameplateStage.stageBot()); lastStage = Date.now(); }
    const snap = await page.evaluate(() => {
      const pr = window.__planetRush;
      return {
        tick: pr.ticks,
        ss: { x: pr.shipScreen.x, y: pr.shipScreen.y },
        sw: { x: pr.shipWorld.x, y: pr.shipWorld.y },
        mz: (pr.muzzles ?? []).map((m) => ({ shooter: m.shooter, ox: m.origin.x, oy: m.origin.y, ex: m.end.x, ey: m.end.y })),
      };
    });
    if (prev && snap.tick > prev.tick + 1) {
      const mvx = snap.sw.x - prev.sw.x, mvy = snap.sw.y - prev.sw.y;
      const [mdx, mdy] = norm(mvx, mvy);
      const speed = Math.hypot(mvx, mvy) / (snap.tick - prev.tick) * 60; // world u/s
      for (const m of snap.mz) {
        if (m.shooter === 0) continue;
        const dist = Math.hypot(snap.sw.x - m.ox, snap.sw.y - m.oy);
        const endGap = Math.hypot(m.ex - snap.sw.x, m.ey - snap.sw.y);
        if (dist > 260 || endGap > 260) continue; // the turret firing AT us
        const [tdx, tdy] = norm(snap.sw.x - m.ox, snap.sw.y - m.oy); // turret->ship-now
        const [adx, ady] = norm(m.ex - m.ox, m.ey - m.oy);           // turret->aim (fired bearing)
        const leadCross = cross(tdx, tdy, adx, ady);
        const motionCross = cross(tdx, tdy, mdx, mdy);
        const agrees = Math.sign(leadCross) === Math.sign(motionCross);
        const leadMag = Math.atan2(Math.abs(leadCross), dot(tdx, tdy, adx, ady)) * 180 / Math.PI;
        const rec = {
          tick: snap.tick, shooter: m.shooter,
          turretWorld: { x: +m.ox.toFixed(1), y: +m.oy.toFixed(1) },
          shipWorld: { x: +snap.sw.x.toFixed(1), y: +snap.sw.y.toFixed(1) },
          shipVel: { x: +mdx.toFixed(3), y: +mdy.toFixed(3) }, speed: +speed.toFixed(0),
          aimDir: { x: +adx.toFixed(3), y: +ady.toFixed(3) },
          leadAngleDeg: +(agrees ? leadMag : -leadMag).toFixed(2),
          leadsMotion: agrees, distToTurret: +dist.toFixed(0),
        };
        shots.push(rec);
        // Grab a screenshot for good, well-separated candidates (strong lead + moving).
        if (speed > 150 && dist > 95 && dist < 245 && caps.length < 18 && (Date.now() - (caps.at(-1)?.t ?? 0) > 450)) {
          const png = await page.screenshot();
          const after = await page.evaluate(() => ({ x: window.__planetRush.shipWorld.x, y: window.__planetRush.shipWorld.y }));
          caps.push({ t: Date.now(), png, rec, ssAtCap: snap.ss, swAtCap: snap.sw, swAfter: after });
        }
      }
    }
    prev = snap;
    await page.waitForTimeout(28);
  }
  await page.keyboard.up('KeyW').catch(() => {}); await page.keyboard.up('KeyS').catch(() => {});
  await browser.close();

  // ── stats ─────────────────────────────────────────────────────────────────
  const moving = shots.filter((s) => s.speed > 60);
  const signed = moving.map((s) => s.leadAngleDeg);
  const mean = signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : 0;
  const agreeN = moving.filter((s) => s.leadsMotion).length;
  const stats = {
    firingFramesAtUs: shots.length, movingFrames: moving.length,
    meanSignedLeadDeg: +mean.toFixed(2),
    fractionAimedAheadOfMotion: +(agreeN / (moving.length || 1)).toFixed(2),
    maxLeadDeg: +Math.max(...signed, 0).toFixed(2), minLeadDeg: +Math.min(...signed, 0).toFixed(2),
    note: 'positive lead = the turret aimed AHEAD of where the ship IS, in the direction it is moving (an intercept). Negative shots are the tier aimSpread deviance.',
  };
  console.log('STATS', JSON.stringify(stats));
  console.log('signed leads:', signed.map((x) => x.toFixed(1)).join(', '));

  // ── annotate the captured frames ────────────────────────────────────────────
  // Pick up to 3 strong-lead frames + 1 deviance (smallest / negative lead).
  const strong = caps.filter((c) => c.rec.leadsMotion).sort((a, b) => Math.abs(b.rec.leadAngleDeg) - Math.abs(a.rec.leadAngleDeg));
  const deviance = caps.slice().sort((a, b) => a.rec.leadAngleDeg - b.rec.leadAngleDeg)[0];
  const chosen = [];
  for (const c of strong) { if (chosen.length < 3 && !chosen.includes(c)) chosen.push(c); }
  if (deviance && !chosen.includes(deviance)) chosen.push(deviance);

  const CW = 620, CH = 500;
  const frameFiles = [];
  chosen.forEach((c, i) => {
    const full = PNG.sync.read(c.png);
    writeFileSync(join(OUT, `turret-leads-raw-${i + 1}.png`), c.png);
    // project world -> screen with shipScreen anchor, shipWorld at the rendered
    // frame estimated as the midpoint of the reads bracketing the screenshot.
    const swMid = { x: (c.swAtCap.x + c.swAfter.x) / 2, y: (c.swAtCap.y + c.swAfter.y) / 2 };
    const toScreen = (w) => ({ x: c.ssAtCap.x + (w.x - swMid.x), y: c.ssAtCap.y + (w.y - swMid.y) });
    const shipS = c.ssAtCap;                                   // ship = camera centre
    const turS = toScreen(c.rec.turretWorld);
    const rayLen = Math.hypot(turS.x - shipS.x, turS.y - shipS.y);
    const aimEnd = { x: turS.x + c.rec.aimDir.x * rayLen, y: turS.y + c.rec.aimDir.y * rayLen };
    const velEnd = { x: shipS.x + c.rec.shipVel.x * 70, y: shipS.y + c.rec.shipVel.y * 70 };
    // crop centred on the ship↔turret midpoint
    const mx = (shipS.x + turS.x) / 2, my = (shipS.y + turS.y) / 2;
    const x0 = Math.round(mx - CW / 2), y0 = Math.round(my - CH / 2);
    const img = crop(full, x0, y0, CW, CH);
    const S = (p) => ({ x: p.x - x0, y: p.y - y0 });
    const t = S(turS), s = S(shipS), a = S(aimEnd), v = S(velEnd);
    // turret->ship-now (where the ship IS): dashed grey
    line(img, t.x, t.y, s.x, s.y, 150, 150, 160, 1, 5);
    // turret->aim (where it FIRED — leads): solid yellow
    line(img, t.x, t.y, a.x, a.y, 250, 220, 40, 2);
    // ship velocity: cyan arrow
    arrow(img, s.x, s.y, v.x, v.y, 40, 220, 235, 2);
    // markers
    ring(img, t.x, t.y, 12, 250, 80, 250, 2); box(img, t.x, t.y, 3, 250, 80, 250, 1); // turret magenta
    box(img, s.x, s.y, 9, 240, 240, 240, 2);                                          // ship white
    const f = `turret-leads-frame${i + 1}.png`;
    writeFileSync(join(OUT, f), PNG.sync.write(img));
    frameFiles.push({ file: f, rec: c.rec });
    console.log('frame', f, 'lead', c.rec.leadAngleDeg, 'deg speed', c.rec.speed, 'dist', c.rec.distToTurret);
  });

  // ── captioned strip via an HTML figure (build-p5-figures pattern) ────────────
  if (frameFiles.length) {
    const b64 = (f) => readFileSync(join(OUT, f)).toString('base64');
    const panels = frameFiles.map(({ file, rec }) => {
      const dirWord = rec.leadsMotion ? 'AHEAD of the ship (leads)' : 'off-axis (aim-spread deviance)';
      return `<div class=p><img src="data:image/png;base64,${b64(file)}"><div class=c>
        <b>${rec.leadAngleDeg}&deg;</b> ${dirWord}<br>ship ${rec.speed} u/s, turret ${rec.distToTurret}u away<br>
        <span class=k1>yellow</span>=fired bearing &nbsp;<span class=k2>grey</span>=where ship IS &nbsp;<span class=k3>cyan</span>=ship velocity</div></div>`;
    }).join('');
    const html = `<!doctype html><meta charset=utf8><body style="margin:0;background:#0a0d12;font-family:system-ui">
      <div style="color:#cfe0ff;padding:12px 16px;font-size:15px">
        <b>turret-leads-shots</b> — an ENEMY turret firing at the local ship crossing its face at full speed (build ${build?.sha}, live ?debug=1).
        Mean lead over ${stats.movingFrames} firing frames: <b>+${stats.meanSignedLeadDeg}&deg;</b> ahead of motion; ${Math.round(stats.fractionAimedAheadOfMotion * 100)}% of shots aimed ahead.
        Hit-rate (tests/sim/turret-aim.test.ts): Mk I 40.4% / Mk II 68.6% / Mk III 79.9% vs a full-speed orbiter — a mover slips a real share (the deviance).
      </div>
      <div style="display:flex;gap:8px;padding:0 12px 14px;flex-wrap:wrap">${panels}</div>
      <style>.p{background:#11151b;border-radius:6px;padding:6px;width:${CW}px}.p img{display:block;width:${CW}px;border-radius:4px}
      .c{color:#c8d2df;font-size:12px;line-height:1.5;padding:6px 4px}.c b{color:#ffe14d}
      .k1{color:#fadc28}.k2{color:#9aa}.k3{color:#28dceb}</style></body>`;
    const b2 = await chromium.launch(); // fresh browser to shoot the HTML figure (game browser is closed)
    const pg = await (await b2.newContext({ viewport: { width: 2 * CW + 80, height: 1400 }, deviceScaleFactor: 1 })).newPage();
    await pg.setContent(html, { waitUntil: 'load' });
    await pg.waitForTimeout(200);
    const el = await pg.$('body');
    await el.screenshot({ path: join(OUT, 'turret-leads-strip.png') });
    await b2.close();
    console.log('wrote turret-leads-strip.png');
  }

  writeFileSync('/tmp/turret-leads-readback.json', JSON.stringify({
    build, staged, stats, hitRateTable: HITRATE,
    chosenFrames: frameFiles.map((f) => f.rec), allFiringFrames: shots, errors: errs.slice(0, 5),
  }, null, 2));
  console.log('wrote /tmp/turret-leads-readback.json; errors:', errs.slice(0, 3));
}
main().catch((e) => { console.error(e); process.exit(1); });
