import { chromium } from 'playwright';
const b = await chromium.launch({
  args: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('[err]', String(e).slice(0, 300)));
await p.addInitScript(() => localStorage.setItem('planet-rush:mapId', 'oval'));
console.time('goto');
await p
  .goto('http://localhost:4196/?debug=1&freeze=1', { waitUntil: 'load', timeout: 60000 })
  .catch((e) => console.log('goto fail', e.message));
console.timeEnd('goto');
await p.waitForTimeout(4000);
console.log(
  'canvas',
  await p.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? `${c.width}x${c.height}` : 'none';
  }),
);
console.time('raf20');
const d = await p.evaluate(
  () =>
    new Promise((done) => {
      const a = [];
      let l = performance.now();
      const t = (n) => {
        a.push(n - l);
        l = n;
        if (a.length < 20) {
          requestAnimationFrame(t);
          return;
        }
        done(a);
      };
      requestAnimationFrame(t);
    }),
);
console.timeEnd('raf20');
console.log('deltas', d.map((x) => x.toFixed(1)).join(' '));
await b.close();
