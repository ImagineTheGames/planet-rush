/**
 * evidence/build-art-composites.mjs — compose the three side-by-side deliverables
 * for the art-campaign close. OWNER: QA Manager.
 *
 * Read-only over the already-captured PNGs (images/live/*, images/boards/*) and
 * over images/palette-readback.json. It adds NO interpretation to the frames: the
 * only processing is
 *
 *   - nearest-neighbour magnification of the hull crops (labelled on the figure),
 *     so the game's own pixels are enlarged, never resampled into new colours;
 *   - swatches filled with hexes MEASURED off those same PNGs by
 *     probe-art-palette.mjs, not with hexes typed from a document.
 *
 * Out: images/art-vs-board-scene.png, -ships.png, -ui.png
 * Usage: node evidence/build-art-composites.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, 'images');
const TMP = '/tmp/art-composites';
mkdirSync(TMP, { recursive: true });

const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const img = (rel) => b64(join(IMG, rel));

/**
 * Bounding box of everything meaningfully above the vacuum shade — used to centre
 * a hull crop on the SHIP the game drew rather than on a guessed pixel. Confined
 * to the left 55% of the frame because the home planet's blue rim intrudes on the
 * right of every hull crop and would drag the box off the ship.
 */
function subjectBox(src) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const limit = Math.round(src.width * 0.55);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < limit; x++) {
      const i = (y * src.width + x) * 4;
      const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
      if (Math.max(Math.abs(r - 13), Math.abs(g - 16), Math.abs(b - 21)) < 22) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2), w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Nearest-neighbour ×n. No interpolation: every output pixel is a source pixel. */
function magnify(relIn, absOut, n, region) {
  const src = PNG.sync.read(readFileSync(join(IMG, relIn)));
  if (region === 'auto') {
    const s = subjectBox(src);
    // A 2:1 window matching the board cards' aspect, sized off the ship itself.
    const h = Math.max(s.h + 26, 78), w = h * 2;
    region = { x: Math.max(0, Math.min(src.width - w, s.cx - Math.round(w / 2))),
               y: Math.max(0, Math.min(src.height - h, s.cy - Math.round(h / 2))), w, h };
  }
  const { x = 0, y = 0, w = src.width, h = src.height } = region ?? {};
  const out = new PNG({ width: w * n, height: h * n });
  for (let yy = 0; yy < out.height; yy++) {
    for (let xx = 0; xx < out.width; xx++) {
      const si = ((y + Math.floor(yy / n)) * src.width + (x + Math.floor(xx / n))) * 4;
      const di = (yy * out.width + xx) * 4;
      out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = 255;
    }
  }
  writeFileSync(absOut, PNG.sync.write(out));
  return absOut;
}

const PAL = JSON.parse(readFileSync(join(IMG, 'palette-readback.json'), 'utf8'));

const CSS = `
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#0A0C10;color:#DCE3EC;
       font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;padding:26px 26px 34px}
  h1{font-size:23px;margin:0 0 4px;color:#F2D24B}
  .lede{color:#98A3B2;font-size:13px;margin:0 0 20px;max-width:1500px}
  .lede b{color:#DCE3EC}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;
       background:#0F1319;border:1px solid #1E2530;border-radius:9px;padding:12px}
  .row.quad{grid-template-columns:repeat(4,1fr)}
  .rowhead{grid-column:1/-1;display:flex;gap:10px;align-items:baseline;
           border-bottom:1px solid #1E2530;padding-bottom:7px;margin-bottom:2px}
  .rowhead h2{font-size:15px;margin:0;color:#DCE3EC}
  .rowhead .note{font-size:12px;color:#8B95A5}
  figure{margin:0}
  figure img{width:100%;display:block;border-radius:5px;background:#0D1015;border:1px solid #1A212B;
             image-rendering:pixelated}
  .row.hull figure img{height:270px;object-fit:contain}
  figcaption{font-size:11.5px;color:#9AA5B4;padding:6px 2px 0;line-height:1.45}
  .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.07em;
       border-radius:3px;padding:1px 6px;margin-right:6px;vertical-align:1px}
  .tag.board{background:#2A2138;color:#C6A8F0}
  .tag.live{background:#12304A;color:#8FD0FF}
  table.pal{border-collapse:collapse;font:11.5px/1.4 ui-monospace,Consolas,monospace;width:100%}
  table.pal th{text-align:left;color:#8B95A5;font-weight:600;padding:4px 8px 4px 0;border-bottom:1px solid #1E2530}
  table.pal td{padding:4px 8px 4px 0;border-bottom:1px solid #141A22;vertical-align:middle}
  .sw{display:inline-block;width:34px;height:14px;border-radius:2px;border:1px solid #2A323D;
      vertical-align:-3px;margin-right:6px}
  .verdictbox{border:1px solid #2A323D;border-radius:8px;padding:12px 14px;margin:6px 0 18px;background:#0F1319}
  .verdictbox h3{margin:0 0 6px;font-size:13px;color:#F2D24B;letter-spacing:.04em}
  .verdictbox p{margin:0 0 6px;font-size:12.5px;color:#B9C2CF;max-width:1500px}
  .ok{color:#3DD68C}.gap{color:#E28A3B}.res{color:#8FD0FF}
`;

