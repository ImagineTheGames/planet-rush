/**
 * evidence/p1-06-lobby-level-badge/capture.mjs — the ruling, photographed on the
 * REAL booted client. OWNER: UI Engineer (brief
 * `docs/briefs/pr-06-lobby-level-badge.md`, the evidence line).
 *
 * The developer, 2026-08-07: *"we can show the LEVEL but not XP (and show it only
 * in the lobby)."* The evidence line asks for **two frames of the same seat**:
 *
 *   1. the lobby roster, with `LVL n` on the local player's row — and on no other;
 *   2. the same seat **in the match**, its nameplate carrying none.
 *
 * The pair is the ruling shown, and the second frame is the one that matters:
 * it is the absence, at the moment the fog rule applies (GDD §2.2).
 *
 * Three more frames make the pair readable and prove it is not a lucky crop:
 *
 *   3. a tight crop of the badged row, at the size the chip is actually drawn;
 *   4. a tight crop of a BOT row at the same width, where the same chip carries a
 *      tier and no level;
 *   5. the roster at a **non-default level**, so the frame shows the number moving
 *      with the profile rather than a constant baked into the view.
 *
 * The level is genuine in every frame: the profile is written through
 * `progression/profile.ts`'s own key before the client boots, and read back off
 * the running client's `__lobby.levelBadges` seam — no view is asked what it
 * would draw, and no number here is typed twice.
 *
 * Run:  node evidence/p1-06-lobby-level-badge/capture.mjs
 * (builds first if `dist/` is stale: `npm run build`)
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(HERE, '../../dist');
const PORT = 4189;
/** A landscape phone — the orientation this screen is locked to, and the width
 *  the roster row's chips are tightest at (`ui/lobby-geometry`). */
const VIEWPORT = { width: 844, height: 390 };
/** The career the frames are taken at. Written into the store as XP, so the level
 *  is DERIVED by the shipped curve rather than asserted by this script. */
const EVIDENCE_LEVEL = 7;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** The smallest static server that can serve a Vite build — no preview process
 *  to shepherd, and no port negotiation with whatever else the lane is running. */
