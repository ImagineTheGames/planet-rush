/**
 * evidence/a0-01b-candidates-round2/build-board.mjs — the board, as the developer
 * sees it. OWNER: Sound Agent. Evidence only; nothing here is in the game bundle.
 *
 * The a0-01b brief asks for *"a screenshot of two or three slots showing three new
 * candidate descriptions and `current` unchanged — the same view the developer
 * sent, with different words in it."* The Director's review portal is not in this
 * repo; what IS in this repo is the contract it reads, `sound-review/manifest.json`.
 * So this renders that contract the way the portal renders it — the slot, its
 * context, `current` with a play button, and the three candidates each with the
 * `character` line printed next to their own play button — and shoots it.
 *
 * It reads the committed manifest and nothing else, so the words in the screenshot
 * are the words on the board by construction: if this picture is wrong, the board
 * is wrong the same way.
 *
 * Also emits `spread-by-family.md` from `candidate-spread.json` (written by
 * `spikes/tone-audit/measure-candidates.ts --json`) — the second half of the
 * brief's evidence ask, which is that a/b/c are distinct rather than three takes
 * of one idea.
 *
 * Usage: node evidence/a0-01b-candidates-round2/build-board.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const REVIEW = join(REPO, 'sound-review');

const manifest = JSON.parse(readFileSync(join(REVIEW, 'manifest.json'), 'utf8'));

/** The families, in the order the batches shipped — the board is walked in slot order. */
const FAMILIES = [
  { name: 'mine', slots: ['rockChip', 'rockCrack', 'rockBurst', 'oreCollect', 'holdFull', 'bankOre', 'depositTick'] },
  { name: 'fight', slots: ['hullHit', 'turretFire', 'shotImpact', 'shieldHit', 'shieldDown', 'coreHit', 'turretDown'] },
  { name: 'ship', slots: ['shipExplode', 'shipSpawn', 'spawnPulse', 'thruster'] },
  { name: 'station', slots: ['buildPlaced', 'buildComplete', 'repairTick', 'upgradeBought'] },
  { name: 'clock', slots: ['waveArrive', 'collapseBegin', 'stationDeath', 'matchEnd', 'alarm'] },
  { name: 'music', slots: ['ambient', 'musicBed', 'musicPulse', 'musicTheme', 'musicDread', 'musicWin', 'musicLoss'] },
  { name: 'interface', slots: ['pressTick', 'purchaseConfirm', 'rejectBuzz', 'respawnBeep', 'respawnGo', 'minimapPing'] },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wavUrl = (rel) => 'file://' + join(REVIEW, rel);

function slotHtml(slot) {
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
        <h2>${esc(slot.label)}<span class="id">${esc(slot.id)}</span></h2>
        <p class="context">${esc(slot.context)}</p>
      </header>
      <div class="current">
        <div class="badge cur">current</div>
        <audio controls preload="none" src="${wavUrl(slot.current)}"></audio>
        <div class="character shipped">the shipped bank — unchanged by this round</div>
      </div>
      <div class="cands">${cands}</div>
      <button class="deny">DENY ALL — generate 3 new options</button>
    </section>`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>Planet Rush — sound review (a0-01b, round 2 candidates)</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 28px; background: #0b0e13; color: #dfe6f2;
         font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: .01em; }
  .lede { color: #8d9ab0; margin: 0 0 26px; font-size: 13.5px; }
  .slot { background: #131822; border: 1px solid #1f2836; border-radius: 10px;
          padding: 18px 20px 16px; margin-bottom: 16px; }
  .slot header { margin-bottom: 14px; }
  h2 { font-size: 16.5px; margin: 0 0 3px; display: flex; align-items: baseline; gap: 10px; }
  .id { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #66748c; }
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
<p class="lede">Round 2 candidates (a0-01b). <b>current</b> is the shipped a0-01 re-voice and is untouched;
   <b>a</b>, <b>b</b>, <b>c</b> are the three new options the DENY ALL button promised.</p>
${manifest.slots.map(slotHtml).join('\n')}
`;

const outHtml = join(HERE, 'board.html');
writeFileSync(outHtml, html);

// --- the per-family spread table -------------------------------------------

const spread = JSON.parse(readFileSync(join(HERE, 'candidate-spread.json'), 'utf8'));
const bySlot = new Map(spread.slots.map((s) => [s.slot, s]));

let md = `# a0-01b — are the three offers a real choice?

Generated by \`node evidence/a0-01b-candidates-round2/build-board.mjs\` from
\`candidate-spread.json\`, which is \`npx vite-node
spikes/tone-audit/measure-candidates.ts --json\`.

A slot is a real choice when **every** one of its six pairs — a·b, a·c, b·c and
each of the three against \`current\` — is separated on at least one of two axes:
a band-profile cosine distance of **${spread.minDistance}** or more, or a spectral-centre ratio
of **×${spread.minCentroidRatio}** or more. Two floors rather than one, because a legitimate pair can
be separated by either: a dark grain bed and a bright metal ring differ in
profile, while two struck bands an octave apart differ in centre.

\`centroid\` is spectral centre in Hz over the loudest 8192-sample window. The last
three columns are the slot's **closest pair** — the one with the least headroom
over whichever floor it clears — named, with both of its numbers. They are one
pair's two numbers, not two different pairs' minima, so \`d\` and \`×\` can be read
together: the pair passes if **either** \`d ≥ ${spread.minDistance}\` or \`× ≥ ${spread.minCentroidRatio}\`, and a low
number in one column is fine when the other carries it.

`;

let totalPairs = 0;
let totalFail = 0;
for (const fam of FAMILIES) {
  md += `\n## ${fam.name}\n\n| slot | current | a | b | c | closest pair | its d | its × | verdict |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const id of fam.slots) {
    const s = bySlot.get(id);
    if (!s) continue;
    const hz = (r) => `${Math.round(r.centroid)} Hz`;
    const [cur, a, b, c] = s.rows;
    // Headroom: how far the pair clears the better of its two floors. The pair
    // with the least is the one a future edit would push under first.
    const headroom = (p) =>
      Math.max(p.distance / spread.minDistance, p.centroidRatio / spread.minCentroidRatio);
    const closest = s.pairs.reduce((w, p) => (headroom(p) < headroom(w) ? p : w));
    const bad = s.pairs.filter((p) => !p.ok).length;
    totalPairs += s.pairs.length;
    totalFail += bad;
    md += `| \`${id}\` | ${hz(cur)} | ${hz(a)} | ${hz(b)} | ${hz(c)} | ${closest.pair} | ${closest.distance.toFixed(2)} | ×${closest.centroidRatio.toFixed(2)} | ${bad === 0 ? 'PASS' : `FAIL (${bad})`} |\n`;
  }
  md += `\n`;
  const chars = fam.slots
    .map((id) => bySlot.get(id))
    .filter(Boolean)
    .slice(0, 1)
    .flatMap((s) => s.rows.slice(1).map((r) => `\`${r.id}\` ${r.character}`));
  md += `The three offers in this family, as the board prints them (first slot shown): ${chars.join(' · ')}\n`;
}

md += `\n---\n\n**${totalPairs} pairs across ${spread.slots.length} slots, ${totalFail} below the floor.**\n`;
writeFileSync(join(HERE, 'spread-by-family.md'), md);

// --- shoot the board --------------------------------------------------------

/** Slots to shoot individually: one per batch this brief shipped, plus a fossil fix. */
const SHOTS = ['rockChip', 'shipExplode', 'musicTheme', 'alarm', 'minimapPing'];

async function main() {
  mkdirSync(HERE, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + outHtml, { waitUntil: 'load' });

  for (const id of SHOTS) {
    const el = page.locator(`#slot-${id}`);
    await el.screenshot({ path: join(HERE, `board-${id}.png`) });
  }

  // Three consecutive slots in one frame — the view the developer sent back.
  await page.locator('#slot-shipExplode').screenshot({ path: join(HERE, 'board-three-slots.png') });
  await page.evaluate(() => {
    const a = document.getElementById('slot-shipExplode');
    const wrap = document.createElement('div');
    wrap.id = 'three';
    a.parentNode.insertBefore(wrap, a);
    wrap.append(a, document.getElementById('slot-shipSpawn'), document.getElementById('slot-spawnPulse'));
  });
  await page.locator('#three').screenshot({ path: join(HERE, 'board-three-slots.png') });

  await browser.close();
  console.log(`board.html + ${SHOTS.length + 1} screenshots + spread-by-family.md written to ${HERE}`);
}

await main();