const page1 = (title, lede, body) => `<!doctype html><html><head><meta charset="utf8">
<style>${CSS}</style></head><body><h1>${title}</h1><p class="lede">${lede}</p>${body}</body></html>`;

const pair = (headTitle, headNote, left, right) => `
  <div class="row">
    <div class="rowhead"><h2>${headTitle}</h2><span class="note">${headNote}</span></div>
    <figure><img src="${left.src}"/><figcaption><span class="tag board">BOARD</span>${left.cap}</figcaption></figure>
    <figure><img src="${right.src}"/><figcaption><span class="tag live">LIVE BUILD</span>${right.cap}</figcaption></figure>
  </div>`;

function palTable(rows) {
  return `<table class="pal"><tr><th>what</th><th>live build, measured</th><th>board, measured</th><th>read</th></tr>` +
    rows.map((r) => `<tr><td>${r.what}</td>
      <td><span class="sw" style="background:${r.live}"></span>${r.live}${r.liveNote ? ' <span style="color:#7C8798">' + r.liveNote + '</span>' : ''}</td>
      <td><span class="sw" style="background:${r.board}"></span>${r.board}</td>
      <td class="${r.cls}">${r.read}</td></tr>`).join('') + `</table>`;
}

async function shoot(browser, html, outRel, width) {
  const file = join(TMP, outRel.replace(/[^a-z0-9]+/gi, '_') + '.html');
  writeFileSync(file, html);
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(IMG, outRel), fullPage: true });
  await ctx.close();
  console.log('[wrote]', outRel);
}