function serve(root, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname.endsWith('/')) file = join(root, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Walk the ratified play flow to the lobby with REAL presses — PLAY → the doors
 *  → PLAY SOLO. A frame of a screen reached by a press proves it is reachable. */
async function openLobby(page) {
  await page.waitForFunction(() => !!window.__mainMenu, undefined, { timeout: 30_000 });
  const play = await page.evaluate(() => {
    const c = window.__mainMenu.controls.find((k) => k.kind === 'play');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!play) throw new Error('the menu did not report where PLAY is drawn');
  await page.mouse.click(play.x, play.y);

  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 20_000,
  });
  const solo = await page.evaluate(() => {
    const c = window.__onlineMenu.doorControls.find((k) => k.kind === 'solo');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!solo) throw new Error('the doors did not report where PLAY SOLO is drawn');
  await page.mouse.click(solo.x, solo.y);

  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
  // Park the pointer: it is left sitting where PLAY SOLO was, which would hover a
  // roster row and photograph the screen mid-hover rather than at rest.
  await page.mouse.move(1, 1);
  await sleep(400);
}

/** The XP that reaches a level, off the shipped curve's own two constants —
 *  `xpToReach(L) = Σ round(base·i^exp)` (`src/progression/curve.ts`). Kept in one
 *  line so the number in the frame is the game's, not this file's. */
function xpToReach(level, base = 300, exp = 1.6) {
  let total = 0;
  for (let i = 1; i < level; i++) total += Math.round(base * Math.pow(i, exp));
  return total;
}

/** Seed a career into the store the client will read, through the real key and
 *  the real shape (`progression/profile.ts` — `planet-rush:profile`, `v: 1`). */
async function seedProfile(page, level) {
  const xp = xpToReach(level);
  await page.addInitScript(
    ([xp, level]) => {
      localStorage.setItem(
        'planet-rush:profile',
        JSON.stringify({ v: 1, xp, level, matches: 12 }),
      );
    },
    [xp, level],
  );
}

async function main() {
  const server = await serve(DIST, PORT);
  const browser = await chromium.launch();
  const frames = [];

  /** One booted page with a seeded career, at the landscape-phone size. */
  async function boot(level) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3 });
    const page = await context.newPage();
    await seedProfile(page, level);
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.evaluate(() => document.fonts?.ready);
    return { context, page };
  }

  const shoot = async (page, name, clip) => {
    const path = join(HERE, name);
    await page.screenshot(clip ? { path, clip } : { path });
    return path;
  };

  // ---- 1, 3, 4: the lobby at level 7, whole and cropped -------------------
  {
    const { context, page } = await boot(EVIDENCE_LEVEL);
    await openLobby(page);

    const seam = await page.evaluate(() => ({
      you: window.__lobby.you,
      badges: window.__lobby.levelBadges,
      badgeBounds: window.__lobby.levelBadgeBounds,
      rows: window.__lobby.seatRows,
      characters: window.__lobby.seatCharacters,
    }));
    frames.push({
      frame: '1-lobby-roster.png',
      what: 'the lobby roster: LVL 7 on your own row, and on no other',
      you: seam.you,
      badges: seam.badges,
      badged: seam.badges.filter((b) => b !== null).length,
    });
    await shoot(page, '1-lobby-roster.png');

    if (!seam.badgeBounds) throw new Error('no level badge was drawn — nothing to photograph');
    // A generous margin around the chip so the crop shows the ROW it sits on —
    // the P-number, the name and the badge together, which is what a reader has
    // to see to know whose row it is.
    const b = seam.badgeBounds;
    const rowCrop = {
      x: Math.max(0, b.x - 260),
      y: Math.max(0, b.y - 4),
      width: Math.min(VIEWPORT.width, b.width + 268),
      height: b.height + 8,
    };
    await shoot(page, '3-your-row-crop.png', rowCrop);
    frames.push({
      frame: '3-your-row-crop.png',
      what: 'the badged row at the size it is drawn — LVL 7 in the trailing chip',
      clip: rowCrop,
    });

    // The same crop, one row down: a BOT row, whose trailing chip carries a TIER
    // and no level. Same width, same chip, different content — which is the
    // clearest single picture of "the badge is yours and nobody else's".
    const botRow = seam.characters.findIndex((c) => c !== null);
    if (botRow < 0) throw new Error('the offline lobby seated no bot to contrast against');
    const rowHeight = seam.rows[0]?.height ?? 0;
    const delta = (botRow - seam.you) * (rowHeight * 3); // dpr 3 → physical px
    const botCrop = { ...rowCrop, y: Math.max(0, rowCrop.y + delta) };
    await shoot(page, '4-a-bot-row-crop.png', botCrop);
    frames.push({
      frame: '4-a-bot-row-crop.png',
      what: 'a BOT row at the same crop: the same chip carries a tier, never a level',
      botRow,
      clip: botCrop,
    });

    await context.close();
  }

  // ---- 5: the same roster at a different career ---------------------------
  {
    const { context, page } = await boot(2);
    await openLobby(page);
    const badges = await page.evaluate(() => window.__lobby.levelBadges);
    await shoot(page, '5-lobby-at-level-2.png');
    frames.push({
      frame: '5-lobby-at-level-2.png',
      what: 'the same roster at a level-2 career — the number moves with the profile',
      badges,
    });
    await context.close();
  }

  // ---- 2: the same seat, in the match, with no badge -----------------------
  {
    const { context, page } = await boot(EVIDENCE_LEVEL);
    await openLobby(page);
    const before = await page.evaluate(() => window.__lobby.levelBadges);
    // RUSH! the way a player does — the physical point the client itself drew it
    // at, through the landscape-lock transform.
    const rush = await page.evaluate(() => window.__lobby.rushControl.physicalCenter);
    await page.mouse.click(rush.x, rush.y);
    await page.waitForFunction(() => window.__lobby?.visible === false, undefined, {
      timeout: 30_000,
    });
    // Fly for a moment so the nameplates are over moving hulls rather than over a
    // start-of-match freeze frame, and so the shot is of a real match.
    await page.keyboard.down('KeyW');
    await sleep(1400);
    await page.keyboard.up('KeyW');
    await sleep(600);
    await shoot(page, '2-in-match-nameplates.png');
    frames.push({
      frame: '2-in-match-nameplates.png',
      what: 'the SAME seat in the match: the nameplate carries no level, and the lobby is gone',
      lobbyBadgesBeforeRush: before,
      lobbyVisibleAfterRush: await page.evaluate(() => window.__lobby.visible),
      lobbyBadgesAfterRush: await page.evaluate(() => window.__lobby.levelBadges),
    });
    await context.close();
  }

  // ---- 6: the frozen debug scene — many nameplates, not one level ---------
  {
    // `?debug=1&freeze=1` is the deterministic world the mobile goldens shoot: a
    // populated field with ships, stations and their nameplates all on screen at
    // once. It skips the lobby by contract, which is the point — this is the
    // in-match surface with NO lobby anywhere near it, and there is still no
    // level and no XP on any hull, any bar, or the HUD.
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3 });
    const page = await context.newPage();
    await seedProfile(page, EVIDENCE_LEVEL);
    await page.goto(`http://localhost:${PORT}/?debug=1&freeze=1`);
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, {
      timeout: 20_000,
    });
    await page.evaluate(() => document.fonts?.ready);
    await sleep(600);
    await shoot(page, '6-frozen-scene-no-levels.png');
    frames.push({
      frame: '6-frozen-scene-no-levels.png',
      what: 'the frozen debug world: every nameplate on screen, not a level or an XP figure among them',
      profileSeededAt: EVIDENCE_LEVEL,
    });
    await context.close();
  }

  writeFileSync(join(HERE, 'frames.json'), `${JSON.stringify({ viewport: VIEWPORT, frames }, null, 2)}\n`);
  await browser.close();
  server.close();
  console.log(JSON.stringify(frames, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
