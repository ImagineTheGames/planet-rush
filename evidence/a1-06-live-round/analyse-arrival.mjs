/**
 * evidence/a1-06-live-round/analyse-arrival.mjs — did the wave physically ARRIVE?
 * OWNER: QA Manager.
 *
 * The wave COUNTER cannot answer that question. `WAVE n/5` is
 * `waveClockAt(t, interval)` — pure clock arithmetic on the client — so a client
 * predicting 180 against a server spawning at 150 would show exactly the same
 * counter as a correct one. The brief is explicit that this is the failure mode
 * that would be WORSE than the old honest 150.
 *
 * Asteroids are not clock arithmetic. In an online match they are
 * server-authoritative entities streamed to the client, so ROCKS APPEARING is
 * the server's own testimony about when it spawned the wave.
 *
 * This measures the committed frames rather than the live page: for each pair of
 * consecutive frames it counts pixels that are DARK in the earlier frame and LIT
 * in the later one — newly drawn matter — and buckets them into 160 px cells so
 * the HUD's own changing text can be told apart from rocks in the field.
 *
 *   node evidence/a1-06-live-round/analyse-arrival.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const FRAMES = ['140', '165', '178', '192', '205', '225'];

const lit = (d, i) => d[i] > 40 && d[i + 1] > 40 && d[i + 2] > 40;

function read(t) {
  return PNG.sync.read(readFileSync(join(IMAGES, `a1-06-wave-arrival-field-guest-${t}s.png`)));
}

/** Lit fraction of the play area — HUD strips and the minimap corner excluded. */
function inkPct(p) {
  const { width: W, height: H, data } = p;
  let n = 0;
  let seen = 0;
  for (let y = Math.floor(H * 0.14); y < Math.floor(H * 0.86); y++) {
    for (let x = 0; x < W; x += 2) {
      if (x > W * 0.78 && y > H * 0.7) continue;
      seen++;
      if (lit(data, (W * y + x) << 2)) n++;
    }
  }
  return +((n / seen) * 100).toFixed(4);
}

const pages = FRAMES.map((t) => ({ t, png: read(t) }));
const ink = pages.map(({ t, png }) => ({ atS: +t, inkPct: inkPct(png) }));

const steps = [];
for (let k = 1; k < pages.length; k++) {
  const a = pages[k - 1].png;
  const b = pages[k].png;
  const { width: W, height: H } = a;
  const cells = new Map();
  let newLit = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      if (lit(a.data, i) || !lit(b.data, i)) continue;
      newLit++;
      const key = `${Math.floor(x / 160)},${Math.floor(y / 160)}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
  }
  // The top HUD band is where the clock's own text lives; anything above CSS
  // y=112 (row 0 of the grid at 2x) is the wave/NEXT/MATCH line rewriting
  // itself, not a rock.
  const hud = [...cells].filter(([k]) => Number(k.split(',')[1]) === 0).reduce((n, [, v]) => n + v, 0);
  steps.push({
    from: pages[k - 1].t + 's',
    to: pages[k].t + 's',
    newlyLitPixels: newLit,
    inHudTextRow: hud,
    inPlayField: newLit - hud,
    biggestCells: [...cells]
      .filter(([, v]) => v > 300)
      .sort((p, q) => q[1] - p[1])
      .map(([k, v]) => {
        const [c, r] = k.split(',').map(Number);
        return { cell: k, pixels: v, cssX: (c * 160 + 80) / 2, cssY: (r * 160 + 80) / 2 };
      }),
  });
}

const out = { note: 'newly-lit = dark in the earlier frame, lit in the later one', ink, steps };
writeFileSync(join(HERE, 'arrival-analysis.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
