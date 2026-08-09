/**
 * evidence/p1-07-summary-cues/build-board.mjs — the four new slots, as the
 * developer sees them. OWNER: Sound Agent. Evidence only; not in the game bundle.
 *
 * The brief's evidence line asks for *"the four slots in the review page with
 * their three candidates each."* The Director's review portal is not in this
 * repo; what IS in this repo is the contract it reads,
 * `sound-review/manifest.json`. So this renders that contract the way the portal
 * renders it — the slot, its context, `current` with a play button, and the three
 * candidates each with their `character` line beside their own play button.
 *
 * The layout is a0-01b's (`evidence/a0-01b-candidates-round2/build-board.mjs`),
 * on purpose and unchanged: these four slots arrive on the same board as the
 * forty, and a picture that styles them differently would be evidence about a
 * page that does not exist. **One deliberate difference** — the WAV paths are
 * **relative**, where a0-01b's are absolute `file:///lanes/lane-2/...` baked in
 * at generation time. A committed artifact with a lane path in it only plays back
 * in the lane that wrote it.
 *
 * Reads the committed manifest and nothing else, so the words in the picture are
 * the words on the board by construction.
 *
 * Usage: node evidence/p1-07-summary-cues/build-board.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const manifest = JSON.parse(readFileSync(join(REPO, 'sound-review', 'manifest.json'), 'utf8'));

/** The four this brief added, in the order the sequence plays them (plan §6.3). */
const SLOTS = ['xpTick', 'xpBarFill', 'levelUp', 'xpSettle'];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Relative to this file, so the committed HTML plays in any checkout. */
const wavUrl = (rel) => `../../sound-review/${rel}`;

function slotHtml(slot, beat) {
  const cands = slot.candidates
    .map(
      (c) => `
        <div class="cand">
          <div class="badge">${esc(c.id)}</div>
          <audio controls preload="none" src="${wavUrl(c.wav)}"></audio>
          <div class="character">${esc(c.character)}</div>
        </div>`,
    )
    .join('');
  return `
    <section class="slot" id="slot-${esc(slot.id)}">
      <header>
        <h2>${esc(slot.label)}<span class="id">${esc(slot.id)}</span><span class="beat">${esc(beat)}</span></h2>
        <p class="context">${esc(slot.context)}</p>
      </header>
      <div class="current">
        <div class="badge cur">current</div>
        <audio controls preload="none" src="${wavUrl(slot.current)}"></audio>
        <div class="character shipped">the voice this brief ships — the incumbent to choose against</div>
      </div>
      <div class="cands">${cands}</div>
      <button class="deny">DENY ALL — generate 3 new options</button>
    </section>`;
}

/** The beat each slot plays on, so the board reads as a sequence and not a list. */
const BEATS = {
  xpTick: 'beat 1–2 · the count-up',
  xpBarFill: 'beat 3 · the bar fills',
  levelUp: 'beat 4 · the level-up',
  xpSettle: 'beat 5 · the settle',
};

const html = `<!doctype html>
<meta charset="utf-8">
<title>Planet Rush — sound review (p1-07, the four summary cues)</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 28px; background: #0b0e13; color: #dfe6f2;
         font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: .01em; }
  .lede { color: #8d9ab0; margin: 0 0 26px; font-size: 13.5px; max-width: 74ch; }
  .slot { background: #131822; border: 1px solid #1f2836; border-radius: 10px;
          padding: 18px 20px 16px; margin-bottom: 16px; }
  .slot header { margin-bottom: 14px; }
  h2 { font-size: 16.5px; margin: 0 0 3px; display: flex; align-items: baseline; gap: 10px; }
  .id { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #66748c; }
  .beat { font-size: 12px; color: #7f8ea8; margin-left: auto; letter-spacing: .02em; }
  .context { margin: 0; color: #8d9ab0; font-size: 13px; }
  .current, .cand { display: grid; grid-template-columns: 78px 300px 1fr;
                    align-items: center; gap: 14px; padding: 7px 0; }
  .current { border-bottom: 1px solid #1f2836; margin-bottom: 6px; padding-bottom: 12px; }
  .badge { font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em;
           text-transform: uppercase; text-align: center; padding: 5px 0; border-radius: 4px;
           background: #26344a; color: #9fb4d4; }
  .badge.cur { background: #2b2f26; color: #b6c48d; }
  audio { width: 300px; height: 32px; }
  .character { font-size: 14px; color: #eaf0fa; }
  .character.shipped { color: #97a08c; font-style: italic; }
  .deny { margin-top: 12px; background: #2a1a1c; color: #d99aa2; border: 1px solid #472329;
          border-radius: 6px; padding: 7px 13px; font-size: 12.5px; font-family: inherit; }
</style>
<h1>Planet Rush — sound review</h1>
<p class="lede">The four end-of-match summary cues (p1-07), new slots 41–44 on the board.
   <b>current</b> is the voice this brief ships; <b>a</b>, <b>b</b>, <b>c</b> are the three
   options to choose against it. They are heard in the order below, under a result that has
   already sounded — and none of them is <code>matchEnd</code>, <code>musicWin</code> or
   <code>musicLoss</code>, which are three of the forty slots already denied.</p>
${SLOTS.map((id) => {
  const slot = manifest.slots.find((s) => s.id === id);
  if (!slot) throw new Error(`${id} is not on the board — re-run sound-review/render.ts`);
  return slotHtml(slot, BEATS[id]);
}).join('\n')}
`;

const outHtml = join(HERE, 'board.html');
writeFileSync(outHtml, html);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1400 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('file://' + outHtml, { waitUntil: 'load' });

// All four in one frame — the sequence, which is how the beat is judged.
await page.evaluate((ids) => {
  const wrap = document.createElement('div');
  wrap.id = 'all-four';
  document.body.insertBefore(wrap, document.getElementById(`slot-${ids[0]}`));
  for (const id of ids) wrap.append(document.getElementById(`slot-${id}`));
}, SLOTS);
await page.locator('#all-four').screenshot({ path: join(HERE, 'board-four-slots.png') });
// And the one the ask is actually about, on its own.
await page.locator('#slot-levelUp').screenshot({ path: join(HERE, 'board-levelUp.png') });

await browser.close();
console.log(`board.html + 2 screenshots written to ${HERE}`);