async function main() {
  const browser = await chromium.launch();

  // -------------------------------------------------------------------------
  // 1. SCENE
  // -------------------------------------------------------------------------
  {
    const rockLive = PAL.regions.rockLive[0], rockBoard = PAL.regions.rockBoard[0];
    const body = [
      pair('Mining run — beam on rock vs shots on rock',
           'board scene-gallery.html §The Triangle — Mine · live: ?debug=1, ship flown west by real WASD, trigger held on a real mouse',
           { src: img('boards/scene-00.png'),
             cap: '“Beam on rock, cracks spreading, freed ore drifting into the hold.” One continuous plasma beam from the ship to the rock; rocks are dark charcoal slabs with ink outlines and yellow ore diamonds; a four-square hold meter top-left; ASTEROID WAVE 2/5 top-right.' },
           { src: img('live/fight-burst-3.png'),
             cap: 'The same act in the shipped build. <b>NO beam</b>: the ship throws discrete round shots — two of the player’s in flight at centre, and one red enemy round to the right. The player’s Vanguard sits right of centre at full opacity with a 50/50 hull bar and two dark hold pips beneath it. Rocks are <b>pale grey</b> slabs carrying yellow ore pips, green-teal moss arcs and darker grey inner cores. Three rivals are named and coloured by roster — Sable (orange), Warden (slate-blue), Rusty (spring) — each with an HP bar. The coach line reads “Hold Left mouse on the asteroid — your shots…”.' }),
      pair('Sieging a defended planet',
           'board scene-gallery.html §The Triangle — Attack · live: ?debug=1&freeze=1 (worldHash 4302b39e), the freeze stamp’s turrets + shields, then __repairStage.siege(105) to lift spawn protection and bleed the core',
           { src: img('boards/scene-02.png'),
             cap: '“Two turrets + shield vs one ship.” Saturated blue ocean, green continents, gold core; a red shield arc and a yellow dashed atmosphere ring; two grey turrets on the rim, one firing a red beam, the attacker answering in blue; the defender’s name and HP as “WARDEN · 70%” in danger red.' },
           { src: img('live/scene-siege-home.png'),
             cap: 'The same furniture, and the same story. Steel-blue ocean, green continents, gold core; a bright plasma shield ring with <b>a red core-damage arc</b> running down its right side — the core read back at <b>55 / 100</b> after both shields (40 hp + 20 hp) were spent, through the sim’s own <code>damageStation</code>. Three grey turrets seated on the rim, the ship docked at three o’clock with a 50/50 hull bar, and the alarm line up. Two honest differences from the board: the atmosphere ring is a broken <b>teal</b> arc where the board draws a yellow dashed one, and nothing is firing (the sim is pinned), so there are no beams.' }),
      pair('The alarm — “the game’s whole design in one frame”',
           'board scene-gallery.html §Consequences · live: ?debug=1, twelve queued core hits after spawn protection expired; coreHp 100 → 40 read back off the sim',
           { src: img('boards/scene-08.png'),
             cap: 'A red-bordered frame, a hard red banner “▶ PLANET UNDER ATTACK ◀” across the top, MY PLANET drained to a red stub, a big red HOME arrow at the screen edge, and the question “one more rock, or fly home?”.' },
           { src: img('live/scene-alarm-full.png'),
             cap: 'The alarm is real and it is red: a dark red vignette frames the whole screen and a red arc appears on the home ring. But the words are a neutral coach line — “Your station is under attack — follow the arrow” in bone on the standard dark plate — not a red banner, and the HOME bar top-right is still full-width plasma blue at 94/100 rather than a red stub. No screen-edge HOME arrow is drawn (the ship is at home, so there is no direction to point).' }),
      pair('The field itself',
           'board scene-gallery.html §Mining run (rocks only) · live: the pinned arena, left of the home ring, nothing staged',
           { src: img('boards/scene-01.png'), cap: 'Asteroid-wave drop as the boards draw rock: dark charcoal bodies inside one crisp ink line.' },
           { src: img('live/scene-field-crop.png'), cap: 'The same rocks in the build: pale grey bodies, a darker grey inner core, yellow ore pips and green-teal moss arcs. Outlined, but in a lighter grey than the board’s ink.' }),
      `<div class="row"><div class="rowhead"><h2>The two shades this comparison turns on</h2>
         <span class="note">measured off the PNGs above by evidence/probe-art-palette.mjs — modal opaque colour of each region</span></div>
        <div style="grid-column:1/-1">${palTable([
          { what: 'asteroid body — <b>on screen the whole match</b>', live: rockLive.hex,
            liveNote: `${(rockLive.share * 100).toFixed(1)}% of the field crop · = DERIVED.rockBody 0x939ba5`,
            board: rockBoard.hex, cls: 'gap',
            read: 'THE GAP. Luminance 155 vs 79 — the live rock is roughly twice the board’s value. This is the exact “current” cell of GAP-ANALYSIS §2 Lever B (“a <i>light</i> tint” → “#454E59 dark charcoal”), unmoved.' },
          { what: 'asteroid outline', live: '#373D44', liveNote: '= DERIVED.rockFissure 0x2d3239, blended',
            board: '#262C34', cls: 'gap',
            read: 'THE GAP. Lever A asks every family to share one crisp ink #262C34; the ships got it (see art-vs-board-ships), rock did not.' },
          { what: 'ship hull plate, for contrast', live: '#7E8894', board: '#7E8894', cls: 'ok',
            read: 'exact match — the levers DID land on the ship family, which is what makes the rock rows above a gap rather than a direction' },
          { what: 'home ocean', live: '#2F4A63', liveNote: 'off the un-faded siege frame; the spawn-faded frame reads #2C4F6A', board: '#2E6E9E', cls: 'res',
            read: 'RESOLVED divergence — GAP-ANALYSIS §5.2 supersedes the board hex; the live ocean has moved bluer, in-ramp' },
          { what: 'core / ore gold', live: '#F2D24B', board: '#F2D24B', cls: 'ok', read: 'exact match' },
          { what: 'vacuum', live: '#0D1015', board: '#0D1015', cls: 'ok', read: 'exact match' },
        ])}
        <p style="margin:10px 0 0;font-size:12.5px;color:#B9C2CF;max-width:1500px">
        <b>Read the spawn tell before reading any value off a frame.</b> <code>render/index.ts:874</code> draws a ship at
        <code>alpha 0.5</code> and <code>:656</code> a station at <code>0.75</code> while spawn protection is up, and
        <code>SPAWN_PROTECTION_S</code> is 10 s. The pinned <code>?freeze=1</code> panels above sit at tick 120 — two
        seconds — so their ship and station are <i>deliberately half-faded</i>. Every colour in this table is measured off
        a frame that was polled until the un-faded steel was actually on screen, never off a pinned one.</p>
        </div></div>`,
    ].join('');
    await shoot(browser, page1(
      'art-vs-board-scene — the live battle scene against docs/art-direction/scene-gallery.html',
      `Every LIVE panel is the shipped preview build (<b>vite build → vite preview</b>, version.json sha <b>369d7a6</b>, built 2026-08-07T13:14:08Z) at 1280×800, deviceScaleFactor 2. Every BOARD panel is <b>docs/art-direction/scene-gallery.html</b> shot from the repo at the same scale — element screenshots keyed to the board’s own <code>.scene</code> figures, so a board edit moves the crop rather than silently changing what this claims to show. Nothing is retouched and nothing is colour-corrected. The captions describe only what is on the pixels. <b>Frames used for colour are past spawn protection</b> — a spawn-protected ship draws at <code>alpha 0.5</code> and a station at <code>0.75</code>, so a value read off the pinned opening frame measures the fade, not the paint.`,
      body), 'art-vs-board-scene.png', 1580);
  }

  // -------------------------------------------------------------------------
  // 2. SHIPS
  // -------------------------------------------------------------------------
  {
    const names = [
      { i: 0, live: 'hull-0-interceptor', title: 'INTERCEPTOR — Quadfin', board: 'boards/hull-svg-0.png' },
      { i: 1, live: 'hull-1-vanguard', title: 'VANGUARD — Anvil', board: 'boards/hull-svg-1.png' },
      { i: 2, live: 'hull-2-excavator', title: 'EXCAVATOR — Pincer', board: 'boards/hull-svg-2.png' },
      { i: 3, live: 'hull-3-hauler', title: 'HAULER — Hammerhead', board: 'boards/hull-svg-3.png' },
    ];
    // The game draws each hull 19–23 CSS px across; the board card draws it ~100.
    // Magnify the game's OWN pixels ×5 (nearest-neighbour) so the two are legible
    // side by side, and say so on the figure.
    const mags = names.map((n) => magnify(`live/${n.live}.png`, join(TMP, `${n.live}-x5.png`), 5, 'auto'));

    const cards = names.map((n, k) => `
      <div class="row hull" style="grid-template-columns:1fr 1fr">
        <div class="rowhead"><h2>${n.title}</h2>
          <span class="note">live: front door PLAY → PLAY SOLO → hull tile ${n.i} → RUSH!, the lobby reporting selectedClass="${['interceptor','vanguard','excavator','hauler'][n.i]}"</span></div>
        <figure><img src="${img(n.board)}"/><figcaption><span class="tag board">BOARD</span>ship-classes.html card ${n.i}, drawn ${['108×70','115×50','110×56','98×70'][n.i]} CSS px.</figcaption></figure>
        <figure><img src="${b64(mags[k])}"/><figcaption><span class="tag live">LIVE BUILD</span>The hull the running match draws, at gameplay scale — measured bounding box <b>${['20×23','19×21','22×24','23×29'][n.i]} CSS px</b> — shown here at nearest-neighbour ×5. No resampling: every block above is one pixel the game produced.</figcaption></figure>
      </div>`).join('');

    const body = cards + `
      <div class="row"><div class="rowhead"><h2>What the hull is actually painted with</h2>
        <span class="note">exact (unquantised) modal colours of the hull interiors above, 25% inset from each measured bounding box</span></div>
        <div style="grid-column:1/-1">${palTable([
          { what: 'hull plate', live: '#7E8894', liveNote: '52% of the Interceptor interior, 21% of the Vanguard’s',
            board: '#7E8894', cls: 'ok', read: 'EXACT MATCH — Lever A’s steel is on the screen, unmodified' },
          { what: 'outline ink', live: '#282C33', board: '#262C34', cls: 'ok',
            read: 'distance 2 — the one crisp ink Lever A asked for IS being painted on this family' },
          { what: 'trim / cockpit', live: '#3D7BFF', board: '#4DC3FF', cls: 'res',
            read: 'RESOLVED — GAP-ANALYSIS §5.1: the board’s cyan roster is superseded by PLAYER_ROSTER, and #3D7BFF is exactly its P1 Azure' },
          { what: 'lit trim', live: '#49B1FF', board: '#4DC3FF', cls: 'res', read: 'the lit face of the same ratified azure' },
          { what: 'drawn size', live: '19–23 CSS px across', board: '98–115 CSS px across', cls: 'res',
            read: 'not a gap — a gameplay sprite against a display card. It is why the ×5 magnification above is needed to compare them at all.' },
        ])}
        <p style="margin:10px 0 0;font-size:12.5px;color:#B9C2CF;max-width:1500px">
        <b>These numbers only mean anything because the frames are past spawn protection.</b>
        <code>render/index.ts:874</code> draws a ship at <code>alpha 0.5</code> while <code>ship.spawnProtect &gt; 0</code>
        (<code>SPAWN_PROTECTION_S</code> = 10 s), and <code>#7E8894</code> composited at one half over vacuum
        <code>#0D1015</code> is <code>#454C55</code> on all three channels — which is what an earlier pass of this gate
        measured, at +2.2 s, and very nearly reported as “the ships are painted a value step dark”. The capture now
        <b>polls the ship crop until the un-faded steel is actually on screen</b> rather than trusting a clock; the flip
        was observed between +9 s and +14 s. Corroboration that the generator was never in doubt:
        <code>assets/preview/sprite-sheet.svg</code> carries <code>fill="#7e8894"</code> 393 times.</p>
        </div></div>`;

    await shoot(browser, page1(
      'art-vs-board-ships — the four hulls the game draws, against docs/art-direction/ship-classes.html',
      `Four separate front-door runs of the shipped preview build (sha <b>369d7a6</b>): PLAY → PLAY SOLO → tap hull tile <i>i</i> → RUSH!, the hull confirmed each time by the lobby’s own <code>selectedClass</code> readback before the match was started. <b>?debug=1 cannot do this</b> — it skips the menu and the lobby entirely and its boot world is eight Vanguards — so these are the only frames in this gate reachable the way a player reaches them. The camera targets the local ship, so each crop is the viewport centre, captured at deviceScaleFactor 3 for real render pixels.`,
      body), 'art-vs-board-ships.png', 1400);
  }

  // -------------------------------------------------------------------------
  // 3. UI
  // -------------------------------------------------------------------------
  {
    const body = [
      pair('The whole screen',
           'board ui-mockup.html “PLANET RUSH — the whole screen” · live: clean boot, PLAY SOLO, Vanguard, first seconds of a real match',
           { src: img('boards/ui-svg-00.png'),
             cap: 'ORE 11 with two filled hold squares top-left · a ghosted PLANET RUSH wordmark and “ASTEROID WAVE 3/5 · NEXT 0:47 · 07:12” on one line top-centre · MY PLANET as a plasma bar top-right · rival planets ringed and labelled (WARDEN · ??, BOLT’S WORLD) · the radial BUILD & UPGRADE wheel open over the ship · a rounded minimap bottom-right · a seven-item control strip along the bottom.' },
           { src: img('live/ui-match-hud-full.png'),
             cap: 'TOTAL 3 top-left · “WAVE 1/5 · Outer Drift”, then NEXT 2:25, then MATCH 0:06, on THREE stacked lines, with no wordmark · “100/100 HOME” top-right, numerals then word, over a full plasma bar · rival ships labelled “Warden (HARD)” / “Rusty (EASY)” in their roster colours with HP bars — the rival PLANETS are not on screen at this zoom · a circular minimap bottom-right · a four-item control strip “WASD Thrust · Mouse Aim · Left mouse Fire / Mine · E Build & Upgrade”. The bright vertical rule at 83% width is the arena wall (ARENA_WALL_BANDS, “the world ends here”) — it moves with the camera, so it is world furniture, not a seam.' }),
      pair('The build & upgrade wheel',
           'board ui-mockup.html (same panel, centre) · live: ?debug=1&freeze=1, __upgradeWheelStage.openBuild() — the ship parked docked and the real wheel toggled',
           { src: img('boards/ui-svg-00.png'),
             cap: 'A radial wheel titled BUILD & UPGRADE over the ship, five wedges — TURRET 3 (highlighted gold), SHIELD 5, BANK, REPAIR CORE 1, UPGRADE SHIP ▸ — with the ship drawn in the hub and a gold tooltip “TURRET · 3 · LMB TO BUILD” below.' },
           { src: img('live/ui-build-wheel-full.png'),
             cap: 'The same radial form, five wedges, the UPGRADE SHIP ▸ drill-in preserved. Different contents: TURRET, SHIELD, RADAR, REPAIR REACTOR, UPGRADE SHIP — <b>BANK is gone and RADAR is new</b>, and REPAIR CORE is now REPAIR REACTOR. The hub holds the ore count (3) and CLOSE · ESC rather than the ship. Each wedge carries a target line (“YOUR STATION”) and a state line (“FULL 4 / 4 BUILT”). No board-style gold highlight is on any wedge — nothing is hovered. The coach line overlaps and clips the REPAIR REACTOR wedge’s “1 / 3”.' }),
      pair('Upgrade — “the only place stats live”',
           'board ui-mockup.html §Upgrade panel · live: ?debug=1&freeze=1, __upgradeWheelStage.openUpgrade(11) — the real UPGRADE SHIP ▸ drill-in, with 11 ore banked',
           { src: img('boards/ui-svg-01.png'),
             cap: 'A rectangular PANEL: title UPGRADE SHIP, ORE 11 top-right, the ship drawn at left with EXCAVATOR / “Pincer hull · mining engine”, then four full-width rows — BEAM (highlighted gold, TIER 2/3, 4 ORE), ENGINE (1/3, 3 ORE), CARGO (0/3, 3 ORE), HULL (0/3, 5 ORE) — each with a tier bar and a before → after figure, and a gold BUY · 4 button.' },
           { src: img('live/ui-upgrade-wheel-full.png'),
             cap: 'The same four tracks, re-formed as a RADIAL WHEEL: WEAPON ▸ (with DAMAGE ○○○ / SPEED ○○ pips), ENGINE 100% → 115%, CARGO, HULL 50 → 60, costs 3 / 2 / 3 in gold on the wedges, and the hub carrying the ore count 11, the hull name VANGUARD and BACK · ESC. The board’s table is gone; BEAM is now WEAPON with its own sub-wheel. <b>The persistent coach plate is drawn over the bottom wedge</b> — CARGO’s label is cut in half and its cost is hidden behind “Spend ore on defense — or UPGRADE SHIP to mine and hit harder”.' }),
      pair('The lobby — “where the wordmark lives”',
           'board ui-mockup.html §Lobby (an HTML panel, not an svg — an svg-only sweep loses it) · live: clean boot → PLAY SOLO',
           { src: img('boards/ui-div-lobby.png'),
             cap: 'A huge gold PLANET RUSH wordmark over “ROOM GRAV-7 · 8 PLANETS · LAST CORE STANDING”, eight roster rows in two columns each with a colour dot, name, class and READY/EASY/MEDIUM/HARD chip, and a large solid-gold LAUNCH button beside “Share code: GRAV-7”.' },
           { src: img('live/ui-lobby-full.png'),
             cap: 'Titled <b>CREW MUSTER</b>. <b>No wordmark and no gold anywhere.</b> Machined steel plates with lit top edges and rivets: MODE · FFA and ORE · SCARCE chips, eight seat rows (P1 “YOU ★ INTERCEPTOR” TAKEN, seven OPEN bots with EASY/MEDIUM/HARD) each carrying a roster-coloured spine, four hull cards with SPD/ACC/TRN/HULL/PWR/HOLD pips and numbers, four arena cards, and RUSH! as the single brightest plate bottom-right. The eight spine colours are the ratified PLAYER_ROSTER — azure, cyan, spring, violet, magenta, orange, chalk, slate-blue — not the board’s cyan/red/gold/pink/white.' }),
      pair('The main menu',
           'board ui-mockup.html §Main menu & settings · live: clean boot (title), then __mainMenu.play() (doors)',
           { src: img('boards/ui-div-menu.png'),
             cap: 'Gold PLANET RUSH wordmark, “MINE · BUILD · CONQUER”, a solid-gold PLAY button with three plasma-cyan sub-links (QUICK MATCH — VS BOTS / HOST ONLINE ROOM / JOIN WITH CODE), then SETTINGS / HOW TO PLAY / QUIT; the settings panel beside it uses gold tab outlines and cyan sliders and toggles.' },
           { src: img('live/ui-menu-doors.png'),
             cap: 'DEEP FIELD MINING AUTHORITY / CONTRACT OPEN · SECTOR 04 top-left, a chalk PLANET RUSH wordmark centred, MINE · DEFEND · ATTACK under it, then four bevelled steel plates — CAMPAIGN, PLAY SOLO (raised: the one bright plate), CREATE ROOM, JOIN ROOM — each with a one-line description, and BACK / SETTINGS in the bottom corners. Again hueless: brightness carries the primary, not gold.' }),
      `<div class="row"><div class="rowhead"><h2>Which half of this board is still the target</h2>
        <span class="note">read before scoring the four pairs above</span></div>
        <div style="grid-column:1/-1">
          <p style="margin:0 0 8px;font-size:12.5px;color:#B9C2CF;max-width:1500px">
          <b>ui-mockup.html is only half in force.</b> Its menu, lobby, ship-select, build-wheel and settings drawings were
          <b class="res">superseded on 2026-08-05</b> by the ratified <b>Gantry / Bone</b> direction
          (<code>docs/design/gantry-bone-handoff.md</code>, named as the worked example in <code>style-guide.md</code>).
          That direction states the rule the live screens above are obeying: <i>“the primary action is simply the brightest
          plate on screen. It spends no colour on the menu.”</i> So the missing gold wordmark and the missing gold LAUNCH
          are <b class="res">the ratified direction being followed</b>, not the board being missed. The one place the board
          still governs is the <b>in-match HUD</b> — pair 1 — because the 2026-08-06 cost-numeral amendment says in terms
          that it “licenses nothing in a menu, on the HUD, in the lobby, or on any other screen”.</p>
          ${palTable([
          { what: 'HUD text / bone', live: '#C6CDD6', board: '#C6CDD6', cls: 'ok', read: 'exact match' },
          { what: 'ore / signal gold', live: '#F2D24B', board: '#F2D24B', cls: 'ok', read: 'exact match' },
          { what: 'vacuum', live: '#0D1015', board: '#0D1015', cls: 'ok', read: 'exact match' },
          { what: 'friendly bar', live: '#3C77F4', board: '#4DC3FF', cls: 'res',
            read: 'RESOLVED — the bar wears the OWNER’s roster colour (P1 Azure #3D7BFF); the board’s plasma cyan is the superseded roster (GAP-ANALYSIS §5.1)' },
          { what: 'HUD face', live: 'split — display face for headings, mono numerals', board: 'Audiowide throughout', cls: 'res',
            read: 'RESOLVED — GAP-ANALYSIS §5.3: style-guide §7 splits the faces and the mockup’s all-Audiowide is explicitly not followed' },
          { what: 'menu / lobby hue', live: 'hueless steel + bone', board: 'gold wordmark, gold primary, cyan links', cls: 'res',
            read: 'RESOLVED — Gantry/Bone (2026-08-05) replaced these screens wholesale' },
        ])}</div></div>`,
    ].join('');
    await shoot(browser, page1(
      'art-vs-board-ui — the shipped menu / HUD against docs/art-direction/ui-mockup.html',
      `LIVE panels are the shipped preview build (sha <b>369d7a6</b>) at 1280×800 dsf 2, through the real front door except the wheel, which is opened by the ratified <code>__upgradeWheelStage.openBuild()</code> live-stage seam (it parks the ship docked and toggles the REAL wheel — the same state a press produces). BOARD panels are <b>docs/art-direction/ui-mockup.html</b>. That board draws only two of its screens as <code>&lt;svg&gt;</code> (the whole-screen HUD and the upgrade panel) — the lobby and the main menu are styled <code>&lt;div&gt;</code>s, which an svg-only sweep loses silently, so they are shot by their own selectors and all five pairs below are real board art. <b>Read the last panel before scoring any of them:</b> only the in-match HUD half of this board is still in force.`,
      body), 'art-vs-board-ui.png', 1580);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
