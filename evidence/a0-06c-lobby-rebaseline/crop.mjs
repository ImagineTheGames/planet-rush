import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [, , src, dst, X, Y, W, H, SCALE] = process.argv;
const s = PNG.sync.read(readFileSync(src));
const x0 = +X, y0 = +Y, w = +W, h = +H, k = +(SCALE ?? 1);
const out = new PNG({ width: w * k, height: h * k });
for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
  const si = (s.width * (y0 + Math.floor(y / k)) + (x0 + Math.floor(x / k))) << 2;
  const di = (out.width * y + x) << 2;
  for (let c = 0; c < 4; c++) out.data[di + c] = s.data[si + c];
}
writeFileSync(dst, PNG.sync.write(out));
console.log(`${dst}  ${w}x${h} @${k}x from ${src}`);
