/**
 * evidence/a1-13-night-round/probe-socket.mjs — what the match socket actually
 * does, second by second, with NOTHING interfered with. OWNER: QA Manager.
 *
 * The link-loss round kept measuring a socket that was already dead before the
 * experiment started: 6-7 frames received across a whole match and `readyState`
 * CLOSED within ten seconds of RUSH, on runs where nothing had been gagged yet.
 * Before anything can be attested about whether the client NOTICES a dead link,
 * it has to be established what the link does on its own.
 *
 * So: a real room on the real fleet, a real match, and no gag, no proxy, no
 * offline emulation, no interference of any kind. Just a WebSocket wrapper that
 * counts frames and records the close code and reason verbatim, sampled once a
 * second from before RUSH until well after.
 *
 *   node evidence/a1-13-night-round/probe-socket.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.A1_13_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

await ctx.addInitScript(() => {
  const w = window;
  w.__wsProbe = { sockets: [], events: [] };
  const Native = w.WebSocket;
  const P = function (url, protocols) {
    const s = protocols === undefined ? new Native(url) : new Native(url, protocols);
    const rec = {
      url: String(url),
      openedAt: Date.now(),
      received: 0,
      sent: 0,
      lastRecvAt: 0,
      firstRecvAt: 0,
      close: null,
      error: false,
      sock: s,
    };
    w.__wsProbe.sockets.push(rec);
    s.addEventListener('message', () => {
      rec.received++;
      rec.lastRecvAt = Date.now();
      if (!rec.firstRecvAt) rec.firstRecvAt = rec.lastRecvAt;
    });
    s.addEventListener('close', (e) => {
      rec.close = { at: Date.now(), code: e.code, reason: String(e.reason ?? ''), wasClean: e.wasClean };
      w.__wsProbe.events.push({ t: Date.now(), kind: 'close', code: e.code, reason: String(e.reason ?? '') });
    });
    s.addEventListener('error', () => {
      rec.error = true;
      w.__wsProbe.events.push({ t: Date.now(), kind: 'error' });
    });
    const send = s.send.bind(s);
    s.send = (d) => {
      rec.sent++;
      return send(d);
    };
    return s;
  };
  P.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) P[k] = Native[k];
  w.WebSocket = P;
});

const page = await ctx.newPage();
const out = { base: BASE, capturedAt: new Date().toISOString(), errors: [], samples: [] };
page.on('pageerror', (e) => out.errors.push({ kind: 'pageerror', message: e.message }));
page.on('console', (m) => {
  if (m.type() === 'error') out.errors.push({ kind: 'console.error', message: m.text() });
});

const read = () =>
  page.evaluate(() => ({
    sockets: window.__wsProbe.sockets.map((r) => ({
      url: r.url.split('?')[0],
      received: r.received,
      sent: r.sent,
      sinceLastRecvMs: r.lastRecvAt ? Date.now() - r.lastRecvAt : null,
      readyState: r.sock.readyState,
      close: r.close,
      error: r.error,
      ageMs: Date.now() - r.openedAt,
    })),
    matchStarted: window.__mainMenu?.matchStarted ?? null,
    overlay: !!document.getElementById('pr-link-loss')?.querySelector('button'),
  }));

const click = async (pt) => page.mouse.click(pt.x, pt.y);
const ctrl = (seam, kind) =>
  page.evaluate(
    ([w, k]) => {
      const l = w === 'menu' ? (window.__mainMenu?.controls ?? []) : (window.__onlineMenu?.doorControls ?? []);
      const c = l.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind],
  );

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 90_000 });
await click(await ctrl('menu', 'play'));
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 60_000 });
await click(await ctrl('door', 'create'));
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 120_000 });
await sleep(1500);
out.lobby = await page.evaluate(() => ({
  online: window.__lobby.online,
  room: window.__lobby.room,
  isHost: window.__lobby.isHost,
  humanCount: window.__lobby.humanCount,
}));
out.inLobby = await read();

for (let i = 0; i < 6; i++) {
  const st = await page.evaluate(() => {
    const s = window.__lobby.seatStates[1];
    return { label: s.label, x: s.physicalCenter.x, y: s.physicalCenter.y };
  });
  if (st.label === 'BOT') break;
  await click(st);
  await sleep(450);
}
out.seats = await page.evaluate(() => window.__lobby.seatStates.map((s) => s.label));

const rc = await page.evaluate(() => {
  const p = window.__lobby.rushControl.physicalCenter;
  return { x: p.x, y: p.y };
});
await click(rc);
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 120_000 });
const t0 = Date.now();
out.rushedAt = t0;

// 60 seconds of an untouched online match.
for (let i = 0; i < 60; i++) {
  out.samples.push({ atMs: Date.now() - t0, ...(await read()) });
  await sleep(1000);
}

out.final = await read();
await browser.close();
writeFileSync(join(HERE, 'readback-socket-probe.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      lobby: out.lobby,
      seats: out.seats,
      first: out.samples.slice(0, 3),
      close: out.final.sockets.map((s) => s.close),
      final: out.final,
      errors: out.errors.slice(0, 5),
    },
    null,
    2,
  ),
);
