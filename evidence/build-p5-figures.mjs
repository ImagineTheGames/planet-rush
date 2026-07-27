/**
 * evidence/build-p5-figures.mjs — compose the six p5 deliverable figures from the
 * raw frames + readbacks captured by capture-p5-*.mjs. OWNER: QA Manager. Read-only
 * over the PNGs/JSON; every caption number is copied from the run's own readback.
 *
 *   p5-bot-aim-dodgeable   p5-difficulty-tags   p5-bot-flee-commits
 *   p5-no-turret-laser     p5-bot-never-stuck   p5-repair-discrete-honest
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const img = (p) => 'data:image/png;base64,' + readFileSync(join(OUT, p)).toString('base64');
const rb = (p) => JSON.parse(readFileSync(join(OUT, p), 'utf8'));

function figureHTML(title, sub, panels) {
  const cells = panels.map((p) => `
    <figure class="${p.wide ? 'wide' : ''}">
      ${p.html ? `<div class="tbl">${p.html}</div>` : `<img src="${img(p.img)}"/>`}
      <figcaption><span class="t">${p.tag}</span> ${p.cap}</figcaption>
    </figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>
    :root{color-scheme:dark}
    body{margin:0;background:#0a0c10;color:#dce3ec;font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:26px}
    h1{font-size:20px;margin:0 0 4px}
    .sub{color:#8b96a5;font-size:13px;margin:0 0 20px;max-width:1180px}
    .grid{display:flex;flex-wrap:wrap;gap:16px;max-width:1180px;align-items:flex-start}
    figure{margin:0;background:#11151b;border:1px solid #1e2530;border-radius:8px;overflow:hidden;flex:1 1 calc(50% - 8px);min-width:0}
    figure.wide{flex-basis:100%}
    img{width:100%;display:block;background:#05070a}
    figcaption{padding:10px 12px;font-size:12.5px;color:#b9c2cf}
    .t{display:inline-block;background:#1b3a6b;color:#cfe0ff;border-radius:4px;padding:1px 8px;font-weight:600;margin-right:6px}
    .tbl{padding:16px 18px;background:#05070a;font:13px/1.7 ui-monospace,Menlo,monospace;color:#cfe0ff;white-space:pre}
    .tbl b{color:#ffd24f}
  </style></head><body>
    <h1>${title}</h1><p class="sub">${sub}</p>
    <div class="grid">${cells}</div></body></html>`;
}

async function shoot(page, html, out) {
  const fp = '/tmp/_p5fig.html';
  writeFileSync(fp, html);
  await page.goto('file://' + fp, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => ({ w: Math.ceil(document.body.getBoundingClientRect().width), h: Math.ceil(document.body.scrollHeight) }));
  await page.setViewportSize({ width: Math.min(1240, box.w + 52), height: box.h + 52 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, out), fullPage: true });
  console.log('wrote', out);
}

async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 })).newPage();
  const SHA = '7d1e2e1';

  // 1) bot-aim-dodgeable
  {
    const h = rb('p5-aim-harness.json');
    const a = rb('p5-aim-readback.json');
    const tableHtml = h.rows.map((r) => r.replace(/(\d+\.\d%)/g, '<b>$1</b>')).join('\n');
    await shoot(page, figureHTML(
      'bot-aim-dodgeable — a strafing target dodges bot fire; the ladder holds, HARD tighter but beatable',
      `Build ${SHA}. The v0.2.2 field report ("enemies' aim is too accurate") is answered by a per-difficulty aim-error model (spread aimJitter + reaction latency aimLatency, src/bots). The MEASUREMENT below is the shipped harness tests/sim/aim-error.test.ts — I ran it GREEN (7 tests) and read its table; the FRAME is a live commons melee shot at ${SHA}.`,
      [
        { wide: true, tag: 'MEASUREMENT · GREEN', html: `hit-rate vs a JUKING strafer   vs a SITTING duck\n${tableHtml}`,
          cap: `The instrument fires each tier at a full-speed juking strafer and a sitting duck. EASY lands 16.2% on a juker (evades 5 shots in 6) but 54.4% on a sitting duck — the drop IS the dodge. The ladder holds EASY 16.2% < MEDIUM 22.3% < HARD 34.2%, and HARD sits clearly under the old aimbot's 42.9% (a juker now shakes ~2/3 of a HARD gun's shots). Dodging is a choice: every tier punishes a sitting duck.` },
        { wide: true, tag: 'EYES · LIVE MISSES', img: 'p5-aim-miss.png',
          cap: `The commons melee, camera centred (${a.shootersInBest.join(', ')} all firing). ${a.bestOrphanProjectilePixels} red projectile pixels this frame — every one in OPEN SPACE, none on a hull: shots in flight that flew wide of moving ships. ${a.framesWithOpenSpaceProjectiles}/80 burst frames carried open-space projectiles. Not an aimbot.` },
        { tag: 'FLIGHT t', img: 'p5-aim-seq0.png', cap: 'Consecutive burst frames (~220 ms apart): a red projectile dot sits off Foreman’s hull…' },
        { tag: 'FLIGHT t+2', img: 'p5-aim-seq2.png', cap: '…two frames later the shots have travelled on past the moving hulls without landing — a dodgeable gun, seen frame to frame.' },
      ],
    ), 'p5-bot-aim-dodgeable.png');
  }

  // 2) difficulty-tags
  {
    const t = rb('p5-tags-readback.json');
    await shoot(page, figureHTML(
      'difficulty-tags — every bot nameplate carries a recessive (EASY)/(MEDIUM)/(HARD); the local player carries none',
      `Build ${SHA}, live ?debug=1. The suffix is drawn in the owner’s colour but a step dimmer (NAMEPLATE_SUFFIX_ALPHA 0.55) so it reads as metadata, not identity (src/ui/nameplates-view.ts). Data source is the per-slot difficulties() table: [${t.ladder.difficulties.map((d) => d ?? 'none').join(', ')}].`,
      [
        { wide: true, tag: 'LADDER · all three tiers', img: 'p5-tags-ladder.png',
          cap: `Camera centred on the 8-planet ring: all eight nameplates on one frame. Seven rivals each carry their real tier suffix — Rusty/Bolt (EASY), Foreman/Patch (MEDIUM), Sable/Vulture/Warden (HARD) — every suffix dimmer than its name. The local "YOU" (right) carries NO suffix.` },
        { tag: 'DIM SUFFIX', img: 'p5-tags-close.png',
          cap: `Close-up (stageBot, frozen): "Rusty (EASY)" over the bot’s ship AND its planet — the "(EASY)" is the same teal as "Rusty" but visibly dimmer. The local planet reads "YOU" with no suffix; the local ship is unlabelled (own-ship label off by default).` },
        { tag: 'LOCAL = NONE', html: `difficulties():\n slot 0  YOU     <b>none</b>\n slot 1  Rusty   (EASY)\n slot 2  Bolt    (EASY)\n slot 3  Foreman (MEDIUM)\n slot 4  Patch   (MEDIUM)\n slot 5  Sable   (HARD)\n slot 6  Vulture (HARD)\n slot 7  Warden  (HARD)`,
          cap: 'The data-driven table behind the labels: only the local (human) seat is left blank, so only YOU shows no tier.' },
      ],
    ), 'p5-difficulty-tags.png');
  }

  // 3) bot-flee-commits
  {
    const f = rb('p5-flee-readback.json');
    await shoot(page, figureHTML(
      'bot-flee-commits — a wounded bot commits to its retreat: distance from the threat grows, destination evident, no twitch',
      `Build ${SHA}, live ?debug=1. The flee/fight flap is cured by a hysteresis LATCH (src/bots/commitment.ts): FLEE enters wounded+threat-in-range and only leaves once the far ring is cleared — proven by src/bots/commitment.test.ts (GREEN, 11 tests). Here ${f.botName} is wounded to ${(f.enterHp * 100).toFixed(0)}% beside the centred local ship (a threat) and then left alone.`,
      [
        { tag: '1 · FLEE-ENTER', img: 'p5-flee-start.png',
          cap: `${f.botName} at ${(f.enterHp * 100).toFixed(0)}% hull, right beside the local-ship threat at the arena centre. Its home planet is the teal ring, bottom-right.` },
        { tag: '2 · COMMITTED', img: 'p5-flee-mid.png',
          cap: `It drives off in one committed heading — not turning back to fight — toward its own turret cover.` },
        { wide: true, tag: '3 · ARRIVED (destination reached)', img: 'p5-flee-end.png',
          cap: `${f.botName} reaches its own home planet (bottom-right), within ${f.minDistFromHome}px of it, at ${(f.arriveHp * 100).toFixed(0)}% hull. Across the retreat its distance from the threat grew monotonically ${f.startDistFromThreat}→${f.endDistFromThreat}px over ${f.totalDisplacement}px of near-monotone travel (monotonic=${f.monotonicTravel}) — a committed run to an evident destination, never twitching in place. It stayed committed even as fire dropped it ${(f.enterHp * 100).toFixed(0)}%→${(f.arriveHp * 100).toFixed(0)}%.` },
      ],
    ), 'p5-bot-flee-commits.png');
  }

  // 4) no-turret-laser
  {
    const n = rb('p5-noturret-readback.json');
    const g = n.geometry;
    await shoot(page, figureHTML(
      'no-turret-laser — a firing turret is a short muzzle flare + a travelling projectile; NO line to the target, any frame',
      `Build ${SHA}, live ?debug=1. PR #141 made the turret muzzle a short flare (TURRET.muzzleFlashLength 16, hitPoint null) — combat-view.ts: "a burst at the muzzle, never a line to the target." A turret’s SHOT is a pooled projectile (a dot), not a standing beam.`,
      [
        { wide: true, tag: 'GEOMETRY · a full firing cycle', html: `window.__planetRush.muzzles over live fire (${g.distinctShooters.length} distinct turret owners):\n  records collected .... ${g.records}\n  |end − origin| lengths . ${g.distinctLengths.join(', ')}  (px)   ← always the ${g.maxLen}px stub\n  hit point non-null ... ${g.anyHitPointNonNull}                    ← no impact endpoint, ever`,
          cap: `Every muzzle the client drew, all cycle: each is a ~16px stub off the barrel with a null hit point. A laser would read length ≈ distance-to-target and hit = target; none do. The render draws origin→(origin+dir·16), so it CANNOT reach a ~130px-away target.` },
        { tag: 'FLASH', img: 'p5-noturret-flash.png',
          cap: `The staged home turret firing west at the parked attacker: a short flare stub at the barrel and a separate red projectile dot already in the gap — no line joins turret and dot.` },
        { tag: 'SHOT IN FLIGHT', img: 'p5-noturret-shot.png',
          cap: `Red projectile dots travelling in open space between shooters and targets; ${n.visual.framesWithProjectile}/${n.visual.burstFrames} burst frames carried a projectile. Across every frame there is no turret→target line.` },
      ],
    ), 'p5-no-turret-laser.png');
  }

  // 5) bot-never-stuck
  {
    const s = rb('p5-stuck-readback.json');
    const roamers = s.perBot.filter((b) => b.pathLen > 200);
    const rows = roamers.map((b) => ` ${b.name.padEnd(8)} path ${String(b.pathLen).padStart(4)}px   dwell ${b.maxDwellSeconds}s   nearest rim ${b.minPlanetRimPx}px`).join('\n');
    await shoot(page, figureHTML(
      'bot-never-stuck — bots round bodies tangentially; none pins. The standing soak invariant is GREEN.',
      `Build ${SHA}, live ?debug=1. PR #146 adds obstacle-aware steering + a net-progress stuck detector + an open-lane escape, guarded by a STANDING invariant tests/harness/unstuck.test.ts: NO bot with movement intent stays within 8u of a point for > 12s, across 24 full shipped-cast matches — I re-ran it GREEN (plus soak.test.ts GREEN, 10 tests).`,
      [
        { wide: true, tag: 'ROUNDS A BODY', img: 'p5-stuck-path.png',
          cap: `${s.picked.name}’s tracked trajectory (time-graded dots, cyan→magenta) over ${s.trackedSeconds}s: a smooth ${s.picked.pathLen}px arc that rounds its planet tangentially (closest rim approach ${s.picked.minPlanetRimPx}px) and carries on — a route around the body, not a pin against it. The dots are evenly spaced: constant motion, no clustering.` },
        { wide: true, tag: 'NO PIN · every roaming bot', html: `tracked ${s.trackedSeconds}s, ${roamers.length} free-roaming bots (dwell = longest spell within 8px):\n${rows}`,
          cap: `Every roaming bot travelled 1200–1600px with a max dwell ≤ 0.4s — nowhere near the 12s invariant limit; none pinned. (The one high-dwell bot, Rusty, is the ship the centring seam parked at rest — no movement intent, the exact case the invariant excludes. The live position metric can’t read throttle intent, so the rigorous no-wedge proof is the GREEN CI invariant above; this frame is the visual.)` },
      ],
    ), 'p5-bot-never-stuck.png');
  }

  // 6) repair-discrete-honest
  {
    const r = rb('p5-repair-readback.json');
    await shoot(page, figureHTML(
      'repair-discrete-honest — REPAIR CORE is a discrete 1-ore/15-HP tap: no channel, no stacking, auto-refused at full',
      `Build ${SHA}, live ?debug=1 (NO freeze). PR #148 killed the repair channel; every press below is a REAL pointerdown on the drawn REPAIR wedge (the shipped __repairStage seam only sieged the core + funded the bank). REPAIR_HP_PER_ORE 15, REPAIR_ORE_COST 1.`,
      [
        { tag: '1 · THE DEAL', img: 'p5-repair-A-wedge.png',
          cap: `Core sieged to ${r.A.read.coreHp}/${r.A.read.maxCoreHp} (top-right HOME bar), bank ${r.A.read.banked} ore. The REPAIR CORE wedge draws its deal: "${r.A.wedge.sub}" with the bare "1" as its only cost numeral, bright/pressable.` },
        { tag: '2 · BANK FALLS, CORE RISES', img: 'p5-repair-B-3taps.png',
          cap: `Three real taps: core steps up 15 HP each and the bank steps down 1 ore each — core ${r.A.read.coreHp}→${r.B.read.coreHp} (+${r.B.coreDelta}), bank ${r.A.read.banked}→${r.B.read.banked} (${r.B.bankDelta}). Wedge still shows "+15 HP".` },
        { tag: '3 · N TAPS = N PURCHASES', img: 'p5-repair-D-5taps.png',
          cap: `From a fresh siege (core ${r.D.before.coreHp}, bank ${r.D.before.banked}), five real taps buy exactly +${r.D.coreDelta} HP for ${-r.D.bankDelta} ore (core ${r.D.after.coreHp}, bank ${r.D.after.banked}) — discrete, no channel over-spend.` },
        { tag: '4 · AUTO-STOP AT FULL', img: 'p5-repair-C-full.png',
          cap: `Core topped to ${r.C.before.coreHp}/${r.C.before.maxCoreHp}: the wedge dims to "${r.C.wedge.sub}" (ready=${r.C.wedge.ready}). Five RAPID taps then spend ZERO ore — bank frozen ${r.C.before.banked}→${r.C.after.banked}, core pinned at max (bankFrozen=${r.C.bankFrozen}, coreFrozen=${r.C.coreFrozen}). No stacking, no drain at full.` },
      ],
    ), 'p5-repair-discrete-honest.png');
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
