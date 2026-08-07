/**
 * evidence/capture-art-boards.mjs — the CONCEPT BOARD half of the art-vs-boards
 * gate. OWNER: QA Manager.
 *
 * Shoots docs/art-direction/*.html — the frozen Cold Vacuum boards the game is
 * supposed to have grown into — from the file:// source in the repo, at the same
 * deviceScaleFactor 2 the live captures use, so the two halves of each composite
 * are pixel-comparable rather than one being resampled against the other.
 *
 *   scene-gallery.html — the 14 scene figures (`.scene` blocks)
 *   ship-classes.html  — the four hull cards (`.card` blocks)
 *   ui-mockup.html     — the whole-screen HUD mockup and the menu/lobby panels
 *
 * Board sections are addressed by DOM selector and shot with element.screenshot(),
 * so a board edit that moves a figure changes the crop rather than silently
 * shifting what the composite claims to show. Nothing here touches the game.
 *
 * Usage: node evidence/capture-art-boards.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = join(HERE, 'images', 'boards');
const DSF = 2;

const boardUrl = (f) => 'file://' + join(REPO, 'docs', 'art-direction', f);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  const index = {};

  // --- scene-gallery: every .scene figure, keyed by its own <h3> caption -----
  await page.goto(boardUrl('scene-gallery.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const scenes = await page.$$eval('.scene', (els) =>
    els.map((el, i) => ({
      i,
      title: (el.querySelector('h3')?.textContent ?? '').trim(),
      cap: (el.querySelector('.cap')?.textContent ?? '').trim().slice(0, 400),
    })));
  index.scenes = scenes;
  const sceneEls = await page.$$('.scene');
  for (let i = 0; i < sceneEls.length; i++) {
    await sceneEls[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    await sceneEls[i].screenshot({ path: join(OUT, `scene-${String(i).padStart(2, '0')}.png`) });
  }
  console.log('[scene-gallery]', scenes.map((s) => `${s.i}:${s.title}`).join(' | '));

  // --- ship-classes: the four hull cards ------------------------------------
  await page.goto(boardUrl('ship-classes.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const cards = await page.$$eval('.card', (els) =>
    els.map((el, i) => ({ i, title: (el.querySelector('h3')?.textContent ?? '').trim() })));
  index.hullCards = cards;
  const cardEls = await page.$$('.card');
  for (let i = 0; i < cardEls.length; i++) {
    await cardEls[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    await cardEls[i].screenshot({ path: join(OUT, `hull-card-${i}.png`) });
    // The bare hull drawing on its own, with no stat bars — the thing the game's
    // sprite is actually comparable to.
    const svg = await cardEls[i].$('svg');
    if (svg) await svg.screenshot({ path: join(OUT, `hull-svg-${i}.png`) });
  }
  console.log('[ship-classes]', cards.map((c) => `${c.i}:${c.title}`).join(' | '));

  // --- ui-mockup: the sections, keyed by heading ----------------------------
  await page.goto(boardUrl('ui-mockup.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  const uiShape = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('svg').forEach((s, i) => {
      const r = s.getBoundingClientRect();
      // Nearest preceding heading, so each mockup panel carries the board's own words.
      let n = s.previousElementSibling, head = '';
      while (n && !head) { if (/^H[123]$/.test(n.tagName)) head = n.textContent.trim(); n = n.previousElementSibling; }
      if (!head) {
        let p = s.parentElement;
        while (p && !head) {
          let q = p.previousElementSibling;
          while (q && !head) { if (/^H[123]$/.test(q.tagName)) head = q.textContent.trim(); q = q.previousElementSibling; }
          p = p.parentElement;
        }
      }
      out.push({ i, head, w: Math.round(r.width), h: Math.round(r.height), viewBox: s.getAttribute('viewBox') });
    });
    return out;
  });
  index.uiPanels = uiShape;

  // ui-mockup.html draws only TWO of its screens as <svg> (the whole-screen HUD
  // and the upgrade panel). The lobby and the main menu are laid out as styled
  // divs — `.lobby` and `.menuwrap` — so an svg-only sweep silently loses half
  // the board. Shoot those by their own selectors.
  index.uiDivs = [];
  for (const [sel, name] of [['.lobby', 'ui-div-lobby'], ['.menuwrap', 'ui-div-menu'], ['.flow', 'ui-div-flow']]) {
    const el = await page.$(sel);
    if (!el) { index.uiDivs.push({ sel, name, found: false }); continue; }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    await el.screenshot({ path: join(OUT, name + '.png') });
    const r = await el.boundingBox();
    index.uiDivs.push({ sel, name, found: true, box: r });
  }
  console.log('[ui-divs]', JSON.stringify(index.uiDivs.map((d) => `${d.name}:${d.found}`)));

  const svgs = await page.$$('svg');
  for (let i = 0; i < svgs.length; i++) {
    await svgs[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
    await svgs[i].screenshot({ path: join(OUT, `ui-svg-${String(i).padStart(2, '0')}.png`) }).catch(() => {});
  }
  console.log('[ui-mockup]', uiShape.map((u) => `${u.i}:${u.head}:${u.w}x${u.h}`).join(' | '));

  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
